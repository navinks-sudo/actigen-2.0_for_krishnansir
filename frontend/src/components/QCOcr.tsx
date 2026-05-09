import { useEffect, useMemo, useState } from "react";
import { Play, Check, X, RotateCcw, ScanText, ZoomIn, ZoomOut, Languages, Loader2, BarChart3 } from "lucide-react";
import { api, DocumentT } from "../lib/api";
import StageSourcePages from "./StageSourcePages";
import OcrConfidenceHeatmap from "./OcrConfidenceHeatmap";
import { previewCerPercent } from "../lib/cer";
import { documentHasPageMarkers, joinMarkedPages, splitMarkedPages } from "../lib/pageText";

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
}

function buildPageOcrState(doc: DocumentT): Record<number, string> {
  const pages = doc.pages ?? [];
  if (pages.length === 0) return {};
  const splitCorrected = splitMarkedPages(doc.corrected_ocr ?? "");
  const out: Record<number, string> = {};
  for (const p of pages) {
    const fromRow = p.corrected_ocr_text ?? p.ocr_text;
    if (fromRow != null && fromRow.trim() !== "") {
      out[p.page_index] = fromRow;
    } else {
      out[p.page_index] = splitCorrected[p.page_index] ?? "";
    }
  }
  return out;
}

function buildPageEnglishState(doc: DocumentT): Record<number, string> {
  const pages = doc.pages ?? [];
  if (pages.length === 0) return {};
  const splitCorrected = splitMarkedPages(doc.corrected_ocr_english ?? "");
  const splitRaw = splitMarkedPages(doc.raw_ocr_english ?? "");
  const out: Record<number, string> = {};
  for (const p of pages) {
    const fromRow = p.corrected_ocr_text_english ?? p.ocr_text_english;
    if (fromRow != null && fromRow.trim() !== "") {
      out[p.page_index] = fromRow;
    } else {
      out[p.page_index] = splitCorrected[p.page_index] ?? splitRaw[p.page_index] ?? "";
    }
  }
  return out;
}

function rawModelForPage(doc: DocumentT, pageIndex: number): string {
  const row = doc.pages?.find((x) => x.page_index === pageIndex);
  if (row?.ocr_text != null && row.ocr_text.trim() !== "") return row.ocr_text;
  const split = splitMarkedPages(doc.raw_ocr ?? "");
  return split[pageIndex] ?? "";
}

export default function QCOcr({ doc, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [text, setText] = useState(doc.corrected_ocr ?? doc.raw_ocr ?? "");
  const [englishText, setEnglishText] = useState(doc.corrected_ocr_english ?? doc.raw_ocr_english ?? "");
  const [pageEdits, setPageEdits] = useState<Record<number, string>>({});
  const [pageEnglishEdits, setPageEnglishEdits] = useState<Record<number, string>>({});
  const [englishSaved, setEnglishSaved] = useState(true);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [saved, setSaved] = useState(true);
  const [fontPx, setFontPx] = useState(14);
  const FONT_MIN = 10;
  const FONT_MAX = 28;
  const FONT_STEP = 2;
  const [ocrLang, setOcrLang] = useState<string>("auto");
  const [langs, setLangs] = useState<{ code: string; label: string }[]>([
    { code: "auto", label: "Auto" },
    { code: "eng", label: "English" },
    { code: "kan", label: "Kannada" },
    { code: "hin", label: "Hindi" },
    { code: "tam", label: "Tamil" },
    { code: "tel", label: "Telugu" },
    { code: "mal", label: "Malayalam" },
    { code: "ben", label: "Bengali" },
    { code: "guj", label: "Gujarati" },
    { code: "mar", label: "Marathi" },
  ]);

  useEffect(() => {
    api.ocrLanguages().then((list) => {
      if (Array.isArray(list) && list.length > 0) setLangs(list);
    }).catch(() => {});
  }, []);

  const pages = doc.pages ?? [];
  const perPageMode = pages.length > 0;

  useEffect(() => {
    setSelectedPageIndex(0);
  }, [doc.id]);

  useEffect(() => {
    const list = doc.pages ?? [];
    if (list.length > 0) {
      setPageEdits(buildPageOcrState(doc));
      setPageEnglishEdits(buildPageEnglishState(doc));
      setSelectedPageIndex((i) => Math.max(0, Math.min(i, list.length - 1)));
    } else {
      setText(doc.corrected_ocr ?? doc.raw_ocr ?? "");
      setEnglishText(doc.corrected_ocr_english ?? doc.raw_ocr_english ?? "");
    }
    setSaved(true);
    setEnglishSaved(true);
  }, [
    doc.id,
    doc.raw_ocr,
    doc.corrected_ocr,
    doc.raw_ocr_english,
    doc.corrected_ocr_english,
    doc.pages,
  ]);

  const run = async () => {
    setBusy(true);
    try {
      onUpdate(await api.ocr(doc.id, ocrLang === "auto" ? undefined : ocrLang));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (perPageMode) {
        const sorted = [...pages].sort((a, b) => a.page_index - b.page_index);
        const combined = joinMarkedPages(
          sorted.map((p) => [p.page_index, pageEdits[p.page_index] ?? ""] as [number, string]),
        );
        const pages_english = sorted.map((p) => ({
          page_index: p.page_index,
          corrected_ocr_text_english: pageEnglishEdits[p.page_index] ?? "",
        }));
        onUpdate(
          await api.correctOcr(doc.id, {
            corrected_text: combined,
            pages_english,
          }),
        );
      } else {
        onUpdate(
          await api.correctOcr(doc.id, {
            corrected_text: text,
            corrected_english: englishText,
          }),
        );
      }
      setSaved(true);
      setEnglishSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const translateToEnglish = async () => {
    setTranslating(true);
    try {
      onUpdate(await api.translateOcrToEnglish(doc.id, "auto"));
      setEnglishSaved(true);
    } finally {
      setTranslating(false);
    }
  };
  const approve = async () => {
    if (!saved || !englishSaved) await save();
    setBusy(true);
    try {
      onUpdate(await api.approve(doc.id));
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      onUpdate(await api.reject(doc.id));
    } finally {
      setBusy(false);
    }
  };

  const ready = doc.raw_ocr !== null;

  const showLegacyOcrBanner =
    perPageMode && Boolean(doc.raw_ocr) && !documentHasPageMarkers(doc.raw_ocr);

  const curPageText = perPageMode ? (pageEdits[selectedPageIndex] ?? "") : text;
  const curRawModel = perPageMode
    ? rawModelForPage(doc, selectedPageIndex)
    : doc.raw_ocr ?? "";

  const displayCer = useMemo(() => {
    if (doc.raw_ocr == null) return null;
    if (perPageMode) {
      if (!saved) return previewCerPercent(curPageText, curRawModel);
      const row = pages.find((p) => p.page_index === selectedPageIndex);
      if (row) {
        return previewCerPercent(row.corrected_ocr_text ?? "", row.ocr_text ?? "");
      }
      return previewCerPercent(curPageText, curRawModel);
    }
    if (!saved) return previewCerPercent(text, doc.raw_ocr);
    if (doc.ocr_cer != null && doc.ocr_cer !== undefined) return doc.ocr_cer;
    return previewCerPercent(doc.corrected_ocr ?? "", doc.raw_ocr);
  }, [
    doc.raw_ocr,
    doc.ocr_cer,
    doc.corrected_ocr,
    text,
    curPageText,
    curRawModel,
    perPageMode,
    pages,
    selectedPageIndex,
    saved,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-200 to-cyan-200 flex items-center justify-center">
              <ScanText className="w-5 h-5 text-sky-700" />
            </span>
            Text IQ — OCR
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            {perPageMode
              ? "Each page is OCR’d separately. Click a thumbnail to edit that page’s text; save stores all pages."
              : "Edit the text — your version becomes ground truth and CER is computed against the model output."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900">
            Language
            <select
              value={ocrLang}
              onChange={(e) => setOcrLang(e.target.value)}
              disabled={busy}
              className="bg-white text-ink-800 rounded-md border border-sky-200 px-1.5 py-0.5 text-xs font-normal"
              title="Pick the script of the document. Tesseract uses the matching multi-script lang; EasyOCR fallback uses the matching code list."
            >
              {langs.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          {!ready && (
            <button type="button" onClick={run} disabled={busy} className="btn-primary">
              <Play className="w-4 h-4" /> Run OCR
            </button>
          )}
          {ready && (
            <>
              <button type="button" onClick={run} disabled={busy} className="btn-ghost">
                <RotateCcw className="w-4 h-4" /> Re-run
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || (saved && englishSaved)}
                className="btn-soft"
              >
                Save edits
              </button>
              <button type="button" onClick={reject} disabled={busy} className="btn-danger">
                <X className="w-4 h-4" /> Reject
              </button>
              <button type="button" onClick={approve} disabled={busy} className="btn-primary">
                <Check className="w-4 h-4" /> Approve & Continue
              </button>
            </>
          )}
        </div>
      </div>

      {showLegacyOcrBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Stored OCR has no per-page{' '}
          <code className="rounded bg-amber-100/80 px-1 text-xs">=== PAGE N ===</code> markers, so the full
          text may appear only on page 1. Click <strong>Re-run</strong> to run Text IQ on each raster (retrying
          original images when enhanced output is blank).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-start">
        <div className="lg:sticky lg:top-2 self-start flex flex-col gap-2">
          {perPageMode && pages.length > 1 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                disabled={selectedPageIndex <= 0}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Previous page"
              >
                ← Prev
              </button>
              <span className="font-mono text-sky-900">
                Page {selectedPageIndex + 1} of {pages.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedPageIndex((i) => Math.min(pages.length - 1, i + 1))
                }
                disabled={selectedPageIndex >= pages.length - 1}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Next page"
              >
                Next →
              </button>
            </div>
          )}
          <StageSourcePages
            doc={doc}
            compact
            showOnly="enhanced"
            singlePage
            title={
              perPageMode
                ? `Enhanced image — page ${selectedPageIndex + 1} (use Prev / Next to switch)`
                : "Enhanced image"
            }
            selectedPageIndex={perPageMode ? selectedPageIndex : undefined}
            onSelectPage={perPageMode ? setSelectedPageIndex : undefined}
          />
        </div>
        <div className="flex flex-col gap-4 min-h-0">
          <div className="pane p-4 border-sky-200/80 ring-1 ring-sky-100 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
              <div className="label text-sky-900">
                {perPageMode
                  ? `Editable OCR — page ${selectedPageIndex + 1} of ${pages.length}`
                  : "Editable OCR output"}
              </div>
              <div className="flex items-center gap-2">
                {!saved && <span className="chip bg-amber-100 text-amber-800">unsaved</span>}
                <div className="flex items-center gap-0.5 rounded-lg border border-sky-200 bg-white p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setFontPx((s) => Math.max(FONT_MIN, s - FONT_STEP))}
                    disabled={fontPx <= FONT_MIN}
                    className="rounded-md p-1 text-ink-600 hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-35"
                    aria-label="Zoom out OCR text"
                    title="Smaller text"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontPx(14)}
                    className="min-w-[2.5rem] px-1 text-center text-[11px] font-mono font-semibold tabular-nums text-ink-700 hover:text-ink-900"
                    title="Reset text size"
                    aria-label={`Reset text size, currently ${fontPx} pixels`}
                  >
                    {fontPx}px
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontPx((s) => Math.min(FONT_MAX, s + FONT_STEP))}
                    disabled={fontPx >= FONT_MAX}
                    className="rounded-md p-1 text-ink-600 hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-35"
                    aria-label="Zoom in OCR text"
                    title="Larger text"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <textarea
              value={perPageMode ? curPageText : text}
              onChange={(e) => {
                if (perPageMode) {
                  setPageEdits((prev) => ({ ...prev, [selectedPageIndex]: e.target.value }));
                } else {
                  setText(e.target.value);
                }
                setSaved(false);
              }}
              style={{ fontSize: `${fontPx}px`, lineHeight: 1.55 }}
              className="input font-mono flex-1 min-h-[clamp(28rem,55vh,52rem)] w-full resize-y leading-relaxed"
              placeholder="OCR text will appear here…"
            />
          </div>

          {ready && perPageMode && (() => {
            const row = pages.find((p) => p.page_index === selectedPageIndex);
            const boxes = row?.ocr_boxes ?? [];
            if (!boxes || boxes.length === 0) return null;
            return (
              <details className="pane p-3 border-violet-200/80 ring-1 ring-violet-100" open>
                <summary className="cursor-pointer select-none label text-violet-900 inline-flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Word & character confidence — page {selectedPageIndex + 1}
                </summary>
                <div className="mt-3">
                  <OcrConfidenceHeatmap boxes={boxes} />
                </div>
              </details>
            );
          })()}

          {ready && !perPageMode && (doc.pages?.[0]?.ocr_boxes?.length ?? 0) > 0 && (
            <details className="pane p-3 border-violet-200/80 ring-1 ring-violet-100" open>
              <summary className="cursor-pointer select-none label text-violet-900 inline-flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                Word & character confidence
              </summary>
              <div className="mt-3">
                <OcrConfidenceHeatmap boxes={doc.pages?.[0]?.ocr_boxes ?? []} />
              </div>
            </details>
          )}

          {ready && (
            <div className="pane p-4 border-emerald-200/80 ring-1 ring-emerald-100 flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap shrink-0">
                <div className="label text-emerald-900 inline-flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5" />
                  {perPageMode
                    ? `English translation — page ${selectedPageIndex + 1} of ${pages.length}`
                    : "English translation"}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {!englishSaved && <span className="chip bg-amber-100 text-amber-800">unsaved</span>}
                  <button
                    type="button"
                    onClick={translateToEnglish}
                    disabled={busy || translating}
                    className="btn-primary text-xs px-2 py-1 inline-flex items-center gap-1"
                    title="Translate every page's OCR to English (Google free endpoint). Classify / Index / Abstract will use this."
                  >
                    {translating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Languages className="w-3.5 h-3.5" />
                    )}
                    {(doc.raw_ocr_english ?? "").trim() ? "Re-translate to English" : "Translate to English"}
                  </button>
                </div>
              </div>
              <textarea
                value={
                  perPageMode
                    ? pageEnglishEdits[selectedPageIndex] ?? ""
                    : englishText
                }
                onChange={(e) => {
                  if (perPageMode) {
                    setPageEnglishEdits((prev) => ({ ...prev, [selectedPageIndex]: e.target.value }));
                  } else {
                    setEnglishText(e.target.value);
                  }
                  setEnglishSaved(false);
                }}
                style={{ fontSize: `${fontPx}px`, lineHeight: 1.55 }}
                className="input flex-1 min-h-[clamp(24rem,50vh,44rem)] w-full resize-y leading-relaxed"
                placeholder='Click "Translate to English" to fill this box. Classify / Index / Abstract will use this English text downstream.'
              />
              <p className="text-[11px] text-emerald-900/80 mt-2 leading-snug">
                <strong>Why this matters:</strong> downstream stages (Classify / Index / Abstract) operate on this English version
                when present, so non-Latin scripts (Kannada, Hindi, …) classify correctly. Edit freely; <strong>Save edits</strong>
                stores both source and English text.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="pane p-4">
              <div className="label flex items-center gap-2">
                CER
                {!saved && doc.raw_ocr != null && (
                  <span className="text-[10px] font-normal normal-case text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                    live
                  </span>
                )}
              </div>
              <div className="text-3xl font-bold mt-1 text-ink-900">
                {displayCer !== null ? `${displayCer.toFixed(2)}%` : "—"}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {perPageMode
                  ? "This page: raw model vs your corrected text. Save to store full-document CER on the server."
                  : "Raw model vs corrected (ground truth). Save edits to store server-side CER."}
              </div>
            </div>
            <div className="pane p-4">
              <div className="label">Char count</div>
              <div className="text-3xl font-bold mt-1 text-ink-900">{curPageText.length}</div>
              <div className="text-xs text-ink-500 mt-1">
                {perPageMode ? "corrected text (this page)" : "corrected text"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
