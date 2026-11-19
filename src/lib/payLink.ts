import { supabase } from "@/integrations/supabase/client";

/** Public "Pay now" page for an invoice (no login). */
export const payLinkUrl = (token: string) => `${window.location.origin}/pay/${token}`;

/** The invoice's payment link: the live one, or a new one (not for void invoices). */
export async function getPayLink(invoiceId: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc("invoice_pay_link", { p_invoice: invoiceId });
  if (error) throw error;
  if (!data) throw new Error("No payment link was made");
  return payLinkUrl(String(data));
}

/** Switches the invoice's payment link off; the next copy makes a new one. */
export async function revokePayLink(invoiceId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc("invoice_pay_link_revoke", { p_invoice: invoiceId });
  if (error) throw error;
  return Number(data || 0);
}
