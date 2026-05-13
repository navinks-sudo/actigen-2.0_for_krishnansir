import os
from pathlib import Path

from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime

from .models import Document
from .services.quality import compute_page_profile, compute_page_profile_post, compute_qs, compute_qs_post

_STORAGE_ROOT = Path(__file__).resolve().parent.parent / "storage"


def _resolve_storage_file(path_str: str | None) -> Optional[str]:
    """Return an absolute path that exists on disk, or None.

    Upload/enhance paths are stored as absolute strings; if the process cwd differs or paths were
    normalized differently, fall back to ``storage/<basename>`` so Post QS can still be computed.
    """
    if not path_str:
        return None
    raw = str(path_str).strip()
    if not raw:
        return None
    candidates: list[str] = [raw]
    try:
        norm = os.path.normpath(raw)
        if norm != raw:
            candidates.append(norm)
    except Exception:
        pass
    for cand in candidates:
        p = Path(cand)
        try:
            if p.is_file():
                return str(p.resolve())
        except OSError:
            continue
    name = Path(raw).name
    if not name:
        return None
    alt = _STORAGE_ROOT / name
    try:
        if alt.is_file():
            return str(alt.resolve())
    except OSError:
        pass
    return None


class PageQsMetrics(BaseModel):
    """Composite QS and weighted inputs (each 0–100); formula in quality.py."""

    qs: float
    sharpness: float
    brightness: float
    contrast: float
    noise: float


class PageImageParams(BaseModel):
    """Raster statistics used together with QS components."""

    width_px: int
    height_px: int
    mean_gray: float
    std_gray: float
    laplacian_variance: float


class DocumentPageOut(BaseModel):
    id: Optional[int] = None
    page_index: int
    image_path: str
    initial_qs: Optional[float] = None
    qs_metrics: Optional[PageQsMetrics] = None
    image_params: Optional[PageImageParams] = None
    enhanced_path: Optional[str] = None
    post_qs: Optional[float] = None
    post_qs_metrics: Optional[PageQsMetrics] = None
    post_image_params: Optional[PageImageParams] = None
    ocr_text: Optional[str] = None
    corrected_ocr_text: Optional[str] = None
    ocr_text_english: Optional[str] = None
    corrected_ocr_text_english: Optional[str] = None
    ocr_boxes: Optional[list[dict[str, Any]]] = None
    page_abstract: Optional[str] = None
    corrected_page_abstract: Optional[str] = None
    page_translation: Optional[str] = None
    page_doc_class: Optional[str] = None
    page_doc_class_scores: Optional[Any] = None
    enhancement_report: Optional[dict[str, Any]] = None

    class Config:
        from_attributes = True


class DocumentPatch(BaseModel):
    """Partial update for QC / SOP defaults."""

    target_qs: Optional[float] = Field(None, ge=80.0, le=100.0, description="Enhancement SOP QS target (default 100)")


class DocumentOut(BaseModel):
    id: int
    filename: str
    original_path: str
    enhanced_path: Optional[str] = None
    initial_qs: Optional[float] = None
    post_qs: Optional[float] = None
    target_qs: float = 100.0
    enhancement_passes: int = 0
    raw_ocr: Optional[str] = None
    corrected_ocr: Optional[str] = None
    ocr_cer: Optional[float] = None
    raw_ocr_english: Optional[str] = None
    corrected_ocr_english: Optional[str] = None
    doc_class: Optional[str] = None
    doc_class_scores: Optional[Any] = None
    index_metadata: Optional[Any] = None
    abstract: Optional[str] = None
    corrected_abstract: Optional[str] = None
    abstract_cer: Optional[float] = None
    overall_abstract: Optional[str] = None
    corrected_overall_abstract: Optional[str] = None
    target_language: str = "es"
    translation: Optional[str] = None
    current_stage: str
    status: str
    created_at: datetime
    updated_at: datetime
    pages: list[DocumentPageOut] = Field(default_factory=list)

    class Config:
        from_attributes = True


def _document_page_out(row: Any) -> DocumentPageOut:
    """ORM DocumentPage or synthetic row — attach computed QS + image stats from disk."""
    img_raw = getattr(row, "image_path", None)
    img_resolved = _resolve_storage_file(str(img_raw) if img_raw else None)
    qs_m_raw, im_raw = compute_page_profile(img_resolved) if img_resolved else (None, None)
    qs_metrics = PageQsMetrics(**qs_m_raw) if qs_m_raw else None
    image_params = PageImageParams(**im_raw) if im_raw else None
    db_iq = getattr(row, "initial_qs", None)
    # Prefer live disk score when the file resolves; otherwise keep persisted upload / pipeline value.
    iq = round(float(qs_m_raw["qs"]), 2) if qs_m_raw else (round(float(db_iq), 2) if db_iq is not None else None)

    enh_path = getattr(row, "enhanced_path", None)
    post_qs_metrics = None
    post_image_params = None
    db_pq = getattr(row, "post_qs", None)
    pq = round(float(db_pq), 2) if db_pq is not None else None
    resolved_enh = _resolve_storage_file(str(enh_path) if enh_path else None)
    if resolved_enh:
        pqs_raw, pim_raw = compute_page_profile_post(resolved_enh)
        if pqs_raw:
            post_qs_metrics = PageQsMetrics(**{k: float(pqs_raw[k]) for k in ("qs", "sharpness", "brightness", "contrast", "noise")})
            pq = round(float(pqs_raw["qs"]), 2)
        elif pq is None:
            qf = compute_qs_post(resolved_enh)
            pq = round(float(qf["qs"]), 2)
        if pim_raw:
            post_image_params = PageImageParams(**{k: pim_raw[k] for k in ("width_px", "height_px", "mean_gray", "std_gray", "laplacian_variance")})

    return DocumentPageOut(
        id=getattr(row, "id", None),
        page_index=row.page_index,
        image_path=row.image_path,
        initial_qs=iq,
        qs_metrics=qs_metrics,
        image_params=image_params,
        enhanced_path=str(enh_path) if enh_path else None,
        post_qs=pq,
        post_qs_metrics=post_qs_metrics,
        post_image_params=post_image_params,
        ocr_text=getattr(row, "ocr_text", None),
        corrected_ocr_text=getattr(row, "corrected_ocr_text", None),
        ocr_text_english=getattr(row, "ocr_text_english", None),
        corrected_ocr_text_english=getattr(row, "corrected_ocr_text_english", None),
        ocr_boxes=getattr(row, "ocr_boxes", None),
        page_abstract=getattr(row, "page_abstract", None),
        corrected_page_abstract=getattr(row, "corrected_page_abstract", None),
        page_translation=getattr(row, "page_translation", None),
        page_doc_class=getattr(row, "page_doc_class", None),
        page_doc_class_scores=getattr(row, "page_doc_class_scores", None),
        enhancement_report=getattr(row, "enhancement_report", None),
    )


def serialize_document(doc: Document, include_pages: bool = True) -> DocumentOut:
    """Build API document from columns only; loads `pages` relationship only when include_pages is True."""
    data = {col.name: getattr(doc, col.name) for col in Document.__table__.columns}
    pages_out: list[DocumentPageOut] = []
    if include_pages:
        rel = getattr(doc, "pages", None)
        if rel:
            ordered = sorted(rel, key=lambda p: p.page_index)
            pages_out = [_document_page_out(p) for p in ordered]
        elif doc.original_path:
            class _Row:
                id = None
                page_index = 0
                image_path = doc.original_path
                initial_qs = doc.initial_qs
                enhanced_path = doc.enhanced_path
                post_qs = doc.post_qs
                ocr_text = None
                corrected_ocr_text = None
                page_abstract = None
                corrected_page_abstract = None
                page_translation = None
                page_doc_class = None
                page_doc_class_scores = None

            pages_out = [_document_page_out(_Row())]

    # Backfill document initial_qs when the column is null but the raster exists (older rows / repair).
    if data.get("initial_qs") is None:
        probe = _resolve_storage_file(data.get("original_path"))
        if not probe and pages_out:
            probe = _resolve_storage_file(pages_out[0].image_path)
        if probe:
            try:
                data["initial_qs"] = round(float(compute_qs(probe)["qs"]), 2)
            except Exception:
                pass

    # When pages are included, document Initial QS must match the gauges (mean of per-page disk scores).
    # DB historically stored page-0 only for multi-page PDFs; recompute from serialized pages.
    if pages_out:
        nums = [float(p.initial_qs) for p in pages_out if p.initial_qs is not None]
        if nums:
            data["initial_qs"] = round(sum(nums) / len(nums), 2)

    return DocumentOut(**data, pages=pages_out)


class TuneEnhancementOut(BaseModel):
    """Manual QC tune response: document plus optional UX hint when QS did not improve."""

    document: DocumentOut
    notice: Optional[str] = None


class ManualTuneIn(BaseModel):
    """UI sliders 0–100; neutral = 50 for most axes; denoise/sharpen default 0 (off)."""

    brightness: float = Field(50, ge=0, le=100)
    contrast: float = Field(50, ge=0, le=100)
    gamma: float = Field(50, ge=0, le=100)
    denoise: float = Field(0, ge=0, le=100)
    sharpen: float = Field(0, ge=0, le=100)
    rotate: float = Field(50, ge=0, le=100)
    clahe: float = Field(50, ge=0, le=100)


class OCRCorrection(BaseModel):
    corrected_text: Optional[str] = None
    corrected_english: Optional[str] = None
    pages_english: Optional[list["OCRPagePatch"]] = None


class OCRPagePatch(BaseModel):
    page_index: int
    corrected_ocr_text_english: str


class OCRTranslateIn(BaseModel):
    source: Optional[str] = "auto"


class ClassCorrection(BaseModel):
    doc_class: str
    """When set, updates classification for this page only (multi-page PDFs)."""
    page_index: Optional[int] = None


class IndexCorrection(BaseModel):
    index_metadata: dict


class AbstractPagePatch(BaseModel):
    page_index: int
    corrected_page_abstract: str


class AbstractCorrection(BaseModel):
    corrected_abstract: Optional[str] = None
    pages: Optional[list[AbstractPagePatch]] = None
    corrected_overall_abstract: Optional[str] = None


class TranslateRequest(BaseModel):
    target_language: str


class ChatMessageIn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequestIn(BaseModel):
    messages: list[ChatMessageIn]
    use_english: Optional[bool] = True  # default to using OCR English text when present


class ChatReplyOut(BaseModel):
    reply: str
    model: str
    used_pages: int
