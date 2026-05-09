"""Image Quality Score (QS) — composite metric 0-100.

Two scales:
  * **Initial QS** (`compute_qs` / `compute_qs_bgr`) — strict bounds. Measures the *raw* upload
    quality on a realistic scale; typical clean office scans land in the 50-70s.
  * **Post QS** (`compute_qs_post` / `compute_qs_post_bgr`) — lenient bounds calibrated so a
    publication-ready enhanced scan saturates at 100. The enhancement loop optimises against this.

Two scales because clamping the strict formula would mean SOP target 100 is unreachable on real
documents, while loosening the only formula would make even the raw upload score 100 (no headroom
shown). Splitting them gives operators an honest "before" reading and a clear "we hit SOP" after.
"""
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np


def _normalize(value: float, lo: float, hi: float) -> float:
    if hi == lo:
        return 0.0
    return float(max(0.0, min(1.0, (value - lo) / (hi - lo))))


def _brightness_strict(mean_val: float) -> float:
    """Initial QS brightness — narrow paper peak at 200 mean, midtone secondary."""
    b_mid = max(0.0, 1.0 - abs(mean_val - 127.0) / 127.0)
    b_paper = max(0.0, 1.0 - abs(mean_val - 200.0) / 72.0)
    return max(b_mid, b_paper)


def _brightness_lenient(mean_val: float) -> float:
    """Post QS brightness — wide plateau across the paper-text band; only penalises overexposure."""
    if 195.0 <= mean_val <= 248.0:
        return 1.0
    if mean_val < 195.0:
        b_mid = max(0.0, 1.0 - abs(mean_val - 127.0) / 127.0)
        b_paper = max(0.0, 1.0 - (195.0 - mean_val) / 90.0)
        return max(b_mid, b_paper)
    return max(0.0, 1.0 - (mean_val - 248.0) / 7.0)


def _qs_strict_from_gray(gray: np.ndarray) -> dict:
    """Initial QS — strict bounds. Typical clean doc upload scores 55-70."""
    sharpness_raw = cv2.Laplacian(gray, cv2.CV_64F).var()
    sharpness = _normalize(sharpness_raw, 50, 1300)

    mean_val = float(np.mean(gray))
    brightness = _brightness_strict(mean_val)

    contrast_raw = float(np.std(gray))
    contrast = _normalize(contrast_raw, 20, 82)

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    noise_raw = float(np.std(gray.astype(np.float32) - blurred.astype(np.float32)))
    noise = 1.0 - _normalize(noise_raw, 2, 20)

    qs = (sharpness * 0.32 + brightness * 0.18 + contrast * 0.35 + noise * 0.15) * 100.0
    return {
        "qs": round(qs, 2),
        "sharpness": round(sharpness * 100, 2),
        "brightness": round(brightness * 100, 2),
        "contrast": round(contrast * 100, 2),
        "noise": round(noise * 100, 2),
    }


def _qs_lenient_from_gray(gray: np.ndarray) -> dict:
    """Post QS — lenient bounds. A publication-ready enhanced doc saturates near 100."""
    sharpness_raw = cv2.Laplacian(gray, cv2.CV_64F).var()
    sharpness = _normalize(sharpness_raw, 80, 600)

    mean_val = float(np.mean(gray))
    brightness = _brightness_lenient(mean_val)

    contrast_raw = float(np.std(gray))
    contrast = _normalize(contrast_raw, 18, 42)

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    noise_raw = float(np.std(gray.astype(np.float32) - blurred.astype(np.float32)))
    noise = 1.0 - _normalize(noise_raw, 18, 40)

    qs = (sharpness * 0.32 + brightness * 0.18 + contrast * 0.35 + noise * 0.15) * 100.0
    return {
        "qs": round(qs, 2),
        "sharpness": round(sharpness * 100, 2),
        "brightness": round(brightness * 100, 2),
        "contrast": round(contrast * 100, 2),
        "noise": round(noise * 100, 2),
    }


_EMPTY = {"qs": 0.0, "sharpness": 0.0, "brightness": 0.0, "contrast": 0.0, "noise": 0.0}


def compute_qs_bgr(bgr: np.ndarray | None) -> dict:
    """Initial QS (strict) from an in-memory BGR image."""
    if bgr is None or bgr.size == 0:
        return dict(_EMPTY)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return _qs_strict_from_gray(gray)


def compute_qs(image_path: str) -> dict:
    """Initial QS (strict) from a file path."""
    img = cv2.imread(image_path)
    if img is None:
        return dict(_EMPTY)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return _qs_strict_from_gray(gray)


def compute_qs_post_bgr(bgr: np.ndarray | None) -> dict:
    """Post QS (lenient) from an in-memory BGR image — used by the enhancement loop."""
    if bgr is None or bgr.size == 0:
        return dict(_EMPTY)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return _qs_lenient_from_gray(gray)


def compute_qs_post(image_path: str) -> dict:
    """Post QS (lenient) from a file path — used for the enhanced raster's score."""
    img = cv2.imread(image_path)
    if img is None:
        return dict(_EMPTY)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return _qs_lenient_from_gray(gray)


def _page_profile(image_path: str, *, lenient: bool) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    if not image_path:
        return None, None
    p = Path(image_path)
    if not p.is_file():
        return None, None
    img = cv2.imread(str(p))
    if img is None:
        return None, None

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    full = _qs_lenient_from_gray(gray) if lenient else _qs_strict_from_gray(gray)

    qs_metrics = {
        "qs": float(full["qs"]),
        "sharpness": float(full["sharpness"]),
        "brightness": float(full["brightness"]),
        "contrast": float(full["contrast"]),
        "noise": float(full["noise"]),
    }
    image_params = {
        "width_px": int(w),
        "height_px": int(h),
        "mean_gray": round(float(np.mean(gray)), 2),
        "std_gray": round(float(np.std(gray)), 2),
        "laplacian_variance": round(lap_var, 2),
    }
    return qs_metrics, image_params


def compute_page_profile(image_path: str) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """Initial QS breakdown (strict) + raster stats for UI."""
    return _page_profile(image_path, lenient=False)


def compute_page_profile_post(image_path: str) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """Post QS breakdown (lenient) + raster stats — used for the enhanced page preview."""
    return _page_profile(image_path, lenient=True)
