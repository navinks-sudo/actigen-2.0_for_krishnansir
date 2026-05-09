import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Check, X, RotateCcw, Tags, Pencil } from "lucide-react";
import { api, DocumentT } from "../lib/api";
import StageSourcePages from "./StageSourcePages";

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
}

export default function QCClassify({ doc, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const pages = doc.pages ?? [];
  const multi = pages.length > 1;
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [chosen, setChosen] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draftClass, setDraftClass] = useState("");

  useEffect(() => {
    setSelectedPageIndex(0);
  }, [doc.id]);

  useEffect(() => {
    setSelectedPageIndex((i) => Math.max(0, Math.min(i, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  const activePage = multi ? pages.find((p) => p.page_index === selectedPageIndex) : pages[0];

  const predictedClass = multi
    ? activePage?.page_doc_class ?? null
    : doc.doc_class ?? null;
  const scores = multi
    ? activePage?.page_doc_class_scores ?? {}
    : doc.doc_class_scores ?? {};

  useEffect(() => {
    const cls = predictedClass ?? "";
    setChosen(cls);
    setEditing(false);
    setDraftClass(cls);
  }, [doc.id, predictedClass, selectedPageIndex, multi, activePage?.page_doc_class]);

  const saveCustomClass = async () => {
    const value = draftClass.trim();
    if (!value) return;
    setBusy(true);
    try {
      if (multi) {
        onUpdate(await api.correctClass(doc.id, { doc_class: value, page_index: selectedPageIndex }));
      } else {
        onUpdate(await api.correctClass(doc.id, { doc_class: value }));
      }
      setChosen(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      onUpdate(await api.classify(doc.id));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (multi) {
        onUpdate(
          await api.correctClass(doc.id, { doc_class: chosen, page_index: selectedPageIndex })
        );
      } else {
        onUpdate(await api.correctClass(doc.id, { doc_class: chosen }));
      }
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (chosen && chosen !== predictedClass) await save();
    setBusy(true);
    try {
      onUpdate(await api.approve(doc.id));
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      onUpdate(await api.reject(doc.id));
    } finally {
      setBusy(false);
    }
  };

  const sortedClasses = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const ready =
    multi && pages.length > 0
      ? pages.some((p) => p.page_doc_class != null && String(p.page_doc_class).trim() !== "")
      : doc.doc_class !== null;
  const max = sortedClasses[0]?.[1] || 1;

  const subtitle =
    multi && activePage && (!activePage.page_doc_class || String(activePage.page_doc_class).trim() === "")
      ? "No OCR text was available for this page — classification skipped. Select another page or fix OCR."
      : null;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
              <Tags className="w-5 h-5 text-pink-700" />
            </span>
            Document Classification
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            Predictions use <strong className="text-ink-800">Text IQ OCR only</strong> — corrected text if you saved
            edits, otherwise raw OCR.{" "}
            {multi ? (
              <>
                For PDFs, each page is classified separately; click a thumbnail to review scores and overrides for that
                page. Document-level fields mirror page 1 for compatibility.
              </>
            ) : (
              <>
                The engine blends TF-IDF similarity with keyword intent (bills, courts, invoices, etc.). Override below
                when the model misreads the doc type.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!ready && (
            <button type="button" onClick={run} disabled={busy} className="btn-primary">
              <Play className="w-4 h-4" /> Run Classifier
            </button>
          )}
          {ready && (
            <>
              <button type="button" onClick={run} disabled={busy} className="btn-ghost">
                <RotateCcw className="w-4 h-4" /> Re-run
              </button>
              <button type="button" onClick={reject} disabled={busy} className="btn-danger">
                <X className="w-4 h-4" /> Reject
              </button>
              <button type="button" onClick={approve} disabled={busy} className="btn-primary">
                <Check className="w-4 h-4" /> Approve & Continue
              </button>
            </>
          )}
        </div>
      </div>

      {subtitle && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{subtitle}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-start">
        <div className="lg:sticky lg:top-2 self-start flex flex-col gap-2">
          {multi && pages.length > 1 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-pink-200 bg-pink-50/70 px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                disabled={selectedPageIndex <= 0}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Previous page"
              >
                ← Prev
              </button>
              <span className="font-mono text-pink-900">
                Page {selectedPageIndex + 1} of {pages.length}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.min(pages.length - 1, i + 1))}
                disabled={selectedPageIndex >= pages.length - 1}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Next page"
              >
                Next →
              </button>
            </div>
          )}
          <StageSourcePages
            doc={doc}
            title={multi ? `Enhanced image — page ${selectedPageIndex + 1}` : "Enhanced image"}
            compact
            showOnly="enhanced"
            singlePage
            selectedPageIndex={multi ? selectedPageIndex : undefined}
            onSelectPage={multi ? setSelectedPageIndex : undefined}
          />
        </div>

        <div className="space-y-5">
        <div className="pane p-5">
          <div className="label mb-3 flex items-center justify-between gap-2">
            <span>{multi ? `Predicted class — page ${selectedPageIndex + 1}` : "Predicted Class"}</span>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setDraftClass(predictedClass ?? "");
                  setEditing(true);
                }}
                className="btn-soft text-xs inline-flex items-center gap-1.5 normal-case"
                title="Type a custom class label"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
          {editing ? (
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-5 rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 space-y-3"
            >
              <input
                type="text"
                autoFocus
                value={draftClass}
                onChange={(e) => setDraftClass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draftClass.trim()) saveCustomClass();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraftClass(predictedClass ?? "");
                  }
                }}
                placeholder="Type a custom class (e.g. budget_speech)"
                className="input w-full font-display text-2xl font-bold tracking-tight text-pink-900 bg-white/80"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraftClass(predictedClass ?? "");
                  }}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustomClass}
                  disabled={busy || !draftClass.trim() || draftClass.trim() === (predictedClass ?? "")}
                  className="btn-primary text-xs"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
              </div>
              <p className="text-[11px] text-pink-900/70">
                Press <kbd className="px-1 py-0.5 rounded bg-white/80 border border-pink-200 text-[10px]">Enter</kbd> to save,{" "}
                <kbd className="px-1 py-0.5 rounded bg-white/80 border border-pink-200 text-[10px]">Esc</kbd> to cancel.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={`${selectedPageIndex}-${predictedClass ?? ""}`}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-6 rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200"
            >
              <div className="font-display text-4xl font-bold tracking-tight text-pink-900">
                {predictedClass || "—"}
              </div>
            </motion.div>
          )}

          <div className="label mt-6 mb-3">Override (if model is wrong)</div>
          <div className="grid grid-cols-2 gap-2">
            {sortedClasses.length > 0 ? (
              sortedClasses.map(([cls]) => (
                <button
                  type="button"
                  key={cls}
                  onClick={() => setChosen(cls)}
                  className={`px-3 py-2 rounded-xl text-sm border transition-all text-left ${
                    chosen === cls
                      ? "bg-brand-50 border-brand-300 text-brand-800"
                      : "bg-white border-ink-200 text-ink-700 hover:border-ink-300"
                  }`}
                >
                  {cls}
                </button>
              ))
            ) : (
              <p className="text-sm text-ink-500 col-span-2">
                Run the classifier first — override buttons list the scored classes.
              </p>
            )}
          </div>
          {chosen && chosen !== predictedClass && sortedClasses.length > 0 && (
            <button type="button" onClick={save} disabled={busy} className="btn-soft mt-3 w-full">
              Save override
              {multi ? ` for page ${selectedPageIndex + 1}` : ""} → {chosen}
            </button>
          )}
        </div>

        <div className="pane p-5">
          <div className="label mb-4">
            {multi ? `Confidence distribution — page ${selectedPageIndex + 1}` : "Confidence Distribution"}
          </div>
          <div className="space-y-2.5">
            {sortedClasses.length > 0 ? (
              sortedClasses.map(([cls, score]) => (
                <div key={cls}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={cls === predictedClass ? "text-ink-900 font-semibold" : "text-ink-600"}>
                      {cls}
                    </span>
                    <span className="font-mono text-ink-500">{score.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(score / max) * 100}%` }}
                      transition={{ duration: 0.6 }}
                      className={`h-full rounded-full ${
                        cls === predictedClass ? "bg-brand-grad" : "bg-ink-300"
                      }`}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-500">No scores yet for this page — run the classifier.</p>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
