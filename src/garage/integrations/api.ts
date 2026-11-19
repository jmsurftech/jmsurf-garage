import { supabase } from "@/integrations/supabase/client";

/**
 * Calls the integrations server area (/api/garage/i/*, garage-integrations.js) with the
 * signed-in session. Always resolves: errors come back as { ok: false, error }.
 */
export async function garageI<T = any>(path: string, body: Record<string, unknown> = {}): Promise<T & { ok?: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const res = await fetch(`/api/garage/i/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: `Server replied ${res.status}` }));
    if (!res.ok && json && json.ok === undefined) json.ok = false;
    return json;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach the server" } as any;
  }
}

export type ConnectionStatus = {
  mpesa: {
    provider: string;
    jmsurf: { connected: boolean; destination_type?: string; business_number?: string; account_number?: string; account_name?: string };
    daraja: {
      connected: boolean; keys_saved: boolean; type: "paybill" | "till"; shortcode: string | null; till_number: string | null;
      environment: "live" | "sandbox"; account_reference: string | null; c2b_registered_at: string | null; c2b_note: string | null;
      c2b_validation: "all" | "strict"; c2b_urls: { confirm: string; validate: string } | null; b2c_enabled: boolean;
    };
    unmatched_payments: number;
  };
  sms: { jmsurf_key_saved: boolean; platform_available: boolean; mode: string; sender_id: string | null };
  whatsapp: {
    cloud: {
      connected: boolean; phone_number_id: string | null; waba_id: string | null; display_phone: string | null;
      token_saved: boolean; app_secret_saved: boolean; default_template: string | null; template_lang: string;
      webhook_url: string; verify_token: string | null;
    };
    apiwap_mode: string;
  };
  etims: { connected: boolean; environment?: string; tin?: string; branch?: string; auto_sign?: boolean; initialised_at?: string | null };
  callcentre: {
    available: boolean; linked: boolean; linked_at: string | null; missed_sms: boolean; missed_text: string | null;
    lookup_key_set: boolean; open_callbacks: number; lookup_url: string; missed_url: string;
  };
};

/** Opens JMSURF CALL CENTRE already signed in (mirrors the company and this user first). */
export async function openCallCentre(next = "/") {
  const r = await garageI<{ url?: string }>("callcentre/open", { next });
  if (r.url) window.open(r.url, "_blank", "noopener");
  return r;
}

/** M-Pesa prompt for an invoice through the company's gateway (JMSURF PAY or its own Daraja). */
export const requestInvoiceMpesa = (invoiceId: string, phone: string, amount?: number) =>
  garageI<{ success?: boolean; request_id?: string }>("pay/invoice", { invoice_id: invoiceId, phone, amount });
export const invoiceMpesaStatus = (requestId: string) =>
  garageI<{ status?: string; mpesa_receipt?: string | null }>("pay/status", { request_id: requestId });

/** Sends a WhatsApp message (Cloud API number when connected, else APIWAP) and keeps it in the inbox. */
export const sendWhatsApp = (phone: string, text: string) => garageI("whatsapp/send", { phone, text });
