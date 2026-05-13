from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "visionmax.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def migrate_sqlite_schema() -> None:
    """Add columns introduced after first deploy (SQLite has no ALTER IF NOT EXISTS)."""
    insp = inspect(engine)
    tables = insp.get_table_names()
    with engine.begin() as conn:
        if "document_pages" in tables:
            page_cols = {c["name"] for c in insp.get_columns("document_pages")}
            if "enhanced_path" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN enhanced_path VARCHAR"))
            if "post_qs" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN post_qs FLOAT"))
            if "ocr_text" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN ocr_text TEXT"))
            if "corrected_ocr_text" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN corrected_ocr_text TEXT"))
            if "page_abstract" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN page_abstract TEXT"))
            if "corrected_page_abstract" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN corrected_page_abstract TEXT"))
            if "page_translation" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN page_translation TEXT"))
            if "page_doc_class" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN page_doc_class VARCHAR"))
            if "page_doc_class_scores" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN page_doc_class_scores JSON"))
            if "ocr_text_english" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN ocr_text_english TEXT"))
            if "corrected_ocr_text_english" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN corrected_ocr_text_english TEXT"))
            if "ocr_boxes" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN ocr_boxes JSON"))
            if "enhancement_report" not in page_cols:
                conn.execute(text("ALTER TABLE document_pages ADD COLUMN enhancement_report JSON"))
        if "documents" in tables:
            doc_cols = {c["name"] for c in insp.get_columns("documents")}
            if "overall_abstract" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN overall_abstract TEXT"))
            if "corrected_overall_abstract" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN corrected_overall_abstract TEXT"))
            if "raw_ocr_english" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN raw_ocr_english TEXT"))
            if "corrected_ocr_english" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN corrected_ocr_english TEXT"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
