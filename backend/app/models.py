from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from .db import Base


STAGES = [
    "enhancement",
    "ocr",
    "doc_class",
    "index_genius",
    "abstractor",
    "lingua",
]


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    original_path = Column(String, nullable=False)
    enhanced_path = Column(String, nullable=True)
    initial_qs = Column(Float, nullable=True)
    post_qs = Column(Float, nullable=True)
    target_qs = Column(Float, default=100.0)
    enhancement_passes = Column(Integer, default=0)
    raw_ocr = Column(Text, nullable=True)
    corrected_ocr = Column(Text, nullable=True)
    ocr_cer = Column(Float, nullable=True)
    # English translation of the raw OCR (used for Classify when source is non-Latin) — operator can correct.
    raw_ocr_english = Column(Text, nullable=True)
    corrected_ocr_english = Column(Text, nullable=True)
    doc_class = Column(String, nullable=True)
    doc_class_scores = Column(JSON, nullable=True)
    index_metadata = Column(JSON, nullable=True)
    abstract = Column(Text, nullable=True)
    corrected_abstract = Column(Text, nullable=True)
    abstract_cer = Column(Float, nullable=True)
    # Document-wide summary (spans all pages), separate from per-page summaries stored in `abstract`.
    overall_abstract = Column(Text, nullable=True)
    corrected_overall_abstract = Column(Text, nullable=True)
    target_language = Column(String, default="es")
    translation = Column(Text, nullable=True)
    current_stage = Column(String, default="enhancement")
    status = Column(String, default="pending")  # pending|processing|qc_pending|approved|completed|failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    stage_runs = relationship("StageRun", back_populates="document", cascade="all, delete-orphan")
    pages = relationship(
        "DocumentPage",
        back_populates="document",
        order_by="DocumentPage.page_index",
        cascade="all, delete-orphan",
    )


class DocumentPage(Base):
    """Raster preview pages for a document (PDF pages or one image)."""

    __tablename__ = "document_pages"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    page_index = Column(Integer, nullable=False)
    image_path = Column(String, nullable=False)
    initial_qs = Column(Float, nullable=True)
    enhanced_path = Column(String, nullable=True)
    post_qs = Column(Float, nullable=True)
    # Operator-facing diff report: verdict, paper_lift, ink_deepen, pct_pixels_changed, histograms.
    enhancement_report = Column(JSON, nullable=True)
    # Per-page Text IQ / Abstractor / Lingua (multi-page PDFs)
    ocr_text = Column(Text, nullable=True)
    corrected_ocr_text = Column(Text, nullable=True)
    # Per-page English translation of OCR — backs the document-level raw_ocr_english + Classify.
    ocr_text_english = Column(Text, nullable=True)
    corrected_ocr_text_english = Column(Text, nullable=True)
    # Per-word OCR boxes with confidence: [{"text":..., "confidence": 0..1, "box": [[x,y]*4]}].
    ocr_boxes = Column(JSON, nullable=True)
    page_abstract = Column(Text, nullable=True)
    corrected_page_abstract = Column(Text, nullable=True)
    page_translation = Column(Text, nullable=True)
    page_doc_class = Column(String, nullable=True)
    page_doc_class_scores = Column(JSON, nullable=True)

    document = relationship("Document", back_populates="pages")


class StageRun(Base):
    __tablename__ = "stage_runs"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    stage = Column(String, nullable=False)
    status = Column(String, default="pending")  # pending|running|qc_pending|approved|rejected
    payload = Column(JSON, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    document = relationship("Document", back_populates="stage_runs")
