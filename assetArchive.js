// ---------------------------------------------------------------------------
// Keeps every released build file (dist/assets) in the private "app-assets"
// storage bucket. A tab opened before a deploy still asks for the old page
// files; they are served from here instead of failing, so pages never break
// or reload just because a new version went live. Files older than KEEP_DAYS
// that the running build does not use are removed.
// ---------------------------------------------------------------------------
import { promises as fs } from "node:fs";
import path from "node:path";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const BUCKET = "app-assets";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const PAGE = 1000;
// A tab left open longer than this reloads onto the new release instead
// (the service worker already does that on its next check).
const KEEP_DAYS = 7;
const SAFE =/^[\w.-]+\.(js|css|woff2?|svg|png|webp|map)$/;
const cache = new Map();

async function storage(p, init = {}) {
  return fetch(`${URL_}/storage/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
}

/** Uploads this build's files that are not archived yet, and drops month-old ones. */
export async function archiveAssets(distDir) {
  if (!URL_ || !KEY) return;
  try {
    await storage("bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) }).catch(() => null);
    // List page by page: one capped request missed everything past the cap, so
    // those files were uploaded again on every release and never removed.
    const listed = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await (await storage(`object/list/${BUCKET}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix: "", limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }) })).json().catch(() => null);
      if (!Array.isArray(page)) break;
      listed.push(...page);
      if (page.length < PAGE) break;
    }
    const have = new Set(listed.map((o) => o.name));
    const dir = path.join(distDir, "assets");
    const files = (await fs.readdir(dir)).filter((f) => SAFE.test(f) && !have.has(f));
    let i = 0;
    const worker = async () => {
      while (i < files.length) {
        const f = files[i++];
        const body = await fs.readFile(path.join(dir, f));
        const type = f.endsWith(".css") ? "text/css" : f.endsWith(".js") ? "application/javascript" : "application/octet-stream";
        await storage(`object/${BUCKET}/${f}`, { method: "POST", headers: { "Content-Type": type, "x-upsert": "true", "cache-control": "max-age=31536000" }, body }).catch(() => null);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const current = new Set(await fs.readdir(dir));
    const old = listed.filter((o) => o.created_at && !current.has(o.name) && Date.now() - Date.parse(o.created_at) > KEEP_DAYS * 864e5).map((o) => o.name);
    for (let j = 0; j < old.length; j += 200) {
      await storage(`object/${BUCKET}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: old.slice(j, j + 200) }) }).catch(() => null);
    }
    console.log(`[assets] archived ${files.length} new build files, removed ${old.length} old`);
  } catch (e) {
    console.error("[assets] archive failed", e.message);
  }
}

/** An earlier build's file, or null. */
export async function archivedAsset(name) {
  if (!URL_ || !KEY || !SAFE.test(name)) return null;
  if (cache.has(name)) return cache.get(name);
  const r = await storage(`object/${BUCKET}/${name}`).catch(() => null);
  if (!r?.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (cache.size > 400) cache.clear();
  cache.set(name, buf);
  return buf;
}
