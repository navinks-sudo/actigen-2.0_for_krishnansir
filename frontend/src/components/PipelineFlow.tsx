import { motion } from "framer-motion";
import { Check, Loader2, Sparkles, ScanText, Tags, Network, FileText, Languages } from "lucide-react";
import { STAGES, StageKey, DocumentT } from "../lib/api";

const ICONS: Record<StageKey, any> = {
  enhancement: Sparkles,
  ocr: ScanText,
  doc_class: Tags,
  index_genius: Network,
  abstractor: FileText,
  lingua: Languages,
};

const ACCENTS: Record<string, string> = {
  cyan: "from-sky-400 to-cyan-500",
  violet: "from-violet-400 to-indigo-500",
  pink: "from-pink-400 to-rose-500",
  lime: "from-lime-400 to-emerald-500",
  amber: "from-amber-400 to-orange-500",
};

interface Props {
  doc: DocumentT;
  active: StageKey;
  onSelect: (stage: StageKey) => void;
  /** When set (`qc_pending`), cannot jump to stages after this until QC advances. */
  qcNavClampStage?: StageKey | null;
  className?: string;
  /** Slim single-row strip — use under the header so QC content gets vertical space. */
  variant?: "default" | "compact";
}

export default function PipelineFlow({
  doc,
  active,
  onSelect,
  qcNavClampStage = null,
  className,
  variant = "default",
}: Props) {
  const currentIdx = STAGES.findIndex((s) => s.key === doc.current_stage);
  const clampIdx =
    qcNavClampStage != null ? STAGES.findIndex((s) => s.key === qcNavClampStage) : -1;
  const clampLabel = clampIdx >= 0 ? STAGES[clampIdx]?.label ?? qcNavClampStage : "";

  const stageState = (idx: number) => {
    if (doc.status === "completed") return "done";
    if (idx < currentIdx) return "done";
    if (idx === currentIdx) {
      if (doc.status === "processing") return "running";
      if (doc.status === "qc_pending") return "qc";
      return "pending";
    }
    return "future";
  };

  const row = (
    <div
      className={`flex items-center ${variant === "compact" ? "justify-between gap-0.5 px-0.5" : "flex-wrap items-stretch justify-center gap-x-0.5 gap-y-4 sm:flex-nowrap sm:justify-between sm:gap-x-1"}`}
    >
      {STAGES.map((s, i) => {
        const Icon = ICONS[s.key];
        const state = stageState(i);
        const isActive = active === s.key;
        const isDone = state === "done";
        const isRunning = state === "running";
        const isQc = state === "qc";
        const navBlocked = clampIdx >= 0 && i > clampIdx;

        const iconWrap =
          variant === "compact"
            ? "h-9 w-9 rounded-xl sm:h-10 sm:w-10"
            : "h-12 w-12 rounded-2xl sm:h-14 sm:w-14";
        const iconInner = variant === "compact" ? "h-4 w-4 sm:h-[18px] sm:w-[18px]" : "h-5 w-5 sm:h-6 sm:w-6";

        return (
          <div
            key={s.key}
            className={
              variant === "compact"
                ? "flex min-w-0 flex-1 items-center"
                : "flex min-w-[4.75rem] max-w-[7.25rem] flex-[1_1_auto] items-center sm:max-w-none sm:flex-1"
            }
          >
            <button
              type="button"
              disabled={navBlocked}
              title={
                navBlocked
                  ? `Finish QC at ${clampLabel} before opening later stages.`
                  : `${s.label} — ${state === "done" ? "Done" : state === "qc" ? "QC" : state === "running" ? "Running" : "Pending"}`
              }
              onClick={() => !navBlocked && onSelect(s.key)}
              className={`group relative flex w-full items-center ${variant === "compact" ? "flex-col gap-1 py-1" : "flex-col gap-1.5 sm:gap-2"} ${
                navBlocked ? "cursor-not-allowed opacity-45" : ""
              }`}
            >
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className={`relative flex shrink-0 items-center justify-center border transition-all ${iconWrap} ${
                  isActive ? "border-teal-500 shadow-sm ring-2 ring-teal-400/40" : "border-zinc-200"
                } ${
                  isDone || isRunning || isQc ? `bg-gradient-to-br ${ACCENTS[s.color]} shadow-sm` : "bg-white"
                }`}
              >
                {isRunning ? (
                  <Loader2 className={`${iconInner} animate-spin text-white`} />
                ) : isDone ? (
                  <Check className={`${iconInner} text-white`} strokeWidth={3} />
                ) : (
                  <Icon className={`${iconInner} ${isQc ? "text-white" : "text-zinc-500 group-hover:text-zinc-800"}`} />
                )}
                {isQc && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                    <span className="animate-ping2 absolute inline-flex h-full w-full rounded-full bg-brand-400" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
                  </span>
                )}
              </motion.div>
              <div className="w-full min-w-0 text-center">
                <div
                  className={`truncate font-bold leading-none text-ink-800 ${
                    variant === "compact" ? "text-[9px] sm:text-[10px]" : "text-[11px] sm:text-xs"
                  } ${isActive ? "text-teal-900" : ""}`}
                >
                  {s.short}
                </div>
                {variant === "default" && (
                  <>
                    <div
                      className={`mt-0.5 line-clamp-2 min-h-[2rem] text-[9px] font-medium leading-snug text-ink-500 sm:text-[10px] ${
                        isActive ? "text-teal-800" : ""
                      }`}
                    >
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                      {state === "done"
                        ? "Done"
                        : state === "qc"
                          ? "QC"
                          : state === "running"
                            ? "Running"
                            : ""}
                    </div>
                  </>
                )}
                {variant === "compact" && (
                  <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-zinc-400">
                    {state === "done" ? "✓" : state === "qc" ? "QC" : state === "running" ? "…" : ""}
                  </div>
                )}
              </div>
            </button>
            {i < STAGES.length - 1 && (
              <div
                className={`relative hidden flex-1 self-center sm:block ${variant === "compact" ? "mx-0 min-w-[2px] max-w-[12px]" : "mx-0.5 min-w-[6px] sm:mx-2"}`}
              >
                <div className="h-px bg-zinc-200" />
                {(isDone || isRunning || isQc) && <div className="absolute inset-0 flow-line h-px" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (variant === "compact") {
    return (
      <div
        className={`shrink-0 rounded-lg border border-zinc-200 bg-zinc-50/80 px-1 py-1.5 shadow-sm sm:px-2 ${className ?? ""}`}
      >
        {row}
      </div>
    );
  }

  return (
    <div className={`surface p-4 sm:p-5 ${className ?? ""}`}>
      <div className="mb-3 border-b border-ink-100 pb-2 text-left">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Pipeline stages</div>
        <p className="mt-0.5 text-xs leading-snug text-ink-600">
          Click a stage for its QC tools — enhancement, OCR, classify, index, abstract, then translate. Six steps total.
        </p>
      </div>
      {row}
    </div>
  );
}
