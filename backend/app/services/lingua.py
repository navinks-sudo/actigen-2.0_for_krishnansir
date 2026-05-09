"""Lingua AI — translation via deep-translator (Google free endpoint)."""

from deep_translator import GoogleTranslator

# Major world languages (non-Indic overlap avoided where Indic block defines the code).
_WORLD = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh-CN": "Chinese (Simplified)",
    "ar": "Arabic",
    "ja": "Japanese",
    "ko": "Korean",
    "pt": "Portuguese",
    "ru": "Russian",
    "it": "Italian",
}

# Indian / South Asian languages whose codes appear in deep_translator GoogleTranslator.
# (Santali, Bodo, Kashmiri, etc. are omitted when not offered by that endpoint.)
_INDIC = {
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "ur": "Urdu",
    "or": "Odia (Oriya)",
    "as": "Assamese",
    "ne": "Nepali",
    "si": "Sinhala",
    "sd": "Sindhi",
    "sa": "Sanskrit",
    "gom": "Konkani",
    "mai": "Maithili",
    "mni-Mtei": "Meiteilon (Manipuri)",
    "doi": "Dogri",
}

_MERGED = {**_WORLD, **_INDIC}
SUPPORTED = dict(sorted(_MERGED.items(), key=lambda kv: (kv[1].lower(), kv[0])))


def translate(text: str, target: str = "hi", source: str = "auto") -> str:
    if not text or not text.strip():
        return ""
    if target not in SUPPORTED:
        target = "hi"
    try:
        chunks = []
        for i in range(0, len(text), 4500):
            piece = text[i : i + 4500]
            chunks.append(GoogleTranslator(source=source, target=target).translate(piece))
        return "".join(chunks)
    except Exception as e:
        return f"[translation unavailable: {e}]"
