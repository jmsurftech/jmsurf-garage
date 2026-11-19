/**
 * True when a request failed because there is no usable internet, including
 * the case where Wi-Fi is connected but nothing gets through (the browser
 * still reports navigator.onLine = true then).
 */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String((e as any)?.message ?? e ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|err_internet|err_network|err_name_not_resolved/i.test(msg);
}
