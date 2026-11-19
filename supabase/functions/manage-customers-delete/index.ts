import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DeleteMode = "single" | "all";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();

    const mode = String(body?.mode || "single") as DeleteMode;
    const customerId = body?.customer_id ? String(body.customer_id) : null;
    const requestedTenantId = body?.tenant_id ? String(body.tenant_id) : null;

    if (mode !== "single" && mode !== "all") {
      return new Response(JSON.stringify({ error: "Invalid mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: profile }, { data: roleRows }] = await Promise.all([
      adminClient.from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle(),
      adminClient.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const roles = (roleRows || []).map((r: any) => String(r.role));
    const canDelete = roles.some((r) => ["admin", "manager", "super_admin"].includes(r));
    if (!canDelete) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSuperAdmin = roles.includes("super_admin");
    const effectiveTenantId = requestedTenantId || profile?.tenant_id || null;

    if (!effectiveTenantId) {
      return new Response(JSON.stringify({ error: "Tenant not found for user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isSuperAdmin && requestedTenantId && requestedTenantId !== profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden tenant access" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let customerIds: string[] = [];

    if (mode === "single") {
      if (!customerId) {
        return new Response(JSON.stringify({ error: "Missing customer_id for single mode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: customer } = await adminClient
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .eq("tenant_id", effectiveTenantId)
        .maybeSingle();

      if (!customer) {
        return new Response(JSON.stringify({ error: "Customer not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      customerIds = [customer.id];
    } else {
      const { data: customers } = await adminClient
        .from("customers")
        .select("id")
        .eq("tenant_id", effectiveTenantId);

      customerIds = (customers || []).map((c: any) => String(c.id));
    }

    if (customerIds.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanups = await Promise.all([
      adminClient
        .from("transactions")
        .update({ customer_id: null } as any)
        .eq("tenant_id", effectiveTenantId)
        .in("customer_id", customerIds),
      adminClient
        .from("invoices")
        .update({ customer_id: null } as any)
        .eq("tenant_id", effectiveTenantId)
        .in("customer_id", customerIds),
      adminClient
        .from("quotes")
        .update({ customer_id: null } as any)
        .eq("tenant_id", effectiveTenantId)
        .in("customer_id", customerIds),
    ]);

    const cleanupError = cleanups.find((r) => r.error)?.error;
    if (cleanupError) {
      return new Response(JSON.stringify({ error: cleanupError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteError, count } = await adminClient
      .from("customers")
      .delete({ count: "exact" })
      .eq("tenant_id", effectiveTenantId)
      .in("id", customerIds);

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, deleted: count ?? customerIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});