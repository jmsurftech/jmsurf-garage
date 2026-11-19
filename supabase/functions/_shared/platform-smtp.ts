// Single outbound email path for the whole platform.
//
// Every email (auth verification, password reset, welcome, receipts,
// invoices, subscription reminders, admin alerts) leaves through whatever the
// admin portal is set to (platform_settings.smtp): Resend when a provider key
// is saved, otherwise the configured SMTP server.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SEND_TIMEOUT_MS = 20000;

export type PlatformSmtpConfig = {
  provider: "resend" | "smtp";
  resendApiKey: string;
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  encryption: "ssl" | "starttls" | "none";
};

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is not configured in the admin portal (Admin > Settings > Email)");
    this.name = "SmtpNotConfiguredError";
  }
}

function normalizeEncryption(input: unknown): "ssl" | "starttls" | "none" {
  const value = String(input || "").trim().toLowerCase();
  if (["ssl", "smtps", "tls_ssl"].includes(value)) return "ssl";
  if (["tls", "starttls"].includes(value)) return "starttls";
  return "none";
}

function useDirectTls(port: number, encryption: "ssl" | "starttls" | "none") {
  // denomailer expects tls=false for STARTTLS (typically port 587)
  if (encryption === "ssl") return true;
  return port === 465;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let cached: { config: PlatformSmtpConfig; at: number } | null = null;
const CACHE_MS = 60_000;

/** Reads the SMTP settings saved in the admin portal. */
export async function getPlatformSmtpConfig(
  options: { force?: boolean } = {},
): Promise<PlatformSmtpConfig | null> {
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;

  const response = await fetch(
    `${url}/rest/v1/platform_settings?key=eq.smtp&select=value&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!response.ok) {
    console.error("platform smtp lookup failed", response.status, await response.text());
    return null;
  }

  const rows = (await response.json()) as Array<{ value: Record<string, unknown> }>;
  const value = rows?.[0]?.value as Record<string, unknown> | undefined;
  if (!value) return null;

  const resendApiKey = String(value.resend_api_key || "").trim();
  const provider: "resend" | "smtp" =
    String(value.provider || "").trim().toLowerCase() === "resend" && resendApiKey ? "resend" : "smtp";

  const hasSmtp = !!(value.host && value.username && value.password);
  if (provider === "smtp" && !hasSmtp) return null;
  if (provider === "resend" && !value.from_email && !value.username) return null;

  const port = parseInt(String(value.port || "465"), 10) || 465;
  const config: PlatformSmtpConfig = {
    provider,
    resendApiKey,
    host: String(value.host || "").trim(),
    port,
    username: String(value.username || "").trim(),
    password: String(value.password || ""),
    fromEmail: String(value.from_email || value.username || "").trim(),
    fromName: String(value.from_name || "JMSURF DASH").trim(),
    // When no encryption is chosen, match the standard for the port:
    // 465 is a direct secure connection, 587/25 upgrade with STARTTLS.
    encryption: normalizeEncryption(value.encryption || (port === 465 ? "ssl" : "starttls")),
  };

  cached = { config, at: Date.now() };
  return config;
}

export type PlatformEmail = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Overrides the saved sender name for this message only. */
  fromName?: string;
};

/**
 * Sends an email through the admin-configured SMTP server.
 * Throws SmtpNotConfiguredError when no SMTP settings are saved.
 */
export async function sendPlatformEmail(email: PlatformEmail): Promise<{ sent: true; from: string }> {
  const config = await getPlatformSmtpConfig();
  if (!config) throw new SmtpNotConfiguredError();

  const recipients = (Array.isArray(email.to) ? email.to : [email.to])
    .map((address) => String(address).trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error("A recipient email address is required");

  const senderName = (email.fromName || config.fromName || "JMSURF DASH").trim();

  // Resend is the preferred route when an API key is saved in the admin portal.
  if (config.provider === "resend") {
    const fromHeader = senderName ? `${senderName} <${config.fromEmail}>` : config.fromEmail;
    const response = await withTimeout(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromHeader,
          to: recipients,
          subject: email.subject,
          html: email.html,
          text: email.text,
          reply_to: email.replyTo,
        }),
      }),
      SEND_TIMEOUT_MS,
      "Resend request timed out",
    );
    if (!response.ok) {
      const body = await response.text();
      console.error("resend send failed", response.status, body);
      throw new Error(`Resend rejected the email (${response.status}): ${body}`);
    }
    return { sent: true, from: fromHeader };
  }

  const tls = useDirectTls(config.port, config.encryption);
  const client = new SMTPClient({
    connection: {
      hostname: config.host,
      port: config.port,
      tls,
      auth: { username: config.username, password: config.password },
    },
  });

  const from = senderName ? `${senderName} <${config.fromEmail}>` : config.fromEmail;

  try {
    await withTimeout(
      client.send({
        from,
        to: recipients,
        replyTo: email.replyTo,
        subject: email.subject,
        content: email.text || "auto",
        html: email.html,
      }),
      SEND_TIMEOUT_MS,
      "SMTP send timed out",
    );
  } finally {
    try {
      await client.close();
    } catch {
      // ignore close errors
    }
  }

  return { sent: true, from };
}
