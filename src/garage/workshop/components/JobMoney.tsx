import { useEffect, useState } from "react";
import { Receipt, Smartphone, DoorOpen, Loader2, ExternalLink, Link2 } from "lucide-react";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { StatusPill } from "@/components/kit";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { usePermissions } from "@/hooks/usePermissions";
import { getPayLink } from "@/lib/payLink";
import { sb, wsApi } from "../lib/api";
import { useGarageSettings } from "../lib/data";
import { createJobInvoice } from "../lib/invoice";
import { jobTotals, splitByPayer, type Payer } from "../lib/totals";
import { useWorkshopLinks, publicUrl } from "../lib/nav";
import { money } from "./bits";

const PAYER_LABEL: Record<Payer, string> = { customer: "Customer", insurer: "Insurer", fleet: "Fleet" };

/** Money on the job: invoices per payer, M-Pesa deposit / payment prompt, and the gate pass. */
export default function JobMoney({ data, onChange }: { data: any; onChange: () => void }) {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const { can } = usePermissions();
  const { href } = useWorkshopLinks();
  const { data: settings } = useGarageSettings();
  const { job, lines, invoices } = data;
  const groups = splitByPayer(lines);
  const approved = jobTotals(lines, { onlyApproved: true });
  const [payers, setPayers] = useState<Record<string, PickedCustomer | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [stk, setStk] = useState({ phone: job.customer?.phone || "", amount: "", invoice: "" });
  const [req, setReq] = useState<{ id: string; status: string } | null>(null);

  useEffect(() => {
    // Insurer / fleet named by another module on the job (payer_split) are used by default.
    const ps = job.payer_split || {};
    const load = async (key: Payer, id?: string) => {
      if (!id) return;
      const { data: c } = await sb.from("customers").select("id,name,phone,email").eq("id", id).maybeSingle();
      if (c) setPayers((p) => ({ ...p, [key]: p[key] || c }));
    };
    void load("insurer", ps.insurer_customer_id);
    void load("fleet", ps.fleet_customer_id);
  }, [job.payer_split]);

  // Polls an M-Pesa prompt until it is paid or fails.
  useEffect(() => {
    if (!req || req.status !== "pending") return;
    const t = setInterval(async () => {
      try {
        const r: any = await wsApi("stk-status", { request_id: req.id });
        if (r.status !== "pending" && r.status !== "initiating") { setReq({ id: req.id, status: r.status }); onChange(); toast({ title: r.status === "paid" || r.status === "completed" ? `Paid${r.receipt ? ` · ${r.receipt}` : ""}` : `M-Pesa: ${r.status}` }); }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [req, onChange, toast]);

  const customerOf = (payer: Payer): PickedCustomer | null => payer === "customer" ? (job.customer ? { id: job.customer.id, name: job.customer.name, phone: job.customer.phone, email: job.customer.email } : payers.customer || null) : payers[payer] || null;

  const invoice = async (payer: Payer) => {
    const g = groups.find((x) => x.payer === payer);
    const c = customerOf(payer);
    if (!g) return;
    if (!c) return toast({ title: `Choose the ${PAYER_LABEL[payer].toLowerCase()} to invoice`, variant: "destructive" });
    setBusy(payer);
    try {
      const locId = data.parts.find((p: any) => p.location_id)?.location_id || job.location_id || settings?.default_location_id || null;
      const inv = await createJobInvoice({ tenantId: tenantId!, userId: user?.id, job, lines: g.lines as any, payer, customer: c, locationId: locId, dueDays: payer === "customer" ? 0 : 30 });
      toast({ title: `Invoice ${inv.invoice_number} made` });
      onChange();
    } catch (e: any) { toast({ title: "Invoice not made", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const custInvoices = invoices.filter((x: any) => x.payer === "customer" && x.invoice && !["void", "draft"].includes(x.invoice.status));
  const owed = invoices.reduce((s: number, x: any) => s + (x.invoice && !["void", "cancelled"].includes(x.invoice.status) ? Math.max(0, Number(x.invoice.total) - Number(x.invoice.amount_paid || 0)) : 0), 0);

  /** Deposit or payment by M-Pesa: invoices the approved work first if needed, then prompts for part or all of it. */
  const prompt = async () => {
    if (!stk.phone) return toast({ title: "Enter the M-Pesa number", variant: "destructive" });
    setBusy("stk");
    try {
      let invId = stk.invoice || custInvoices.find((x: any) => Number(x.invoice.total) - Number(x.invoice.amount_paid || 0) > 0.5)?.invoice_id;
      if (!invId) {
        const g = groups.find((x) => x.payer === "customer");
        const c = customerOf("customer");
        if (!g || !c) throw new Error("Approve some work and choose the customer first: the prompt is for the job's invoice");
        const inv = await createJobInvoice({ tenantId: tenantId!, userId: user?.id, job, lines: g.lines as any, payer: "customer", customer: c, locationId: job.location_id || settings?.default_location_id || null });
        invId = inv.id;
      }
      const r: any = await wsApi("deposit-stk", { invoice_id: invId, phone: stk.phone, amount: Number(stk.amount) || undefined });
      await sb.from("garage_jobs").update({ deposit_amount: Number(stk.amount) || null, deposit_requested_at: new Date().toISOString() }).eq("id", job.id);
      setReq({ id: r.request_id, status: "pending" });
      toast({ title: "M-Pesa prompt sent", description: "Ask the customer to enter their PIN." });
      onChange();
    } catch (e: any) { toast({ title: "Prompt not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const gate = async (credit: boolean) => {
    setBusy(credit ? "credit" : "gate");
    try {
      const { data: r, error } = await sb.rpc("garage_release_gate", { p_job: job.id, p_credit: credit });
      if (error) throw error;
      if (!r?.ok) toast({ title: "The car cannot leave yet", description: `${r?.reason || "Not paid"}: ${money(r?.owed)} owed. Take payment, or a manager can release it on credit.`, variant: "destructive" });
      else {
        await sb.from("garage_jobs").update({ status: "collected" }).eq("id", job.id);
        toast({ title: r.credit ? "Released on credit" : "Gate pass done: car released" });
      }
      onChange();
    } catch (e: any) { toast({ title: "Not released", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const copyPay = async (invoiceId: string) => {
    try { const url = await getPayLink(invoiceId); await navigator.clipboard?.writeText(url); toast({ title: "Payment link copied" }); }
    catch (e: any) { toast({ title: "No link", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-2"><p className="text-[11px] text-muted-foreground">Approved work</p><p className="font-display font-bold tabular-nums">{money(approved.total)}</p></div>
        <div className="rounded-xl border border-border p-2"><p className="text-[11px] text-muted-foreground">Invoiced</p><p className="font-display font-bold tabular-nums">{money(invoices.reduce((s: number, x: any) => s + Number(x.invoice?.total || 0), 0))}</p></div>
        <div className="rounded-xl border border-border p-2"><p className="text-[11px] text-muted-foreground">Still owed</p><p className="font-display font-bold tabular-nums text-destructive">{money(owed)}</p></div>
        <div className="rounded-xl border border-border p-2"><p className="text-[11px] text-muted-foreground">Gate</p><p className="text-sm font-semibold">{job.gate_released_at ? (job.gate_on_credit ? "Released on credit" : "Released") : "Not released"}</p></div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">To invoice</p>
        {!groups.length && <p className="text-sm text-muted-foreground">Nothing approved is waiting to be invoiced.</p>}
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.payer} className="rounded-xl border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm">{PAYER_LABEL[g.payer]}</b>
                <span className="text-xs text-muted-foreground">{g.lines.length} line(s)</span>
                <span className="ml-auto font-semibold tabular-nums">{money(g.totals.total)}</span>
              </div>
              {g.payer !== "customer" || !job.customer ? (
                <div className="mt-2"><CustomerPicker value={customerOf(g.payer)} onChange={(c) => setPayers((p) => ({ ...p, [g.payer]: c }))} /></div>
              ) : null}
              <button type="button" disabled={!!busy} onClick={() => invoice(g.payer)} className="mt-2 inline-flex h-8 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                {busy === g.payer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />} Make invoice
              </button>
            </div>
          ))}
        </div>
      </div>

      {invoices.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Invoices</p>
          <div className="divide-y divide-border rounded-xl border border-border">
            {invoices.map((x: any) => (
              <div key={x.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
                <a href={href(`/sales/invoices/${x.invoice_id}`)} className="font-medium text-primary hover:underline">{x.invoice?.invoice_number}</a>
                <span className="text-xs text-muted-foreground">{PAYER_LABEL[x.payer as Payer] || x.payer} · {x.invoice?.customer_name}</span>
                <StatusPill status={x.invoice?.status} />
                {x.invoice?.etims_status === "signed" && <span className="text-[11px] font-semibold text-success">eTIMS signed</span>}
                <span className="ml-auto tabular-nums">{money(x.invoice?.total)}{Number(x.invoice?.amount_paid) > 0 ? <span className="ml-1 text-xs text-success">paid {money(x.invoice.amount_paid)}</span> : null}</span>
                {x.invoice && x.invoice.status !== "paid" && <button type="button" onClick={() => copyPay(x.invoice_id)} className="inline-flex items-center gap-1 text-xs text-primary"><Link2 className="h-3 w-3" />Pay link</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border p-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Smartphone className="h-4 w-4" /> M-Pesa prompt (deposit or payment)</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
          <input className="fi" inputMode="tel" value={stk.phone} onChange={(e) => setStk((s) => ({ ...s, phone: e.target.value }))} placeholder="07XXXXXXXX" />
          <input className="fi" inputMode="numeric" value={stk.amount} onChange={(e) => setStk((s) => ({ ...s, amount: e.target.value }))} placeholder="Amount (blank = all)" />
          <select className="fi" value={stk.invoice} onChange={(e) => setStk((s) => ({ ...s, invoice: e.target.value }))}>
            <option value="">{custInvoices.length ? "First unpaid invoice" : "Invoice the approved work"}</option>
            {custInvoices.map((x: any) => <option key={x.invoice_id} value={x.invoice_id}>{x.invoice.invoice_number} · {money(Number(x.invoice.total) - Number(x.invoice.amount_paid || 0))} due</option>)}
          </select>
          <button type="button" disabled={!!busy} onClick={prompt} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy === "stk" && <Loader2 className="h-4 w-4 animate-spin" />}Send prompt</button>
        </div>
        {req && <p className="mt-1 text-xs">Prompt: <b>{req.status}</b>{req.status === "pending" ? " · waiting for the customer's PIN…" : ""}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">A deposit goes against the job's invoice for the approved work. Extra work approved later gets its own invoice.</p>
      </div>

      {job.status === "ready" && !job.gate_released_at && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><DoorOpen className="h-4 w-4" /> Gate pass</p>
          <p className="text-xs text-muted-foreground">The car leaves when every invoice is paid, or when a manager approves it on credit.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => gate(false)} className="inline-flex h-9 items-center gap-1 rounded-xl bg-success px-3 text-sm font-semibold text-white disabled:opacity-60">{busy === "gate" && <Loader2 className="h-4 w-4 animate-spin" />}Release car (paid)</button>
            {(can("garage_jobs", "credit") || can("invoices", "approve")) && <button type="button" disabled={!!busy} onClick={() => gate(true)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm disabled:opacity-60">{busy === "credit" && <Loader2 className="h-4 w-4 animate-spin" />}Release on credit</button>}
          </div>
        </div>
      )}
      <a href={publicUrl(`/t/${job.tracking_token}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" />Customer tracking page</a>
    </div>
  );
}
