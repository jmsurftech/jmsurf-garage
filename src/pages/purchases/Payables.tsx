import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, AlertTriangle, CalendarDays, Truck, Banknote, Search, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Button } from "@/components/ui/button";
import { PageHeader, StatGrid, StatTile, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
type Payable = { id: string; number: string; supplier_id: string | null; supplier: string; bill_date: string | null; due_date: string | null; amount: number; paid: number; balance: number; days_overdue: number; age_days: number };

const BUCKETS = [
  { key: "current", label: "Not yet due", test: (d: Payable) => d.days_overdue <= 0 },
  { key: "1-30", label: "1–30 days overdue", test: (d: Payable) => d.days_overdue >= 1 && d.days_overdue <= 30 },
  { key: "31-60", label: "31–60 days", test: (d: Payable) => d.days_overdue >= 31 && d.days_overdue <= 60 },
  { key: "61-90", label: "61–90 days", test: (d: Payable) => d.days_overdue >= 61 && d.days_overdue <= 90 },
  { key: "90+", label: "Over 90 days", test: (d: Payable) => d.days_overdue > 90 },
];
const dayMs = 86400000;
const today = () => Date.parse(new Date().toISOString().slice(0, 10));

/** Purchases → Payables: what the company owes its vendors, how much is overdue and since when. */
export default function Payables() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"vendors" | "bills">("vendors");
  const [bucket, setBucket] = useState("all");
  const [q, setQ] = useState("");

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["payables", tenantId], enabled: !!tenantId,
    queryFn: async (): Promise<Payable[]> => {
      const [b, s] = await Promise.all([
        sb.from("bills").select("id,name,bill_number,supplier_id,bill_date,due_date,amount,amount_paid,status,created_at").eq("tenant_id", tenantId).not("status", "in", "(draft,void,paid)").limit(5000),
        sb.from("suppliers").select("id,name").eq("tenant_id", tenantId),
      ]);
      const names = new Map(((s.data || []) as any[]).map((x) => [x.id, x.name]));
      const t = today();
      return ((b.data || []) as any[]).map((x) => {
        const balance = Math.round((Number(x.amount || 0) - Number(x.amount_paid || 0)) * 100) / 100;
        const issued = x.bill_date || String(x.created_at).slice(0, 10);
        return { id: x.id, number: x.bill_number || x.name, supplier_id: x.supplier_id, supplier: names.get(x.supplier_id) || x.name || "Vendor", bill_date: issued, due_date: x.due_date,
          amount: Number(x.amount || 0), paid: Number(x.amount_paid || 0), balance,
          days_overdue: x.due_date ? Math.floor((t - Date.parse(x.due_date)) / dayMs) : 0, age_days: Math.max(0, Math.floor((t - Date.parse(issued)) / dayMs)) };
      }).filter((x) => x.balance > 0.005).sort((a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")));
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const b = BUCKETS.find((x) => x.key === bucket);
    return bills.filter((d) => (!b || b.test(d)) && (!s || `${d.supplier} ${d.number}`.toLowerCase().includes(s)));
  }, [bills, bucket, q]);
  const byVendor = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; balance: number; overdue: number; since: string; count: number; oldest: number }>();
    for (const d of filtered) {
      const k = d.supplier_id || d.supplier;
      const cur = m.get(k) || { id: d.supplier_id, name: d.supplier, balance: 0, overdue: 0, since: d.bill_date || "", count: 0, oldest: 0 };
      cur.balance += d.balance; cur.count += 1;
      if (d.days_overdue > 0) cur.overdue += d.balance;
      if (d.bill_date && d.bill_date < cur.since) cur.since = d.bill_date;
      cur.oldest = Math.max(cur.oldest, d.days_overdue);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.balance - a.balance);
  }, [filtered]);

  const total = bills.reduce((a, d) => a + d.balance, 0);
  const overdue = bills.filter((d) => d.days_overdue > 0).reduce((a, d) => a + d.balance, 0);
  const in7 = bills.filter((d) => d.due_date && d.days_overdue <= 0 && d.days_overdue >= -7).reduce((a, d) => a + d.balance, 0);
  const vendors = new Set(bills.map((d) => d.supplier_id || d.supplier)).size;

  if (isLoading) return <OrbLoader label="Loading payables…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Payables" icon={HandCoins} description="What the company owes its vendors, how much and since when."
        actions={<><Button variant="outline" onClick={() => navigate("/purchases/bills")}><Receipt /> Bills</Button><Button onClick={() => navigate("/purchases/payments")}><Banknote /> Payments made</Button></>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Total owed" value={formatKES(total)} icon={HandCoins} tone="warning" hint={`${bills.length} unpaid bill${bills.length === 1 ? "" : "s"}`} />
        <StatTile label="Overdue" value={formatKES(overdue)} icon={AlertTriangle} tone={overdue > 0 ? "danger" : "muted"} hint="Past the due date" />
        <StatTile label="Due in 7 days" value={formatKES(in7)} icon={CalendarDays} tone="info" />
        <StatTile label="Vendors owed" value={String(vendors)} icon={Truck} tone="muted" />
      </StatGrid>

      <div className="grid gap-2 sm:grid-cols-5">
        {BUCKETS.map((b) => {
          const amt = bills.filter(b.test).reduce((a, d) => a + d.balance, 0);
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
        {(["vendors", "bills"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-sm font-medium capitalize", tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
        <span className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor or bill…" className="fi h-9 w-64 rounded-full pl-9" />
        </div>
      </div>

      {tab === "vendors" && (byVendor.length === 0 ? <EmptyState icon={HandCoins} title="The company owes no vendor" description="Unpaid bills appear here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="dt min-w-[720px]">
            <thead><tr><th>Vendor</th><th>Owing since</th><th className="num">Bills</th><th className="num">Oldest overdue</th><th className="num">Overdue</th><th className="num">Balance</th><th /></tr></thead>
            <tbody><PagedRows rows={byVendor} colSpan={7}>{(pageRows) => pageRows.map((c) => (
              <tr key={c.id || c.name}>
                <td data-label="Vendor">{c.id ? <Link to={`/purchases/suppliers?open=${c.id}`} className="font-semibold text-primary">{c.name}</Link> : c.name}</td>
                <td data-label="Owing since">{fmtDate(c.since)}</td>
                <td data-label="Bills" className="num">{c.count}</td>
                <td data-label="Oldest overdue" className={cn("num", c.oldest > 0 && "font-semibold text-destructive")}>{c.oldest > 0 ? `${c.oldest} days` : "Not due"}</td>
                <td data-label="Overdue" className="num text-destructive">{c.overdue ? formatKES(c.overdue) : "—"}</td>
                <td data-label="Balance" className="num font-bold">{formatKES(c.balance)}</td>
                <td><div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => { setTab("bills"); setQ(c.name); }}>See bills</Button></div></td>
              </tr>
            ))}</PagedRows></tbody>
          </table>
        </div>
      ))}

      {tab === "bills" && (filtered.length === 0 ? <EmptyState icon={Receipt} title="No unpaid bills here" /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="dt min-w-[820px]">
            <thead><tr><th>Bill#</th><th>Vendor</th><th>Bill date</th><th>Due date</th><th className="num">Days overdue</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody><PagedRows rows={filtered} colSpan={8}>{(pageRows) => pageRows.map((d) => (
              <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/purchases/bills/${d.id}`)}>
                <td data-label="Bill#" className="font-semibold text-primary">{d.number}</td>
                <td data-label="Vendor">{d.supplier}</td>
                <td data-label="Bill date">{fmtDate(d.bill_date)} <span className="text-xs text-muted-foreground">({d.age_days}d ago)</span></td>
                <td data-label="Due date">{d.due_date ? fmtDate(d.due_date) : "—"}</td>
                <td data-label="Days overdue" className={cn("num", d.days_overdue > 0 && "font-semibold text-destructive")}>{d.days_overdue > 0 ? d.days_overdue : "—"}</td>
                <td data-label="Amount" className="num">{formatKES(d.amount)}</td>
                <td data-label="Paid" className="num">{formatKES(d.paid)}</td>
                <td data-label="Balance" className="num font-bold">{formatKES(d.balance)}</td>
              </tr>
            ))}</PagedRows></tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
