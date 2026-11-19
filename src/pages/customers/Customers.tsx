import { useMemo, useState } from "react";
import { MergeContactModal } from "@/components/books/MergeContacts";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, Search, X, Pencil, Users, Shapes as BrandIcon, Bell, Wallet, FileText, Receipt, Mail, Phone, MapPin, Trash2,
  MessageCircle, MoreHorizontal, ShoppingBag, CheckCircle2, KeyRound, ShieldCheck, HelpCircle, Ban, Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useStaff, useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, Modal, Field } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { ZStatus, invoiceDisplayStatus } from "@/components/books/ZStatus";
import { RecordPaymentModal } from "@/components/books/RecordPayment";
import { confirmAction } from "@/components/books/confirm";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import { shareOnWhatsApp } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReminderForm } from "@/pages/sales/Reminders";
import { erpApi } from "@/lib/erpApi";
import { useModules } from "@/hooks/useModules";
import { CustomerCalls, openCallCentre } from "@/pages/callcentre/CallCentre";
import DocumentsPanel, { CUSTOMER_DOCS } from "@/components/DocumentsPanel";
import ImportExport from "@/components/ImportExport";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { BellRing, Download, Save } from "lucide-react";

import { CustomFieldsView } from "@/lib/customFields";
import { PortalMessages, ProfileUpdates, usePortalUnread } from "@/pages/customers/PortalMessages";
import { Eye } from "lucide-react";

const sb: any = supabase;
const VIEWS = [["all", "All Customers"], ["pending", "Pending Approval"], ["debt", "With Receivables"], ["overdue", "Overdue"], ["pos", "Added at the Till"], ["shop", "Online Shop Customers"], ["business", "Companies"], ["individual", "Individuals"]] as const;

function useCustomerList() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["zcustomers", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [c, s] = await Promise.all([
        sb.from("customers").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("customer_summary").select("*").eq("tenant_id", tenantId),
      ]);
      if (c.error) throw c.error;
      const sum = new Map((s.data || []).map((x: any) => [x.customer_id, x]));
      return (c.data || []).map((x: any) => ({ ...x, _s: sum.get(x.id) || {} }));
    },
  });
}

export default function Customers() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: customers = [], isLoading } = useCustomerList();
  const [view, setView] = useState<string>("all");
  const [q, setQ] = useState("");
  // A role limited to its own or assigned customers sees only the customers assigned to that person.
  const { scope } = usePermissions();
  const { user: me } = useAuth() as any;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (customers as any[]).filter((c) => {
      if (scope !== "all" && me?.id && c.salesperson_id !== me.id && c.created_by !== me.id) return false;
      if (view === "pending" && !["pending", "info_requested"].includes(c.approval_status)) return false;
      if (view === "debt" && !(Number(c._s.receivables) > 0)) return false;
      if (view === "overdue" && !(Number(c._s.overdue) > 0)) return false;
      if (view === "pos" && c.source !== "pos") return false;
      if (view === "shop" && c.source !== "shop") return false;
      if (view === "business" && c.customer_type !== "business") return false;
      if (view === "individual" && c.customer_type === "business") return false;
      return !s || `${c.name} ${c.company_name || ""} ${c.phone || ""} ${c.email || ""}`.toLowerCase().includes(s);
    });
  }, [customers, view, q, scope, me?.id]);
  const selected = id ? (customers as any[]).find((c) => c.id === id) : null;
  const pending = (customers as any[]).filter((c) => ["pending", "info_requested"].includes(c.approval_status)).length;
  const paged = usePaged(rows, 50);
  const sel = useSelection(paged.rows.map((c: any) => c.id));
  const qc = useQueryClient();
  const { toast } = useToast();
  const [bulkEdit, setBulkEdit] = useState(false);
  const picked = (customers as any[]).filter((c) => sel.has(c.id));
  const done = (msg: string) => { sel.clear(); qc.invalidateQueries({ queryKey: ["zcustomers"] }); toast({ title: msg }); };
  const approveMany = async () => {
    const ids = picked.filter((c) => ["pending", "info_requested"].includes(c.approval_status)).map((c) => c.id);
    if (!ids.length) return toast({ title: "None of these are waiting for approval", variant: "destructive" });
    const { error } = await sb.from("customers").update({ approval_status: "approved", info_request: null }).in("id", ids);
    if (error) return toast({ title: "Not approved", description: error.message, variant: "destructive" });
    done(`${ids.length} approved`);
  };
  const remindMany = async () => {
    const ids = picked.filter((c) => Number(c._s.receivables) > 0).map((c) => c.id);
    if (!ids.length) return toast({ title: "None of these owe anything", variant: "destructive" });
    try { const r: any = await erpApi("remind-payment", { customer_ids: ids, sms: true, email: true }); done(`Reminders sent: ${r.sms || 0} SMS, ${r.email || 0} email`); }
    catch (e: any) { toast({ title: "Reminders not sent", description: e.message, variant: "destructive" }); }
  };
  const statementMany = async () => {
    const withEmail = picked.filter((c) => c.email);
    if (!withEmail.length) return toast({ title: "None of these have an email address", variant: "destructive" });
    const from = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
    let ok = 0;
    for (const c of withEmail) { try { await erpApi("statement/send", { customer_id: c.id, from, to }); ok++; } catch { /* reported below */ } }
    done(`Statements emailed to ${ok} of ${withEmail.length}`);
  };
  const deleteMany = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} customer${sel.count === 1 ? "" : "s"}?`, message: "Customers with sales, invoices or payments cannot be deleted and are kept.", danger: true, confirmLabel: "Delete" }))) return;
    let gone = 0, kept = 0;
    for (const c of picked) { const { error } = await sb.from("customers").delete().eq("id", c.id); if (error) kept++; else gone++; }
    done(`${gone} deleted${kept ? `, ${kept} kept (they have records)` : ""}`);
  };
  const exportPicked = () => downloadCsv("customers-selected.csv", ["Name", "Company", "Phone", "Email", "Type", "KRA PIN", "Credit limit", "Receivables", "Overdue", "Unused credits"],
    picked.map((c) => [c.name, c.company_name, c.phone, c.email, c.customer_type, c.kra_pin, c.credit_limit, c._s.receivables, c._s.overdue, c._s.unused_credit]));

  if (isLoading) return <OrbLoader label="Loading customers…" />;
  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="inline-flex items-center gap-1.5 font-display text-lg font-bold">{VIEWS.find(([v]) => v === view)?.[1]} <ChevronDown className="h-4 w-4 text-primary" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">{VIEWS.map(([v, l]) => <DropdownMenuItem key={v} onSelect={() => setView(v)} className={cn(view === v && "font-semibold text-primary")}>{l}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        {pending > 0 && view !== "pending" && <button onClick={() => setView("pending")} className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">{pending} waiting for approval</button>}
        <span className="flex-1" />
        {!selected && (
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" className="fi h-9 w-64 rounded-full pl-9" />
          </div>
        )}
        {!selected && <ImportExport entity="customers" rows={(customers as any[]).map((c) => ({ name: c.name, company: c.company_name, phone: c.phone, email: c.email, type: c.customer_type, kra_pin: c.kra_pin, credit_limit: c.credit_limit, purchases: c._s.total_purchases, receivables: c._s.receivables, source: c.source, status: c.approval_status }))}
          spec={{ table: "customers", columns: [{ key: "name", label: "Name", required: true }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "company_name", label: "Company" }, { key: "kra_pin", label: "KRA PIN" }, { key: "address", label: "Address" }, { key: "credit_limit", label: "Credit limit", type: "number" }], toRecord: (r) => ({ ...r, credit_limit: r.credit_limit || 0, source: "import", customer_type: r.company_name ? "business" : "individual" }) }} />}
        <Button size="sm" onClick={() => navigate("/customers/new")}><Plus /> New</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 overscroll-contain xl:block 2xl:w-[340px]" : "w-full")}>
          {rows.length === 0 ? (
            <EmptyState icon={Users} title="No customers here" description="Added automatically at their first sale." className="m-6" />
          ) : selected ? (
            <ul>{(paged.rows as any[]).map((c) => (
              <li key={c.id}><Link to={`/customers/${c.id}`} className={cn("block border-b border-border px-4 py-3 hover:bg-muted/50", c.id === id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-semibold">{c.name}</span><span className={cn("shrink-0 whitespace-nowrap text-sm tabular-nums", Number(c._s.overdue) > 0 && "text-destructive")}>{formatKES(Number(c._s.receivables || 0))}</span></div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.phone || c.email || "—"}</p>
              </Link></li>
            ))}<li><Pager {...paged.pager} onPageSize={undefined} /></li></ul>
          ) : (
            <div className="overflow-x-auto">
              <BulkBar sel={sel} noun="customer">
                <Button size="sm" variant="outline" onClick={() => setBulkEdit(true)}><Pencil /> Bulk edit</Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/marketing/sms?customers=${sel.ids.join(",")}`)}><MessageCircle /> Send SMS</Button>
                <Button size="sm" variant="outline" onClick={remindMany}><BellRing /> Payment reminder</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline">More <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={approveMany}><CheckCircle2 /> Approve sign-ups</DropdownMenuItem>
                    <DropdownMenuItem onSelect={statementMany}><Mail /> Email statements (last 3 months)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={exportPicked}><Download /> Export selected</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={deleteMany}><Trash2 /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </BulkBar>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 z-[1] bg-card"><tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 px-3 py-3 text-left"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} label="Select all on this page" /></th>
                  <th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Company Name</th><th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Phone</th><th className="px-4 py-3 text-right">Receivables</th><th className="px-4 py-3 text-right">Overdue</th>
                  <th className="px-4 py-3 text-right">Unused Credits</th>
                </tr></thead>
                <tbody>{(paged.rows as any[]).map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className={cn("cursor-pointer border-b border-border hover:bg-muted/40", sel.has(c.id) && "bg-primary/5")}>
                    <td className="w-10 px-3 py-3"><Tick on={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></td>
                    <td className="px-4 py-3 font-semibold text-primary"><span className="inline-flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold">{String(c.name || "?").charAt(0).toUpperCase()}</span>{c.name}</span>{c.source === "pos" && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">Till</span>}{c.source === "shop" && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-normal text-primary">Online</span>}{["pending", "info_requested"].includes(c.approval_status) && <span className="ml-1.5 rounded bg-warning/15 px-1 text-[10px] font-semibold text-warning">{c.approval_status === "pending" ? "Pending approval" : "Details requested"}</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.company_name || ""}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.email || ""}</td>
                    <td className="px-4 py-3">{c.phone || ""}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKES(Number(c._s.receivables || 0))}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", Number(c._s.overdue) > 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>{formatKES(Number(c._s.overdue || 0))}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatKES(Number(c._s.unused_credit || 0))}</td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager {...paged.pager} />
            </div>
          )}
          {bulkEdit && <BulkEditCustomers count={picked.length} onClose={() => setBulkEdit(false)} onSave={async (patch) => {
            setBulkEdit(false);
            const { error } = await sb.from("customers").update(patch).in("id", picked.map((c) => c.id));
            if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
            done(`${picked.length} customer${picked.length === 1 ? "" : "s"} updated`);
          }} />}
        </div>
        {selected && <CustomerDetail c={selected} onClose={() => navigate("/customers")} />}
        {id && !selected && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">That customer was not found.</div>}
      </div>
    </div>
  );
}

const TABS = ["overview", "transactions", "statement", "messages", "calls", "documents", "online account", "reminders"] as const;

function CustomerDetail({ c, onClose }: { c: any; onClose: () => void }) {
  const navigate = useNavigate();
  const [mergeOpen, setMergeOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => (TABS as readonly string[]).includes(params.get("tab") || "") ? (params.get("tab") as (typeof TABS)[number]) : "overview");
  const { data: unread = 0 } = usePortalUnread(c.id);
  const [paying, setPaying] = useState(false);
  const { data: biz } = useBusinessSettings();
  const { has: hasModule } = useModules();

  const remove = async () => {
    if (Number(c._s.receivables) > 0) return toast({ title: "This customer still owes money", description: "Clear their balance before deleting.", variant: "destructive" });
    if (!(await confirmAction({ title: `Delete ${c.name}?`, message: "Past sales keep the name. This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("customers").delete().eq("id", c.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["zcustomers"] });
    onClose();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <p className="text-xs capitalize text-muted-foreground">{c.customer_type || "individual"}{c.company_name ? ` · ${c.company_name}` : ""}</p>
          <h2 className="truncate font-display text-xl font-bold">{c.name}</h2>
        </div>
        {c.phone && hasModule("callcentre") && <Button size="sm" variant="outline" onClick={() => void openCallCentre("/", c.phone)}><Phone /> Call</Button>}
        <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${c.id}/edit`)}><Pencil /> Edit</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm"><Plus /> New Transaction <ChevronDown className="opacity-70" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/sales/invoices/new?customer=${c.id}`)}><Receipt /> Invoice</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPaying(true)}><Wallet /> Customer Payment</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/sales/quotes/new?customer=${c.id}`)}><FileText /> Quote</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/sales/orders/new?customer=${c.id}`)}><FileText /> Sales Order</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/sales/recurring")}><Receipt /> Recurring Invoice</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/sales/credit-notes/new?customer=${c.id}`)}><FileText /> Credit Note</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/expenses?new=1")}><Wallet /> Expense</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/accounting/journals?new=1")}><FileText /> Journal</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 gap-1.5 px-3 font-semibold" aria-label="More actions"><MoreHorizontal className="!h-5 !w-5" /> More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {c.email && <DropdownMenuItem onSelect={() => { window.location.href = `mailto:${c.email}`; }}><Mail /> Email Customer</DropdownMenuItem>}
            {c.phone && <DropdownMenuItem onSelect={() => shareOnWhatsApp(c.phone, `Hello ${c.name}, `)}><MessageCircle /> WhatsApp</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => navigate(`/customers/${c.id}/portal-view`)}><Eye /> View as customer</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/customers/new?clone=${c.id}`)}><Copy /> Clone</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMergeOpen(true)}><Users /> Merge customers</DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => { const on = !c.reminders_stopped; const { error } = await sb.from("customers").update({ reminders_stopped: on }).eq("id", c.id); if (!error) { toast({ title: on ? "Reminders stopped for this customer" : "Reminders on again" }); void qc.invalidateQueries(); } }}><BellRing /> {c.reminders_stopped ? "Resume reminders" : "Stop all reminders"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={remove}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      {mergeOpen && <MergeContactModal kind="customer" keep={{ id: c.id, name: c.name }} onClose={() => setMergeOpen(false)} />}
      {["pending", "info_requested"].includes(c.approval_status) && <ApprovalBar c={c} />}
      <div className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors", tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t}{t === "messages" && unread > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{unread}</span>}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {tab === "overview" && <Overview c={c} />}
        {tab === "transactions" && <Transactions customerId={c.id} />}
        {tab === "statement" && <Statement customerId={c.id} email={c.email} phone={c.phone} />}
        {tab === "online account" && <OnlineAccount c={c} />}
        {tab === "messages" && <PortalMessages customer={c} />}
        {tab === "documents" && <DocumentsPanel shareable entityType="customer" entityId={c.id} entityName={c.name} checklist={c.customer_type === "business" ? CUSTOMER_DOCS : CUSTOMER_DOCS.slice(0, 2)} />}
        {false && <Pets customer={c} />}
        {tab === "calls" && <CustomerCalls customerId={c.id} />}
        {tab === "reminders" && <CustomerReminders customerId={c.id} shop={biz?.business_name} customer={c} />}
      </div>
      {paying && <RecordPaymentModal customer={{ id: c.id, name: c.name }} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); qc.invalidateQueries({ queryKey: ["zcustomers"] }); qc.invalidateQueries({ queryKey: ["cust-tx"] }); }} />}
    </div>
  );
}

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-border bg-card p-4", className)}>{title && <h3 className="mb-3 text-sm font-semibold">{title}</h3>}{children}</section>;
}

function Overview({ c }: { c: any }) {
  const { data: staff = [] } = useStaff();
  const rep = (staff as any[]).find((s) => s.user_id === c.salesperson_id);
  const { data: monthly = [] } = useQuery({
    queryKey: ["cust-monthly", c.id],
    queryFn: async () => {
      const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1);
      const { data } = await sb.from("transactions").select("total, created_at").eq("customer_id", c.id).eq("status", "completed").gte("created_at", since.toISOString());
      const out: { label: string; total: number }[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        out.push({ label: d.toLocaleDateString("en-GB", { month: "short" }), total: (data || []).filter((t: any) => { const x = new Date(t.created_at); return `${x.getFullYear()}-${x.getMonth()}` === key; }).reduce((a: number, t: any) => a + Number(t.total || 0), 0) });
      }
      return out;
    },
  });
  const max = Math.max(1, ...monthly.map((m) => m.total));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 font-display text-lg font-bold text-primary">{String(c.name || "?").charAt(0).toUpperCase()}</span>
            <div className="min-w-0"><p className="truncate font-semibold">{c.name}</p><p className="text-xs text-muted-foreground">Customer since {fmtDate(c.created_at)}</p></div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {c.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {c.email}</p>}
            {c.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {c.phone}{c.alt_phone ? ` · ${c.alt_phone}` : ""}</p>}
            {(c.address || c.area || c.building) && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {[c.building, c.address, c.area].filter(Boolean).join(", ")}</p>}
          </div>
        </Card>
        <Card title="Other Details">
          <dl className="space-y-1.5 text-sm">
            {[["Customer Type", c.customer_type || "Individual"], ["Payment Terms", Number(c.credit_days) ? `Net ${c.credit_days}` : "Due on Receipt"], ["Credit Limit", Number(c.credit_limit) ? formatKES(Number(c.credit_limit)) : "None"], ["Sales Rep", rep?.display_name || "—"], ["KRA PIN", c.kra_pin || "—"], ["Added", c.source === "pos" ? "At the till" : c.source === "shop" ? "Online shop" : "Manually"]].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
            ))}
          </dl>
          <CustomFieldsView entity="customer" values={c.custom} className="mt-2 space-y-0.5 text-sm" />
          {c.notes && <p className="mt-3 rounded-xl bg-muted/60 p-2 text-sm">{c.notes}</p>}
        </Card>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Card><p className="text-xs text-muted-foreground">Receivables</p><p className={cn("mt-1 whitespace-nowrap font-display text-xl font-bold tabular-nums", Number(c._s.overdue) > 0 && "text-destructive")}>{formatKES(Number(c._s.receivables || 0))}</p>{Number(c._s.overdue) > 0 && <p className="text-xs text-destructive">{formatKES(Number(c._s.overdue))} overdue</p>}</Card>
          <Card><p className="text-xs text-muted-foreground">Unused Credits</p><p className="mt-1 whitespace-nowrap font-display text-xl font-bold tabular-nums">{formatKES(Number(c._s.unused_credit || 0))}</p></Card>
          <Card><p className="text-xs text-muted-foreground">Total Sales</p><p className="mt-1 whitespace-nowrap font-display text-xl font-bold tabular-nums">{formatKES(Number(c._s.total_purchases || 0))}</p><p className="text-xs text-muted-foreground">{Number(c._s.purchase_count || 0)} sales{c._s.last_purchase_at ? ` · last ${fmtDate(c._s.last_purchase_at)}` : ""}</p></Card>
        </div>
        <Card title="Purchases (last 12 months)">
          <div className="flex h-40 items-end gap-1.5">
            {monthly.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${m.label}: ${formatKES(m.total)}`}>
                <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${Math.max(2, (m.total / max) * 100)}%` }} />
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Transactions({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["cust-tx", customerId],
    queryFn: async () => {
      const [inv, q, tx, pay] = await Promise.all([
        sb.from("invoices").select("id, invoice_number, issue_date, due_date, total, amount_paid, status").eq("customer_id", customerId).order("issue_date", { ascending: false }),
        sb.from("quotes").select("id, quote_number, issue_date, total, status").eq("customer_id", customerId).order("issue_date", { ascending: false }),
        sb.from("transactions").select("id, created_at, total, payment_method, status, items").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(200),
        sb.from("payments_received").select("id, payment_number, payment_date, amount, method").eq("customer_id", customerId).order("payment_date", { ascending: false }),
      ]);
      return { inv: inv.data || [], q: q.data || [], tx: tx.data || [], pay: pay.data || [] };
    },
  });
  if (isLoading || !data) return <OrbLoader label="Loading transactions…" />;
  const Block = ({ title, icon: Icon, children, count }: any) => (
    <Card className="p-0">
      <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" /> {title} <span className="rounded-full bg-muted px-2 text-xs">{count}</span></p>
      {count ? children : <p className="px-4 py-4 text-sm text-muted-foreground">None yet.</p>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <Block title="Purchases at the company" icon={ShoppingBag} count={data.tx.length}>
        <table className="dt"><thead><tr><th>Date</th><th>Items</th><th>Payment</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody><PagedRows rows={data.tx} colSpan={5}>{(pageRows) => pageRows.map((t: any) => (
            <tr key={t.id}><td>{fmtDate(t.created_at)}</td><td className="max-w-[18rem] truncate">{(t.items || []).map((i: any) => `${i.name} ×${i.quantity ?? 1}`).join(", ")}</td><td className="capitalize">{String(t.payment_method || "").replace(/_/g, " ")}</td><td className="capitalize">{t.status}</td><td className="num font-semibold">{formatKES(Number(t.total))}</td></tr>
          ))}</PagedRows></tbody></table>
      </Block>
      <Block title="Invoices" icon={Receipt} count={data.inv.length}>
        <table className="dt"><thead><tr><th>Date</th><th>Invoice#</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
          <tbody><PagedRows rows={data.inv} colSpan={6}>{(pageRows) => pageRows.map((i: any) => (
            <tr key={i.id} className="cursor-pointer" onClick={() => navigate(`/sales/invoices/${i.id}`)}><td>{fmtDate(i.issue_date)}</td><td className="font-semibold text-primary">{i.invoice_number}</td><td>{i.due_date ? fmtDate(i.due_date) : "—"}</td><td><ZStatus status={invoiceDisplayStatus(i)} /></td><td className="num">{formatKES(Number(i.total))}</td><td className="num font-semibold">{formatKES(Number(i.total) - Number(i.amount_paid))}</td></tr>
          ))}</PagedRows></tbody></table>
      </Block>
      <Block title="Customer Payments" icon={Wallet} count={data.pay.length}>
        <table className="dt"><thead><tr><th>Date</th><th>Payment#</th><th>Mode</th><th className="num">Amount</th></tr></thead>
          <tbody><PagedRows rows={data.pay} colSpan={4}>{(pageRows) => pageRows.map((p: any) => (
            <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/sales/payments/${p.id}`)}><td>{fmtDate(p.payment_date)}</td><td className="font-semibold text-primary">{p.payment_number}</td><td className="capitalize">{String(p.method).replace(/_/g, " ")}</td><td className="num font-semibold">{formatKES(Number(p.amount))}</td></tr>
          ))}</PagedRows></tbody></table>
      </Block>
      <Block title="Quotations" icon={FileText} count={data.q.length}>
        <table className="dt"><thead><tr><th>Date</th><th>Quote#</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody><PagedRows rows={data.q} colSpan={4}>{(pageRows) => pageRows.map((x: any) => (
            <tr key={x.id} className="cursor-pointer" onClick={() => navigate(`/sales/quotes/${x.id}`)}><td>{fmtDate(x.issue_date)}</td><td className="font-semibold text-primary">{x.quote_number}</td><td><ZStatus status={x.status} /></td><td className="num">{formatKES(Number(x.total))}</td></tr>
          ))}</PagedRows></tbody></table>
      </Block>
    </div>
  );
}

/** Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC). */
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Statement({ customerId, email, phone }: { customerId: string; email?: string | null; phone?: string | null }) {
  const now = new Date();
  const [from, setFrom] = useState(localIso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localIso(now));
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const send = async (sms: boolean) => {
    setSending(true);
    try {
      const r = await erpApi<any>("statement/send", { customer_id: customerId, from, to, email: !sms, sms });
      const res = sms ? r.sms : r.email;
      toast(res?.ok ? { title: sms ? "Statement summary sent by SMS" : `Statement emailed to ${email}` } : { title: "Not sent", description: res?.error || "Check Email & senders or SMS gateway settings", variant: "destructive" });
    } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
    finally { setSending(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input className="fi w-44" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="fi w-44" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {[["This month", 0], ["Last 3 months", 2], ["This year", -1]].map(([l, m]) => (
          <Button key={String(l)} size="sm" variant="outline" onClick={() => { setTo(localIso(now)); setFrom(m === -1 ? `${now.getFullYear()}-01-01` : localIso(new Date(now.getFullYear(), now.getMonth() - Number(m), 1))); }}>{l}</Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" onClick={() => send(false)} disabled={sending || !email} title={email ? "" : "Add an email address to the customer first"}><Mail /> Email statement</Button>
        {phone && <Button size="sm" variant="outline" onClick={() => send(true)} disabled={sending}><MessageCircle /> SMS balance</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Month-end emails: System → Customer statements.</p>
      <DocumentPreview kind="statement" id={`${customerId}|${from}|${to}`} />
    </div>
  );
}

function Pets({ customer }: { customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [visit, setVisit] = useState<any>(null);
  const { data = [] } = useQuery({
    queryKey: ["pets", customer.id],
    queryFn: async () => (await sb.from("customer_pets").select("*").eq("customer_id", customer.id).order("created_at")).data || [],
  });
  const save = async () => {
    if (!edit?.name?.trim()) return toast({ title: "Enter the pet's name", variant: "destructive" });
    const row = { tenant_id: customer.tenant_id, customer_id: customer.id, name: edit.name.trim(), species: edit.species || null, breed: edit.breed || null, sex: edit.sex || null, birth_date: edit.birth_date || null, weight_kg: edit.weight_kg ? Number(edit.weight_kg) : null, notes: edit.notes || null };
    const { error } = edit.id ? await sb.from("customer_pets").update(row).eq("id", edit.id) : await sb.from("customer_pets").insert(row);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["pets", customer.id] });
    setEdit(null);
  };
  const del = async (p: any) => {
    if (!(await confirmAction({ title: `Remove ${p.name}?`, danger: true, confirmLabel: "Remove" }))) return;
    await sb.from("customer_pets").delete().eq("id", p.id);
    qc.invalidateQueries({ queryKey: ["pets", customer.id] });
  };
  const age = (d?: string) => { if (!d) return ""; const m = Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86400000)); return m >= 12 ? `${Math.floor(m / 12)} yr${m >= 24 ? "s" : ""}` : `${m} mo`; };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setEdit({ name: "", species: "dog" })}><Plus /> Add pet</Button></div>
      {data.length === 0 ? <EmptyState icon={BrandIcon} title="No pets recorded" description="Record pets to remind owners about vaccines, deworming and food for each one." /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(data as any[]).map((p) => (
            <Card key={p.id}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BrandIcon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1"><p className="font-semibold">{p.name}</p><p className="text-xs capitalize text-muted-foreground">{[p.species, p.breed, p.sex, age(p.birth_date)].filter(Boolean).join(" · ")}</p>{p.notes && <p className="mt-1 text-xs">{p.notes}</p>}
                  {p.next_visit && <p className={cn("mt-1 text-xs font-semibold", p.next_visit < new Date().toISOString().slice(0, 10) ? "text-destructive" : "text-success")}>Next visit {fmtDate(p.next_visit)}</p>}
                  <button className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground" onClick={() => setVisit(p)}><Bell className="h-3 w-3" /> Book return visit</button></div>
                <button className="icon-btn" onClick={() => setEdit(p)} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                <button className="icon-btn-danger" onClick={() => del(p)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {visit && <ReminderForm preset={{ customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }, pet_id: visit.id, kind: "visit", title: "Check-up" }}
        onClose={() => setVisit(null)} onSaved={() => { setVisit(null); qc.invalidateQueries({ queryKey: ["pets", customer.id] }); qc.invalidateQueries({ queryKey: ["cust-reminders", customer.id] }); qc.invalidateQueries({ queryKey: ["reminders"] }); }} />}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : "Add pet"} icon={BrandIcon} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><input className="fi" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Species"><select className="fi" value={edit.species || ""} onChange={(e) => setEdit({ ...edit, species: e.target.value })}>{["dog", "cat", "bird", "fish", "rabbit", "other"].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Breed"><input className="fi" value={edit.breed || ""} onChange={(e) => setEdit({ ...edit, breed: e.target.value })} /></Field>
            <Field label="Sex"><select className="fi" value={edit.sex || ""} onChange={(e) => setEdit({ ...edit, sex: e.target.value })}><option value="">—</option><option>male</option><option>female</option></select></Field>
            <Field label="Date of birth"><input className="fi" type="date" value={edit.birth_date || ""} onChange={(e) => setEdit({ ...edit, birth_date: e.target.value })} /></Field>
            <Field label="Weight (kg)"><input className="fi" type="number" step="any" value={edit.weight_kg || ""} onChange={(e) => setEdit({ ...edit, weight_kg: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea className="fi" rows={2} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomerReminders({ customerId, customer }: { customerId: string; shop?: string; customer?: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<any | null | undefined>(undefined);
  const { data = [] } = useQuery({
    queryKey: ["cust-reminders", customerId],
    queryFn: async () => (await sb.from("customer_reminders").select("*, customer_pets(name)").eq("customer_id", customerId).order("due_date")).data || [],
  });
  const done = () => { setOpen(undefined); qc.invalidateQueries({ queryKey: ["cust-reminders", customerId] }); qc.invalidateQueries({ queryKey: ["reminders"] }); };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(null)}><Plus /> New reminder</Button></div>
      {!data.length ? <EmptyState icon={Bell} title="No reminders for this customer" description="Restock reminders are scheduled from sales; add follow-ups here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="dt"><thead><tr><th>Due</th><th>Type</th><th>For</th><th>For</th><th>Repeats</th><th>Status</th><th /></tr></thead>
            <tbody><PagedRows rows={(data as any[])} colSpan={7}>{(pageRows) => pageRows.map((r) => <tr key={r.id}><td>{fmtDate(r.due_date)}</td><td className="capitalize">{r.kind === "repurchase" ? "Restock" : r.kind}</td><td>{r.title || r.product_name}</td><td>{r.customer_pets?.name || "—"}</td><td>{r.repeat_every ? `Every ${r.repeat_every} ${r.repeat_unit}` : "—"}</td><td className="capitalize">{r.status}</td>
              <td><button className="icon-btn" onClick={() => setOpen({ ...r, customers: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : { id: customerId, name: "" } })} aria-label="Edit"><Pencil className="h-4 w-4" /></button></td></tr>)}</PagedRows></tbody></table>
        </div>
      )}
      {open !== undefined && <ReminderForm reminder={open} preset={customer ? { customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email } } : undefined} onClose={() => setOpen(undefined)} onSaved={done} />}
    </div>
  );
}


/** Website sign-up waiting for approval: approve, ask for more details or reject. */
function ApprovalBar({ c }: { c: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = async (approval_status: string) => {
    const { error } = await sb.from("customers").update({ approval_status, approved_at: approval_status === "approved" ? new Date().toISOString() : null, approved_by: user?.id || null }).eq("id", c.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: approval_status === "approved" ? `${c.name} approved` : "Customer rejected" });
    qc.invalidateQueries({ queryKey: ["zcustomers"] });
  };
  const request = async () => {
    setBusy(true);
    try { await erpApi("customer/request-info", { customer_id: c.id, message: ask }); toast({ title: "Request sent", description: "By SMS and email. They update their details in their account." }); setAsk(null); qc.invalidateQueries({ queryKey: ["zcustomers"] }); }
    catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-sm">
      <HelpCircle className="h-4 w-4 text-warning" />
      <span className="flex-1">{c.approval_status === "pending" ? "Signed up on the website and waiting for approval." : <>Details requested: <i>{c.info_request}</i></>}</span>
      <Button size="sm" onClick={() => set("approved")}><CheckCircle2 /> Approve</Button>
      <Button size="sm" variant="outline" onClick={() => setAsk("Please complete your details (delivery address, KRA PIN and ID number) in your account.")}><Mail /> Ask for details</Button>
      <Button size="sm" variant="ghost" onClick={() => set("rejected")}><Ban /> Reject</Button>
      <Modal open={ask !== null} onClose={() => setAsk(null)} title="Ask for more details" footer={<Button onClick={request} disabled={busy}>Send request</Button>}>
        <Field label="Message" hint="Sent by SMS and email; it also shows in their online account."><textarea className="fi" value={ask || ""} onChange={(e) => setAsk(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

/** The customer's online account: approval, sign-in access and password reset. */
function OnlineAccount({ c }: { c: any }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ password: string; phone: string } | null>(null);
  const { data: acc, refetch } = useQuery({
    queryKey: ["cust-portal", c.id],
    queryFn: async () => (await sb.from("customer_accounts_public").select("*").eq("customer_id", c.id).maybeSingle()).data,
  });
  const reset = async (send: "sms" | "email" | "none") => {
    setBusy(true);
    try { const r = await erpApi<any>("customer/portal-password", { customer_id: c.id, send }); setResult({ password: r.password, phone: r.phone }); refetch(); if (r.sent && !r.sent.ok) toast({ title: "Password set, but not sent", description: r.sent.error, variant: "destructive" }); }
    catch (e: any) { toast({ title: "Not done", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><ProfileUpdates customerId={c.id} /></div>
      <Card title="Online account">
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between"><span className="text-muted-foreground">Account</span><b>{acc ? "Active" : "Not created yet"}</b></li>
          <li className="flex justify-between"><span className="text-muted-foreground">Signs in with</span><b>{c.phone || "—"}{c.email ? ` or ${c.email}` : ""}</b></li>
          <li className="flex justify-between"><span className="text-muted-foreground">Approval</span><b className="capitalize">{String(c.approval_status || "approved").replace("_", " ")}</b></li>
          {acc?.last_login_at && <li className="flex justify-between"><span className="text-muted-foreground">Last signed in</span><b>{new Date(acc.last_login_at).toLocaleString("en-GB")}</b></li>}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">They sign in on your website.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate(`/customers/${c.id}/portal-view`)}><Eye /> View as customer</Button>
      </Card>
      <Card title={acc ? "Reset their password" : "Create their online account"}>
        <p className="mb-3 text-sm text-muted-foreground">A temporary password is made. They are asked to choose their own after signing in. They can also reset it themselves with “Forgot password”.</p>
        <div className="flex flex-wrap gap-2">
          {c.phone && <Button size="sm" onClick={() => reset("sms")} disabled={busy}><KeyRound /> {acc ? "Reset" : "Create"} & SMS it</Button>}
          {c.email && <Button size="sm" variant="outline" onClick={() => reset("email")} disabled={busy}><Mail /> {acc ? "Reset" : "Create"} & email it</Button>}
          <Button size="sm" variant="ghost" onClick={() => reset("none")} disabled={busy}><ShieldCheck /> Just show it</Button>
        </div>
        {result && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p>Phone: <b>{result.phone}</b></p>
            <p className="flex items-center gap-2">Temporary password: <b className="font-mono">{result.password}</b><button className="icon-btn" onClick={() => navigator.clipboard?.writeText(result.password)} aria-label="Copy"><Copy className="h-4 w-4" /></button></p>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Change credit terms, type or rep for many customers. Empty fields stay as they are. */
function BulkEditCustomers({ count, onClose, onSave }: { count: number; onClose: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const { data: staff = [] } = useStaff();
  const [f, setF] = useState({ customer_type: "", credit_limit: "", credit_days: "", salesperson_id: "", status: "" });
  const save = () => {
    const p: Record<string, unknown> = {};
    if (f.customer_type) p.customer_type = f.customer_type;
    if (f.credit_limit !== "") p.credit_limit = Math.max(0, Number(f.credit_limit) || 0);
    if (f.credit_days !== "") p.credit_days = Math.max(0, Number(f.credit_days) || 0);
    if (f.salesperson_id) p.salesperson_id = f.salesperson_id === "none" ? null : f.salesperson_id;
    if (f.status) p.approval_status = f.status;
    if (!Object.keys(p).length) return onClose();
    onSave(p);
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${count} customer${count === 1 ? "" : "s"}`} icon={Pencil} description="Fill in only what should change."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}><Save /> Apply to all</Button></>}>
      <div className="space-y-3">
        <Field label="Customer type"><select className="fi" value={f.customer_type} onChange={(e) => setF({ ...f, customer_type: e.target.value })}><option value="">Keep as is</option><option value="individual">Individual</option><option value="business">Business</option></select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Credit limit (KES)"><input className="fi" type="number" min={0} value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value })} placeholder="Keep" /></Field>
          <Field label="Credit days"><input className="fi" type="number" min={0} value={f.credit_days} onChange={(e) => setF({ ...f, credit_days: e.target.value })} placeholder="Keep" /></Field>
        </div>
        <Field label="Sales rep"><select className="fi" value={f.salesperson_id} onChange={(e) => setF({ ...f, salesperson_id: e.target.value })}><option value="">Keep as is</option><option value="none">No rep</option>{(staff as any[]).map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}</select></Field>
        <Field label="Account status"><select className="fi" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Keep as is</option><option value="approved">Approved</option><option value="pending">Pending approval</option><option value="rejected">Rejected</option></select></Field>
      </div>
    </Modal>
  );
}
