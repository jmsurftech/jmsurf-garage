import { supabase } from "@/integrations/supabase/client";

export const WRONG_SHOP_MESSAGE = "Invalid sign-in: this account does not belong to this shop. Sign in at your own shop's address.";

/**
 * True when the signed-in account may use this shop: its own staff, or the
 * platform owner. Every other account is refused, even with a valid password.
 */
export async function belongsToShop(userId: string, tenantId: string): Promise<boolean> {
  const sb: any = supabase;
  const [{ data: roles }, { data: profile }] = await Promise.all([
    sb.from("user_roles").select("role").eq("user_id", userId),
    sb.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle(),
  ]);
  if ((roles || []).some((r: any) => r.role === "super_admin")) return true;
  return !!profile?.tenant_id && profile.tenant_id === tenantId;
}
