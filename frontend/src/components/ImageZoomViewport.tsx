import { useState, useCallback, useEffect, type ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

const SCALE_MIN = 0.5;
const SCALE_MAX = 4;
const SCALE_STEP = 1.2;

type ToolbarPlacement = "overlay-tr" | "overlay-br" | "bar-bottom";

type Props = {
  children: ReactNode;
  /** Outer wrapper — use h-full min-h-0 flex-1, or absolute inset-0, etc. */
  className?: string;
  /** When this value changes, zoom resets to 100%. */
  resetKey?: string | number;
  toolbar?: ToolbarPlacement;
  tone?: "light" | "dark";
};

/**
 * Scrollable area + zoom in / zoom out / reset. Ctrl/Cmd + wheel zooms when pointer is over the viewport.
 */
export default function ImageZoomViewport({
  children,
  className = "",
  resetKey,
  toolbar = "overlay-tr",
  tone = "light",
}: Props) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [resetKey]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(SCALE_MAX, Math.round(s * SCALE_STEP * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(SCALE_MIN, Math.round((s / SCALE_STEP) * 100) / 100));
  }, []);

  const reset = useCallback(() => setScale(1), []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    },
    [zoomIn, zoomOut]
  );

  const atMin = scale <= SCALE_MIN + 0.001;
  const atMax = scale >= SCALE_MAX - 0.001;

  const bar =
    tone === "dark" ? (
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-white/20 bg-zinc-900/90 p-1 shadow-lg backdrop-blur-sm">
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
          title="Reset zoom"
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
    ) : (
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-zinc-200/90 bg-white/95 p-1 shadow-md backdrop-blur-sm">
        <button
          type="button"
          onClick={zoomOut}
          disabled={atMin}
          className="rounded-md p-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={reset}
          className="min-w-[2.75rem] px-1 text-center text-[11px] font-semibold tabular-nums text-zinc-600 hover:text-zinc-900"
          title="Reset zoom (Ctrl or ⌘ + scroll to zoom)"
          aria-label={`Reset zoom, currently ${Math.round(scale * 100)} percent`}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={atMax}
          className="rounded-md p-1.5 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
    );

  const toolbarPos =
    toolbar === "overlay-tr"
      ? "absolute right-2 top-2 z-[25]"
      : toolbar === "overlay-br"
        ? "absolute bottom-2 right-2 z-[25]"
        : "absolute bottom-2 left-1/2 z-[25] -translate-x-1/2";

  const scrollInset =
    toolbar === "overlay-tr"
      ? "absolute inset-x-0 bottom-0 top-11"
      : toolbar === "overlay-br"
        ? "absolute inset-x-0 bottom-11 top-0"
        : "absolute inset-x-0 bottom-11 top-0";

  return (
    <div className={`relative h-full min-h-0 min-w-0 ${className}`} onWheel={onWheel}>
      {/* Avoid bubbling to ancestor click targets (e.g. page-select cards wrapping this viewport). */}
      <div className={toolbarPos} onClick={(e) => e.stopPropagation()}>
        {bar}
      </div>
      <div className={`overflow-auto ${scrollInset}`}>
        <div className="flex min-h-full min-w-full items-center justify-center p-2">
          <div
            className="inline-block origin-center transition-transform duration-150 ease-out"
            style={{ transform: `scale(${scale})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
