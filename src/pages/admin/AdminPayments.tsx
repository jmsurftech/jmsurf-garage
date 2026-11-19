import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PagedRows } from "@/components/Pager";
import { supabase } from "@/integrations/supabase/client";
import { Banknote, CheckCircle2, Clock, XCircle, Download } from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { PageHeader, Toolbar, SearchBox, Panel, StatTile, StatGrid, TableWrap, EmptyState, StatusPill, PageLoader, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { fetchAll, downloadCsv } from "@/lib/fetchAll";

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const GATEWAY_LABELS: Record<string, string> = {
  mpesa: "M-Pesa", daraja: "M-Pesa", jmsurf: "M-Pesa", payhero: "M-Pesa", sendmoney: "M-Pesa",
  paystack: "Paystack", manual: "Manual", bank: "Bank",
};
const gatewayLabel = (g?: string) => GATEWAY_LABELS[String(g || "").toLowerCase()] || (g ? g[0].toUpperCase() + g.slice(1) : "—");
const isPaid = (s: string) => s === "completed" || s === "success";
/** One list for every product JMSURF sells. */
type Pay = { id: string; product: "DASH" | "JMSURF Mail" | "Call Centre"; what: string; tenant_id: string; amount: number; currency: string; gateway: string; reference: string; status: string; created_at: string };
const sb: any = supabase;

export default function AdminPayments() {
  const [search, setSearch] = useState("");
  const [gateway, setGateway] = useState("all");
  const [status, setStatus] = useState("all");
  const [product, setProduct] = useState("all");
  const [from, setFrom] = useState(format(subDays(new Date(), 89), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: async () => {
      const [dash, mail, cc, tenantList] = await Promise.all([
        fetchAll(() => sb.from("subscription_payments").select("id, tenant_id, amount, gateway, status, reference, metadata, created_at").order("created_at", { ascending: false })),
        fetchAll(() => sb.from("mail_payments").select("id, tenant_id, amount, currency, provider, status, reference, receipt, plan_name, months, created_at").order("created_at", { ascending: false })).catch(() => []),
        fetchAll(() => sb.from("cc_payments").select("id, tenant_id, amount, gateway, status, reference, receipt, purpose, months, created_at").order("created_at", { ascending: false })).catch(() => []),
        fetchAll(() => sb.from("tenants").select("id, business_name, slug")),
      ]);
      const names: Record<string, string> = {};
      (tenantList as any[]).forEach((t) => { names[t.id] = t.business_name || t.slug; });
      const payments: Pay[] = [
        ...(dash as any[]).map((p) => ({ id: p.id, product: "DASH" as const, what: p.metadata?.plan_name || p.metadata?.plan || "Package", tenant_id: p.tenant_id, amount: Number(p.amount || 0), currency: "KES", gateway: p.gateway, reference: p.reference || "", status: p.status, created_at: p.created_at })),
        ...(mail as any[]).map((p) => ({ id: p.id, product: "JMSURF Mail" as const, what: `${p.plan_name || "Plan"}${p.months ? ` · ${p.months} mo` : ""}`, tenant_id: p.tenant_id, amount: Number(p.amount || 0), currency: p.currency || "KES", gateway: p.provider || "mpesa", reference: p.receipt || p.reference || "", status: p.status, created_at: p.created_at })),
        ...(cc as any[]).map((p) => ({ id: p.id, product: "Call Centre" as const, what: p.purpose || "Plan", tenant_id: p.tenant_id, amount: Number(p.amount || 0), currency: "KES", gateway: p.gateway || "mpesa", reference: p.receipt || p.reference || "", status: p.status, created_at: p.created_at })),
      ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { payments, names };
    },
  });

  const payments = data?.payments || [];
  const names = data?.names || {};
  const gateways = useMemo(() => Array.from(new Set(payments.map((p) => gatewayLabel(p.gateway)))).sort(), [payments]);

  const filtered = useMemo(() => {
    const start = startOfDay(new Date(from)).getTime();
    const end = endOfDay(new Date(to)).getTime();
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      const t = new Date(p.created_at).getTime();
      if (t < start || t > end) return false;
      if (gateway !== "all" && gatewayLabel(p.gateway) !== gateway) return false;
      if (status !== "all" && (status === "completed" ? !isPaid(p.status) : p.status !== status)) return false;
      if (product !== "all" && p.product !== product) return false;
      if (!q) return true;
      return (names[p.tenant_id] || "").toLowerCase().includes(q) || String(p.reference || "").toLowerCase().includes(q);
    });
  }, [payments, names, search, gateway, status, product, from, to]);

  const paid = filtered.filter((p) => isPaid(p.status));
  const totals = {
    revenue: paid.filter((p) => p.currency !== "USD").reduce((a, p) => a + Number(p.amount || 0), 0),
    usd: paid.filter((p) => p.currency === "USD").reduce((a, p) => a + Number(p.amount || 0), 0),
    paid: paid.length,
    pending: filtered.filter((p) => p.status === "pending").length,
    failed: filtered.filter((p) => p.status === "failed" || p.status === "cancelled").length,
  };

  const exportCsv = () => downloadCsv(`jmsurf-payments-${from}-to-${to}.csv`, ["Date", "Product", "For", "Company", "Amount", "Currency", "Method", "Reference", "Status"],
    filtered.map((p) => [format(new Date(p.created_at), "yyyy-MM-dd HH:mm"), p.product, p.what, names[p.tenant_id] || "", p.amount, p.currency, gatewayLabel(p.gateway), p.reference, p.status]));

  if (isLoading) return <div className="p-4 sm:p-6"><PageLoader label="Loading payments…" /></div>;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="Payments" description="Every payment to JMSURF: DASH packages and modules, JMSURF Mail plans and Call Centre plans and numbers." icon={Banknote}
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}><Download /> Export CSV</Button>} />

      <StatGrid>
        <StatTile label="Collected" value={ksh(totals.revenue)} icon={Banknote} tone="success" hint={totals.usd ? `+ US$ ${totals.usd.toLocaleString()} by card` : "In the selected period"} />
        <StatTile label="Paid" value={totals.paid} icon={CheckCircle2} tone="success" />
        <StatTile label="Pending" value={totals.pending} icon={Clock} tone="warning" />
        <StatTile label="Failed or cancelled" value={totals.failed} icon={XCircle} tone="danger" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Company or reference…" />
        <input type="date" className="fi w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="fi w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="fi w-auto" value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
          <option value="all">All products</option><option>DASH</option><option>JMSURF Mail</option><option>Call Centre</option>
        </select>
        <select className="fi w-auto" value={gateway} onChange={(e) => setGateway(e.target.value)} aria-label="Gateway">
          <option value="all">All methods</option>
          {gateways.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="fi w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="completed">Paid</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Toolbar>

      <Panel flush>
        {filtered.length === 0 ? <EmptyState icon={Banknote} title="No payments in this view" description="Try a wider date range or clear the filters." /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Date</th><th>Product</th><th>Company</th><th className="num">Amount</th><th>Method</th><th className="hidden md:table-cell">Reference</th><th>Status</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={7}>{(rows) => rows.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap text-muted-foreground">{format(new Date(p.created_at), "d MMM yyyy, HH:mm")}</td>
                    <td><Pill tone={p.product === "DASH" ? "primary" : p.product === "JMSURF Mail" ? "info" : "warning"}>{p.product}</Pill><span className="block text-[11px] text-muted-foreground">{p.what}</span></td>
                    <td className="max-w-[220px] truncate font-medium">{names[p.tenant_id] || "Unknown company"}</td>
                    <td className="num font-semibold">{p.currency === "USD" ? `US$ ${p.amount.toLocaleString()}` : ksh(p.amount)}</td>
                    <td><Pill tone="muted">{gatewayLabel(p.gateway)}</Pill></td>
                    <td className="hidden font-mono text-xs text-muted-foreground md:table-cell">{p.reference || "—"}</td>
                    <td><StatusPill status={p.status === "success" ? "completed" : p.status} /></td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
