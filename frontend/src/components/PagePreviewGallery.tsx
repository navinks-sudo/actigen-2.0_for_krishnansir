import { useState } from "react";
import { motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { DocumentPageT, fileUrl, formatQs } from "../lib/api";
import ImageLightbox from "./ImageLightbox";
import ImageZoomViewport from "./ImageZoomViewport";

type Props = {
  pages: DocumentPageT[];
  /** Required for fullscreen Metrics (loads `/documents/:id/pages/:i/quality`). */
  documentId: number;
  documentInitialQs?: number | null;
  documentPostQs?: number | null;
  /** SOP quality target — shown in fullscreen metrics panel. */
  sopTarget?: number | null;
  /** Bust browser cache on enhanced previews after tune/re-run. */
  cacheVersion?: string | null;
  /** `strip` = one horizontal scroller (saves vertical space). `rail` = narrow vertical column. */
  layout?: "default" | "strip" | "rail";
};

/**
 * Page previews with initial QS; opens fullscreen lightbox via the expand control (zoom is on the image).
 */
export default function PagePreviewGallery({
  pages,
  documentId,
  documentInitialQs,
  documentPostQs,
  sopTarget,
  cacheVersion,
  layout = "default",
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  if (!pages.length) return null;

  const openAt = (i: number) => {
    setLightboxIndex(i);
    setLightboxOpen(true);
  };

  if (layout === "strip") {
    return (
      <>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Pages</h3>
            <span className="text-[10px] text-zinc-400">Zoom on thumbnails · expand for full QC</span>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 pt-0.5">
            {pages.map((p, i) => {
              const src = fileUrl(p.image_path);
              const rk = `${src ?? ""}-${cacheVersion ?? ""}-${i}`;
              return (
                <motion.div
                  key={p.id != null ? `st-${p.id}` : `st-${p.page_index}-${p.image_path}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="group relative w-[5.5rem] shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm sm:w-24"
                >
                  <div className="relative aspect-[3/4] bg-zinc-50">
                    {src ? (
                      <ImageZoomViewport className="absolute inset-0" resetKey={rk} toolbar="overlay-br">
                        <img src={src} alt="" className="h-28 w-full max-w-[6.5rem] object-cover sm:h-32" />
                      </ImageZoomViewport>
                    ) : (
                      <span className="flex h-full items-center justify-center text-[10px] text-zinc-400">No img</span>
                    )}
                    <button
                      type="button"
                      onClick={() => openAt(i)}
                      className="absolute right-1 top-1 z-30 rounded-md border border-zinc-200 bg-white/95 p-1 text-zinc-700 shadow-sm transition-colors hover:bg-teal-50 hover:text-teal-900"
                      aria-label={`Open page ${i + 1} full screen`}
                      title="Full screen"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <div className="pointer-events-none absolute left-1 top-1 rounded bg-white/95 px-1 py-0.5 text-[9px] font-bold text-zinc-800 shadow-sm">
                      {i + 1}
                    </div>
                    {p.initial_qs != null && (
                      <div className="pointer-events-none absolute bottom-1 left-1 right-1 truncate rounded bg-emerald-50/95 px-1 py-0.5 text-center text-[9px] font-mono font-semibold text-emerald-900">
                        {formatQs(p.initial_qs)}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
        <ImageLightbox
          pages={pages}
          index={lightboxIndex}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setLightboxIndex}
          sopTarget={sopTarget}
          cacheVersion={cacheVersion}
          documentId={documentId}
          documentInitialQs={documentInitialQs}
          documentPostQs={documentPostQs}
        />
      </>
    );
  }

  if (layout === "rail") {
    return (
      <>
        <div className="flex h-full min-h-0 flex-col gap-2 border-l border-zinc-200 pl-3">
          <h3 className="shrink-0 text-xs font-bold uppercase tracking-wider text-zinc-500">Pages</h3>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {pages.map((p, i) => {
              const src = fileUrl(p.image_path);
              const rk = `${src ?? ""}-${cacheVersion ?? ""}-rail-${i}`;
              return (
                <motion.div
                  key={p.id != null ? `rl-${p.id}` : `rl-${p.page_index}-${p.image_path}`}
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group relative w-full max-w-[11rem] shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="relative aspect-[3/4] w-full bg-zinc-50">
                    {src ? (
                      <ImageZoomViewport className="absolute inset-0" resetKey={rk} toolbar="overlay-br">
                        <img src={src} alt="" className="h-44 w-full max-w-[11rem] object-cover" />
                      </ImageZoomViewport>
                    ) : (
                      <span className="flex h-full items-center justify-center text-xs text-zinc-400">No preview</span>
                    )}
                    <button
                      type="button"
                      onClick={() => openAt(i)}
                      className="absolute right-1.5 top-1.5 z-30 rounded-md border border-zinc-200 bg-white/95 p-1 text-zinc-700 shadow-sm hover:bg-teal-50"
                      aria-label={`Open page ${p.page_index + 1} full screen`}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-bold text-zinc-800 shadow-sm">
                      Page {p.page_index + 1}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 border-t border-zinc-100 px-2 py-1.5 text-[10px] font-mono text-zinc-600">
                    {p.initial_qs != null && <span className="text-emerald-700">I {formatQs(p.initial_qs)}</span>}
                    {p.post_qs != null && <span className="text-teal-700">P {formatQs(p.post_qs)}</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
        <ImageLightbox
          pages={pages}
          index={lightboxIndex}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setLightboxIndex}
          sopTarget={sopTarget}
          cacheVersion={cacheVersion}
          documentId={documentId}
          documentInitialQs={documentInitialQs}
          documentPostQs={documentPostQs}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-bold text-ink-900">Converted pages</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              {pages.length} page{pages.length !== 1 ? "s" : ""} · zoom with on-image controls or Ctrl/⌘ + scroll ·
              expand for full screen and metrics.
            </p>
            {pages.length > 1 && (
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-500">
                Each page is scored on its own PNG (not copied from the other page). Matching scores usually mean very
                similar pages or values that looked the same when rounded — check two decimal places on the chips below.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {pages.map((p, i) => {
            const src = fileUrl(p.image_path);
            const rk = `${src ?? ""}-${cacheVersion ?? ""}-def-${i}`;
            return (
              <motion.div
                key={p.id != null ? `db-${p.id}` : `p-${p.page_index}-${p.image_path}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="group overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-soft transition-all hover:border-brand-300 hover:shadow-pop"
              >
                <div className="relative flex min-h-0 flex-col bg-ink-50">
                  <div className="relative aspect-[4/5] w-full min-h-[12rem]">
                    {src ? (
                      <ImageZoomViewport className="absolute inset-0" resetKey={rk} toolbar="overlay-br">
                        <img
                          src={src}
                          alt={`Page ${p.page_index + 1}`}
                          className="max-h-[min(52vh,480px)] w-full object-contain"
                        />
                      </ImageZoomViewport>
                    ) : (
                      <span className="flex h-full items-center justify-center text-sm text-ink-400">No preview</span>
                    )}
                    <button
                      type="button"
                      onClick={() => openAt(i)}
                      className="absolute right-3 top-3 z-30 inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white/95 px-3 py-2 text-sm font-medium text-ink-800 shadow-md transition-colors hover:bg-teal-50 hover:text-teal-900"
                    >
                      <Maximize2 className="h-4 w-4" /> Full screen
                    </button>
                    <div className="pointer-events-none absolute left-3 top-3 chip border border-ink-200 bg-white/95 text-xs font-semibold text-ink-800 shadow-sm">
                      Page {p.page_index + 1}
                    </div>
                    <div className="pointer-events-none absolute right-3 top-14 flex flex-col items-end gap-1">
                      {p.initial_qs != null && (
                        <div className="chip border border-emerald-200 bg-emerald-50 text-xs font-mono font-semibold text-emerald-900 shadow-sm">
                          Init {formatQs(p.initial_qs)}
                        </div>
                      )}
                      {p.post_qs != null && (
                        <div className="chip border border-pink-200 bg-pink-50 text-xs font-mono font-semibold text-pink-900 shadow-sm">
                          Post {formatQs(p.post_qs)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-3">
                  <span className="text-sm font-medium text-ink-800">Page {p.page_index + 1}</span>
                  <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs font-mono">
                    {p.initial_qs != null && <span className="text-emerald-700">Initial {formatQs(p.initial_qs)}</span>}
                    {p.post_qs != null && <span className="text-pink-700">Post {formatQs(p.post_qs)}</span>}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <ImageLightbox
        pages={pages}
        index={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onIndexChange={setLightboxIndex}
        sopTarget={sopTarget}
        cacheVersion={cacheVersion}
        documentId={documentId}
        documentInitialQs={documentInitialQs}
        documentPostQs={documentPostQs}
      />
    </>
  );
}
