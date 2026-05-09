type Props = {
  className?: string;
  /** `mark` = image only (e.g. large hero). `full` = image + ACTIGEN wordmark. */
  variant?: "full" | "mark";
  /** Wordmark colours for dark UI (sidebar / marketing bar). */
  tone?: "default" | "onDark";
};

/** Corporate mark; with `full`, adds ACTIGEN 2.0 + tagline. */
export default function BrandLogo({ className = "", variant = "full", tone = "default" }: Props) {
  const onDark = tone === "onDark";
  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      <img
        src="/logo.png"
        alt="Logo"
        className={
          variant === "mark"
            ? "h-12 sm:h-16 w-auto max-w-[min(320px,90vw)] object-contain object-center shrink-0"
            : "h-9 sm:h-10 w-auto max-w-[min(200px,42vw)] object-contain object-left shrink-0"
        }
        decoding="async"
      />
      {variant === "full" && (
        <div className="min-w-0">
          <div className={`font-display text-lg font-bold leading-none ${onDark ? "text-white" : "text-ink-900"}`}>
            ACTIGEN 2.0
          </div>
          <div
            className={`mt-0.5 text-[10px] uppercase tracking-[0.18em] ${onDark ? "text-zinc-400" : "text-ink-400"}`}
          >
            One engine · multiple solutions
          </div>
        </div>
      )}
    </div>
  );
}
