import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { DocumentT, DocumentPageT, documentRasterUrl } from "../lib/api";
import BlobFetchImg from "./BlobFetchImg";
import ImageZoomViewport from "./ImageZoomViewport";

const SO_SCALE_MIN = 0.5;
const SO_SCALE_MAX = 4;
const SO_SCALE_STEP = 1.2;

function PageQsBadge({
  initial,
  post,
  variant,
}: {
  initial: number | null | undefined;
  post: number | null | undefined;
  variant: "original" | "enhanced";
}) {
  const showInitial = typeof initial === "number" && !Number.isNaN(initial);
  const showPost = typeof post === "number" && !Number.isNaN(post);
  if (variant === "original" && !showInitial) return null;
  if (variant === "enhanced" && !showInitial && !showPost) return null;

  const delta = showInitial && showPost ? Number(post) - Number(initial) : null;
  const tone =
    variant === "enhanced"
      ? showPost && Number(post) >= 90
        ? "border-emerald-300 bg-emerald-50/95 text-emerald-900"
        : showPost && Number(post) >= 60
          ? "border-amber-300 bg-amber-50/95 text-amber-900"
          : "border-rose-300 bg-rose-50/95 text-rose-900"
      : "border-ink-200 bg-white/95 text-ink-800";

  return (
    <div
      className={`pointer-events-none absolute right-1.5 top-1.5 z-20 rounded-md border px-1.5 py-0.5 shadow-sm backdrop-blur-sm ${tone}`}
    >
      <div className="flex items-center gap-1 text-[10px] font-mono leading-none tabular-nums">
        {variant === "original" ? (
          <>
            <span className="font-bold opacity-70">QS</span>
            <span className="font-bold">{Number(initial).toFixed(1)}</span>
          </>
        ) : (
          <>
            {showInitial && (
              <span className="opacity-70">I {Number(initial).toFixed(1)}</span>
            )}
            {showInitial && showPost && <span className="opacity-50">→</span>}
            {showPost && <span className="font-bold">P {Number(post).toFixed(1)}</span>}
            {delta != null && (
              <span
                className={`ml-0.5 font-bold ${
                  delta >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function PageProgressOverlay({
  progress,
}: {
  progress: { pct: number; label: string; status: "pending" | "active" | "done" };
}) {
  if (progress.status === "done") return null;
  const pct = Math.max(0, Math.min(100, Math.round(progress.pct || 0)));
  const C = 2 * Math.PI * 42; // circumference
  const dash = (pct / 100) * C;
  const isPending = progress.status === "pending";
  const stroke = isPending ? "rgb(168,162,184)" : "rgb(124,58,237)";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/65 backdrop-blur-[2px] pointer-events-none">
      <div className="rounded-2xl border border-violet-200 bg-white/95 p-4 shadow-2xl text-center w-[min(85%,260px)]">
        <div className="relative mx-auto h-20 w-20">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="42" stroke="rgb(238,232,255)" strokeWidth="10" fill="none" />
            <circle
              cx="50"
              cy="50"
              r="42"
              stroke={stroke}
              strokeWidth="10"
              fill="none"
              strokeDasharray={`${dash} ${C}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 250ms ease-out, stroke 200ms" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`text-xl font-bold ${isPending ? "text-ink-400" : "text-violet-700"} tabular-nums`}>
              {isPending ? "…" : `${pct}%`}
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-ink-700 leading-tight line-clamp-2">{progress.label}</div>
      </div>
    </div>
  );
}


function ZoomableEnhancedThumb({
  url,
  alt,
  cellH,
  ringClass = "",
  cellInteractive = "",
  onCellClick,
  onCellKeyDown,
  ariaLabel,
}: {
  url: string;
  alt: string;
  cellH: string;
  ringClass?: string;
  cellInteractive?: string;
  onCellClick?: () => void;
  onCellKeyDown?: (e: ReactKeyboardEvent) => void;
  ariaLabel?: string;
}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; px: number; py: number; moved: boolean }>(
    { active: false, startX: 0, startY: 0, px: 0, py: 0, moved: false },
  );
  const [grabbing, setGrabbing] = useState(false);
  const stop = (e: React.MouseEvent | ReactKeyboardEvent) => e.stopPropagation();
  const zoomIn = () => setScale((s) => Math.min(SO_SCALE_MAX, Math.round(s * SO_SCALE_STEP * 100) / 100));
  const zoomOut = () => setScale((s) => Math.max(SO_SCALE_MIN, Math.round((s / SO_SCALE_STEP) * 100) / 100));
  const reset = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      px: pan.x,
      py: pan.y,
      moved: false,
    };
    setGrabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setPan({ x: d.px + dx, y: d.py + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    dragRef.current.active = false;
    setGrabbing(false);
  };
  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onCellClick) onCellClick();
  };
  const atMin = scale <= SO_SCALE_MIN + 0.001;
  const atMax = scale >= SO_SCALE_MAX - 0.001;
  const interactiveProps = onCellClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: onCellKeyDown,
        "aria-label": ariaLabel,
      }
    : {};
  const cursorClass = grabbing ? "cursor-grabbing" : "cursor-grab";
  return (
    <div
      ref={containerRef}
      className={`relative w-full shrink-0 overflow-hidden bg-ink-50 min-h-0 ${cellH} ${cellInteractive} ${ringClass} ${cursorClass} select-none`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      {...interactiveProps}
    >
      <div className="pointer-events-auto absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5 rounded-lg border border-zinc-200/90 bg-white/95 p-0.5 shadow-md backdrop-blur-sm">
        <button
          type="button"
          onClick={(e) => { stop(e); zoomOut(); }}
          disabled={atMin}
          className="rounded-md p-1 text-zinc-700 hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { stop(e); reset(); }}
          className="min-w-[2.25rem] px-1 text-center text-[10px] font-mono font-semibold tabular-nums text-zinc-700 hover:text-zinc-900"
          title="Reset zoom (Ctrl/⌘ + scroll on image to zoom)"
          aria-label={`Reset zoom, currently ${Math.round(scale * 100)} percent`}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={(e) => { stop(e); zoomIn(); }}
          disabled={atMax}
          className="rounded-md p-1 text-zinc-700 hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>
      <BlobFetchImg
        key={url}
        url={url}
        alt={alt}
        className="absolute left-1/2 top-1/2 block max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 object-contain pointer-events-none"
        style={{
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
          transformOrigin: "center center",
          transition: dragRef.current.active ? "none" : "transform 150ms ease-out",
        }}
      />
    </div>
  );
}

type Props = {
  doc: DocumentT;
  /** Heading above thumbnails */
  title?: string;
  /** Smaller thumbnails / denser grid (for narrow columns) */
  compact?: boolean;
  /**
   * Image Enhancement QC: large Original / Enhanced previews (overrides `compact` for image sizing).
   */
  variant?: "enhancement";
  /** When set with `onSelectPage`, thumbnails are clickable and the active page is highlighted. */
  selectedPageIndex?: number;
  onSelectPage?: (pageIndex: number) => void;
  /** Show Original + Enhanced rasters and pipeline stage chips (default true). */
  showPipeline?: boolean;
  /** When set, clicking either Original or Enhanced raster opens this callback (page index passed). */
  onOpenLightbox?: (pageIndex: number) => void;
  /** Render only the chosen layer (full cell width). Used by OCR / Classify / Index where only one
   *  raster is meaningful. Falls back to the other layer if the chosen one is missing for that page. */
  showOnly?: "enhanced" | "original";
  /** Live per-page enhancement progress. Keyed by 0-based page index. Renders a centered overlay
   *  with a circular progress + label until ``status === 'done'``. */
  pageProgress?: Record<number, { pct: number; label: string; status: "pending" | "active" | "done" }>;
  /** When true, only the page matching ``selectedPageIndex`` is rendered (instead of every page).
   *  Lets the OCR / Classify / Index views keep the image sticky in view while the right column scrolls. */
  singlePage?: boolean;
};

type StageDef = {
  short: string;
  /** Per-page completion when `page` is set */
  pageDone: (p: DocumentPageT) => boolean;
  /** Document-level completion (classify, index, or single-page doc without rows) */
  docDone: (d: DocumentT) => boolean;
  /** If true, only `docDone` is used (same on every page card) */
  docOnly?: boolean;
};

const PIPELINE_STAGES: StageDef[] = [
  {
    short: "Enhance",
    pageDone: (p) => Boolean(p.enhanced_path),
    docDone: (d) => Boolean(d.enhanced_path),
  },
  {
    short: "Text IQ",
    pageDone: (p) =>
      Boolean((p.ocr_text && p.ocr_text.trim()) || (p.corrected_ocr_text && p.corrected_ocr_text.trim())),
    docDone: (d) => Boolean((d.raw_ocr && d.raw_ocr.trim()) || (d.corrected_ocr && d.corrected_ocr.trim())),
  },
  {
    short: "Classify",
    pageDone: (p) => Boolean(p.page_doc_class && String(p.page_doc_class).trim()),
    docDone: (d) => Boolean(d.doc_class && String(d.doc_class).trim()),
  },
  {
    short: "Index",
    pageDone: () => false,
    docDone: (d) => Boolean(d.index_metadata && Object.keys(d.index_metadata).length > 0),
    docOnly: true,
  },
  {
    short: "Abstract",
    pageDone: (p) =>
      Boolean(
        (p.page_abstract && p.page_abstract.trim()) ||
          (p.corrected_page_abstract && p.corrected_page_abstract.trim()),
      ),
    docDone: (d) =>
      Boolean((d.abstract && d.abstract.trim()) || (d.corrected_abstract && d.corrected_abstract.trim())),
  },
  {
    short: "Lingua",
    pageDone: (p) => Boolean(p.page_translation && p.page_translation.trim()),
    docDone: (d) => Boolean(d.translation && d.translation.trim()),
  },
];

function stageComplete(doc: DocumentT, page: DocumentPageT | null, s: StageDef): boolean {
  if (s.docOnly) return s.docDone(doc);
  if (!page) return s.docDone(doc);
  const multi = (doc.pages?.length ?? 0) > 1;
  if (multi) return s.pageDone(page);
  return s.pageDone(page) || s.docDone(doc);
}

export default function StageSourcePages({
  doc,
  title = "Source pages",
  compact = false,
  variant,
  selectedPageIndex,
  onSelectPage,
  showPipeline = true,
  onOpenLightbox,
  showOnly,
  pageProgress,
  singlePage,
}: Props) {
  const allPages = doc.pages ?? [];
  const pages = (() => {
    if (!singlePage || selectedPageIndex == null || allPages.length === 0) return allPages;
    const match = allPages.find((p) => p.page_index === selectedPageIndex);
    return match ? [match] : [allPages[0]];
  })();

  const isEnhancementQc = variant === "enhancement";
  const imgClass = isEnhancementQc
    ? "h-[min(58dvh,640px)] w-full max-h-[min(75dvh,820px)] min-h-[min(42dvh,300px)] object-contain"
    : compact
      ? "max-h-[min(52vh,30rem)] w-full object-contain"
      : "max-h-44 w-full object-contain sm:max-h-48";

  const StageChips = ({ page }: { page: DocumentPageT | null }) => (
    <div className="flex flex-wrap gap-1 justify-center mt-2 px-0.5">
      {PIPELINE_STAGES.map((s) => {
        const done = stageComplete(doc, page, s);
        return (
          <span
            key={s.short}
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${
              done
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-ink-50 text-ink-400 border-ink-100"
            }`}
            title={s.docOnly ? `${s.short} (document)` : s.short}
          >
            {s.short}
          </span>
        );
      })}
    </div>
  );

  const ImagePair = ({ page }: { page: DocumentPageT | null }) => {
    const origPath = page?.image_path ?? doc.original_path;
    const enhPath = page?.enhanced_path ?? doc.enhanced_path ?? null;
    const pageIdx = page?.page_index;
    const origFetch =
      origPath && doc.id != null
        ? documentRasterUrl(doc.id, "original", pageIdx, doc.updated_at ?? null)
        : undefined;
    const enhFetch =
      enhPath && doc.id != null
        ? documentRasterUrl(doc.id, "enhanced", pageIdx, doc.updated_at ?? null)
        : undefined;
    const zoomKey = `${origFetch ?? ""}-${enhFetch ?? ""}-${doc.updated_at ?? ""}`;
    const cellH = isEnhancementQc
      ? "aspect-[17/22] max-h-[min(78dvh,820px)]"
      : compact
        ? "min-h-[14rem] h-[min(48vh,28rem)] max-h-[min(62vh,36rem)]"
        : "h-52 min-h-[10rem] max-h-56";
    /** Zoom viewport's inline-block + h-full chain collapses inside flex/scroll parents — use a plain absolute-centered img for compact rails AND the enhancement big-preview layout. */
    const usePlainThumbs = compact || isEnhancementQc;
    const lightboxIdx = page?.page_index ?? 0;
    const cellInteractive =
      isEnhancementQc && onOpenLightbox
        ? "cursor-zoom-in transition hover:ring-2 hover:ring-violet-400/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        : "";
    const cellRoleProps = (label: string) =>
      isEnhancementQc && onOpenLightbox
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: () => onOpenLightbox(lightboxIdx),
            onKeyDown: (e: ReactKeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenLightbox(lightboxIdx);
              }
            },
            "aria-label": `${label} — open full screen comparison`,
          }
        : {};
    const showOriginal = showOnly !== "enhanced";
    const showEnhanced = showOnly !== "original";
    const gridColsClass = showOriginal && showEnhanced ? "grid-cols-2" : "grid-cols-1";
    return (
      <div
        className={`grid min-w-0 ${gridColsClass} ${isEnhancementQc ? "gap-2 md:gap-3" : compact ? "gap-2 sm:gap-3" : "gap-1.5"}`}
      >
        {showOriginal && (
        <div className="relative min-w-0 overflow-hidden rounded-lg border border-ink-100 bg-white">
          <div
            className={`border-b border-ink-100 bg-ink-50 text-center font-semibold text-ink-600 ${
              isEnhancementQc ? "py-2 text-xs sm:text-sm" : compact ? "py-1 text-[10px] sm:text-xs" : "py-0.5 text-[9px]"
            }`}
          >
            Original
          </div>
          {page && (page.initial_qs != null || page.qs_metrics?.qs != null) && (
            <PageQsBadge
              variant="original"
              initial={page.initial_qs ?? page.qs_metrics?.qs ?? null}
              post={null}
            />
          )}
          {origFetch ? (
            usePlainThumbs ? (
              showOnly === "original" ? (
                <ZoomableEnhancedThumb
                  url={origFetch}
                  alt="Original"
                  cellH={cellH}
                  cellInteractive={cellInteractive}
                  onCellClick={onOpenLightbox ? () => onOpenLightbox(lightboxIdx) : undefined}
                  onCellKeyDown={(e) => {
                    if (onOpenLightbox && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpenLightbox(lightboxIdx);
                    }
                  }}
                  ariaLabel="Original — open full screen"
                />
              ) : (
                <div
                  className={`relative w-full shrink-0 overflow-hidden bg-ink-50 min-h-0 ${cellH} ${cellInteractive}`}
                  {...cellRoleProps("Original")}
                >
                  <BlobFetchImg
                    key={origFetch}
                    url={origFetch}
                    alt="Original"
                    className="absolute left-1/2 top-1/2 block max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 object-contain"
                  />
                </div>
              )
            ) : (
              <div className={`relative ${cellH} w-full`}>
                <ImageZoomViewport className="absolute inset-0" resetKey={zoomKey} toolbar="overlay-br">
                  <BlobFetchImg
                    url={origFetch}
                    alt="Original"
                    className={
                      isEnhancementQc
                        ? "max-h-[min(65dvh,700px)] w-full bg-ink-50 object-contain"
                        : `${imgClass} w-full bg-ink-50 object-contain`
                    }
                  />
                </ImageZoomViewport>
              </div>
            )
          ) : (
            <div className="p-3 text-center text-[10px] text-ink-400">No file</div>
          )}
        </div>
        )}
        {showEnhanced && (
        <div className="relative min-w-0 overflow-hidden rounded-lg border border-ink-100 bg-white">
          <div
            className={`border-b border-pink-100 bg-pink-50/80 text-center font-semibold text-pink-800 ${
              isEnhancementQc ? "py-2 text-xs sm:text-sm" : compact ? "py-1 text-[10px] sm:text-xs" : "py-0.5 text-[9px]"
            }`}
          >
            Enhanced
          </div>
          {page && pageProgress && pageProgress[page.page_index] && (
            <PageProgressOverlay progress={pageProgress[page.page_index]} />
          )}
          {page && (page.post_qs != null || page.initial_qs != null) && (
            <PageQsBadge
              variant="enhanced"
              initial={page.initial_qs ?? null}
              post={page.post_qs ?? null}
            />
          )}
          {enhFetch ? (
            usePlainThumbs ? (
              showOnly === "enhanced" ? (
                <ZoomableEnhancedThumb
                  url={enhFetch}
                  alt="Enhanced"
                  cellH={cellH}
                  cellInteractive={cellInteractive}
                  onCellClick={onOpenLightbox ? () => onOpenLightbox(lightboxIdx) : undefined}
                  onCellKeyDown={(e) => {
                    if (onOpenLightbox && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpenLightbox(lightboxIdx);
                    }
                  }}
                  ariaLabel="Enhanced — open full screen"
                />
              ) : (
                <div
                  className={`relative w-full shrink-0 overflow-hidden bg-ink-50 min-h-0 ${cellH} ${cellInteractive}`}
                  {...cellRoleProps("Enhanced")}
                >
                  <BlobFetchImg
                    key={enhFetch}
                    url={enhFetch}
                    alt="Enhanced"
                    className="absolute left-1/2 top-1/2 block max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 object-contain"
                  />
                </div>
              )
            ) : (
              <div className={`relative ${cellH} w-full`}>
                <ImageZoomViewport className="absolute inset-0" resetKey={`${zoomKey}-e`} toolbar="overlay-br">
                  <BlobFetchImg
                    url={enhFetch}
                    alt="Enhanced"
                    className={
                      isEnhancementQc
                        ? "max-h-[min(65dvh,700px)] w-full bg-ink-50 object-contain"
                        : `${imgClass} w-full bg-ink-50 object-contain`
                    }
                  />
                </ImageZoomViewport>
              </div>
            )
          ) : (
            <div
              className={`flex items-center justify-center px-1 text-center text-[10px] text-ink-400 ${
                isEnhancementQc ? "min-h-[min(36vh,200px)] text-sm" : compact ? "min-h-[4.5rem]" : "min-h-[6rem]"
              }`}
            >
              Not enhanced yet
            </div>
          )}
        </div>
        )}
      </div>
    );
  };

  if (pages.length === 0) {
    const soloRaster =
      doc.id != null && (doc.enhanced_path || doc.original_path)
        ? documentRasterUrl(doc.id, doc.enhanced_path ? "enhanced" : "original", undefined, doc.updated_at ?? null)
        : undefined;
    if (!soloRaster && !showPipeline) return null;

    return (
      <div className="pane min-w-0 p-4 border border-ink-100">
        <div className="label mb-2">{title}</div>
        {showPipeline ? (
          <>
            <ImagePair page={null} />
            <StageChips page={null} />
            {!compact && (
              <p className="text-[10px] text-ink-500 mt-2 text-center">
                Classify &amp; Index apply to the whole document; other stages follow this image.
              </p>
            )}
          </>
        ) : (
          <div
            className={`relative mx-auto overflow-hidden rounded-xl border border-ink-200 bg-ink-50 ${
              compact
                ? "h-[min(48vh,28rem)] max-h-[min(62vh,36rem)] min-h-[14rem] w-full shrink-0"
                : "aspect-[4/5] max-h-[min(70vh,520px)] max-w-md"
            }`}
          >
            {compact && soloRaster ? (
              <BlobFetchImg
                key={soloRaster}
                url={soloRaster}
                alt="Source"
                className="absolute left-1/2 top-1/2 block max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 object-contain"
              />
            ) : soloRaster ? (
              <ImageZoomViewport
                className="absolute inset-0"
                resetKey={`${soloRaster}-${doc.updated_at}`}
                toolbar="overlay-br"
              >
                <BlobFetchImg
                  url={soloRaster}
                  alt="Source"
                  className="h-full max-h-[min(68vh,500px)] w-full object-contain"
                />
              </ImageZoomViewport>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
      <div
        className={`pane min-w-0 border border-ink-100 ${isEnhancementQc ? "border-violet-200/90 p-4 ring-1 ring-violet-100 md:p-5" : "p-4"}`}
      >
      <div className={`label mb-3 ${isEnhancementQc ? "text-sm text-violet-900" : ""}`}>{title}</div>
      {(!compact || isEnhancementQc) && (
        <p className={`mb-3 text-ink-600 ${isEnhancementQc ? "text-sm leading-relaxed" : "text-[11px] text-ink-500"}`}>
          Each page shows <strong className="text-ink-800">Original</strong> and{" "}
          <strong className="text-ink-800">Enhanced</strong> plus pipeline progress (Classify &amp; Index are
          document-wide).
          {isEnhancementQc && (
            <span className="mt-2 block font-medium text-violet-900">
              Large previews for QC — use the draggable compare strip below for pixel-level before/after.
            </span>
          )}
        </p>
      )}
      <div
        className={`grid gap-3 ${
          isEnhancementQc
            ? pages.length <= 2
              ? "grid-cols-1 md:grid-cols-2 md:gap-5"
              : "grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-2"
            : compact
              ? pages.length === 2
                ? "grid-cols-1 md:grid-cols-2 md:gap-4"
                : "grid-cols-1"
              : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        }`}
      >
        {pages.map((p) => {
          const selectable = onSelectPage != null;
          const active = selectable && selectedPageIndex === p.page_index;
          const shellClass = `text-left w-full min-w-0 rounded-xl overflow-hidden border bg-ink-50/50 shadow-soft ${
            selectable
              ? `cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-[box-shadow,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  active ? "ring-2 ring-brand-500 border-brand-300" : "border-ink-200"
                }`
              : "border-ink-200"
          }`;
          const shellProps = selectable
            ? {
                role: "button" as const,
                tabIndex: 0,
                onClick: () => onSelectPage!(p.page_index),
                onKeyDown: (e: ReactKeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPage!(p.page_index);
                  }
                },
                "aria-pressed": active,
                "aria-label": `Page ${p.page_index + 1}, select to edit OCR`,
              }
            : {};
          const inner = (
            <>
              <div
                className={`flex justify-between gap-2 border-b border-ink-100 bg-white/90 font-semibold text-ink-700 px-2 ${
                  isEnhancementQc ? "py-2 text-sm" : "py-1.5 text-[10px]"
                }`}
              >
                <span>Page {p.page_index + 1}</span>
                <span className="font-normal text-ink-400">
                  {showOnly === "enhanced" ? "Enhanced" : showOnly === "original" ? "Original" : "Original · Enhanced"}
                </span>
              </div>
              <div className={isEnhancementQc ? "p-3 md:p-4" : compact ? "p-3 sm:p-4" : "p-2"}>
                <ImagePair page={p} />
                {showPipeline && <StageChips page={p} />}
              </div>
            </>
          );
          const key = p.id != null ? `db-${p.id}` : `p-${p.page_index}-${p.image_path}`;
          return selectable ? (
            <div key={key} className={shellClass} {...shellProps}>
              {inner}
            </div>
          ) : (
            <div key={key} className={shellClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
