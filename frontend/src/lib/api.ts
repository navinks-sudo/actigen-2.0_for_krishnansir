/** QS inputs (0–100 each); composite formula matches backend `quality.py`. */
export interface PageQsMetricsT {
  qs: number;
  sharpness: number;
  brightness: number;
  contrast: number;
  noise: number;
}

export interface PageImageParamsT {
  width_px: number;
  height_px: number;
  mean_gray: number;
  std_gray: number;
  laplacian_variance: number;
}

/** GET /health/ocr — host OCR stack (Tesseract / EasyOCR). */
export interface OcrHealthResponse {
  tesseract: {
    cmd: string | null;
    found: boolean;
    version?: string;
    runtime_error?: string;
  };
  easyocr: { import_ok: boolean; import_error?: string };
  env: { TESSERACT_LANG?: string; TESSERACT_CONFIG?: string; EASYOCR_LANGS?: string };
}

/** GET /documents/:id/pages/:pageIndex/quality — disk-backed QS for lightbox Metrics. */
export interface PageQualityApiPayload {
  initial_qs: number | null;
  post_qs: number | null;
  qs_metrics: PageQsMetricsT | null;
  image_params: PageImageParamsT | null;
  post_qs_metrics: PageQsMetricsT | null;
  post_image_params: PageImageParamsT | null;
}

/** Composite QS display — two decimals so multi-page scores don’t look falsely identical when rounded to one place. */
export function formatQs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2);
}

export interface OcrBoxT {
  text: string;
  /** 0..1 confidence from the OCR engine (Tesseract returns -1..100; we normalize to 0..1). */
  confidence: number;
  /** Polygon corners in image pixel space: [[x,y]*4]. */
  box: number[][];
}

export interface DocumentPageT {
  id: number | null;
  page_index: number;
  image_path: string;
  initial_qs: number | null;
  qs_metrics?: PageQsMetricsT | null;
  image_params?: PageImageParamsT | null;
  enhanced_path?: string | null;
  post_qs?: number | null;
  post_qs_metrics?: PageQsMetricsT | null;
  post_image_params?: PageImageParamsT | null;
  ocr_text?: string | null;
  corrected_ocr_text?: string | null;
  ocr_text_english?: string | null;
  corrected_ocr_text_english?: string | null;
  ocr_boxes?: OcrBoxT[] | null;
  page_abstract?: string | null;
  corrected_page_abstract?: string | null;
  page_translation?: string | null;
  page_doc_class?: string | null;
  page_doc_class_scores?: Record<string, number> | null;
  enhancement_report?: EnhancementReportT | null;
}

export interface EnhancementReportT {
  verdict: string;
  pct_pixels_changed: number;
  paper_lift: number;
  ink_deepen: number;
  mean_shift: number;
  hist_before: number[];
  hist_after: number[];
}

export interface AbstractPagePatchT {
  page_index: number;
  corrected_page_abstract: string;
}

export interface DocumentT {
  id: number;
  filename: string;
  original_path: string;
  enhanced_path: string | null;
  initial_qs: number | null;
  post_qs: number | null;
  target_qs: number;
  enhancement_passes: number;
  raw_ocr: string | null;
  corrected_ocr: string | null;
  ocr_cer: number | null;
  raw_ocr_english: string | null;
  corrected_ocr_english: string | null;
  doc_class: string | null;
  doc_class_scores: Record<string, number> | null;
  index_metadata: Record<string, any> | null;
  abstract: string | null;
  corrected_abstract: string | null;
  abstract_cer: number | null;
  overall_abstract: string | null;
  corrected_overall_abstract: string | null;
  target_language: string;
  translation: string | null;
  current_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
  pages: DocumentPageT[];
}

import { authHeaders } from "./auth";

const API = "/api";

/** Mirrors `backend/app/services/pipeline_config.stage_config_public` when GET /pipeline/stage-config fails. */
export const DEFAULT_STAGE_PUBLIC_CONFIG: Record<string, Record<string, unknown>> = {
  enhancement: {
    title: "Image Enhancement",
    sop_target_default: 100,
    sop_allowed_range: { min: 80.0, max: 100.0 },
    config: {
      target_qs_default: 100,
      max_passes: 16,
      min_pass_improvement: 0.12,
      stall_window_passes: 2,
      qs_model: "laplacian_variance_sharpness_brightness_contrast_noise",
    },
    algorithm: "QS_guided_mild_passes_then_polish_and_escalation",
  },
  ocr: {
    title: "Text IQ (OCR)",
    sop_target_default: null,
    notes: "Uses Tesseract when installed; EasyOCR fallback. QC edits drive CER.",
  },
  doc_class: {
    title: "Document classification",
    sop_target_default: null,
    notes: "LLM when OPENAI_API_KEY set; else TF-IDF. Top class + score bars.",
  },
  index_genius: {
    title: "Index Genius",
    sop_target_default: null,
    notes: "Regex extraction plus optional LLM metatags with same API key.",
  },
  abstractor: {
    title: "Abstractor",
    sop_target_default: null,
    notes: "Per-page summarization when OCR exists; LLM when configured else LSA.",
  },
  lingua: {
    title: "Lingua AI",
    sop_target_default: null,
    notes: "Target language from supported list; per-page translation when pages exist.",
  },
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status}: ${txt}`);
  }
  const text = await r.text();
  if (!text.trim()) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 120)}`);
  }
}

/** Multipart POST with upload progress (fetch does not expose upload progress). */
function xhrPostForm<T>(url: string, formData: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    const headers = authHeaders() as Record<string, string>;
    if (headers && typeof headers === "object") {
      for (const [k, v] of Object.entries(headers)) {
        if (v != null) xhr.setRequestHeader(k, String(v));
      }
    }
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((100 * e.loaded) / e.total)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        reject(new Error(`${xhr.status}: ${xhr.responseText || xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(formData);
  });
}

const jsonHeaders = (): HeadersInit => ({ "Content-Type": "application/json", ...authHeaders() });

export type EnhanceProgress = {
  pct: number;
  label: string;
  /** 1-based page index when the backend is processing a multi-page PDF. */
  pageIndex?: number;
  pageTotal?: number;
  /** Coarse phase label so consumers can mark a page "done" when it transitions. */
  phase?: string;
  /** Set when the backend just finished and committed an individual page to disk. The consumer
   *  should patch the local doc state (so that page's Enhanced cell re-fetches) without waiting
   *  for the whole document stream to finish. */
  pageDone?: {
    /** 0-based page index — matches DocumentPageT.page_index. */
    pageIndex: number;
    enhancedPath: string;
    postQs: number | null;
    initialQs: number | null;
    updatedAt: string | null;
  };
};

function pagePrefix(e: Record<string, unknown>): string {
  const pi = typeof e.page_index === "number" ? e.page_index : null;
  const pt = typeof e.page_total === "number" ? e.page_total : null;
  if (pi != null && pt != null && pt > 1) return `Page ${pi}/${pt} · `;
  return "";
}

function enhancePctFromEvent(e: Record<string, unknown>, fallbackTargetQs: number): EnhanceProgress {
  const pre = pagePrefix(e);
  const pageIndex = typeof e.page_index === "number" ? (e.page_index as number) : undefined;
  const pageTotal = typeof e.page_total === "number" ? (e.page_total as number) : undefined;
  const phase = typeof e.phase === "string" ? (e.phase as string) : undefined;
  const wrap = (p: { pct: number; label: string }): EnhanceProgress => ({ ...p, pageIndex, pageTotal, phase });
  if (e.phase === "start") {
    const t = typeof e.target_qs === "number" ? e.target_qs : fallbackTargetQs;
    const i = typeof e.initial_qs === "number" ? e.initial_qs : 0;
    return wrap({
      pct: 5,
      label: `${pre}Starting · initial QS ${i.toFixed(1)} → SOP target ${Number(t).toFixed(0)}`,
    });
  }
  if (e.phase === "pass") {
    const pass = Number(e.pass);
    const maxP = Math.max(1, Number(e.max_passes));
    const best = Number(e.best_qs);
    const target = typeof e.target_qs === "number" ? Number(e.target_qs) : fallbackTargetQs;
    const passBand = (pass / maxP) * 58;
    const qualityBand = Math.min(28, (best / Math.max(target, 1)) * 28);
    const pct = Math.min(93, Math.round(7 + passBand + qualityBand));
    return wrap({
      pct,
      label: `${pre}Pass ${pass}/${maxP} · best QS ${best.toFixed(1)} / SOP ${target.toFixed(0)}`,
    });
  }
  if (e.phase === "polish" || e.phase === "polish_pass") {
    const best = typeof e.best_qs === "number" ? e.best_qs : 0;
    return wrap({ pct: 91, label: `${pre}Polishing toward SOP · best ${best.toFixed(1)}` });
  }
  if (e.phase === "escalation") {
    return wrap({ pct: 92, label: pre + String(e.message ?? "SOP recovery…") });
  }
  if (e.phase === "escalation_try") {
    const label = typeof e.label === "string" ? e.label : "try";
    const tq = typeof e.trial_qs === "number" ? e.trial_qs : 0;
    const best = typeof e.best_qs === "number" ? e.best_qs : 0;
    const tgt = typeof e.target_qs === "number" ? e.target_qs : fallbackTargetQs;
    const pct = Math.min(96, Math.round(88 + (best / Math.max(tgt, 1)) * 8));
    return wrap({
      pct,
      label: `${pre}${label} · trial ${tq.toFixed(1)} → best ${best.toFixed(1)}`,
    });
  }
  if (e.phase === "write") {
    return wrap({ pct: 97, label: `${pre}Saving enhanced image…` });
  }
  if (e.phase === "page_complete") {
    // Backend sends `page_index` 1-based (matching every other progress event) and
    // `page_index_zero` 0-based so we can patch the DocumentPage row directly.
    const pi0 =
      typeof e.page_index_zero === "number"
        ? (e.page_index_zero as number)
        : typeof e.page_index === "number"
          ? Math.max(0, (e.page_index as number) - 1)
          : 0;
    const pq = typeof e.post_qs === "number" ? (e.post_qs as number) : null;
    const iq = typeof e.initial_qs === "number" ? (e.initial_qs as number) : null;
    const enhP = typeof e.enhanced_path === "string" ? (e.enhanced_path as string) : "";
    const ua = typeof e.updated_at === "string" ? (e.updated_at as string) : null;
    return {
      ...wrap({
        pct: 100,
        label: `${pre}Page ${pi0 + 1} done · Post QS ${pq != null ? pq.toFixed(1) : "?"}`,
      }),
      pageDone: { pageIndex: pi0, enhancedPath: enhP, postQs: pq, initialQs: iq, updatedAt: ua },
    };
  }
  return wrap({ pct: 50, label: pre + "Enhancing…" });
}

/** NDJSON stream from POST /pipeline/:id/enhance — ends with a ``document`` line. */
export async function enhanceWithProgress(
  id: number,
  onProgress: (p: EnhanceProgress) => void,
  fallbackTargetQs = 95
): Promise<DocumentT> {
  const r = await fetch(`${API}/pipeline/${id}/enhance`, {
    method: "POST",
    headers: { ...authHeaders(), Accept: "application/x-ndjson" },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status}: ${txt}`);
  }
  if (!r.body) throw new Error("No response body");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj.phase === "document" && obj.document) {
        onProgress({ pct: 100, label: "SOP run complete" });
        return obj.document as DocumentT;
      }
      if (obj.phase === "error") {
        throw new Error(String(obj.message ?? "Enhancement failed"));
      }
      onProgress(enhancePctFromEvent(obj, fallbackTargetQs));
    }
  }
  throw new Error("Stream ended without result");
}

export const api = {
  ocrHealth: async (): Promise<OcrHealthResponse> => j(await fetch(`${API}/health/ocr`)),
  upload: async (file: File): Promise<DocumentT> => {
    const fd = new FormData();
    fd.append("file", file);
    return j(await fetch(`${API}/documents`, { method: "POST", body: fd, headers: authHeaders() }));
  },
  uploadWithProgress: (file: File, onProgress: (percent: number) => void): Promise<DocumentT> => {
    const fd = new FormData();
    fd.append("file", file);
    return xhrPostForm<DocumentT>(`${API}/documents`, fd, onProgress);
  },
  uploadBatch: async (files: File[]): Promise<DocumentT[]> => {
    const fd = new FormData();
    for (const f of files) {
      fd.append("files", f);
    }
    return j(await fetch(`${API}/documents/batch`, { method: "POST", body: fd, headers: authHeaders() }));
  },
  uploadBatchWithProgress: (files: File[], onProgress: (percent: number) => void): Promise<DocumentT[]> => {
    const fd = new FormData();
    for (const f of files) {
      fd.append("files", f);
    }
    return xhrPostForm<DocumentT[]>(`${API}/documents/batch`, fd, onProgress);
  },
  list: async (): Promise<DocumentT[]> =>
    j(await fetch(`${API}/documents`, { headers: authHeaders() })),
  get: async (id: number): Promise<DocumentT> =>
    j(await fetch(`${API}/documents/${id}`, { headers: authHeaders() })),
  getPageQuality: async (docId: number, pageIndex: number): Promise<PageQualityApiPayload> =>
    j(
      await fetch(`${API}/documents/${docId}/pages/${pageIndex}/quality`, {
        headers: authHeaders(),
      })
    ),
  patch: async (id: number, patch: { target_qs?: number }): Promise<DocumentT> =>
    j<DocumentT>(
      await fetch(`${API}/documents/${id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      })
    ),
  /** Deletes a document and its pages / stage runs. Treats 404 as success (already removed). */
  remove: async (id: number): Promise<void> => {
    const r = await fetch(`${API}/documents/${id}`, { method: "DELETE", headers: authHeaders() });
    if (r.status === 404) return;
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(txt ? `${r.status}: ${txt}` : `Request failed (${r.status})`);
    }
    await r.text();
  },

  enhance: async (id: number): Promise<DocumentT> => enhanceWithProgress(id, () => {}),
  enhanceWithProgress,
  enhanceAutoDecide: async (
    id: number,
    threshold?: number,
  ): Promise<{
    doc_id: number;
    initial_qs: number;
    threshold: number;
    should_enhance: boolean;
    page_scores: number[] | null;
    reason: string;
  }> => {
    const qs = threshold != null ? `?threshold=${encodeURIComponent(threshold)}` : "";
    return j(
      await fetch(`${API}/pipeline/${id}/enhance/auto/decide${qs}`, {
        method: "GET",
        headers: authHeaders(),
      }),
    );
  },
  tuneEnhancement: async (id: number, tune: ManualTuneState) =>
    j<TuneEnhancementResponse>(
      await fetch(`${API}/pipeline/${id}/enhance/tune`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(tune),
      })
    ),
  ocr: async (id: number, lang?: string) => {
    const qs = lang ? `?lang=${encodeURIComponent(lang)}` : "";
    return j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/ocr${qs}`, { method: "POST", headers: authHeaders() }),
    );
  },
  ocrLanguages: async () =>
    j<{ code: string; label: string }[]>(
      await fetch(`${API}/pipeline/ocr/languages`, { headers: authHeaders() }),
    ),
  correctOcr: async (
    id: number,
    payload:
      | string
      | {
          corrected_text?: string;
          corrected_english?: string;
          pages_english?: { page_index: number; corrected_ocr_text_english: string }[];
        },
  ) => {
    const body =
      typeof payload === "string" ? { corrected_text: payload } : payload;
    return j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/ocr/correct`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }),
    );
  },
  translateOcrToEnglish: async (id: number, source: string = "auto") =>
    j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/ocr/translate-english`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ source }),
      }),
    ),
  chatWithDocument: async (
    id: number,
    messages: { role: "user" | "assistant"; content: string }[],
    use_english: boolean = true,
  ) =>
    j<{ reply: string; model: string; used_pages: number }>(
      await fetch(`${API}/pipeline/${id}/chat`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ messages, use_english }),
      }),
    ),
  classify: async (id: number) =>
    j<DocumentT>(await fetch(`${API}/pipeline/${id}/classify`, { method: "POST", headers: authHeaders() })),
  correctClass: async (id: number, payload: { doc_class: string; page_index?: number }) =>
    j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/classify/correct`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      })
    ),
  index: async (id: number) =>
    j<DocumentT>(await fetch(`${API}/pipeline/${id}/index`, { method: "POST", headers: authHeaders() })),
  correctIndex: async (id: number, index_metadata: Record<string, any>) =>
    j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/index/correct`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ index_metadata }),
      })
    ),
  abstract: async (id: number) =>
    j<DocumentT>(await fetch(`${API}/pipeline/${id}/abstract`, { method: "POST", headers: authHeaders() })),
  correctAbstract: async (
    id: number,
    payload: {
      corrected_abstract?: string;
      pages?: AbstractPagePatchT[];
      corrected_overall_abstract?: string;
    }
  ) =>
    j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/abstract/correct`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      })
    ),
  translate: async (id: number, target_language: string) =>
    j<DocumentT>(
      await fetch(`${API}/pipeline/${id}/translate`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ target_language }),
      })
    ),
  approve: async (id: number) =>
    j<DocumentT>(await fetch(`${API}/pipeline/${id}/approve`, { method: "POST", headers: authHeaders() })),
  reject: async (id: number) =>
    j<DocumentT>(await fetch(`${API}/pipeline/${id}/reject`, { method: "POST", headers: authHeaders() })),
  languages: async (): Promise<Record<string, string>> =>
    j(await fetch(`${API}/pipeline/languages`)),
  stageConfig: async (): Promise<Record<string, Record<string, unknown>>> =>
    j(await fetch(`${API}/pipeline/stage-config`)),
};

export const fileUrl = (absPath: string | null | undefined): string | undefined => {
  if (!absPath) return undefined;
  const name = absPath.replace(/\\/g, "/").split("/").pop();
  if (!name) return undefined;
  // Encode path segment so spaces, #, ?, Unicode, etc. still resolve under /files
  return `/files/${encodeURIComponent(name)}`;
};

/** Authenticated raster fetch (QC thumbnails, lightbox). `page_index` omitted = document-level paths. */
export function documentRasterUrl(
  docId: number,
  layer: "original" | "enhanced",
  pageIndex?: number,
  cacheVersion?: string | null,
): string {
  const q = new URLSearchParams();
  q.set("layer", layer);
  if (pageIndex != null && pageIndex >= 0) q.set("page_index", String(pageIndex));
  if (cacheVersion) q.set("v", cacheVersion);
  return `/api/documents/${docId}/raster?${q.toString()}`;
}

export const STAGES = [
  { key: "enhancement", label: "Image Enhancement", short: "Enhance", color: "cyan" },
  { key: "ocr", label: "Text IQ (OCR)", short: "OCR", color: "violet" },
  { key: "doc_class", label: "Doc Class", short: "Classify", color: "pink" },
  { key: "index_genius", label: "Index Genius", short: "Index", color: "lime" },
  { key: "abstractor", label: "Abstractor", short: "Abstract", color: "amber" },
  { key: "lingua", label: "Lingua AI", short: "Translate", color: "cyan" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

/** Manual QC sliders for enhancement (0–100; neutral 50 for most axes). */
export type ManualTuneState = {
  brightness: number;
  contrast: number;
  gamma: number;
  denoise: number;
  sharpen: number;
  rotate: number;
  clahe: number;
};

export const MANUAL_TUNE_DEFAULTS: ManualTuneState = {
  brightness: 50,
  contrast: 50,
  gamma: 50,
  denoise: 0,
  sharpen: 0,
  rotate: 50,
  clahe: 50,
};

export type TuneEnhancementResponse = {
  document: DocumentT;
  notice?: string | null;
};
