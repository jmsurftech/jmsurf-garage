/** Admin → Users → Access: the companies a login can open, and its linked logins (other emails of the same person). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Link2, Plus, Search, Trash2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/books/confirm";
import { toast } from "sonner";

const sb = supabase as any;
const ROLES = ["admin", "manager", "cashier", "stock_manager", "sales_person", "rider", "packaging"];

export default function AdminUserAccess({ user, tenants, onClose }: { user: { user_id: string; email: string; display_name: string | null }; tenants: { id: string; business_name: string }[]; onClose: () => void }) {
  const { data, refetch } = useQuery({ queryKey: ["admin-access", user.user_id], queryFn: async () => { const { data, error } = await sb.rpc("admin_user_access", { p_user: user.user_id }); if (error) throw error; return data as { companies: any[]; links: any[] }; } });
  const [add, setAdd] = useState({ tenant: "", role: "manager" });
  const [q, setQ] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const run = async (fn: string, args: any, ok: string) => { const { error } = await sb.rpc(fn, args); if (error) toast.error(error.message); else { toast.success(ok); refetch(); } };
  const companies = data?.companies || [];
  const free = tenants.filter((t) => !companies.some((c) => c.tenant_id === t.id));
  const search = async () => { if (q.trim().length < 3) return; const { data } = await sb.rpc("admin_find_login", { p_email: q }); setFound((data || []).filter((x: any) => x.user_id !== user.user_id)); };
  return (
    <Modal open onClose={onClose} size="lg" title={`Access · ${user.display_name || user.email}`} description={user.email} icon={KeyRound}>
      <div className="space-y-6">
        <section>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-primary" /> Companies this login can open</p>
          <div className="space-y-2">
            {companies.map((c) => (
              <div key={c.tenant_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><b className="block truncate">{c.business_name}</b><span className="text-xs text-muted-foreground">{c.slug}.garage.jmsurf.co.ke</span></span>
                {c.is_owner && <Pill tone="success">Owner</Pill>}
                <select className="fi h-8 w-36 text-xs" value={c.role} disabled={c.is_owner} onChange={(e) => void run("admin_set_company_access", { p_user: user.user_id, p_tenant: c.tenant_id, p_role: e.target.value }, "Role changed")}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                </select>
                {!c.is_owner && <button className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10" aria-label="Remove access" onClick={async () => { if (await confirmAction({ title: `Remove access to ${c.business_name}?`, confirmLabel: "Remove", danger: true })) void run("admin_set_company_access", { p_user: user.user_id, p_tenant: c.tenant_id, p_role: null }, "Access removed"); }}><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
            {!companies.length && <p className="text-sm text-muted-foreground">No companies yet.</p>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <select className="fi h-9 flex-1" value={add.tenant} onChange={(e) => setAdd({ ...add, tenant: e.target.value })}><option value="">Add a company…</option>{free.map((t) => <option key={t.id} value={t.id}>{t.business_name}</option>)}</select>
            <select className="fi h-9 w-36" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</select>
            <Button size="sm" disabled={!add.tenant} onClick={() => { void run("admin_set_company_access", { p_user: user.user_id, p_tenant: add.tenant, p_role: add.role }, "Access given"); setAdd({ ...add, tenant: "" }); }}><Plus /> Give access</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">They switch between these companies from the company menu at the top, with the same login.</p>
        </section>
        <section>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" /> Linked logins (other emails of the same person)</p>
          <div className="space-y-2">
            {(data?.links || []).map((l: any) => (
              <div key={l.user_id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <Link2 className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{l.email}</span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void run("admin_link_logins", { p_a: user.user_id, p_b: l.user_id, p_link: false }, "Unlinked")}>Unlink</Button>
              </div>
            ))}
            {!(data?.links || []).length && <p className="text-sm text-muted-foreground">None. Linked logins see each other's companies in the company menu and switch without signing in again.</p>}
          </div>
          <Field label="Link another login" className="mt-3">
            <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} /></div><Button variant="outline" onClick={() => void search()}>Find</Button></div>
          </Field>
          {found.map((x) => (
            <div key={x.user_id} className="mt-2 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{x.email}{x.display_name ? ` · ${x.display_name}` : ""}</span>
              <Button size="sm" onClick={() => { void run("admin_link_logins", { p_a: user.user_id, p_b: x.user_id, p_link: true }, "Logins linked"); setFound([]); setQ(""); }}><Link2 /> Link</Button>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  );
}
