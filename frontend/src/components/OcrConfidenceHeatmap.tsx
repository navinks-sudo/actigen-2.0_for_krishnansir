import { useMemo, useState } from "react";
import { OcrBoxT } from "../lib/api";

interface Props {
  boxes: OcrBoxT[];
  /** Cap how many words to render — keeps very dense pages snappy. */
  limit?: number;
}

type Bucket = "high" | "mid" | "low";

function bucketOf(c: number): Bucket {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "mid";
  return "low";
}

const COLORS: Record<Bucket, { bg: string; text: string; ring: string; chip: string; dot: string; label: string }> = {
  high: {
    bg: "bg-emerald-100",
    text: "text-emerald-900",
    ring: "ring-emerald-300",
    chip: "bg-emerald-50 border-emerald-300 text-emerald-800",
    dot: "bg-emerald-500",
    label: "≥85% confident",
  },
  mid: {
    bg: "bg-amber-100",
    text: "text-amber-900",
    ring: "ring-amber-300",
    chip: "bg-amber-50 border-amber-300 text-amber-800",
    dot: "bg-amber-500",
    label: "60–85%",
  },
  low: {
    bg: "bg-rose-100",
    text: "text-rose-900",
    ring: "ring-rose-300",
    chip: "bg-rose-50 border-rose-300 text-rose-800",
    dot: "bg-rose-500",
    label: "<60% — review",
  },
};

/** A character-level micro-bar: each char gets a tile whose intensity tracks the parent word's
 *  confidence. Adds a subtle jitter per char so visually similar words aren't indistinguishable. */
function CharStrip({ text, confidence }: { text: string; confidence: number }) {
  const chars = Array.from(text);
  return (
    <div className="mt-0.5 flex h-1.5 gap-[1px] overflow-hidden rounded-sm">
      {chars.map((_, i) => {
        // Per-char wobble: ±15% confidence. Lower-confidence words show more variation.
        const wobble = ((i * 37) % 30) / 100 - 0.15;
        const c = Math.max(0, Math.min(1, confidence * (1 + wobble * (1 - confidence))));
        const b = bucketOf(c);
        const bgClass =
          b === "high" ? "bg-emerald-400/80" : b === "mid" ? "bg-amber-400/80" : "bg-rose-400/80";
        return <div key={i} className={`flex-1 ${bgClass}`} />;
      })}
    </div>
  );
}

export default function OcrConfidenceHeatmap({ boxes, limit = 1500 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const usable = useMemo(
    () =>
      (boxes || [])
        .filter((b) => (b?.text || "").trim() && typeof b.confidence === "number" && b.confidence >= 0)
        .slice(0, limit),
    [boxes, limit],
  );

  const stats = useMemo(() => {
    const buckets = { high: 0, mid: 0, low: 0 };
    let sum = 0;
    for (const b of usable) {
      buckets[bucketOf(b.confidence)] += 1;
      sum += b.confidence;
    }
    const n = usable.length || 1;
    return { ...buckets, avg: sum / n, count: usable.length };
  }, [usable]);

  if (!usable.length) {
    return (
      <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/50 p-4 text-center text-xs text-ink-500">
        No per-word confidence available for this page yet. Re-run <strong>OCR</strong> to generate it.
      </div>
    );
  }

  const avgPct = Math.round(stats.avg * 100);
  const total = stats.count;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip border border-violet-200 bg-violet-50 text-violet-800">
            Avg confidence · {avgPct}%
          </span>
          <span className="chip border border-emerald-200 bg-emerald-50 text-emerald-800">
            {stats.high} high
          </span>
          <span className="chip border border-amber-200 bg-amber-50 text-amber-800">
            {stats.mid} mid
          </span>
          <span className="chip border border-rose-200 bg-rose-50 text-rose-800">
            {stats.low} low
          </span>
          <span className="text-[11px] text-ink-500">· {total} words</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-600">
          {(["high", "mid", "low"] as Bucket[]).map((b) => (
            <span key={b} className="inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${COLORS[b].dot}`} />
              {COLORS[b].label}
            </span>
          ))}
        </div>
      </div>

      {/* Confidence histogram bar — each segment is a word, drawn left→right in OCR order. */}
      <div className="flex h-2 w-full overflow-hidden rounded-full border border-ink-100 bg-ink-50">
        {usable.map((b, i) => {
          const bk = bucketOf(b.confidence);
          const cls =
            bk === "high" ? "bg-emerald-400" : bk === "mid" ? "bg-amber-400" : "bg-rose-400";
          const isHover = hoverIdx === i;
          return (
            <div
              key={`bar-${i}`}
              className={`${cls} h-full ${isHover ? "ring-2 ring-violet-500" : ""}`}
              style={{ flex: "1 1 0", minWidth: "1px" }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
              title={`#${i + 1} "${b.text}" — ${(b.confidence * 100).toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Word grid — each word is a tile; hover shows char-level confidence strip + tooltip. */}
      <div className="rounded-xl border border-ink-100 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {usable.map((b, i) => {
            const bk = bucketOf(b.confidence);
            const c = COLORS[bk];
            const pct = Math.round(b.confidence * 100);
            const isHover = hoverIdx === i;
            return (
              <div
                key={`w-${i}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                className={`group relative cursor-default select-text rounded-md px-1.5 py-0.5 text-[13px] font-mono leading-snug ring-1 transition ${c.bg} ${c.text} ${c.ring} ${
                  isHover ? "ring-2 ring-violet-500 z-10" : ""
                }`}
                title={`"${b.text}" — ${pct}% confident`}
              >
                <div className="whitespace-pre">{b.text}</div>
                <CharStrip text={b.text} confidence={b.confidence} />
                {isHover && (
                  <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] font-sans text-ink-800 shadow-lg whitespace-nowrap">
                    <span className="font-mono">{b.text}</span>
                    <span className="mx-1.5 text-ink-300">·</span>
                    <span className={`font-semibold ${c.text}`}>{pct}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {boxes && boxes.length > limit && (
          <p className="mt-2 text-[11px] text-ink-500">
            Showing the first {limit.toLocaleString()} of {boxes.length.toLocaleString()} words for performance.
          </p>
        )}
      </div>
    </div>
  );
}
