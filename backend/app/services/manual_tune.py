"""Manual QC adjustments for document scans — maps UI sliders (0–100) to OpenCV ops."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..schemas import ManualTuneIn


def _is_neutral(p: ManualTuneIn) -> bool:
    """Skip processing when sliders are at defaults — avoids CLAHE drift vs raw upload."""
    return (
        abs(p.brightness - 50.0) < 0.25
        and abs(p.contrast - 50.0) < 0.25
        and abs(p.gamma - 50.0) < 0.25
        and abs(p.rotate - 50.0) < 0.25
        and abs(p.clahe - 50.0) < 0.25
        and p.denoise < 0.75
        and p.sharpen < 0.75
    )


def _gamma_lut(gamma: float) -> np.ndarray:
    g = max(0.45, min(1.55, float(gamma)))
    inv = 1.0 / g
    table = np.array([((i / 255.0) ** inv) * 255.0 for i in range(256)]).astype(np.uint8)
    return table


def apply_manual_tune(img_bgr: np.ndarray, p: ManualTuneIn) -> np.ndarray:
    """
    Slider semantics (defaults neutral):
    - brightness/contrast/gamma/clahe/rotate: 50 = no net change (except CLAHE always mild).
    - denoise/sharpen: 0 = off.
    """
    if _is_neutral(p):
        return img_bgr.copy()

    out = img_bgr.astype(np.float32)

    # --- Rotation (degrees): 50 -> 0°, linear ±12° ---
    rot = (p.rotate - 50.0) / 50.0 * 12.0
    if abs(rot) > 0.05:
        h, w = out.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), rot, 1.0)
        out = cv2.warpAffine(
            np.clip(out, 0, 255).astype(np.uint8),
            m,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        ).astype(np.float32)
    else:
        out = np.clip(out, 0, 255)

    work = np.clip(out, 0, 255).astype(np.uint8)

    # --- Denoise: NLMeans (soft curve + cap — heavy denoise kills Laplacian / QS) ---
    if p.denoise > 1.0:
        # sqrt scaling: slider 70 → ~6.2 instead of linear ~9
        h_strength = 2.0 + math.sqrt(max(p.denoise, 0.0) / 100.0) * 5.5
        h_strength = min(7.0, h_strength)
        work = cv2.fastNlMeansDenoisingColored(
            work, None, h=h_strength, hColor=h_strength, templateWindowSize=7, searchWindowSize=21
        )

    # --- CLAHE on luminance (clip from slider ~1.2–3.6) ---
    clip = 1.2 + (p.clahe / 100.0) * 2.4
    clip = max(1.1, min(4.0, clip))
    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB)
    l_chan, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    l2 = clahe.apply(l_chan)
    work = cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)

    # --- Gamma (50 -> 1.0) ---
    gamma = 1.0 + (p.gamma - 50.0) / 100.0 * 0.65
    gamma = max(0.65, min(1.35, gamma))
    lut = _gamma_lut(gamma)
    work = cv2.LUT(work, lut)

    # --- Brightness / contrast via linear scale ---
    beta = (p.brightness - 50.0) * 1.25
    alpha = 0.68 + (p.contrast / 100.0) * 0.72
    alpha = max(0.55, min(1.55, alpha))
    work = cv2.convertScaleAbs(work, alpha=alpha, beta=beta)

    # --- Unsharp mask ---
    if p.sharpen > 1.0:
        amt = 0.15 + (p.sharpen / 100.0) * 1.35
        sigma = 1.0 + (p.sharpen / 100.0) * 0.9
        blurred = cv2.GaussianBlur(work, (0, 0), sigma)
        work = cv2.addWeighted(work, 1.0 + amt, blurred, -amt, 0)

    return work
