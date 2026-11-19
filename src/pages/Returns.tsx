import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2, Search, Receipt, Minus, Plus, CheckCircle2, PackageCheck, Wallet, Repeat, Trash2, Smartphone, Banknote, CreditCard, Landmark, UserRound, XCircle, Check } from "lucide-react";
import { useProducts, useBusinessSettings } from "@/hooks/useData";
import { useVariantsByProduct } from "@/hooks/useVariants";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import Pager, { PagedRows, usePaged } from "@/components/Pager";
import { PageHeader, Panel, TableWrap, EmptyState, Modal, StatTile, StatGrid, Toolbar, SearchBox, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sendSalePrompt, checkSalePrompt } from "@/lib/salePrompt";
import { Orb, OrbLoader } from "@/components/Orb";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;
const METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "mpesa", label: "M-Pesa", icon: Smartphone },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "bank_transfer", label: "Bank", icon: Landmark },
  { value: "credit", label: "Account", icon: UserRound },
];
const methodLabel = (m: string) => m === "credit_note" ? "Exchange credit" : METHODS.find((x) => x.value === m)?.label || m;
const receiptNo = (id: string) => id.slice(0, 8).toUpperCase();
const lineKey = (l: any) => `${l.product_id || l.id}|${l.variant_id || ""}`;
const PROMPT_PROVIDERS = ["jmsurf", "daraja", "mpesa", "payhero", "bank"];

export default function Returns() {
  const tenantId = useTenantId();
  const { tenant } = useTenant() as any;
  const { role } = useAuth();
  const canReturn = ["admin", "manager", "super_admin", "cashier", "sales_person"].includes(String(role));
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();

  const [code, setCode] = useState("");
  const [sale, setSale] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("cash");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [mode, setMode] = useState<"refund" | "exchange">("refund");
  const [newItems, setNewItems] = useState<{ key: string; product_id: string; variant_id: string | null; name: string; price: number; quantity: number }[]>([]);
  const [find, setFind] = useState("");
  const { data: products = [] } = useProducts();
  const { map: variantMap } = useVariantsByProduct();

  const shop = {
    provider: (biz as any)?.payment_provider, tenantId: tenant?.id || tenantId, tenantSlug: tenant?.slug,
    accountRef: (biz as any)?.mpesa_account_reference || (biz as any)?.business_name,
  };
  const canPrompt = PROMPT_PROVIDERS.includes(String(shop.provider)) && (biz as any)?.mpesa_ready !== false;

  const { data: history = [] } = useQuery({
    queryKey: ["sale-returns", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("sale_returns").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Recent sales are listed straight away; typing filters them.
  const SALE_COLS = "id, created_at, total, refunded_amount, customer_id, customer_name, cashier_name, payment_method, items, location_id";
  const { data: recent = [], isLoading: loadingRecent } = useQuery({
    queryKey: ["return-recent", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { data, error } = await sb.from("transactions").select(SALE_COLS)
        .eq("tenant_id", tenantId).eq("status", "completed").is("refund_of", null).gt("total", 0)
        .gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data || [];
    },
  });
  // Older sales: looked up by receipt number when nothing recent matches.
  const q = code.trim();
  const { data: older = [], isFetching: searching } = useQuery({
    queryKey: ["return-search", tenantId, q],
    enabled: !!tenantId && /^[0-9a-f]{4,8}$/i.test(q),
    queryFn: async () => {
      const p = q.toLowerCase().padEnd(8, "0"), hi = q.toLowerCase().padEnd(8, "f");
      const { data, error } = await sb.from("transactions").select(SALE_COLS)
        .eq("tenant_id", tenantId).eq("status", "completed").is("refund_of", null).gt("total", 0)
        .gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${hi}-ffff-ffff-ffff-ffffffffffff`).limit(20);
      if (error) throw error;
      return data || [];
    },
  });
  const matches = useMemo(() => {
    const t = q.toLowerCase();
    const list = [...recent, ...older.filter((o: any) => !recent.some((r: any) => r.id === o.id))];
    if (!t) return list;
    return list.filter((s: any) => {
      const hay = `${s.id.slice(0, 8)} ${s.customer_name || "walk-in"} ${s.cashier_name || ""} ${s.total} ${(s.items || []).map((i: any) => i.name).join(" ")}`.toLowerCase();
      return hay.includes(t);
    });
  }, [recent, older, q]);
  const paged = usePaged(matches, 25);

  const alreadyReturned = useMemo(() => {
    const m: Record<string, number> = {};
    if (!sale) return m;
    history.filter((r: any) => r.transaction_id === sale.id).forEach((r: any) =>
      (r.items || []).forEach((i: any) => { const k = `${i.product_id}|${i.variant_id || ""}`; m[k] = (m[k] || 0) + Number(i.quantity || 0); }));
    return m;
  }, [sale, history]);

  const saleLines = (sale?.items || []) as any[];
  const itemsTotal = saleLines.reduce((a, l) => a + Number(l.price || 0) * Number(l.quantity || 0), 0);
  const factor = itemsTotal > 0 ? Math.min(1, Number(sale?.total || 0) / itemsTotal) : 1;
  const refund = Math.round(saleLines.reduce((a, l) => a + Number(l.price || 0) * (qty[lineKey(l)] || 0), 0) * factor * 100) / 100;
  const chosen = Object.values(qty).some((n) => n > 0);
  const newTotal = newItems.reduce((a, i) => a + i.price * i.quantity, 0);
  const difference = mode === "exchange" ? Math.round((newTotal - refund) * 100) / 100 : -refund;
  const customerPays = difference > 0;
  const prompting = customerPays && method === "mpesa" && canPrompt;

  const pick = (s: any) => {
    setSale(s); setQty({}); setMethod(s.payment_method === "mpesa" ? "mpesa" : s.payment_method === "card" ? "card" : "cash");
    setPhone(""); setReason(""); setRestock(true); setMode("refund"); setNewItems([]); setFind("");
  };
  const addNew = (p: any, v?: any) => {
    const key = `${p.id}|${v?.id || ""}`;
    const name = v ? `${p.name} · ${[v.size, v.color].filter(Boolean).join(" / ")}` : p.name;
    const price = Number(v && Number(v.price) > 0 ? v.price : p.price);
    setNewItems((list) => list.some((i) => i.key === key) ? list.map((i) => i.key === key ? { ...i, quantity: i.quantity + 1 } : i)
      : [...list, { key, product_id: p.id, variant_id: v?.id || null, name, price, quantity: 1 }]);
    setFind("");
  };
  const found = find.trim().length < 2 ? [] : (products as any[]).filter((p) => `${p.name} ${p.barcode || ""}`.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 8);

  const refresh = () => ["sale-returns", "transactions", "product-stocks", "products", "product-variants", "customers", "return-search", "return-recent", "payments"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const submit = async () => {
    if (!sale || !chosen) return;
    if (mode === "exchange" && newItems.length === 0) { toast({ title: "Add what the customer is taking instead", variant: "destructive" }); return; }
    if (prompting && !/^(?:\+?254|0)?[17]\d{8}$/.test(phone.replace(/\s/g, ""))) { toast({ title: "Enter the customer's M-Pesa number", variant: "destructive" }); return; }
    if (prompting && Math.round(difference) !== difference) { toast({ title: "M-Pesa needs a whole amount", description: "Take this balance in cash.", variant: "destructive" }); return; }
    setBusy(true);
    const items = saleLines.filter((l) => (qty[lineKey(l)] || 0) > 0)
      .map((l) => ({ product_id: l.product_id || l.id, variant_id: l.variant_id || null, quantity: qty[lineKey(l)] }));
    const { data, error } = mode === "exchange"
      ? await sb.rpc("process_sale_exchange", {
        p_transaction_id: sale.id, p_return_items: items,
        p_new_items: newItems.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })),
        p_method: method, p_reason: reason, p_restock: restock, p_pending: prompting,
      })
      : await sb.rpc("process_sale_return", { p_transaction_id: sale.id, p_items: items, p_method: method, p_reason: reason, p_restock: restock });
    if (error) { setBusy(false); toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    refresh();
    let payState: string | undefined;
    if (data?.pending) {
      const sent = await sendSalePrompt(shop, data.exchange_transaction_id, phone.replace(/\s/g, ""), Number(data.due));
      payState = sent.ok ? "waiting" : "failed";
      if (!sent.ok) toast({ title: "M-Pesa prompt not sent", description: sent.error, variant: "destructive" });
    }
    setBusy(false);
    setDone({ ...data, sale, payState });
    setSale(null);
    setCode("");
  };

  // While the customer approves the prompt, keep checking the sale.
  useEffect(() => {
    if (done?.payState !== "waiting") return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      const s = await checkSalePrompt(shop, done.exchange_transaction_id);
      if (stop) return;
      if (s === "completed") { setDone((d: any) => d && { ...d, payState: "paid" }); refresh(); return; }
      if (s === "failed" || s === "cancelled") { setDone((d: any) => d && { ...d, payState: "failed" }); return; }
      if (Date.now() - started > 120_000) { setDone((d: any) => d && { ...d, payState: "slow" }); return; }
      setTimeout(tick, 2500);
    };
    const t = setTimeout(tick, 2500);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done?.payState, done?.exchange_transaction_id]);

  const settleOther = async (m: string) => {
    if (!done) return;
    setBusy(true);
    const { error } = await sb.rpc("settle_exchange_balance", { p_sale_id: done.exchange_transaction_id, p_method: m });
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    refresh();
    setDone((d: any) => d && { ...d, payState: "paid", paidBy: m });
  };

  const hs = historySearch.trim().toLowerCase();
  const shownHistory = history.filter((r: any) => !hs || `${r.return_number} ${r.customer_name || ""} ${receiptNo(r.transaction_id)} ${r.reason || ""}`.toLowerCase().includes(hs));
  const monthKey = new Date().toISOString().slice(0, 7);
  const thisMonth = history.filter((r: any) => String(r.created_at).startsWith(monthKey));
  const methods = METHODS.filter((m) => m.value !== "credit" || sale?.customer_id);

  return (
    <div className="space-y-5">
      <PageHeader title="Returns & exchanges" icon={Undo2} description="Take items back and refund, or swap them for other items. The customer only pays, or gets back, the difference." />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Refunded this month" value={formatKES(thisMonth.reduce((a: number, r: any) => a + Number(r.refund_amount || 0), 0))} icon={Wallet} tone="warning" hint={`${thisMonth.length} return${thisMonth.length === 1 ? "" : "s"}`} />
        <StatTile label="All returns" value={history.length} icon={Undo2} tone="primary" />
        <StatTile label="Items back in stock" value={history.filter((r: any) => r.restocked).reduce((a: number, r: any) => a + (r.items || []).reduce((b: number, i: any) => b + Number(i.quantity || 0), 0), 0)} icon={PackageCheck} tone="success" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      {canReturn ? (
        <Panel title="Choose the sale" description="Search by receipt number, customer, cashier, item or amount, then click the sale." icon={Search} flush>
          <div className="border-b border-border p-4">
            <div className="relative max-w-lg">
              <Receipt className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Receipt number, customer, item or amount" className="fi h-12 pl-10 text-base" autoFocus />
            </div>
          </div>
          {loadingRecent ? <OrbLoader label="Loading recent sales…" state="searching" className="py-10" /> : matches.length === 0 ? (
            <EmptyState icon={Receipt} title={q ? "No sale matches" : "No sales in the last 90 days"} description={q ? (searching ? "Looking further back…" : "Check the receipt number; older sales are found by receipt number.") : undefined} className="py-10" />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {paged.pageRows.map((s: any) => {
                  const fully = Number(s.refunded_amount || 0) >= Number(s.total) - 0.01;
                  const items = (s.items || []) as any[];
                  return (
                    <li key={s.id}>
                      <button type="button" disabled={fully} onClick={() => pick(s)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50">
                        <span className="font-mono text-sm font-semibold text-primary">{receiptNo(s.id)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{items.map((i) => `${i.quantity}× ${i.name}`).join(", ") || "Sale"}</span>
                          <span className="block truncate text-xs text-muted-foreground">{format(new Date(s.created_at), "d MMM yyyy, HH:mm")} · {s.customer_name || "Walk-in"} · {s.cashier_name || "—"}</span>
                        </span>
                        {Number(s.refunded_amount) > 0 && <Pill tone={fully ? "muted" : "warning"}>{fully ? "Fully returned" : "Part returned"}</Pill>}
                        <span className="font-semibold tabular-nums">{formatKES(Number(s.total))}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Pager page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} className="border-t border-border" />
            </>
          )}
        </Panel>
      ) : (
        <Panel><p className="text-sm text-muted-foreground">Your role can't process returns. Ask a cashier, manager or the company owner.</p></Panel>
      )}

      <Toolbar>
        <h2 className="mr-auto font-display text-lg font-bold">Past returns</h2>
        <SearchBox value={historySearch} onChange={setHistorySearch} placeholder="Return, receipt or customer…" />
      </Toolbar>
      <Panel flush>
        {shownHistory.length === 0 ? <EmptyState icon={Undo2} title={history.length ? "No returns match" : "No returns yet"} className="py-10" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Return</th><th>Sale</th><th>Customer</th><th className="hidden md:table-cell">Items back</th><th className="hidden lg:table-cell">Money by</th><th className="num">Refund / balance</th></tr></thead>
              <tbody>
                <PagedRows rows={shownHistory} colSpan={6}>{(rows) => rows.map((r: any) => (
                  <tr key={r.id}>
                    <td><p className="font-mono text-xs font-semibold">{r.return_number}</p><p className="text-xs text-muted-foreground">{format(new Date(r.created_at), "d MMM, HH:mm")}</p></td>
                    <td className="font-mono text-xs">{receiptNo(r.transaction_id)}</td>
                    <td className="max-w-[160px] truncate">{r.customer_name || "Walk-in"}</td>
                    <td className="hidden max-w-[240px] truncate text-muted-foreground md:table-cell">{(r.items || []).map((i: any) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                    <td className="hidden text-muted-foreground lg:table-cell">{methodLabel(r.refund_method)}{r.created_by_name ? ` · ${r.created_by_name}` : ""}</td>
                    <td className="num">
                      {r.exchange_transaction_id ? (
                        <span className="font-semibold">{Number(r.balance) >= 0 ? <span className="text-success">+{formatKES(Number(r.balance))}</span> : <span className="text-destructive">−{formatKES(-Number(r.balance))}</span>}
                          <span className="block text-[11px] font-normal text-muted-foreground">Exchange</span></span>
                      ) : <span className="font-semibold text-destructive">−{formatKES(Number(r.refund_amount))}</span>}
                    </td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {/* Return or exchange */}
      <Modal open={!!sale} onClose={() => setSale(null)} locked={busy} size="2xl"
        title={sale ? `Receipt ${receiptNo(sale.id)}` : ""}
        description={sale ? `${format(new Date(sale.created_at), "d MMM, HH:mm")} · ${sale.customer_name || "Walk-in"} · ${formatKES(Number(sale.total))}` : ""}
        footer={sale && (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
            <div className="mr-auto">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{!chosen ? "Pick items coming back" : customerPays ? "Customer pays" : difference === 0 ? "Even swap" : "Give back"}</p>
              <p className={cn("font-display text-3xl font-bold tabular-nums", customerPays ? "text-success" : difference < 0 ? "text-destructive" : "")}>{formatKES(Math.abs(difference))}</p>
            </div>
            <Button variant="outline" size="lg" onClick={() => setSale(null)} disabled={busy}>Cancel</Button>
            <Button size="lg" className="min-w-[200px] text-base" onClick={submit} disabled={!chosen || busy || (mode === "exchange" && newItems.length === 0)}>
              {busy ? <OrbSpinner /> : prompting ? <Smartphone /> : <Check />}
              {busy ? "Saving…" : prompting ? "Send M-Pesa prompt" : mode === "exchange" ? "Confirm exchange" : "Confirm refund"}
            </Button>
          </div>
        )}>
        {sale && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
              {([["refund", "Refund", Undo2], ["exchange", "Exchange", Repeat]] as const).map(([m, label, Icon]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={cn("flex items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold transition-all",
                    mode === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-5 w-5" /> {label}
                </button>
              ))}
            </div>

            <div className={cn("grid gap-5", mode === "exchange" && "lg:grid-cols-2")}>
              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Coming back</h3>
                <div className="grid gap-2">
                  {saleLines.map((l) => {
                    const k = lineKey(l);
                    const max = Math.max(0, Number(l.quantity || 0) - (alreadyReturned[k] || 0));
                    const n = qty[k] || 0;
                    return (
                      <div key={k} className={cn("flex items-center gap-3 rounded-2xl border-2 p-3 transition-colors",
                        n > 0 ? "border-primary bg-primary/5" : "border-border", max === 0 && "opacity-50")}>
                        <button type="button" disabled={max === 0} onClick={() => setQty((q) => ({ ...q, [k]: n > 0 ? 0 : max }))} className="min-w-0 flex-1 text-left">
                          <p className="truncate font-semibold">{l.name}{(l.size || l.color) && <span className="font-normal text-muted-foreground"> · {[l.size, l.color].filter(Boolean).join(" / ")}</span>}</p>
                          <p className="text-sm text-muted-foreground">{max === 0 ? "Already returned" : `${formatKES(Number(l.price))} · ${max} can come back`}</p>
                        </button>
                        {max > 0 && (
                          <div className="flex items-center gap-1.5">
                            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted disabled:opacity-40" onClick={() => setQty((q) => ({ ...q, [k]: Math.max(0, n - 1) }))} disabled={n <= 0} aria-label="Less"><Minus className="h-4 w-4" /></button>
                            <span className="w-8 text-center text-lg font-bold tabular-nums">{n}</span>
                            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted disabled:opacity-40" onClick={() => setQty((q) => ({ ...q, [k]: Math.min(max, n + 1) }))} disabled={n >= max} aria-label="More"><Plus className="h-4 w-4" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {mode === "exchange" && (
                <section>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Taking instead</h3>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input className="fi h-12 pl-10 text-base" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search or scan a product" />
                    {found.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-popover shadow-lg">
                        {found.map((p: any) => {
                          const vs = (variantMap[p.id] || []) as any[];
                          return vs.length ? vs.map((v) => (
                            <li key={v.id}><button type="button" onClick={() => addNew(p, v)} className="flex w-full justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted">
                              <span>{p.name} · {[v.size, v.color].filter(Boolean).join(" / ")} <span className="text-xs text-muted-foreground">({v.stock} left)</span></span>
                              <span className="font-semibold">{formatKES(Number(Number(v.price) > 0 ? v.price : p.price))}</span></button></li>
                          )) : (
                            <li key={p.id}><button type="button" onClick={() => addNew(p)} className="flex w-full justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted">
                              <span>{p.name} <span className="text-xs text-muted-foreground">({Number(p.stock)} left)</span></span>
                              <span className="font-semibold">{formatKES(Number(p.price))}</span></button></li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2">
                    {newItems.length === 0 && <p className="rounded-2xl border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing added yet</p>}
                    {newItems.map((i) => (
                      <div key={i.key} className="flex items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/5 p-3">
                        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{i.name}</p><p className="text-sm text-muted-foreground">{formatKES(i.price * i.quantity)}</p></div>
                        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted" onClick={() => setNewItems((l) => l.map((x) => x.key === i.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} aria-label="Less"><Minus className="h-4 w-4" /></button>
                        <span className="w-8 text-center text-lg font-bold tabular-nums">{i.quantity}</span>
                        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted" onClick={() => setNewItems((l) => l.map((x) => x.key === i.key ? { ...x, quantity: x.quantity + 1 } : x))} aria-label="More"><Plus className="h-4 w-4" /></button>
                        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-destructive hover:bg-destructive/10" onClick={() => setNewItems((l) => l.filter((x) => x.key !== i.key))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {chosen && difference !== 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">{customerPays ? "Customer pays by" : "Give back by"}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {methods.map((m) => (
                    <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                      className={cn("flex flex-col items-center gap-1 rounded-2xl border-2 py-3 text-sm font-semibold transition-colors",
                        method === m.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/60")}>
                      <m.icon className="h-5 w-5" /> {m.label}
                    </button>
                  ))}
                </div>
                {prompting && (
                  <input className="fi mt-3 h-12 text-base" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter customer's M-Pesa number" />
                )}
                {method === "mpesa" && !prompting && (
                  <p className="mt-2 text-sm text-muted-foreground">{customerPays ? "Record it once the customer has paid to your till." : "Send the money back from your till or phone."}</p>
                )}
              </section>
            )}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                Put items back in stock
              </label>
              <input className="fi h-9 flex-1 min-w-[180px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
            </div>
          </div>
        )}
      </Modal>

      {/* Done / waiting for M-Pesa */}
      <Modal open={!!done} onClose={() => setDone(null)} size="md" locked={busy}
        footer={done?.payState === "waiting" ? undefined : done?.payState === "failed" || done?.payState === "slow" ? (
          <div className="grid w-full grid-cols-3 gap-2">
            {(["cash", "card", "mpesa"] as const).map((m) => (
              <Button key={m} variant="outline" onClick={() => settleOther(m)} disabled={busy}>{m === "mpesa" ? "Paid to till" : `Paid by ${m}`}</Button>
            ))}
          </div>
        ) : <Button size="lg" className="w-full" onClick={() => setDone(null)}>Done</Button>}>
        {done && (
          <div className="py-6 text-center">
            {done.payState === "waiting" ? (<>
              <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-success/10"><Orb state="listening" label="Waiting for M-Pesa" /></span>
              <p className="mt-5 font-display text-2xl font-bold">Waiting for the customer</p>
              <p className="mt-1 text-muted-foreground">Approve the M-Pesa prompt on the phone</p>
              <p className="mt-4 font-display text-5xl font-bold tabular-nums text-success">{formatKES(Number(done.due))}</p>
              <button type="button" className="mt-4 text-sm font-semibold text-primary hover:underline" onClick={() => setDone((d: any) => ({ ...d, payState: "slow" }))}>Customer paid another way</button>
            </>) : done.payState === "failed" || done.payState === "slow" ? (<>
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-warning/15 text-warning"><XCircle className="h-10 w-10" /></span>
              <p className="mt-5 font-display text-2xl font-bold">{done.payState === "failed" ? "M-Pesa not paid" : "How did they pay?"}</p>
              <p className="mt-4 font-display text-5xl font-bold tabular-nums">{formatKES(Number(done.due))}</p>
              <p className="mt-2 text-muted-foreground">Take the balance another way to finish the exchange</p>
            </>) : (<>
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-success/15 text-success"><CheckCircle2 className="h-11 w-11" /></span>
              <p className="mt-5 font-display text-2xl font-bold">{done.exchange_transaction_id ? "Exchange done" : "Refund done"}</p>
              {done.exchange_transaction_id ? (
                Number(done.difference) > 0
                  ? <><p className="mt-4 font-display text-5xl font-bold tabular-nums text-success">{formatKES(Number(done.difference))}</p><p className="text-muted-foreground">{done.payState === "paid" ? `paid${done.paidBy ? ` by ${methodLabel(done.paidBy).toLowerCase()}` : " by M-Pesa"}` : "collected from the customer"}</p></>
                  : Number(done.difference) < 0
                    ? <><p className="mt-4 font-display text-5xl font-bold tabular-nums text-destructive">{formatKES(-Number(done.difference))}</p><p className="text-muted-foreground">give back to the customer</p></>
                    : <p className="mt-3 text-muted-foreground">Even swap, nothing to pay</p>
              ) : (<><p className="mt-4 font-display text-5xl font-bold tabular-nums">{formatKES(Number(done.refund))}</p><p className="text-muted-foreground">give back to the customer</p></>)}
              <p className="mt-4 text-xs text-muted-foreground">{done.return_number} · stock and sales updated</p>
            </>)}
          </div>
        )}
      </Modal>
    </div>
  );
}
