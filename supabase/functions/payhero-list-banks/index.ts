// Lists bank paybills for the "Bank" payout selection UI.
// Always returns a usable list: PayHero's live catalogue when reachable,
// otherwise the standard Kenyan bank paybill list.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { KENYA_BANK_PAYBILLS } from "../_shared/kenya-banks.ts";
import { getPayheroCredentials, basicAuthHeader } from "../_shared/payhero-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYHERO_BASE = "https://backend.payhero.co.ke/api/v2";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const mergeBanks = (live: Array<{ id: string; name: string; paybill: string }>) => {
  const byName = new Map<string, { id: string; name: string; paybill: string }>();
  for (const b of KENYA_BANK_PAYBILLS) byName.set(b.name.toLowerCase(), b);
  for (const b of live) byName.set(b.name.toLowerCase(), b); // live entries win
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is signed in — endpoint is read-only.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonRes({ error: "Unauthorized", banks: [] }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const creds = await getPayheroCredentials(admin);

    // No credentials yet — still give the UI a working bank list.
    if (!creds.configured) {
      return jsonRes({ banks: KENYA_BANK_PAYBILLS, source: "builtin" });
    }

    let live: Array<{ id: string; name: string; paybill: string }> = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const phRes = await fetch(`${PAYHERO_BASE}/bank_paybills`, {
        method: "GET",
        headers: {
          Authorization: creds.authHeader,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const phJson = await phRes.json().catch(() => ({}));
      if (phRes.ok) {
        const raw = (phJson?.bank_paybills || phJson?.data || []) as any[];
        live = raw
          .map((b) => ({
            id: String(b.id ?? ""),
            name: String(b.name ?? ""),
            paybill: String(b.paybill ?? b.short_code ?? ""),
          }))
          .filter((b) => b.name && b.paybill);
      } else {
        console.warn("[payhero-list-banks] PayHero responded", phRes.status, phJson);
      }
    } catch (e) {
      console.warn("[payhero-list-banks] PayHero unreachable, using builtin list", String(e));
    }

    return jsonRes({
      banks: mergeBanks(live),
      source: live.length ? "payhero" : "builtin",
    });
  } catch (e: any) {
    console.error("[payhero-list-banks] error", e);
    // Never fail the UI — fall back to the standard list.
    return jsonRes({ banks: KENYA_BANK_PAYBILLS, source: "builtin" });
  }
});
