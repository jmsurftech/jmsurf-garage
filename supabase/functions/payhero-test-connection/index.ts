import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildBasicToken(username: string, password: string): string {
  if (username && !password) return username.trim();
  return btoa(`${username}:${password}`);
}

/**
 * Verifies the tenant's PayHero API credentials by calling PayHero's
 * /payment-channels endpoint (lightweight, auth-only, no side effects).
 *
 * Body: { tenant_id?: string }
 *   - If omitted, uses the caller's profile.tenant_id.
 *   - Super admins may pass any tenant_id.
 *
 * Returns: { ok, status, channels_found, message, has_bank_account }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const requestedTenantId = (body?.tenant_id as string | undefined) || null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve tenant_id (caller's profile, or requested if super_admin)
    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle();
    let tenantId = (profile as any)?.tenant_id || null;

    if (requestedTenantId && requestedTenantId !== tenantId) {
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id);
      const isSuper = (roles || []).some((r: any) => r.role === "super_admin");
      if (!isSuper) {
        return new Response(JSON.stringify({ error: "Forbidden: not allowed to test other tenants." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      tenantId = requestedTenantId;
    }

    if (!tenantId) {
      return new Response(JSON.stringify({ ok: false, message: "No tenant context. Save settings against a specific business first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Platform-first credentials (system-wide, no per-tenant entry)
    const { data: platformPayment } = await supabase
      .from("platform_settings").select("value").eq("key", "payment").maybeSingle();
    const ph = (platformPayment as any)?.value?.payhero || {};
    const tokenField = String(ph.api_username || Deno.env.get("PAYHERO_BASIC_AUTH_TOKEN") || "").trim();
    const passField = String(ph.api_password || "").trim();
    const channelId = String(ph.channel_id || Deno.env.get("PAYHERO_CHANNEL_ID") || "").trim();

    if (!tokenField) {
      return new Response(JSON.stringify({
        ok: false,
        message: "PayHero is not configured on the platform. Super admins: add credentials in Admin → Settings → Payment Gateways.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const basicToken = buildBasicToken(tokenField, passField);

    // Lightweight auth check — list payment channels
    const phRes = await fetch("https://backend.payhero.co.ke/api/v2/payment_channels", {
      method: "GET",
      headers: { Authorization: `Basic ${basicToken}`, "Content-Type": "application/json" },
    });
    const phData = await phRes.json().catch(() => ({}));

    // Also look up linked settlement bank
    const { data: bank } = await supabase
      .from("tenant_bank_accounts")
      .select("id, bank_name, account_number, account_name, is_active")
      .eq("tenant_id", tenantId).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!phRes.ok) {
      return new Response(JSON.stringify({
        ok: false,
        status: phRes.status,
        message: phData?.error_message || phData?.message || phData?.error ||
          (phRes.status === 401 ? "PayHero rejected the credentials (401 Unauthorized). Double-check API username / password / Basic Auth token." :
           `PayHero responded ${phRes.status}.`),
        has_bank_account: !!bank,
        bank,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const channels = Array.isArray(phData) ? phData : (phData?.channels || []);
    const channelMatch = channelId ? channels.some((c: any) => String(c?.id ?? c?.channel_id) === String(channelId)) : null;

    return new Response(JSON.stringify({
      ok: true,
      status: 200,
      channels_found: channels.length,
      channel_id_configured: channelId || null,
      channel_id_matches: channelMatch,
      has_bank_account: !!bank,
      bank,
      message: channelId && channelMatch === false
        ? `Auth OK, but Channel ID ${channelId} was not found in your PayHero account. Check the channel ID in Settings.`
        : "PayHero credentials are valid.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[payhero-test-connection] error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
