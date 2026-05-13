"""Per-stage SOP defaults and tunable parameters (enhancement max passes, thresholds, etc.)."""

from __future__ import annotations

import os
from typing import Any

# Enhancement: composite QS must reach this (document.target_qs overrides default for runs).
ENHANCEMENT_DEFAULT_TARGET_QS = float(os.environ.get("ENHANCEMENT_DEFAULT_TARGET_QS", "100"))

# Stop iterating when QS gain across this many passes stays below MIN_PASS_IMPROVEMENT (then polish / escalation).
ENHANCEMENT_MAX_PASSES = max(4, min(32, int(os.environ.get("ENHANCEMENT_MAX_PASSES", "16"))))
ENHANCEMENT_MIN_PASS_IMPROVEMENT = float(os.environ.get("ENHANCEMENT_MIN_PASS_IMPROVEMENT", "0.12"))
ENHANCEMENT_STALL_WINDOW = max(2, int(os.environ.get("ENHANCEMENT_STALL_WINDOW", "2")))

# Auto-enhance: skip enhancement when Initial QS (strict) already meets this threshold.
# Documents below the threshold are flagged for full enhancement; above it, the upload is shipped as-is.
AUTO_ENHANCE_THRESHOLD = max(0.0, min(100.0, float(os.environ.get("AUTO_ENHANCE_THRESHOLD", "75"))))


def enhancement_runtime() -> dict[str, Any]:
    return {
        "target_qs_default": ENHANCEMENT_DEFAULT_TARGET_QS,
        "max_passes": ENHANCEMENT_MAX_PASSES,
        "min_pass_improvement": ENHANCEMENT_MIN_PASS_IMPROVEMENT,
        "stall_window_passes": ENHANCEMENT_STALL_WINDOW,
        "qs_model": "laplacian_variance_sharpness_brightness_contrast_noise",
        "auto_enhance_threshold": AUTO_ENHANCE_THRESHOLD,
    }


def stage_config_public() -> dict[str, Any]:
    """Static defaults for UI / operators (no secrets)."""
    return {
        "enhancement": {
            "title": "Image Enhancement",
            "sop_target_default": ENHANCEMENT_DEFAULT_TARGET_QS,
            "sop_allowed_range": {"min": 80.0, "max": 100.0},
            "config": enhancement_runtime(),
            "algorithm": "QS_guided_mild_passes_then_polish_and_escalation",
        },
        "ocr": {
            "title": "Text IQ (OCR)",
            "sop_target_default": None,
            "notes": "Uses Tesseract when installed; EasyOCR fallback. QC edits drive CER.",
        },
        "doc_class": {
            "title": "Document classification",
            "sop_target_default": None,
            "notes": "Gemini when GEMINI_API_KEY set; else TF-IDF. Top class + score bars.",
        },
        "index_genius": {
            "title": "Index Genius",
            "sop_target_default": None,
            "notes": "Per-class strict schema (Master Data dropdowns). Gemini fills fields; regex fallback.",
        },
        "abstractor": {
            "title": "Abstractor",
            "sop_target_default": None,
            "notes": "Gemini 3-sentence summary per page when OCR exists; LSA fallback without a key.",
        },
        "lingua": {
            "title": "Lingua AI",
            "sop_target_default": None,
            "notes": "Target language from supported list; per-page translation when pages exist.",
        },
    }
