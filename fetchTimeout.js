// Every outbound request from the server gets a time limit, so a slow payment
// gateway, KRA hub, mail API, tracking endpoint or database call can never hold
// a request or a background job open forever. A caller that passes its own
// signal (AI streaming, long uploads, its own AbortSignal.timeout) keeps it.
// Imported first in server.js so it is in place before any module runs.
const DEFAULT_MS = Math.max(5_000, Number(process.env.OUTBOUND_TIMEOUT_MS) || 30_000);

const original = globalThis.fetch;
if (typeof original === "function" && !original.__timed) {
  const timed = (input, init) => {
    const hasOwnSignal = (init && init.signal) || (typeof Request !== "undefined" && input instanceof Request);
    if (hasOwnSignal) return original(input, init);
    return original(input, { ...(init || {}), signal: AbortSignal.timeout(DEFAULT_MS) });
  };
  timed.__timed = true;
  globalThis.fetch = timed;
}

export const OUTBOUND_TIMEOUT_MS = DEFAULT_MS;
