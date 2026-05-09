import mimetypes
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session, joinedload, noload

from ..db import get_db
from ..models import Document, DocumentPage, StageRun, User
from ..schemas import DocumentOut, DocumentPatch, serialize_document, _document_page_out, _resolve_storage_file
from ..services.upload_normalize import ingest_to_page_pngs
from .auth import current_user

router = APIRouter(prefix="/api/documents", tags=["documents"])

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)

MAX_BATCH_FILES = 40


def _unlink(path: str | None) -> None:
    if not path:
        return
    resolved = _resolve_storage_file(path) or path
    p = Path(resolved)
    if p.exists():
        try:
            p.unlink()
        except Exception:
            pass


def _create_document_from_upload(db: Session, filename: str, raw: bytes) -> Document:
    uid = uuid.uuid4().hex[:12]
    rows = ingest_to_page_pngs(raw, filename, STORAGE_DIR, uid)
    _idx0, first_path, _first_qs = rows[0]
    mean_initial = round(float(sum(q for _, _, q in rows) / len(rows)), 2)
    doc = Document(
        filename=filename,
        original_path=first_path,
        initial_qs=mean_initial,
        current_stage="enhancement",
        status="pending",
    )
    db.add(doc)
    db.flush()
    for page_index, path, qs in rows:
        db.add(
            DocumentPage(
                document_id=doc.id,
                page_index=page_index,
                image_path=path,
                initial_qs=qs,
            )
        )
    db.commit()
    loaded = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc.id)
        .one()
    )
    return loaded


@router.post("/batch", response_model=list[DocumentOut])
async def upload_documents_batch(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not files:
        raise HTTPException(400, "No files")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(400, f"Maximum {MAX_BATCH_FILES} files per batch")

    results: list[DocumentOut] = []
    errors: list[str] = []
    for f in files:
        if not f.filename:
            errors.append("skipped: missing filename")
            continue
        raw = await f.read()
        try:
            doc = _create_document_from_upload(db, f.filename, raw)
            results.append(serialize_document(doc, True))
        except ValueError as e:
            errors.append(f"{f.filename}: {e}")

    if not results and errors:
        raise HTTPException(400, "; ".join(errors))
    return results


@router.post("", response_model=DocumentOut)
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not file.filename:
        raise HTTPException(400, "No filename")
    raw = await file.read()
    try:
        doc = _create_document_from_upload(db, file.filename, raw)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return serialize_document(doc, True)


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db), user: User = Depends(current_user)):
    docs = (
        db.query(Document)
        .options(noload(Document.pages))
        .order_by(Document.created_at.desc())
        .all()
    )
    return [serialize_document(d, False) for d in docs]


@router.get("/{doc_id}/pages/{page_index}/quality")
def get_page_quality(
    doc_id: int,
    page_index: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Recompute QS + raster stats from disk for one page (used by fullscreen Metrics when the client payload is sparse)."""
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    pg = next((p for p in (doc.pages or []) if p.page_index == page_index), None)
    if not pg:
        raise HTTPException(404, "Page not found")
    out = _document_page_out(pg)
    return {
        "initial_qs": out.initial_qs,
        "post_qs": out.post_qs,
        "qs_metrics": out.qs_metrics.model_dump() if out.qs_metrics else None,
        "image_params": out.image_params.model_dump() if out.image_params else None,
        "post_qs_metrics": out.post_qs_metrics.model_dump() if out.post_qs_metrics else None,
        "post_image_params": out.post_image_params.model_dump() if out.post_image_params else None,
    }


@router.get("/{doc_id}/raster")
def get_document_raster(
    doc_id: int,
    layer: Literal["original", "enhanced"] = Query("original"),
    page_index: int | None = Query(None, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Serve page or document rasters with the same auth as the API (browser img tags do not send Bearer tokens)."""
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")

    path_str: str | None = None
    pages_sorted = sorted(doc.pages or [], key=lambda p: p.page_index)
    if page_index is not None:
        pg = next((p for p in pages_sorted if p.page_index == page_index), None)
        if not pg:
            raise HTTPException(404, "Page not found")
        if layer == "original":
            path_str = pg.image_path
        else:
            path_str = pg.enhanced_path or doc.enhanced_path
    else:
        if layer == "original":
            path_str = doc.original_path
        else:
            path_str = doc.enhanced_path

    if not path_str:
        raise HTTPException(404, "Raster not available")

    resolved = _resolve_storage_file(path_str)
    if not resolved:
        raise HTTPException(404, "File missing on disk")
    p = Path(resolved)
    if not p.is_file():
        raise HTTPException(404, "File missing on disk")

    media = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    return FileResponse(str(p), media_type=media)


@router.get("/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    return serialize_document(doc, True)


@router.patch("/{doc_id}", response_model=DocumentOut)
def patch_document(
    doc_id: int,
    body: DocumentPatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Update SOP target (e.g. reset to 95) without re-running the pipeline."""
    doc = (
        db.query(Document)
        .options(joinedload(Document.pages))
        .filter(Document.id == doc_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Not found")
    if body.target_qs is not None:
        doc.target_qs = float(body.target_qs)
    db.commit()
    db.refresh(doc)
    return serialize_document(doc, True)


@router.delete("/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    doc = db.query(Document).options(joinedload(Document.pages)).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Not found")

    for pg in list(doc.pages or []):
        _unlink(pg.image_path)
        _unlink(getattr(pg, "enhanced_path", None))
    _unlink(doc.original_path)
    _unlink(doc.enhanced_path)
    # Enhancement uses enh_<basename(original)> — remove if present
    if doc.original_path:
        enh = STORAGE_DIR / f"enh_{Path(doc.original_path).name}"
        _unlink(str(enh))

    # Core deletes: use SQL DELETE so we never double-delete via ORM cascades (avoids SAWarning / flakes).
    db.execute(delete(StageRun).where(StageRun.document_id == doc_id))
    db.execute(delete(DocumentPage).where(DocumentPage.document_id == doc_id))
    db.execute(delete(Document).where(Document.id == doc_id))
    db.commit()
    return {"ok": True}
