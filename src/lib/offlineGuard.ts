import { supabase } from "@/integrations/supabase/client";
import { getHostSlug } from "@/lib/host";
import { drainOutbox, outboxStatus, setOutboxGuard } from "@/lib/offlineOutbox";

/**
 * Changes saved offline belong to the company of this address. They are only sent while that company is
 * the account's active one (another tab may have switched it); otherwise they wait.
 */
export function installOutboxGuard() {
  setOutboxGuard(async () => {
    const slug = getHostSlug();
    if (!slug) return true;
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id;
    if (!uid) return false;
    const [{ data: prof }, { data: host }] = await Promise.all([
      (supabase as any).from("profiles").select("tenant_id").eq("user_id", uid).maybeSingle(),
      (supabase as any).from("tenants_public").select("id").ilike("slug", slug).maybeSingle(),
    ]);
    return !!host?.id && prof?.tenant_id === host.id;
  });
}

/** Before switching company: send what is waiting, or refuse so it does not end up in the other company. */
export async function ensureNoWaitingChanges() {
  if (!outboxStatus().pending) return;
  await drainOutbox().catch(() => undefined);
  const n = outboxStatus().pending;
  if (n) throw new Error(`${n} change${n === 1 ? "" : "s"} made offline ${n === 1 ? "is" : "are"} still waiting to be sent. Switch company once ${n === 1 ? "it is" : "they are"} sent (you need the internet).`);
}
