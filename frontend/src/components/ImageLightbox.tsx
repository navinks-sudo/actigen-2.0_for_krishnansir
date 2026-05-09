import { useEffect, useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, RotateCcw } from "lucide-react";
import {
  DocumentPageT,
  DocumentT,
  documentRasterUrl,
  fileUrl,
  formatQs,
  api,
  MANUAL_TUNE_DEFAULTS,
  ManualTuneState,
  type PageQualityApiPayload,
} from "../lib/api";
import BlobFetchImg from "./BlobFetchImg";

type Props = {
  pages: DocumentPageT[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  /** Shown in metrics panel — SOP target for QC. */
  sopTarget?: number | null;
  /** Bust cache for enhanced raster URLs after re-run or tune. */
  cacheVersion?: string | null;
  /** When set, Metrics panel loads disk-backed QS from the API (fixes sparse `pages[]` in client state). */
  documentId?: number | null;
  /** Fallback when page row has no `initial_qs` (first page or single-page doc). */
  documentInitialQs?: number | null;
  documentPostQs?: number | null;
  /** When set, in-lightbox QC sliders apply via api.tuneEnhancement and refresh the doc. */
  onDocumentUpdate?: (d: DocumentT) => void;
};

const SCALE_MIN = 0.5;
const SCALE_MAX = 4;
const SCALE_STEP = 1.2;

function ZoomPanel({
  label,
  labelClass,
  scale,
  setScale,
  src,
  legacy,
  alt,
  ringClass,
  outerExtraClass = "",
}: {
  label: string;
  labelClass: string;
  scale: number;
  setScale: (s: number | ((prev: number) => number)) => void;
  src: string | null;
  legacy: string | null | undefined;
  alt: string;
  ringClass: string;
  outerExtraClass?: string;
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>(
    { active: false, sx: 0, sy: 0, px: 0, py: 0 },
  );
  // Reset pan whenever the image source or zoom level resets via the % button.
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [src, legacy]);
  const zoomIn = () => setScale((s) => Math.min(SCALE_MAX, Math.round(s * SCALE_STEP * 100) / 100));
  const zoomOut = () => setScale((s) => Math.max(SCALE_MIN, Math.round((s / SCALE_STEP) * 100) / 100));
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
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    setGrabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    dragRef.current.active = false;
    setGrabbing(false);
  };
  const atMin = scale <= SCALE_MIN + 0.001;
  const atMax = scale >= SCALE_MAX - 0.001;
  const imgClass = `block max-h-[78vh] max-w-[42vw] rounded-lg object-contain shadow-2xl pointer-events-none ${ringClass}`;
  const imgStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transformOrigin: "center center",
    transition: dragRef.current.active ? "none" : "transform 150ms ease-out",
  };
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col items-center ${outerExtraClass}`}>
      <span className={`mb-1 shrink-0 self-start text-[11px] ${labelClass}`}>{label}</span>
      <div
        className={`relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg bg-zinc-900/40 select-none ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="pointer-events-auto absolute right-2 top-2 z-30 flex items-center gap-0.5 rounded-lg border border-white/20 bg-zinc-900/90 p-1 shadow-lg backdrop-blur-sm">
          <button
            type="button"
            onClick={zoomOut}
            disabled={atMin}
            className="rounded-md p-1.5 text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={reset}
            className="min-w-[2.75rem] px-1 text-center text-[11px] font-semibold tabular-nums text-zinc-200 hover:text-white"
            title="Reset zoom (Ctrl/⌘ + scroll on image to zoom)"
            aria-label={`Reset zoom, currently ${Math.round(scale * 100)} percent`}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={atMax}
            className="rounded-md p-1.5 text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        {src ? (
          <BlobFetchImg
            url={src}
            alt={alt}
            className={imgClass}
            style={imgStyle}
            placeholderClassName="flex min-h-[12rem] w-full items-center justify-center rounded-lg bg-zinc-900/80 text-xs text-zinc-400"
          />
        ) : legacy ? (
          <img src={legacy} alt={alt} className={imgClass} style={imgStyle} />
        ) : null}
      </div>
    </div>
  );
}

function TuneSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-200">{label}</label>
        <span className="font-mono text-[11px] text-zinc-400 tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full appearance-none rounded-full bg-white/10 accent-pink-400"
        aria-label={label}
      />
      <p className="text-[10px] text-zinc-500 leading-snug">{hint}</p>
    </div>
  );
}

function MetricRow({
  label,
  value,
  suffix = "",
  accent = "emerald",
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: "emerald" | "pink";
}) {
  const valCls = accent === "pink" ? "text-pink-200/90" : "text-emerald-200/90";
  return (
    <div className="flex justify-between gap-3 text-base text-zinc-200">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-mono tabular-nums ${valCls}`}>
        {value.toFixed(1)}
        {suffix}
      </span>
    </div>
  );
}

export default function ImageLightbox({
  pages,
  index,
  open,
  onClose,
  onIndexChange,
  sopTarget,
  cacheVersion,
  documentId,
  documentInitialQs,
  documentPostQs,
  onDocumentUpdate,
}: Props) {
  const n = pages.length;
  const idx = n ? Math.min(Math.max(0, index), n - 1) : 0;
  const current = pages[idx];
  const [remote, setRemote] = useState<PageQualityApiPayload | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [qualityRefetchNonce, setQualityRefetchNonce] = useState(0);
  const [origScale, setOrigScale] = useState(1);
  const [enhScale, setEnhScale] = useState(1);
  const [tune, setTune] = useState<ManualTuneState>(MANUAL_TUNE_DEFAULTS);
  const [tuning, setTuning] = useState(false);
  const [tuneErr, setTuneErr] = useState<string | null>(null);
  const userTouchedTune = useRef(false);
  const onUpdateRef = useRef(onDocumentUpdate);
  onUpdateRef.current = onDocumentUpdate;

  useEffect(() => {
    setOrigScale(1);
    setEnhScale(1);
  }, [index, open]);

  useEffect(() => {
    if (!open) {
      setTune(MANUAL_TUNE_DEFAULTS);
      userTouchedTune.current = false;
      setTuneErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !documentId || !userTouchedTune.current) return;
    let cancelled = false;
    setTuning(true);
    setTuneErr(null);
    const id = window.setTimeout(async () => {
      try {
        const res = await api.tuneEnhancement(documentId, tune);
        if (!cancelled) onUpdateRef.current?.(res.document);
      } catch (e: unknown) {
        if (!cancelled) setTuneErr(e instanceof Error ? e.message : "Tune failed");
      } finally {
        if (!cancelled) setTuning(false);
      }
    }, 480);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [tune, documentId, open]);

  const patchTune = (partial: Partial<ManualTuneState>) => {
    userTouchedTune.current = true;
    setTune((t) => ({ ...t, ...partial }));
  };

  const resetTune = () => {
    userTouchedTune.current = true;
    setTune(MANUAL_TUNE_DEFAULTS);
  };

  const go = useCallback(
    (d: number) => {
      if (!n) return;
      onIndexChange((index + d + n) % n);
    },
    [index, n, onIndexChange]
  );

  useEffect(() => {
    if (!open || !documentId || !current?.image_path) {
      setRemote(null);
      setRemoteLoading(false);
      return;
    }
    let cancel = false;
    setRemoteLoading(true);
    api
      .getPageQuality(documentId, current.page_index)
      .then((r) => {
        if (!cancel) setRemote(r);
      })
      .catch(() => {
        if (!cancel) setRemote(null);
      })
      .finally(() => {
        if (!cancel) setRemoteLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, documentId, current?.page_index, current?.image_path, cacheVersion, qualityRefetchNonce]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, go]);

  if (!open) return null;
  if (!current) return null;

  const origFetch =
    documentId != null && current.image_path
      ? documentRasterUrl(documentId, "original", current.page_index, cacheVersion ?? null)
      : null;
  const origLegacy = fileUrl(current.image_path);
  const enhFetch =
    documentId != null && current.enhanced_path
      ? documentRasterUrl(documentId, "enhanced", current.page_index, cacheVersion ?? null)
      : null;
  const enhLegacy =
    current.enhanced_path && cacheVersion
      ? `${fileUrl(current.enhanced_path)}?v=${encodeURIComponent(cacheVersion)}`
      : current.enhanced_path
        ? fileUrl(current.enhanced_path)
        : undefined;

  const m = remote?.qs_metrics ?? current.qs_metrics ?? null;
  const ip = remote?.image_params ?? current.image_params ?? null;
  const pm = remote?.post_qs_metrics ?? current.post_qs_metrics ?? null;
  const pip = remote?.post_image_params ?? current.post_image_params ?? null;

  const allowDocFallback = n === 1 || index === 0;
  const initialDisplay =
    (remote?.initial_qs != null && !Number.isNaN(Number(remote.initial_qs)) ? Number(remote.initial_qs) : null) ??
    (current.initial_qs != null && !Number.isNaN(Number(current.initial_qs)) ? Number(current.initial_qs) : null) ??
    (m != null && m.qs != null && !Number.isNaN(Number(m.qs)) ? Number(m.qs) : null) ??
    (allowDocFallback &&
    documentInitialQs != null &&
    !Number.isNaN(Number(documentInitialQs))
      ? Number(documentInitialQs)
      : null);
  const postDisplay =
    (remote?.post_qs != null && !Number.isNaN(Number(remote.post_qs)) ? Number(remote.post_qs) : null) ??
    (current.post_qs != null && !Number.isNaN(Number(current.post_qs)) ? Number(current.post_qs) : null) ??
    (pm != null && pm.qs != null && !Number.isNaN(Number(pm.qs)) ? Number(pm.qs) : null) ??
    (allowDocFallback && documentPostQs != null && !Number.isNaN(Number(documentPostQs))
      ? Number(documentPostQs)
      : null);
  const deltaQs =
    initialDisplay != null && postDisplay != null ? postDisplay - initialDisplay : null;
  const hasPostEnhancement = Boolean(current.enhanced_path && (postDisplay != null || pm != null));
  const needsEnhancement = !current.enhanced_path;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex flex-col bg-zinc-950/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Page preview and quality metrics"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-white/10 text-white shrink-0">
        <div>
          <div className="text-sm font-medium">
            Page {index + 1} of {n}
            {initialDisplay != null && (
              <span className="ml-3 text-emerald-300 font-mono">Initial QS: {formatQs(initialDisplay)}</span>
            )}
            {postDisplay != null && (
              <span className="ml-3 text-pink-300 font-mono">Post QS: {formatQs(postDisplay)}</span>
            )}
          </div>
          <div className="text-xs text-zinc-400">
            Esc to close · ← → to navigate · use zoom buttons or Ctrl/⌘ + scroll on images
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl p-2 hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 max-h-[min(88vh,100%)] flex-1 items-center justify-center gap-2 px-2 py-2 lg:px-4">
          {n > 1 && (
            <button
              type="button"
              onClick={() => go(-1)}
              className="flex shrink-0 rounded-xl p-3 hover:bg-white/10 text-white"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}
          <div className="flex min-h-0 w-full flex-1 flex-col items-stretch justify-center gap-3 lg:flex-row">
            {current.image_path && (
              <ZoomPanel
                label="Original"
                labelClass="text-zinc-500"
                scale={origScale}
                setScale={setOrigScale}
                ringClass=""
                src={origFetch ?? null}
                legacy={origLegacy}
                alt={`Page ${index + 1} original`}
              />
            )}
            {current.enhanced_path && (
              <ZoomPanel
                label="Enhanced"
                labelClass="text-pink-300/90"
                scale={enhScale}
                setScale={setEnhScale}
                ringClass="ring-1 ring-pink-500/20"
                src={enhFetch ?? null}
                legacy={enhLegacy ?? null}
                alt={`Page ${index + 1} enhanced`}
                outerExtraClass="border-t border-white/10 pt-3 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0"
              />
            )}
          </div>
          {n > 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              className="flex shrink-0 rounded-xl p-3 hover:bg-white/10 text-white"
              aria-label="Next page"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}
        </div>

        <aside className="max-h-[min(70vh,560px)] overflow-y-auto border-white/10 bg-zinc-900/80 lg:max-h-none lg:w-[min(100%,460px)] lg:border-l">
          <div className="space-y-5 border-t border-white/10 p-4 text-base lg:border-t-0">
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Metrics</h3>
              {remoteLoading && (
                <p className="mt-1 text-xs text-zinc-400" role="status">
                  Loading quality scores from server…
                </p>
              )}
              {!remoteLoading && initialDisplay == null && postDisplay == null && (
                <p className="mt-1 text-xs text-amber-300/90">
                  Could not read scores — check that the backend can access storage files and reload the document.
                </p>
              )}
              <p className="mt-2 text-sm text-zinc-300">
                Initial vs post-enhancement QS and raster stats.
                {!onDocumentUpdate && (
                  <>
                    {" "}
                    Brightness / contrast / denoise / sharpen sliders live in{" "}
                    <strong className="text-white">Image Enhancement</strong> (main QC panel).
                  </>
                )}
              </p>

              {onDocumentUpdate && documentId != null && (
                <div className="mt-4 rounded-xl border border-pink-500/25 bg-pink-950/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-pink-300/95">QC tools</h4>
                    <div className="flex items-center gap-2">
                      {tuning && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-pink-300/90">
                          <Loader2 className="h-3 w-3 animate-spin" /> Applying…
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={resetTune}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-white/10"
                        title="Reset all sliders to neutral defaults"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-400 leading-snug">
                    Live tune the saved enhanced image (~0.5s debounce). Post QS recomputes after each tweak — see scores
                    above.
                  </p>
                  {tuneErr && (
                    <div className="mt-2 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
                      {tuneErr}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
                    <TuneSlider
                      label="Brightness"
                      hint="50 = neutral midtones."
                      value={tune.brightness}
                      onChange={(v) => patchTune({ brightness: v })}
                    />
                    <TuneSlider
                      label="Contrast"
                      hint="50 = neutral spread."
                      value={tune.contrast}
                      onChange={(v) => patchTune({ contrast: v })}
                    />
                    <TuneSlider
                      label="Gamma"
                      hint="50 = neutral curve."
                      value={tune.gamma}
                      onChange={(v) => patchTune({ gamma: v })}
                    />
                    <TuneSlider
                      label="Denoise"
                      hint="0 = off (NLMeans)."
                      value={tune.denoise}
                      onChange={(v) => patchTune({ denoise: v })}
                    />
                    <TuneSlider
                      label="Sharpen"
                      hint="0 = off (unsharp)."
                      value={tune.sharpen}
                      onChange={(v) => patchTune({ sharpen: v })}
                    />
                    <TuneSlider
                      label="Rotation"
                      hint="50 = straight."
                      value={tune.rotate}
                      onChange={(v) => patchTune({ rotate: v })}
                    />
                    <TuneSlider
                      label="Local contrast (CLAHE)"
                      hint="50 = moderate."
                      value={tune.clahe}
                      onChange={(v) => patchTune({ clahe: v })}
                    />
                  </div>
                </div>
              )}
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2 mt-4">Per-page comparison</h4>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!documentId || remoteLoading}
                  onClick={() => setQualityRefetchNonce((n) => n + 1)}
                  title={
                    documentId
                      ? "Recompute Initial QS from the original raster on disk"
                      : "Open this document from the workflow to enable live score refresh"
                  }
                  className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="text-[10px] uppercase tracking-wide text-emerald-400/90 font-semibold">Initial QS</div>
                  <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-emerald-300 sm:text-4xl">
                    {initialDisplay != null ? formatQs(initialDisplay) : "—"}
                  </div>
                  {documentId && (
                    <div className="mt-1.5 text-[10px] text-emerald-400/80">Click to refresh from server</div>
                  )}
                </button>
                <div
                  className={`rounded-xl border p-3 ${
                    hasPostEnhancement
                      ? "border-pink-500/40 bg-pink-500/10"
                      : "border-zinc-600/80 bg-zinc-800/50"
                  }`}
                >
                  <div
                    className={`text-[10px] uppercase tracking-wide font-semibold ${
                      hasPostEnhancement ? "text-pink-300/95" : "text-zinc-500"
                    }`}
                  >
                    Post-enhancement QS
                  </div>
                  <div
                    className={`mt-1 font-mono text-3xl font-bold tabular-nums sm:text-4xl ${
                      hasPostEnhancement ? "text-pink-300" : "text-zinc-500"
                    }`}
                  >
                    {postDisplay != null ? formatQs(postDisplay) : "—"}
                  </div>
                  {deltaQs != null && (
                    <div
                      className={`text-xs font-mono mt-1.5 ${
                        deltaQs >= 0 ? "text-emerald-400/90" : "text-rose-400/90"
                      }`}
                    >
                      Δ {deltaQs >= 0 ? "+" : ""}
                      {deltaQs.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
              {sopTarget != null && postDisplay != null && (
                <p className="text-[11px] text-zinc-500 mt-2">
                  SOP target{" "}
                  <span className="font-mono text-zinc-400">{sopTarget}</span>
                  {postDisplay >= sopTarget ? (
                    <span className="text-emerald-400 ml-1">· Met on this page</span>
                  ) : (
                    <span className="text-amber-400/90 ml-1">· Below on this page</span>
                  )}
                </p>
              )}
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Initial quality score</h4>
              {m ? (
                <>
                  <div className="text-3xl font-bold text-emerald-400 font-mono tabular-nums">{formatQs(m.qs)}</div>
                  <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                    Composite QS: sharpness (Laplacian), contrast (σ), local noise, and document-aware brightness (midtone
                    or paper-text band). Weighted:{" "}
                    <span className="font-mono text-zinc-400">0.32×S + 0.18×B + 0.35×C + 0.15×N</span> (each 0–100).
                  </p>
                  <div className="mt-4 space-y-2 rounded-xl bg-white/5 border border-white/10 p-3">
                    <MetricRow label="Sharpness" value={m.sharpness} />
                    <MetricRow label="Brightness" value={m.brightness} />
                    <MetricRow label="Contrast" value={m.contrast} />
                    <MetricRow label="Noise (inverse)" value={m.noise} />
                  </div>
                </>
              ) : initialDisplay != null ? (
                <div className="text-2xl font-mono text-emerald-400">{formatQs(initialDisplay)}</div>
              ) : (
                <p className="text-zinc-500">No score available for this page.</p>
              )}
            </div>

            <div className="rounded-xl border border-pink-500/25 bg-pink-950/20 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-pink-300/95 mb-2">Post-enhancement (this page)</h4>
              {needsEnhancement ? (
                <p className="text-sm text-zinc-400 leading-relaxed">
                  No enhanced raster for this page yet. Open <strong className="text-zinc-200">Image Enhancement</strong>{" "}
                  and run <strong className="text-zinc-200">Run Enhancement</strong> — each PDF page is processed and
                  scored separately.
                </p>
              ) : pm ? (
                <>
                  <div className="text-3xl font-bold text-pink-300 font-mono tabular-nums">{formatQs(pm.qs)}</div>
                  <p className="text-[11px] text-zinc-500 mt-2 mb-3 leading-relaxed">
                    Same QS model as initial, evaluated on the saved enhanced image for this page.
                  </p>
                  <div className="space-y-2 rounded-xl bg-white/5 border border-pink-500/25 p-3">
                    <MetricRow accent="pink" label="Sharpness" value={pm.sharpness} />
                    <MetricRow accent="pink" label="Brightness" value={pm.brightness} />
                    <MetricRow accent="pink" label="Contrast" value={pm.contrast} />
                    <MetricRow accent="pink" label="Noise (inverse)" value={pm.noise} />
                  </div>
                </>
              ) : postDisplay != null ? (
                <div className="text-3xl font-bold text-pink-300 font-mono tabular-nums">{formatQs(postDisplay)}</div>
              ) : (
                <p className="text-zinc-500 text-sm">Post metrics unavailable — try refreshing the document.</p>
              )}
            </div>

            {ip && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Image parameters (original)
                </h4>
                <div className="space-y-2 rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="flex justify-between gap-3 text-zinc-200">
                    <span className="text-zinc-400">Dimensions</span>
                    <span className="font-mono text-emerald-200/90">
                      {ip.width_px} × {ip.height_px} px
                    </span>
                  </div>
                  <MetricRow label="Mean gray (0–255)" value={ip.mean_gray} />
                  <MetricRow label="Std dev gray" value={ip.std_gray} />
                  <MetricRow label="Laplacian variance (raw)" value={ip.laplacian_variance} />
                </div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                Image parameters (enhanced)
              </h4>
              {pip ? (
                <div className="space-y-2 rounded-xl bg-white/5 border border-pink-500/20 p-3">
                  <div className="flex justify-between gap-3 text-zinc-200">
                    <span className="text-zinc-400">Dimensions</span>
                    <span className="font-mono text-pink-200/90">
                      {pip.width_px} × {pip.height_px} px
                    </span>
                  </div>
                  <MetricRow accent="pink" label="Mean gray (0–255)" value={pip.mean_gray} />
                  <MetricRow accent="pink" label="Std dev gray" value={pip.std_gray} />
                  <MetricRow accent="pink" label="Laplacian variance (raw)" value={pip.laplacian_variance} />
                </div>
              ) : hasPostEnhancement ? (
                <p className="text-xs text-zinc-500 rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-3">
                  Raster stats will appear here once the enhanced file is available on the server.
                </p>
              ) : (
                <p className="text-xs text-zinc-600 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                  Shown after enhancement produces an enhanced image for this page.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-zinc-300 leading-relaxed">
              <strong className="text-brand-300">Enhancement</strong>{" "}
              {n > 1 ? (
                <>
                  runs <strong className="text-white">once per PDF page</strong>, each toward your SOP target
                  {sopTarget != null ? (
                    <span className="font-mono text-brand-200"> {sopTarget}</span>
                  ) : (
                    " (e.g. 95)"
                  )}
                  . Manual QC sliders apply to the <strong className="text-white">first page</strong> working image for
                  OCR continuity.
                </>
              ) : (
                <>
                  raises <strong className="text-white">Post QS</strong> toward your SOP target
                  {sopTarget != null ? (
                    <span className="font-mono text-brand-200"> {sopTarget}</span>
                  ) : (
                    " (e.g. 95)"
                  )}
                </>
              )}{" "}
              Open <strong className="text-white">Image Enhancement</strong> below after closing this panel.
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
