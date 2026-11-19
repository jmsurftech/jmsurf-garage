import { useMemo, useState } from "react";
import { useSelection, BulkBar, TickAllCell, TickCell, downloadCsv } from "@/components/Bulk";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Pencil, Trash2, Contact, Search, Building2, User, Magnet, Phone, Mail, TrendingUp, MessagesSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const CHANNELS = [["sms", "SMS"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["social", "Social media"], ["event", "Event / in-store"], ["referral", "Referral"], ["radio", "Radio / print"], ["other", "Other"]] as const;
const ST: Record<string, string> = { planned: "bg-muted text-muted-foreground", active: "bg-success/10 text-success", completed: "bg-info/10 text-info", cancelled: "bg-destructive/10 text-destructive" };

/** CRM → Campaigns: budgets, channels and the leads and won revenue each one brought. */
export function Campaigns() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<any>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["crm-campaigns", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const [c, l] = await Promise.all([
        sb.from("crm_campaigns").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
        sb.from("crm_leads").select("campaign,won_status,expected_revenue,type").eq("tenant_id", tenantId).not("campaign", "is", null),
      ]);
      return { camps: (c.data || []) as any[], leads: (l.data || []) as any[] };
    },
  });
  const stats = (name: string) => {
    const ls = (data?.leads || []).filter((l) => (l.campaign || "").toLowerCase() === name.toLowerCase());
    const won = ls.filter((l) => l.won_status === "won");
    return { leads: ls.length, won: won.length, revenue: won.reduce((a, l) => a + Number(l.expected_revenue || 0), 0) };
  };
  const save = async () => {
    if (!edit.name?.trim()) return toast({ title: "Name the campaign", variant: "destructive" });
    const payload = { ...edit, tenant_id: tenantId, name: edit.name.trim(), budget: Number(edit.budget) || 0, actual_cost: Number(edit.actual_cost) || 0, expected_revenue: Number(edit.expected_revenue) || 0, start_date: edit.start_date || null, end_date: edit.end_date || null, updated_at: new Date().toISOString() };
    const r = edit.id ? await sb.from("crm_campaigns").update(payload).eq("id", edit.id) : await sb.from("crm_campaigns").insert(payload);
    if (r.error) return toast({ title: "Not saved", description: r.error.message, variant: "destructive" });
    setEdit(null); qc.invalidateQueries({ queryKey: ["crm-campaigns"] });
  };
  const del = async (c: any) => { if (await confirmAction({ title: `Delete ${c.name}?`, danger: true, confirmLabel: "Delete" })) { await sb.from("crm_campaigns").delete().eq("id", c.id); qc.invalidateQueries({ queryKey: ["crm-campaigns"] }); } };
  if (isLoading) return <OrbLoader label="Loading campaigns…" />;
  const camps = data?.camps || [];
  const totals = camps.reduce((a, c) => { const s = stats(c.name); return { cost: a.cost + Number(c.actual_cost || 0), leads: a.leads + s.leads, revenue: a.revenue + s.revenue }; }, { cost: 0, leads: 0, revenue: 0 });
  return (
    <div className="space-y-5">
      <PageHeader title="Campaigns" icon={Megaphone} description="Plan promotions and see which ones bring leads and sales. Tag leads with the campaign name."
        actions={<><Button variant="outline" asChild><Link to="/marketing/sms"><MessagesSquare /> Send an SMS campaign</Link></Button><Button onClick={() => setEdit({ name: "", channel: "sms", status: "planned", budget: "", actual_cost: "", expected_revenue: "", start_date: "", end_date: "", target_audience: "", description: "" })}><Plus /> New campaign</Button></>} />
      <StatGrid>
        <StatTile label="Campaigns" value={camps.length} icon={Megaphone} tone="primary" hint={`${camps.filter((c) => c.status === "active").length} running`} />
        <StatTile label="Spent" value={formatKES(totals.cost)} icon={TrendingUp} tone="muted" />
        <StatTile label="Leads brought in" value={totals.leads} icon={Magnet} tone="info" />
        <StatTile label="Won revenue" value={formatKES(totals.revenue)} icon={TrendingUp} tone="success" hint={totals.cost ? `ROI ${(((totals.revenue - totals.cost) / totals.cost) * 100).toFixed(0)}%` : undefined} />
      </StatGrid>
      <Panel flush>
        {camps.length === 0 ? <EmptyState icon={Megaphone} title="No campaigns yet" description="Create one, then pick it as the campaign on leads it brings in." /> : (
          <TableWrap><table className="dt">
            <thead><tr><th>Campaign</th><th className="hidden sm:table-cell">Channel</th><th className="hidden md:table-cell">Dates</th><th>Status</th><th className="num">Cost</th><th className="num">Leads</th><th className="num">Won</th><th /></tr></thead>
            <tbody><PagedRows rows={camps} colSpan={8}>{(pageRows) => pageRows.map((c) => { const s = stats(c.name); return (
              <tr key={c.id}><td className="font-medium">{c.name}</td><td className="hidden sm:table-cell">{CHANNELS.find(([v]) => v === c.channel)?.[1] || c.channel}</td>
                <td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{c.start_date ? fmtDate(c.start_date) : "—"} – {c.end_date ? fmtDate(c.end_date) : "—"}</td>
                <td><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", ST[c.status])}>{c.status}</span></td>
                <td className="num">{formatKES(Number(c.actual_cost || 0))}</td><td className="num">{s.leads}</td><td className="num">{formatKES(s.revenue)}</td>
                <td><span className="flex gap-1"><button className="icon-btn" onClick={() => setEdit(c)} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del(c)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></span></td></tr>
            ); })}</PagedRows></tbody>
          </table></TableWrap>
        )}
      </Panel>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit campaign" : "New campaign"} icon={Megaphone} size="lg" footer={<Button onClick={save}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input className="fi" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. December promotion" /></Field>
            <Field label="Channel"><select className="fi" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Status"><select className="fi" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.keys(ST).map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Starts"><input className="fi" type="date" value={edit.start_date || ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></Field>
            <Field label="Ends"><input className="fi" type="date" value={edit.end_date || ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></Field>
            <Field label="Budget"><input className="fi" type="number" value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: e.target.value })} /></Field>
            <Field label="Actual cost"><input className="fi" type="number" value={edit.actual_cost} onChange={(e) => setEdit({ ...edit, actual_cost: e.target.value })} /></Field>
            <Field label="Expected revenue"><input className="fi" type="number" value={edit.expected_revenue} onChange={(e) => setEdit({ ...edit, expected_revenue: e.target.value })} /></Field>
            <Field label="Target audience"><input className="fi" value={edit.target_audience || ""} onChange={(e) => setEdit({ ...edit, target_audience: e.target.value })} placeholder="SMEs in Westlands" /></Field>
            <Field label="Description" className="sm:col-span-2"><textarea className="fi" value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** CRM → Contacts & Accounts: every person and business across customers and leads in one list. */
export function Contacts({ preset = "all" }: { preset?: "all" | "business" | "person" | "lead" }) {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "business" | "person" | "lead">(preset);
  const { data, isLoading } = useQuery({
    queryKey: ["crm-contacts", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const [c, l, s] = await Promise.all([
        sb.from("customers").select("id,name,phone,email,company_name,customer_type,created_at,approval_status").eq("tenant_id", tenantId).order("name").limit(5000),
        sb.from("crm_leads").select("id,name,contact_name,partner_name,phone,mobile,email,customer_id,type,won_status,expected_revenue").eq("tenant_id", tenantId).eq("active", true).limit(5000),
        sb.from("customer_summary").select("customer_id,total_purchases,receivables").eq("tenant_id", tenantId).limit(5000),
      ]);
      return { customers: (c.data || []) as any[], leads: (l.data || []) as any[], sums: new Map(((s.data || []) as any[]).map((x) => [x.customer_id, x])) };
    },
  });
  const rows = useMemo(() => {
    if (!data) return [];
    const out = [
      ...data.customers.map((c) => ({ key: c.id, type: c.customer_type === "business" || c.company_name ? "business" : "person", name: c.company_name || c.name, contact: c.company_name ? c.name : "", phone: c.phone, email: c.email, to: `/customers/${c.id}`, value: Number(data.sums.get(c.id)?.total_purchases || 0), owes: Number(data.sums.get(c.id)?.receivables || 0), deals: data.leads.filter((l) => l.customer_id === c.id).length, note: c.approval_status !== "approved" ? "Awaiting approval" : "" })),
      ...data.leads.filter((l) => !l.customer_id).map((l) => ({ key: l.id, type: "lead", name: l.partner_name || l.contact_name || l.name, contact: l.partner_name ? l.contact_name : "", phone: l.mobile || l.phone, email: l.email, to: `/crm/lead/${l.id}`, value: Number(l.expected_revenue || 0), owes: 0, deals: 1, note: l.type === "lead" ? "Lead" : "Opportunity" })),
    ];
    const s = q.trim().toLowerCase();
    return out.filter((r) => (kind === "all" || r.type === kind) && (!s || `${r.name} ${r.contact} ${r.phone} ${r.email}`.toLowerCase().includes(s)));
  }, [data, q, kind]);
  const shown = rows.slice(0, 500);
  const sel = useSelection(shown.map((r) => r.key));
  const { toast } = useToast();
  const qc = useQueryClient();
  const picked = rows.filter((r) => sel.has(r.key));
  const emailPicked = () => { const to = picked.map((r) => r.email).filter(Boolean); if (to.length) window.location.href = `mailto:?bcc=${encodeURIComponent(to.join(","))}`; };
  const removePicked = async () => {
    const leads = picked.filter((r) => r.type === "lead").map((r) => r.key);
    const custs = picked.filter((r) => r.type !== "lead").map((r) => r.key);
    if (!(await confirmAction({ title: `Delete ${picked.length} contact${picked.length === 1 ? "" : "s"}?`, message: "Customers with invoices or payments cannot be deleted and are skipped.", danger: true, confirmLabel: "Delete" }))) return;
    if (leads.length) await sb.from("crm_leads").delete().in("id", leads);
    let skipped = 0;
    for (const id of custs) { const { error } = await sb.from("customers").delete().eq("id", id); if (error) skipped++; }
    sel.clear(); void qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    toast({ title: "Contacts deleted", description: skipped ? `${skipped} customer${skipped === 1 ? "" : "s"} with transactions kept.` : undefined });
  };
  if (isLoading) return <OrbLoader label="Loading contacts…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Accounts" icon={Contact} description="Every business and person you deal with: customers and contacts from leads, with their sales, balances and open deals."
        actions={<><Button variant="outline" asChild><Link to="/crm/lead/new?type=lead"><Magnet /> New lead</Link></Button><Button asChild><Link to="/customers/new"><Plus /> New customer</Link></Button></>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">{([["all", "All"], ["business", "Businesses"], ["person", "People"], ["lead", "Lead contacts"]] as const).map(([v, l]) => <button key={v} onClick={() => setKind(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", kind === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Contact} title="No accounts found" /> : (
          <><BulkBar sel={sel} noun="contact">
            <Button size="sm" variant="outline" onClick={emailPicked}>Email</Button>
            <Button size="sm" variant="outline" onClick={() => downloadCsv("contacts.csv", ["Type", "Name", "Contact", "Phone", "Email", "Value", "Owes"], picked.map((r) => [r.type, r.name, r.contact, r.phone, r.email, r.value, r.owes]))}>Export</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => void removePicked()}>Delete</Button>
          </BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><TickAllCell sel={sel} /><th>Name</th><th className="hidden md:table-cell">Phone</th><th className="hidden lg:table-cell">Email</th><th className="num">Sales / value</th><th className="num hidden sm:table-cell">Owes</th><th className="num hidden sm:table-cell">Deals</th></tr></thead>
            <tbody><PagedRows rows={shown} colSpan={6}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.key} className={cn("cursor-pointer", sel.has(r.key) && "bg-primary/5")} onClick={() => navigate(r.to)}>
                <TickCell sel={sel} id={r.key} />
                <td><span className="flex items-center gap-2">{r.type === "business" ? <Building2 className="h-4 w-4 text-primary" /> : r.type === "lead" ? <Magnet className="h-4 w-4 text-info" /> : <User className="h-4 w-4 text-muted-foreground" />}<span className="min-w-0"><span className="block font-medium">{r.name}</span>{(r.contact || r.note) && <span className="block text-xs text-muted-foreground">{[r.contact, r.note].filter(Boolean).join(" · ")}</span>}</span></span></td>
                <td className="hidden whitespace-nowrap md:table-cell">{r.phone ? <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="h-3.5 w-3.5" />{r.phone}</a> : "—"}</td>
                <td className="hidden lg:table-cell">{r.email ? <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-primary"><Mail className="h-3.5 w-3.5" />{r.email}</a> : "—"}</td>
                <td className="num">{formatKES(r.value)}</td><td className="num hidden sm:table-cell">{r.owes ? formatKES(r.owes) : "—"}</td><td className="num hidden sm:table-cell">{r.deals || "—"}</td>
              </tr>
            ))}</PagedRows></tbody>
          </table></TableWrap></>
        )}
      </Panel>
    </div>
  );
}
