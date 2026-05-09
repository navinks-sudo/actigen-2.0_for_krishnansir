import { useEffect, useState } from "react";
import { Play, Languages, Copy, Maximize2, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { api, DocumentT } from "../lib/api";
import StageSourcePages from "./StageSourcePages";
import ImageLightbox from "./ImageLightbox";

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
}

export default function QCLingua({ doc, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(doc.target_language || "hi");
  const [langs, setLangs] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [fontPx, setFontPx] = useState(14);
  const FONT_MIN = 10;
  const FONT_MAX = 28;
  const FONT_STEP = 2;
  const blockStyle = { fontSize: `${fontPx}px`, lineHeight: 1.55 } as const;

  const ZoomBar = () => (
    <div className="flex items-center gap-0.5 rounded-lg border border-cyan-200 bg-white p-0.5 shadow-sm">
      <button
        type="button"
        onClick={() => setFontPx((s) => Math.max(FONT_MIN, s - FONT_STEP))}
        disabled={fontPx <= FONT_MIN}
        className="rounded-md p-1 text-ink-600 hover:bg-cyan-50 disabled:pointer-events-none disabled:opacity-35"
        aria-label="Zoom out translation text"
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
        className="rounded-md p-1 text-ink-600 hover:bg-cyan-50 disabled:pointer-events-none disabled:opacity-35"
        aria-label="Zoom in translation text"
        title="Larger text"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  useEffect(() => {
    api.languages().then(setLangs).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedPageIndex(0);
  }, [doc.id]);

  const pages = doc.pages ?? [];
  const hasPages = pages.length > 0;
  const multiPages = pages.length > 1;

  useEffect(() => {
    setSelectedPageIndex((i) => Math.max(0, Math.min(i, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  const run = async () => {
    setBusy(true);
    try {
      onUpdate(await api.translate(doc.id, target));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const full = doc.translation;
    if (full) {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  /** Build the English source for whole-document translation. Prefer the overall summary
   *  (cleaner, shorter), then translated-to-English OCR, then any remaining text. */
  const sourceCombined =
    doc.corrected_overall_abstract ||
    doc.overall_abstract ||
    doc.corrected_abstract ||
    doc.abstract ||
    doc.corrected_ocr_english ||
    doc.raw_ocr_english ||
    doc.corrected_ocr ||
    doc.raw_ocr ||
    "";

  const lightboxArrayIndex = Math.max(0, pages.findIndex((p) => p.page_index === selectedPageIndex));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-200 to-teal-200 flex items-center justify-center">
              <Languages className="w-5 h-5 text-cyan-700" />
            </span>
            Lingua AI — Translation
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            Document-wide translation. Pick a target language and click <strong>Translate</strong>.
            Source is the document's overall summary (English) when present, otherwise the English-translated OCR.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="input w-auto"
          >
            {Object.entries(langs).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
          <button type="button" onClick={run} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Translate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-start">
        <div className="lg:sticky lg:top-2 self-start flex flex-col gap-2">
          {multiPages && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-200 bg-cyan-50/70 px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                disabled={selectedPageIndex <= 0}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Previous page"
              >
                ← Prev
              </button>
              <span className="font-mono text-cyan-900">
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
                title="Open the full-screen image"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                View full
              </button>
            </div>
          )}
          <StageSourcePages
            doc={doc}
            title={multiPages ? `Enhanced image — page ${selectedPageIndex + 1}` : "Enhanced image"}
            compact
            showOnly="enhanced"
            singlePage
            selectedPageIndex={multiPages ? selectedPageIndex : undefined}
            onSelectPage={multiPages ? setSelectedPageIndex : undefined}
          />
        </div>

        <div className="space-y-5">
          <div className="pane p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="label inline-flex items-center gap-1.5">
                Source (English) — full document
              </div>
              <ZoomBar />
            </div>
            <pre
              style={blockStyle}
              className="whitespace-pre-wrap p-3 rounded-xl bg-ink-50 border border-ink-100 min-h-[16rem] max-h-[min(60vh,36rem)] overflow-auto text-ink-800"
            >
              {sourceCombined || (
                <span className="text-ink-400 italic">
                  No English source available yet — complete OCR (and Translate-to-English) and Abstract first.
                </span>
              )}
            </pre>
          </div>

          <div className="pane p-4 border-cyan-200 ring-1 ring-cyan-100 bg-gradient-to-br from-cyan-50/40 to-teal-50/30">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="label text-cyan-900">
                Translated → {langs[target] || target}
              </div>
              <div className="flex items-center gap-2">
                {doc.translation && (
                  <button type="button" onClick={copy} className="btn-ghost px-2 py-1 text-xs">
                    <Copy className="w-3 h-3" /> {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
            </div>
            <pre
              style={blockStyle}
              className="whitespace-pre-wrap p-3 rounded-xl bg-white border border-cyan-200 min-h-[20rem] max-h-[min(72vh,52rem)] overflow-auto text-ink-900"
            >
              {doc.translation || (
                <span className="text-ink-400 italic">
                  Pick a target language above and click <strong>Translate</strong>. The whole-document English source will be translated.
                </span>
              )}
            </pre>
          </div>
        </div>
      </div>

      {hasPages && multiPages && (
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

      {doc.status === "completed" && (
        <div className="surface p-5 text-center bg-gradient-to-br from-emerald-50 to-white border border-emerald-200">
          <div className="text-emerald-700 font-bold text-lg">Pipeline Complete</div>
          <div className="text-sm text-ink-600 mt-1">All 6 stages finished. Document is ready.</div>
        </div>
      )}
    </div>
  );
}
