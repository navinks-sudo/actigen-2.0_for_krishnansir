"""Index Genius — class-aware metadata extraction.

For documents the classifier tagged with one of the assembly-specific classes (Gazette, Proceedings,
Budget Speech, Bulletin, Calendar, List Of Business, List Of Questions, Government Bill, Governor
Speech, Election, Resolutions, Private Member Bill), the LLM is prompted with the *exact* schema for
that class and must reply with those keys only. Generic regex extractions (emails / dates / etc.) are
still attached for completeness but the operator-facing form keys come from the per-class schema.
"""
import re
from typing import Any, Optional

from dateutil import parser as dateparser

from . import gemini_client, llm_client


def _llm_chat_json(system: str, user: str, *, max_tokens: int = 900) -> dict[str, Any] | None:
    """Try Gemini first, then OpenAI. Returns None if neither is configured / both fail."""
    if gemini_client.is_configured():
        out = gemini_client.chat_json(system, user, max_tokens=max_tokens)
        if out is not None:
            return out
    if llm_client.is_configured():
        return llm_client.chat_json(system, user, max_tokens=max_tokens)
    return None


def _any_llm_configured() -> bool:
    return gemini_client.is_configured() or llm_client.is_configured()

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[\s.-]?)?\(?\d{3,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}")
URL_RE = re.compile(r"https?://[^\s<>\"]+")
MONEY_RE = re.compile(r"(?:USD|EUR|GBP|INR|\$|€|£|₹)\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?", re.I)
DATE_RE = re.compile(
    r"\b(?:"
    r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
    r"\d{4}[/-]\d{1,2}[/-]\d{1,2}|"
    # day-of-month before month (e.g. "25th January, 2023" or "25 January 2023")
    r"\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{2,4}|"
    # month before day (e.g. "January 25, 2023")
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}"
    r")\b",
    re.I,
)
ID_RE = re.compile(r"\b(?:INV|PO|REF|ID|NO|#)[\s:#-]*([A-Z0-9-]{4,})\b", re.I)
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")

# Ordinal words → integers. Used for "EIGHTH Legislative Assembly" / "(ELEVENTH Session)" style text.
_ORDINAL_WORDS: dict[str, int] = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
    "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19, "twentieth": 20,
    "twenty-first": 21, "twenty first": 21, "twenty-second": 22, "twenty second": 22,
    "twenty-third": 23, "twenty third": 23, "twenty-fourth": 24, "twenty fourth": 24,
    "twenty-fifth": 25, "twenty fifth": 25,
}
_ORDINAL_WORDS_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(_ORDINAL_WORDS, key=len, reverse=True)) + r")\b",
    re.I,
)

ASSEMBLY_DIGIT_RE = re.compile(r"\b(\d{1,3})(?:st|nd|rd|th)?\s+(?:Legislative\s+)?Assembly\b", re.I)
SESSION_DIGIT_RE = re.compile(
    r"\bSession[-\s]*(\d{1,3})\b|\b(\d{1,3})(?:st|nd|rd|th)?\s+Session\b",
    re.I,
)
ASSEMBLY_WORD_RE = re.compile(
    r"\b([A-Za-z\- ]+?)\s+(?:Legislative\s+)?Assembly\b",
    re.I,
)
SESSION_WORD_RE = re.compile(r"\(?\s*([A-Za-z\- ]+?)\s+Session\s*\)?", re.I)
PART_RE = re.compile(r"\bPart\s*-?\s*(I{1,3}|IV|V|1|2|3)\b", re.I)


def _word_to_int(token: str) -> int | None:
    if not token:
        return None
    t = token.strip().lower()
    if t in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[t]
    # Try last word in a phrase like "the eighth"
    last = t.split()[-1] if t else ""
    if last in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[last]
    return None


# Per-class form schema. Each field: name, type, options? (for select / date / text / year).
CLASS_INDEX_SCHEMA: dict[str, list[dict[str, Any]]] = {
    "Gazette": [
        {"name": "Type", "type": "text", "options": ["General", "Extra Ordinary", "Zoram Hriattima"]},
        {"name": "Gazette Vol", "type": "text"},
        {"name": "Gazette No", "type": "text"},
        {"name": "Date", "type": "date"},
    ],
    "Proceedings": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
        {"name": "Date", "type": "date"},
        {"name": "Language", "type": "text", "options": ["English", "Hindi"]},
    ],
    "Budget Speech": [
        {"name": "Presenter", "type": "text"},
        {"name": "Date", "type": "date"},
        {"name": "Language", "type": "text", "options": ["English", "Hindi"]},
    ],
    "Bulletin": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
        {"name": "Bulletin Parts", "type": "text", "options": ["Bulletin Part I", "Bulletin Part II", "Bulletin Part III"]},
    ],
    "Calendar": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
    ],
    "List Of Business": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
        {"name": "Date", "type": "date"},
    ],
    "List Of Questions": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
        {"name": "Date", "type": "date"},
    ],
    "Government Bill": [
        {"name": "Title", "type": "text"},
        {"name": "Year", "type": "year"},
    ],
    "Governor Speech": [
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Session", "type": "text", "options": ["Session 1", "Session 2", "Session 3"]},
        {"name": "Date", "type": "date"},
    ],
    "Election": [
        {"name": "Candidate Name", "type": "text"},
    ],
    "Resolutions": [
        {"name": "Subject", "type": "text"},
        {"name": "Type Beat", "type": "text", "options": ["Private", "Government"]},
        {"name": "Year", "type": "year"},
        {"name": "Assembly", "type": "text", "options": ["1", "2", "3"]},
        {"name": "Member Name", "type": "text"},
        {"name": "Date", "type": "date"},
    ],
    "Private Member Bill": [
        {"name": "Title", "type": "text"},
        {"name": "Member Name", "type": "text"},
        {"name": "Year", "type": "year"},
    ],
}


def class_index_schema_public() -> dict[str, list[dict[str, Any]]]:
    """Schema list for the UI form-builder (read by GET /api/pipeline/index/schema)."""
    return CLASS_INDEX_SCHEMA


def _norm_dates(matches):
    out = []
    for m in matches:
        try:
            d = dateparser.parse(m, fuzzy=True)
            out.append({"raw": m, "iso": d.date().isoformat()})
        except Exception:
            out.append({"raw": m, "iso": None})
    return out


def _llm_metatags(snippet: str) -> dict[str, Any] | None:
    if not _any_llm_configured() or not snippet.strip():
        return None
    system = (
        "From OCR text, suggest search/index metatags. Reply JSON only with keys: "
        '"topics" (array of short strings, 5-12 items), '
        '"entities" (array of {name,type} type one of person,org,location,product,date_other), '
        '"suggested_keywords" (array of 6-15 concise keywords or key phrases). '
        "Use the same language mix as the OCR (English or other)."
    )
    data = _llm_chat_json(system, snippet[:16000], max_tokens=900)
    if not data or not isinstance(data, dict):
        return None
    out: dict[str, Any] = {}
    for key in ("topics", "entities", "suggested_keywords"):
        v = data.get(key)
        if isinstance(v, list):
            out[key] = v
    return out or None


def _select_match(value: Any, options: list[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    for opt in options:
        if s.lower() == opt.lower():
            return opt
    # Loose contains for ordinals like "1st" matching option "1".
    digits = "".join(ch for ch in s if ch.isdigit())
    if digits:
        for opt in options:
            opt_digits = "".join(ch for ch in opt if ch.isdigit())
            if opt_digits and opt_digits == digits:
                return opt
    # Roman numeral / part style fallback
    roman_map = {"i": "I", "ii": "II", "iii": "III"}
    low = s.lower().replace("part", "").strip().strip("- ")
    for opt in options:
        if low and (low in opt.lower() or roman_map.get(low, "").lower() in opt.lower().replace("bulletin part ", "")):
            return opt
    return None


def _coerce_date(value: Any) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return dateparser.parse(s, fuzzy=True).date().isoformat()
    except Exception:
        return None


def _coerce_year(value: Any) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    m = YEAR_RE.search(s)
    return m.group(0) if m else None


def _coerce_field(value: Any, field: dict[str, Any]) -> Any:
    t = field.get("type")
    if t == "select":
        return _select_match(value, field.get("options", []) or [])
    if t == "date":
        return _coerce_date(value)
    if t == "year":
        return _coerce_year(value)
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _llm_class_fields(text: str, doc_class: str, schema: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not _any_llm_configured() or not text.strip():
        return None

    field_lines: list[str] = []
    for f in schema:
        name = f["name"]
        if f["type"] == "select":
            opts = ", ".join(f'"{o}"' for o in f.get("options", []))
            field_lines.append(f'  "{name}": one of [{opts}] or null')
        elif f["type"] == "date":
            field_lines.append(f'  "{name}": ISO date YYYY-MM-DD (string) or null')
        elif f["type"] == "year":
            field_lines.append(f'  "{name}": 4-digit year (string) or null')
        else:
            field_lines.append(f'  "{name}": short string or null')
    body = "{\n" + ",\n".join(field_lines) + "\n}"

    system = (
        f"You extract STRUCTURED metadata for a Mizoram Legislative Assembly document classified as "
        f"\"{doc_class}\". Reply JSON ONLY with EXACTLY these keys (no extras, no missing):\n"
        f"{body}\n"
        "Rules:\n"
        " * Use null when the value is not clearly stated in the text. Never invent.\n"
        " * For 'select' keys, return EXACTLY one of the listed options or null.\n"
        " * For 'Assembly': return the digit only ('1' / '2' / '3').\n"
        " * For 'Session': return 'Session N' (e.g. 'Session 1').\n"
        " * Date fields must be valid ISO date strings (YYYY-MM-DD).\n"
        " * Year fields are 4-digit strings (e.g. '2025').\n"
        " * Person / title strings: copy as written; trim surrounding whitespace."
    )
    user = f"OCR text (English when available; original script otherwise):\n\n{text[:16000]}"
    data = llm_client.chat_json(system, user, max_tokens=600)
    if not data or not isinstance(data, dict):
        return None

    out: dict[str, Any] = {}
    for f in schema:
        v = data.get(f["name"])
        coerced = _coerce_field(v, f)
        if coerced is not None:
            out[f["name"]] = coerced
    return out or None


def _find_assembly_number(head: str) -> int | None:
    m = ASSEMBLY_DIGIT_RE.search(head)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    # Word form: take whatever word(s) sit immediately before "Assembly".
    for m in ASSEMBLY_WORD_RE.finditer(head):
        phrase = m.group(1).strip()
        # Drop common adjectives that precede the ordinal word.
        cleaned = re.sub(r"\b(the|hon\.?ble|honourable|honorable|of|state|mizoram|legislative)\b", " ", phrase, flags=re.I)
        n = _word_to_int(cleaned)
        if n is not None:
            return n
    return None


def _find_session_number(head: str) -> int | None:
    m = SESSION_DIGIT_RE.search(head)
    if m:
        token = m.group(1) or m.group(2)
        if token:
            try:
                return int(token)
            except ValueError:
                pass
    for m in SESSION_WORD_RE.finditer(head):
        phrase = m.group(1).strip()
        cleaned = re.sub(r"\b(the|of|hon\.?ble|honourable|honorable)\b", " ", phrase, flags=re.I)
        n = _word_to_int(cleaned)
        if n is not None:
            return n
    return None


def _heuristic_class_fields(text: str, schema: list[dict[str, Any]]) -> dict[str, Any]:
    """Best-effort regex-only extraction when no LLM is configured. Operator can override."""
    out: dict[str, Any] = {}
    if not text:
        return out
    head = text[:8000]
    asm_num: int | None = None
    sess_num: int | None = None
    for f in schema:
        name = f["name"]
        if name == "Date":
            m = DATE_RE.search(head)
            if m:
                v = _coerce_date(m.group(0))
                if v:
                    out[name] = v
        elif name == "Year":
            m = YEAR_RE.search(head)
            if m:
                out[name] = m.group(0)
        elif name == "Assembly":
            asm_num = asm_num if asm_num is not None else _find_assembly_number(head)
            if asm_num is not None:
                out[name] = str(asm_num)
        elif name == "Session":
            sess_num = sess_num if sess_num is not None else _find_session_number(head)
            if sess_num is not None:
                out[name] = f"Session {sess_num}"
        elif name == "Bulletin Parts":
            m = PART_RE.search(head)
            if m:
                token = m.group(1).upper()
                roman = {"1": "I", "2": "II", "3": "III"}.get(token, token)
                out[name] = f"Bulletin Part {roman}"
        # Title / Subject / Names left blank — operator fills via the form.
    return out


def extract_class_metadata(text: str, doc_class: Optional[str]) -> Optional[dict[str, Any]]:
    """Return the class-specific metadata dict (keys = schema field names). None when no schema."""
    if not doc_class or doc_class not in CLASS_INDEX_SCHEMA:
        return None
    schema = CLASS_INDEX_SCHEMA[doc_class]
    out = _llm_class_fields(text, doc_class, schema)
    if out:
        return out
    return _heuristic_class_fields(text, schema)


def extract_metadata(text: str, doc_class: Optional[str] = None) -> dict:
    empty = {
        "emails": [],
        "phones": [],
        "urls": [],
        "amounts": [],
        "dates": [],
        "identifiers": [],
        "keywords": [],
    }
    if not text:
        if doc_class:
            empty["doc_class"] = doc_class
            empty["class_fields"] = {}
            empty["class_schema"] = CLASS_INDEX_SCHEMA.get(doc_class, [])
        return empty

    emails = list(set(EMAIL_RE.findall(text)))
    phones = list(set(PHONE_RE.findall(text)))
    urls = list(set(URL_RE.findall(text)))
    amounts = list(set(MONEY_RE.findall(text)))
    dates = _norm_dates(list(set(DATE_RE.findall(text))))
    identifiers = list(set(ID_RE.findall(text)))

    tokens = re.findall(r"\b[A-Z][a-zA-Z]{3,}\b", text)
    freq: dict[str, int] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1
    keywords = [k for k, _ in sorted(freq.items(), key=lambda x: -x[1])[:8]]

    base: dict[str, Any] = {
        "emails": emails,
        "phones": phones,
        "urls": urls,
        "amounts": amounts,
        "dates": dates,
        "identifiers": identifiers,
        "keywords": keywords,
    }

    if doc_class and doc_class in CLASS_INDEX_SCHEMA:
        base["doc_class"] = doc_class
        base["class_schema"] = CLASS_INDEX_SCHEMA[doc_class]
        cls_fields = extract_class_metadata(text, doc_class) or {}
        base["class_fields"] = cls_fields

    llm = _llm_metatags(text)
    if llm:
        base["llm_metatags"] = llm
        sk = llm.get("suggested_keywords")
        if isinstance(sk, list) and sk:
            merged = list(dict.fromkeys(keywords + [str(x) for x in sk if x]))[:20]
            base["keywords"] = merged[:16]
    return base
