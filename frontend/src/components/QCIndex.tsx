import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Check, X, RotateCcw, Network, Plus, Trash2, FileSearch, GripVertical, Sparkles, Loader2 } from "lucide-react";
import { api, DocumentT } from "../lib/api";
import StageSourcePages from "./StageSourcePages";

type SchemaField = {
  name: string;
  type: "select" | "date" | "year" | "text";
  options?: string[];
};

interface Props {
  doc: DocumentT;
  onUpdate: (d: DocumentT) => void;
}

const FIELDS: { key: string; label: string; color: string }[] = [
  { key: "emails", label: "Emails", color: "bg-sky-50 text-sky-700 border-sky-200" },
  { key: "phones", label: "Phones", color: "bg-violet-50 text-violet-700 border-violet-200" },
  { key: "urls", label: "URLs", color: "bg-pink-50 text-pink-700 border-pink-200" },
  { key: "amounts", label: "Amounts", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "identifiers", label: "Identifiers", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "keywords", label: "Keywords", color: "bg-ink-100 text-ink-700 border-ink-200" },
];

export default function QCIndex({ doc, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<any>(doc.index_metadata || {});
  const pages = doc.pages ?? [];
  const multiPages = pages.length > 1;
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);

  useEffect(() => {
    setMeta(doc.index_metadata || {});
  }, [doc.id, doc.index_metadata]);

  useEffect(() => {
    setSelectedPageIndex(0);
  }, [doc.id]);

  useEffect(() => {
    setSelectedPageIndex((i) => Math.max(0, Math.min(i, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  const run = async () => {
    setBusy(true);
    try {
      onUpdate(await api.index(doc.id));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      onUpdate(await api.correctIndex(doc.id, meta));
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    await save();
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

  const updateList = (key: string, idx: number, value: string) => {
    const next = { ...meta, [key]: [...(meta[key] || [])] };
    next[key][idx] = value;
    setMeta(next);
  };
  const removeItem = (key: string, idx: number) => {
    const next = { ...meta, [key]: [...(meta[key] || [])] };
    next[key].splice(idx, 1);
    setMeta(next);
  };
  const addItem = (key: string) => {
    setMeta({ ...meta, [key]: [...(meta[key] || []), ""] });
  };

  const updateClassField = (name: string, value: string) => {
    const cur = (meta.class_fields ?? {}) as Record<string, string>;
    const next = { ...cur };
    if (value == null || value === "") delete next[name];
    else next[name] = value;
    setMeta({ ...meta, class_fields: next });
  };

  const ready = doc.index_metadata !== null;
  const docClass = (meta.doc_class as string | undefined) ?? doc.doc_class ?? null;
  const classSchema = (meta.class_schema as SchemaField[] | undefined) ?? [];
  const classFields = (meta.class_fields as Record<string, string> | undefined) ?? {};

  const fieldFilled = (name: string): boolean => {
    const v = (classFields[name] ?? "").toString().trim();
    return v !== "";
  };
  const filledCount = classSchema.filter((f) => fieldFilled(f.name)).length;
  const totalCount = classSchema.length;
  const completionPct = totalCount === 0 ? 0 : Math.round((filledCount / totalCount) * 100);
  const missingFields = classSchema.filter((f) => !fieldFilled(f.name)).map((f) => f.name);

  const focusFieldInput = (name: string) => {
    const id = `class-field-${name.replace(/\s+/g, "-").toLowerCase()}`;
    requestAnimationFrame(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }
    });
  };
  const copyMissing = async () => {
    if (missingFields.length === 0) return;
    try {
      await navigator.clipboard.writeText(missingFields.join(", "));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-lime-200 to-emerald-200 flex items-center justify-center">
              <Network className="w-5 h-5 text-emerald-700" />
            </span>
            Index Genius — Metadata
          </h2>
          <p className="text-ink-600 text-sm mt-1">
            Extracted tags from OCR text. Edit, add, or remove before approving.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!ready && (
            <button type="button" onClick={run} disabled={busy} className="btn-primary">
              <Play className="w-4 h-4" /> Extract Metadata
            </button>
          )}
          {ready && (
            <>
              <button type="button" onClick={run} disabled={busy} className="btn-ghost">
                <RotateCcw className="w-4 h-4" /> Re-run
              </button>
              <button type="button" onClick={save} disabled={busy} className="btn-soft">
                Save edits
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-start">
        <div className="lg:sticky lg:top-2 self-start flex flex-col gap-2">
          {multiPages && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPageIndex((i) => Math.max(0, i - 1))}
                disabled={selectedPageIndex <= 0}
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-40"
                title="Previous page"
              >
                ← Prev
              </button>
              <span className="font-mono text-emerald-900">
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
            title={multiPages ? `Enhanced image — page ${selectedPageIndex + 1}` : "Enhanced image"}
            compact
            showOnly="enhanced"
            singlePage
            selectedPageIndex={multiPages ? selectedPageIndex : undefined}
            onSelectPage={multiPages ? setSelectedPageIndex : undefined}
          />
        </div>

        <div className="space-y-5">

      {ready && classSchema.length > 0 && (
        <div className="pane p-5 border border-emerald-200 ring-1 ring-emerald-100 bg-gradient-to-br from-emerald-50/60 to-lime-50/40">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-emerald-700" />
              <h3 className="font-display text-lg font-bold text-ink-900">
                {docClass} — required fields
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`chip border ${
                  completionPct >= 100
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                    : completionPct >= 50
                      ? "bg-amber-50 text-amber-800 border-amber-300"
                      : "bg-rose-50 text-rose-800 border-rose-300"
                }`}
                title={`${filledCount} of ${totalCount} fields filled`}
              >
                {filledCount}/{totalCount} fields · {completionPct}%
              </span>
            </div>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className={`h-full transition-[width] duration-500 ${
                completionPct >= 100
                  ? "bg-emerald-500"
                  : completionPct >= 50
                    ? "bg-amber-500"
                    : "bg-rose-500"
              }`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Fields to Extract from Document
            </span>
            <button
              type="button"
              onClick={copyMissing}
              disabled={missingFields.length === 0}
              className="btn-ghost text-xs px-2 py-1 inline-flex items-center gap-1 disabled:opacity-40"
              title="Copy comma-separated list of empty field names"
            >
              <FileSearch className="w-3 h-3" /> Copy Missing ({missingFields.length})
            </button>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {classSchema.map((f) => {
              const filled = fieldFilled(f.name);
              return (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => focusFieldInput(f.name)}
                  className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                    filled
                      ? "bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100"
                      : "bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100"
                  }`}
                  title={
                    filled
                      ? `Extracted: ${classFields[f.name]} — click to edit`
                      : "Not extracted — click to fill manually"
                  }
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      filled ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  <span className="font-semibold">{f.name}</span>
                  {filled && (
                    <span className="font-mono opacity-80 max-w-[10rem] truncate">
                      {classFields[f.name]}
                    </span>
                  )}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (filled) updateClassField(f.name, "");
                    }}
                    className={`ml-0.5 -mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] ${
                      filled
                        ? "text-emerald-700 hover:bg-emerald-200"
                        : "text-rose-700 opacity-50"
                    }`}
                    role={filled ? "button" : "presentation"}
                    aria-label={filled ? `Clear ${f.name}` : undefined}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-600 mb-4 leading-relaxed">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-900 font-semibold">extracted</span>
            </span>
            <span className="mx-2 text-ink-300">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-rose-900 font-semibold">not extracted</span>
            </span>
            <span className="ml-2">— review and override below before approving.</span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
            {classSchema.map((f) => {
              const value = classFields[f.name] ?? "";
              const inputId = `class-field-${f.name.replace(/\s+/g, "-").toLowerCase()}`;
              const isFilled = value.toString().trim() !== "";
              return (
                <div
                  key={f.name}
                  className={`space-y-1 rounded-lg p-2 border ${
                    isFilled
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-rose-200 bg-rose-50/30"
                  }`}
                >
                  <label
                    htmlFor={inputId}
                    className={`block text-xs font-semibold inline-flex items-center gap-1.5 ${
                      isFilled ? "text-emerald-900" : "text-rose-900"
                    }`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        isFilled ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                    />
                    {f.name}
                    {!isFilled && (
                      <span className="ml-1 text-[10px] font-normal text-rose-700 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">
                        not extracted
                      </span>
                    )}
                  </label>
                  {f.type === "date" ? (
                    <input
                      id={inputId}
                      type="date"
                      value={value}
                      onChange={(e) => updateClassField(f.name, e.target.value)}
                      className="input w-full text-sm font-mono"
                    />
                  ) : f.type === "year" ? (
                    <input
                      id={inputId}
                      type="number"
                      min={1900}
                      max={2100}
                      step={1}
                      value={value}
                      onChange={(e) => updateClassField(f.name, e.target.value)}
                      placeholder="YYYY"
                      className="input w-full text-sm font-mono"
                    />
                  ) : (
                    <input
                      id={inputId}
                      type="text"
                      value={value}
                      onChange={(e) => updateClassField(f.name, e.target.value)}
                      className="input w-full text-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ready && classSchema.length === 0 && docClass && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <strong>{docClass}</strong> has no fixed Index Genius schema yet — only the generic tags below
          will populate. Reclassify in <strong>Doc Class</strong> if this isn't the right type, then
          <strong> Re-run</strong>.
        </div>
      )}

      {(classSchema.length === 0 || !docClass) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div
              key={f.key}
              className="pane p-4 border-emerald-100/80 ring-1 ring-emerald-50 flex flex-col min-h-0 max-h-[min(48vh,26rem)]"
            >
              <div className="flex items-center justify-between mb-3 shrink-0">
                <span className={`chip border ${f.color}`}>{f.label}</span>
                <button type="button" onClick={() => addItem(f.key)} className="btn-ghost px-2 py-1 text-xs">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <div className="space-y-2 overflow-y-auto min-h-0 pr-0.5">
                {(meta[f.key] || []).length === 0 && (
                  <div className="text-xs text-ink-400 italic">none extracted</div>
                )}
                {(meta[f.key] || []).map((v: string, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={v}
                      onChange={(e) => updateList(f.key, i, e.target.value)}
                      className="input flex-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(f.key, i)}
                      className="btn-danger px-2 py-1.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {meta.dates && meta.dates.length > 0 && (
            <div className="pane p-4 md:col-span-2">
              <div className="chip bg-rose-50 text-rose-700 border border-rose-200 mb-3">Dates</div>
              <div className="space-y-1.5">
                {meta.dates.map((d: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm font-mono">
                    <span className="text-ink-800">{d.raw}</span>
                    {d.iso && <span className="text-ink-400">→</span>}
                    {d.iso && <span className="text-emerald-600">{d.iso}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {ready && classSchema.length > 0 && (
        <details className="rounded-lg border border-ink-200 bg-ink-50/40">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-700 select-none">
            More extracted tags (auto, optional)
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 pt-2">
            {FIELDS.map((f) => {
              const items = (meta[f.key] || []) as string[];
              if (items.length === 0) return null;
              return (
                <div key={f.key} className="rounded-lg bg-white border border-ink-100 p-2.5">
                  <span className={`chip border ${f.color}`}>{f.label}</span>
                  <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-ink-600 break-words">
                    {items.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {meta.dates && meta.dates.length > 0 && (
              <div className="rounded-lg bg-white border border-ink-100 p-2.5 md:col-span-2">
                <span className="chip bg-rose-50 text-rose-700 border border-rose-200">Dates seen in OCR</span>
                <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-ink-600">
                  {meta.dates.map((d: any, i: number) => (
                    <li key={i}>
                      {d.raw}
                      {d.iso && <span className="ml-2 text-emerald-600">→ {d.iso}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
        </div>
      </div>
    </div>
  );
}
