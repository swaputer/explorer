export const STUDIO_URL = String(import.meta.env.VITE_STUDIO_URL || (import.meta.env.DEV ? "http://127.0.0.1:4176" : "")).trim();

export function studioAppURL() {
  if (!STUDIO_URL) return null;
  const url = new URL(STUDIO_URL);
  return ["http:", "https:"].includes(url.protocol) ? url.href : null;
}
