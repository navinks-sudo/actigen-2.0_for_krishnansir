"""Abstractor — Gemini → OpenAI → extractive LSA, in that order.

Configure ``GEMINI_API_KEY`` (preferred) or ``OPENAI_API_KEY``. With no LLM key, falls back to LSA.
"""
import logging

from sumy.parsers.plaintext import PlaintextParser
from sumy.nlp.tokenizers import Tokenizer
from sumy.summarizers.lsa import LsaSummarizer
from sumy.nlp.stemmers import Stemmer
from sumy.utils import get_stop_words
import nltk

from . import llm_client, gemini_client

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


def _summary_prompt(n: int) -> tuple[str, str]:
    system = (
        "You summarize noisy OCR text for a human reader. Reply with JSON only:\n"
        f'{{"summary":"<plain text, {n} short sentences, every important detail covered, no bullet list unless essential>"}}\n'
        "Rules:\n"
        " * Fix obvious OCR garbling only when confident; otherwise preserve wording.\n"
        " * Stay faithful — no invented facts, names, dates, or figures.\n"
        " * Output the JSON object only — no surrounding prose, no code fences."
    )
    return system, ""


def _summarize_gemini(text: str, sentences: int) -> str:
    if not gemini_client.is_configured():
        return ""
    snippet = (text or "").strip()[:18000]
    if not snippet:
        return ""
    n = max(1, min(14, sentences))
    system, _ = _summary_prompt(n)
    data = gemini_client.chat_json(system, snippet, max_tokens=1400)
    if not data:
        return ""
    s = data.get("summary")
    return s.strip() if isinstance(s, str) else ""


def _summarize_openai(text: str, sentences: int) -> str:
    if not llm_client.is_configured():
        return ""
    snippet = (text or "").strip()[:18000]
    if not snippet:
        return ""
    n = max(1, min(14, sentences))
    system, _ = _summary_prompt(n)
    data = llm_client.chat_json(system, snippet, max_tokens=1400)
    if not data:
        return ""
    s = data.get("summary")
    return s.strip() if isinstance(s, str) else ""


def summarize(text: str, sentences: int = 6) -> str:
    if not text or not text.strip():
        return ""
    # Prefer Gemini → OpenAI → LSA.
    out = _summarize_gemini(text, sentences)
    if out:
        return out
    out = _summarize_openai(text, sentences)
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
