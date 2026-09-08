export const COMPUTER_URL = String(import.meta.env.VITE_COMPUTER_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4175' : '')).trim();
export function computerAppURL(path = '/') {
  if (!COMPUTER_URL) return null;
  const url = new URL(COMPUTER_URL);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  url.hash = path;
  return url.href;
}
