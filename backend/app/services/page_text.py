"""Join/split full-document text that contains `=== PAGE N ===` markers (1-based page numbers)."""
import re
from typing import Optional

_PAGE_HDR = re.compile(r"^=== PAGE (\d+) ===\s*$", re.MULTILINE)


def join_marked_pages(parts: list[tuple[int, str]]) -> str:
    """``parts`` are (page_index 0-based, body). Produces a single string for Text IQ / summaries."""
    blocks = []
    for idx, body in sorted(parts, key=lambda x: x[0]):
        blocks.append(f"=== PAGE {idx + 1} ===\n{(body or '').strip()}")
    return "\n\n".join(blocks)


def split_marked_pages(full: str) -> dict[int, str]:
    """Returns ``page_index`` (0-based) -> body. If no markers, entire string is page 0."""
    if not full or not full.strip():
        return {}
    matches = list(_PAGE_HDR.finditer(full))
    if not matches:
        return {0: full.strip()}
    out: dict[int, str] = {}
    for i, m in enumerate(matches):
        page_num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full)
        body = full[start:end].strip()
        out[page_num - 1] = body
    return out


def merge_split_into_optional_base(split: dict[int, str], n_pages: int) -> list[str]:
    """Return list of length ``n_pages`` with text per index, default empty string."""
    return [split.get(i, "").strip() for i in range(n_pages)]
