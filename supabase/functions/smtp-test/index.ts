// Sends a real test email through the SMTP server saved in the admin portal
// and reports the exact reason when the mail server refuses it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPlatformEmail, getPlatformSmtpConfig, SmtpNotConfiguredError } from "../_shared/platform-smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Sign in first" }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return json({ error: "Only the platform owner can run this test" }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const to = String((body as any).to || user.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return json({ error: "Enter a valid email address to send the test to" }, 400);
    }

    const config = await getPlatformSmtpConfig({ force: true });
    if (!config) {
      return json({
        ok: false,
        stage: "settings",
        error: "No email settings were found. Fill in the server, username and password above, then press Save & Sync.",
      });
    }

    try {
      const result = await sendPlatformEmail({
        to,
        subject: "JMSURF DASH email test",
        html: `<p>This is a test message from JMSURF DASH.</p><p>Your email settings are working.</p>`,
        text: "This is a test message from JMSURF DASH. Your email settings are working.",
      });
      return json({
        ok: true,
        stage: "sent",
        to,
        from: result.from,
        server: `${config.host}:${config.port} (${config.encryption})`,
      });
    } catch (sendError) {
      const message = (sendError as Error)?.message || String(sendError);
      console.error("smtp-test send failed:", message);
      return json({
        ok: false,
        stage: "send",
        server: `${config.host}:${config.port} (${config.encryption})`,
        from: config.fromEmail,
        error: message,
      });
    }
  } catch (e) {
    if (e instanceof SmtpNotConfiguredError) {
      return json({ ok: false, stage: "settings", error: e.message });
    }
    console.error("smtp-test failed:", e);
    return json({ ok: false, stage: "unknown", error: (e as Error).message || "Test failed" }, 500);
  }
});
