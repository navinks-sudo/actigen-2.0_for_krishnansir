"""Shared OpenAI-compatible chat client for classification, index tags, and summarization.

Set OPENAI_API_KEY. Optional: OPENAI_BASE_URL (e.g. Azure), OPENAI_MODEL (default gpt-4o-mini).
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


def is_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY", "").strip())


def chat_json(system: str, user: str, max_tokens: int = 1200, temperature: float = 0.2) -> Optional[dict[str, Any]]:
    if not is_configured():
        return None
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=os.environ["OPENAI_API_KEY"].strip(),
            base_url=os.environ.get("OPENAI_BASE_URL") or None,
        )
        resp = client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
            temperature=temperature,
        )
        raw = (resp.choices[0].message.content or "").strip()
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None
