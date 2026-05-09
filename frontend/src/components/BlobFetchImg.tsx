import { useEffect, useState } from "react";
import { authHeaders } from "../lib/auth";

type Props = {
  /** Full URL (e.g. `/api/documents/1/raster?layer=original&page_index=0`). */
  url: string;
  alt: string;
  /** Applied to the loaded `<img>`. */
  className?: string;
  /** Loading / error state container (default: light QC panel). */
  placeholderClassName?: string;
  /** Inline style forwarded to the loaded `<img>` (e.g. transform for zoom). */
  style?: React.CSSProperties;
};

/**
 * Loads an image via `fetch` with `Authorization` so JWT-backed raster routes work.
 * Plain `<img src="/files/...">` does not send Bearer tokens.
 */
export default function BlobFetchImg({ url, alt, className, placeholderClassName, style }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    setBlobUrl(null);
    setErr(false);
    (async () => {
      try {
        const r = await fetch(url, { headers: { ...authHeaders() } });
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(created);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  const ph =
    placeholderClassName ??
    "flex h-full min-h-[3rem] w-full items-center justify-center bg-ink-50 text-[10px] text-ink-400";

  if (err) {
    return (
      <div className={ph} role="status">
        Preview unavailable
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className={ph} role="status">
        Loading…
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} style={style} loading="eager" decoding="async" />;
}
