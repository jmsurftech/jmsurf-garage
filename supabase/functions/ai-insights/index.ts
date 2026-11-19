// Business insights and chat powered by Claude (Anthropic API).
// The caller must be signed in and belong to the shop it asks about.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Model is configurable so the owner can trade quality for cost
// (e.g. set AI_INSIGHTS_MODEL=claude-haiku-4-5 for the cheapest option).
const AI_MODEL = Deno.env.get("AI_INSIGHTS_MODEL") || "claude-opus-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Body = {
  mode: "insights" | "chat";
  tenant_id: string;
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
};

async function getContext(tenantId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const [txRes, prodRes, expRes, stockRes] = await Promise.all([
    admin.from("transactions").select("total,tax,items,payment_method,created_at,status")
      .eq("tenant_id", tenantId).gte("created_at", since).limit(2000),
    admin.from("products").select("id,name,price,cost_price").eq("tenant_id", tenantId).limit(500),
    admin.from("expenses").select("amount,category_id,expense_date,description")
      .eq("tenant_id", tenantId).gte("expense_date", since.slice(0, 10)).limit(500),
    admin.from("product_stocks").select("product_id,quantity,low_stock_threshold")
      .eq("tenant_id", tenantId).limit(1000),
  ]);

  const tx = (txRes.data || []).filter((t: any) => (t.status ?? "completed") === "completed");
  const revenue = tx.reduce((s: number, t: any) => s + Number(t.total || 0), 0);
  const txCount = tx.length;
  const expenses = (expRes.data || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

  // Top products
  const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();
  tx.forEach((t: any) => {
    (t.items || []).forEach((i: any) => {
      const key = i.id || i.name || "x";
      const prev = prodMap.get(key) || { name: i.name || "Unknown", qty: 0, revenue: 0 };
      prev.qty += Number(i.quantity || 0);
      prev.revenue += Number(i.price || 0) * Number(i.quantity || 0);
      prodMap.set(key, prev);
    });
  });
  const topProducts = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Low stock
  const productNames = new Map((prodRes.data || []).map((p: any) => [p.id, p.name]));
  const lowStock = (stockRes.data || [])
    .filter((s: any) => Number(s.quantity) <= Number(s.low_stock_threshold || 0))
    .slice(0, 10)
    .map((s: any) => ({ name: productNames.get(s.product_id) || s.product_id, qty: Number(s.quantity) }));

  return {
    period_days: 30,
    revenue_kes: Math.round(revenue),
    expenses_kes: Math.round(expenses),
    net_profit_kes: Math.round(revenue - expenses),
    transaction_count: txCount,
    product_count: (prodRes.data || []).length,
    top_products: topProducts,
    low_stock_items: lowStock,
  };
}

async function callGateway(messages: { role: string; content: string }[]) {
  if (!ANTHROPIC_KEY) {
    throw new Error("AI Insights is not switched on yet. The platform owner needs to add an Anthropic API key.");
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  // The business data goes in the system prompt; the conversation follows.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  if (!turns.length || turns[0].role !== "user") turns.unshift({ role: "user", content: "Summarise my business." });

  try {
    const isOpus5 = AI_MODEL === "claude-opus-5";
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      system,
      messages: turns,
      // Short, routine analysis: medium effort keeps answers quick and cheap.
      ...(isOpus5 ? { output_config: { effort: "medium" } } : {}),
      // If a request is declined by a safety check, retry it on the default
      // fallback model inside the same call instead of failing.
      ...(isOpus5 ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as any);
    if (response.stop_reason === "refusal") {
      throw new Error("The assistant could not answer that request. Try rephrasing it.");
    }
    return response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new Error("Rate limit reached. Please retry shortly.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The Anthropic API key was rejected. Check it in the server settings.");
    if (e instanceof Anthropic.APIError) throw new Error(`AI service error ${e.status}: ${String(e.message).slice(0, 200)}`);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // ─── Authenticate caller ──────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user }, error: authErr } = await admin.auth.getUser(
      authHeader.replace(/^[Bb]earer\s+/, "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body.tenant_id) throw new Error("tenant_id required");

    // ─── Authorize: tenant_id must match caller's tenant (or super_admin) ─
    const [{ data: profile }, { data: roles }] = await Promise.all([
      admin.from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    const isSuperAdmin = (roles || []).some((r: any) => r.role === "super_admin");
    if (!isSuperAdmin && profile?.tenant_id !== body.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx = await getContext(body.tenant_id);
    const sys = `You are a business intelligence assistant for a Kenyan POS/retail business.
Currency is KES. Be concise, specific, and actionable. Use numbered lists or plain paragraphs when listing items. Do NOT use asterisks (*), markdown bullets, or star symbols.
Business data (last 30 days):
${JSON.stringify(ctx, null, 2)}`;

    let messages: { role: string; content: string }[];
    if (body.mode === "insights") {
      messages = [
        { role: "system", content: sys },
        { role: "user", content: "Give 4-6 smart insights about my business performance, opportunities, and risks. Use numbered lists or plain paragraphs. Do NOT use asterisks or star bullets." },
      ];
    } else {
      messages = [{ role: "system", content: sys }, ...(body.messages || [])];
    }

    const content = await callGateway(messages);
    return new Response(JSON.stringify({ content, context: ctx }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
