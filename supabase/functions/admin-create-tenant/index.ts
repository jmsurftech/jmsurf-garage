import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller is super_admin
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !caller) throw new Error("Unauthorized");

    // The platform owner is whoever is in platform_admins (the super_admin role is
    // dropped while they work inside a company).
    const { data: roles } = await adminClient.from("user_roles").select("role").eq("user_id", caller.id);
    const { data: owners } = await adminClient.from("platform_admins").select("user_id").eq("user_id", caller.id);
    if (!roles?.some((r: any) => r.role === "super_admin") && !owners?.length) throw new Error("Forbidden");

    const body = await req.json();
    const {
      email, password, business_name, contact_name, contact_phone,
      business_email, business_phone, business_address, industry,
      plan_id, billing_cycle,
    } = body;
    // Force slug to lowercase, alphanumeric + dashes only
    const store_slug = String(body.store_slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");

    if (!email || !password || !business_name) {
      throw new Error("Email, password, and business name are required");
    }

    // Create the owner user with tenant registration metadata
    // The handle_new_user trigger will auto-create: profile, tenant, user_roles, business_settings, subscription
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: contact_name || business_name,
        registration_type: "tenant",
        business_name,
        business_email: business_email || email,
        business_phone: business_phone || contact_phone || "",
        business_address: business_address || "",
        industry: industry || "",
        contact_name: contact_name || "",
        contact_email: email,
        contact_phone: contact_phone || "",
        store_slug: store_slug || "",
        plan_id: plan_id || "",
        billing_cycle: billing_cycle || "monthly",
        // Company added by the platform admin for the customer (the database requires a terms record).
        terms_accepted: true,
        terms_version: "2026-11-14",
        terms_source: "admin",
      },
    });

    if (createError) throw createError;

    const userId = newUser.user?.id;

    // Fetch the tenant that was auto-created by the trigger
    let tenantId: string | null = null;
    if (userId) {
      // Small delay to let trigger complete
      await new Promise(r => setTimeout(r, 500));
      
      const { data: profile } = await adminClient
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", userId)
        .single();
      
      tenantId = profile?.tenant_id || null;

      // Update tenant with additional fields if provided
      if (tenantId) {
        const updates: Record<string, any> = {};
        if (store_slug) updates.slug = store_slug;
        if (contact_phone) updates.contact_phone = contact_phone;
        if (industry) updates.industry = industry;
        if (Object.keys(updates).length > 0) {
          await adminClient.from("tenants").update(updates).eq("id", tenantId);
        }
      }
    }

    // Send welcome email (fire-and-forget)
    const logWelcome = async (status: "sent" | "suppressed" | "failed", errorMessage?: string) => {
      const { error } = await adminClient.from("email_send_log").insert({
        message_id: null,
        template_name: "welcome",
        recipient_email: email,
        status,
        error_message: errorMessage ?? null,
      });
      if (error) console.error("Failed to write email_send_log:", error.message);
    };

    try {
      const result = await sendTemplateEmail("welcome", email, {
        idempotencyKey: `welcome-${userId || email}`,
        templateData: {
          name: contact_name || business_name,
          loginUrl: store_slug ? `https://${store_slug}.jmsurfdash.co.ke/login` : "https://jmsurfdash.co.ke/login",
        },
      });
      await logWelcome(result.sent ? "sent" : "suppressed");
    } catch (emailErr) {
      const message = emailErr instanceof Error ? emailErr.message : String(emailErr);
      console.error("Welcome email failed (non-blocking):", message);
      await logWelcome("failed", message.slice(0, 1000));
    }

    return new Response(JSON.stringify({ 
      success: true, 
      user_id: userId,
      tenant_id: tenantId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("admin-create-tenant error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
