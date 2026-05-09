import { useEffect, useMemo, useState } from "react";
import { Play, Check, X, RotateCcw, FileText, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { api, DocumentT } from "../lib/api";
import StageSourcePages from "./StageSourcePages";
import ImageLightbox from "./ImageLightbox";
import DocumentChat from "./DocumentChat";
import { documentHasPageMarkers, splitMarkedPages } from "../lib/pageText";
import { previewCerPercent } from "../lib/cer";

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
}

export default function QCAbstract({ doc, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  /** Single-page combined summary text */
  const [text, setText] = useState(doc.corrected_abstract ?? doc.abstract ?? "");
  /** Multi-page: editable summary per page_index */
  const [pageEdits, setPageEdits] = useState<Record<number, string>>({});
  /** Document-wide summary (separate from per-page). */
  const [overallEdit, setOverallEdit] = useState(
    doc.corrected_overall_abstract ?? doc.overall_abstract ?? "",
  );
  const [saved, setSaved] = useState(true);
  const [fontPx, setFontPx] = useState(14);
  const FONT_MIN = 10;
  const FONT_MAX = 28;
  const FONT_STEP = 2;
  const editorStyle = { fontSize: `${fontPx}px`, lineHeight: 1.55 } as const;
  const ZoomBar = () => (
    <div className="flex items-center gap-0.5 rounded-lg border border-amber-200 bg-white p-0.5 shadow-sm">
      <button
        type="button"
        onClick={() => setFontPx((s) => Math.max(FONT_MIN, s - FONT_STEP))}
        disabled={fontPx <= FONT_MIN}
        className="rounded-md p-1 text-ink-600 hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-35"
        aria-label="Zoom out summary text"
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
        className="rounded-md p-1 text-ink-600 hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-35"
        aria-label="Zoom in summary text"
        title="Larger text"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const pages = doc.pages ?? [];
  const multi = pages.length > 1;
  const hasPages = pages.length > 0;
  const ready = doc.abstract !== null;
  /** Per-page rows + abstract generated — includes single-page PDFs (backend still stores page_abstract + markers in doc.abstract). */
  const usePerPageSummaryUi = hasPages && ready;
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setSelectedPageIndex(0);
  }, [doc.id]);

  useEffect(() => {
    setSelectedPageIndex((i) => Math.max(0, Math.min(i, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  useEffect(() => {
    const list = doc.pages ?? [];
    const splitCorr = splitMarkedPages(doc.corrected_abstract ?? "");
    const splitAbs = splitMarkedPages(doc.abstract ?? "");
    const next: Record<number, string> = {};
    for (const p of list) {
      const fromRow = p.corrected_page_abstract ?? p.page_abstract;
      if (fromRow != null && fromRow.trim() !== "") {
        next[p.page_index] = fromRow;
      } else {
        next[p.page_index] = splitCorr[p.page_index] ?? splitAbs[p.page_index] ?? "";
      }
    }
    setPageEdits(next);
    setText(doc.corrected_abstract ?? doc.abstract ?? "");
    setOverallEdit(doc.corrected_overall_abstract ?? doc.overall_abstract ?? "");
    setSaved(true);
  }, [
    doc.id,
    doc.abstract,
    doc.corrected_abstract,
    doc.pages,
    doc.overall_abstract,
    doc.corrected_overall_abstract,
  ]);

  const splitModelByPage = useMemo(() => splitMarkedPages(doc.abstract ?? ""), [doc.abstract]);

  const run = async () => {
    setBusy(true);
    try {
      onUpdate(await api.abstract(doc.id));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      // Per-page summary editor was removed — we only persist the document-wide summary now.
      onUpdate(
        await api.correctAbstract(doc.id, {
          corrected_overall_abstract: overallEdit,
        }),
      );
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!saved) await save();
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

  const legacyAbstractBanner =
    hasPages &&
    ready &&
    Boolean((doc.corrected_abstract ?? doc.abstract ?? "").trim()) &&
    !documentHasPageMarkers(doc.corrected_abstract ?? doc.abstract ?? "");

  const selectedRow = pages.find((p) => p.page_index === selectedPageIndex) ?? pages[0];
  const lightboxArrayIndex = Math.max(
    0,
    pages.findIndex((p) => p.page_index === selectedPageIndex),
  );

  const modelForSelected =
    (selectedRow?.page_abstract ?? "").trim() !== ""
      ? (selectedRow?.page_abstract ?? "")
      : splitModelByPage[selectedPageIndex] ?? "";
  const editForSelected = pageEdits[selectedPageIndex] ?? "";

  const cerSelectedPage = useMemo(() => {
    if (!modelForSelected.trim()) return null;
    if (!saved) return previewCerPercent(editForSelected, modelForSelected);
    const gt = selectedRow?.corrected_page_abstract ?? editForSelected;
    const hyp = selectedRow?.page_abstract ?? modelForSelected;
    return previewCerPercent(gt, hyp);
  }, [
    modelForSelected,
    editForSelected,
    saved,
    selectedRow?.corrected_page_abstract,
    selectedRow?.page_abstract,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-200 to-orange-200 flex items-center justify-center">
              <FileText className="w-5 h-5 text-amber-700" />
            </span>
            Abstractor — Summary
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            LSA extractive summarization from each page&apos;s OCR (one summary block per page).{" "}
            {multi ? (
              <>
                Click a page thumbnail to switch pages; use <strong>View full</strong> for fullscreen Original / Enhanced
                previews.
              </>
            ) : hasPages ? (
              <>Use <strong>View full</strong> for fullscreen previews. CER compares your text to the model for this page.</>
            ) : (
              <>Edit the summary below; CER compares your text to the model output.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!ready && (
            <button type="button" onClick={run} disabled={busy} className="btn-primary">
              <Play className="w-4 h-4" /> Generate Summary
            </button>
          )}
          {ready && (
            <>
              <button type="button" onClick={run} disabled={busy} className="btn-ghost">
                <RotateCcw className="w-4 h-4" /> Re-run
              </button>
              <button type="button" onClick={save} disabled={busy || saved} className="btn-soft">
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

      {legacyAbstractBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Combined summary has no <code className="rounded bg-amber-100/80 px-1 text-xs">PAGE</code> markers (one blob
          for the whole PDF). Only page 1 is filled below from that text — click <strong>Re-run</strong> on Abstractor
          after OCR so each page gets its own summary.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-start">
        <div className="lg:sticky lg:top-2 self-start flex flex-col gap-2">
          {multi && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                disabled={selectedPageIndex <= 0}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Previous page"
              >
                ← Prev
              </button>
              <span className="font-mono text-amber-900">
                Page {selectedPageIndex + 1} of {pages.length}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.min(pages.length - 1, i + 1))}
                disabled={selectedPageIndex >= pages.length - 1}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Next page"
              >
                Next →
              </button>
            </div>
          )}
          {hasPages && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="btn-soft inline-flex items-center gap-2 text-xs"
                title="Open the full-screen comparison"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                View full
              </button>
            </div>
          )}
          <StageSourcePages
            doc={doc}
            title={multi ? `Enhanced image — page ${selectedPageIndex + 1}` : "Enhanced image"}
            compact
            showOnly="enhanced"
            singlePage
            selectedPageIndex={multi ? selectedPageIndex : undefined}
            onSelectPage={multi ? setSelectedPageIndex : undefined}
          />
        </div>

        <div className="space-y-5">

      {ready && (doc.overall_abstract != null || doc.corrected_overall_abstract != null) && (
        <div className="pane p-5 border border-amber-200 ring-1 ring-amber-100 bg-gradient-to-br from-amber-50/60 to-orange-50/40">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="label text-amber-900">
              Document-wide summary ({multi ? `across ${pages.length} pages` : "single page"})
            </div>
            <div className="flex items-center gap-2">
              {!saved && <span className="chip bg-amber-100 text-amber-800">unsaved</span>}
              <ZoomBar />
            </div>
          </div>
          <p className="text-xs text-ink-600 mb-2 leading-relaxed">
            Long-form summary of the whole document — distinct from the per-page summaries below. Edit freely; saves
            with the per-page edits when you click <strong>Save edits</strong>.
          </p>
          <textarea
            value={overallEdit}
            onChange={(e) => {
              setOverallEdit(e.target.value);
              setSaved(false);
            }}
            style={editorStyle}
            className="input min-h-[clamp(11rem,28vh,18rem)] resize-y w-full leading-relaxed"
            placeholder="Document-wide summary…"
            aria-label="Document-wide summary"
          />
          <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-500">
            <span>Sentences: {overallEdit.split(/[.!?]+/).filter((s) => s.trim()).length}</span>
            <span>Chars: {overallEdit.length}</span>
            {doc.overall_abstract && doc.overall_abstract !== overallEdit && (
              <button
                type="button"
                onClick={() => {
                  setOverallEdit(doc.overall_abstract ?? "");
                  setSaved(false);
                }}
                className="ml-auto text-amber-700 hover:text-amber-900 underline"
              >
                Reset to model output
              </button>
            )}
          </div>
        </div>
      )}

      {!saved && ready && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          You have unsaved summary edits — click <strong>Save edits</strong> before approve.
        </div>
      )}
        </div>
      </div>

      {hasPages && (
        <ImageLightbox
          pages={pages}
          index={lightboxArrayIndex}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={(i) => {
            const pg = pages[i];
            if (pg) setSelectedPageIndex(pg.page_index);
          }}
          sopTarget={doc.target_qs}
          cacheVersion={doc.updated_at}
          documentId={doc.id}
          documentInitialQs={doc.initial_qs}
          documentPostQs={doc.post_qs}
        />
      )}

      <DocumentChat doc={doc} />
    </div>
  );
}
