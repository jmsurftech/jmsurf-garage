import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Building2, CheckCircle, LogIn, Plus, UserPlus, Users, Wallet, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Field, Modal, MoreMenu, Panel, Pill, StatusPill } from "@/components/kit";
import { ROOT_HOST } from "@/lib/host";

const ROLES = [
  ["admin", "Administrator"], ["manager", "Manager"], ["finance", "Finance"], ["cashier", "Cashier"],
  ["sales_person", "Sales person"], ["stock_manager", "Stock manager"], ["customer_service", "Customer service"],
] as const;
const months = (cycle?: string) => (cycle === "quarterly" ? 3 : cycle === "annually" ? 12 : 1);
const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const errText = (e: any) => String(e?.message || e || "Something went wrong");

/**
 * Opens a company at its own address: as the platform owner (works even when its package has
 * ended) or, with userId, signed in as that person.
 * The tab is opened straight away so the browser does not block it as a pop-up.
 */
export async function openCompany(tenantId: string, userId?: string): Promise<string | null> {
  const tab = window.open("about:blank", "_blank");
  try {
    const { data } = await supabase.auth.getSession();
    const r = await fetch("/api/admin/company/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ tenant_id: tenantId, user_id: userId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error(j.error || "Could not open the company");
    if (tab) tab.location.href = j.url; else window.location.assign(j.url);
    return null;
  } catch (e) {
    tab?.close();
    return errText(e);
  }
}

type Person = { user_id: string; email: string | null; display_name: string | null; phone: string | null; role: string; is_owner: boolean; status: string; last_used_at: string | null; companies: number };

export function useCompanyPeople(tenantId?: string) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await (supabase as any).rpc("admin_company_people", { p_tenant: tenantId });
    setPeople((data || []) as Person[]);
    setLoading(false);
  };
  useEffect(() => { setPeople([]); void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);
  return { people, loading, reload };
}

/** Everyone who can open this company: add any existing login to it, or take access away. */
export function CompanyPeoplePanel({ tenant, people, loading, reload }: { tenant: any; people: Person[]; loading: boolean; reload: () => Promise<void> }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");
  const [busy, setBusy] = useState<string | null>(null);

  const add = async () => {
    setBusy("add");
    const { error } = await (supabase as any).rpc("add_company_member", { p_tenant: tenant.id, p_email: email.trim(), p_role: role });
    setBusy(null);
    if (error) return toast({ title: "Could not give access", description: error.message, variant: "destructive" });
    toast({ title: "Access given", description: `${email.trim()} can now open ${tenant.business_name} from their company menu.` });
    setEmail(""); setAdding(false); void reload();
  };
  const remove = async (p: Person) => {
    setBusy(p.user_id);
    const { error } = await (supabase as any).rpc("remove_company_member", { p_tenant: tenant.id, p_user: p.user_id });
    setBusy(null);
    if (error) return toast({ title: "Could not remove access", description: error.message, variant: "destructive" });
    toast({ title: "Access removed", description: p.email || p.display_name || "" });
    void reload();
  };
  const open = async (p: Person) => {
    setBusy("open" + p.user_id);
    const err = await openCompany(tenant.id, p.user_id);
    setBusy(null);
    if (err) toast({ title: "Could not open", description: err, variant: "destructive" });
  };

  return (
    <Panel flush title="People with access" icon={Users}
      description="They switch to this company from their company menu."
      actions={!tenant.deleted_at && <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}><UserPlus /> Give access</Button>}>
      {adding && (
        <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Field label="Login email" hint="Must already have a login."><input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter login email" autoFocus /></Field>
          <Field label="Role"><select className="fi" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Button onClick={add} disabled={busy === "add" || !email.includes("@")}>{busy === "add" ? "Adding…" : "Give access"}</Button>
        </div>
      )}
      {people.length === 0 ? (
        <EmptyState icon={Users} title={loading ? "Loading…" : "Nobody yet"} />
      ) : (
        <ul className="divide-y divide-border">
          {people.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{String(p.display_name || p.email || "?").charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="truncate">{p.display_name || p.email || "Unnamed"}</span>
                  {p.is_owner && <Pill tone="primary">Owner</Pill>}
                  {p.status !== "active" && <Pill tone="warning">No access</Pill>}
                  {p.companies > 1 && <Pill tone="info">{p.companies} companies</Pill>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{p.email || "No email"} · {ROLES.find(([v]) => v === p.role)?.[1] || p.role}{p.last_used_at ? ` · last here ${format(new Date(p.last_used_at), "d MMM yyyy")}` : ""}</p>
              </div>
              {p.status === "active" && !tenant.deleted_at && (
                <Button size="sm" variant="ghost" title={`Open as ${p.display_name || p.email}`} onClick={() => open(p)} disabled={busy === "open" + p.user_id}><LogIn /> Open</Button>
              )}
              {!p.is_owner && p.status === "active" && (
                <button className="icon-btn" title="Remove access" onClick={() => remove(p)} disabled={busy === p.user_id}><X className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The owner's other companies, adding one more for the same owner, and paying for several at once. */
export function OwnerCompaniesPanel({ tenant, group, subs, onSelect, onAdd, onPay }: {
  tenant: any; group: any[]; subs: Record<string, any>; onSelect: (t: any) => void; onAdd: () => void; onPay: () => void;
}) {
  return (
    <Panel flush title="Owner's companies" icon={Building2}
      description="Each has its own package and expiry; one payment can cover several."
      actions={!tenant.deleted_at && <div className="flex gap-1.5">
        <Button size="sm" onClick={onAdd}><Plus /> Add</Button>
        <MoreMenu iconOnly items={[{ label: "Pay for several", icon: Wallet, onSelect: onPay, hidden: group.length <= 1 }]} />
      </div>}>
      <ul className="divide-y divide-border">
        {group.map((t) => {
          const s = subs[t.id];
          const end = s?.current_period_end || s?.trial_ends_at;
          return (
            <li key={t.id} className={`flex items-center gap-3 px-4 py-3 ${t.id === tenant.id ? "bg-primary/5" : "cursor-pointer hover:bg-muted/40"}`} onClick={() => t.id !== tenant.id && onSelect(t)}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{String(t.business_name || "?").charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.business_name}{t.id === tenant.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(this one)</span>}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{t.slug ? `${t.slug}.${ROOT_HOST}` : "No address"}</p>
              </div>
              <div className="hidden text-right text-xs sm:block">
                <p>{s?.plan_name || "—"}{s ? ` · ${ksh(Number(s.price || 0) * months(s.billing_cycle))}/${s.billing_cycle === "annually" ? "yr" : s.billing_cycle === "quarterly" ? "qtr" : "mo"}` : ""}</p>
                <p className="text-muted-foreground">{end ? `until ${format(new Date(end), "d MMM yyyy")}` : "—"}</p>
              </div>
              <StatusPill status={t.deleted_at ? "archived" : s?.status || "none"} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** A new company owned by the same login (it shows in the owner's company menu straight away). */
export function AddOwnerCompanyModal({ open, onClose, source, ownerEmail, plans, onDone }: {
  open: boolean; onClose: () => void; source: any; ownerEmail: string | null; plans: any[]; onDone: (tenantId: string) => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", slug: "", plan: "", cycle: "monthly", start: "trial", until: "", copy: true });
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ name: "", slug: "", plan: plans[0]?.id || "", cycle: "monthly", start: "trial", until: "", copy: true });
    setSlugTouched(false);
  }, [open, plans]);

  const create = async () => {
    if (!ownerEmail) return toast({ title: "This company's owner has no login email", variant: "destructive" });
    setBusy(true);
    try {
      const { data: id, error } = await (supabase as any).rpc("create_company", {
        p_name: f.name.trim(), p_slug: f.slug, p_country: "KE", p_currency: "KES", p_owner_email: ownerEmail, p_plan: f.plan || null,
      });
      if (error) throw error;
      // The owner's contact details, as on the company it was added from.
      if (f.copy) {
        const { error: e2 } = await supabase.from("tenants").update({
          contact_name: source.contact_name, contact_email: source.contact_email, contact_phone: source.contact_phone,
          business_email: source.business_email, business_phone: source.business_phone, business_address: source.business_address, industry: source.industry,
        } as any).eq("id", id);
        if (e2) throw e2;
      }
      // Its own package and expiry: on trial (the package's trial days) or paid up to a date.
      const plan = plans.find((p) => p.id === f.plan);
      const patch: any = { billing_cycle: f.cycle };
      if (f.start === "active") {
        if (!f.until) throw new Error("Choose the date it is paid until");
        patch.status = "active"; patch.trial_ends_at = null; patch.current_period_end = new Date(`${f.until}T23:59:59`).toISOString();
      }
      if (plan) Object.assign(patch, { plan_id: plan.id, plan_name: plan.name, price: Number(plan.price_monthly || 0), max_users: plan.max_users, max_locations: plan.max_locations });
      const { error: e3 } = await supabase.from("subscriptions").update(patch).eq("tenant_id", id);
      if (e3) throw e3;
      toast({ title: "Company added", description: `${f.name.trim()} · ${f.slug}.${ROOT_HOST} · owner ${ownerEmail}` });
      onDone(String(id));
    } catch (e) {
      toast({ title: "Could not add the company", description: errText(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={Plus} title="Add company"
      description={ownerEmail ? `Owner: ${ownerEmail}` : "This company's owner has no login email."}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={busy || !ownerEmail || !f.name.trim() || f.slug.length < 3 || (f.start === "active" && !f.until)}>{busy ? "Adding…" : "Add company"}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Business name" required>
          <input className="fi" placeholder="Enter business name" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />
        </Field>
        <Field label="Company address" required hint={f.slug ? `${f.slug}.${ROOT_HOST}` : "Letters, numbers and dashes"}>
          <input className="fi" placeholder="Enter address" value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Package">
            <select className="fi" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo</option>)}
            </select>
          </Field>
          <Field label="Billing cycle">
            <select className="fi" value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })}>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
            </select>
          </Field>
          <Field label="Start">
            <select className="fi" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })}>
              <option value="trial">Free trial</option><option value="active">Active, paid until a date</option>
            </select>
          </Field>
          {f.start === "active" && (
            <Field label="Paid until" required><input className="fi" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.copy} onChange={(e) => setF({ ...f, copy: e.target.checked })} />
          Use the owner, phone, email and address of {source?.business_name}
        </label>
      </div>
    </Modal>
  );
}

/** One M-Pesa code or bank reference for several companies of the same owner. */
export function GroupPaymentModal({ open, onClose, group, subs, initial, onDone }: {
  open: boolean; onClose: () => void; group: any[]; subs: Record<string, any>; initial?: string[]; onDone: () => void;
}) {
  const { toast } = useToast();
  const payable = useMemo(() => group.filter((t) => !t.deleted_at && subs[t.id]), [group, subs]);
  const [picked, setPicked] = useState<string[]>([]);
  const [ref, setRef] = useState("");
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPicked(initial?.length ? initial.filter((id) => payable.some((t) => t.id === id)) : payable.map((t) => t.id));
    setRef(""); setTotal("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueOf = (id: string) => Number(subs[id]?.price || 0) * months(subs[id]?.billing_cycle);
  const due = picked.reduce((s, id) => s + dueOf(id), 0);
  const nextEnd = (id: string) => {
    const s = subs[id]; const base = s?.status === "active" && s?.current_period_end && new Date(s.current_period_end) > new Date() ? new Date(s.current_period_end) : new Date();
    base.setMonth(base.getMonth() + months(s?.billing_cycle)); return base;
  };

  const save = async () => {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("admin_record_payment", {
      p_tenants: picked, p_reference: ref.trim(), p_total: total.trim() === "" ? null : Number(total), p_gateway: "manual",
    });
    setBusy(false);
    if (error) return toast({ title: "Could not record the payment", description: error.message, variant: "destructive" });
    toast({ title: "Payment recorded", description: `${(data || []).length} compan${(data || []).length === 1 ? "y" : "ies"} extended · ${ref.trim().toUpperCase()}` });
    onDone();
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={Wallet} title="Pay for several"
      description="Each ticked company gets one more period, from its end date or today."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || !picked.length || !ref.trim()}><CheckCircle /> {busy ? "Recording…" : "Record payment"}</Button>
      </>}>
      <div className="space-y-4">
        <ul className="divide-y divide-border rounded-xl border border-border">
          {payable.map((t) => {
            const on = picked.includes(t.id); const s = subs[t.id];
            return (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== t.id) : [...picked, t.id])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.business_name}</span>
                    <span className="block text-xs text-muted-foreground">{s.plan_name} · {s.billing_cycle || "monthly"}{on ? ` · new end ${format(nextEnd(t.id), "d MMM yyyy")}` : ""}</span>
                  </span>
                  <span className="text-sm tabular-nums">{ksh(dueOf(t.id))}</span>
                </label>
              </li>
            );
          })}
          {payable.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">None of these companies has a package yet.</li>}
        </ul>
        <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
          <span className="text-muted-foreground">Due for {picked.length} compan{picked.length === 1 ? "y" : "ies"}</span>
          <span className="font-bold text-primary">{ksh(due)}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="M-Pesa code or reference" required><input className="fi uppercase" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Enter code" /></Field>
          <Field label="Amount received" hint="Empty = full amount; otherwise shared by what each owes.">
            <input className="fi" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(Math.round(due))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
