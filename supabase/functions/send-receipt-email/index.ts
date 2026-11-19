import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatKES(n: number) {
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
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

    const userId = user.id;
    const { email, receipt, tenant_id } = await req.json();

    if (!email || !receipt) {
      return new Response(JSON.stringify({ error: "Missing email or receipt data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve tenant ID from caller's profile
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    let effectiveTenantId = callerProfile?.tenant_id ?? null;

    // If caller explicitly passed a tenant_id, verify they belong to it
    // (or are a super_admin). Prevents cross-tenant SMTP abuse.
    if (tenant_id && tenant_id !== effectiveTenantId) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "super_admin")
        .maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      effectiveTenantId = tenant_id;
    }

    // The public demo never sends real email (anyone can open it).
    if (effectiveTenantId) {
      const { data: demoRow } = await supabase.from("tenants").select("slug").eq("id", effectiveTenantId).maybeSingle();
      if ((demoRow as any)?.slug === "demo") {
        return new Response(JSON.stringify({ success: true, demo: true, message: "Email is not sent from the demo company." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    // 1. Try tenant SMTP from business_settings (unless tenant opts into platform SMTP)
    let smtpConfig: any = null;
    let brandName = "JMSURF DASH";
    let useTenantPlatformOptIn = false;

    if (effectiveTenantId) {
      const { data: bs } = await supabase
        .from("business_settings")
        .select("smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_encryption, business_name, use_platform_smtp")
        .eq("tenant_id", effectiveTenantId)
        .maybeSingle();

      useTenantPlatformOptIn = !!(bs as any)?.use_platform_smtp;
      if (bs?.business_name) brandName = bs.business_name;

      if (!useTenantPlatformOptIn && bs?.smtp_host && bs?.smtp_username && bs?.smtp_password) {
        smtpConfig = {
          host: bs.smtp_host,
          port: bs.smtp_port || "587",
          username: bs.smtp_username,
          password: bs.smtp_password,
          from_email: bs.smtp_from_email || bs.smtp_username,
          from_name: bs.smtp_from_name || bs.business_name || brandName,
          encryption: bs.smtp_encryption || "tls",
        };
      }
    }

    // 2. Fallback: platform_settings SMTP
    if (!smtpConfig) {
      const { data: ps } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "smtp")
        .maybeSingle();

      if (ps?.value) {
        const v = ps.value as any;
        if (v.host && v.username && v.password) {
          smtpConfig = {
            host: v.host,
            port: String(v.port || "587"),
            username: v.username,
            password: v.password,
            from_email: v.from_email || v.username,
            from_name: v.from_name || brandName,
            encryption: v.encryption || "tls",
          };
        }
      }
    }

    // 3. Read general settings for branding fallback
    if (brandName === "JMSURF DASH") {
      const { data: generalSettings } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "general")
        .maybeSingle();
      const general = generalSettings?.value as any || {};
      if (general?.business_name) brandName = general.business_name;
    }

    if (!smtpConfig) {
      return new Response(JSON.stringify({ error: "Email service not configured. Go to Settings → SMTP to configure." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build email HTML
    const items = (receipt.items || []) as Array<{ name: string; quantity: number; price: number; vat_rate: number }>;
    const date = new Date(receipt.created_at);

    const itemRows = items
      .map(
        (i) =>
          `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">${esc(i.name)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;text-align:center;">${esc(i.quantity)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;">${formatKES(i.price * i.quantity)}</td>
          </tr>`
      )
      .join("");

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <div style="background:#18181b;color:#fff;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:20px;">${esc(brandName)}</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:0.7;">Sale Receipt</p>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;font-size:13px;color:#555;margin-bottom:16px;">
        <tr><td>Date</td><td style="text-align:right;">${esc(date.toLocaleDateString("en-KE"))}</td></tr>
        <tr><td>Time</td><td style="text-align:right;">${esc(date.toLocaleTimeString("en-KE"))}</td></tr>
        <tr><td>Cashier</td><td style="text-align:right;">${esc(receipt.cashier_name || "—")}</td></tr>
        <tr><td>Receipt #</td><td style="text-align:right;">${esc(String(receipt.id || "").slice(0, 8).toUpperCase())}</td></tr>
      </table>
      <hr style="border:none;border-top:1px dashed #ddd;margin:16px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="font-size:12px;color:#888;text-transform:uppercase;">
            <th style="text-align:left;padding-bottom:8px;">Item</th>
            <th style="text-align:center;padding-bottom:8px;">Qty</th>
            <th style="text-align:right;padding-bottom:8px;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <hr style="border:none;border-top:1px dashed #ddd;margin:16px 0;">
      <table style="width:100%;font-size:14px;">
        <tr><td>Subtotal</td><td style="text-align:right;">${formatKES(receipt.subtotal)}</td></tr>
        <tr><td>VAT (incl.)</td><td style="text-align:right;">${formatKES(receipt.tax)}</td></tr>
        ${receipt.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;color:#ef4444;">-${formatKES(receipt.discount)}</td></tr>` : ""}
      </table>
      <div style="margin-top:12px;padding:12px;background:#f4f4f5;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:16px;font-weight:bold;">TOTAL</span>
        <span style="font-size:18px;font-weight:bold;">${formatKES(receipt.total)}</span>
      </div>
      <p style="margin-top:8px;font-size:12px;color:#888;">Payment: <strong>${esc(String(receipt.payment_method || "").toUpperCase())}</strong></p>
      ${receipt.mpesa_ref ? `<p style="font-size:12px;color:#888;">M-Pesa Ref: ${esc(receipt.mpesa_ref)}</p>` : ""}
      <hr style="border:none;border-top:1px dashed #ddd;margin:16px 0;">
      <p style="text-align:center;font-size:12px;color:#aaa;">Thank you for shopping with us!</p>
    </div>
  </div>
</body></html>`;

    const emailSubject = `Receipt from ${brandName} — ${formatKES(receipt.total)}`;

    if (!smtpConfig) {
      return new Response(JSON.stringify({ error: "Email service not configured. Go to Settings → SMTP to configure." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via SMTP (tenant or platform)
    const port = parseInt(String(smtpConfig.port || "587"), 10) || 587;
    const encryption = String(smtpConfig.encryption || "tls").toLowerCase();
    const tls = encryption === "ssl" || port === 465;

    const client = new SMTPClient({
      connection: {
        hostname: String(smtpConfig.host).trim(),
        port,
        tls,
        auth: {
          username: String(smtpConfig.username).trim(),
          password: String(smtpConfig.password),
        },
      },
    });

    const fromEmail = String(smtpConfig.from_email || smtpConfig.username || "").trim();
    const fromName = String(smtpConfig.from_name || brandName).trim();
    const fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    await client.send({
      from: fromAddress,
      to: email,
      subject: emailSubject,
      content: "auto",
      html,
    });

    try { await client.close(); } catch {}

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Receipt email error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
