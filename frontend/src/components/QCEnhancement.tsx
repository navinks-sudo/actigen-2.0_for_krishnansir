import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Check, X, RotateCcw, Sparkles, SlidersHorizontal, Loader2, RefreshCw, Zap } from "lucide-react";
import Gauge from "./Gauge";
import StageSourcePages from "./StageSourcePages";
import ImageLightbox from "./ImageLightbox";
import {
  api,
  DocumentPageT,
  DocumentT,
  formatQs,
  MANUAL_TUNE_DEFAULTS,
  ManualTuneState,
  PageQsMetricsT,
} from "../lib/api";

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
  /** Merged server + offline defaults (from DocumentView). */
  stagePublicConfig: Record<string, Record<string, unknown>>;
  stageConfigFromServer: boolean;
  stageConfigError: string | null;
  onRetryStageConfig: () => void;
}

function avgNums(vals: (number | null | undefined)[]): number | null {
  const n = vals.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (!n.length) return null;
  return n.reduce((a, b) => a + b, 0) / n.length;
}

function avgPageQsMetrics(pages: DocumentPageT[]): PageQsMetricsT | null {
  const rows = pages.map((p) => p.qs_metrics).filter((x): x is PageQsMetricsT => Boolean(x));
  if (!rows.length) return null;
  const n = rows.length;
  return {
    qs: rows.reduce((a, x) => a + x.qs, 0) / n,
    sharpness: rows.reduce((a, x) => a + x.sharpness, 0) / n,
    brightness: rows.reduce((a, x) => a + x.brightness, 0) / n,
    contrast: rows.reduce((a, x) => a + x.contrast, 0) / n,
    noise: rows.reduce((a, x) => a + x.noise, 0) / n,
  };
}

function TuneRow({
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-ink-800">{label}</label>
        <span className="text-xs font-mono text-ink-500 tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full accent-brand-600 bg-ink-100 appearance-none cursor-pointer"
        aria-label={label}
      />
      <p className="text-[11px] text-ink-400 leading-snug">{hint}</p>
    </div>
  );
}

export default function QCEnhancement({
  doc,
  onUpdate,
  stagePublicConfig,
  stageConfigFromServer,
  stageConfigError,
  onRetryStageConfig,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [enhancePct, setEnhancePct] = useState(0);
  const [enhanceLabel, setEnhanceLabel] = useState("");
  const [runErr, setRunErr] = useState<string | null>(null);
  const [tune, setTune] = useState<ManualTuneState>(MANUAL_TUNE_DEFAULTS);
  const [tuning, setTuning] = useState(false);
  const [tuneErr, setTuneErr] = useState<string | null>(null);
  const [tuneNotice, setTuneNotice] = useState<string | null>(null);
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoNotice, setAutoNotice] = useState<{ kind: "skipped" | "ran"; text: string } | null>(null);
  const [autoThreshold, setAutoThreshold] = useState<number>(75);
  const [autoChain, setAutoChain] = useState(true);
  const [chainBusy, setChainBusy] = useState(false);
  const [chainStep, setChainStep] = useState<string>("");
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [pageProgress, setPageProgress] = useState<
    Record<number, { pct: number; label: string; status: "pending" | "active" | "done" }>
  >({});
  const userTouchedTune = useRef(false);
  const pages = doc.pages ?? [];

  useEffect(() => {
    setTune(MANUAL_TUNE_DEFAULTS);
    userTouchedTune.current = false;
    setTuneErr(null);
    setTuneNotice(null);
  }, [doc.id, doc.enhancement_passes]);

  const [sopDraft, setSopDraft] = useState(doc.target_qs);
  const [sopBusy, setSopBusy] = useState(false);

  useEffect(() => {
    const cfg = (stagePublicConfig.enhancement as { config?: Record<string, unknown> } | undefined)?.config;
    const t = cfg?.auto_enhance_threshold;
    if (typeof t === "number" && Number.isFinite(t)) {
      setAutoThreshold(Math.max(0, Math.min(100, Math.round(t))));
    }
  }, [stagePublicConfig]);

  const runAuto = async () => {
    setAutoBusy(true);
    setAutoNotice(null);
    setRunErr(null);
    try {
      const decision = await api.enhanceAutoDecide(doc.id, autoThreshold);
      if (!decision.should_enhance) {
        setAutoNotice({
          kind: "skipped",
          text: `Skipped: Initial QS ${decision.initial_qs.toFixed(2)} already meets threshold ${decision.threshold.toFixed(0)} — upload is publication-ready as-is.`,
        });
        return;
      }
      setEnhancePct(0);
      setEnhanceLabel("Auto-enhance starting…");
      setBusy(true);
      const updated = await api.enhanceWithProgress(
        doc.id,
        (p) => {
          setEnhancePct(p.pct);
          setEnhanceLabel(p.label);
        },
        doc.target_qs,
      );
      onUpdate(updated);
      setAutoNotice({
        kind: "ran",
        text: `Enhanced: Initial QS ${decision.initial_qs.toFixed(2)} was below threshold ${decision.threshold.toFixed(0)} — full enhancement run.`,
      });
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Auto-enhance failed");
    } finally {
      setAutoBusy(false);
      setBusy(false);
      setEnhancePct(0);
      setEnhanceLabel("");
    }
  };

  useEffect(() => {
    setSopDraft(doc.target_qs);
  }, [doc.id, doc.target_qs]);

  const runChainAfterEnhance = async (id: number, targetLang: string) => {
    setChainBusy(true);
    setChainErr(null);
    const step = async (label: string, fn: () => Promise<DocumentT>) => {
      setChainStep(label);
      const updated = await fn();
      onUpdate(updated);
      return updated;
    };
    try {
      await step("Approving enhancement…", () => api.approve(id));
      await step("Running OCR…", () => api.ocr(id));
      try {
        await step("Translating OCR to English…", () => api.translateOcrToEnglish(id, "auto"));
      } catch {
        /* translation is best-effort; chain continues */
      }
      await step("Approving OCR…", () => api.approve(id));
      await step("Classifying document…", () => api.classify(id));
      await step("Approving Classify…", () => api.approve(id));
      await step("Extracting metadata (Index Genius)…", () => api.index(id));
      await step("Approving Index…", () => api.approve(id));
      await step("Generating summary (Abstractor)…", () => api.abstract(id));
      await step("Approving Abstract…", () => api.approve(id));
      await step(`Translating to ${targetLang}…`, () => api.translate(id, targetLang));
      setChainStep("Pipeline complete · all stages approved.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Pipeline halted";
      setChainErr(msg);
      setChainStep(`Halted at: ${msg}`);
    } finally {
      setTimeout(() => {
        setChainBusy(false);
      }, 600);
    }
  };

  const run = async () => {
    setBusy(true);
    setEnhancePct(0);
    setEnhanceLabel("Connecting…");
    setRunErr(null);
    setChainErr(null);
    // Seed per-page state to "pending" so an overlay shows on every cell from the start.
    if (pages.length > 1) {
      const seed: Record<number, { pct: number; label: string; status: "pending" | "active" | "done" }> = {};
      for (const p of pages) seed[p.page_index] = { pct: 0, label: "Queued…", status: "pending" };
      setPageProgress(seed);
    } else {
      setPageProgress({});
    }
    let updatedDoc: DocumentT | null = null;
    // Track a working copy of the doc so per-page completion events can patch in fresh
    // enhanced_path / post_qs / initial_qs values and the Enhanced cell re-fetches per page.
    let draftDoc: DocumentT = doc;
    try {
      updatedDoc = await api.enhanceWithProgress(
        doc.id,
        (p) => {
          setEnhancePct(p.pct);
          setEnhanceLabel(p.label);
          // pageIndex from the backend is 1-based; our state map keys are 0-based page_index values.
          if (p.pageIndex && p.pageTotal && p.pageTotal > 1) {
            const idx0 = p.pageIndex - 1;
            setPageProgress((prev) => {
              const next = { ...prev };
              // Mark earlier pages as done if we're on a later page now.
              for (const key of Object.keys(next)) {
                const k = Number(key);
                if (k < idx0 && next[k].status !== "done") {
                  next[k] = { pct: 100, label: "Done", status: "done" };
                }
              }
              const writePhase = p.phase === "write" || p.phase === "complete" || p.phase === "page_complete";
              next[idx0] = {
                pct: writePhase ? 100 : p.pct,
                label: p.label,
                status: writePhase ? "done" : "active",
              };
              return next;
            });
          }
          // Per-page completion event: patch the doc so this page's Enhanced raster shows
          // right away, without waiting for the whole document to finish.
          if (p.pageDone) {
            const pd = p.pageDone;
            const patched: DocumentT = {
              ...draftDoc,
              updated_at: pd.updatedAt ?? draftDoc.updated_at,
              pages: (draftDoc.pages ?? []).map((row) =>
                row.page_index === pd.pageIndex
                  ? {
                      ...row,
                      enhanced_path: pd.enhancedPath || row.enhanced_path,
                      post_qs: pd.postQs ?? row.post_qs,
                      initial_qs: pd.initialQs ?? row.initial_qs,
                    }
                  : row,
              ),
            };
            draftDoc = patched;
            onUpdate(patched);
            // Mark that page's overlay as done.
            setPageProgress((prev) => ({
              ...prev,
              [pd.pageIndex]: {
                pct: 100,
                label: `Done · Post QS ${pd.postQs != null ? pd.postQs.toFixed(1) : "?"}`,
                status: "done",
              },
            }));
          }
        },
        doc.target_qs,
      );
      onUpdate(updatedDoc);
      // Mark all pages done when stream finishes.
      setPageProgress((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const k = Number(key);
          next[k] = { pct: 100, label: "Done", status: "done" };
        }
        return next;
      });
      // Clear after a short delay so the overlay fades out cleanly.
      setTimeout(() => setPageProgress({}), 1200);
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Enhancement failed");
      setPageProgress({});
    } finally {
      setBusy(false);
      setEnhancePct(0);
      setEnhanceLabel("");
    }
    if (updatedDoc && autoChain) {
      void runChainAfterEnhance(updatedDoc.id, updatedDoc.target_language || "hi");
    }
  };

  const restoreAuto = async () => {
    setBusy(true);
    setEnhancePct(0);
    setEnhanceLabel("Connecting…");
    setRunErr(null);
    try {
      onUpdate(
        await api.enhanceWithProgress(
          doc.id,
          (p) => {
            setEnhancePct(p.pct);
            setEnhanceLabel(p.label);
          },
          doc.target_qs
        )
      );
      setTune(MANUAL_TUNE_DEFAULTS);
      userTouchedTune.current = false;
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Enhancement failed");
    } finally {
      setBusy(false);
      setEnhancePct(0);
      setEnhanceLabel("");
    }
  };

  const resetAllSettings = async () => {
    setRunErr(null);
    setTuneErr(null);
    setTuneNotice(null);
    setTune(MANUAL_TUNE_DEFAULTS);
    userTouchedTune.current = false;
    try {
      onUpdate(await api.patch(doc.id, { target_qs: 100 }));
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Could not reset settings");
    }
  };

  const approve = async () => {
    setBusy(true);
    setRunErr(null);
    try {
      onUpdate(await api.approve(doc.id));
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setRunErr(null);
    try {
      onUpdate(await api.reject(doc.id));
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  };

  const patchTune = useCallback((partial: Partial<ManualTuneState>) => {
    userTouchedTune.current = true;
    setTune((t) => ({ ...t, ...partial }));
  }, []);

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const origPath = doc.original_path || pages[0]?.image_path;
    if (!origPath) return;

    if (!userTouchedTune.current) return;

    let cancelled = false;
    setTuning(true);
    setTuneErr(null);

    const id = window.setTimeout(async () => {
      try {
        const res = await api.tuneEnhancement(doc.id, tune);
        if (!cancelled) {
          onUpdateRef.current(res.document);
          setTuneNotice(res.notice ?? null);
        }
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
  }, [tune, doc.id, doc.original_path, doc.enhanced_path, pages[0]?.image_path]);

  const canManualQc = Boolean(doc.original_path || pages.some((p) => p.image_path));
  const allPagesHavePost =
    !pages.length || pages.every((p) => p.post_qs != null && p.enhanced_path);
  const ready = Boolean(doc.enhanced_path && doc.post_qs != null && doc.post_qs !== undefined && allPagesHavePost);

  const fromPageInitials = pages.length > 0 ? avgNums(pages.map((p) => p.initial_qs)) : null;
  const fromPageMetricsQs = pages.length > 0 ? avgNums(pages.map((p) => (p.qs_metrics != null ? p.qs_metrics.qs : null))) : null;
  const gaugeInitial: number | null =
    fromPageInitials ??
    fromPageMetricsQs ??
    (doc.initial_qs != null && !Number.isNaN(Number(doc.initial_qs)) ? Number(doc.initial_qs) : null);

  const gaugePost: number | null = !ready
    ? null
    : (pages.length > 0 ? avgNums(pages.map((p) => p.post_qs)) : doc.post_qs) ?? null;

  const initialMetrics = pages.length > 0 ? avgPageQsMetrics(pages) : null;

  const resetQcSliders = () => {
    setTune(MANUAL_TUNE_DEFAULTS);
    userTouchedTune.current = true;
  };

  const refreshScoresFromServer = async () => {
    setRunErr(null);
    setRefreshingScores(true);
    try {
      onUpdate(await api.get(doc.id));
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Could not refresh scores");
    } finally {
      setRefreshingScores(false);
    }
  };

  const enhMeta = stagePublicConfig.enhancement as
    | {
        sop_allowed_range?: { min?: number; max?: number };
        algorithm?: string;
        config?: Record<string, unknown>;
      }
    | undefined;
  const sopMin = Math.max(80, Math.min(100, Number(enhMeta?.sop_allowed_range?.min ?? 80)));
  const sopMax = Math.max(sopMin, Math.min(100, Number(enhMeta?.sop_allowed_range?.max ?? 100)));

  const applySopTarget = async () => {
    const clamped = Math.min(sopMax, Math.max(sopMin, Math.round(Number(sopDraft))));
    if (clamped === doc.target_qs) return;
    setSopBusy(true);
    setRunErr(null);
    try {
      onUpdate(await api.patch(doc.id, { target_qs: clamped }));
    } catch (e: unknown) {
      setRunErr(e instanceof Error ? e.message : "Could not update SOP target");
    } finally {
      setSopBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-200 to-indigo-200 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-700" />
            </span>
            Image Enhancement
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            <strong>Initial QS</strong> is computed on upload from the original raster (see card below). Click{" "}
            <strong>Run Enhancement</strong> to raise <strong>Post QS</strong> toward your <strong>SOP target</strong>{" "}
            (default 100) using QS-guided passes, then polish / alternate pipelines if needed. QC sliders are
            debounced (~0.5s); each tune saves your slider result to the working enhanced image (amber hints if QS drops).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={resetAllSettings}
            disabled={busy || tuning}
            className="btn-soft text-sm inline-flex items-center gap-1.5"
            title="SOP target 100 + default QC sliders (does not delete enhancement)"
          >
            <RefreshCw className="w-4 h-4" /> Reset all settings
          </button>
          <label
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-900 shadow-sm cursor-pointer select-none"
            title="After enhancement, automatically run OCR → Translate → Classify → Index → Abstract → Lingua and approve each stage."
          >
            <input
              type="checkbox"
              checked={autoChain}
              onChange={(e) => setAutoChain(e.target.checked)}
              disabled={busy || chainBusy}
              className="accent-violet-600"
            />
            Auto-run full pipeline
          </label>
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 shadow-sm">
            <Zap className="w-4 h-4 text-amber-700" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">Auto-enhance</span>
            <label className="text-[11px] text-amber-900 ml-1">if Initial QS &lt;</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={autoThreshold}
              onChange={(e) => setAutoThreshold(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
              disabled={autoBusy || busy || tuning}
              className="input w-14 px-1.5 py-0.5 text-xs font-mono text-center"
              aria-label="Auto-enhance threshold"
            />
            <button
              type="button"
              onClick={runAuto}
              disabled={autoBusy || busy || tuning}
              className="btn-primary text-xs px-2 py-1 inline-flex items-center gap-1"
              title="Compute Initial QS, run enhancement only if below threshold"
            >
              {autoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Run
            </button>
          </div>
          <button type="button" onClick={run} disabled={busy || tuning} className="btn-primary">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : ready ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}{" "}
            {ready ? "Re-run enhancement" : "Run enhancement"}
          </button>
          {ready && (
            <>
              <button type="button" onClick={restoreAuto} disabled={busy || tuning} className="btn-soft text-sm" title="Discard manual QC and rebuild from original">
                Restore auto
              </button>
              <button type="button" onClick={reject} disabled={busy || tuning} className="btn-danger">
                <X className="w-4 h-4" /> Reject
              </button>
              <button type="button" onClick={approve} disabled={busy || tuning} className="btn-primary">
                <Check className="w-4 h-4" /> Approve & Continue
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="pane p-4 border border-brand-200/80 bg-gradient-to-br from-emerald-50/30 to-pink-50/30 lg:row-span-1">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold uppercase tracking-wider text-brand-900">Quality Scores · Initial → Post</div>
            {tuning && (
              <span className="inline-flex items-center gap-1 text-[10px] text-brand-600 font-normal">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating
              </span>
            )}
          </div>
          <div className="flex items-center justify-around scale-90 origin-top">
            <Gauge
              value={gaugeInitial}
              label="Initial QS"
              target={doc.target_qs}
              onClick={refreshScoresFromServer}
              clickDisabled={busy || tuning || refreshingScores}
              clickTitle="Reload scores from server"
            />
            <motion.div
              animate={{ x: [0, 6, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="text-ink-400 mx-1"
            >
              →
            </motion.div>
            <Gauge
              value={gaugePost}
              label="Post QS"
              target={doc.target_qs}
              color="text-pink-500"
              pendingLabel="Run"
            />
          </div>
          {pages.length > 1 && (
            <p className="text-[10px] text-ink-500 text-center mt-1 leading-snug">
              Mean across {pages.length} pages · per-page in table
            </p>
          )}
        </div>
        <div className="pane p-4 border border-emerald-200/80 bg-emerald-50/30">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-1">Upload — initial quality</div>
          <p className="text-2xl font-bold text-ink-900 tabular-nums">{formatQs(gaugeInitial)}</p>
          <p className="text-xs text-ink-600 mt-1">Composite QS (0–100) from the original image on disk before enhancement.</p>
          {initialMetrics && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-700">
              <dt className="text-ink-500">Sharpness</dt>
              <dd className="font-mono text-right">{initialMetrics.sharpness.toFixed(1)}</dd>
              <dt className="text-ink-500">Brightness</dt>
              <dd className="font-mono text-right">{initialMetrics.brightness.toFixed(1)}</dd>
              <dt className="text-ink-500">Contrast</dt>
              <dd className="font-mono text-right">{initialMetrics.contrast.toFixed(1)}</dd>
              <dt className="text-ink-500">Noise (score)</dt>
              <dd className="font-mono text-right">{initialMetrics.noise.toFixed(1)}</dd>
            </dl>
          )}
          {!initialMetrics && gaugeInitial != null && (
            <p className="text-xs text-ink-500 mt-2">Per-component breakdown appears when page previews resolve.</p>
          )}
        </div>
        <div className="pane p-4 border border-violet-200/80 bg-violet-50/20">
          <div className="text-xs font-bold uppercase tracking-wider text-violet-900 mb-1">Pipeline SOP overview</div>
          <ul className="text-xs text-ink-700 space-y-1.5 list-disc pl-4">
            <li>
              <strong>Enhancement:</strong> SOP = QS target (default 100, range 80–100 via patch).
            </li>
            <li>
              <strong>OCR / Classify / Index / Abstract / Lingua:</strong> QC approval gates; see each workbench for
              edits and metrics.
            </li>
          </ul>
          <details className="mt-2 text-[11px] text-ink-600">
            <summary className="cursor-pointer font-medium text-ink-800">
              Raw stage-config JSON
              {!stageConfigFromServer ? " — offline defaults until API succeeds" : ""}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-ink-900/90 text-emerald-100/95 p-2 font-mono text-[10px] leading-snug">
              {JSON.stringify(stagePublicConfig, null, 2)}
            </pre>
            <button type="button" onClick={onRetryStageConfig} className="mt-2 text-[11px] text-brand-700 underline">
              Reload from API
            </button>
          </details>
        </div>
      </div>

      {runErr && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">{runErr}</div>
      )}

      {(chainBusy || chainStep) && (
        <div
          className={`px-4 py-3 rounded-xl border text-sm flex items-center gap-3 ${
            chainErr
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : chainBusy
                ? "bg-violet-50 border-violet-200 text-violet-900"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
          }`}
        >
          {chainBusy ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : chainErr ? (
            <X className="w-4 h-4 shrink-0" />
          ) : (
            <Check className="w-4 h-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Auto-pipeline</div>
            <div className="text-[12px] truncate">{chainStep}</div>
          </div>
          {!chainBusy && !chainErr && (
            <button
              type="button"
              onClick={() => setChainStep("")}
              className="text-emerald-700 underline text-xs"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {autoNotice && (
        <div
          className={`px-4 py-3 rounded-xl border text-sm flex items-start justify-between gap-3 ${
            autoNotice.kind === "skipped"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-950"
          }`}
        >
          <div className="flex items-start gap-2">
            <Zap className={`w-4 h-4 mt-0.5 shrink-0 ${autoNotice.kind === "skipped" ? "text-emerald-700" : "text-amber-700"}`} />
            <span>
              <strong className="font-semibold">Auto-enhance · {autoNotice.kind === "skipped" ? "Skipped" : "Ran"}.</strong>{" "}
              {autoNotice.text}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAutoNotice(null)}
            className={`shrink-0 underline text-xs ${autoNotice.kind === "skipped" ? "text-emerald-700" : "text-amber-800"}`}
          >
            Dismiss
          </button>
        </div>
      )}

      {busy && (
        <div className="surface p-4 border border-brand-200/80 bg-brand-50/40">
          <div className="flex justify-between text-xs text-ink-600 mb-1.5 gap-3">
            <span className="truncate font-medium">{enhanceLabel || "Enhancing…"}</span>
            <span className="tabular-nums shrink-0">{enhancePct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-ink-100 overflow-hidden border border-ink-100/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 to-violet-500 transition-[width] duration-200 ease-out"
              style={{ width: `${enhancePct}%` }}
            />
          </div>
        </div>
      )}

      <StageSourcePages
        doc={doc}
        variant="enhancement"
        title={
          pages.length > 1
            ? "Document pages — Original vs Enhanced"
            : "Source pages — Original vs Enhanced"
        }
        onOpenLightbox={(i) => {
          setLightboxIndex(i);
          setLightboxOpen(true);
        }}
        pageProgress={pageProgress}
      />

      <div className="space-y-4">

          {canManualQc && (
            <div className="surface p-4 md:p-5 border border-ink-200/80 shadow-sm">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal className="w-5 h-5 text-brand-600 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold text-ink-900">QC tools</h3>
                    <p className="text-xs text-ink-500 mt-0.5 leading-snug">
                      Each change is saved to the working image after ~0.5s debounce. Applies to the{" "}
                      <strong className="text-ink-700">working image</strong> (first page enhanced, or original until you
                      run enhancement).
                    </p>
                  </div>
                </div>
                <button type="button" onClick={resetQcSliders} className="btn-soft text-xs shrink-0">
                  Reset sliders
                </button>
              </div>

              {tuneErr && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {tuneErr}
                </div>
              )}
              {tuneNotice && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start justify-between gap-2">
                  <span>{tuneNotice}</span>
                  <button
                    type="button"
                    className="text-amber-800 hover:text-ink-900 text-[10px] shrink-0 underline"
                    onClick={() => setTuneNotice(null)}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <TuneRow
                  label="Brightness"
                  hint="Lift or darken midtones (50 = neutral)."
                  value={tune.brightness}
                  onChange={(v) => patchTune({ brightness: v })}
                />
                <TuneRow
                  label="Contrast"
                  hint="Spread or compress tones (50 = neutral)."
                  value={tune.contrast}
                  onChange={(v) => patchTune({ contrast: v })}
                />
                <TuneRow
                  label="Gamma"
                  hint="Lightness curve for faded or crushed scans (50 = neutral)."
                  value={tune.gamma}
                  onChange={(v) => patchTune({ gamma: v })}
                />
                <TuneRow
                  label="Denoise"
                  hint="NLMeans (0 = off). High values can lower sharpness QS."
                  value={tune.denoise}
                  onChange={(v) => patchTune({ denoise: v })}
                />
                <TuneRow
                  label="Sharpen"
                  hint="Unsharp mask (0 = off)."
                  value={tune.sharpen}
                  onChange={(v) => patchTune({ sharpen: v })}
                />
                <TuneRow
                  label="Rotation"
                  hint="Fine deskew (50 = straight)."
                  value={tune.rotate}
                  onChange={(v) => patchTune({ rotate: v })}
                />
                <TuneRow
                  label="Local contrast (CLAHE)"
                  hint="Uneven lighting (50 = moderate)."
                  value={tune.clahe}
                  onChange={(v) => patchTune({ clahe: v })}
                />
              </div>
            </div>
          )}

          <div className="pane p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ink-500">SOP target</span>
              <span className="font-mono text-ink-900">{doc.target_qs}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-500">Auto passes</span>
              <span className="font-mono text-ink-900">{doc.enhancement_passes}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-500">Status</span>
              <span
                className={`font-mono font-semibold ${
                  gaugePost != null && gaugePost >= doc.target_qs
                    ? "text-emerald-600"
                    : gaugePost != null
                      ? "text-amber-600"
                      : "text-ink-500"
                }`}
              >
                {gaugePost == null ? "PENDING RUN" : gaugePost >= doc.target_qs ? "MET" : "BELOW TARGET"}
              </span>
            </div>
            <p className="text-[11px] text-ink-500 pt-2 mt-1 leading-relaxed border-t border-ink-100">
              The SOP value is your <strong className="text-ink-700">pass threshold</strong> (configurable goal), not a
              second reading of the file. If <strong className="text-ink-700">initial QS is already higher</strong>, the
              target can look “lower” — that means the upload already clears your bar, not that the numbers are wrong.
            </p>
          </div>
      </div>

      {pages.length > 0 && (
        <div className="surface p-4 md:p-5 border border-indigo-100 ring-1 ring-indigo-50/80 overflow-hidden flex flex-col max-h-[min(56vh,32rem)]">
          <h4 className="text-sm font-bold text-ink-900 mb-3 shrink-0">Per-page quality & inputs</h4>
          <div className="overflow-auto min-h-0 flex-1 -mx-1 px-1">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="text-left text-ink-500 border-b border-ink-200">
                <th className="py-2 pr-3">Page</th>
                <th className="py-2 pr-3">Initial QS</th>
                <th className="py-2 pr-3">Post QS</th>
                <th className="py-2 pr-3">QS in (init)</th>
                <th className="py-2 pr-3">Raster (init)</th>
                <th className="py-2 pr-3">QS in (post)</th>
                <th className="py-2">Raster (post)</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => (
                <tr key={p.id != null ? `db-${p.id}` : `row-${i}`} className="border-b border-ink-100">
                  <td className="py-2.5 pr-3 font-mono">{p.page_index + 1}</td>
                  <td className="py-2.5 pr-3 font-mono">{formatQs(p.initial_qs ?? p.qs_metrics?.qs ?? null)}</td>
                  <td className="py-2.5 pr-3 font-mono text-pink-700">{formatQs(p.post_qs)}</td>
                  <td className="py-2.5 pr-3 text-xs text-ink-600">
                    {p.qs_metrics ? (
                      <>
                        S {p.qs_metrics.sharpness.toFixed(0)} · B {p.qs_metrics.brightness.toFixed(0)} · C{" "}
                        {p.qs_metrics.contrast.toFixed(0)} · N {p.qs_metrics.noise.toFixed(0)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-ink-600">
                    {p.image_params ? (
                      <>
                        {p.image_params.width_px}×{p.image_params.height_px}px · μ{p.image_params.mean_gray.toFixed(0)}{" "}
                        · Lap {p.image_params.laplacian_variance.toFixed(0)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-pink-800/90">
                    {p.post_qs_metrics ? (
                      <>
                        S {p.post_qs_metrics.sharpness.toFixed(0)} · B {p.post_qs_metrics.brightness.toFixed(0)} · C{" "}
                        {p.post_qs_metrics.contrast.toFixed(0)} · N {p.post_qs_metrics.noise.toFixed(0)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 text-xs text-pink-800/90">
                    {p.post_image_params ? (
                      <>
                        {p.post_image_params.width_px}×{p.post_image_params.height_px}px · μ
                        {p.post_image_params.mean_gray.toFixed(0)} · Lap{" "}
                        {p.post_image_params.laplacian_variance.toFixed(0)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="text-[11px] text-ink-500 mt-3 shrink-0">
            Post QS and post columns fill after <strong className="text-ink-700">Run Enhancement</strong> completes (each
            page&apos;s enhanced PNG is scored). Open the gallery lightbox for the full breakdown.
          </p>
        </div>
      )}

      <ImageLightbox
        pages={
          pages.length > 0
            ? pages
            : doc.original_path
              ? [
                  {
                    id: null,
                    page_index: 0,
                    image_path: doc.original_path,
                    enhanced_path: doc.enhanced_path ?? null,
                    initial_qs: doc.initial_qs ?? null,
                    post_qs: doc.post_qs ?? null,
                    qs_metrics: null,
                    image_params: null,
                    post_qs_metrics: null,
                    post_image_params: null,
                    ocr_text: null,
                    corrected_ocr_text: null,
                    page_doc_class: null,
                    page_doc_class_scores: null,
                    page_abstract: null,
                    corrected_page_abstract: null,
                    page_translation: null,
                  } as DocumentPageT,
                ]
              : []
        }
        index={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onIndexChange={setLightboxIndex}
        sopTarget={doc.target_qs}
        cacheVersion={doc.updated_at ?? null}
        documentId={doc.id ?? null}
        documentInitialQs={doc.initial_qs ?? null}
        documentPostQs={doc.post_qs ?? null}
        onDocumentUpdate={onUpdate}
      />
    </div>
  );
}
