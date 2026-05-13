"""Abstractor — Gemini → extractive LSA fallback.

Configure ``GEMINI_API_KEY``. With no key set, falls back to Sumy LSA so the pipeline keeps
running, but the output will be less meaningful than the Gemini path.

Default summary length is 3 sentences (terse, decision-focused). The pipeline routes can pass
a different ``sentences`` count if a richer overall summary is needed.
"""
import logging

from sumy.parsers.plaintext import PlaintextParser
from sumy.nlp.tokenizers import Tokenizer
from sumy.summarizers.lsa import LsaSummarizer
from sumy.nlp.stemmers import Stemmer
from sumy.utils import get_stop_words
import nltk

from . import gemini_client

logger = logging.getLogger(__name__)


def _ensure_nltk():
    try:
        nltk.data.find("tokenizers/punkt")
    except LookupError:
        try:
            nltk.download("punkt", quiet=True)
        except Exception:
            pass
    try:
        nltk.data.find("tokenizers/punkt_tab")
    except LookupError:
        try:
            nltk.download("punkt_tab", quiet=True)
        except Exception:
            pass


def _summary_prompt(n: int) -> str:
    """Prompt tuned for *meaningful* short summaries of Mizoram Legislative Assembly OCR text.

    The model is told to capture decisions/outcomes, identify the document, and stay grounded.
    """
    return (
        "You write SHORT, MEANINGFUL summaries of Mizoram Legislative Assembly documents from "
        "noisy OCR text. Reply with JSON only:\n"
        f'{{"summary":"<plain text, EXACTLY {n} sentence{"s" if n != 1 else ""}, no bullets, no headings>"}}\n'
        "What the summary must cover (collapsed into the available sentences):\n"
        " 1. WHAT the document is (e.g. \"Calendar of Sittings for the Sixth Session of the Eighth "
        "Mizoram Legislative Assembly\") and the dates / session / assembly numbers it mentions.\n"
        " 2. The key decisions, business items, motions, or substantive content — not boilerplate.\n"
        " 3. Any named persons (presenters, members, ministers) or referenced subjects.\n"
        "Rules:\n"
        " * Be faithful — no invented facts, names, dates, figures, or claims not in the source.\n"
        " * Fix obvious OCR garbling only when confident; otherwise preserve wording.\n"
        " * Skip filler like \"this document is about\". Lead with the substance.\n"
        " * Output the JSON object only — no surrounding prose, no code fences."
    )


def _summarize_gemini(text: str, sentences: int) -> str:
    if not gemini_client.is_configured():
        return ""
    snippet = (text or "").strip()[:18000]
    if not snippet:
        return ""
    n = max(1, min(8, sentences))
    system = _summary_prompt(n)
    data = gemini_client.chat_json(system, snippet, max_tokens=1200)
    if not data:
        return ""
    s = data.get("summary")
    return s.strip() if isinstance(s, str) else ""


def summarize(text: str, sentences: int = 3) -> str:
    if not text or not text.strip():
        return ""
    out = _summarize_gemini(text, sentences)
    if out:
        return out
    _ensure_nltk()
    try:
        parser = PlaintextParser.from_string(text, Tokenizer("english"))
        stemmer = Stemmer("english")
        summarizer = LsaSummarizer(stemmer)
        summarizer.stop_words = get_stop_words("english")
        result = summarizer(parser.document, sentences)
        return " ".join(str(s) for s in result)
    except Exception:
        parts = [s.strip() for s in text.replace("\n", " ").split(".") if s.strip()]
        return ". ".join(parts[:sentences]) + ("." if parts else "")
