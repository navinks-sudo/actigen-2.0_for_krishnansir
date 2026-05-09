"""Text IQ — OCR via Tesseract (primary) with EasyOCR fallback."""
from __future__ import annotations

import logging
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

from jiwer import cer

logger = logging.getLogger(__name__)

_WIN_TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)

# Per-language presets for Tesseract `lang` and EasyOCR `langs`. "auto" defers to env defaults
# but force-runs EasyOCR fallback if Tesseract output looks like garbage on non-Latin scripts.
LANG_PRESETS: dict[str, dict[str, Any]] = {
    "auto": {"label": "Auto", "tesseract": None, "easyocr": None},
    "eng": {"label": "English", "tesseract": "eng", "easyocr": ["en"]},
    "kan": {"label": "Kannada", "tesseract": "kan+eng", "easyocr": ["kn", "en"]},
    "hin": {"label": "Hindi", "tesseract": "hin+eng", "easyocr": ["hi", "en"]},
    "tam": {"label": "Tamil", "tesseract": "tam+eng", "easyocr": ["ta", "en"]},
    "tel": {"label": "Telugu", "tesseract": "tel+eng", "easyocr": ["te", "en"]},
    "mal": {"label": "Malayalam", "tesseract": "mal+eng", "easyocr": ["ml", "en"]},
    "ben": {"label": "Bengali", "tesseract": "ben+eng", "easyocr": ["bn", "en"]},
    "guj": {"label": "Gujarati", "tesseract": "guj+eng", "easyocr": ["gu", "en"]},
    "mar": {"label": "Marathi", "tesseract": "mar+eng", "easyocr": ["mr", "en"]},
}


def supported_ocr_languages() -> list[dict[str, str]]:
    """Public list for the UI dropdown."""
    return [{"code": k, "label": v["label"]} for k, v in LANG_PRESETS.items()]


def _is_garbage_latin(text: str) -> bool:
    """Heuristic: text contains mostly disjointed ALL-CAPS / Latin tokens — typical Tesseract output
    when an Indic-script document is read with English-only training. Flags a fallback to EasyOCR.
    """
    s = (text or "").strip()
    if len(s) < 30:
        return False
    tokens = re.findall(r"[A-Za-z]{2,}", s)
    if not tokens:
        return False
    short_caps = sum(1 for t in tokens if t.isupper() and 2 <= len(t) <= 5)
    ratio = short_caps / max(1, len(tokens))
    return ratio > 0.55


def _tesseract_cmd() -> str | None:
    env = os.environ.get("TESSERACT_CMD", "").strip()
    if env:
        p = Path(env)
        if p.is_file():
            return str(p)
        found = shutil.which(env)
        if found:
            return found
        return env
    found = shutil.which("tesseract")
    if found:
        return found
    if sys.platform == "win32":
        for cand in _WIN_TESSERACT_CANDIDATES:
            if Path(cand).is_file():
                return cand
    return None


def _tessdata_dir() -> str | None:
    """Resolve a tessdata directory: env var first, then a project-local ``backend/tessdata``."""
    env = (os.environ.get("TESSDATA_PREFIX") or "").strip()
    if env and Path(env).is_dir():
        return env
    # backend/app/services/ocr.py → backend/tessdata
    local = Path(__file__).resolve().parents[2] / "tessdata"
    if local.is_dir() and any(local.glob("*.traineddata")):
        return str(local)
    return None


def _tesseract_config() -> str:
    """Extra CLI args, e.g. ``--oem 3 --psm 6`` for dense scans (see Tesseract docs)."""
    return (os.environ.get("TESSERACT_CONFIG") or "").strip()


def _ensure_tessdata_env() -> None:
    """Point Tesseract at our local ``backend/tessdata`` if no env var is set.

    Using ``TESSDATA_PREFIX`` (process env) is robust against pytesseract's whitespace-split of the
    ``config`` string, which mangled the ``--tessdata-dir`` flag and embedded quotes into the path.
    """
    if (os.environ.get("TESSDATA_PREFIX") or "").strip():
        return
    local = Path(__file__).resolve().parents[2] / "tessdata"
    if local.is_dir() and any(local.glob("*.traineddata")):
        os.environ["TESSDATA_PREFIX"] = str(local)


def _available_tess_langs() -> list[str]:
    """List installed Tesseract language codes from the resolved tessdata dir."""
    candidates: list[Path] = []
    env = (os.environ.get("TESSDATA_PREFIX") or "").strip()
    if env:
        candidates.append(Path(env))
    candidates.append(Path(__file__).resolve().parents[2] / "tessdata")
    seen: set[str] = set()
    out: list[str] = []
    for d in candidates:
        try:
            if not d.is_dir():
                continue
        except OSError:
            continue
        for f in d.glob("*.traineddata"):
            code = f.stem
            if code in ("osd", "equ"):
                continue
            if code in seen:
                continue
            seen.add(code)
            out.append(code)
    return out


def _auto_tesseract_lang() -> str:
    """For Auto mode: combine all installed scripts so a single Tesseract pass handles mixed pages.

    ``eng`` is forced first when present (Tesseract picks the best per region but listing eng first
    helps when the page is actually English). Falls back to env / "eng".
    """
    langs = _available_tess_langs()
    if not langs:
        env = (os.environ.get("TESSERACT_LANG") or "eng").strip() or "eng"
        return env
    if "eng" in langs:
        ordered = ["eng"] + [c for c in langs if c != "eng"]
    else:
        ordered = langs
    return "+".join(ordered)


def _extract_tesseract(image_path: str, lang_override: str | None = None) -> dict[str, Any] | None:
    cmd = _tesseract_cmd()
    if not cmd:
        return None
    try:
        import pytesseract
        from PIL import Image

        _ensure_tessdata_env()
        pytesseract.pytesseract.tesseract_cmd = cmd
        img = Image.open(image_path)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        lang = (lang_override or os.environ.get("TESSERACT_LANG", "eng")).strip() or "eng"
        cfg = _tesseract_config()
        kwargs: dict[str, Any] = {"lang": lang}
        if cfg:
            kwargs["config"] = cfg
        full_text = (pytesseract.image_to_string(img, **kwargs) or "").strip()
        d = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, **kwargs)
        boxes: list[dict[str, Any]] = []
        confidences: list[float] = []
        n = len(d.get("text", []))
        for i in range(n):
            t = (d["text"][i] or "").strip()
            if not t:
                continue
            try:
                cf = int(d["conf"][i])
            except (ValueError, TypeError):
                cf = -1
            if cf < 0:
                continue
            x, y, w, h = d["left"][i], d["top"][i], d["width"][i], d["height"][i]
            box = [[float(x), float(y)], [float(x + w), float(y)], [float(x + w), float(y + h)], [float(x), float(y + h)]]
            conf = cf / 100.0
            boxes.append({"box": box, "text": t, "confidence": conf})
            confidences.append(conf)
        if not full_text and boxes:
            full_text = " ".join(b["text"] for b in boxes)
        avg_conf = (sum(confidences) / len(confidences) * 100) if confidences else 0.0
        lines = [ln.strip() for ln in full_text.splitlines() if ln.strip()]
        return {
            "text": full_text,
            "avg_confidence": round(avg_conf, 2),
            "boxes": boxes,
            "line_count": len(lines) if lines else len(boxes),
            "engine": "tesseract",
        }
    except Exception:
        logger.exception("Tesseract OCR failed for %s (cmd=%s lang=%s)", image_path, cmd, os.environ.get("TESSERACT_LANG", "eng"))
        return None


_reader = None
_reader_lang_key: str | None = None


def _easyocr_lang_list(override: list[str] | None = None) -> list[str]:
    if override:
        return [x.strip().lower() for x in override if x.strip()] or ["en"]
    raw = (os.environ.get("EASYOCR_LANGS") or "en").strip()
    if not raw:
        return ["en"]
    langs = [x.strip().lower() for x in raw.split(",") if x.strip()]
    return langs or ["en"]


def _get_reader(override: list[str] | None = None):
    global _reader, _reader_lang_key
    langs = _easyocr_lang_list(override)
    key = ",".join(langs)
    if _reader is None or _reader_lang_key != key:
        import easyocr

        _reader = easyocr.Reader(langs, gpu=False, verbose=False)
        _reader_lang_key = key
    return _reader


def _extract_easyocr(image_path: str, lang_override: list[str] | None = None) -> dict[str, Any]:
    reader = _get_reader(lang_override)
    results = reader.readtext(image_path, detail=1, paragraph=False)
    lines = []
    confidences = []
    boxes = []
    for box, text, conf in results:
        lines.append(text)
        confidences.append(float(conf))
        boxes.append(
            {
                "box": [[float(p[0]), float(p[1])] for p in box],
                "text": text,
                "confidence": float(conf),
            }
        )
    full_text = "\n".join(lines)
    avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
    return {
        "text": full_text,
        "avg_confidence": round(avg_conf * 100, 2),
        "boxes": boxes,
        "line_count": len(lines),
        "engine": "easyocr",
    }


def extract_text(image_path: str, lang: str | None = None) -> dict[str, Any]:
    """Return ``text``, ``engine`` (tesseract | easyocr | none), and optional ``hint`` for operators.

    ``lang`` is one of ``LANG_PRESETS`` keys (``"auto"``, ``"kan"``, ``"hin"``, …). When set
    explicitly, Tesseract uses the matching multi-script lang and EasyOCR uses the matching code list.
    """
    hints: list[str] = []
    code = (lang or "auto").strip().lower()
    preset = LANG_PRESETS.get(code, LANG_PRESETS["auto"])
    tess_override = preset["tesseract"]
    easy_override = preset["easyocr"]
    if code == "auto" and not tess_override:
        # Use every installed Tesseract script in one pass; if kan.traineddata is present, this
        # prevents Kannada pages from being read as garbage English.
        tess_override = _auto_tesseract_lang()
    tess = _extract_tesseract(image_path, lang_override=tess_override)

    if tess is None:
        if not _tesseract_cmd():
            hints.append(
                "Tesseract is not installed or not on PATH. Install the Tesseract binary, add it to PATH, "
                "or set TESSERACT_CMD. Falling back to EasyOCR."
            )
        else:
            hints.append(
                f"Tesseract failed at runtime with lang='{tess_override or os.environ.get('TESSERACT_LANG', 'eng')}'. "
                "Check that the matching .traineddata is installed in tessdata, or try the language picker."
            )
    elif tess is not None and not (tess.get("text") or "").strip():
        hints.append(
            "Tesseract returned empty text — picking another script in the language menu and re-running usually fixes Indic / non-Latin pages."
        )

    tess_text = (tess or {}).get("text") or ""
    tess_conf = float((tess or {}).get("avg_confidence") or 0.0)
    looks_garbage = bool(tess_text.strip()) and (tess_conf < 35.0 or _is_garbage_latin(tess_text))

    if tess and tess_text.strip() and not looks_garbage:
        out: dict[str, Any] = dict(tess)
        out["lang"] = code
        if hints:
            out["hint"] = " ".join(hints)
        return out

    if looks_garbage:
        hints.append(
            f"Tesseract output looked like garbage Latin (avg confidence {tess_conf:.1f}%) — likely a non-Latin script."
            " Trying EasyOCR with broader language coverage."
        )

    try:
        easy = _extract_easyocr(image_path, lang_override=easy_override)
        easy["lang"] = code
        used_langs = easy_override if easy_override else _easyocr_lang_list()
        h = " ".join(hints) if hints else ""
        if h:
            easy["hint"] = f"{h} (EasyOCR fallback; languages: {','.join(used_langs)})."
        else:
            easy["hint"] = (
                f"Using EasyOCR (languages: {','.join(used_langs)}). "
                "Install Tesseract + matching .traineddata for production-grade OCR."
            )
        # When Tesseract did produce text but looks like garbage Latin (Indic doc read with English),
        # prefer EasyOCR even if Tesseract's reported confidence is higher — its number is misleading
        # for content it fundamentally couldn't read. Otherwise keep whichever has higher confidence.
        if tess and tess_text.strip() and not looks_garbage and float(easy.get("avg_confidence") or 0.0) < tess_conf:
            out = dict(tess)
            out["lang"] = code
            out["hint"] = (
                f"{' '.join(hints)} (Tesseract retained — EasyOCR confidence was lower.)" if hints else "Tesseract retained — EasyOCR confidence was lower."
            )
            return out
        return easy
    except Exception:
        logger.exception("EasyOCR failed for %s", image_path)
        if tess:
            out = dict(tess)
            out["lang"] = code
            if hints:
                out["hint"] = " ".join(hints)
            return out
        return {
            "text": "",
            "avg_confidence": 0.0,
            "boxes": [],
            "line_count": 0,
            "engine": "none",
            "lang": code,
            "hint": (" ".join(hints) if hints else "No OCR engine produced text. Install Tesseract and/or fix EasyOCR."),
        }


def diagnose_ocr_environment() -> dict[str, Any]:
    """Public probe for ops UI — Tesseract binary + pytesseract handshake; EasyOCR import."""
    cmd = _tesseract_cmd()
    tess: dict[str, Any] = {"cmd": cmd, "found": bool(cmd)}
    if cmd:
        try:
            import pytesseract

            pytesseract.pytesseract.tesseract_cmd = cmd
            tess["version"] = str(pytesseract.get_tesseract_version())
        except Exception as e:
            tess["runtime_error"] = repr(e)
    easy: dict[str, Any] = {}
    try:
        import easyocr  # noqa: F401

        easy["import_ok"] = True
    except Exception as e:
        easy["import_ok"] = False
        easy["import_error"] = repr(e)
    return {
        "tesseract": tess,
        "easyocr": easy,
        "env": {
            "TESSERACT_LANG": os.environ.get("TESSERACT_LANG"),
            "TESSERACT_CONFIG": os.environ.get("TESSERACT_CONFIG"),
            "EASYOCR_LANGS": os.environ.get("EASYOCR_LANGS"),
        },
    }


def compute_cer(reference: str, hypothesis: str) -> float:
    """Character Error Rate. Reference = corrected (GT), hypothesis = model output."""
    if not reference and not hypothesis:
        return 0.0
    if not reference:
        return 1.0
    try:
        return float(cer(reference, hypothesis))
    except Exception:
        return 0.0
