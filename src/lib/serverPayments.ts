import { supabase } from "@/integrations/supabase/client";

/**
 * Payments are handled by the app's own server, which ships with every deploy.
 * When that server is not available, we fall
 * back to the older backend function so nothing breaks while testing.
 */

type CallResult<T> = { data: T | null; error: string | null; unavailable?: boolean };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** The app server's payment routes (same origin on every address). */
function paymentsUrl(path: string): string {
  // Every JMSURF Garage address (app., a company's own domain) is served by the same server: same-origin calls.
  return path;
}

async function callServer<T>(path: string, body: Record<string, unknown>): Promise<CallResult<T>> {
  const token = await accessToken();
  if (!token) return { data: null, error: "Please sign in again." };

  let response: Response;
  try {
    response = await fetch(paymentsUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { data: null, error: null, unavailable: true };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    // The static site answered instead of the payment service.
    return { data: null, error: null, unavailable: true };
  }

  const payload = (await response.json().catch(() => null)) as any;
  if (!payload) return { data: null, error: null, unavailable: true };
  if (!response.ok || payload?.error) {
    return { data: payload as T, error: String(payload?.error || "That did not go through.") };
  }
  return { data: payload as T, error: null };
}

/** Reads the message out of a backend function error or reply. */
export async function readFunctionError(error: any, data: any): Promise<string> {
  try {
    const context = error?.context;
    if (context) {
      if (typeof context.json === "function") {
        const parsed = await context.json();
        const message = parsed?.error || parsed?.message;
        if (message) return String(message);
      } else if (context.body) {
        const parsed = await new Response(context.body).json();
        const message = parsed?.error || parsed?.message;
        if (message) return String(message);
      }
    }
  } catch {
    /* ignore */
  }
  return String(data?.error || error?.message || "");
}

const DEPLOYED_FUNCTIONS = new Set(["payhero-list-banks"]);

async function fallbackToFunction<T>(name: string, body: Record<string, unknown>): Promise<CallResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error || (data as any)?.error) {
    return { data: (data as T) ?? null, error: (await readFunctionError(error, data)) || "That did not go through." };
  }
  return { data: data as T, error: null };
}

async function callWithFallback<T>(
  path: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<CallResult<T>> {
  const result = await callServer<T>(path, body);
  // Only functions that are actually deployed may be used as a fallback.
  if (result.unavailable && DEPLOYED_FUNCTIONS.has(functionName)) return await fallbackToFunction<T>(functionName, body);
  if (result.unavailable) return { data: null, error: "Could not reach the payment service. Check your connection and try again." };
  return result;
}

/** Links a shop's Till, Paybill or bank account with the payment network. */
export function registerPayoutChannel(body: Record<string, unknown>) {
  return callWithFallback<{ success?: boolean; channel?: unknown; error?: string }>(
    "/api/payments/payhero/register-channel",
    "payhero-register-channel",
    body,
  );
}

/** Sends the customer an M-Pesa prompt for a sale. */
export function posMpesaPrompt(body: Record<string, unknown>) {
  return callServer<{
    success?: boolean;
    checkout_request_id?: string;
    external_reference?: string;
    error?: string;
    prompt_sent?: boolean | null;
  }>("/api/payments/payhero/stk-push", body);
}

/** Asks the payment network what happened to a sale payment. */
export function posMpesaStatus(body: Record<string, unknown>) {
  return callServer<{ resolved_status?: string }>(
    "/api/payments/payhero/status",
    body,
  );
}

/** JMSURF PAY settlement is configured and verified by our server. */
export function jmsurfSettings(body: Record<string, unknown>) {
  return callServer<{ configured: boolean; destination_type?: string; business_number?: string; account_number?: string; account_name?: string }>(
    "/api/payments/jmsurf/settings", body,
  );
}

export function registerJmsurf(body: Record<string, unknown>) {
  return callServer<{ success?: boolean; configured?: boolean }>(
    "/api/payments/jmsurf/register", body,
  );
}

export function jmsurfMpesaPrompt(body: Record<string, unknown>) {
  return callServer<{ success?: boolean; checkout_request_id?: string }>(
    "/api/payments/jmsurf/push", body,
  );
}

export function jmsurfMpesaStatus(body: Record<string, unknown>) {
  return callServer<{ resolved_status?: string; mpesa_receipt?: string }>(
    "/api/payments/jmsurf/status", body,
  );
}

/** M-Pesa prompt through the shop's own Daraja keys (money to its own Paybill/Till). */
export function darajaMpesaPrompt(body: Record<string, unknown>) {
  return callServer<{ success?: boolean; checkout_request_id?: string; error?: string; prompt_sent?: boolean | null }>(
    "/api/payments/daraja/stk-push", body,
  );
}

export function darajaMpesaStatus(body: Record<string, unknown>) {
  return callServer<{ resolved_status?: string }>("/api/payments/daraja/status", body);
}

/** Opens a Paystack checkout for a pending sale, using the shop's own Paystack account. */
export function paystackInitialize(body: Record<string, unknown>) {
  return callServer<{ status?: boolean; data?: { authorization_url?: string; reference?: string } }>(
    "/api/payments/paystack/initialize", body,
  );
}

/** Confirms a Paystack payment with Paystack itself and completes the sale. */
export function paystackVerify(body: Record<string, unknown>) {
  return callServer<{ success?: boolean; status?: string }>("/api/payments/paystack/verify", body);
}

/** Bank list for the payout destination picker. */
export function listPayoutBanks() {
  return callWithFallback<{ banks?: Array<{ id?: string; name: string; paybill: string }> }>(
    "/api/payments/payhero/banks",
    "payhero-list-banks",
    {},
  );
}

/** Starts or checks a package (subscription) payment. */
export async function subscriptionPayment(body: Record<string, unknown>): Promise<CallResult<any>> {
  // The old subscription-purchase backend function is not deployed any more,
  // so falling back to it only replaced the real problem with a vague error.
  const result = await callServer<any>("/api/payments/subscription", body);
  if (result.unavailable) {
    return { data: null, error: "Could not reach the payment service. Check your connection and try again." };
  }
  return result;
}
