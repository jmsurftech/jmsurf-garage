import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Modal, Field, Pill } from "@/components/kit";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { listMyCompanies, switchCompany } from "@/lib/companySwitch";
import { ROOT_HOST, isReservedSubdomain } from "@/lib/host";
import { CURRENCIES } from "@/lib/currencies";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const ROLES = [
  { value: "admin", label: "Administrator" },
  { value: "manager", label: "Manager" },
  { value: "sales_person", label: "Salesperson" },
  { value: "cashier", label: "Cashier" },
  { value: "stock_manager", label: "Stock manager" },
];

/** My companies: switch, add another company, and give people access to this one. */
export default function Companies() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const { role, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "1");
  const [inviting, setInviting] = useState(false);
  const { data: companies = [] } = useQuery({ queryKey: ["my-companies", user?.id], enabled: !!user?.id, queryFn: listMyCompanies });
  const { data: members = [] } = useQuery({
    queryKey: ["company-members", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("tenant_members").select("id, user_id, role, is_owner, status, last_used_at").eq("tenant_id", tenant!.id).eq("status", "active");
      const ids = (data || []).map((m: any) => m.user_id);
      const { data: profs } = ids.length ? await (supabase as any).from("profiles").select("user_id, display_name, phone").in("user_id", ids) : { data: [] };
      return (data || []).map((m: any) => ({ ...m, name: (profs || []).find((p: any) => p.user_id === m.user_id)?.display_name || "User" }));
    },
  });
  useEffect(() => { if (params.get("new") === "1") setAdding(true); }, [params]);
  const isAdmin = role === "admin" || role === "super_admin";

  const remove = async (m: any) => {
    if (!(await confirmAction({ title: `Remove ${m.name} from ${tenant?.business_name}?`, message: "They keep their login and any other companies.", confirmLabel: "Remove", danger: true }))) return;
    const { error } = await (supabase as any).rpc("remove_company_member", { p_tenant: tenant!.id, p_user: m.user_id });
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["company-members"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="My companies" icon={Building2}
        description="Run several companies from one login. Each has its own address, books and users; switch in one click."
        actions={<button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Add company</button>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <PagedRows rows={companies} gridSpan>{(pageRows) => pageRows.map((c) => (
          <div key={c.tenant_id} className={`rounded-2xl border bg-card p-4 ${c.tenant_id === tenant?.id ? "border-primary/40 ring-2 ring-primary/10" : "border-border"}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 font-bold text-primary">
                {c.logo_url ? <img src={c.logo_url} alt="" className="h-full w-full object-contain" /> : c.business_name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display font-bold">{c.business_name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.slug}.{ROOT_HOST}</p>
                <div className="mt-1.5 flex flex-wrap gap-1"><Pill tone="primary">{ROLES.find((r) => r.value === c.role)?.label || c.role}</Pill>{c.is_owner && <Pill tone="success">Owner</Pill>}{c.tenant_id === tenant?.id && <Pill>Open now</Pill>}</div>
              </div>
            </div>
            {c.tenant_id !== tenant?.id && (
              <button onClick={() => switchCompany(c.tenant_id).catch((e) => toast.error(friendlyError(e)))} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-sm font-semibold hover:bg-muted">
                Open <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}</PagedRows>
      </div>

      <Panel title={`People in ${tenant?.business_name || "this company"}`} icon={Users} flush
        description="Anyone with a JMSURF Garage login can be given access; they switch to this company from the company menu."
        actions={isAdmin && <button onClick={() => setInviting(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"><UserPlus className="h-4 w-4" /> Add person</button>}>
        <table className="dt">
          <thead><tr><th>Name</th><th>Role</th><th>Last opened</th><th /></tr></thead>
          <tbody>
            <PagedRows rows={members} colSpan={4}>{(pageRows) => pageRows.map((m: any) => (
              <tr key={m.id}>
                <td data-label="Name" className="font-medium">{m.name} {m.is_owner && <Pill tone="success" className="ml-1">Owner</Pill>}</td>
                <td data-label="Role">{ROLES.find((r) => r.value === m.role)?.label || m.role}</td>
                <td data-label="Last opened" className="text-muted-foreground">{m.last_used_at ? new Date(m.last_used_at).toLocaleDateString("en-KE") : "—"}</td>
                <td className="text-right">{isAdmin && !m.is_owner && <button onClick={() => void remove(m)} className="icon-btn-danger" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}</td>
              </tr>
            ))}</PagedRows>
          </tbody>
        </table>
      </Panel>

      <AddCompany open={adding} onClose={() => { setAdding(false); if (params.get("new")) { params.delete("new"); setParams(params, { replace: true }); } }} />
      <AddPerson open={inviting} onClose={() => setInviting(false)} tenantId={tenant?.id} />
    </div>
  );
}

function AddCompany({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [currency, setCurrency] = useState("KES");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const create = async () => {
    if (name.trim().length < 2 || slug.length < 3) return toast.error("Enter the company name and an address of at least 3 letters.");
    if (isReservedSubdomain(slug, true)) return toast.error("That address is reserved. Choose another.");
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("create_company", { p_name: name.trim(), p_slug: slug, p_currency: currency });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["my-companies"] });
      toast.success(`${name} is ready at ${slug}.${ROOT_HOST}`, { action: { label: "Open", onClick: () => void switchCompany(data) } });
      onClose(); setName(""); setSlug(""); setTouched(false);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a company" icon={Building2} description="It gets its own address, books, users and subscription. You are its owner."
      footer={<><button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={create} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Creating…" : "Create company"}</button></>}>
      <div className="space-y-4">
        <Field label="Company name" required><input className="fi" value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} /></Field>
        <Field label="Address" hint={`${slug || "yourcompany"}.${ROOT_HOST}`} required>
          <input className="fi" value={slug} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} />
        </Field>
        <Field label="Currency">
          <select className="fi" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c: any) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function AddPerson({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId?: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const add = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("add_company_member", { p_tenant: tenantId, p_email: email.trim(), p_role: role });
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["company-members"] });
      toast.success("Access given", { description: "They can now switch to this company from their company menu." });
      setEmail(""); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a person" icon={UserPlus} description="For someone who already has a JMSURF Garage login. New staff go under System → Staff."
      footer={<><button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button disabled={busy || !email.includes("@")} onClick={add} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Give access</button></>}>
      <div className="space-y-4">
        <Field label="Their login email" required><input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Role"><select className="fi" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
