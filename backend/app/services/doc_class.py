"""Document classification from OCR text — LLM when configured, else TF-IDF + keyword fusion.

Classification always runs on the same text used downstream: **corrected_ocr** if the user
edited Text IQ, otherwise **raw_ocr**. No image-only classification.
"""
import re
from typing import Any, Optional

import numpy as np

from . import gemini_client
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def _llm_chat_json(system: str, user: str, *, max_tokens: int = 800):
    """Gemini-only JSON call. Returns None when GEMINI_API_KEY is not set or the call fails."""
    if not gemini_client.is_configured():
        return None
    return gemini_client.chat_json(system, user, max_tokens=max_tokens)


def _any_llm_configured() -> bool:
    return gemini_client.is_configured()

# Mizoram Legislative Assembly document taxonomy. Index Genius has a strict per-class form schema
# matching this list (see services/index_genius.py: CLASS_INDEX_SCHEMA).
CLASS_PROTOTYPES: dict[str, str] = {
    "Gazette": (
        "gazette mizoram government extraordinary general zoram hriattima volume vol no notification "
        "published authority part section ordinance rule regulation issue weekly daily public notice "
        "proclamation appointment transfer department ministry"
    ),
    "Proceedings": (
        "proceedings legislative assembly session house mr speaker hon ble member chair sitting debate "
        "question hour zero hour matter raised verbatim record official report shri smt government "
        "opposition bench reply minister"
    ),
    "Budget Speech": (
        "budget speech finance minister presenting estimates revenue expenditure capital plan annual "
        "fiscal year deficit grants appropriation tax proposal scheme allocation outlay direct indirect "
        "treasury vote on account"
    ),
    "Bulletin": (
        "bulletin part i ii iii summary day proceedings business transacted notice committee meeting "
        "publication legislative assembly secretary ordered printed reference daily"
    ),
    "Calendar": (
        "calendar of sittings session legislative assembly programme schedule dates from to monday "
        "tuesday wednesday thursday friday saturday holiday recess working days roster"
    ),
    "List Of Business": (
        "list of business friday monday tuesday wednesday thursday assembly session presentation papers "
        "questions oral written motion bill resolution adjournment introduction obituary statement "
        "presentation of budget"
    ),
    "List Of Questions": (
        "list of questions starred unstarred member asked answered ministry will the minister be pleased "
        "to state shri smt question no department answer reply assembly session"
    ),
    "Government Bill": (
        "the following bill is hereby introduced government bill be it enacted by the legislature short "
        "title commencement extent definitions chapter clause section schedule statement of objects and "
        "reasons financial memorandum"
    ),
    "Governor Speech": (
        "address by governor honourable members joint session legislative assembly state policies "
        "achievements priorities welfare development infrastructure good governance my government "
        "address pursuant article state of the state"
    ),
    "Election": (
        "election candidate name nomination polling booth constituency returning officer chief electoral "
        "officer commission result winner runner up votes polled valid invalid affidavit symbol party"
    ),
    "Resolutions": (
        "this house resolves whereas now therefore be it resolved private member government resolution "
        "subject matter mover seconder discussion adoption ayes noes division strangers gallery laid "
        "before"
    ),
    "Private Member Bill": (
        "private member bill the overseas workers welfare amendment short title objects and reasons "
        "memorandum delegated legislation by member of legislative assembly"
    ),
}

# High-signal phrases / tokens for intent fusion (OCR-tolerant short strings).
CLASS_KEYWORD_HINTS: dict[str, list[str]] = {
    "Gazette": [
        "gazette",
        "extraordinary",
        "zoram hriattima",
        "published by authority",
        "vol",
        "no.",
        "part ii",
    ],
    "Proceedings": [
        "proceedings",
        "verbatim",
        "official report",
        "mr. speaker",
        "hon'ble member",
        "the assembly",
        "question hour",
    ],
    "Budget Speech": [
        "budget speech",
        "presenting the budget",
        "annual financial",
        "estimates",
        "honourable members",
        "fiscal year",
    ],
    "Bulletin": [
        "bulletin",
        "part - i",
        "part - ii",
        "part - iii",
        "bulletin part",
        "summary of day's proceedings",
    ],
    "Calendar": [
        "calendar of sittings",
        "calendar",
        "programme of session",
        "dates of sittings",
    ],
    "List Of Business": [
        "list of business",
        "presentation of papers",
        "presentation of budget",
        "obituary reference",
        "questions and answers",
    ],
    "List Of Questions": [
        "list of questions",
        "starred question",
        "unstarred question",
        "will the minister be pleased",
        "question no.",
    ],
    "Government Bill": [
        "government bill",
        "be it enacted",
        "the following bill",
        "short title and commencement",
        "objects and reasons",
    ],
    "Governor Speech": [
        "address by the governor",
        "governor's address",
        "honourable members",
        "my government",
        "joint session",
    ],
    "Election": [
        "election commission",
        "returning officer",
        "polling station",
        "candidate",
        "constituency",
        "votes polled",
    ],
    "Resolutions": [
        "resolution",
        "this house resolves",
        "private member's resolution",
        "government resolution",
        "be it resolved",
    ],
    "Private Member Bill": [
        "private member's bill",
        "private member bill",
        "introduced by",
        "the overseas workers",
        "welfare bill",
    ],
}

# How much keyword-intent influences the final blend vs pure TF-IDF similarity (0–1).
KEYWORD_FUSION_WEIGHT = 0.32

# Max characters fed to the vectorizer (very long OCR: keep head + tail for bills/reports).
MAX_CLASSIFY_CHARS = 100_000


def _prepare_ocr_text(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(r"\s+", " ", t)
    low = t.lower()
    if len(low) <= MAX_CLASSIFY_CHARS:
        return low
    half = MAX_CLASSIFY_CHARS // 2
    return (low[:half] + " " + low[-half:]).strip()


def _keyword_intent_vector(low_text: str, classes: list[str]) -> np.ndarray:
    """Per-class score in [0, 1] from how many intent phrases appear in OCR text."""
    vec = np.zeros(len(classes), dtype=np.float64)
    for i, c in enumerate(classes):
        hints = CLASS_KEYWORD_HINTS.get(c, [])
        if not hints:
            continue
        hits = sum(1 for h in hints if h.lower() in low_text)
        vec[i] = min(1.0, hits / max(4.0, len(hints) * 0.35))
    return vec


def _classify_tfidf(text: str) -> dict[str, Any]:
    low = _prepare_ocr_text(text)
    if not low:
        return {"top": "Unknown", "scores": {}}

    classes = list(CLASS_PROTOTYPES.keys())
    docs = [CLASS_PROTOTYPES[c] for c in classes] + [low]

    try:
        vec = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            sublinear_tf=True,
            max_df=0.98,
        )
        m = vec.fit_transform(docs)
        sims = cosine_similarity(m[-1], m[:-1]).flatten().astype(np.float64)
    except ValueError:
        return {"top": "Unknown", "scores": {}}

    kw = _keyword_intent_vector(low, classes)
    w = KEYWORD_FUSION_WEIGHT
    combined = (1.0 - w) * sims + w * kw
    combined = np.maximum(combined, 0.0)

    if combined.sum() == 0:
        return {"top": "Unknown", "scores": {c: 0.0 for c in classes}}

    # Sharpen the distribution so the top class actually stands out. Center on the max and use
    # a high temperature so a clear leader gets ≥40% while the tail compresses below ~10% each.
    centered = combined - combined.max()
    exp = np.exp(centered * 14.0)
    probs = exp / exp.sum()
    scores = {c: round(float(p) * 100, 2) for c, p in zip(classes, probs)}
    top = max(scores, key=scores.get)
    return {"top": top, "scores": scores}


def _normalize_llm_scores(raw: Any, classes: list[str]) -> Optional[dict[str, float]]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        out: dict[str, float] = {}
        for c in classes:
            v = raw.get(c)
            if v is None:
                continue
            try:
                out[c] = round(float(v), 2)
            except (TypeError, ValueError):
                continue
        return out if out else None
    return None


def _classify_llm(text: str) -> Optional[dict[str, Any]]:
    if not _any_llm_configured():
        return None
    classes = list(CLASS_PROTOTYPES.keys())
    snippet = (text or "").strip()
    if not snippet:
        return None
    snippet = snippet[:12000]
    system = (
        "You classify a Mizoram Legislative Assembly document from OCR text. Pick the SINGLE best class "
        "and assign confidence percentages to every class. Reply with JSON only:\n"
        '{"top":"<exact class name from the allowed list>","scores":{<class>:<number 0-100>}}\n'
        "Rules:\n"
        " * Be decisive — the top class should have ≥60 confidence when the document clearly fits, "
        "leaving the rest below 30. Avoid flat near-uniform distributions.\n"
        " * Use exact spelling/casing for class names.\n"
        " * If genuinely ambiguous, you may set top to 'Unknown' but still return scores."
    )
    user = "Allowed classes (use exact spelling):\n" + "\n".join(f"- {c}" for c in classes) + f"\n\nOCR:\n{snippet}"
    data = _llm_chat_json(system, user, max_tokens=800)
    if not data:
        return None
    top = data.get("top")
    if not isinstance(top, str):
        return None
    top = top.strip()
    if top not in classes and top != "Unknown":
        alias = next((c for c in classes if c.lower() == top.lower()), None)
        top = alias or "Unknown"
    scores = _normalize_llm_scores(data.get("scores"), classes)
    if not scores:
        if top in classes:
            scores = {c: (100.0 if c == top else 0.0) for c in classes}
        else:
            return None
    if top == "Unknown" or top not in classes:
        top = max(scores, key=scores.get)
    return {"top": top, "scores": scores, "source": "llm"}


def classify(text: str) -> dict[str, Any]:
    llm_out = _classify_llm(text)
    if llm_out:
        return {"top": llm_out["top"], "scores": llm_out["scores"]}
    return _classify_tfidf(text)
