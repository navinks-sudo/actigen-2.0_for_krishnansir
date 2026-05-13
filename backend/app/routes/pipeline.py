"""Pipeline orchestration: run each stage on a document."""
import json
import shutil

import cv2
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from pathlib import Path
from datetime import datetime
from typing import Any

from ..db import get_db
from ..models import Document, DocumentPage, StageRun, User
from .auth import current_user
from ..schemas import (
    DocumentOut,
    OCRCorrection,
    ClassCorrection,
    IndexCorrection,
    AbstractCorrection,
    TranslateRequest,
    ManualTuneIn,
    TuneEnhancementOut,
    OCRTranslateIn,
    ChatRequestIn,
    ChatReplyOut,
    serialize_document,
    _resolve_storage_file,
)
from ..services import enhancement, ocr, doc_class, index_genius, abstractor, lingua, gemini_client
from ..services.pipeline_config import (
    AUTO_ENHANCE_THRESHOLD,
    ENHANCEMENT_MAX_PASSES,
    stage_config_public,
)
from ..services.page_text import join_marked_pages, split_marked_pages
from ..services.manual_tune import apply_manual_tune
from ..services.quality import compute_qs, compute_qs_bgr, compute_qs_post, compute_qs_post_bgr

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
STAGE_ORDER = ["enhancement", "ocr", "doc_class", "index_genius", "abstractor", "lingua"]


def _extract_ocr_for_page_meta(pg: DocumentPage, lang: str | None = None) -> tuple[str, dict[str, Any] | None]:
    """Prefer enhanced raster, then original; return last OCR result dict for diagnostics (engine, hint)."""
    raw_paths: list[str] = []
    if pg.enhanced_path:
        raw_paths.append(_resolve_storage_file(pg.enhanced_path) or pg.enhanced_path)
    raw_paths.append(_resolve_storage_file(pg.image_path) or pg.image_path)

    candidates: list[str] = []
    seen: set[str] = set()
    for path_str in raw_paths:
        if not path_str:
            continue
        try:
            key = str(Path(path_str).resolve())
        except OSError:
            key = path_str
        if key in seen:
            continue
        seen.add(key)
        candidates.append(path_str)

    last_text = ""
    last_result: dict[str, Any] | None = None
    for path_str in candidates:
        if not path_str:
            continue
        try:
            p = Path(path_str)
            if not p.is_file():
                continue
        except OSError:
            continue
        try:
            result = ocr.extract_text(str(p.resolve()), lang=lang)
            last_result = result
            last_text = result.get("text") or ""
            if last_text.strip():
                return last_text, result
        except Exception:
            continue
    return last_text, last_result


def _record_stage(db, doc_id, stage, status, payload=None):
    run = StageRun(
        document_id=doc_id,
        stage=stage,
        status=status,
        payload=payload,
        finished_at=datetime.utcnow() if status in ("qc_pending", "approved", "rejected") else None,
    )
    db.add(run)
    db.commit()


def _advance_stage(doc: Document):
    try:
        idx = STAGE_ORDER.index(doc.current_stage)
        if idx + 1 < len(STAGE_ORDER):
            doc.current_stage = STAGE_ORDER[idx + 1]
            doc.status = "pending"
        else:
            doc.status = "completed"
    except ValueError:
        pass


# ---------- Stage 1: Enhancement ----------
@router.post("/{doc_id}/enhance")
def run_enhancement(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Streams NDJSON progress lines, then a final ``document`` line (see frontend ``enhanceWithProgress``)."""
    head = db.query(Document).filter(Document.id == doc_id).first()
    if not head:
        raise HTTPException(404, "Not found")
    if not head.original_path:
        raise HTTPException(400, "Document has no source image")

    def ndjson():
        last_result = None
        passes_max = 0
        try:
            doc = (
                db.query(Document)
                .options(joinedload(Document.pages))
                .filter(Document.id == doc_id)
                .first()
            )
            if not doc:
                raise RuntimeError("Not found")
            if not doc.original_path:
                raise RuntimeError("Document has no source image")

            doc.status = "processing"
            db.commit()

            pages = sorted(doc.pages or [], key=lambda p: p.page_index)

            # Legacy: no document_pages rows — enhance single original file only.
            if len(pages) == 0:
                enhanced_path = STORAGE_DIR / f"enh_{Path(doc.original_path).name}"
                for evt in enhancement.enhance_image_stream(
                    doc.original_path,
                    str(enhanced_path),
                    target_qs=float(doc.target_qs),
                    max_passes=ENHANCEMENT_MAX_PASSES,
                ):
                    if evt.get("phase") == "complete":
                        last_result = evt["result"]
                        passes_max = last_result["passes"]
                        continue
                    yield json.dumps(evt, default=str) + "\n"

                if not last_result:
                    raise RuntimeError("Enhancement produced no result")

                d = db.query(Document).filter(Document.id == doc_id).first()
                d.enhanced_path = str(Path(enhanced_path).resolve())
                d.initial_qs = round(float(compute_qs(d.original_path)["qs"]), 2)
                ep = str(Path(enhanced_path).resolve())
                d.post_qs = round(float(compute_qs_post(ep)["qs"]), 2)
                d.enhancement_passes = passes_max
                d.status = "qc_pending"
                db.commit()
                db.expire_all()
                loaded = (
                    db.query(Document)
                    .options(joinedload(Document.pages))
                    .filter(Document.id == doc_id)
                    .one()
                )
                _record_stage(db, doc_id, "enhancement", "qc_pending", payload=last_result)
                out = serialize_document(loaded, True)
                yield json.dumps({"phase": "document", "document": out.model_dump(mode="json")}, default=str) + "\n"
                return

            # Multi-page: run SOP enhancement on every raster page; doc.enhanced_path = page 0 (OCR / tune).
            total = len(pages)
            for idx, page in enumerate(pages):
                out_path = (STORAGE_DIR / f"enh_{Path(page.image_path).name}").resolve()
                for evt in enhancement.enhance_image_stream(
                    page.image_path,
                    str(out_path),
                    target_qs=float(doc.target_qs),
                    max_passes=ENHANCEMENT_MAX_PASSES,
                ):
                    if evt.get("phase") == "complete":
                        last_result = evt["result"]
                        passes_max = max(passes_max, int(last_result["passes"]))
                        continue
                    payload = {**evt, "page_index": idx + 1, "page_total": total}
                    yield json.dumps(payload, default=str) + "\n"

                pg = db.query(DocumentPage).filter(DocumentPage.id == page.id).one()
                pg.enhanced_path = str(out_path)
                pg.post_qs = round(float(compute_qs_post(str(out_path))["qs"]), 2)
                src_img = _resolve_storage_file(page.image_path) or page.image_path
                pg.initial_qs = round(float(compute_qs(str(src_img))["qs"]), 2)
                if last_result and isinstance(last_result.get("report"), dict):
                    pg.enhancement_report = last_result["report"]
                # Bump the document's updated_at so the frontend's cacheVersion changes and the
                # Enhanced raster URL re-fetches with the freshly written file.
                doc_row = db.query(Document).filter(Document.id == doc_id).first()
                if doc_row is not None:
                    doc_row.updated_at = datetime.utcnow()
                db.commit()
                # Stream a per-page completion event so the UI can render this page's enhanced raster
                # immediately, without waiting for the rest of the document to finish.
                # ``page_index`` here is 1-based to match the other progress events; the 0-based
                # ``page_index_zero`` is provided so the frontend can patch the matching DocumentPage row.
                page_done_payload = {
                    "phase": "page_complete",
                    "page_index": pg.page_index + 1,
                    "page_index_zero": pg.page_index,
                    "page_total": total,
                    "enhanced_path": pg.enhanced_path,
                    "post_qs": pg.post_qs,
                    "initial_qs": pg.initial_qs,
                    "updated_at": (doc_row.updated_at.isoformat() if doc_row and doc_row.updated_at else None),
                    "enhancement_report": pg.enhancement_report,
                }
                yield json.dumps(page_done_payload, default=str) + "\n"

            d = db.query(Document).filter(Document.id == doc_id).first()
            first = (
                db.query(DocumentPage)
                .filter(DocumentPage.document_id == doc_id)
                .order_by(DocumentPage.page_index)
                .first()
            )
            if first and first.enhanced_path:
                d.enhanced_path = first.enhanced_path
                all_pgs = (
                    db.query(DocumentPage)
                    .filter(DocumentPage.document_id == doc_id)
                    .order_by(DocumentPage.page_index)
                    .all()
                )
                inits = [p.initial_qs for p in all_pgs if p.initial_qs is not None]
                if inits:
                    d.initial_qs = round(float(sum(inits) / len(inits)), 2)
                else:
                    d.initial_qs = round(float(compute_qs(d.original_path)["qs"]), 2)
                d.post_qs = round(float(compute_qs_post(first.enhanced_path)["qs"]), 2)
                d.enhancement_passes = passes_max
                d.status = "qc_pending"
                db.commit()
                db.expire_all()
                loaded = (
                    db.query(Document)
                    .options(joinedload(Document.pages))
                    .filter(Document.id == doc_id)
                    .one()
                )
                payload = last_result or {"passes": passes_max, "pages": total}
                _record_stage(db, doc_id, "enhancement", "qc_pending", payload=payload)
                out = serialize_document(loaded, True)
                yield json.dumps({"phase": "document", "document": out.model_dump(mode="json")}, default=str) + "\n"
            else:
                raise RuntimeError("No enhanced page written")

        except Exception as e:
            try:
                db.rollback()
            except Exception:
                pass
            d2 = db.get(Document, doc_id)
            if d2:
                d2.status = "pending"
                db.commit()
            yield json.dumps({"phase": "error", "message": str(e)}, default=str) + "\n"

    return StreamingResponse(ndjson(), media_type="application/x-ndjson")


@router.get("/{doc_id}/enhance/auto/decide")
def auto_enhance_decide(
    doc_id: int,
    threshold: float | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Live-compute Initial QS (strict) from disk and decide whether enhancement should auto-run.

    The frontend uses this to gate the regular streaming `/enhance` endpoint:
      * `should_enhance=true`  → call `/enhance` and stream the run
      * `should_enhance=false` → upload already meets the threshold; skip & advance
    """
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Not found")
    if not doc.original_path:
        raise HTTPException(400, "Document has no source image")

    th = AUTO_ENHANCE_THRESHOLD if threshold is None else max(0.0, min(100.0, float(threshold)))

    # Average per-page Initial QS when we have raster pages; fall back to the document's original.
    pages = sorted(doc.pages or [], key=lambda p: p.page_index)
    page_scores: list[float] = []
    for pg in pages:
        try:
            src = _resolve_storage_file(pg.image_path) or pg.image_path
            page_scores.append(round(float(compute_qs(str(src))["qs"]), 2))
        except Exception:
            continue
    if page_scores:
        initial_qs = round(sum(page_scores) / len(page_scores), 2)
    else:
        initial_qs = round(float(compute_qs(doc.original_path)["qs"]), 2)

    should_enhance = initial_qs < th
    return {
        "doc_id": doc_id,
        "initial_qs": initial_qs,
        "threshold": th,
        "should_enhance": should_enhance,
        "page_scores": page_scores or None,
        "reason": (
            f"Initial QS {initial_qs} is below threshold {th} — enhancement recommended."
            if should_enhance
            else f"Initial QS {initial_qs} already meets threshold {th} — enhancement skipped."
        ),
    }


@router.post("/{doc_id}/enhance/tune", response_model=TuneEnhancementOut)
def tune_enhancement_manual(
    doc_id: int,
    body: ManualTuneIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Apply manual QC sliders — always saves the tuned raster (QS notices only, no silent discard)."""
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Not found")
    src_path = doc.enhanced_path or doc.original_path
    if not src_path:
        raise HTTPException(400, "No image to tune")

    img_in = cv2.imread(src_path)
    if img_in is None:
        raise HTTPException(400, "Cannot read source image")

    tuned = apply_manual_tune(img_in, body)

    # Manual QC: always persist the slider output. QS-based "pick best of three" made small moves look
    # like no-ops (previous frame or upload kept), which breaks operator expectations.
    # Compare on the post (lenient) scale — same scale as the saved Post QS the user sees in the UI.
    qs_upload = round(float(compute_qs_post(doc.original_path)["qs"]), 2)
    qs_in = round(float(compute_qs_post_bgr(img_in)["qs"]), 2)

    enhanced_path = STORAGE_DIR / f"enh_{Path(doc.original_path).name}"
    cv2.imwrite(str(enhanced_path), tuned)

    post_on_disk = round(float(compute_qs_post(str(enhanced_path))["qs"]), 2)

    doc.enhanced_path = str(Path(enhanced_path).resolve())
    # Keep doc.initial_qs as set at upload / SOP (do not replace on each tune — avoids confusing gauges).
    doc.post_qs = post_on_disk
    doc.status = "qc_pending"
    db.commit()

    first_pg = (
        db.query(DocumentPage)
        .filter(DocumentPage.document_id == doc_id)
        .order_by(DocumentPage.page_index)
        .first()
    )
    if first_pg:
        first_pg.enhanced_path = doc.enhanced_path
        first_pg.post_qs = post_on_disk
        db.commit()

    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )

    notice: str | None = None
    if post_on_disk + 0.2 < qs_in:
        notice = (
            f"Applied your adjustment; post QS is {post_on_disk:.2f} vs {qs_in:.2f} on the image before this tweak. "
            "QS rewards sharpness, gray-level spread, and clean tone: very low Contrast or Gamma (far from 50) "
            "often flattens the scan and drops the score even if it looks brighter. Try Contrast and Gamma nearer 50, "
            "or add a little Sharpen; ease heavy Denoise if QS fell."
        )
    elif post_on_disk + 0.2 < qs_upload:
        notice = (
            f"Post QS {post_on_disk:.2f} is below the original upload ({qs_upload:.2f}); the tuned image is still saved."
        )

    return TuneEnhancementOut(document=serialize_document(loaded, True), notice=notice)


# ---------- Stage 2: OCR (Text IQ) ----------
@router.get("/ocr/languages")
def list_ocr_languages():
    """Languages the OCR pipeline can target (multi-script presets — kan, hin, tam, …)."""
    return ocr.supported_ocr_languages()


@router.post("/{doc_id}/ocr", response_model=DocumentOut)
def run_ocr(
    doc_id: int,
    lang: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    doc.status = "processing"
    db.commit()

    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    ocr_payload: dict = {}

    if pages_sorted:
        parts: list[tuple[int, str]] = []
        engines: list[str] = []
        hints: list[str] = []
        for pg in pages_sorted:
            txt, meta = _extract_ocr_for_page_meta(pg, lang=lang)
            pg.ocr_text = txt
            pg.corrected_ocr_text = txt
            parts.append((pg.page_index, txt))
            if meta:
                engines.append(str(meta.get("engine") or ""))
                if meta.get("hint"):
                    hints.append(str(meta["hint"]))
                # Persist per-word OCR boxes (text + confidence + bounding box) for the
                # word-level confidence heatmap UI.
                raw_boxes = meta.get("boxes") or []
                if isinstance(raw_boxes, list) and raw_boxes:
                    pg.ocr_boxes = raw_boxes
        doc.raw_ocr = join_marked_pages(parts)
        doc.corrected_ocr = doc.raw_ocr
        ocr_payload = {
            "mode": "per_page",
            "pages": len(pages_sorted),
            "engines": engines,
            "hints": list(dict.fromkeys(hints)),
            "lang": lang or "auto",
        }
    else:
        src = doc.enhanced_path or doc.original_path
        result = ocr.extract_text(src, lang=lang)
        doc.raw_ocr = result["text"]
        doc.corrected_ocr = result["text"]
        ocr_payload = result

    doc.ocr_cer = round(
        ocr.compute_cer(doc.corrected_ocr or "", doc.raw_ocr or "") * 100,
        2,
    )
    doc.status = "qc_pending"
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(db, doc_id, "ocr", "qc_pending", payload=ocr_payload)
    return serialize_document(loaded, True)


@router.post("/{doc_id}/ocr/correct", response_model=DocumentOut)
def correct_ocr(doc_id: int, body: OCRCorrection, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)

    if body.corrected_text is not None:
        doc.corrected_ocr = body.corrected_text
        if pages_sorted:
            split = split_marked_pages(body.corrected_text)
            for pg in pages_sorted:
                t = split.get(pg.page_index)
                if t is not None:
                    pg.corrected_ocr_text = t
        # CER: reference = corrected (user GT), hypothesis = raw model output
        doc.ocr_cer = round(ocr.compute_cer(body.corrected_text, doc.raw_ocr or "") * 100, 2)

    # English-side corrections — page-by-page list takes precedence over the full-document blob.
    if body.pages_english:
        for patch in body.pages_english:
            pg = next((p for p in pages_sorted if p.page_index == patch.page_index), None)
            if pg is not None:
                pg.corrected_ocr_text_english = patch.corrected_ocr_text_english
        joined = join_marked_pages(
            [(p.page_index, (p.corrected_ocr_text_english or "").strip()) for p in pages_sorted]
        )
        doc.corrected_ocr_english = joined
    elif body.corrected_english is not None:
        doc.corrected_ocr_english = body.corrected_english
        if pages_sorted:
            split = split_marked_pages(body.corrected_english)
            for pg in pages_sorted:
                t = split.get(pg.page_index)
                if t is not None:
                    pg.corrected_ocr_text_english = t

    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


@router.post("/{doc_id}/ocr/translate-english", response_model=DocumentOut)
def translate_ocr_to_english(
    doc_id: int,
    body: OCRTranslateIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Translate each page's OCR text to English (deep-translator). Stores per-page + joined output.

    Run after OCR. Downstream Classify / Index / Abstract auto-prefer the English version when present
    so non-Latin source documents (e.g. Kannada gazettes) classify accurately.
    """
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    source = (body.source if body else None) or "auto"
    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    translated: list[tuple[int, str]] = []
    if pages_sorted:
        for pg in pages_sorted:
            src = (pg.corrected_ocr_text or pg.ocr_text or "").strip()
            en = lingua.translate(src, target="en", source=source) if src else ""
            pg.ocr_text_english = en
            pg.corrected_ocr_text_english = en
            translated.append((pg.page_index, en))
        joined = join_marked_pages(translated)
        doc.raw_ocr_english = joined
        doc.corrected_ocr_english = joined
    else:
        src_text = (doc.corrected_ocr or doc.raw_ocr or "").strip()
        if not src_text:
            raise HTTPException(400, "No OCR text to translate — run OCR first.")
        en = lingua.translate(src_text, target="en", source=source)
        doc.raw_ocr_english = en
        doc.corrected_ocr_english = en

    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(
        db,
        doc_id,
        "ocr",
        "qc_pending",
        payload={"action": "translate_to_english", "source": source, "pages": len(pages_sorted)},
    )
    return serialize_document(loaded, True)


def _page_source_for_translate(doc: Document, pg: DocumentPage) -> str:
    """Text to translate for one page: per-row abstract/OCR, else slices of combined abstract then OCR."""
    a = (pg.corrected_page_abstract or pg.page_abstract or "").strip()
    if a:
        return a
    o = (pg.corrected_ocr_text or pg.ocr_text or "").strip()
    if o:
        return o
    for fld in (doc.corrected_abstract, doc.abstract):
        if not fld or not str(fld).strip():
            continue
        sp = split_marked_pages(str(fld))
        t = (sp.get(pg.page_index) or "").strip()
        if t:
            return t
    for fld in (doc.corrected_ocr, doc.raw_ocr):
        if not fld or not str(fld).strip():
            continue
        sp = split_marked_pages(str(fld))
        t = (sp.get(pg.page_index) or "").strip()
        if t:
            return t
    return ""


# ---------- Stage 3: Doc Class ----------
def _page_ocr_text(doc: Document, pg: DocumentPage) -> str:
    """OCR text for one page: row fields, else slice from combined marked doc OCR.

    Prefers the English translation when available (Classify / Index / Abstract are tuned for English).
    """
    en = (pg.corrected_ocr_text_english or pg.ocr_text_english or "").strip()
    if en:
        return en
    full_en = (doc.corrected_ocr_english or doc.raw_ocr_english or "").strip()
    if full_en:
        sp = split_marked_pages(full_en)
        slice_en = (sp.get(pg.page_index) or "").strip()
        if slice_en:
            return slice_en
    direct = (pg.corrected_ocr_text or pg.ocr_text or "").strip()
    if direct:
        return direct
    full = (doc.corrected_ocr or doc.raw_ocr or "").strip()
    if not full:
        return ""
    sp = split_marked_pages(full)
    return (sp.get(pg.page_index) or "").strip()


@router.post("/{doc_id}/classify", response_model=DocumentOut)
def run_classify(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    if pages_sorted:
        found_text = False
        page_payload: list[dict] = []
        for pg in pages_sorted:
            src_text = _page_ocr_text(doc, pg)
            if not src_text:
                pg.page_doc_class = None
                pg.page_doc_class_scores = None
                page_payload.append({"page_index": pg.page_index, "skipped": True, "reason": "no_ocr_text"})
                continue
            found_text = True
            result = doc_class.classify(src_text)
            pg.page_doc_class = result["top"]
            pg.page_doc_class_scores = result["scores"]
            page_payload.append(
                {
                    "page_index": pg.page_index,
                    "top": result["top"],
                    "scores": result["scores"],
                }
            )
        if not found_text:
            raise HTTPException(
                400,
                "No OCR text on any page — complete Text IQ (OCR) first. Classification uses that text only.",
            )
        for pg in pages_sorted:
            if pg.page_doc_class:
                doc.doc_class = pg.page_doc_class
                doc.doc_class_scores = pg.page_doc_class_scores
                break
        else:
            doc.doc_class = None
            doc.doc_class_scores = None
    else:
        src_text = (
            doc.corrected_ocr_english
            or doc.raw_ocr_english
            or doc.corrected_ocr
            or doc.raw_ocr
            or ""
        )
        if not src_text.strip():
            raise HTTPException(
                400,
                "No OCR text yet — complete Text IQ (OCR) first. Classification uses that extracted text only.",
            )
        result = doc_class.classify(src_text)
        doc.doc_class = result["top"]
        doc.doc_class_scores = result["scores"]
        page_payload = result
    doc.status = "qc_pending"
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(db, doc_id, "doc_class", "qc_pending", payload=page_payload)
    return serialize_document(loaded, True)


@router.post("/{doc_id}/classify/correct", response_model=DocumentOut)
def correct_class(doc_id: int, body: ClassCorrection, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    if body.page_index is not None:
        pg = (
            db.query(DocumentPage)
            .filter(DocumentPage.document_id == doc_id, DocumentPage.page_index == body.page_index)
            .first()
        )
        if not pg:
            raise HTTPException(404, "Page not found")
        pg.page_doc_class = body.doc_class
        first = (
            db.query(DocumentPage)
            .filter(DocumentPage.document_id == doc_id)
            .order_by(DocumentPage.page_index)
            .first()
        )
        if first:
            doc.doc_class = first.page_doc_class
            doc.doc_class_scores = first.page_doc_class_scores
    else:
        doc.doc_class = body.doc_class
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


# ---------- Stage 4: Index Genius ----------
@router.post("/{doc_id}/index", response_model=DocumentOut)
def run_index(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    # Prefer the English translation when present (Index Genius LLM prompt is tuned for English).
    src_text = (
        doc.corrected_ocr_english
        or doc.raw_ocr_english
        or doc.corrected_ocr
        or doc.raw_ocr
        or ""
    )
    md = index_genius.extract_metadata(src_text, doc_class=doc.doc_class)
    doc.index_metadata = md
    doc.status = "qc_pending"
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(db, doc_id, "index_genius", "qc_pending", payload=md)
    return serialize_document(loaded, True)


@router.post("/{doc_id}/index/correct", response_model=DocumentOut)
def correct_index(doc_id: int, body: IndexCorrection, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Not found")
    doc.index_metadata = body.index_metadata
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


# ---------- Stage 5: Abstractor ----------
@router.post("/{doc_id}/abstract", response_model=DocumentOut)
def run_abstract(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    has_page_text = pages_sorted and any(_page_ocr_text(doc, p).strip() for p in pages_sorted)

    if has_page_text:
        summaries: list[tuple[int, str]] = []
        page_text_blocks: list[str] = []
        for pg in pages_sorted:
            src = _page_ocr_text(doc, pg)
            summ = abstractor.summarize(src, sentences=3) if src.strip() else ""
            pg.page_abstract = summ
            pg.corrected_page_abstract = summ
            summaries.append((pg.page_index, summ))
            if src.strip():
                page_text_blocks.append(src.strip())
        joined = join_marked_pages(summaries)
        doc.abstract = joined
        doc.corrected_abstract = joined
        doc.abstract_cer = 0.0
        # Document-wide overall summary across all pages — separate from per-page blocks.
        full_doc_text = "\n\n".join(page_text_blocks)
        if full_doc_text.strip():
            overall = abstractor.summarize(full_doc_text, sentences=3)
            doc.overall_abstract = overall
            doc.corrected_overall_abstract = overall
        else:
            doc.overall_abstract = None
            doc.corrected_overall_abstract = None
        payload = {"abstract": joined, "mode": "per_page", "overall": doc.overall_abstract or ""}
    else:
        src_text = doc.corrected_ocr or doc.raw_ocr or ""
        summary = abstractor.summarize(src_text, sentences=3)
        doc.abstract = summary
        doc.corrected_abstract = summary
        doc.abstract_cer = 0.0
        # Single-image doc — overall is the same long-form summary.
        doc.overall_abstract = summary
        doc.corrected_overall_abstract = summary
        payload = {"abstract": summary, "mode": "full", "overall": summary}

    doc.status = "qc_pending"
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(db, doc_id, "abstractor", "qc_pending", payload=payload)
    return serialize_document(loaded, True)


@router.post("/{doc_id}/abstract/correct", response_model=DocumentOut)
def correct_abstract(doc_id: int, body: AbstractCorrection, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    if body.pages is None and body.corrected_abstract is None and body.corrected_overall_abstract is None:
        raise HTTPException(400, "Provide corrected_abstract, pages[], or corrected_overall_abstract")

    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)

    if body.pages:
        for patch in body.pages:
            pg = next((p for p in pages_sorted if p.page_index == patch.page_index), None)
            if pg is not None:
                pg.corrected_page_abstract = patch.corrected_page_abstract
        summaries = [(p.page_index, (p.corrected_page_abstract or "").strip()) for p in pages_sorted]
        doc.corrected_abstract = join_marked_pages(summaries)
    elif body.corrected_abstract is not None:
        doc.corrected_abstract = body.corrected_abstract
        if pages_sorted:
            split = split_marked_pages(body.corrected_abstract)
            for pg in pages_sorted:
                if pg.page_index in split:
                    pg.corrected_page_abstract = split[pg.page_index]

    if body.corrected_overall_abstract is not None:
        doc.corrected_overall_abstract = body.corrected_overall_abstract

    cers: list[float] = []
    for pg in pages_sorted:
        if getattr(pg, "page_abstract", None):
            cers.append(
                ocr.compute_cer(pg.corrected_page_abstract or "", pg.page_abstract or ""),
            )
    if cers:
        doc.abstract_cer = round(sum(cers) / len(cers) * 100, 2)
    elif doc.abstract:
        doc.abstract_cer = round(
            ocr.compute_cer(doc.corrected_abstract or "", doc.abstract or "") * 100,
            2,
        )

    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


# ---------- Stage 6: Lingua AI ----------
@router.post("/{doc_id}/translate", response_model=DocumentOut)
def run_translate(doc_id: int, body: TranslateRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    doc.target_language = body.target_language
    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)

    if pages_sorted:
        tr_parts: list[tuple[int, str]] = []
        for pg in pages_sorted:
            src = _page_source_for_translate(doc, pg)
            tr = lingua.translate(src, target=body.target_language)
            pg.page_translation = tr
            tr_parts.append((pg.page_index, tr))
        doc.translation = join_marked_pages(tr_parts)
        payload = {"target": body.target_language, "mode": "per_page", "pages": len(pages_sorted)}
    else:
        src_text = doc.corrected_abstract or doc.abstract or doc.corrected_ocr or doc.raw_ocr or ""
        doc.translation = lingua.translate(src_text, target=body.target_language)
        payload = {"target": body.target_language, "mode": "full"}

    doc.status = "completed"
    doc.current_stage = "lingua"
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    _record_stage(db, doc_id, "lingua", "approved", payload=payload)
    return serialize_document(loaded, True)


# ---------- QC Approve / Reject ----------
@router.post("/{doc_id}/approve", response_model=DocumentOut)
def approve_stage(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Not found")
    _advance_stage(doc)
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


@router.post("/{doc_id}/reject", response_model=DocumentOut)
def reject_stage(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Not found")
    doc.status = "pending"  # stays on current stage, ready to re-run
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .one()
    )
    return serialize_document(loaded, True)


@router.get("/stage-config")
def get_stage_config():
    """SOP defaults and per-stage parameters for QC / operators."""
    return stage_config_public()


@router.get("/index/schema")
def get_index_schema():
    """Per-class metadata schema (Index Genius form fields). UI builds inputs from this."""
    return index_genius.class_index_schema_public()


@router.get("/languages")
def list_languages():
    return lingua.SUPPORTED


def _build_chat_context(doc: Document, use_english: bool, max_chars: int = 30000) -> tuple[str, int]:
    """Concatenate the document's English (or fallback source) text into a single context block."""
    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    chunks: list[str] = []
    used_pages = 0
    if pages_sorted:
        for pg in pages_sorted:
            if use_english:
                text = (pg.corrected_ocr_text_english or pg.ocr_text_english or "").strip()
            else:
                text = ""
            if not text:
                text = (pg.corrected_ocr_text or pg.ocr_text or "").strip()
            if not text:
                continue
            chunks.append(f"--- PAGE {pg.page_index + 1} ---\n{text}")
            used_pages += 1
    else:
        if use_english:
            text = (doc.corrected_ocr_english or doc.raw_ocr_english or "").strip()
        else:
            text = ""
        if not text:
            text = (doc.corrected_ocr or doc.raw_ocr or "").strip()
        if text:
            chunks.append(text)
            used_pages = 1

    body = "\n\n".join(chunks)
    if len(body) > max_chars:
        # Keep the head + tail so multi-page docs still see the closing context.
        half = max_chars // 2
        body = body[:half] + "\n\n[...content trimmed for length...]\n\n" + body[-half:]
    return body, used_pages


@router.post("/{doc_id}/chat", response_model=ChatReplyOut)
def chat_with_document(
    doc_id: int,
    body: ChatRequestIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Conversational Q&A over the document content. Uses Gemini when configured."""
    if not gemini_client.is_configured():
        raise HTTPException(
            503,
            "Chat unavailable — set GEMINI_API_KEY (or another LLM key) in backend/.env and restart.",
        )
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    context, used_pages = _build_chat_context(doc, use_english=bool(body.use_english))
    if not context.strip():
        raise HTTPException(
            400,
            "Document has no readable text yet. Run OCR (and optionally Translate to English) first.",
        )

    # Frontend only sends the *new* user turns / history; we always re-anchor the system prompt
    # with fresh context so it survives reloads / cleared local storage.
    summary_bits: list[str] = []
    if doc.doc_class:
        summary_bits.append(f"Classification: {doc.doc_class}")
    if doc.filename:
        summary_bits.append(f"Filename: {doc.filename}")
    overall = (doc.corrected_overall_abstract or doc.overall_abstract or "").strip()
    if overall:
        summary_bits.append(f"Document-wide summary:\n{overall}")
    summary_block = "\n".join(summary_bits)
    metadata_section = f"---\nMETADATA\n{summary_block}\n" if summary_block else ""

    system = (
        "You are an assistant answering questions about ONE specific document supplied below. "
        "Rules:\n"
        " * Use ONLY the document text. If the answer is not in the document, say so plainly.\n"
        " * Cite page numbers in parentheses when relevant, e.g. (page 3).\n"
        " * Keep answers concise; bullet lists for multi-part questions.\n"
        " * If the user asks for a translation or summary, provide it from the document content.\n"
        f"{metadata_section}"
        "---\nDOCUMENT TEXT (English when available)\n"
        f"{context}"
    )

    # Validate the conversation: at least one user message; cap turn count to keep prompts tidy.
    turns = [
        {"role": ("user" if m.role == "user" else "assistant"), "content": m.content}
        for m in (body.messages or [])
        if (m.content or "").strip()
    ][-20:]
    if not turns or turns[-1]["role"] != "user":
        raise HTTPException(400, "Last message must come from the user.")

    reply = gemini_client.chat_multi(turns, system=system, max_tokens=1024, temperature=0.4)
    if not reply:
        raise HTTPException(502, "Gemini did not return a response.")

    return ChatReplyOut(reply=reply, model=gemini_client._model(), used_pages=used_pages)
