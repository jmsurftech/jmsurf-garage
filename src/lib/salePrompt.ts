import { supabase } from "@/integrations/supabase/client";
import {
  posMpesaPrompt, posMpesaStatus, jmsurfMpesaPrompt, jmsurfMpesaStatus, darajaMpesaPrompt, darajaMpesaStatus,
} from "@/lib/serverPayments";

/**
 * M-Pesa prompt for a sale that is already saved as pending, outside the till
 * (used by exchanges). The shop's saved gateway picks the route, like the till.
 */
export type PromptShop = { provider?: string | null; tenantId?: string | null; tenantSlug?: string | null; accountRef?: string | null };

export async function sendSalePrompt(shop: PromptShop, saleId: string, phone: string, amount: number) {
  const ref = (shop.accountRef || shop.tenantSlug || "POS").slice(0, 12);
  const r: any = shop.provider === "jmsurf"
    ? await jmsurfMpesaPrompt({ tenant_id: shop.tenantId, pos_transaction_id: saleId, phone })
    : shop.provider === "daraja"
      ? await darajaMpesaPrompt({ phone, amount, tenant_slug: shop.tenantSlug, tenant_id: shop.tenantId, transaction_id: saleId, pos_transaction_id: saleId, account_ref: ref })
      : await posMpesaPrompt({ phone, amount, tenant_id: shop.tenantId, tenant_slug: shop.tenantSlug, pos_transaction_id: saleId, account_ref: ref, prompt_label: "jmsurf" });
  const data = r?.data ?? r;
  const ok = !r?.error && data?.success === true && !!(data?.checkout_request_id || data?.CheckoutRequestID);
  return { ok, error: ok ? "" : String(r?.error || data?.error || "The M-Pesa prompt was not sent") };
}

/** The sale's status after asking the payment network. */
export async function checkSalePrompt(shop: PromptShop, saleId: string): Promise<string> {
  try {
    if (shop.provider === "jmsurf") await jmsurfMpesaStatus({ pos_transaction_id: saleId, tenant_id: shop.tenantId });
    else if (shop.provider === "daraja") await darajaMpesaStatus({ pos_transaction_id: saleId });
    else await posMpesaStatus({ pos_transaction_id: saleId });
  } catch { /* the saved sale below is the truth */ }
  const { data } = await (supabase as any).from("transactions").select("status").eq("id", saleId).maybeSingle();
  return String(data?.status || "pending");
}
