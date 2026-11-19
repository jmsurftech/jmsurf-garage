import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in user from this device's session. auth.getUser() asks the server every time, before the page's own
 * requests can even start. The database still checks the token on every request. Same shape as getUser().
 */
export async function getAuthUser() {
  const { data } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error: null };
}
