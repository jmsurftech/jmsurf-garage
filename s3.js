// ---------------------------------------------------------------------------
// Minimal S3-compatible client (AWS Signature V4, path-style URLs) for copying
// company backups to the company's own storage: Cloudflare R2, Amazon S3,
// Wasabi, Backblaze B2, DigitalOcean Spaces or any S3-compatible service.
// ---------------------------------------------------------------------------
import { createHash, createHmac } from "node:crypto";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const encPath = (p) => p.split("/").map((s) => encodeURIComponent(s)).join("/");

/** Endpoint for each storage provider (custom endpoints are used as given). */
export function s3Endpoint({ provider, endpoint, region, account }) {
  const e = String(endpoint || "").trim().replace(/\/+$/, "");
  if (e) return /^https?:\/\//.test(e) ? e : `https://${e}`;
  if (provider === "r2") return `https://${account}.r2.cloudflarestorage.com`;
  if (provider === "aws") return `https://s3.${region || "us-east-1"}.amazonaws.com`;
  if (provider === "wasabi") return `https://s3.${region || "us-east-1"}.wasabisys.com`;
  if (provider === "b2") return `https://s3.${region || "us-west-004"}.backblazeb2.com`;
  if (provider === "spaces") return `https://${region || "fra1"}.digitaloceanspaces.com`;
  throw new Error("Enter the storage endpoint");
}

async function s3Request(cfg, method, key, body = Buffer.alloc(0), contentType) {
  const base = s3Endpoint(cfg);
  const url = new URL(`${base}/${encodeURIComponent(cfg.bucket)}/${encPath(key)}`);
  const region = cfg.provider === "r2" ? "auto" : cfg.region || "us-east-1";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n]}`).join("\n") + "\n", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const res = await fetch(url, { method, headers: { ...headers, Authorization: auth }, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(300000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
    const friendly = code === "SignatureDoesNotMatch" || code === "InvalidAccessKeyId" ? "The storage access key or secret was not accepted"
      : code === "NoSuchBucket" ? "That bucket does not exist" : code === "AccessDenied" ? "The key may not write to that bucket" : msg || `Storage replied ${res.status}`;
    throw new Error(friendly);
  }
  return res;
}

export const s3Put = (cfg, key, body, contentType = "application/octet-stream") => s3Request(cfg, "PUT", key, body, contentType);
export const s3Delete = (cfg, key) => s3Request(cfg, "DELETE", key).catch(() => undefined);
export const s3Get = async (cfg, key) => Buffer.from(await (await s3Request(cfg, "GET", key)).arrayBuffer());
