import { motion } from "framer-motion";
import { Sparkles, ScanText, Tags, Network, FileText, Languages } from "lucide-react";
import { STAGES, StageKey } from "../lib/api";

const ICONS: Record<StageKey, any> = {
  enhancement: Sparkles,
  ocr: ScanText,
  doc_class: Tags,
  index_genius: Network,
  abstractor: FileText,
  lingua: Languages,
};

const ACCENTS: Record<string, string> = {
  cyan: "from-sky-100 to-cyan-100 text-sky-700",
  violet: "from-violet-100 to-indigo-100 text-violet-700",
  pink: "from-pink-100 to-rose-100 text-pink-700",
  lime: "from-lime-100 to-emerald-100 text-emerald-700",
  amber: "from-amber-100 to-orange-100 text-amber-700",
};

interface Props {
  activeStage?: StageKey | null;
  currentStage?: string;
  status?: string;
  onSelect?: (s: StageKey) => void;
  /** When set (e.g. document is `qc_pending`), stages after this index cannot be selected until QC moves forward. */
  qcNavClampStage?: StageKey | null;
  compact?: boolean;
  className?: string;
}

export default function StagesSidebar({
  activeStage,
  currentStage,
  status,
  onSelect,
  qcNavClampStage = null,
  compact = false,
  className,
}: Props) {
  const currentIdx = currentStage ? STAGES.findIndex((s) => s.key === currentStage) : -1;
  const clampIdx =
    qcNavClampStage != null ? STAGES.findIndex((s) => s.key === qcNavClampStage) : -1;
  const clampLabel = clampIdx >= 0 ? STAGES[clampIdx]?.label ?? qcNavClampStage : "";

  return (
    <aside
      className={`self-start rounded-xl border border-zinc-200/90 bg-gradient-to-b from-white via-white to-zinc-50/70 shadow-sm ring-1 ring-zinc-900/[0.03] lg:sticky lg:top-2 ${
        compact ? "p-3" : "p-5"
      } ${className ?? ""}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="label text-teal-800">Pipeline</div>
        <div className="text-[10px] text-ink-400 font-mono">6 stages</div>
      </div>
      <ol className="space-y-1.5">
        {STAGES.map((s, i) => {
          const Icon = ICONS[s.key];
          const isActive = activeStage === s.key;
          const isCurrent = currentStage === s.key;
          const isDone = currentIdx > i || status === "completed";
          const isQc = isCurrent && status === "qc_pending";
          const navBlocked = clampIdx >= 0 && i > clampIdx;

          return (
            <motion.li
              key={s.key}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                type="button"
                onClick={() => !navBlocked && onSelect?.(s.key as StageKey)}
                disabled={!onSelect || navBlocked}
                title={
                  navBlocked
                    ? `Finish QC at ${clampLabel} before opening later stages.`
                    : undefined
                }
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-teal-50 to-emerald-50 ring-2 ring-teal-400/60 shadow-sm"
                    : navBlocked
                      ? "cursor-not-allowed opacity-45"
                      : "hover:bg-zinc-50"
                } ${onSelect && !navBlocked ? "cursor-pointer" : ""} ${!onSelect ? "cursor-default" : ""}`}
              >
                <div
                  className={`w-9 h-9 rounded-xl bg-gradient-to-br ${ACCENTS[s.color]} flex items-center justify-center shrink-0 shadow-soft`}
                >
                  <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">
                    Stage {i + 1}
                  </div>
                  <div className="text-sm font-medium text-ink-900 truncate">
                    {compact ? s.short : s.label}
                  </div>
                </div>
                <div className="shrink-0">
                  {isDone ? (
                    <span className="chip bg-emerald-100 text-emerald-700">done</span>
                  ) : isQc ? (
                    <span className="chip bg-brand-100 text-brand-700 relative">
                      QC
                      <span className="absolute inset-0 rounded-md animate-ping2 bg-brand-300" />
                    </span>
                  ) : isCurrent ? (
                    <span className="chip bg-amber-100 text-amber-700">running</span>
                  ) : null}
                </div>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </aside>
  );
}
