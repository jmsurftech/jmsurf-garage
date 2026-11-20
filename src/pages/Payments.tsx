import "@/styles/clean.css";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import Pager, { PagedRows } from "@/components/Pager";
import { useNavigate, useParams } from "react-router-dom";
import { CreditCard, Search, Banknote, Smartphone, ArrowDownUp, Download, Wallet, RefreshCw, X, Eye, Plus, Printer } from "lucide-react";
import ReceiptModal from "@/components/ReceiptModal";
import { useBusinessSettings, usePagedTransactions, useTransactionsSummary, fetchAllTransactions, type SalesFilters } from "@/hooks/useData";
import { formatKES, formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { exportSalesCSV, exportSalesPDF, exportSalesExcel, exportItemsCSV, itemsSummary, methodLabel } from "@/lib/exportUtils";
import { tenantPath } from "@/lib/host";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const METHOD_ICONS: Record<string, any> = {
  cash: Banknote,
  mpesa: Smartphone,
  card: CreditCard,
  credit: Wallet,
};

export default function Payments() {
  const { data: bizSettings } = useBusinessSettings();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cashierFilter, setCashierFilter] = useState("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [reprintTx, setReprintTx] = useState<any>(null);
  const navigate = useNavigate();
  const { slug } = useParams();
  const [periodView, setPeriodView] = useState<"week" | "month" | "year">("month");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const tenantId = useTenantId();

  // Filters are applied by the database; the list only ever holds one page.
  const filters: SalesFilters = useMemo(() => ({
    from: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : null,
    to: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : null,
    method: methodFilter,
    status: statusFilter,
    cashier: cashierFilter,
    search,
    ascending: sortDir === "asc",
  }), [dateFrom, dateTo, methodFilter, statusFilter, cashierFilter, search, sortDir]);
  useEffect(() => { setPage(1); }, [filters, pageSize]);

  const { data: pageData, isLoading, isFetching } = usePagedTransactions(filters, page, pageSize);
  const { data: summary } = useTransactionsSummary(filters);
  const filtered: any[] = pageData?.rows || [];

  // Completed sales (date and amount only) for the week / month / year table.
  const { data: completedLite = [] } = useQuery({
    queryKey: ["transactions", tenantId, "completed-lite"],
    enabled: !!tenantId,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("created_at,total")
        .eq("tenant_id", tenantId!).eq("status", "completed").neq("payment_method", "credit_note")
        .order("created_at", { ascending: false }).limit(20_000);
      if (error) throw error;
      return data || [];
    },
  });

  // Build a ReceiptModal-shaped payload from a stored transaction row
  const buildReceiptForTx = (tx: any) => ({
    id: tx.id,
    items: Array.isArray(tx.items) ? tx.items : [],
    subtotal: Number(tx.subtotal || 0),
    tax: Number(tx.tax || 0),
    discount: Number(tx.discount || 0),
    total: Number(tx.total || 0),
    payment_method: tx.payment_method || "cash",
    customer_name: tx.customer_name || "Walk-in",
    cashier_name: tx.cashier_name || "",
    created_at: tx.created_at,
    mpesa_ref: tx.mpesa_ref || null,
    customer_phone: tx.customer_phone || "",
    customer_email: tx.customer_email || "",
  });

  const businessName = (bizSettings as any)?.business_name || "JMSURF Garage";

  const cashiers = useMemo(() => [...(summary?.cashiers || [])].sort(), [summary]);

  const stats = {
    total: Number(summary?.total || 0),
    cash: Number(summary?.cash || 0),
    mpesa: Number(summary?.mpesa || 0),
    card: Number(summary?.card || 0),
    credit: Number(summary?.credit || 0),
    count: Number(summary?.count || 0),
    pending: Number(summary?.pending || 0),
  };
  // Period-based aggregation for week / month / year breakdowns
  const periodBreakdown = useMemo(() => {
    const completed = completedLite as any[];
    const buckets = new Map<string, { key: string; label: string; total: number; count: number; sortKey: string }>();
    const pad = (n: number) => String(n).padStart(2, "0");
    const getISOWeek = (d: Date) => {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dayNum + 3);
      const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      const wk = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
      return { year: t.getUTCFullYear(), week: wk };
    };
    completed.forEach((t: any) => {
      const d = new Date(t.created_at);
      let key = "", label = "", sortKey = "";
      if (periodView === "year") {
        key = String(d.getFullYear());
        label = key;
        sortKey = key;
      } else if (periodView === "month") {
        key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        sortKey = key;
      } else {
        const { year, week } = getISOWeek(d);
        key = `${year}-W${pad(week)}`;
        label = `Week ${week}, ${year}`;
        sortKey = key;
      }
      const existing = buckets.get(key) || { key, label, total: 0, count: 0, sortKey };
      existing.total += Number(t.total || 0);
      existing.count += 1;
      buckets.set(key, existing);
    });
    return Array.from(buckets.values()).sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 12);
  }, [completedLite, periodView]);


  const stamp = () => new Date().toISOString().slice(0, 10);
  const [exporting, setExporting] = useState(false);
  const withAll = async (fn: (rows: any[]) => void) => {
    setExporting(true);
    try { fn(await fetchAllTransactions(filters)); } finally { setExporting(false); }
  };
  const handleExportCSV = () => withAll((rows) => exportSalesCSV(rows as any, `${businessName}_payments_${stamp()}.csv`));
  const handleExportExcel = () => withAll((rows) => exportSalesExcel(rows as any, `${businessName}_payments_${stamp()}.xlsx`));
  const handleExportItems = () => withAll((rows) => exportItemsCSV(rows as any, `${businessName}_items_sold_${stamp()}.csv`));

  const handleExportPDF = () => withAll((all) => {
    const filtered = all;
    const completed = filtered.filter((t: any) => t.status === "completed");
    const totals = {
      sales: completed.reduce((s: number, t: any) => s + Number(t.total), 0),
      vat: completed.reduce((s: number, t: any) => s + Number(t.tax), 0),
      profit: 0,
      count: completed.length,
    };
    exportSalesPDF(filtered as any, totals, `${businessName}_payments_${new Date().toISOString().slice(0, 10)}.pdf`);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Payments</h1>
          <p className="text-sm text-muted-foreground">View and filter all payment transactions</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate(tenantPath(slug, "/payments/record"))} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
            <Plus className="w-4 h-4" /> Record Payment
          </button>
          <button onClick={handleExportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={handleExportPDF} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80">
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
          <button onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={handleExportItems} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80">
            <Download className="w-3.5 h-3.5" /> Items CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="text-xl font-bold mt-1">{formatKES(stats.total)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Banknote className="w-3 h-3" /> Cash</p>
          <p className="text-xl font-bold mt-1">{formatKES(stats.cash)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Smartphone className="w-3 h-3" /> M-Pesa</p>
          <p className="text-xl font-bold mt-1">{formatKES(stats.mpesa)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><CreditCard className="w-3 h-3" /> Card</p>
          <p className="text-xl font-bold mt-1">{formatKES(stats.card)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" /> Credit</p>
          <p className="text-xl font-bold mt-1">{formatKES(stats.credit)}</p>
        </div>
      </div>

      {stats.pending > 0 && (
        <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-warning animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-warning">{stats.pending} pending payment{stats.pending !== 1 ? "s" : ""}</p>
            <p className="text-xs text-muted-foreground">Pending payments will auto-resolve or timeout.</p>
          </div>
        </div>
      )}
      {/* Period Breakdown — week / month / year */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-display font-semibold">Revenue by {periodView}</p>
            <p className="text-xs text-muted-foreground">Completed sales grouped by {periodView}. Showing latest 12.</p>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(["week", "month", "year"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriodView(p)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors",
                  periodView === p ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p === "week" ? "Per Week" : p === "month" ? "Per Month" : "Per Year"}
              </button>
            ))}
          </div>
        </div>
        {periodBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No completed sales yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-medium capitalize">{periodView}</th>
                  <th className="text-right py-2 font-medium">Sales</th>
                  <th className="text-right py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                <PagedRows rows={periodBreakdown} colSpan={3}>{(pageRows) => pageRows.map(b => (
                  <tr key={b.key} className="border-b border-border last:border-0">
                    <td className="py-2">{b.label}</td>
                    <td className="text-right py-2 text-muted-foreground">{b.count}</td>
                    <td className="text-right py-2 font-semibold">{formatKES(b.total)}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, cashier, item, M-Pesa ref..." className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-input text-sm" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-input text-sm" />
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-input text-sm">
          <option value="all">All Methods</option>
          <option value="cash">Cash</option>
          <option value="mpesa">M-Pesa</option>
          <option value="card">Card / Paystack</option>
          <option value="credit">Credit</option>
          <option value="split">Split</option>
          <option value="mobile_money">Mobile money</option>
        </select>
        <select value={cashierFilter} onChange={(e) => setCashierFilter(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-input text-sm">
          <option value="all">All cashiers</option>
          {cashiers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-input text-sm">
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")} className="p-2.5 rounded-xl bg-card border border-input hover:bg-muted">
          <ArrowDownUp className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{stats.count.toLocaleString()} payment{stats.count !== 1 ? "s" : ""} found{exporting ? " · preparing export…" : ""}</p>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading payments...</div>
      ) : stats.count === 0 && filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No payments match your filters</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Items</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Method</th>
                  <th className="text-left px-4 py-3 font-medium">Ref / ID</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Cashier</th>
                  <th className="w-24 text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx: any) => {
                  const Icon = METHOD_ICONS[tx.payment_method] || CreditCard;
                  const d = new Date(tx.created_at);
                  return (
                    <tr key={tx.id} onClick={() => setSelectedTx(tx)} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                      <td className="px-4 py-3">
                        <p className="font-medium">{formatDate(d)}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(d)}</p>
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="truncate" title={itemsSummary(tx)}>{itemsSummary(tx) || "—"}</p>
                        {Array.isArray(tx.items) && tx.items.length > 0 && (
                          <p className="text-xs text-muted-foreground">{tx.items.length} line{tx.items.length !== 1 ? "s" : ""}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">{tx.customer_name || "Walk-in"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 capitalize">
                          <Icon className="w-3.5 h-3.5" />
                          {methodLabel(tx.payment_method)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{tx.mpesa_ref || tx.id.slice(0, 8).toUpperCase()}</td>
                      <td className={cn("px-4 py-3 text-right font-medium", Number(tx.total) < 0 && "text-destructive")}>
                        {Number(tx.refunded_amount) > 0 ? (<>
                          <span className="block text-xs text-muted-foreground line-through">{formatKES(tx.total)}</span>
                          {formatKES(Number(tx.total) - Number(tx.refunded_amount))}
                        </>) : formatKES(tx.total)}
                        {tx.refund_of && <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">Refund</span>}
                        {tx.is_exchange && <span className="ml-1.5 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info" title={`${formatKES(Number(tx.discount))} came from returned items`}>Exchange</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const back = Number(tx.refunded_amount) > 0 && tx.status === "completed";
                          const full = back && Number(tx.refunded_amount) >= Number(tx.total) - 0.01;
                          const label = full ? "Returned" : back ? "Part returned" : tx.status;
                          return <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", back ? "bg-warning/15 text-[hsl(32_90%_38%)]" : STATUS_COLORS[tx.status] || "bg-muted text-muted-foreground")}>{label}</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{tx.cashier_name}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setReprintTx(tx)}
                            disabled={tx.status !== "completed"}
                            title={tx.status !== "completed" ? "Receipt only available for completed sales" : "Reprint receipt"}
                            className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          <button onClick={() => setSelectedTx(tx)} className="p-1.5 rounded-md hover:bg-muted" title="View details">
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={pageData?.total || 0} onPage={setPage} onPageSize={setPageSize} loading={isFetching} />
        </div>
      )}

      {selectedTx && <TransactionDetail tx={selectedTx} onClose={() => setSelectedTx(null)} onReprint={() => setReprintTx(selectedTx)} />}
      {reprintTx && <ReceiptModal receipt={buildReceiptForTx(reprintTx) as any} onClose={() => setReprintTx(null)} />}
    </div>
  );
}


function TransactionDetail({ tx, onClose, onReprint }: { tx: any; onClose: () => void; onReprint?: () => void }) {
  const d = new Date(tx.created_at);
  const items = (tx.items as any[]) || [];
  const isMpesa = tx.payment_method === "mpesa";
  const errorPayload = tx.mpesa_error_payload as any;
  const errorMessage = tx.mpesa_error_message as string | null;
  const canReprint = tx.status === "completed";

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 side-pop flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg">Transaction Details</h2>
          <div className="flex items-center gap-1">
            {onReprint && (
              <button
                onClick={onReprint}
                disabled={!canReprint}
                title={canReprint ? "Reprint receipt" : "Receipt only available for completed sales"}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-3.5 h-3.5" /> Reprint
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
          </div>
        </div>
        
        <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(85vh-4rem)]">
          <div className="flex items-center justify-between">
            <span className={cn("px-3 py-1.5 rounded-full text-sm font-medium capitalize", STATUS_COLORS[tx.status] || "bg-muted text-muted-foreground")}>{tx.status}</span>
            <span className="text-2xl font-display font-bold">{formatKES(tx.total)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Method</p>
              <p className="text-sm font-medium capitalize mt-0.5">{tx.payment_method === "mpesa" ? "M-Pesa" : tx.payment_method}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Date & Time</p>
              <p className="text-sm font-medium mt-0.5">{formatDate(d)} {formatTime(d)}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Customer</p>
              <p className="text-sm font-medium mt-0.5">{tx.customer_name || "Walk-in"}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Cashier</p>
              <p className="text-sm font-medium mt-0.5">{tx.cashier_name || "—"}</p>
            </div>
          </div>

          {isMpesa && (
            <div className="bg-success/5 border border-success/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-success" />
                <p className="text-sm font-semibold text-success">M-Pesa Details</p>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checkout Request ID</span>
                <span className="font-mono text-xs">{tx.mpesa_ref || "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Transaction ID</span>
                <span className="font-mono text-xs">{tx.id.slice(0, 12).toUpperCase()}</span>
              </div>
              {tx.status === "pending" && <p className="text-xs text-warning mt-2">⏳ Awaiting confirmation from Safaricom.</p>}
              {tx.status === "cancelled" && <p className="text-xs text-muted-foreground mt-2">Customer cancelled the STK push prompt.</p>}
              {tx.status === "failed" && <p className="text-xs text-destructive mt-2">Payment failed.</p>}
            </div>
          )}

          {(errorMessage || errorPayload) && (tx.status === "failed" || tx.status === "cancelled") && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive">M-Pesa Error Details</p>
              {errorMessage && (
                <p className="text-xs text-destructive break-words">{errorMessage}</p>
              )}
              {errorPayload && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Raw callback payload ({errorPayload.source || "unknown source"})
                  </summary>
                  <pre className="mt-2 p-2 bg-background rounded-md overflow-x-auto text-[10px] leading-tight max-h-64 whitespace-pre-wrap break-all">
{JSON.stringify(errorPayload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {items.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Items ({items.length})</p>
              <div className="bg-muted/30 rounded-xl divide-y divide-border">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity} × {formatKES(item.price)}</p>
                    </div>
                    <span className="font-medium">{formatKES(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatKES(tx.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT (incl.)</span><span>{formatKES(tx.tax)}</span></div>
            {tx.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{formatKES(tx.discount)}</span></div>}
            <div className="flex justify-between pt-2 border-t border-border font-display font-bold text-base"><span>Total</span><span>{formatKES(tx.total)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
