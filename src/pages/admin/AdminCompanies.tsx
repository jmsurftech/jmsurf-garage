import { useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Archive, Building2, Download, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PagedRows } from "@/components/Pager";
import { downloadCsv } from "@/lib/fetchAll";
import { EmptyState, ExportMenu, Field, Modal, MoreMenu, PageHeader, Panel, SearchBox, Segmented, TableWrap, Toolbar } from "@/components/kit";
import { companyName, companyStatus, endOf, useCompanies } from "@/components/admin/company/data";
import { CompanyStatusPill } from "@/components/admin/company/CompanyStatusPill";

const FILTERS = ["all", "active", "trial", "expired", "suspended"] as const;

/** The old Customers address (and its ?company= links) now opens Companies. */
export function CustomersMoved() {
  const [p] = useSearchParams();
  const id = p.get("company") || p.get("open");
  return <Navigate to={id ? `/admin/companies/${id}` : "/admin/companies"} replace />;
}

/** Admin → Companies: every company; a row opens the company's page, where everything about it is managed. */
export default function AdminCompanies() {
  const { companies, subs, plans, reload } = useCompanies();
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  const pool = useMemo(() => companies.filter((c) => (archived ? !!c.deleted_at : !c.deleted_at)), [companies, archived]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: pool.length };
    pool.forEach((c) => { const s = companyStatus(c, subs[c.id]); m[s] = (m[s] || 0) + 1; });
    return m;
  }, [pool, subs]);
  const q = search.trim().toLowerCase();
  const rows = pool.filter((c) => (archived || filter === "all" || companyStatus(c, subs[c.id]) === filter)
    && (!q || `${c.business_name} ${c.contact_name} ${c.contact_email} ${c.contact_phone}`.toLowerCase().includes(q)));

  return (
    <div className="space-y-3">
      <PageHeader title={archived ? "Archived companies" : "Companies"} icon={Building2} actions={<>
        <ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !rows.length, onSelect: () => downloadCsv(`garage-companies-${new Date().toISOString().slice(0, 10)}.csv`,
          ["Company", "Owner", "Email", "Phone", "Plan", "Status", "Cycle", "Runs to", "Joined"],
          rows.map((c) => { const s = subs[c.id]; const e = endOf(s); return [companyName(c), c.contact_name, c.contact_email, c.contact_phone, s?.plan_name, companyStatus(c, s), s?.billing_cycle, e ? e.slice(0, 10) : "", c.created_at.slice(0, 10)]; })) }]} />
        <MoreMenu items={[{ label: archived ? "Show companies in use" : "Archived companies", icon: Archive, onSelect: () => { setArchived(!archived); setFilter("all"); } }]} />
        {!archived && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add company</Button>}
      </>} />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, owner, email or phone" />
        {!archived && (
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: f === "all" ? "All" : f[0].toUpperCase() + f.slice(1), count: counts[f] || 0 }))} />
        )}
      </Toolbar>

      <Panel flush>
        {rows.length === 0 ? (
          <EmptyState icon={Building2} title={q ? "No companies match your search" : archived ? "No archived companies" : "No companies here"} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Company</th><th className="hidden md:table-cell">Owner</th><th>Plan</th><th>Status</th><th className="hidden lg:table-cell">Runs to</th><th className="hidden xl:table-cell">Joined</th></tr></thead>
              <tbody>
                <PagedRows rows={rows} colSpan={6}>{(page) => page.map((c) => {
                  const s = subs[c.id]; const end = endOf(s);
                  return (
                    <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/admin/companies/${c.id}`)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">{companyName(c).charAt(0).toUpperCase()}</span>
                          <span className="max-w-[240px] truncate font-semibold">{companyName(c)}</span>
                        </div>
                      </td>
                      <td className="hidden md:table-cell">
                        <p className="max-w-[220px] truncate">{c.contact_name || "—"}</p>
                        <p className="max-w-[220px] truncate text-xs text-muted-foreground">{c.contact_email || c.contact_phone || "—"}</p>
                      </td>
                      <td>{s?.plan_name || <span className="text-muted-foreground">—</span>}</td>
                      <td><CompanyStatusPill company={c} sub={s} /></td>
                      <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{end ? format(new Date(end), "d MMM yyyy") : "—"}</td>
                      <td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">{format(new Date(c.created_at), "d MMM yyyy")}</td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <AddCompanyModal open={adding} onClose={() => setAdding(false)} plans={plans} onDone={(id) => { setAdding(false); void reload(); if (id) nav(`/admin/companies/${id}`); }} />
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "company";
const withSuffix = (s: string) => `${s}-${Math.random().toString(36).slice(2, 6)}`;
const BLANK = { email: "", password: "", business_name: "", contact_name: "", contact_phone: "", business_email: "", business_phone: "", business_address: "", industry: "", plan_id: "", billing_cycle: "monthly" };

/** A new company: with a new owner login, or for a login that already exists (it joins their company menu). */
function AddCompanyModal({ open, onClose, plans, onDone }: { open: boolean; onClose: () => void; plans: any[]; onDone: (id?: string) => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK, v: string) => setF((x) => ({ ...x, [k]: v }));
  const plan = f.plan_id || plans[0]?.id || "";

  const create = async () => {
    setBusy(true);
    try {
      let id: string | undefined;
      // The address key is made from the name (companies sign in at app., so nobody types it).
      const tryCreate = async (slug: string) => {
        if (mode === "new") {
          const r = await supabase.functions.invoke("admin-create-tenant", { body: { ...f, plan_id: plan, store_slug: slug } });
          let msg = (r.data as any)?.error;
          if (!msg && r.error) { try { msg = (await new Response((r.error as any)?.context?.body).json())?.error; } catch { /* plain error */ } msg = msg || r.error.message; }
          if (msg) throw new Error(msg);
          return (r.data as any)?.tenant_id || (r.data as any)?.tenant?.id;
        }
        const { data, error } = await (supabase as any).rpc("create_company", { p_name: f.business_name.trim(), p_slug: slug, p_country: "KE", p_currency: "KES", p_owner_email: f.email.trim(), p_plan: plan || null });
        if (error) throw error;
        return data as string;
      };
      const base = slugify(f.business_name);
      try { id = await tryCreate(base); } catch (e: any) {
        if (!/taken|exists|duplicate|another address/i.test(String(e?.message))) throw e;
        id = await tryCreate(withSuffix(base));
      }
      if (mode === "existing" && id) {
        const details: any = {};
        (["contact_name", "contact_phone", "business_email", "business_phone", "business_address", "industry"] as const).forEach((k) => { if (f[k]) details[k] = f[k]; });
        if (Object.keys(details).length) await supabase.from("tenants").update(details).eq("id", id);
        if (f.billing_cycle !== "monthly") await supabase.from("subscriptions").update({ billing_cycle: f.billing_cycle } as any).eq("tenant_id", id);
      }
      toast({ title: "Company added", description: `${f.business_name.trim()} · on trial` });
      setF(BLANK);
      onDone(id);
    } catch (e: any) {
      toast({ title: "Could not add the company", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={Building2} title="Add company"
      description={mode === "new" ? "Creates the owner's login and the company." : "Adds a company to a login that already exists."}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={busy || !f.email.includes("@") || (mode === "new" && f.password.length < 8) || !f.business_name.trim()}>{busy ? "Adding…" : "Add company"}</Button>
      </>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Owner login</p>
          <Segmented value={mode} onChange={(v) => setMode(v as "new" | "existing")} options={[{ value: "new", label: "New owner" }, { value: "existing", label: "Existing login" }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" required><input className="fi" type="email" placeholder="Enter email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
            {mode === "new" && <Field label="Password" required hint="At least 8 characters"><input className="fi" type="password" placeholder="Enter password" value={f.password} onChange={(e) => set("password", e.target.value)} /></Field>}
          </div>
        </section>
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Business</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" required className="sm:col-span-2"><input className="fi" placeholder="Enter business name" value={f.business_name} onChange={(e) => set("business_name", e.target.value)} /></Field>
            <Field label="Contact person"><input className="fi" placeholder="Enter name" value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></Field>
            <Field label="Contact phone"><input className="fi" placeholder="Enter phone" value={f.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
            <Field label="Business email"><input className="fi" placeholder="Enter email" value={f.business_email} onChange={(e) => set("business_email", e.target.value)} /></Field>
            <Field label="Business phone"><input className="fi" placeholder="Enter phone" value={f.business_phone} onChange={(e) => set("business_phone", e.target.value)} /></Field>
            <Field label="Location" className="sm:col-span-2"><input className="fi" placeholder="Enter location" value={f.business_address} onChange={(e) => set("business_address", e.target.value)} /></Field>
          </div>
        </section>
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Plan</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan"><select className="fi" value={plan} onChange={(e) => set("plan_id", e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo</option>)}</select></Field>
            <Field label="Billing cycle"><select className="fi" value={f.billing_cycle} onChange={(e) => set("billing_cycle", e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></Field>
          </div>
        </section>
      </div>
    </Modal>
  );
}
