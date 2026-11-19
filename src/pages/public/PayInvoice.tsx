import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, Loader2, Smartphone, CreditCard, Receipt, AlertTriangle } from "lucide-react";
import { Orbs } from "@/components/brand/Orbs";
import { DashMark } from "@/components/brand/DashLogo";
import PoweredBy from "@/components/PoweredBy";
import { cn } from "@/lib/utils";

type PayInfo = {
  company: { name: string; logo: string | null; phone: string | null; email: string | null };
  invoice: {
    number: string; customer: string; issue_date: string | null; due_date: string | null; currency: string;
    items: { name: string; quantity: number; amount: number }[];
    subtotal: number; tax: number; discount: number; total: number; paid: number; balance: number; status: string;
  };
  pay: { demo: boolean; mpesa: boolean; card: boolean; phone: string | null; email: string | null; till: string | null; paybill: string | null; account: string | null };
};

const money = (n: number, ccy = "KES") => `${ccy} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error || "Something went wrong. Try again.");
  return out as T;
}

const Card = ({ children, className }: { children: ReactNode; className?: string }) => <section className={cn("rounded-3xl border border-border bg-card/95 p-5 shadow-xl backdrop-blur sm:p-6", className)}>{children}</section>;
const Note = ({ tone, children }: { tone: "ok" | "bad" | "info"; children: ReactNode }) => (
  <p role={tone === "bad" ? "alert" : "status"} className={cn("rounded-xl px-3 py-2 text-sm", tone === "ok" ? "bg-success/10 text-success" : tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{children}</p>
);

/** /pay/<token>: the customer sees one invoice and pays it by M-Pesa or card. No login. */
export default function PayInvoice() {
  const { token = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<"" | "sending" | "waiting" | "done" | "failed" | "card" | "checking">("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<PayInfo>(`/api/pub/pay?t=${encodeURIComponent(token)}`);
      setInfo(d);
      setPhone((p) => p || d.pay.phone || "");
      setEmail((e) => e || d.pay.email || "");
      setAmount((a) => a || String(d.invoice.balance));
    } catch (e: any) { setError(e.message); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  // Back from the card page: ask Paystack how it went.
  const ref = params.get("ref") || params.get("reference");
  useEffect(() => {
    if (!ref) return;
    let live = true;
    (async () => {
      setState("checking"); setMsg("Checking your card payment…");
      for (let i = 0; i < 10 && live; i++) {
        try {
          const r = await api<{ status: string }>("/api/pub/pay/card-verify", { t: token, ref });
          if (r.status === "completed") { setState("done"); setMsg("Card payment received. Thank you."); void load(); break; }
          if (r.status === "failed" || r.status === "cancelled") { setState("failed"); setMsg("The card payment did not go through. You can try again."); break; }
        } catch (e: any) { setState("failed"); setMsg(e.message); break; }
        await wait(3000);
        if (i === 9) { setState("failed"); setMsg("Still waiting for the card company. If you were charged, the payment is recorded automatically."); }
      }
      if (live) setParams((p) => { const n = new URLSearchParams(p); n.delete("ref"); n.delete("reference"); n.delete("trxref"); return n; }, { replace: true });
    })();
    return () => { live = false; };
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const payMpesa = async () => {
    setState("sending"); setMsg("");
    try {
      const r = await api<{ request_id: string }>("/api/pub/pay/mpesa", { t: token, phone, amount: Number(amount) });
      setState("waiting"); setMsg("Check your phone and enter your M-Pesa PIN.");
      for (let i = 0; i < 40; i++) {
        await wait(3000);
        const s = await api<{ status: string; receipt: string | null }>("/api/pub/pay/mpesa-status", { t: token, request_id: r.request_id });
        if (s.status === "completed") { setState("done"); setMsg(`Payment received${s.receipt ? ` · ${s.receipt}` : ""}. Thank you.`); void load(); return; }
        if (s.status === "failed" || s.status === "cancelled") { setState("failed"); setMsg(s.status === "cancelled" ? "The prompt was cancelled. You can try again." : "The payment did not go through. You can try again."); return; }
      }
      setState("failed"); setMsg("No answer yet. If you paid, it is recorded automatically.");
    } catch (e: any) { setState("failed"); setMsg(e.message); }
  };

  const payCard = async () => {
    setState("card"); setMsg("");
    try {
      const r = await api<{ url: string }>("/api/pub/pay/card", { t: token, email, amount: Number(amount) });
      window.location.assign(r.url);
    } catch (e: any) { setState("failed"); setMsg(e.message); }
  };

  const inv = info?.invoice;
  const busy = state === "sending" || state === "waiting" || state === "card" || state === "checking";
  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:py-10">
      <Helmet><title>{inv ? `Invoice ${inv.number}${info?.company.name ? ` · ${info.company.name}` : ""}` : "Pay invoice"}</title><meta name="robots" content="noindex" /></Helmet>
      <Orbs intensity="subtle" />
      <div className="relative mx-auto w-full max-w-xl space-y-4">
        <header className="flex items-center gap-3">
          {info?.company.logo ? <img src={info.company.logo} alt="" className="h-12 w-12 rounded-2xl object-contain shadow" /> : <DashMark className="h-12 w-12" />}
          <div className="min-w-0"><p className="truncate font-display text-xl font-extrabold">{info?.company.name || " "}</p><p className="text-sm text-muted-foreground">Pay invoice</p></div>
        </header>

        {error ? (
          <Card><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><p className="font-semibold">{error}</p><p className="mt-1 text-sm text-muted-foreground">Ask the business that sent you this link for a new one.</p></div></div></Card>
        ) : !info || !inv ? (
          <Card><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the invoice…</p></Card>
        ) : <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Receipt className="h-3.5 w-3.5" /> Invoice</p>
                <p className="font-display text-2xl font-bold">{inv.number}</p>
                <p className="text-sm text-muted-foreground">For {inv.customer}</p>
              </div>
              <div className="text-right text-sm">
                <p><span className="text-muted-foreground">Date </span>{day(inv.issue_date)}</p>
                {inv.due_date && <p><span className="text-muted-foreground">Due </span>{day(inv.due_date)}</p>}
              </div>
            </div>
            {inv.items.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 text-right font-medium">Qty</th><th className="py-1.5 text-right font-medium">Amount</th></tr></thead>
                <tbody>{inv.items.map((l, i) => <tr key={i} className="border-b border-border/60"><td className="py-1.5 pr-2">{l.name}</td><td className="py-1.5 text-right tabular-nums">{l.quantity}</td><td className="py-1.5 text-right tabular-nums">{money(l.amount, inv.currency)}</td></tr>)}</tbody>
              </table>
            )}
            <dl className="mt-4 space-y-1 text-sm">
              {inv.tax > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd className="tabular-nums">{money(inv.tax, inv.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{money(inv.total, inv.currency)}</dd></div>
              {inv.paid > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{money(inv.paid, inv.currency)}</dd></div>}
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><dt>Balance due</dt><dd className="tabular-nums">{money(inv.balance, inv.currency)}</dd></div>
            </dl>
          </Card>

          {msg && <Note tone={state === "done" ? "ok" : state === "failed" ? "bad" : "info"}>{busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}{msg}</Note>}

          {inv.balance <= 0 ? (
            <Card><p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="h-5 w-5" /> This invoice is paid in full. Thank you.</p></Card>
          ) : <>
            {info.pay.demo && <Note tone="info">This is the demo company. Payments are switched off here.</Note>}
            {(info.pay.mpesa || info.pay.card) && (
              <Card className="space-y-4">
                <label className="block space-y-1"><span className="text-sm font-medium">Amount to pay ({inv.currency})</span>
                  <input className="fi" type="number" min={1} max={inv.balance} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></label>
                {info.pay.mpesa && (
                  <div className="space-y-2">
                    <label className="block space-y-1"><span className="text-sm font-medium">M-Pesa number</span>
                      <input className="fi" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} /></label>
                    <button type="button" onClick={payMpesa} disabled={busy || !phone.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60">
                      {state === "sending" || state === "waiting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} {state === "waiting" ? "Waiting for your PIN…" : "Pay with M-Pesa"}
                    </button>
                    <p className="text-xs text-muted-foreground">You get a prompt on your phone. Enter your PIN to pay.</p>
                  </div>
                )}
                {info.pay.card && (
                  <div className="space-y-2 border-t border-border pt-4">
                    <label className="block space-y-1"><span className="text-sm font-medium">Email for the receipt</span>
                      <input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} /></label>
                    <button type="button" onClick={payCard} disabled={busy || !email.trim()} className={cn("inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold disabled:opacity-60", info.pay.mpesa ? "border border-border bg-card" : "bg-primary text-primary-foreground")}>
                      {state === "card" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay by card
                    </button>
                    <p className="text-xs text-muted-foreground">You go to a secure card page and come back here when done.</p>
                  </div>
                )}
              </Card>
            )}
            {(info.pay.till || info.pay.paybill) && (
              <Card>
                <p className="text-sm font-semibold">{info.pay.mpesa || info.pay.card ? "Or pay by M-Pesa yourself" : "Pay by M-Pesa"}</p>
                {info.pay.till ? <p className="mt-1 text-sm">Buy Goods Till <b className="tabular-nums">{info.pay.till}</b></p>
                  : <p className="mt-1 text-sm">Paybill <b className="tabular-nums">{info.pay.paybill}</b>, account <b>{info.pay.account}</b></p>}
                <p className="mt-1 text-xs text-muted-foreground">The business confirms payments made this way.</p>
              </Card>
            )}
            {!info.pay.mpesa && !info.pay.card && !info.pay.till && !info.pay.paybill && !info.pay.demo && (
              <Note tone="info">Online payment is not set up for this business. {info.company.phone ? `Call ${info.company.phone} to pay.` : "Contact them to pay."}</Note>
            )}
          </>}
          {(info.company.phone || info.company.email) && <p className="text-center text-xs text-muted-foreground">Questions? {[info.company.phone, info.company.email].filter(Boolean).join(" · ")}</p>}
        </>}
        <p className="pt-6 text-center"><PoweredBy /></p>
      </div>
    </main>
  );
}
