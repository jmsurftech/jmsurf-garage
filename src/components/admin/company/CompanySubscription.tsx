import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, CheckCircle, CreditCard, Gift, Grid2x2, Receipt, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, Panel, StatusPill, TableWrap } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { supabase } from "@/integrations/supabase/client";
import { adminCall, plusDays, today } from "@/lib/adminApi";
import { confirmAction } from "@/components/books/confirm";
import AdminTenantFeaturesPanel from "@/components/admin/AdminTenantFeaturesPanel";
import AdminCompanySuites from "@/components/admin/AdminCompanySuites";
import { endOf, ksh, type Company, type Sub } from "./data";

const months = (c?: string) => (c === "quarterly" ? 3 : c === "annually" ? 12 : 1);
const day = (s?: string | null) => (s ? format(new Date(s), "d MMM yyyy") : "—");
type Dialog = "trial" | "free" | "payment" | null;

/** Admin → company → Subscription: plan and dates, trial and free time, payments, its own deal and modules. */
export default function CompanySubscription({ company, sub, plans, activeUsers, onChanged }: { company: Company; sub: Sub | null; plans: any[]; activeUsers: number; onChanged: () => void }) {
  const [plan, setPlan] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [status, setStatus] = useState("active");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const locked = !!company.deleted_at || sub?.status === "suspended" || sub?.status === "paused";
  const { data: pays = [], refetch } = useQuery({
    queryKey: ["admin-company-payments", company.id],
    queryFn: async () => ((await (supabase as any).from("subscription_payments").select("id,amount,gateway,status,reference,created_at").eq("tenant_id", company.id).order("created_at", { ascending: false }).limit(500)).data || []) as any[],
  });

  useEffect(() => {
    setPlan(sub?.plan_id || plans[0]?.id || "");
    setCycle(sub?.billing_cycle || "monthly");
    setStatus(sub?.status === "trial" || sub?.status === "trialing" ? "trial" : sub?.status === "expired" ? "expired" : "active");
    const e = endOf(sub);
    setEnds(e ? new Date(e).toISOString().slice(0, 10) : "");
  }, [sub?.id, sub?.plan_id, sub?.billing_cycle, sub?.status, sub?.current_period_end, sub?.trial_ends_at, plans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (path: Parameters<typeof adminCall>[0], body: Record<string, unknown>, ok: string) => {
    try { await adminCall(path, { tenant_id: company.id, ...body }); toast.success(ok); onChanged(); void refetch(); return true; }
    catch (e: any) { toast.error(e.message); return false; }
  };
  const savePlan = async () => { setBusy(true); await call("companies/subscription", { plan_id: plan, billing_cycle: cycle, status, ends_at: status === "expired" ? undefined : ends }, "Plan saved"); setBusy(false); };
  const free = sub?.comped_until && Date.parse(sub.comped_until) > Date.now();
  const paid = pays.filter((p) => p.status === "completed").reduce((t, p) => t + Number(p.amount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Plan" icon={CreditCard} description="The same plan keeps this company's own price and limits (Custom deal). A new plan brings its own.">
          {locked && <p className="mb-3 rounded-xl bg-muted/60 p-2.5 text-xs text-muted-foreground">{company.deleted_at ? "Restore the company to change its plan." : "Reactivate the company to change its plan."}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan"><select className="fi" value={plan} disabled={locked} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo · {p.max_users} users</option>)}</select></Field>
            <Field label="Billing cycle"><select className="fi" value={cycle} disabled={locked} onChange={(e) => setCycle(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></Field>
            <Field label="Status"><select className="fi" value={status} disabled={locked} onChange={(e) => setStatus(e.target.value)}><option value="active">Active (paid)</option><option value="trial">Trial</option><option value="expired">Expired</option></select></Field>
            {status !== "expired" && <Field label={status === "trial" ? "Trial ends" : "Paid until"}><input className="fi" type="date" disabled={locked} value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>}
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={savePlan} disabled={locked || busy || !plan || (status !== "expired" && !ends)}><Save /> {busy ? "Saving…" : "Save plan"}</Button></div>
        </Panel>

        <Panel className="lg:col-span-2" title="Time and money">
          <dl className="mb-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Due each {sub?.billing_cycle === "annually" ? "year" : sub?.billing_cycle === "quarterly" ? "quarter" : "month"}</dt><dd className="font-semibold tabular-nums">{sub ? ksh(Number(sub.price || 0) * months(sub.billing_cycle)) : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Users</dt><dd className="font-medium">{activeUsers}{sub?.max_users ? ` of ${sub.max_users}` : ""}</dd></div>
            {free && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Free until</dt><dd className="font-medium text-success">{day(sub!.comped_until)}</dd></div>}
            {free && sub?.comp_note && <p className="text-xs text-muted-foreground">{sub.comp_note}</p>}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Paid to JMSURF</dt><dd className="font-medium tabular-nums">{ksh(paid)}</dd></div>
          </dl>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Button variant="outline" size="sm" disabled={locked || !sub} onClick={() => setDialog("payment")}><CheckCircle /> Record payment</Button>
            <Button variant="outline" size="sm" disabled={locked || !sub} onClick={() => setDialog("trial")}><CalendarClock /> Trial end</Button>
            {free
              ? <Button variant="outline" size="sm" disabled={locked} onClick={async () => { if (await confirmAction({ title: "End the free plan now?", message: "The company goes to Billing to pay before it can work again.", confirmLabel: "End now", danger: true })) void call("companies/comp", { until: null }, "Free plan ended"); }}><Gift /> End free plan</Button>
              : <Button variant="outline" size="sm" disabled={locked || !sub} onClick={() => setDialog("free")}><Gift /> Give plan free</Button>}
          </div>
        </Panel>
      </div>

      {sub && (
        <AdminTenantFeaturesPanel tenantId={company.id} subscriptionId={sub.id} planId={sub.plan_id} staffCount={activeUsers}
          initialPrice={sub.price} initialMaxUsers={sub.max_users} initialMaxLocations={sub.max_locations} />
      )}

      <Panel flush title="Modules" icon={Grid2x2} description="Outside the plan, for this company only: free (to a date or for good), a trial, or paid at its own price.">
        <AdminCompanySuites tenantId={company.id} disabled={!!company.deleted_at} />
      </Panel>

      <Panel flush title="Payments to JMSURF" icon={Receipt}>
        {pays.length === 0 ? <EmptyState icon={Receipt} title="No payments yet" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                <PagedRows rows={pays} colSpan={5} pageSize={10}>{(page) => page.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-xs">{format(new Date(x.created_at), "d MMM yyyy, HH:mm")}</td>
                    <td className="text-xs capitalize">{x.gateway === "jmsurf" ? "JMSURF PAY" : x.gateway || "—"}</td>
                    <td className="font-mono text-xs">{x.reference || "—"}</td>
                    <td><StatusPill status={x.status} /></td>
                    <td className="text-right tabular-nums">{ksh(x.amount)}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <SmallDialog dialog={dialog} sub={sub} onClose={() => setDialog(null)} call={call} />
    </div>
  );
}

function SmallDialog({ dialog, sub, onClose, call }: { dialog: Dialog; sub: Sub | null; onClose: () => void; call: (p: Parameters<typeof adminCall>[0], b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDate(dialog === "trial" ? plusDays(7, sub?.trial_ends_at) : dialog === "free" ? plusDays(30) : ""); setText(""); setAmount(""); }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const due = sub ? Number(sub.price || 0) * months(sub.billing_cycle) : 0;
  const go = async (p: Parameters<typeof adminCall>[0], b: Record<string, unknown>, ok: string) => { setBusy(true); const done = await call(p, b, ok); setBusy(false); if (done) onClose(); };

  if (dialog === "payment") return (
    <Modal center open onClose={onClose} size="sm" icon={CheckCircle} title="Record payment" description={`Adds one ${sub?.billing_cycle || "monthly"} period, from the end date or today.`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || text.trim().length < 3} onClick={() => void go("companies/payment", { reference: text.trim(), amount: amount === "" ? null : Number(amount) }, "Payment recorded")}>{busy ? "Recording…" : "Record payment"}</Button></>}>
      <div className="space-y-3">
        <Field label="M-Pesa code or reference" required><input className="fi uppercase" value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter code" autoFocus /></Field>
        <Field label="Amount received" hint={`Empty = the full ${ksh(due)}`}><input className="fi" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter amount" /></Field>
      </div>
    </Modal>
  );
  if (dialog === "trial") return (
    <Modal center open onClose={onClose} size="sm" icon={CalendarClock} title="Trial end" description={sub?.trial_ends_at ? `Now ends ${day(sub.trial_ends_at)}.` : "Puts the company on trial to a date."}
      footer={<>
        {(sub?.status === "trial" || sub?.status === "trialing") && <Button variant="outline" className="text-destructive sm:mr-auto" disabled={busy} onClick={() => void go("companies/trial", { end: true }, "Trial ended")}>End trial now</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !date} onClick={() => void go("companies/trial", { until: date }, `Trial runs to ${day(date)}`)}>{busy ? "Saving…" : "Save"}</Button>
      </>}>
      <Field label="Trial ends on"><input className="fi" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="mt-2 flex gap-2">{[7, 14, 30].map((n) => <button key={n} type="button" onClick={() => setDate(plusDays(n, sub?.trial_ends_at))} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted">+{n} days</button>)}</div>
    </Modal>
  );
  if (dialog === "free") return (
    <Modal center open onClose={onClose} size="sm" icon={Gift} title="Give the plan free" description="The company works without paying until this date, then pays as usual."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !date} onClick={() => void go("companies/comp", { until: date, note: text.trim() }, `Free until ${day(date)}`)}>{busy ? "Saving…" : "Give free"}</Button></>}>
      <div className="space-y-3">
        <Field label="Free until" required><input className="fi" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Why" hint="Only you see this."><input className="fi" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter a reason" /></Field>
      </div>
    </Modal>
  );
  return null;
}
