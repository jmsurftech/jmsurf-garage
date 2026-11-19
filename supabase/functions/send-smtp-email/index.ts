import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/platform-smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SMTP_SEND_TIMEOUT_MS = 20000;
const SMTP_CONNECT_TIMEOUT_MS = 12000;
const PLATFORM_SENDER_DOMAIN = "jmsurfdash.co.ke";
const PLATFORM_FROM_DOMAIN = "jmsurfdash.co.ke";

type SmtpSettings = {
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  from_email: string;
  from_name: string;
  encryption: string;
};

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeEncryption(input: unknown): "ssl" | "starttls" | "none" {
  const value = String(input || "").trim().toLowerCase();
  if (["ssl", "smtps", "tls_ssl"].includes(value)) return "ssl";
  if (["tls", "starttls"].includes(value)) return "starttls";
  return "none";
}

function shouldUseDirectTls(port: number, encryption: "ssl" | "starttls" | "none") {
  // denomailer expects tls=false for STARTTLS (typically port 587)
  if (encryption === "ssl") return true;
  if (encryption === "starttls") return port === 465;
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

async function getUserRoles(adminClient: any, userId: string): Promise<string[]> {
  const { data } = await adminClient.from("user_roles").select("role").eq("user_id", userId);
  return (data || []).map((r: any) => String(r.role));
}

async function getTenantSmtpSettings(adminClient: any, tenantId: string): Promise<SmtpSettings | null> {
  const { data: bs } = await adminClient
    .from("business_settings")
    .select("smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_encryption")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!bs?.smtp_host || !bs?.smtp_username || !bs?.smtp_password) return null;

  return {
    smtp_host: String(bs.smtp_host),
    smtp_port: String(bs.smtp_port || "465"),
    smtp_username: String(bs.smtp_username),
    smtp_password: String(bs.smtp_password),
    from_email: String(bs.smtp_from_email || ""),
    from_name: String(bs.smtp_from_name || "JMSURF DASH"),
    encryption: String(bs.smtp_encryption || "ssl"),
  };
}

async function getPlatformSmtpSettings(adminClient: any): Promise<SmtpSettings | null> {
  const { data: ps } = await adminClient
    .from("platform_settings")
    .select("value")
    .eq("key", "smtp")
    .maybeSingle();

  if (!ps?.value) return null;
  const v = ps.value as any;
  if (!v.host || !v.username || !v.password) return null;

  return {
    smtp_host: String(v.host),
    smtp_port: String(v.port || "465"),
    smtp_username: String(v.username),
    smtp_password: String(v.password),
    from_email: String(v.from_email || ""),
    from_name: String(v.from_name || "JMSURF DASH"),
    encryption: String(v.encryption || "ssl"),
  };
}

async function resolveSmtpSettings(adminClient: any, opts: { tenantId?: string; preferPlatform: boolean }) {
  const { tenantId, preferPlatform } = opts;

  if (preferPlatform) {
    const platform = await getPlatformSmtpSettings(adminClient);
    if (platform) return { smtpSettings: platform, source: "platform_settings" as const };
    if (tenantId) {
      const tenant = await getTenantSmtpSettings(adminClient, tenantId);
      if (tenant) return { smtpSettings: tenant, source: "business_settings" as const };
    }
  } else {
    if (tenantId) {
      const tenant = await getTenantSmtpSettings(adminClient, tenantId);
      if (tenant) return { smtpSettings: tenant, source: "business_settings" as const };
    }
    const platform = await getPlatformSmtpSettings(adminClient);
    if (platform) return { smtpSettings: platform, source: "platform_settings" as const };
  }

  return { smtpSettings: null, source: null };
}

async function sendEmailBatch(params: {
  smtpSettings: SmtpSettings;
  recipients: string[];
  subject: string;
  htmlBody: string;
}) {
  const { smtpSettings, recipients, subject, htmlBody } = params;

  const port = parseInt(String(smtpSettings.smtp_port || "465"), 10) || 465;
  const encryption = normalizeEncryption(smtpSettings.encryption || "ssl");
  const tls = shouldUseDirectTls(port, encryption);

  console.log(`SMTP connecting: host=${smtpSettings.smtp_host}, port=${port}, tls=${tls}, encryption=${encryption}`);

  const client = new SMTPClient({
    connection: {
      hostname: String(smtpSettings.smtp_host).trim(),
      port,
      tls,
      auth: {
        username: String(smtpSettings.smtp_username).trim(),
        password: String(smtpSettings.smtp_password),
      },
    },
  });

  const fromEmail = String(smtpSettings.from_email || smtpSettings.smtp_username || "").trim();
  const fromName = String(smtpSettings.from_name || "JMSURF DASH").trim();
  const fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  try {
    await withTimeout(
      client.send({
        from: fromAddress,
        to: recipients,
        subject,
        content: "auto",
        html: htmlBody,
      }),
      SMTP_SEND_TIMEOUT_MS,
      `SMTP send timed out after ${Math.floor(SMTP_SEND_TIMEOUT_MS / 1000)}s`
    );
  } finally {
    try {
      await withTimeout(Promise.resolve(client.close()), SMTP_CONNECT_TIMEOUT_MS, "SMTP close timed out");
    } catch {
      // ignore connection close errors
    }
  }

  return {
    fromEmail,
    port,
    encryption: tls ? "ssl/tls" : "starttls",
    host: String(smtpSettings.smtp_host),
  };
}

// Platform-level sends go out the same way as every other platform email:
// Resend when it is configured in the admin portal, SMTP otherwise.
async function sendPlatformEmails(params: {
  adminClient: any;
  recipients: string[];
  subject: string;
  htmlBody: string;
  messageId: string;
}) {
  const shared = await sendPlatformEmail({
    to: params.recipients,
    subject: params.subject,
    html: params.htmlBody,
  });

  const meta = { fromEmail: shared.from, port: 0, encryption: "platform", host: "platform" };

  return {
    ...meta,
    sentMessageIds: params.recipients.map((_, index) => `${params.messageId}:${index}`),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const { to, subject, body, tenant_id, use_platform_settings } = payload || {};

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: "Missing to, subject, or body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userRoles = await getUserRoles(adminClient, user.id);
    const isSuperAdmin = userRoles.includes("super_admin");

    if (!userRoles.some((r) => ["admin", "manager", "super_admin"].includes(r))) {
      return new Response(JSON.stringify({ error: "Forbidden: insufficient role to send emails" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tenant_id && !isSuperAdmin && callerProfile?.tenant_id !== tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let effectiveTenantId: string | undefined = tenant_id;
    if (!effectiveTenantId) {
      effectiveTenantId = callerProfile?.tenant_id || undefined;
    }

    // Honor tenant's "use_platform_smtp" opt-in flag
    let tenantOptsIntoPlatform = false;
    if (effectiveTenantId) {
      const { data: bsFlag } = await adminClient
        .from("business_settings")
        .select("use_platform_smtp")
        .eq("tenant_id", effectiveTenantId)
        .maybeSingle();
      tenantOptsIntoPlatform = !!bsFlag?.use_platform_smtp;
    }

    // The public demo never sends real email (anyone can open it).
    if (effectiveTenantId) {
      const { data: demoRow } = await adminClient.from("tenants").select("slug").eq("id", effectiveTenantId).maybeSingle();
      if ((demoRow as any)?.slug === "demo") {
        return new Response(JSON.stringify({ success: true, demo: true, message: "Email is not sent from the demo company." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const preferPlatform = Boolean(use_platform_settings) || tenantOptsIntoPlatform || (isSuperAdmin && !tenant_id);
    const { smtpSettings, source } = await resolveSmtpSettings(adminClient, {
      tenantId: effectiveTenantId,
      preferPlatform,
    });

    if (!smtpSettings) {
      return new Response(JSON.stringify({ error: "SMTP not configured. Go to Settings → SMTP to configure." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawRecipients = (Array.isArray(to) ? to : [to]).map((r: string) => String(r || "").trim());
    const recipients = [...new Set(rawRecipients.filter((r: string) => emailRegex.test(r)))];
    const invalidRecipients = rawRecipients.filter((r: string) => !emailRegex.test(r));

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No valid recipient emails found", invalidRecipients }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId = crypto.randomUUID();
    const attemptResults: Array<{ source: "business_settings" | "platform_settings"; error?: string }> = [];

    const trySend = async (
      settings: SmtpSettings,
      settingsSource: "business_settings" | "platform_settings"
    ) => {
      try {
        const smtpMeta = await sendEmailBatch({
          smtpSettings: settings,
          recipients,
          subject: String(subject),
          htmlBody: String(body),
        });
        attemptResults.push({ source: settingsSource });
        return { ok: true as const, smtpMeta };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        attemptResults.push({ source: settingsSource, error: errorMessage });
        return { ok: false as const, errorMessage };
      }
    };

    const primarySource = source as "business_settings" | "platform_settings";
    const primaryAttempt = primarySource === "platform_settings"
      ? await (async () => {
          try {
            const smtpMeta = await sendPlatformEmails({
              adminClient,
              recipients,
              subject: String(subject),
              htmlBody: String(body),
              messageId,
            });
            attemptResults.push({ source: "platform_settings" });
            return { ok: true as const, smtpMeta };
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            attemptResults.push({ source: "platform_settings", error: errorMessage });
            return { ok: false as const, errorMessage };
          }
        })()
      : await trySend(smtpSettings, primarySource);

    let successfulSource = primarySource;
    let smtpMeta = primaryAttempt.ok
      ? primaryAttempt.smtpMeta
      : {
          host: String(smtpSettings.smtp_host),
          port: parseInt(String(smtpSettings.smtp_port || "465"), 10) || 465,
          encryption: "unknown",
          fromEmail: String(smtpSettings.from_email || smtpSettings.smtp_username || ""),
        };

    if (!primaryAttempt.ok && primarySource === "business_settings") {
      const fallbackSettings = await getPlatformSmtpSettings(adminClient);
      if (fallbackSettings) {
        const sameServer =
          String(fallbackSettings.smtp_host).trim().toLowerCase() === String(smtpSettings.smtp_host).trim().toLowerCase() &&
          String(fallbackSettings.smtp_port) === String(smtpSettings.smtp_port) &&
          String(fallbackSettings.smtp_username).trim().toLowerCase() === String(smtpSettings.smtp_username).trim().toLowerCase();

        if (!sameServer) {
          const fallbackAttempt = await (async () => {
            try {
              const fallbackMeta = await sendPlatformEmails({
                adminClient,
                recipients,
                subject: String(subject),
                htmlBody: String(body),
                messageId,
              });
              attemptResults.push({ source: "platform_settings" });
              return { ok: true as const, smtpMeta: fallbackMeta };
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              attemptResults.push({ source: "platform_settings", error: errorMessage });
              return { ok: false as const, errorMessage };
            }
          })();
          if (fallbackAttempt.ok) {
            successfulSource = "platform_settings";
            smtpMeta = fallbackAttempt.smtpMeta;
          }
        }
      }
    }

    const lastError = attemptResults.filter((a) => a.error).at(-1)?.error;
    const sentSuccessfully = attemptResults.some((a) => !a.error);

    if (!sentSuccessfully) {
      const friendlyError = lastError || "SMTP send failed";
      console.error("SMTP send failed", { attempts: attemptResults, error: friendlyError });

      try {
        await adminClient.from("email_send_log").insert(
          recipients.map((recipient) => ({
            message_id: messageId,
            template_name: "manual_smtp",
            recipient_email: recipient,
            status: "failed",
            error_message: friendlyError,
            metadata: { attempts: attemptResults, source },
          }))
        );
      } catch (logError) {
        console.error("Failed to log SMTP failure", logError);
      }

      return new Response(
        JSON.stringify({
          error: friendlyError,
          invalidRecipients,
          smtpMeta: {
            host: String(smtpSettings.smtp_host),
            source,
            attempts: attemptResults,
          },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    try {
      const successStatus = successfulSource === "platform_settings" ? "sent" : "accepted";
      await adminClient.from("email_send_log").insert(
        recipients.map((recipient) => ({
          message_id: messageId,
          template_name: "manual_smtp",
          recipient_email: recipient,
          status: successStatus,
          metadata: { attempts: attemptResults, source: successfulSource, transport: successfulSource === "platform_settings" ? "managed_email" : "smtp" },
        }))
      );
    } catch (logError) {
      console.error("Failed to log SMTP success", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: recipients.length,
        failed: 0,
        errors: [],
        invalidRecipients,
        message_id: messageId,
        delivery_status: successfulSource === "platform_settings" ? "sent" : "accepted",
        delivery_note: successfulSource === "platform_settings"
          ? "Sent using the verified JMSURF email domain for better Gmail deliverability."
          : "Accepted by the SMTP server. Inbox delivery depends on the mail server reputation and DNS.",
        smtpMeta: {
          host: smtpMeta.host,
          port: smtpMeta.port,
          encryption: smtpMeta.encryption,
          fromEmail: smtpMeta.fromEmail,
          source: successfulSource,
          attempts: attemptResults,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("SMTP Error:", message);
    return new Response(JSON.stringify({ error: message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
