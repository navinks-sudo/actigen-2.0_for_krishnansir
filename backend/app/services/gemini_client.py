"""Gemini (Google Generative Language) client used by the Abstractor.

Set ``GEMINI_API_KEY`` to enable. Optional ``GEMINI_MODEL`` (default ``gemini-1.5-flash``).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
_API_BASE = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")


def is_configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def _model() -> str:
    return os.environ.get("GEMINI_MODEL", _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def _post_json(url: str, payload: dict[str, Any], timeout: float = 60.0) -> Optional[dict[str, Any]]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = ""
        logger.warning("Gemini HTTP %s: %s", e.code, err_body[:500])
        return None
    except Exception as e:
        logger.warning("Gemini request failed: %r", e)
        return None


def _extract_text(resp: dict[str, Any]) -> str:
    """Pull the first candidate's first text part."""
    if not isinstance(resp, dict):
        return ""
    candidates = resp.get("candidates") or []
    for cand in candidates:
        content = (cand or {}).get("content") or {}
        for part in content.get("parts", []) or []:
            t = part.get("text")
            if isinstance(t, str) and t.strip():
                return t.strip()
    return ""


def chat_text(
    system: str,
    user: str,
    *,
    max_tokens: int = 1400,
    temperature: float = 0.2,
) -> Optional[str]:
    """Plain-text completion. Returns the model's text or None on failure."""
    if not is_configured():
        return None
    key = os.environ["GEMINI_API_KEY"].strip()
    url = f"{_API_BASE}/models/{_model()}:generateContent?key={key}"
    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": float(temperature),
            "maxOutputTokens": int(max_tokens),
        },
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    data = _post_json(url, payload)
    if not data:
        return None
    return _extract_text(data) or None


def chat_multi(
    messages: list[dict[str, str]],
    *,
    system: str = "",
    max_tokens: int = 1024,
    temperature: float = 0.4,
) -> Optional[str]:
    """Multi-turn chat. ``messages`` is OpenAI-style: ``[{"role":"user|assistant","content":"..."}]``.

    Returns the assistant's text reply or None on failure. Roles are mapped to Gemini's
    ``user`` / ``model``; consecutive same-role turns are merged so the API stays happy.
    """
    if not is_configured():
        return None
    contents: list[dict[str, Any]] = []
    for msg in messages:
        role = (msg.get("role") or "").lower()
        gemini_role = "model" if role in ("assistant", "model") else "user"
        text = (msg.get("content") or "").strip()
        if not text:
            continue
        if contents and contents[-1]["role"] == gemini_role:
            contents[-1]["parts"].append({"text": text})
        else:
            contents.append({"role": gemini_role, "parts": [{"text": text}]})
    if not contents:
        return None
    key = os.environ["GEMINI_API_KEY"].strip()
    url = f"{_API_BASE}/models/{_model()}:generateContent?key={key}"
    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": float(temperature),
            "maxOutputTokens": int(max_tokens),
        },
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    data = _post_json(url, payload)
    if not data:
        return None
    return _extract_text(data) or None


def chat_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 1400,
    temperature: float = 0.2,
) -> Optional[dict[str, Any]]:
    """JSON-mode completion. Adds ``responseMimeType: application/json`` and parses the result."""
    if not is_configured():
        return None
    key = os.environ["GEMINI_API_KEY"].strip()
    url = f"{_API_BASE}/models/{_model()}:generateContent?key={key}"
    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": float(temperature),
            "maxOutputTokens": int(max_tokens),
            "responseMimeType": "application/json",
        },
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    data = _post_json(url, payload)
    if not data:
        return None
    raw = _extract_text(data)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Some Gemini responses wrap JSON in code fences despite the response_mime_type hint.
        s = raw.strip()
        if s.startswith("```"):
            s = s.strip("`").strip()
            if s.lower().startswith("json"):
                s = s[4:].strip()
        try:
            return json.loads(s)
        except Exception:
            return None
