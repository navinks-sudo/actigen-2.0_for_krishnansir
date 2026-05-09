import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload as UploadIcon, Loader2, ListOrdered } from "lucide-react";
import { api } from "../lib/api";

export default function Upload() {
  const nav = useNavigate();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = fileList ? Array.from(fileList).filter((f) => f.size > 0) : [];
      if (!files.length) return;
      setBusy(true);
      setUploadPct(0);
      setUploadLabel(files.length === 1 ? files[0].name : `${files.length} files`);
      setErr(null);
      setInfo(null);
      try {
        if (files.length === 1) {
          const doc = await api.uploadWithProgress(files[0], setUploadPct);
          nav(`/app/doc/${doc.id}`);
          return;
        }
        const docs = await api.uploadBatchWithProgress(files, setUploadPct);
        if (!docs.length) {
          setErr("No documents were created.");
          return;
        }
        if (docs.length < files.length) {
          setInfo(`Uploaded ${docs.length} of ${files.length} files. Skipped files failed validation.`);
        }
        if (docs.length === 1) {
          nav(`/app/doc/${docs[0].id}`);
        } else {
          nav("/app");
        }
      } catch (e: any) {
        setErr(e.message || "Upload failed");
      } finally {
        setBusy(false);
        setUploadPct(0);
        setUploadLabel("");
      }
    },
    [nav]
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 lg:max-w-none lg:gap-10">
      <header className="border-b border-zinc-200 pb-6">
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700">Ingest</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">New document</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 sm:text-base">
          PDFs become one preview per page (with initial quality scores). Images stay a single page. You can drop many
          files at once.
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 items-stretch gap-8 lg:grid-cols-[minmax(0,1fr)_min(420px,44%)] lg:gap-10 xl:gap-12">
        <div className="flex min-h-0 flex-col gap-6">
          <div className="surface p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <ListOrdered className="h-4 w-4 text-teal-600" aria-hidden />
              What happens next
            </div>
            <ol className="list-inside list-decimal space-y-2.5 text-sm leading-relaxed text-zinc-600">
              <li>Review converted pages; open any page full screen.</li>
              <li>Enhancement runs until quality ≥ 95 (first page drives the image).</li>
              <li>OCR, classification, index, abstract, then translation — each with QC.</li>
            </ol>
          </div>
          <p className="text-xs text-zinc-500 lg:max-w-md">
            After upload you&apos;ll land on the document workbench. Use the stage list and pipeline row to move between
            QC tools.
          </p>
        </div>

        <div className="flex min-h-[280px] flex-col lg:min-h-[360px]">
          <motion.label
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              handleFiles(e.dataTransfer.files);
            }}
            whileHover={{ scale: 1.002 }}
            className={`relative flex min-h-full flex-1 cursor-pointer flex-col justify-center overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-gradient-to-b from-white to-zinc-50/90 p-8 text-center shadow-sm transition-all duration-300 sm:p-10 ${
              drag
                ? "border-teal-500 bg-teal-50/50 shadow-md ring-2 ring-teal-400/30"
                : "hover:border-teal-400/80 hover:shadow-md"
            }`}
          >
            <input
              type="file"
              multiple
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <div className="relative mx-auto max-w-md">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-zinc-200 bg-gradient-to-br from-teal-50 to-emerald-50">
                {busy ? (
                  <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                ) : (
                  <UploadIcon className="h-8 w-8 text-teal-700" />
                )}
              </div>
              <h2 className="mb-1 text-lg font-semibold text-zinc-900">{busy ? "Uploading…" : "Drop files here"}</h2>
              <p className="text-sm text-zinc-500">or click to browse · images &amp; PDFs · batch supported</p>
              {busy && (
                <div className="mx-auto mt-6 max-w-md text-left">
                  <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
                    <span className="truncate pr-2" title={uploadLabel}>
                      {uploadLabel}
                    </span>
                    <span className="shrink-0 tabular-nums">{uploadPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-[width] duration-150 ease-out"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                </div>
              )}
              {info && (
                <div className="mt-4 inline-block rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-900">
                  {info}
                </div>
              )}
              {err && (
                <div className="mt-4 inline-block rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700">
                  {err}
                </div>
              )}
            </div>
          </motion.label>
        </div>
      </div>
    </div>
  );
}
