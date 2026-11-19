import { z } from "zod";

/**
 * Shared Zod schemas + helpers used by client forms.
 *
 * Server-side hardening (edge functions, DB CHECK constraints) mirrors
 * these rules so client validation is defence-in-depth, not the only line.
 */

// Kenyan phone: 07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX / +2541XXXXXXXX
const KE_PHONE_RE = /^(?:\+?254|0)(?:7\d{8}|1\d{8})$/;
export const validateKEPhone = (phone: string): boolean => {
  if (!phone) return false;
  const digits = phone.replace(/[\s\-().]/g, "");
  return KE_PHONE_RE.test(digits);
};

// ─── Reusable primitives ────────────────────────────────────────────
export const nameSchema = z
  .string()
  .trim()
  .transform((s) => s.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be less than 100 characters")
      .regex(
        /^[\p{L}\p{M}\s\-'.]+$/u,
        "Name may only contain letters (including Unicode/accented characters), spaces, hyphens, apostrophes and dots",
      ),
  );



export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address")
  .max(254, "Email must be less than 254 characters");

export const phoneKESchema = z
  .string()
  .trim()
  .refine(validateKEPhone, "Enter a valid Kenyan phone number starting with 07, 01 or +254");

// Any country: optional +, 7–15 digits (spaces, dashes and brackets allowed).
export const validateIntlPhone = (phone: string): boolean => {
  const cleaned = String(phone || "").replace(/[\s\-().]/g, "");
  return /^\+?\d{7,15}$/.test(cleaned);
};

export const phoneIntlSchema = z
  .string()
  .trim()
  .refine(validateIntlPhone, "Enter a valid phone number, including the country code if you are outside Kenya");

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Store URL must be at least 2 characters")
  .max(64, "Store URL must be less than 64 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Only lowercase letters, numbers and hyphens");

// ─── Contact / enquiry form ────────────────────────────────────────
export const contactFormSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  subject: z
    .string()
    .trim()
    .min(2, "Subject must be at least 2 characters")
    .max(200, "Subject must be less than 200 characters"),
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be less than 5000 characters"),
});
export type ContactFormData = z.infer<typeof contactFormSchema>;

// ─── Login (email OR Kenyan phone) ─────────────────────────────────
export const loginIdentifierSchema = z.union([
  emailSchema,
  phoneKESchema,
]);
export const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .max(200, "Password is too long");

// ─── Error helpers ─────────────────────────────────────────────────
export const getFirstError = (error: z.ZodError): string =>
  error.issues[0]?.message ?? "Validation failed";

export const getFieldErrors = (error: z.ZodError): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_form";
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
};

// ─── Landing lead capture (name / phone / business email) ──────────

export const leadFormSchema = z.object({
  name: nameSchema,
  phone: phoneIntlSchema,
  // Many small businesses run on Gmail/Yahoo addresses, so any email is fine.
  email: emailSchema,
});
export type LeadFormData = z.infer<typeof leadFormSchema>;
