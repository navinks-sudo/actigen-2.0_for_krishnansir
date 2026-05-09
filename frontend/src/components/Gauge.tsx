import { motion } from "framer-motion";

interface Props {
  value: number | null;
  label: string;
  size?: number;
  target?: number;
  color?: string;
  pendingLabel?: string;
  /** When set, the gauge is a control (e.g. refresh scores from server). */
  onClick?: () => void;
  clickDisabled?: boolean;
  clickTitle?: string;
}

export default function Gauge({
  value,
  label,
  size = 120,
  target,
  color = "text-brand-500",
  pendingLabel = "—",
  onClick,
  clickDisabled,
  clickTitle,
}: Props) {
  const pending = value == null || Number.isNaN(Number(value));
  const v = pending ? 0 : Math.max(0, Math.min(100, Number(value)));
  const radius = (size - 12) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (v / 100) * circ;
  const reached = !pending && target !== undefined ? v >= target : false;
  const interactive = Boolean(onClick) && !clickDisabled;

  const inner = (
    <>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={8}
            stroke="rgba(15,23,42,0.06)"
            fill="none"
          />
          {!pending && (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={8}
              strokeLinecap="round"
              stroke="currentColor"
              fill="none"
              className={reached ? "text-emerald-500" : color}
              initial={{ strokeDasharray: circ, strokeDashoffset: circ }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              style={{ strokeDasharray: circ }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={`text-2xl font-bold ${pending ? "text-ink-400" : "text-ink-900"}`}>
            {pending ? pendingLabel : v.toFixed(2)}
          </div>
          {target !== undefined && (
            <div className="text-[10px] text-ink-400 uppercase tracking-wider mt-0.5">
              target {target}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-ink-500 uppercase tracking-wider font-semibold">{label}</div>
    </>
  );

  if (onClick) {
    return (
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={onClick}
          disabled={clickDisabled}
          title={clickTitle}
          className={`flex flex-col items-center rounded-2xl border border-transparent bg-transparent p-1 text-left transition-colors ${
            interactive
              ? "cursor-pointer hover:border-brand-200/80 hover:bg-brand-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              : "cursor-default opacity-80"
          }`}
        >
          {inner}
        </button>
      </div>
    );
  }

  return <div className="flex flex-col items-center">{inner}</div>;
}
