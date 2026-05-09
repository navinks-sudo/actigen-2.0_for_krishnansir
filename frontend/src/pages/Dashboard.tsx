import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FileImage, Plus, Trash2, Activity, ChevronRight, ClipboardList, CheckCircle2, Zap, Maximize2 } from "lucide-react";
import { api, DocumentT, fileUrl, STAGES } from "../lib/api";
import ImageZoomViewport from "../components/ImageZoomViewport";

const statusStyle: Record<string, string> = {
  pending: "bg-ink-100 text-ink-700 border border-ink-200",
  processing: "bg-amber-100 text-amber-800 border border-amber-200",
  qc_pending: "bg-brand-100 text-brand-700 border border-brand-200",
  completed: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  failed: "bg-rose-100 text-rose-700 border border-rose-200",
};

function StatTile({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof FileImage;
  tone?: "default" | "accent" | "success";
}) {
  const tones = {
    default: "border-zinc-200 bg-zinc-50/80",
    accent: "border-teal-200/80 bg-teal-50/60",
    success: "border-emerald-200/80 bg-emerald-50/60",
  };
  return (
    <div className={`flex min-w-[7.5rem] flex-1 items-center gap-3 rounded-xl border px-4 py-3 sm:min-w-0 sm:flex-none ${tones[tone]}`}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-zinc-200/80">
        <Icon className="h-5 w-5 text-teal-700" aria-hidden />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums leading-none text-zinc-900">{value}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [docs, setDocs] = useState<DocumentT[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const stats = useMemo(() => {
    const qc = docs.filter((d) => d.status === "qc_pending").length;
    const done = docs.filter((d) => d.status === "completed").length;
    const run = docs.filter((d) => d.status === "processing").length;
    return { qc, done, run, total: docs.length };
  }, [docs]);

  const load = async () => {
    setLoading(true);
    try {
      setDocs(await api.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: number, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId != null) return;
    setDeleteErr(null);
    if (!confirm("Delete this document?")) return;
    setDeletingId(id);
    try {
      await api.remove(id);
      await load();
    } catch (err: unknown) {
      setDeleteErr(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-700">Workbench</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            Six-stage pipeline with QC at every gate. Open a document to continue where you left off.
          </p>
        </div>
        <Link to="/app/upload" className="btn-primary shrink-0 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> New document
        </Link>
      </header>

      {loading ? (
        <div className="surface flex flex-1 flex-col items-center justify-center p-16 text-zinc-500">
          <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600" aria-hidden />
          Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <div className="surface flex flex-1 flex-col items-center justify-center p-12 text-center sm:p-16">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-emerald-100">
            <FileImage className="h-8 w-8 text-teal-700" />
          </div>
          <h3 className="font-display text-xl font-bold text-zinc-900">No documents yet</h3>
          <p className="mt-1 max-w-sm text-zinc-600">Upload a file to start enhancement, OCR, and the rest of the pipeline.</p>
          <Link to="/app/upload" className="btn-primary mt-6">
            <Plus className="h-4 w-4" /> New document
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-6">
          {deleteErr && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{deleteErr}</div>
          )}

          <div className="flex flex-wrap gap-3">
            <StatTile label="Total" value={stats.total} icon={FileImage} tone="default" />
            <StatTile label="Awaiting QC" value={stats.qc} icon={ClipboardList} tone="accent" />
            <StatTile label="Running" value={stats.run} icon={Zap} tone="default" />
            <StatTile label="Completed" value={stats.done} icon={CheckCircle2} tone="success" />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-[1fr_15.5rem] xl:items-start xl:gap-8">
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-800">Library</h2>
                <span className="text-xs text-zinc-500">
                  {stats.total} item{stats.total !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-2 2xl:grid-cols-3">
                {docs.map((d, i) => {
                  const stageIdx = STAGES.findIndex((s) => s.key === d.current_stage);
                  const progress =
                    d.status === "completed"
                      ? 100
                      : Math.max(
                          0,
                          Math.min(100, ((stageIdx + (d.status === "qc_pending" ? 0.5 : 0)) / STAGES.length) * 100)
                        );
                  return (
                    <motion.div
                      key={d.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="surface group flex flex-col overflow-hidden p-0 transition-all duration-300 hover:-translate-y-0.5 hover:border-teal-300/70 hover:shadow-md"
                    >
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100">
                          {fileUrl(d.enhanced_path || d.original_path) ? (
                            <ImageZoomViewport
                              className="absolute inset-0 z-10 h-full w-full"
                              resetKey={`${d.id}-${d.enhanced_path || d.original_path}`}
                              toolbar="overlay-br"
                            >
                              <img
                                src={fileUrl(d.enhanced_path || d.original_path)!}
                                alt={d.filename}
                                className="h-full max-h-[28rem] w-full object-cover"
                              />
                            </ImageZoomViewport>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-300">
                              <FileImage className="h-10 w-10" />
                            </div>
                          )}
                          <div className="pointer-events-none absolute left-2 top-2 z-20">
                            <span className={`chip pointer-events-none ${statusStyle[d.status] || statusStyle.pending}`}>
                              <Activity className="h-3 w-3" /> {d.status.replace("_", " ")}
                            </span>
                          </div>
                          <Link
                            to={`/app/doc/${d.id}`}
                            className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-teal-800 shadow-md transition-colors hover:bg-teal-50"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                            Open
                          </Link>
                        </div>
                        <Link
                          to={`/app/doc/${d.id}`}
                          className="flex flex-1 flex-col gap-2 p-4 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 font-semibold leading-snug text-zinc-900">{d.filename}</div>
                            <div className="shrink-0 font-mono text-xs text-zinc-400">#{d.id}</div>
                          </div>
                          <div className="text-sm text-zinc-600">
                            Stage:{" "}
                            <span className="font-medium text-zinc-900">
                              {STAGES.find((s) => s.key === d.current_stage)?.short ?? d.current_stage}
                            </span>
                            {d.doc_class && <span className="text-zinc-500"> · {d.doc_class}</span>}
                          </div>
                          <div className="mt-auto h-2 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/80">
                            <motion.div
                              className="h-full bg-brand-grad"
                              initial={{ width: 0 }}
                              animate={{ width: `${progress}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }}
                            />
                          </div>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Open</span>
                            <span className="flex items-center gap-0.5 text-xs font-semibold text-teal-700 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100">
                              Continue <ChevronRight className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </Link>
                      </div>
                      <div className="flex justify-end border-t border-zinc-100 bg-zinc-50/50 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => remove(d.id, e)}
                          disabled={deletingId != null}
                          className="btn-danger px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Delete ${d.filename}`}
                          aria-busy={deletingId === d.id}
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${deletingId === d.id ? "animate-pulse" : ""}`} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <aside className="hidden min-w-0 xl:block">
              <div className="sticky top-2 space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 p-4 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Pipeline</h3>
                  <ol className="mt-3 space-y-2.5">
                    {STAGES.map((s, idx) => (
                      <li key={s.key} className="flex gap-2 text-xs leading-snug text-zinc-600">
                        <span className="w-5 shrink-0 text-right font-mono text-teal-700">{idx + 1}</span>
                        <span className="font-medium text-zinc-800">{s.short}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl border border-teal-200/60 bg-teal-50/40 p-4 text-xs leading-relaxed text-teal-950">
                  <strong className="font-semibold">Tip:</strong> documents with <em>Awaiting QC</em> need your approval before the pipeline continues.
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
