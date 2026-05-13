"""Iterative image enhancement for document scans.

QS-guided passes always refine from the **current best** frame (avoids chained drift).
Stops early when QS stalls (marginal gains), then polish / escalation paths run.
Never ships an on-disk result below the upload file QS.
"""
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .quality import compute_qs, compute_qs_bgr, compute_qs_post, compute_qs_post_bgr
from .pipeline_config import (
    ENHANCEMENT_DEFAULT_TARGET_QS,
    ENHANCEMENT_MAX_PASSES,
    ENHANCEMENT_MIN_PASS_IMPROVEMENT,
    ENHANCEMENT_STALL_WINDOW,
)


def _high_key_normalize(img_bgr: np.ndarray) -> np.ndarray:
    """Recover ink and local contrast on washed / flash-blown document scans (modern L-channel workflow).

    Percentile stretch on LAB luminance + mild gamma pulls highlights toward readable text-on-paper tone.
    """
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_ch, b_ch = cv2.split(lab)
    l32 = l_chan.astype(np.float32)
    p_lo, p_hi = np.percentile(l32, (2.5, 99.2))
    if p_hi > p_lo + 12.0:
        l_stretch = np.clip((l32 - p_lo) / (p_hi - p_lo) * 255.0, 0, 255).astype(np.uint8)
    else:
        l_stretch = l_chan
    # Gamma > 1 darkens elevated luminance (common on phone captures of white paper).
    gamma = 1.28
    lg = np.clip((l_stretch.astype(np.float32) / 255.0) ** gamma * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(cv2.merge((lg, a_ch, b_ch)), cv2.COLOR_LAB2BGR)


def _maybe_recover_washed(img_bgr: np.ndarray) -> np.ndarray:
    """Apply high-key recovery only on truly washed captures.

    Clean printed pages have high mean *and* high std (white paper + dark ink); washed
    captures are high mean *and* low std (everything blown toward a single bright tone).
    Gating on std prevents gamma-darkening pristine scans into a grey-paper look.
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    if float(np.mean(gray)) < 218.0 or float(np.std(gray)) > 55.0:
        return img_bgr
    return _high_key_normalize(img_bgr)


def _grayscale(img_bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)


def _histogram_bins(gray: np.ndarray, bins: int = 16) -> list[float]:
    """16-bin normalised histogram of a grayscale image — small enough to embed in JSON / render inline."""
    hist, _ = np.histogram(gray, bins=bins, range=(0, 256))
    total = float(hist.sum()) or 1.0
    return [round(float(c) / total, 6) for c in hist]


def _enhancement_report(orig_bgr: np.ndarray, final_bgr: np.ndarray, verdict: str) -> dict[str, Any]:
    """Per-page operator-facing diff: what the enhancement actually changed.

    Lets QC verify the engine ran without having to eyeball pixel changes.
    """
    g0 = _grayscale(orig_bgr).astype(np.float32)
    g1 = _grayscale(final_bgr).astype(np.float32)
    if g0.shape != g1.shape:
        g1 = cv2.resize(g1, (g0.shape[1], g0.shape[0]), interpolation=cv2.INTER_AREA)
    diff = g1 - g0
    paper_mask = g0 >= 230.0
    ink_mask = g0 < 100.0
    paper_lift = float(np.mean(diff[paper_mask])) if paper_mask.any() else 0.0
    ink_deepen = float(np.mean(diff[ink_mask])) if ink_mask.any() else 0.0
    pct_changed = float(np.mean(np.abs(diff) >= 1.0))
    mean_shift = float(np.mean(diff))
    return {
        "verdict": verdict,
        "pct_pixels_changed": round(pct_changed, 4),
        "paper_lift": round(paper_lift, 2),
        "ink_deepen": round(ink_deepen, 2),
        "mean_shift": round(mean_shift, 2),
        "hist_before": _histogram_bins(_grayscale(orig_bgr)),
        "hist_after": _histogram_bins(_grayscale(final_bgr)),
    }


def _is_clean_document(img_bgr: np.ndarray) -> bool:
    """Already-clean printed page: dominant white paper, real ink pixels, low noise floor.

    Used to short-circuit the iterative loop on inputs that don't need enhancement —
    iterative CLAHE / NLMeans on these adds visible halos and is gamed by the QS scorer.
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    paper_frac = float(np.mean(gray > 230))
    ink_frac = float(np.mean(gray < 100))
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    noise = float(np.std(gray.astype(np.float32) - blurred.astype(np.float32)))
    return paper_frac > 0.55 and ink_frac > 0.003 and noise < 12.0


def _clean_doc_polish(img_bgr: np.ndarray) -> np.ndarray:
    """Tone-curve only polish for clean printed pages.

    Snaps near-white paper to pure 255 and gently deepens the dark band. Leaves the
    anti-aliasing midtones untouched so there is no ringing / halo. The histogram
    becomes more bimodal, which raises σ (contrast) and Laplacian variance (sharpness)
    honestly — no synthetic gradients.
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    f = gray.astype(np.float32)
    f = np.where(f >= 235.0, 255.0, f)
    dark = f < 150.0
    f[dark] = np.power(f[dark] / 150.0, 1.18) * 150.0
    out = np.clip(f, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)


def _detail_enhance_bgr(img: np.ndarray, amount: float = 0.85) -> np.ndarray:
    """Base/detail boost (bilateral base + scaled residual) — improves edge QS without heavy halos."""
    img_f = img.astype(np.float32)
    base = cv2.bilateralFilter(img, d=9, sigmaColor=75, sigmaSpace=75).astype(np.float32)
    detail = img_f - base
    out = base + detail * float(amount)
    return np.clip(out, 0, 255).astype(np.uint8)


def _deskew(gray: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(gray < 200))
    if len(coords) < 20:
        return gray
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.5:
        return gray
    (h, w) = gray.shape
    m = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _denoise_mild(img: np.ndarray, *, light: bool = False) -> np.ndarray:
    """NLMeans: smaller window on late passes for speed when gains are small."""
    if light:
        return cv2.fastNlMeansDenoisingColored(img, None, h=3, hColor=3, templateWindowSize=5, searchWindowSize=15)
    return cv2.fastNlMeansDenoisingColored(img, None, h=4, hColor=4, templateWindowSize=7, searchWindowSize=21)


def _clahe_mild(img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_chan, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l2 = clahe.apply(l_chan)
    return cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)


def _unsharp_bgr(img: np.ndarray, sigma: float = 1.15, amount: float = 0.75) -> np.ndarray:
    blurred = cv2.GaussianBlur(img, (0, 0), sigma)
    return cv2.addWeighted(img, 1.0 + amount, blurred, -amount, 0)


def _enhance_pass(img_bgr: np.ndarray, pass_number: int) -> np.ndarray:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    if pass_number == 1:
        gray = _deskew(gray)
    work = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    work = _denoise_mild(work, light=pass_number > 8)
    work = _clahe_mild(work)
    work = _unsharp_bgr(work)
    return work


def _clahe_on_lab_l(img_bgr: np.ndarray, clip_limit: float, tile: int = 8) -> np.ndarray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    l2 = clahe.apply(l_chan)
    return cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)


def _escalation_variants(best: np.ndarray, original: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """When mild iterative enhancement stalls, try alternate pipelines that often raise QS on weak scans."""
    out: list[tuple[str, np.ndarray]] = []

    # 1) Edge-preserving smooth + stronger local contrast (helps noisy phone captures without NLMeans blur).
    x = cv2.bilateralFilter(best, d=7, sigmaColor=65, sigmaSpace=65)
    x = _clahe_on_lab_l(x, 3.15)
    x = _unsharp_bgr(x, sigma=0.95, amount=0.55)
    out.append(("bilateral + CLAHE 3.15", x))

    # 2) Skip chroma denoise chain — heavy CLAHE on luminance only from current best.
    x = _clahe_on_lab_l(best, 3.45)
    x = _unsharp_bgr(x, sigma=1.05, amount=0.5)
    out.append(("strong L-channel CLAHE", x))

    # 3) Faded / gray wash: lift midtones then contrast (QS rewards std + Laplacian when not over-blurred).
    lab = cv2.cvtColor(best, cv2.COLOR_BGR2LAB)
    l_chan, a, b_ch = cv2.split(lab)
    l32 = l_chan.astype(np.float32)
    lo, hi = np.percentile(l32, (2.0, 98.0))
    if hi > lo + 5:
        l_stretch = np.clip((l32 - lo) / (hi - lo) * 255.0, 0, 255).astype(np.uint8)
        x = cv2.cvtColor(cv2.merge((l_stretch, a, b_ch)), cv2.COLOR_LAB2BGR)
        x = _unsharp_bgr(x, sigma=1.0, amount=0.42)
        out.append(("luminance stretch + sharpen", x))

    # 4) Same ladder from raw upload with bilateral only (no NLMeans — preserves edges for Laplacian QS).
    x = cv2.bilateralFilter(original, d=9, sigmaColor=80, sigmaSpace=80)
    x = _clahe_on_lab_l(x, 2.85)
    x = _unsharp_bgr(x, sigma=1.0, amount=0.48)
    out.append(("from upload: bilateral + CLAHE", x))

    # 5) Blend best with original — occasionally reduces halos while keeping lift.
    blend = cv2.addWeighted(original, 0.22, best, 0.78, 0)
    blend = _clahe_on_lab_l(blend, 2.6)
    blend = _unsharp_bgr(blend, sigma=1.0, amount=0.4)
    out.append(("blend original+best", blend))

    # 6) Sharpening-focused path on mildly blurred inputs.
    blur = cv2.GaussianBlur(best, (0, 0), 1.15)
    sharp = cv2.addWeighted(best, 1.35, blur, -0.35, 0)
    sharp = np.clip(sharp, 0, 255).astype(np.uint8)
    sharp = _clahe_on_lab_l(sharp, 2.5)
    out.append(("deblur emphasis", sharp))

    # 7) Washed / flash-white scans: dedicated L-channel recovery + detail boost (modern tone mapping).
    x = _high_key_normalize(best)
    x = _clahe_on_lab_l(x, 3.0)
    x = _detail_enhance_bgr(x, amount=0.92)
    x = _unsharp_bgr(x, sigma=0.92, amount=0.52)
    out.append(("high-key L recover + detail", x))

    x = _high_key_normalize(original)
    x = cv2.bilateralFilter(x, d=7, sigmaColor=72, sigmaSpace=72)
    x = _clahe_on_lab_l(x, 2.75)
    x = _detail_enhance_bgr(x, amount=0.88)
    x = _unsharp_bgr(x, sigma=1.0, amount=0.46)
    out.append(("from upload: high-key + bilateral", x))

    return out


def enhance_image_stream(
    input_path: str,
    output_path: str,
    target_qs: float | None = None,
    max_passes: int | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield progress events; final event has phase ``complete`` with the same ``result`` dict as ``enhance_image``."""
    img = cv2.imread(input_path)
    if img is None:
        raise ValueError(f"Cannot read image: {input_path}")

    if target_qs is None:
        target_qs = ENHANCEMENT_DEFAULT_TARGET_QS
    if max_passes is None:
        max_passes = ENHANCEMENT_MAX_PASSES

    # Keep an untouched copy for the diff report; ``img`` may be tone-mapped below.
    original_disk = img.copy()

    # Modern preprocessing for severely washed captures — improves QS headroom before iterative passes.
    img_pre = _maybe_recover_washed(img)
    washed_recovered = not np.array_equal(img_pre, img)
    img = img_pre

    # Two scales are tracked here:
    #   * Initial QS (strict) — what the operator sees as the upload's "real" quality. Stored in DB.
    #   * Post QS (lenient) — what the enhancement loop optimises against; saturates at 100 for
    #     publication-ready scans. The regression guard also uses lenient on both sides so the
    #     comparison is on a single scale.
    file_initial_strict = compute_qs(input_path)
    qs_initial_strict = float(file_initial_strict["qs"])
    file_initial_lenient = compute_qs_post(input_path)
    qs_orig_lenient = float(file_initial_lenient["qs"])
    baseline_lenient = compute_qs_post_bgr(img)
    qs_mem_lenient = float(baseline_lenient["qs"])
    qs_start = max(qs_orig_lenient, qs_mem_lenient)

    # Initial QS reported back to UI uses the strict (realistic) score from disk.
    initial = dict(file_initial_strict)
    initial["qs"] = round(qs_initial_strict, 2)

    best = img.copy()
    best_metrics = baseline_lenient
    best_qs = qs_start
    history: list[dict] = [{"pass": 0, "qs": best_qs, "best_qs": best_qs}]
    verdict = "no_change"
    if washed_recovered:
        verdict = "washed_recovery"

    yield {
        "phase": "start",
        "initial_qs": round(qs_start, 2),
        "initial_metrics": {k: initial[k] for k in ("sharpness", "brightness", "contrast", "noise") if k in initial},
        "target_qs": float(target_qs),
        "max_passes": max_passes,
        "min_pass_improvement": ENHANCEMENT_MIN_PASS_IMPROVEMENT,
        "stall_window": ENHANCEMENT_STALL_WINDOW,
    }

    # Already-clean printed page: short-circuit with a tone-only polish. Iterative CLAHE /
    # NLMeans on these inputs creates visible halos and gets gamed by the QS scorer.
    if _is_clean_document(img):
        polished = _clean_doc_polish(img)
        pol_metrics = compute_qs_post_bgr(polished)
        pol_qs = float(pol_metrics["qs"])
        if pol_qs >= best_qs:
            best = polished
            best_qs = pol_qs
            best_metrics = pol_metrics
            verdict = "clean_doc_polish"
        history.append({"pass": 1, "qs": pol_qs, "best_qs": best_qs})
        yield {
            "phase": "clean_doc",
            "best_qs": round(best_qs, 2),
            "candidate_qs": round(pol_qs, 2),
            "target_qs": float(target_qs),
            "met_target": bool(best_qs >= target_qs),
            "verdict": verdict,
        }
        yield {"phase": "write", "message": "Saving enhanced image…"}
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(output_path, best)
        final = compute_qs_post(output_path)
        if float(final["qs"]) < qs_orig_lenient:
            shutil.copyfile(input_path, output_path)
            final = compute_qs_post(output_path)
            verdict = "rolled_back_to_original"
        final_disk = cv2.imread(output_path)
        report = _enhancement_report(original_disk, final_disk if final_disk is not None else best, verdict)
        result = {
            "initial": initial,
            "final": final,
            "passes": 1,
            "target_qs": target_qs,
            "history": history,
            "report": report,
        }
        yield {"phase": "complete", "result": result}
        return

    passes = 0
    stall = 0

    while best_qs < target_qs and passes < max_passes:
        prev_best = best_qs
        passes += 1
        # Always refine from current best — avoids compounding blur / tone drift from weaker intermediates.
        candidate = _enhance_pass(best, passes)
        cand_metrics = compute_qs_post_bgr(candidate)
        cand_qs = float(cand_metrics["qs"])

        if cand_qs > best_qs:
            best = candidate.copy()
            best_qs = cand_qs
            best_metrics = cand_metrics
            verdict = f"iterative_pass_{passes}"

        history.append(
            {
                "pass": passes,
                "qs": cand_qs,
                "best_qs": best_qs,
            }
        )

        gain = best_qs - prev_best
        if gain < ENHANCEMENT_MIN_PASS_IMPROVEMENT:
            stall += 1
        else:
            stall = 0

        yield {
            "phase": "pass",
            "pass": passes,
            "max_passes": max_passes,
            "best_qs": round(best_qs, 2),
            "candidate_qs": round(cand_qs, 2),
            "target_qs": float(target_qs),
            "met_target": bool(best_qs >= target_qs),
            "stall_count": stall,
        }

        if stall >= ENHANCEMENT_STALL_WINDOW:
            break

    if best_qs < target_qs:
        yield {"phase": "polish", "message": "Fine-tuning contrast (SOP polish)…"}
        for clip in (2.3, 2.6):
            lab = cv2.cvtColor(best, cv2.COLOR_BGR2LAB)
            l_chan, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
            l2 = clahe.apply(l_chan)
            trial = cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)
            trial = _unsharp_bgr(trial, sigma=1.0, amount=0.45)
            tq = float(compute_qs_post_bgr(trial)["qs"])
            if tq > best_qs:
                best = trial
                best_qs = tq
                best_metrics = compute_qs_post_bgr(best)
                verdict = f"polish_clip_{clip}"
            yield {
                "phase": "polish_pass",
                "clip": clip,
                "best_qs": round(best_qs, 2),
                "target_qs": float(target_qs),
            }

    # Still below SOP: try alternate pipelines (different trade-offs vs mild iterative passes).
    if best_qs < target_qs:
        yield {"phase": "escalation", "message": "SOP recovery — alternate enhancement pipelines…"}
        for label, trial_img in _escalation_variants(best, img):
            tq = float(compute_qs_post_bgr(trial_img)["qs"])
            improved = tq > best_qs
            if improved:
                best = trial_img.copy()
                best_qs = tq
                verdict = f"escalation:{label}"
            yield {
                "phase": "escalation_try",
                "label": label,
                "trial_qs": round(tq, 2),
                "best_qs": round(best_qs, 2),
                "target_qs": float(target_qs),
                "picked": improved,
            }
            if best_qs >= target_qs:
                break

    yield {"phase": "write", "message": "Saving enhanced image…"}

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(output_path, best)
    final = compute_qs_post(output_path)

    # Regression guard: if the saved enhanced image has a lower lenient QS than the original on the
    # same lenient scale, ship the original instead. Both sides on lenient = fair comparison.
    qf = float(final["qs"])
    if qf < qs_orig_lenient:
        shutil.copyfile(input_path, output_path)
        final = compute_qs_post(output_path)
        verdict = "rolled_back_to_original"

    final_disk = cv2.imread(output_path)
    report = _enhancement_report(original_disk, final_disk if final_disk is not None else best, verdict)
    result = {
        "initial": initial,
        "final": final,
        "passes": passes,
        "target_qs": target_qs,
        "history": history,
        "report": report,
    }
    yield {"phase": "complete", "result": result}


def enhance_image(
    input_path: str,
    output_path: str,
    target_qs: float | None = None,
    max_passes: int | None = None,
) -> dict:
    """Run enhancement synchronously (no streaming); returns metrics dict."""
    result: dict | None = None
    for evt in enhance_image_stream(input_path, output_path, target_qs=target_qs, max_passes=max_passes):
        if evt.get("phase") == "complete":
            result = evt["result"]
    if result is None:
        raise RuntimeError("Enhancement produced no result")
    return result
