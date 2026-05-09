from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Load backend/.env (GEMINI_API_KEY etc.) before any service imports it.
try:
    from dotenv import load_dotenv

    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_PATH.is_file():
        load_dotenv(_ENV_PATH, override=False)
except Exception:
    pass

from .db import Base, engine, SessionLocal, migrate_sqlite_schema
from .models import User
from .services.security import hash_password, verify_password
from .routes import documents, pipeline, auth
from .services import ocr as ocr_service

Base.metadata.create_all(bind=engine)
migrate_sqlite_schema()


def seed_admin():
    db = SessionLocal()
    try:
        # Demo: admin / admin1 (≥6 chars for registration parity). Migrate legacy seed "admin".
        u = db.query(User).filter(User.username == "admin").first()
        if not u:
            db.add(User(username="admin", password_hash=hash_password("admin1"), display_name="Admin"))
            db.commit()
        elif verify_password("admin", u.password_hash) or (
            u.password_hash and len(u.password_hash) < 30
        ):
            # Legacy "admin" password, or truncated / corrupt hash — restore demo admin1.
            u.password_hash = hash_password("admin1")
            db.commit()
    finally:
        db.close()


seed_admin()

app = FastAPI(title="ACTIGEN 2.0", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = Path(__file__).resolve().parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)
app.mount("/files", StaticFiles(directory=STORAGE_DIR), name="files")

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(pipeline.router)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "actigen-2.0"}


@app.get("/api/health/ocr")
def health_ocr():
    """Whether Tesseract / EasyOCR are usable on this host (no document I/O)."""
    return ocr_service.diagnose_ocr_environment()
