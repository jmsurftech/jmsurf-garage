import { useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { formatKES, formatDate, formatTime, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
type Props = { staff: any[]; transactions: any[]; shifts: any[] };

const METHODS = [
  ["all", "All methods"], ["cash", "Cash"], ["mpesa", "M-Pesa"], ["card", "Card"],
  ["split", "Split"], ["credit", "Credit"], ["mobile_money", "Mobile money"],
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function preset(kind: "today" | "yesterday" | "week" | "month") {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (kind === "yesterday") {
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(23, 59, 0, 0);
    return { from: toLocalInput(start), to: toLocalInput(end) };
  }
  if (kind === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (kind === "month") start.setDate(1);
  return { from: toLocalInput(start), to: "" };
}

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StaffPerformance({ staff, transactions, shifts }: Props) {
  const initial = preset("month");
  const [staffId, setStaffId] = useState("all");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [method, setMethod] = useState("all");
  const [focus, setFocus] = useState<string | null>(null);

  const fromMs = from ? new Date(from).getTime() : -Infinity;
  const toMs = to ? new Date(to).getTime() : Infinity;

  const sales = useMemo(
    () =>
      transactions.filter((t) => {
        if (t.status !== "completed" || !t.cashier_id) return false;
        if (staffId !== "all" && t.cashier_id !== staffId) return false;
        if (method !== "all" && t.payment_method !== method) return false;
        const at = new Date(t.created_at).getTime();
        return at >= fromMs && at <= toMs;
      }),
    [transactions, staffId, method, fromMs, toMs],
  );

  const rows = useMemo(() => {
    const people = staffId === "all" ? staff : staff.filter((s) => s.user_id === staffId);
    return people
      .map((s) => {
        const mine = sales.filter((t) => t.cashier_id === s.user_id);
        const total = mine.reduce((sum, t) => sum + Number(t.total || 0), 0);
        const items = mine.reduce(
          (sum, t) => sum + (Array.isArray(t.items) ? t.items.reduce((q: number, l: any) => q + Number(l.quantity || 0), 0) : 0),
          0,
        );
        const myShifts = shifts.filter((sh) => {
          if (sh.user_id !== s.user_id) return false;
          const at = new Date(sh.start_time).getTime();
          return at >= fromMs && at <= toMs;
        });
        const hours = myShifts.reduce((sum, sh) => {
          const end = sh.end_time ? new Date(sh.end_time).getTime() : Date.now();
          return sum + Math.max(0, end - new Date(sh.start_time).getTime()) / 3_600_000;
        }, 0);
        return {
          ...s,
          total,
          count: mine.length,
          items,
          shifts: myShifts.length,
          hours: Math.round(hours * 10) / 10,
          avg: mine.length ? total / mine.length : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [staff, staffId, sales, shifts, fromMs, toMs]);

  const focused = focus ? rows.find((r) => r.user_id === focus) : null;
  const focusSales = useMemo(
    () => (focus ? sales.filter((t) => t.cashier_id === focus).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)) : []),
    [sales, focus],
  );
  const focusItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number }>();
    focusSales.forEach((t) =>
      (Array.isArray(t.items) ? t.items : []).forEach((l: any) => {
        const key = String(l.name || l.id || "Item");
        const cur = map.get(key) || { name: key, qty: 0, amount: 0 };
        cur.qty += Number(l.quantity || 0);
        cur.amount += Number(l.quantity || 0) * Number(l.price || 0);
        map.set(key, cur);
      }),
    );
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [focusSales]);

  const grand = rows.reduce((s, r) => s + r.total, 0);
  const grandCount = rows.reduce((s, r) => s + r.count, 0);
  const inputCls = "h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(["today", "yesterday", "week", "month"] as const).map((k) => (
            <button key={k} onClick={() => { const p = preset(k); setFrom(p.from); setTo(p.to); }}
              className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 capitalize">
              {k === "week" ? "This week" : k === "month" ? "This month" : k}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-muted-foreground space-y-1">
            <span>Staff member</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={cn(inputCls, "w-full")}>
              <option value="all">All staff</option>
              {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            <span>From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(inputCls, "w-full")} />
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            <span>To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={cn(inputCls, "w-full")} />
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            <span>Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputCls, "w-full")}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Total sales", formatKES(grand)],
          ["Transactions", String(grandCount)],
          ["Average sale", formatKES(grandCount ? grand / grandCount : 0)],
          ["Items sold", String(rows.reduce((s, r) => s + r.items, 0))],
        ].map(([label, value]) => (
          <div key={label} className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-display font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Per cashier */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Performance by staff member</h3>
          <button
            onClick={() => downloadCsv("staff-performance.csv", [
              ["Staff", "Role", `Sales (${currencyCode()})`, "Transactions", "Items sold", "Shifts", "Hours", "Average sale"],
              ...rows.map((r) => [r.display_name, r.role, r.total.toFixed(2), r.count, r.items, r.shifts, r.hours, r.avg.toFixed(2)]),
            ])}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                <th className="text-left py-2.5 px-4 font-medium">Staff</th>
                <th className="text-right py-2.5 px-4 font-medium">Sales</th>
                <th className="text-center py-2.5 px-4 font-medium">Txns</th>
                <th className="text-center py-2.5 px-4 font-medium">Items</th>
                <th className="text-center py-2.5 px-4 font-medium">Shifts</th>
                <th className="text-right py-2.5 px-4 font-medium">Hours</th>
                <th className="text-right py-2.5 px-4 font-medium">Avg/Txn</th>
              </tr>
            </thead>
            <tbody>
              <PagedRows rows={rows} colSpan={7} after={<>{rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No staff match these filters</td></tr>
              )}</>}>{(pageRows) => pageRows.map((r) => (
                <tr key={r.user_id} onClick={() => setFocus(r.user_id)}
                  className={cn("border-b border-border last:border-0 cursor-pointer hover:bg-muted/30", focus === r.user_id && "bg-primary/5")}>
                  <td className="py-2.5 px-4 font-medium">{r.display_name}</td>
                  <td className="py-2.5 px-4 text-right font-medium">{formatKES(r.total)}</td>
                  <td className="py-2.5 px-4 text-center">{r.count}</td>
                  <td className="py-2.5 px-4 text-center">{r.items}</td>
                  <td className="py-2.5 px-4 text-center">{r.shifts}</td>
                  <td className="py-2.5 px-4 text-right">{r.hours}h</td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground">{formatKES(r.avg)}</td>
                </tr>
              ))}</PagedRows>
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">Click a staff member to see the items they sold and each sale.</p>
      </div>

      {/* Drill-down */}
      {focused && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">Items sold by {focused.display_name}</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadCsv(`items-${focused.display_name}.csv`, [
                    ["Item", "Quantity", `Amount (${currencyCode()})`], ...focusItems.map((i) => [i.name, i.qty, i.amount.toFixed(2)]),
                  ])}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
                <button onClick={() => setFocus(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="dt">
                <tbody>
                  {focusItems.map((i) => (
                    <tr key={i.name} className="border-b border-border last:border-0">
                      <td className="py-2 px-4">{i.name}</td>
                      <td className="py-2 px-4 text-center text-muted-foreground">×{i.qty}</td>
                      <td className="py-2 px-4 text-right font-medium">{formatKES(i.amount)}</td>
                    </tr>
                  ))}
                  {focusItems.length === 0 && <tr><td className="py-6 text-center text-muted-foreground">No items in this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">Sales ({focusSales.length})</h3>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-border">
              {focusSales.map((t) => (
                <div key={t.id} className="px-4 py-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{formatDate(new Date(t.created_at))} {formatTime(new Date(t.created_at))}</span>
                    <span className="font-medium">{formatKES(Number(t.total))}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="truncate">
                      {(Array.isArray(t.items) ? t.items : []).map((l: any) => `${l.name} ×${l.quantity}`).join(", ") || "—"}
                    </span>
                    <span className="capitalize shrink-0">{String(t.payment_method || "").replace("_", " ")}</span>
                  </div>
                </div>
              ))}
              {focusSales.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No sales in this period</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
