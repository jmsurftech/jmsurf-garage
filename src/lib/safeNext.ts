/**
 * Returns the input if it is a safe same-origin relative path
 * (starts with a single "/"), otherwise null.
 * Prevents open-redirect via "//evil.com" or "http://..." values.
 */
export function safeNextPath(input: string | null | undefined): string | null {
  if (!input) return null;
  if (typeof input !== "string") return null;
  if (!/^\/(?!\/)/.test(input)) return null;
  // Reject control chars / whitespace
  if (/[\s\x00-\x1f]/.test(input)) return null;
  return input;
}

export function buildNextQuery(next: string | null | undefined): string {
  const s = safeNextPath(next);
  return s ? `?next=${encodeURIComponent(s)}` : "";
}
