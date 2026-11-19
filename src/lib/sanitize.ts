import xss, { type IFilterXSSOptions } from "xss";

/**
 * XSS sanitization helpers. Strip ALL HTML tags — none of the fields
 * that flow through these helpers (names, emails, phones, messages)
 * ever need to render markup.
 */
const xssOptions: IFilterXSSOptions = {
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
};

export const sanitize = (input: unknown): string => {
  if (typeof input !== "string") return "";
  return xss(input.trim(), xssOptions);
};

export const sanitizeEmail = (email: unknown): string => {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
};

export const sanitizePhone = (phone: unknown): string => {
  if (typeof phone !== "string") return "";
  return phone.replace(/[^\d\s+\-()]/g, "").trim();
};

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      out[key] = sanitize(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" ? sanitize(v) : v));
    } else if (value !== null && typeof value === "object") {
      out[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
