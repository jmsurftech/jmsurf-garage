import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function parseJson(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
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

    const { phone, amount, account_ref, transaction_id, source, tenant_id, tenant_slug } = await parseJson(req);

    if (!phone || !amount) {
      return new Response(JSON.stringify({ error: "phone and amount are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read M-Pesa settings (billing => superadmin defaults, POS => tenant settings)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const isBillingFlow = source === "billing" || source === "subscription" || source === "activation";
    const deny = (error: string) => new Response(JSON.stringify({ error }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    // Package payments go through the server (Billing page). The platform paybill is
    // never open to ordinary sign-ins here, or anyone could prompt any number.
    if (isBillingFlow) {
      const { data: admin } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!admin) return deny("Pay for your package from Plan and billing.");
    }
    const pickFirst = (...values: Array<string | null | undefined>) => {
      for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
      return "";
    };

    const { data: platformPaymentRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "payment")
      .maybeSingle();

    // Platform aggregator M-Pesa credentials. Prefer the `daraja` sub-tree (which is
    // where JMSURF's paybill 4022819 + consumer key/secret/passkey are saved by the
    // super-admin). Fall back to legacy `mpesa` for older installs.
    const platformPaymentValue = ((platformPaymentRow as any)?.value || {}) as Record<string, any>;
    const platformMpesa = ({
      ...(platformPaymentValue.mpesa || {}),
      ...(platformPaymentValue.daraja || {}),
    }) as Record<string, any>;

    let tenantSettings: Record<string, any> | null = null;
    let useTenantPlatformOptIn = false;
    if (!isBillingFlow) {
      const reqTenantId = typeof tenant_id === "string" ? tenant_id.trim() : "";
      const reqTenantSlug = typeof tenant_slug === "string" ? tenant_slug.trim().toLowerCase() : "";
      if (!reqTenantId && !reqTenantSlug) {
        return new Response(JSON.stringify({ error: "M-Pesa tenant context is missing. Open POS through a tenant URL and try again." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tq = supabase.from("tenants").select("id, slug");
      const { data: tenantRow } = reqTenantId
        ? await tq.eq("id", reqTenantId).maybeSingle()
        : await tq.eq("slug", reqTenantSlug).maybeSingle();
      const resolvedTenantId = (tenantRow as any)?.id as string | undefined;
      // The public demo never sends real payment prompts (anyone can open it).
      if ((tenantRow as any)?.slug === "demo") return deny("Payments are switched off in the demo. Create your own free company to take real payments.");
      if (!resolvedTenantId) {
        return new Response(JSON.stringify({ error: `M-Pesa tenant context is invalid. No tenant matches ${reqTenantSlug || reqTenantId}.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if ((profile as any)?.tenant_id !== resolvedTenantId) {
        const { data: roleRow } = await supabase
          .from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
        if (!roleRow) {
          return new Response(JSON.stringify({ error: "M-Pesa tenant context is not authorized for the current user." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data: settings, error: settingsErr } = await supabase
        .from("business_settings")
        .select("payment_provider, mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_shortcode, mpesa_environment, mpesa_transaction_type, mpesa_till_number, mpesa_account_reference, use_platform_mpesa")
        .eq("tenant_id", resolvedTenantId)
        .maybeSingle();

      if (settingsErr) {
        return new Response(JSON.stringify({ error: "Could not load M-Pesa settings from database" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      tenantSettings = settings;
      useTenantPlatformOptIn = !!(settings as any)?.use_platform_mpesa;
    }

    // HYBRID PAYMENT MODEL:
    //   - Billing flow → always uses platform paybill (4022819) as destination.
    //   - POS flow using JMSURF Pay / Bank provider (tenant opted in) → STK push
    //     goes to platform paybill using platform keys. Funds settle to JMSURF first.
    //   - POS flow using Direct Daraja → never use platform keys, because the
    //     receiving shortcode in the STK prompt is also where the funds settle.
    //     If we used JMSURF keys here, the money would go to JMSURF, not the tenant.
    //   - Legacy POS flow with tenant who opted in (default for tenants without their own
    //     Daraja keys) → STK push goes to platform paybill using platform keys.
    //     Tenant's till/paybill is captured in AccountReference for reconciliation
    //     and disbursement by JMSURF later.
    //   - POS flow with tenant who has their own keys (use_platform_mpesa = false
    //     and saved consumer key/secret/passkey) → STK push uses the tenant's
    //     keys and the funds settle directly to their own paybill/till.
    const wantsDirectDaraja = !isBillingFlow && tenantSettings?.payment_provider === "daraja";
    const tenantHasOwnCreds = !!(
      pickFirst(tenantSettings?.mpesa_consumer_key) &&
      pickFirst(tenantSettings?.mpesa_consumer_secret) &&
      pickFirst(tenantSettings?.mpesa_passkey)
    );
    const useMasterKeys = isBillingFlow || (!wantsDirectDaraja && (useTenantPlatformOptIn || (!isBillingFlow && !tenantHasOwnCreds)));

    // Runtime secrets must win over saved platform settings. This prevents a
    // stale admin settings row (for example sandbox passkey) from overriding the
    // live credentials that were securely updated in Lovable Cloud secrets.
    // Platform DB values (JMSURF aggregator paybill) MUST win over env vars, because
    // env vars may hold a different platform shortcode (e.g. billing paybill) that
    // is not the aggregator collection account. This keeps the STK prompt showing
    // "JMSURF TECHNOLOGIES" (paybill 4022819) for tenant collections.
    const platformConsumerKey = pickFirst(platformMpesa.consumer_key, Deno.env.get("MPESA_CONSUMER_KEY"));
    const platformConsumerSecret = pickFirst(platformMpesa.consumer_secret, Deno.env.get("MPESA_CONSUMER_SECRET"));
    const platformPasskey = pickFirst(platformMpesa.passkey, Deno.env.get("MPESA_PASSKEY"));
    const platformShortcode = pickFirst(platformMpesa.shortcode, Deno.env.get("MPESA_SHORTCODE"));
    const platformEnvironment = pickFirst(platformMpesa.environment, Deno.env.get("MPESA_ENVIRONMENT"), "live");

    const consumerKey = useMasterKeys
      ? platformConsumerKey
      : pickFirst(tenantSettings?.mpesa_consumer_key);

    const consumerSecret = useMasterKeys
      ? platformConsumerSecret
      : pickFirst(tenantSettings?.mpesa_consumer_secret);

    const passkey = useMasterKeys
      ? platformPasskey
      : pickFirst(tenantSettings?.mpesa_passkey);

    const platformTransactionType = pickFirst(platformMpesa.transaction_type, "CustomerPayBillOnline");

    // Destination shortcode for the password+PartyB on Daraja:
    //   - useMasterKeys → platform shortcode (Daraja passkey is registered to it).
    //   - own creds     → tenant's own shortcode/till.
    const tenantShortcode = pickFirst(tenantSettings?.mpesa_shortcode);
    const tenantTillNumber = pickFirst(tenantSettings?.mpesa_till_number);
    const tenantTransactionType = pickFirst(tenantSettings?.mpesa_transaction_type, "CustomerPayBillOnline");
    const tenantAccountRef = pickFirst(tenantSettings?.mpesa_account_reference);

    const environment = useMasterKeys
      ? platformEnvironment
      : pickFirst(tenantSettings?.mpesa_environment, "live");

    if (!consumerKey || !consumerSecret || !passkey) {
      const directConfigError = wantsDirectDaraja
        ? "Direct M-Pesa is missing this business's own Daraja Consumer Key, Consumer Secret, or Passkey. The platform keys cannot be used for direct settlement because that sends the money to JMSURF. Add Azil's Daraja credentials in Settings → Payment Gateways → Direct Daraja."
        : "M-Pesa is not configured on this platform yet. Contact support.";
      return new Response(JSON.stringify({ error: directConfigError }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let transactionType: string;
    let stkShortcode: string;
    let partyB: string;
    let accountReference: string;

    if (useMasterKeys) {
      // Aggregator: always paybill against the platform shortcode.
      transactionType = platformTransactionType || "CustomerPayBillOnline";
      stkShortcode = platformShortcode;
      partyB = platformShortcode;
      // Reconciliation key — prefer the tenant's till/paybill so we can route the
      // settled funds back to them. Falls back to the slug or transaction id.
      accountReference =
        pickFirst(
          tenantTillNumber,
          tenantShortcode,
          tenantAccountRef,
          tenant_slug as string,
          account_ref as string,
          transaction_id as string,
        ) || "JMSURF";
      // Daraja AccountReference max length is 12 chars.
      if (accountReference.length > 12) accountReference = accountReference.slice(0, 12);
    } else {
      // Direct: tenant's own Daraja app + shortcode.
      transactionType = tenantTransactionType === "CustomerBuyGoodsOnline"
        ? "CustomerBuyGoodsOnline"
        : "CustomerPayBillOnline";
      const isBuyGoods = transactionType === "CustomerBuyGoodsOnline";
      // Direct/custom keys must generate the Daraja password with the merchant's
      // own receiving shortcode. For Buy Goods this is the Till number saved by
      // the merchant, so the prompt and settlement both belong to that merchant.
      stkShortcode = isBuyGoods ? pickFirst(tenantTillNumber, tenantShortcode) : tenantShortcode;
      partyB = isBuyGoods ? pickFirst(tenantTillNumber, tenantShortcode) : tenantShortcode;
      accountReference = isBuyGoods
        ? (account_ref || transaction_id || "POS")
        : (tenantAccountRef || account_ref || transaction_id || "POS");
      if (accountReference.length > 12) accountReference = accountReference.slice(0, 12);
    }

    const shortcode = stkShortcode;
    const rawTillNumber = useMasterKeys ? "" : tenantTillNumber;

    const isBuyGoods = transactionType === "CustomerBuyGoodsOnline";

    // ---- PREFLIGHT VALIDATOR ----
    const preflightIssues: string[] = [];
    if (!stkShortcode) {
      preflightIssues.push(
        useMasterKeys
          ? "Platform M-Pesa shortcode is missing. Contact support."
          : "Business Shortcode is empty. Enter your Daraja shortcode in Settings → Payment Gateways → M-Pesa."
      );
    } else if (!/^\d{5,7}$/.test(stkShortcode)) {
      preflightIssues.push(
        `Business Shortcode "${stkShortcode}" is not a valid 5-7 digit Daraja shortcode.`
      );
    }
    if (!useMasterKeys && isBuyGoods) {
      if (!tenantTillNumber) {
        preflightIssues.push("Till Number is empty. Enter your Buy Goods Till in Settings → Payment Gateways → M-Pesa.");
      } else if (!/^\d{5,7}$/.test(tenantTillNumber)) {
        preflightIssues.push(`Till Number "${tenantTillNumber}" is not a valid 5-7 digit Daraja till.`);
      }
    }
    if (passkey && passkey.length < 32) {
      preflightIssues.push(`Passkey looks too short (${passkey.length} chars). The Daraja passkey is normally 64 hex characters.`);
    }
    // Aggregator mode requires the tenant to at least have a destination till/paybill
    // recorded so we can reconcile and disburse later.
    if (useMasterKeys && !isBillingFlow && !pickFirst(tenantTillNumber, tenantShortcode)) {
      preflightIssues.push(
        "Enter your M-Pesa Till or Paybill number in Settings → Payment Gateways → M-Pesa so we can route the funds to you."
      );
    }
    if (preflightIssues.length > 0) {
      const errorMsg = preflightIssues.join(" ");
      if (transaction_id) {
        await supabase.from("transactions").update({
          status: "failed",
          mpesa_error_message: errorMsg,
          mpesa_error_payload: {
            source: "mpesa-stk-push-preflight",
            tenant_id: tenantSettings ? tenant_id || null : null,
            tenant_slug: tenantSettings ? tenant_slug || null : null,
            issues: preflightIssues,
            context: { transactionType, shortcode: stkShortcode, partyB, environment, configured_shortcode: shortcode, configured_till: rawTillNumber },
            captured_at: new Date().toISOString(),
          },
        } as any).eq("id", transaction_id);
      }
      return new Response(JSON.stringify({
        success: false,
        error: errorMsg,
        preflight: true,
        issues: preflightIssues,
        mpesa_context: { transactionType, shortcode: stkShortcode, partyB, environment },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = environment === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

    // ---- LIVE DARAJA AUTH PROBE ----
    // Validate consumer key/secret pair against Daraja before attempting STK push,
    // so we return a clear actionable error instead of a generic 500.
    const authStr = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenRes = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${authStr}` } }
    );
    let tokenData: any = {};
    try { tokenData = await tokenRes.json(); } catch { tokenData = {}; }
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      const authErrMsg = tokenRes.status === 400 || tokenRes.status === 401
        ? `Daraja rejected your M-Pesa Consumer Key/Secret (HTTP ${tokenRes.status}). Open Settings → Payment Gateways → M-Pesa and re-paste the keys from your Daraja app, or enable "Use platform M-Pesa".`
        : `Could not reach Daraja to validate M-Pesa credentials (HTTP ${tokenRes.status}). Try again in a moment.`;
      if (transaction_id) {
        await supabase.from("transactions").update({
          status: "failed",
          mpesa_error_message: authErrMsg,
          mpesa_error_payload: {
            source: "mpesa-stk-push-auth-probe",
            tenant_id: tenantSettings ? tenant_id || null : null,
            tenant_slug: tenantSettings ? tenant_slug || null : null,
            http_status: tokenRes.status,
            payload: tokenData,
            captured_at: new Date().toISOString(),
          },
        } as any).eq("id", transaction_id);
      }
      return new Response(JSON.stringify({
        success: false,
        error: authErrMsg,
        preflight: true,
        auth_probe_failed: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const timestamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    const password = btoa(`${stkShortcode}${passkey}${timestamp}`);

    let formattedPhone = String(phone).replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) formattedPhone = "254" + formattedPhone.slice(1);
    if (!formattedPhone.startsWith("254")) formattedPhone = "254" + formattedPhone;

    const numericAmount = Math.max(1, Math.ceil(Number(amount)));
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const callbackSecret = Deno.env.get("MPESA_CALLBACK_SECRET") || "";
    const callbackUrl = callbackSecret
      ? `${supabaseUrl}/functions/v1/mpesa-callback?token=${encodeURIComponent(callbackSecret)}`
      : `${supabaseUrl}/functions/v1/mpesa-callback`;

    console.log("STK Push params:", { shortcode: stkShortcode, partyB, transactionType, configuredShortcode: shortcode, configuredTill: rawTillNumber, formattedPhone, numericAmount });

    const stkRes = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: stkShortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: transactionType,
          Amount: numericAmount,
          PartyA: formattedPhone,
          PartyB: partyB,
          PhoneNumber: formattedPhone,
          CallBackURL: callbackUrl,
          AccountReference: (transactionType === "CustomerPayBillOnline" && accountReference) ? accountReference : (account_ref || "DukaPoint"),
          TransactionDesc: `Payment for ${transaction_id || "sale"}`,
        }),
      }
    );

    const stkData = await stkRes.json();
    const accepted = stkRes.ok && String(stkData?.ResponseCode) === "0";

    // Detect transient Safaricom outage (Daraja returns 500.002.1001 when their service is down)
    const isSafaricomOutage =
      String(stkData?.errorCode || "").startsWith("500.002") ||
      /temporarily unavailable/i.test(String(stkData?.errorMessage || ""));

    let friendlyError: string;
    if (stkData?.errorMessage === "Merchant does not exist") {
      friendlyError = `M-Pesa rejected the merchant shortcode. Confirm Business Short Code (${stkShortcode}) and Till Number (${partyB}) match the saved passkey and Daraja app.`;
    } else if (isSafaricomOutage) {
      friendlyError = "Safaricom's M-Pesa service is temporarily unavailable. This is on Safaricom's side — please wait a moment and try again, or ask the customer to pay via Send Money to the till.";
    } else {
      friendlyError = stkData?.errorMessage || stkData?.ResponseDescription || "M-Pesa rejected the STK request";
    }

    const responseBody = accepted ? { ...stkData, success: true } : {
      success: false,
      ...stkData,
      error: friendlyError,
      retryable: isSafaricomOutage,
      mpesa_context: { transactionType, shortcode: stkShortcode, partyB, environment },
    };

    if (transaction_id) {
      const logPayload = {
        source: "mpesa-stk-push",
        provider: "daraja",
        accepted,
        tenant_id: tenantSettings ? tenant_id || null : null,
        tenant_slug: tenantSettings ? tenant_slug || null : null,
        http_status: stkRes.status,
        response_code: stkData?.ResponseCode ?? null,
        response_description: stkData?.ResponseDescription ?? null,
        merchant_request_id: stkData?.MerchantRequestID ?? null,
        checkout_request_id: stkData?.CheckoutRequestID ?? null,
        customer_message: stkData?.CustomerMessage ?? null,
        error_code: stkData?.errorCode ?? null,
        error_message: stkData?.errorMessage ?? null,
        payload: stkData,
        context: { transactionType, shortcode: stkShortcode, partyB, environment },
        captured_at: new Date().toISOString(),
      };

      if (!accepted) {
        await supabase.from("transactions").update({
          status: "failed",
          mpesa_error_message: responseBody.error,
          mpesa_error_payload: logPayload,
        } as any).eq("id", transaction_id);
      } else {
        // Log accepted STK push so the receipt/transaction history retains
        // Daraja response codes, request IDs and timestamps for auditing.
        await supabase.from("transactions").update({
          mpesa_error_payload: logPayload,
        } as any).eq("id", transaction_id);
      }
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
