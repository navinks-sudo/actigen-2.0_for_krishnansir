import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import PipelineFlow from "../components/PipelineFlow";
import StagesSidebar from "../components/StagesSidebar";
import QCEnhancement from "../components/QCEnhancement";
import QCOcr from "../components/QCOcr";
import QCClassify from "../components/QCClassify";
import QCIndex from "../components/QCIndex";
import QCAbstract from "../components/QCAbstract";
import QCLingua from "../components/QCLingua";
import { api, DEFAULT_STAGE_PUBLIC_CONFIG, DocumentT, StageKey, STAGES } from "../lib/api";
import PagePreviewGallery from "../components/PagePreviewGallery";

function isStageKey(s: string): s is StageKey {
  return STAGES.some((x) => x.key === s);
}

function normalizePipelineStage(raw: string | null | undefined): StageKey | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return isStageKey(t) ? t : null;
}

function stageOrderIndex(k: StageKey): number {
  return STAGES.findIndex((x) => x.key === k);
}

/** Shown next to document id so you can confirm this bundle is the ACTIGEN repo (not a mock / fork UI). */
const QC_UI_BUILD_TAG = "ACTIGEN 2.0 · QC UI v0.1";

export default function DocumentView() {
  const { id } = useParams();
  const docId = Number(id);
  const [doc, setDoc] = useState<DocumentT | null>(null);
  const [active, setActive] = useState<StageKey>("enhancement");
  const [err, setErr] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [browserFs, setBrowserFs] = useState(false);
  const qcRootRef = useRef<HTMLDivElement>(null);
  const pipelineStageSeenRef = useRef<string | null>(null);
  const [stageCfg, setStageCfg] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [stageCfgErr, setStageCfgErr] = useState<string | null>(null);

  const refreshStageConfig = useCallback(() => {
    setStageCfgErr(null);
    api
      .stageConfig()
      .then((c) => {
        setStageCfg(c);
        setStageCfgErr(null);
      })
      .catch((e: unknown) => {
        setStageCfg(null);
        setStageCfgErr(e instanceof Error ? e.message : "Could not load stage config");
      });
  }, []);

  useEffect(() => {
    refreshStageConfig();
  }, [refreshStageConfig]);

  const mergedStageCfg = stageCfg ?? DEFAULT_STAGE_PUBLIC_CONFIG;

  const load = async () => {
    setReloading(true);
    setErr(null);
    try {
      const d = await api.get(docId);
      pipelineStageSeenRef.current = d.current_stage;
      setDoc(d);
      const cur = normalizePipelineStage(d.current_stage);
      if (cur) setActive(cur);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    load();
  }, [docId]);

  /** While QC is pending, never leave the user on a later pipeline tab than `current_stage`. */
  useEffect(() => {
    if (doc == null || doc.status !== "qc_pending") return;
    const cur = normalizePipelineStage(doc.current_stage);
    if (!cur) return;
    if (stageOrderIndex(active) > stageOrderIndex(cur)) {
      setActive(cur);
    }
  }, [doc, active]);

  useEffect(() => {
    const onFs = () => setBrowserFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleBrowserFullscreen = async () => {
    const el = qcRootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  };

  if (err) return <div className="surface p-8 text-rose-700">{err}</div>;
  if (!doc) return <div className="surface p-8 text-ink-500">Loading…</div>;

  const handleUpdate = (d: DocumentT) => {
    const prev = pipelineStageSeenRef.current;
    pipelineStageSeenRef.current = d.current_stage;
    setDoc(d);
    const cur = normalizePipelineStage(d.current_stage);
    if (cur && prev !== d.current_stage) {
      setActive(cur);
    }
  };

  const qcPending = doc.status === "qc_pending";
  const activeStageLabel = STAGES.find((s) => s.key === active)?.label ?? active;
  const hasPages = (doc.pages?.length ?? 0) > 0;

  const pipelineCurrent = normalizePipelineStage(doc.current_stage);
  const viewingFutureStage =
    pipelineCurrent != null &&
    doc.status !== "completed" &&
    stageOrderIndex(active) > stageOrderIndex(pipelineCurrent);
  const pipelineCurrentMeta = pipelineCurrent
    ? STAGES.find((s) => s.key === pipelineCurrent)
    : undefined;
  const pipelineCurrentLabel = pipelineCurrentMeta?.label ?? pipelineCurrent ?? null;
  const pipelineCurrentShort = pipelineCurrentMeta?.short ?? null;

  return (
    <div ref={qcRootRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/90 px-3 py-2 sm:px-3.5">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Document</span>
          <span className="truncate text-sm font-semibold text-zinc-900 sm:text-base">{doc.filename}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={toggleBrowserFullscreen}
            className="btn-soft inline-flex items-center gap-1.5 border-teal-200 bg-teal-50/90 px-2 py-1.5 text-xs text-teal-950 hover:bg-teal-100 sm:text-sm"
            title={browserFs ? "Exit full screen" : "Use entire monitor for QC"}
          >
            {browserFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{browserFs ? "Exit full screen" : "Full screen"}</span>
          </button>
          <span
            className="max-w-[9rem] truncate font-mono text-[9px] text-zinc-400 sm:max-w-none sm:text-[10px]"
            title={`Build fingerprint — ${QC_UI_BUILD_TAG}`}
          >
            {QC_UI_BUILD_TAG}
          </span>
          <span className="font-mono text-[10px] text-zinc-400 sm:text-xs">#{doc.id}</span>
          <button type="button" onClick={load} disabled={reloading} className="btn-ghost shrink-0 px-2 py-1 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {qcPending && pipelineCurrentLabel && (
        <div
          className="shrink-0 rounded-lg border border-amber-300/90 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 sm:text-sm"
          role="status"
        >
          <strong
            className="font-semibold"
            title={pipelineCurrentLabel ? String(pipelineCurrentLabel) : undefined}
          >
            QC required at stage: {pipelineCurrentShort ?? pipelineCurrentLabel}
          </strong>
          . Open that stage in the pipeline list or row below, complete edits, then approve or reject at the bottom of
          that panel.
          {viewingFutureStage && (
            <>
              {" "}
              <button
                type="button"
                className="font-semibold text-teal-900 underline decoration-teal-600/60 hover:text-teal-950"
                onClick={() => pipelineCurrent && setActive(pipelineCurrent)}
              >
                Go to {pipelineCurrentLabel}
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[9.5rem_1fr] lg:gap-3 xl:grid-cols-[10.5rem_1fr]">
        <StagesSidebar
          compact
          className="max-h-[30vh] min-h-0 overflow-y-auto lg:max-h-none"
          activeStage={active}
          currentStage={doc.current_stage}
          status={doc.status}
          qcNavClampStage={qcPending ? pipelineCurrent : null}
          onSelect={(s) => setActive(s)}
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <PipelineFlow
            variant="compact"
            doc={doc}
            active={active}
            qcNavClampStage={qcPending ? pipelineCurrent : null}
            onSelect={(s) => setActive(s)}
          />

          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-teal-200/90 bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow-sm">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-bold uppercase tracking-wider text-teal-800">Enhancement SOP</span>
              <span className="font-mono text-sm font-semibold text-teal-900">{doc.target_qs}</span>
              <span className="text-zinc-500">QS target (80–100) for auto passes</span>
            </div>
            {(() => {
              const enh = mergedStageCfg.enhancement as { config?: Record<string, unknown> } | undefined;
              const c = enh?.config;
              if (!c) return null;
              return (
                <span className="text-zinc-600">
                  Server config: <span className="font-mono text-[11px] text-zinc-800">max_passes {String(c.max_passes)}</span>
                  <span className="mx-1 text-zinc-300">·</span>
                  <span className="font-mono text-[11px] text-zinc-800">min_gain {String(c.min_pass_improvement)}</span>
                  <span className="mx-1 text-zinc-300">·</span>
                  <span className="font-mono text-[11px] text-zinc-800">stall {String(c.stall_window_passes)}</span>
                </span>
              );
            })()}
            <div className="flex flex-wrap items-center gap-2">
              {!stageCfg && stageCfgErr && (
                <span className="text-amber-800" title={stageCfgErr}>
                  Config API unavailable — showing defaults
                </span>
              )}
              {stageCfg && <span className="text-emerald-700 font-medium">Live server config</span>}
              <button type="button" onClick={refreshStageConfig} className="btn-ghost px-2 py-1 text-[11px]">
                Reload config
              </button>
            </div>
          </div>

          {hasPages && (
            <div className="shrink-0 xl:hidden">
              <PagePreviewGallery
                layout="strip"
                documentId={doc.id}
                documentInitialQs={doc.initial_qs}
                documentPostQs={doc.post_qs}
                pages={doc.pages!}
                sopTarget={doc.target_qs}
                cacheVersion={doc.updated_at}
              />
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 min-[1280px]:grid-cols-[1fr_12.5rem] min-[1440px]:grid-cols-[1fr_13.5rem]">
            <div className="qc-stage-surface flex min-h-0 min-w-0 flex-col">
              <div className="flex shrink-0 flex-col gap-1 border-b border-teal-100/90 bg-gradient-to-r from-teal-50/80 to-emerald-50/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-800">Active stage</div>
                  <div className="truncate text-sm font-bold text-zinc-900 sm:text-base">{activeStageLabel}</div>
                </div>
                <p className="max-w-md text-[10px] leading-snug text-zinc-600 sm:text-xs">
                  Approve / Reject at the bottom of this panel. Switch stages via the row above or the list on the
                  left.
                </p>
              </div>
              <div className="qc-stage-scroll min-h-0 px-3 py-3 sm:px-4 sm:py-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={viewingFutureStage ? `locked-${active}` : active}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    {viewingFutureStage && pipelineCurrent && pipelineCurrentLabel ? (
                      <div className="surface mx-auto max-w-lg border border-amber-200/90 bg-amber-50/80 px-6 py-8 text-center shadow-sm">
                        <p className="text-sm font-semibold text-amber-950">
                          <span className="text-ink-900">{activeStageLabel}</span> is not available yet.
                        </p>
                        <p className="mt-3 text-sm text-ink-700 leading-relaxed">
                          The pipeline is waiting on <strong>{pipelineCurrentLabel}</strong>
                          {qcPending ? " (QC — approve or reject there first)" : " before this stage runs."}
                        </p>
                        <button
                          type="button"
                          onClick={() => setActive(pipelineCurrent)}
                          className="btn-primary mt-6 w-full sm:w-auto"
                        >
                          Open {pipelineCurrentLabel}
                        </button>
                      </div>
                    ) : (
                      <>
                        {active === "enhancement" && (
                          <QCEnhancement
                            doc={doc}
                            onUpdate={handleUpdate}
                            stagePublicConfig={mergedStageCfg}
                            stageConfigFromServer={Boolean(stageCfg)}
                            stageConfigError={stageCfgErr}
                            onRetryStageConfig={refreshStageConfig}
                          />
                        )}
                        {active === "ocr" && <QCOcr doc={doc} onUpdate={handleUpdate} />}
                        {active === "doc_class" && <QCClassify doc={doc} onUpdate={handleUpdate} />}
                        {active === "index_genius" && <QCIndex doc={doc} onUpdate={handleUpdate} />}
                        {active === "abstractor" && <QCAbstract doc={doc} onUpdate={handleUpdate} />}
                        {active === "lingua" && <QCLingua doc={doc} onUpdate={handleUpdate} />}
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
