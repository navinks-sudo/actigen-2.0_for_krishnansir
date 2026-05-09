/** Live CER preview (approximates jiwer): edits ÷ |reference|, ×100. Long texts are truncated for UI responsiveness. */

const MAX_CHARS = 16000;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Reference = corrected (ground truth); hypothesis = raw model output. */
export function previewCerPercent(referenceGt: string, hypothesisRaw: string): number {
  if (!referenceGt && !hypothesisRaw) return 0;
  if (!referenceGt) return 100;
  const g = referenceGt.length > MAX_CHARS ? referenceGt.slice(0, MAX_CHARS) : referenceGt;
  const h = hypothesisRaw.length > MAX_CHARS ? hypothesisRaw.slice(0, MAX_CHARS) : hypothesisRaw;
  const d = levenshtein(g, h);
  return Math.round((d / Math.max(g.length, 1)) * 10000) / 100;
}
