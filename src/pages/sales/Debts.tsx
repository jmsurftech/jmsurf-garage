import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, AlertTriangle, CalendarDays, Users, Wallet, MessageCircle, ChevronLeft, ChevronRight, Search, Bell, Receipt, Mail, Smartphone, BellRing, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { erpApi } from "@/lib/erpApi";
import { OrbSpinner } from "@/components/orbs";
import { useSelection, BulkBar, Tick } from "@/components/Bulk";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessSettings } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { PageHeader, StatGrid, StatTile, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { RecordPaymentModal } from "@/components/books/RecordPayment";
import { shareOnWhatsApp, emailDocuments } from "@/lib/docSend";
import { Modal, Field } from "@/components/kit";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
type Debt = {
  invoice_id: string; invoice_number: string; customer_id: string | null; customer_name: string; customer_phone: string | null;
  issue_date: string; due_date: string | null; total: number; amount_paid: number; balance: number; status: string; source: string;
  salesperson_name: string | null; age_days: number; days_overdue: number;
};

const BUCKETS = [
  { key: "current", label: "Not yet due", test: (d: Debt) => d.days_overdue <= 0 },
  { key: "1-30", label: "1–30 days overdue", test: (d: Debt) => d.days_overdue >= 1 && d.days_overdue <= 30 },
  { key: "31-60", label: "31–60 days", test: (d: Debt) => d.days_overdue >= 31 && d.days_overdue <= 60 },
  { key: "61-90", label: "61–90 days", test: (d: Debt) => d.days_overdue >= 61 && d.days_overdue <= 90 },
  { key: "90+", label: "Over 90 days", test: (d: Debt) => d.days_overdue > 90 },
];

export function useDebts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["debts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("debts_view").select("*").eq("tenant_id", tenantId).order("due_date", { ascending: true, nullsFirst: false })).data || []) as Debt[],
  });
}

export default function Debts() {
  const { data: debts = [], isLoading } = useDebts();
  const { data: biz } = useBusinessSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"debtors" | "invoices" | "calendar">("debtors");
  const [bucket, setBucket] = useState<string>("all");
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState<{ id: string; name: string } | null>(null);
  const [mailFor, setMailFor] = useState<{ id: string; name: string; invoiceIds?: string[] } | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const b = BUCKETS.find((x) => x.key === bucket);
    return debts.filter((d) => (!b || b.test(d)) && (!s || `${d.customer_name} ${d.customer_phone || ""} ${d.invoice_number}`.toLowerCase().includes(s)));
  }, [debts, bucket, q]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; phone: string | null; balance: number; overdue: number; since: string; count: number; oldest: number; rep: string | null }>();
    for (const d of filtered) {
      const k = d.customer_id || d.customer_name;
      const cur = m.get(k) || { id: d.customer_id, name: d.customer_name, phone: d.customer_phone, balance: 0, overdue: 0, since: d.issue_date, count: 0, oldest: 0, rep: d.salesperson_name };
      cur.balance += Number(d.balance); cur.count += 1;
      if (d.days_overdue > 0) cur.overdue += Number(d.balance);
      if (d.issue_date < cur.since) cur.since = d.issue_date;
      cur.oldest = Math.max(cur.oldest, d.days_overdue);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.balance - a.balance);
  }, [filtered]);

  const total = debts.reduce((a, d) => a + Number(d.balance), 0);
  const overdue = debts.filter((d) => d.days_overdue > 0).reduce((a, d) => a + Number(d.balance), 0);
  const in7 = debts.filter((d) => d.due_date && d.days_overdue <= 0 && d.days_overdue >= -7).reduce((a, d) => a + Number(d.balance), 0);
  const debtors = new Set(debts.map((d) => d.customer_id || d.customer_name)).size;
  const shop = biz?.business_name || "JMSURF Garage";

  const remind = (c: { name: string; phone: string | null; balance: number }) =>
    shareOnWhatsApp(c.phone, `Hello ${c.name}, this is a friendly reminder from ${shop}. Your outstanding balance is KES ${c.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}. Kindly pay at your earliest convenience. Thank you!`);

  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const sel = useSelection(byCustomer.filter((c) => c.id).map((c) => c.id!));
  /** SMS and/or email payment reminder (one message per customer listing their unpaid invoices). */
  const sendReminder = async (customerIds: string[], ch: { sms: boolean; email: boolean }, invoiceIds?: string[]) => {
    const key = (customerIds[0] || invoiceIds?.[0] || "") + (ch.sms && !ch.email ? "sms" : ch.email && !ch.sms ? "email" : "both");
    setBusy(key);
    try {
      const r: any = await erpApi("remind-payment", { customer_ids: customerIds, invoice_ids: invoiceIds || [], ...ch });
      const sent = Number(r.sms || 0) + Number(r.email || 0);
      toast({ title: sent ? `Reminder sent: ${r.sms || 0} SMS, ${r.email || 0} email` : "Nothing was sent", description: r.failed?.length ? r.failed.slice(0, 2).join(" · ") : r.skipped ? `${r.skipped} without a phone or email` : undefined, variant: sent ? undefined : "destructive" });
      sel.clear();
    } catch (e: any) { toast({ title: "Reminder not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  if (isLoading) return <OrbLoader label="Loading debts…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Debts" icon={HandCoins} description="Who owes the company, how much and since when."
        actions={<><Button variant="outline" onClick={() => navigate("/sales/reminders")}><Bell /> Reminders</Button><Button onClick={() => navigate("/sales/payments")}><Wallet /> Payments received</Button></>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Total owed" value={formatKES(total)} icon={HandCoins} tone="warning" hint={`${debts.length} unpaid invoice${debts.length === 1 ? "" : "s"}`} />
        <StatTile label="Overdue" value={formatKES(overdue)} icon={AlertTriangle} tone={overdue > 0 ? "danger" : "muted"} hint="Past the due date" />
        <StatTile label="Due in 7 days" value={formatKES(in7)} icon={CalendarDays} tone="info" />
        <StatTile label="Debtors" value={String(debtors)} icon={Users} tone="muted" />
      </StatGrid>

      <div className="grid gap-2 sm:grid-cols-5">
        {BUCKETS.map((b) => {
          const amt = debts.filter(b.test).reduce((a, d) => a + Number(d.balance), 0);
          const active = bucket === b.key;
          return (
            <button key={b.key} onClick={() => setBucket(active ? "all" : b.key)}
              className={cn("rounded-2xl border p-3 text-left transition-colors", active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className={cn("mt-1 font-display text-lg font-bold tabular-nums", b.key !== "current" && amt > 0 && "text-destructive")}>{formatKES(amt)}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["debtors", "invoices", "calendar"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-sm font-medium capitalize", tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
        <span className="flex-1" />
        {tab !== "calendar" && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, phone or invoice…" className="fi h-9 w-64 rounded-full pl-9" />
          </div>
        )}
      </div>

      {tab === "debtors" && byCustomer.length > 0 && (
        <BulkBar sel={sel} noun="debtor" className="rounded-2xl border">
          <Button size="sm" variant="outline" onClick={() => sendReminder(sel.ids, { sms: true, email: true })}><BellRing /> SMS + email reminder</Button>
          <Button size="sm" variant="outline" onClick={() => sendReminder(sel.ids, { sms: true, email: false })}><Smartphone /> SMS only</Button>
          <Button size="sm" variant="outline" onClick={() => sendReminder(sel.ids, { sms: false, email: true })}><Mail /> Email only</Button>
        </BulkBar>
      )}
      {tab === "debtors" && (byCustomer.length === 0 ? <EmptyState icon={HandCoins} title="Nobody owes the company" description="Credit sales and unpaid invoices appear here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="dt min-w-[820px]">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Customer</th><th>Owing since</th><th className="num">Invoices</th><th className="num">Oldest overdue</th><th>Sales rep</th><th className="num">Overdue</th><th className="num">Balance</th><th /></tr></thead>
            <tbody><PagedRows rows={byCustomer} colSpan={9}>{(pageRows) => pageRows.map((c) => (
              <tr key={c.id || c.name} className={cn(c.id && sel.has(c.id) && "bg-primary/5")}>
                <td data-label="">{c.id && <Tick on={sel.has(c.id)} onChange={() => sel.toggle(c.id!)} />}</td>
                <td data-label="Customer">{c.id ? <Link to={`/customers/${c.id}`} className="font-semibold text-primary">{c.name}</Link> : c.name}<p className="text-xs text-muted-foreground">{c.phone}</p></td>
                <td data-label="Owing since">{fmtDate(c.since)}</td>
                <td data-label="Invoices" className="num">{c.count}</td>
                <td data-label="Oldest overdue" className={cn("num", c.oldest > 0 && "font-semibold text-destructive")}>{c.oldest > 0 ? `${c.oldest} days` : "Not due"}</td>
                <td data-label="Sales rep">{c.rep || "—"}</td>
                <td data-label="Overdue" className="num text-destructive">{c.overdue ? formatKES(c.overdue) : "—"}</td>
                <td data-label="Balance" className="num font-bold">{formatKES(c.balance)}</td>
                <td><div className="flex justify-end gap-1">
                  {c.id && <button className="icon-btn" title="Send SMS reminder" disabled={busy === c.id + "sms"} onClick={() => sendReminder([c.id!], { sms: true, email: false })}>{busy === c.id + "sms" ? <OrbSpinner className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}</button>}
                  {c.id && <button className="icon-btn" title="Email reminder with statement and invoices" onClick={() => setMailFor({ id: c.id!, name: c.name })}><Mail className="h-4 w-4" /></button>}
                  <button className="icon-btn" title="Remind on WhatsApp" onClick={() => remind(c)}><MessageCircle className="h-4 w-4" /></button>
                  {c.id && <Button size="sm" variant="outline" onClick={() => setPaying({ id: c.id!, name: c.name })}><Wallet /> Pay</Button>}
                </div></td>
              </tr>
            ))}</PagedRows></tbody>
          </table>
        </div>
      ))}

      {tab === "invoices" && (filtered.length === 0 ? <EmptyState icon={Receipt} title="No unpaid invoices here" /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="dt min-w-[860px]">
            <thead><tr><th>Invoice#</th><th>Customer</th><th>Date (from when)</th><th>Due date</th><th className="num">Days overdue</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th><th /></tr></thead>
            <tbody><PagedRows rows={filtered} colSpan={9}>{(pageRows) => pageRows.map((d) => (
              <tr key={d.invoice_id} className="cursor-pointer" onClick={() => navigate(`/sales/invoices/${d.invoice_id}`)}>
                <td data-label="Invoice#" className="font-semibold text-primary">{d.invoice_number}{d.source === "pos" && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">POS</span>}</td>
                <td data-label="Customer">{d.customer_name}</td>
                <td data-label="Date">{fmtDate(d.issue_date)} <span className="text-xs text-muted-foreground">({d.age_days}d ago)</span></td>
                <td data-label="Due date">{d.due_date ? fmtDate(d.due_date) : "—"}</td>
                <td data-label="Days overdue" className={cn("num", d.days_overdue > 0 && "font-semibold text-destructive")}>{d.days_overdue > 0 ? d.days_overdue : "—"}</td>
                <td data-label="Amount" className="num">{formatKES(Number(d.total))}</td>
                <td data-label="Paid" className="num">{formatKES(Number(d.amount_paid))}</td>
                <td data-label="Balance" className="num font-bold">{formatKES(Number(d.balance))}</td>
                <td onClick={(e) => e.stopPropagation()}><div className="flex justify-end gap-1">
                  <button className="icon-btn" title="Send SMS reminder" onClick={() => sendReminder([], { sms: true, email: false }, [d.invoice_id])}><Smartphone className="h-4 w-4" /></button>
                  {d.customer_id && <button className="icon-btn" title="Email reminder with statement and invoices" onClick={() => setMailFor({ id: d.customer_id!, name: d.customer_name, invoiceIds: [d.invoice_id] })}><Mail className="h-4 w-4" /></button>}
                </div></td>
              </tr>
            ))}</PagedRows></tbody>
          </table>
        </div>
      ))}

      {tab === "calendar" && <DueCalendar debts={debts} />}

      {mailFor && <ReminderEmail customer={mailFor} debts={debts.filter((d) => d.customer_id === mailFor.id)} shop={shop} onClose={() => setMailFor(null)} />}
      {paying && (
        <RecordPaymentModal customer={paying} onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); qc.invalidateQueries({ queryKey: ["debts"] }); qc.invalidateQueries({ queryKey: ["zdocs"] }); }} />
      )}
    </div>
  );
}

/** Month calendar of debt due dates and repurchase reminders. */
export function DueCalendar({ debts }: { debts: Debt[] }) {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const from = new Date(month.getFullYear(), month.getMonth(), 1);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data: reminders = [] } = useQuery({
    queryKey: ["cal-reminders", tenantId, iso(from)],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("customer_reminders").select("id, due_date, title, product_name, status, customers(name)").eq("tenant_id", tenantId).gte("due_date", iso(from)).lte("due_date", iso(to)).neq("status", "dismissed")).data || [],
  });
  const start = new Date(from); start.setDate(1 - ((from.getDay() + 6) % 7)); // Monday first
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = iso(new Date());
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button size="icon" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft /></Button>
        <p className="min-w-[10rem] text-center font-display font-bold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
        <Button size="icon" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight /></Button>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-destructive" /> Debt due</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-accent" /> Repurchase</span>
      </div>
      <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = iso(d);
          const dd = debts.filter((x) => x.due_date === k);
          const rr = (reminders as any[]).filter((x) => x.due_date === k);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div key={k} className={cn("min-h-[92px] border-b border-r border-border p-1.5 text-xs", !inMonth && "bg-muted/30 text-muted-foreground/60")}>
              <p className={cn("mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full", k === today && "bg-primary font-bold text-primary-foreground")}>{d.getDate()}</p>
              <div className="space-y-0.5">
                {dd.slice(0, 3).map((x) => (
                  <button key={x.invoice_id} onClick={() => navigate(`/sales/invoices/${x.invoice_id}`)} className="block w-full truncate rounded bg-destructive/10 px-1 py-0.5 text-left text-[10px] font-medium text-destructive" title={`${x.customer_name} · ${formatKES(Number(x.balance))}`}>
                    {x.customer_name} · {formatKES(Number(x.balance))}
                  </button>
                ))}
                {rr.slice(0, 3).map((x: any) => (
                  <button key={x.id} onClick={() => navigate("/sales/reminders")} className="block w-full truncate rounded bg-accent/10 px-1 py-0.5 text-left text-[10px] font-medium text-accent dark:text-[hsl(var(--brand-teal-soft))]" title={x.title}>
                    {x.customers?.name}: {x.product_name}
                  </button>
                ))}
                {dd.length + rr.length > 6 && <p className="text-[10px] text-muted-foreground">+{dd.length + rr.length - 6} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Payment reminder by email, written like sending an invoice: the address(es), subject and message can be changed,
 * and the customer's statement and unpaid invoices are attached as PDFs.
 */
function ReminderEmail({ customer, debts, shop, onClose }: { customer: { id: string; name: string; invoiceIds?: string[] }; debts: Debt[]; shop: string; onClose: () => void }) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const due = debts.reduce((a, d) => a + Number(d.balance), 0);
  const overdue = debts.filter((d) => d.days_overdue > 0);
  const [pick, setPick] = useState<string[]>(() => (customer.invoiceIds?.length ? customer.invoiceIds : debts.map((d) => d.invoice_id)));
  const [statement, setStatement] = useState(true);
  const [subject, setSubject] = useState(`${shop}: payment reminder (${formatKES(due)})`);
  const first = customer.name.split(" ")[0] || "Customer";
  const [message, setMessage] = useState(
    `Dear ${first},\n\nThis is a friendly reminder that your account with ${shop} has an outstanding balance of ${formatKES(due)}${overdue.length ? `, of which ${formatKES(overdue.reduce((a, d) => a + Number(d.balance), 0))} is overdue` : ""}.\n\n` +
    debts.map((d) => `• ${d.invoice_number}: ${formatKES(Number(d.balance))}${d.due_date ? ` (due ${fmtDate(d.due_date)}${d.days_overdue > 0 ? `, ${d.days_overdue} days overdue` : ""})` : ""}`).join("\n") +
    `\n\nYour statement and the unpaid invoices are attached. Kindly arrange payment at your earliest convenience.\n\nThank you,\n${shop}`);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void sb.from("customers").select("email").eq("id", customer.id).maybeSingle().then(({ data }: any) => { if (data?.email) setTo((t) => t || data.email); }); }, [customer.id]);
  const send = async () => {
    const list = `${to},${cc}`.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return toast({ title: "Enter the customer's email", variant: "destructive" });
    const bad = list.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (bad) return toast({ title: `Check the address ${bad}`, variant: "destructive" });
    setBusy(true);
    try {
      const year = new Date(); const from = new Date(year.getFullYear() - 1, year.getMonth(), 1).toISOString().slice(0, 10);
      const docs = [...(statement ? [{ kind: "statement" as const, id: `${customer.id}|${from}|${year.toISOString().slice(0, 10)}` }] : []), ...pick.map((id) => ({ kind: "invoice" as const, id }))];
      await emailDocuments({ docs, to: list, subject, message, purpose: "reminders" });
      toast({ title: `Reminder emailed to ${list.join(", ")}`, description: `${docs.length} PDF${docs.length === 1 ? "" : "s"} attached` });
      onClose();
    } catch (e: any) { toast({ title: "Reminder not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Payment reminder to ${customer.name}`} icon={Mail} size="lg" locked={busy}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={send} disabled={busy}>{busy ? <OrbSpinner state="connecting" /> : <Mail />} Send</Button></>}>
      <div className="space-y-3">
        <Field label="To" required hint="Separate several addresses with commas"><input className="fi" value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@customer.co.ke" /></Field>
        <Field label="Cc"><input className="fi" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Others to copy, separated by commas" /></Field>
        <Field label="Subject" required><input className="fi" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="fi min-h-[200px]" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <div className="rounded-xl border border-border">
          <p className="border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attachments</p>
          <label className="flex items-center gap-3 px-3 py-2 text-sm"><input type="checkbox" className="accent-primary" checked={statement} onChange={(e) => setStatement(e.target.checked)} /> <FileText className="h-4 w-4 text-muted-foreground" /> Customer statement (last 12 months)</label>
          {debts.map((d) => (
            <label key={d.invoice_id} className="flex items-center gap-3 border-t border-border px-3 py-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={pick.includes(d.invoice_id)} onChange={(e) => setPick(e.target.checked ? [...pick, d.invoice_id] : pick.filter((x) => x !== d.invoice_id))} />
              <Receipt className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{d.invoice_number}{d.days_overdue > 0 && <span className="ml-2 text-xs font-semibold text-destructive">{d.days_overdue} days overdue</span>}</span>
              <span className="tabular-nums">{formatKES(Number(d.balance))}</span>
            </label>
          ))}
          <div className="flex gap-2 border-t border-border px-3 py-2 text-xs">
            <button type="button" className="font-semibold text-primary" onClick={() => setPick(debts.map((d) => d.invoice_id))}>All unpaid</button>
            <button type="button" className="font-semibold text-primary" onClick={() => setPick(overdue.map((d) => d.invoice_id))}>Overdue only</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
