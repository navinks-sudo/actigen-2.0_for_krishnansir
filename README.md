# ACTIGEN 2.0

**One engine · multiple solutions** — end-to-end document intelligence pipeline with a glassmorphism React portal and a FastAPI backend.

## Pipeline

`Image Enhancement → OCR (Text IQ) → Doc Class → Index Genius → Abstractor → Lingua AI`

Every stage has its own QC Workbench. Stages auto-run, flip to `qc_pending`, and require Approve to advance. Reject lets you re-run.

| Stage | Tech | QC tools |
| --- | --- | --- |
| Enhancement | OpenCV QS-guided passes (deskew + NLMeans + CLAHE + unsharp), SOP default **100**, stall early-exit then polish / escalation | Initial QS on upload, Post after run; `/api/pipeline/stage-config` |
| OCR | **Tesseract** (pytesseract) when the binary is on `PATH` or `TESSERACT_CMD`; else EasyOCR fallback | Editable text, CER vs corrected text, raw model output |
| Doc Class | **OpenAI JSON** over OCR when `OPENAI_API_KEY` is set; else TF-IDF + keyword fusion | Confidence bars, override picker |
| Index Genius | Regex extraction + optional **LLM metatags** (`topics`, `entities`, `suggested_keywords`) with the same API key | Per-field add / edit / delete |
| Abstractor | **LLM** per-page/full when configured; else Sumy LSA | Editable summary, CER, compression % |
| Lingua AI | deep-translator (Google free) — **Indic + world** language list | Target picker, copy button |

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8003
```

**Tesseract (recommended for OCR):** install the [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) binary so `tesseract` is on your `PATH`, or set `TESSERACT_CMD` to the full path of `tesseract.exe` (Windows) / `tesseract` (Unix). On Windows, if Tesseract is not on `PATH`, the backend also checks `C:\\Program Files\\Tesseract-OCR\\tesseract.exe` and the `(x86)` path.

| Variable | Purpose |
| --- | --- |
| `TESSERACT_CMD` | Full path to the `tesseract` executable if it is not on `PATH`. |
| `TESSERACT_LANG` | BCP-style language codes joined with `+` (default `eng`). Examples: `eng+hin`, `kan+eng` for Kannada gazettes (install matching `.traineddata` under tessdata). |
| `TESSERACT_CONFIG` | Extra Tesseract CLI flags, e.g. `--oem 3 --psm 6` for dense multi-column scans. |
| `TESSDATA_PREFIX` | (Optional) Tesseract’s tessdata parent directory if the binary cannot find languages. |
| `EASYOCR_LANGS` | Comma-separated EasyOCR codes when Tesseract is unavailable or returns empty text (default `en`). Example: `kn,en` for Kannada + English (downloads models on first run). |

If Tesseract is missing, errors, or returns empty text, the backend falls back to **EasyOCR**. Check **uvicorn logs** for `Tesseract OCR failed` / `EasyOCR failed`. After **Run OCR**, the `StageRun` payload for `ocr` lists `engines` and `hints` per multi-page run.

**LLM (classification, Index Genius tags, Abstractor):** set `OPENAI_API_KEY`. Optional: `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_BASE_URL` for Azure or other OpenAI-compatible hosts. Without a key, classification and abstracts use the classical models; Index Genius still runs regex-only.

NLTK punkt tokenizer downloads on first classical Abstractor run if LSA is used.

Uploads accept common images (via Pillow) and **PDF** (first page only, rasterized at 200 DPI with PyMuPDF). Anything else must decode as an image or PDF or the API returns 400.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/files` to `http://localhost:8003`.

Seeded demo user (first backend start): **admin** / **admin1** (password must be at least 6 characters for registration). If you already have an older SQLite DB with `admin` / `admin`, remove the `admin` row or delete `visionmax.db` so the seed can recreate the account.

## Architecture

```
backend/
  app/
    main.py              # FastAPI app, CORS, static /files mount
    db.py                # SQLAlchemy + SQLite (visionmax.db)
    models.py            # Document, StageRun
    schemas.py           # Pydantic DTOs
    routes/
      documents.py       # upload, list, get, delete
      pipeline.py        # 6 stage runners + QC corrections + approve/reject
    services/
      quality.py         # composite QS (sharpness + brightness + contrast + noise)
      enhancement.py     # QS-guided enhancement loop
      pipeline_config.py # SOP defaults + enhancement tunables
      ocr.py             # Tesseract + EasyOCR fallback + jiwer CER
      llm_client.py      # OpenAI-compatible JSON chat
      doc_class.py       # LLM + TF-IDF classifier
      index_genius.py    # regex + optional LLM metatags
      abstractor.py      # LLM + Sumy LSA
      lingua.py          # GoogleTranslator + Indic language set
    storage/             # uploaded + enhanced images
frontend/
  src/
    App.tsx              # router + header
    pages/
      Dashboard.tsx      # document grid w/ progress bars
      Upload.tsx         # drag-drop upload
      DocumentView.tsx   # pipeline + active QC workbench
    components/
      PipelineFlow.tsx   # 6-stage horizontal stepper
      Gauge.tsx          # animated SVG QS gauge
      QCEnhancement.tsx
      QCOcr.tsx
      QCClassify.tsx
      QCIndex.tsx
      QCAbstract.tsx
      QCLingua.tsx
    lib/api.ts           # typed API client
```

## Notes

- **DB**: SQLite at `backend/app/visionmax.db`. Swap to Postgres by changing `DATABASE_URL` in `db.py`.
- **Storage**: `backend/app/storage/`. Files served at `/files/<name>`. Swap to S3 by changing the upload + serve path.
- **Enhancement SOP**: per-document `target_qs` defaults to **100** (range 80–100 via PATCH). Tunables: `ENHANCEMENT_MAX_PASSES`, `ENHANCEMENT_MIN_PASS_IMPROVEMENT`, `ENHANCEMENT_STALL_WINDOW`, `ENHANCEMENT_DEFAULT_TARGET_QS` (see `pipeline_config.py`).
- **CER**: `jiwer` library. Reference = corrected (human GT), hypothesis = pre-correction model output.
- **Translation**: free Google endpoint via `deep-translator` (no API key). For production, swap in DeepL or Argos.
