"""Convert uploads (images, full PDF) to PNG page files + initial QS for each."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image, UnidentifiedImageError

from .quality import compute_qs

MAX_PDF_PAGE_DPI = 200


def _pdf_all_pages_to_pngs(data: bytes, out_dir: Path, base_id: str) -> list[Path]:
    doc = fitz.open(stream=data, filetype="pdf")
    paths: list[Path] = []
    try:
        if doc.page_count < 1:
            raise ValueError("PDF has no pages")
        out_dir.mkdir(parents=True, exist_ok=True)
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(dpi=MAX_PDF_PAGE_DPI, alpha=False)
            p = out_dir / f"{base_id}_p{i}.png"
            pix.save(str(p))
            paths.append(p)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Could not render PDF: {e}") from e
    finally:
        doc.close()
    return paths


def _single_image_to_png(data: bytes, out_path: Path) -> None:
    try:
        im = Image.open(BytesIO(data))
    except UnidentifiedImageError as e:
        raise ValueError("File is not a supported image (or is corrupted).") from e
    if getattr(im, "is_animated", False):
        im.seek(0)
    if im.mode in ("RGBA", "P", "LA"):
        rgb = Image.new("RGB", im.size, (255, 255, 255))
        if im.mode == "P":
            im = im.convert("RGBA")
        rgb.paste(im, mask=im.split()[-1] if im.mode in ("RGBA", "LA") else None)
        im = rgb
    elif im.mode != "RGB":
        im = im.convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(out_path, "PNG")


def _try_single_image_to_png(data: bytes, out_path: Path) -> bool:
    try:
        _single_image_to_png(data, out_path)
        return True
    except ValueError:
        return False


def ingest_to_page_pngs(
    file_bytes: bytes,
    original_filename: str,
    out_dir: Path,
    base_id: str,
) -> list[tuple[int, str, float]]:
    """
    Write PNG(s) and return (page_index, absolute_path, initial_qs) for each page.
    PDFs produce one file per page; images produce a single page.
    """
    if not file_bytes:
        raise ValueError("Empty file")

    ext = Path(original_filename or "file").suffix.lower()
    is_pdf_magic = len(file_bytes) >= 4 and file_bytes[:4] == b"%PDF"

    paths: list[Path] = []

    if is_pdf_magic:
        paths = _pdf_all_pages_to_pngs(file_bytes, out_dir, base_id)
    else:
        single = out_dir / f"{base_id}_p0.png"
        if _try_single_image_to_png(file_bytes, single):
            paths = [single]
        elif ext == ".pdf":
            paths = _pdf_all_pages_to_pngs(file_bytes, out_dir, base_id)
        else:
            raise ValueError(
                "Unsupported file. Upload an image (e.g. PNG, JPG, WEBP, TIFF, GIF) or a PDF."
            )

    out: list[tuple[int, str, float]] = []
    for i, p in enumerate(paths):
        qs = float(compute_qs(str(p))["qs"])
        out.append((i, str(p), qs))
    return out
