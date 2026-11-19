import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Target, Wallet, Users, Plus, Trash2, Pencil, Trophy, MessageCircle, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useStaff } from "@/hooks/useData";
import { useCategories } from "@/hooks/useTaxonomy";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, StatGrid, StatTile, EmptyState, Modal, Field } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { ZStatus } from "@/components/books/ZStatus";
import { PAYMENT_MODES } from "@/components/books/RecordPayment";
import { shareOnWhatsApp } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { confirmAction } from "@/components/books/confirm";
import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
type Line = { rep_id: string; rep_name: string; source: string; ref_id: string; ref: string; sale_date: string; customer_id: string | null; customer_name: string; customer_phone: string | null; amount: number; paid: number; balance: number; due_date: string | null; status: string; commission: number; commission_earned: number };

export default function SalesReps() {
  const tenantId = useTenantId();
  const { role, user } = useAuth() as any;
  const isManager = ["admin", "manager", "super_admin"].includes(role);
  const qc = useQueryClient();
  const { toast } = useToast();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [repFilter, setRepFilter] = useState<string | null>(isManager ? null : user?.id || null);
  const [show, setShow] = useState<"paid" | "unpaid" | "all">("all");
  const [modal, setModal] = useState<null | "rep" | "rule" | "payout">(null);
  const [editing, setEditing] = useState<any>(null);
  const open = (m: "rep" | "rule" | "payout", row: any = null) => { setEditing(row); setModal(m); };

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["rep-sales", tenantId, from, to],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("rep_sales", { p_from: from, p_to: to, p_rep: null });
      if (error) throw error;
      return data as Line[];
    },
  });
  const { data: reps = [] } = useQuery({ queryKey: ["sales-reps", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("sales_reps").select("*").eq("tenant_id", tenantId).order("display_name")).data || [] });
  const { data: rules = [] } = useQuery({ queryKey: ["commission-rules", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("commission_rules").select("*").eq("tenant_id", tenantId).order("created_at")).data || [] });
  const { data: payouts = [] } = useQuery({ queryKey: ["commission-payouts", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("commission_payouts").select("*").eq("tenant_id", tenantId).order("paid_at", { ascending: false }).limit(100)).data || [] });

  const board = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sales: number; collected: number; outstanding: number; commission: number; earned: number; count: number; customers: Set<string> }>();
    for (const l of lines) {
      const cur = m.get(l.rep_id) || { id: l.rep_id, name: l.rep_name || "Rep", sales: 0, collected: 0, outstanding: 0, commission: 0, earned: 0, count: 0, customers: new Set<string>() };
      cur.sales += Number(l.amount); cur.collected += Number(l.paid); cur.outstanding += Number(l.balance);
      cur.commission += Number(l.commission); cur.earned += Number(l.commission_earned); cur.count += 1;
      if (l.customer_id) cur.customers.add(l.customer_id);
      m.set(l.rep_id, cur);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  }, [lines]);

  const mine = repFilter ? lines.filter((l) => l.rep_id === repFilter) : lines;
  const shown = mine.filter((l) => show === "all" || (show === "paid" ? Number(l.balance) <= 0.005 : Number(l.balance) > 0.005));
  const tot = (k: keyof Line) => mine.reduce((a, l) => a + Number(l[k] || 0), 0);
  const repRow = (reps as any[]).find((r) => r.user_id === repFilter);
  const target = Number(repRow?.monthly_target || 0);
  const paidOut = (payouts as any[]).filter((p) => !repFilter || p.rep_id === repFilter).reduce((a, p) => a + Number(p.amount), 0);

  const del = async (table: string, id: string, key = "id") => {
    if (!(await confirmAction({ title: table === "sales_reps" ? "Remove this rep?" : "Delete this rule?", message: table === "sales_reps" ? "Their past sales stay; they just stop having a default commission and target." : undefined, danger: true, confirmLabel: "Remove" }))) return;
    const { error } = await sb.from(table).delete().eq(key, id);
    if (error) return toast({ title: "Not removed", description: error.message, variant: "destructive" });
    qc.invalidateQueries();
  };

  if (isLoading) return <OrbLoader label="Working out commission…" />;
  return (
    <div className="space-y-5">
      <PageHeader title={isManager ? "Sales Reps" : "My Sales"} icon={BadgePercent}
        description={isManager ? "What each rep sold, what has been collected and the commission they have earned." : "Your sales, your commission and which customers still owe."}
        actions={isManager && <><Button variant="outline" onClick={() => open("rule")}><BadgePercent /> Commission rule</Button><Button variant="outline" onClick={() => open("payout")}><Wallet /> Pay commission</Button><Button onClick={() => open("rep")}><Plus /> Add rep</Button></>} />

      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input type="date" className="fi w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="fi w-40" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {[["This month", () => { setFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(iso(now)); }], ["Last month", () => { setFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(iso(new Date(now.getFullYear(), now.getMonth(), 0))); }], ["This year", () => { setFrom(`${now.getFullYear()}-01-01`); setTo(iso(now)); }]].map(([l, fn]: any) => <Button key={l} size="sm" variant="outline" onClick={fn}>{l}</Button>)}
        {isManager && (
          <Field label="Rep" className="ml-auto">
            <select className="fi w-52" value={repFilter || ""} onChange={(e) => setRepFilter(e.target.value || null)}>
              <option value="">All reps</option>
              {board.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
      </div>

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Sales" value={formatKES(tot("amount"))} icon={Trophy} hint={`${mine.length} sale${mine.length === 1 ? "" : "s"}`} />
        <StatTile label="Collected" value={formatKES(tot("paid"))} icon={CheckCircle2} tone="success" hint={`${formatKES(tot("balance"))} still owed`} />
        <StatTile label="Commission earned" value={formatKES(tot("commission_earned"))} icon={Wallet} tone="info" hint={`of ${formatKES(tot("commission"))} on these sales`} />
        <StatTile label={target ? "Monthly target" : "Commission paid out"} value={target ? `${Math.round((tot("amount") / target) * 100)}%` : formatKES(paidOut)} icon={target ? Target : Wallet} tone="muted" hint={target ? `${formatKES(tot("amount"))} of ${formatKES(target)}` : "All time"} />
      </StatGrid>

      {isManager && !repFilter && (
        <section className="overflow-x-auto rounded-2xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Leaderboard</p>
          {board.length === 0 ? <EmptyState icon={Users} title="No rep sales in this period" description="Choose the sales rep on the till or on invoices to credit their sales." /> : (
            <table className="dt min-w-[820px]">
              <thead><tr><th>#</th><th>Rep</th><th className="num">Sales</th><th className="num">Customers</th><th className="num">Collected</th><th className="num">Owed</th><th className="num">Commission</th><th className="num">Earned</th></tr></thead>
              <tbody>{board.map((b, i) => (
                <tr key={b.id} className="cursor-pointer" onClick={() => setRepFilter(b.id)}>
                  <td>{i === 0 ? "🏆" : i + 1}</td><td className="font-semibold text-primary">{b.name}</td><td className="num font-semibold">{formatKES(b.sales)}</td><td className="num">{b.customers.size}</td>
                  <td className="num text-success">{formatKES(b.collected)}</td><td className={cn("num", b.outstanding > 0 && "text-destructive")}>{formatKES(b.outstanding)}</td>
                  <td className="num">{formatKES(b.commission)}</td><td className="num font-semibold">{formatKES(b.earned)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">{repFilter ? `${(board.find((b) => b.id === repFilter)?.name) || repRow?.display_name || "My"} sales` : "All rep sales"}</p>
          <span className="flex-1" />
          {(["all", "unpaid", "paid"] as const).map((s) => <button key={s} onClick={() => setShow(s)} className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", show === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{s === "unpaid" ? "Not paid" : s === "paid" ? "Paid" : "All"}</button>)}
        </div>
        {shown.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No sales here.</p> : (
          <div className="overflow-x-auto">
            <table className="dt min-w-[900px]">
              <thead><tr><th>Date</th><th>Sale</th><th>Customer</th><th>Status</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Owed</th><th className="num">Commission</th><th /></tr></thead>
              <tbody><PagedRows rows={shown} colSpan={9}>{(pageRows) => pageRows.map((l) => (
                <tr key={l.source + l.ref_id}>
                  <td>{fmtDate(l.sale_date)}</td>
                  <td>{l.source === "invoice" ? <Link to={`/sales/invoices/${l.ref_id}`} className="font-semibold text-primary">{l.ref}</Link> : <span className="font-medium">{l.ref}</span>}</td>
                  <td>{l.customer_id ? <Link to={`/customers/${l.customer_id}`} className="hover:text-primary">{l.customer_name}</Link> : l.customer_name || "Walk-in"}</td>
                  <td><ZStatus status={l.status} /></td>
                  <td className="num">{formatKES(Number(l.amount))}</td>
                  <td className="num text-success">{formatKES(Number(l.paid))}</td>
                  <td className={cn("num", Number(l.balance) > 0 && "font-semibold text-destructive")}>{Number(l.balance) > 0 ? formatKES(Number(l.balance)) : "—"}{l.due_date && Number(l.balance) > 0 ? <span className="block text-[11px] font-normal text-muted-foreground">due {fmtDate(l.due_date)}</span> : null}</td>
                  <td className="num">{formatKES(Number(l.commission_earned))}{Number(l.commission) > Number(l.commission_earned) ? <span className="block text-[11px] text-muted-foreground"><Clock className="mr-0.5 inline h-3 w-3" />{formatKES(Number(l.commission) - Number(l.commission_earned))} pending</span> : null}</td>
                  <td>{Number(l.balance) > 0 && l.customer_phone && <button className="icon-btn" title="Remind on WhatsApp" onClick={() => shareOnWhatsApp(l.customer_phone, `Hello ${l.customer_name}, a friendly reminder that KES ${Number(l.balance).toFixed(2)} is still owed for ${l.ref}. Thank you!`)}><MessageCircle className="h-4 w-4" /></button>}</td>
                </tr>
              ))}</PagedRows></tbody>
            </table>
          </div>
        )}
      </section>

      {isManager && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card">
            <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Reps</p>
            {(reps as any[]).length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Add reps to set their default commission and monthly target. Anyone chosen as the rep on a sale is counted.</p> : (
              <table className="dt"><thead><tr><th>Rep</th><th className="num">Default %</th><th className="num">Target</th><th /></tr></thead>
                <tbody><PagedRows rows={(reps as any[])} colSpan={4}>{(pageRows) => pageRows.map((r) => <tr key={r.user_id}><td className="font-medium">{r.display_name}</td><td className="num">{Number(r.default_commission_pct)}%</td><td className="num">{formatKES(Number(r.monthly_target))}</td><td><span className="flex justify-end gap-1"><button className="icon-btn" onClick={() => open("rep", r)} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del("sales_reps", r.user_id, "user_id")} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></span></td></tr>)}</PagedRows></tbody></table>
            )}
          </section>
          <section className="rounded-2xl border border-border bg-card">
            <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Commission rules</p>
            {(rules as any[]).length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">No rules yet: reps earn their default %. Add a rule for a category (e.g. 10% on Grooming services).</p> : (
              <table className="dt"><thead><tr><th>Rep</th><th>Category</th><th className="num">%</th><th /></tr></thead>
                <tbody><PagedRows rows={(rules as any[])} colSpan={4}>{(pageRows) => pageRows.map((r) => <tr key={r.id}><td>{(reps as any[]).find((x) => x.user_id === r.rep_id)?.display_name || "Every rep"}</td><td>{r.category || "Everything"}</td><td className="num font-semibold">{Number(r.pct)}%</td><td><span className="flex justify-end gap-1"><button className="icon-btn" onClick={() => open("rule", r)} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del("commission_rules", r.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></span></td></tr>)}</PagedRows></tbody></table>
            )}
          </section>
          <section className="rounded-2xl border border-border bg-card lg:col-span-2">
            <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Commission paid out</p>
            {(payouts as any[]).length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Nothing paid yet.</p> : (
              <table className="dt"><thead><tr><th>Paid on</th><th>Rep</th><th>Period</th><th>Method</th><th className="num">Amount</th></tr></thead>
                <tbody><PagedRows rows={(payouts as any[])} colSpan={5}>{(pageRows) => pageRows.map((p) => <tr key={p.id}><td>{fmtDate(p.paid_at)}</td><td>{(reps as any[]).find((x) => x.user_id === p.rep_id)?.display_name || board.find((b) => b.id === p.rep_id)?.name || "Rep"}</td><td>{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td><td className="capitalize">{String(p.method || "").replace(/_/g, " ")}</td><td className="num font-semibold">{formatKES(Number(p.amount))}</td></tr>)}</PagedRows></tbody></table>
            )}
          </section>
        </div>
      )}

      {modal === "rep" && <RepModal onClose={() => setModal(null)} tenantId={tenantId} row={editing} />}
      {modal === "rule" && <RuleModal onClose={() => setModal(null)} tenantId={tenantId} reps={reps as any[]} row={editing} />}
      {modal === "payout" && <PayoutModal onClose={() => setModal(null)} tenantId={tenantId} reps={board} from={from} to={to} userId={user?.id} />}
    </div>
  );
}

function RepModal({ onClose, tenantId, row }: { onClose: () => void; tenantId: string | null; row?: any }) {
  const { data: staff = [] } = useStaff();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ user_id: row?.user_id || "", pct: String(row?.default_commission_pct ?? 5), target: String(row?.monthly_target ?? 0) });
  const save = async () => {
    const st = (staff as any[]).find((s) => s.user_id === f.user_id) || (row && { user_id: row.user_id, display_name: row.display_name, phone: row.phone, email: row.email });
    if (!st) return toast({ title: "Choose a staff member", variant: "destructive" });
    const { error } = await sb.from("sales_reps").upsert({ user_id: st.user_id, tenant_id: tenantId, display_name: st.display_name || "Rep", phone: st.phone || null, email: st.email || null, default_commission_pct: Number(f.pct) || 0, monthly_target: Number(f.target) || 0 });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["sales-reps"] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={row ? `Edit ${row.display_name}` : "Add sales rep"} icon={Users} description="Reps are staff accounts. Add a staff member first under Staff, with the Sales person role." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Staff member" required><select className="fi" disabled={!!row} value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">Choose…</option>{(staff as any[]).map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name} ({String(s.role).replace("_", " ")})</option>)}</select></Field>
        <Field label="Default commission %"><input className="fi" type="number" min={0} max={100} step="any" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
        <Field label="Monthly sales target (KES)"><input className="fi" type="number" min={0} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RuleModal({ onClose, tenantId, reps, row }: { onClose: () => void; tenantId: string | null; reps: any[]; row?: any }) {
  const { data: cats = [] } = useCategories();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ rep_id: row?.rep_id || "", category: row?.category || "", pct: String(row?.pct ?? 10) });
  const save = async () => {
    const body = { tenant_id: tenantId, rep_id: f.rep_id || null, category: f.category || null, pct: Number(f.pct) || 0 };
    const { error } = row ? await sb.from("commission_rules").update(body).eq("id", row.id) : await sb.from("commission_rules").insert(body);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["commission-rules"] });
    qc.invalidateQueries({ queryKey: ["rep-sales"] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={row ? "Edit commission rule" : "Commission rule"} icon={BadgePercent} description="The most specific rule wins: a rep + category, then any rep + category, then the rep's default." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Rep"><select className="fi" value={f.rep_id} onChange={(e) => setF({ ...f, rep_id: e.target.value })}><option value="">Every rep</option>{reps.map((r) => <option key={r.user_id} value={r.user_id}>{r.display_name}</option>)}</select></Field>
        <Field label="Category"><select className="fi" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Everything</option>{(cats as any[]).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>
        <Field label="Commission %" required><input className="fi" type="number" min={0} max={100} step="any" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function PayoutModal({ onClose, tenantId, reps, from, to, userId }: { onClose: () => void; tenantId: string | null; reps: { id: string; name: string; earned: number }[]; from: string; to: string; userId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ rep: reps[0]?.id || "", amount: String(reps[0]?.earned.toFixed(2) || ""), method: "mpesa", reference: "" });
  const save = async () => {
    if (!f.rep || !(Number(f.amount) > 0)) return toast({ title: "Choose the rep and amount", variant: "destructive" });
    const { error } = await sb.from("commission_payouts").insert({ tenant_id: tenantId, rep_id: f.rep, period_start: from, period_end: to, amount: Number(f.amount), method: f.method, reference: f.reference || null, paid_by: userId });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["commission-payouts"] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Pay commission" icon={Wallet} description={`For ${fmtDate(from)} – ${fmtDate(to)}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Rep" required><select className="fi" value={f.rep} onChange={(e) => { const r = reps.find((x) => x.id === e.target.value); setF({ ...f, rep: e.target.value, amount: r ? r.earned.toFixed(2) : f.amount }); }}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name} · earned {formatKES(r.earned)}</option>)}</select></Field>
        <Field label="Amount" required><input className="fi" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Method"><select className="fi" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        <Field label="Reference"><input className="fi" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
