/** Mirrors backend `page_text.join_marked_pages` / `split_marked_pages` (markers are 1-based). */

import type { DocumentPageT, DocumentT } from "./api";

export function joinMarkedPages(parts: [pageIndex: number, body: string][]): string {
  const blocks: string[] = [];
  for (const [idx, body] of [...parts].sort((a, b) => a[0] - b[0])) {
    blocks.push(`=== PAGE ${idx + 1} ===\n${(body ?? "").trim()}`);
  }
  return blocks.join("\n\n");
}

/** True if `full` uses `=== PAGE N ===` markers (multi-page joined OCR). */
export function documentHasPageMarkers(full: string | null | undefined): boolean {
  if (!full?.trim()) return false;
  return /^=== PAGE \d+ ===\s*$/m.test(full);
}

export function splitMarkedPages(full: string): Record<number, string> {
  if (!full?.trim()) return {};
  const re = /^=== PAGE (\d+) ===\s*$/gm;
  const matches = [...full.matchAll(re)];
  if (matches.length === 0) return { 0: full.trim() };
  const out: Record<number, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const pageNum = parseInt(matches[i][1]!, 10);
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : full.length;
    out[pageNum - 1] = full.slice(start, end).trim();
  }
  return out;
}

/** Source English text per page for Lingua — matches backend `_page_source_for_translate`. */
export function pageSourceForTranslate(doc: DocumentT, page: DocumentPageT): string {
  const a = (page.corrected_page_abstract || page.page_abstract || "").trim();
  if (a) return a;
  const o = (page.corrected_ocr_text || page.ocr_text || "").trim();
  if (o) return o;
  for (const field of [doc.corrected_abstract, doc.abstract] as const) {
    if (!field?.trim()) continue;
    const sp = splitMarkedPages(field);
    const t = (sp[page.page_index] || "").trim();
    if (t) return t;
  }
  for (const field of [doc.corrected_ocr, doc.raw_ocr] as const) {
    if (!field?.trim()) continue;
    const sp = splitMarkedPages(field);
    const t = (sp[page.page_index] || "").trim();
    if (t) return t;
  }
  return "";
}
