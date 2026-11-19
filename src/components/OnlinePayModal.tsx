import { useEffect, useRef, useState } from "react";
import { Globe2, Smartphone, CheckCircle2, XCircle, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { payApi, useGatewayCatalog, type ShopGateway } from "@/lib/gateways";
import { openWhatsApp, looksLikePhone } from "@/lib/shareMessage";
import { OrbSpinner } from "@/components/orbs";

type Phase = "choose" | "waiting" | "paid" | "failed";

/**
 * Takes payment for a pending sale through one of the shop's extra gateways:
 * a phone prompt (Kopo Kopo, IntaSend, MTN, Airtel, WaafiPay) or a checkout
 * page the customer opens (Flutterwave, Stripe, PayPal, Pesapal, Chapa).
 */
export default function OnlinePayModal({ sale, gateways, customerPhone, customerEmail, onPaid, onCancel }: {
  sale: { id: string; total: number };
  gateways: ShopGateway[];
  customerPhone?: string;
  customerEmail?: string;
  onPaid: () => void;
  onCancel: () => void;
}) {
  const { data: catalog = [] } = useGatewayCatalog();
  const enabled = gateways.filter((g) => g.enabled).map((g) => catalog.find((c) => c.id === g.provider)).filter(Boolean) as any[];
  const [provider, setProvider] = useState<string>(enabled[0]?.id || "");
  const [phone, setPhone] = useState(customerPhone || "");
  const [email, setEmail] = useState(customerEmail || "");
  const [phase, setPhase] = useState<Phase>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [charge, setCharge] = useState<{ amount: number; currency: string } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => { if (!provider && enabled[0]) setProvider(enabled[0].id); }, [enabled.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const current = enabled.find((g) => g.id === provider);

  const poll = () => {
    if (timer.current) window.clearInterval(timer.current);
    const started = Date.now();
    timer.current = window.setInterval(async () => {
      const r = await payApi("sale/status", { sale_id: sale.id });
      if (r?.status === "completed") { window.clearInterval(timer.current!); setPhase("paid"); setTimeout(onPaid, 900); }
      else if (r?.status === "failed" || r?.status === "cancelled") { window.clearInterval(timer.current!); setPhase("failed"); setError(r?.message || "The payment was not completed"); }
      else if (Date.now() - started > 15 * 60_000) { window.clearInterval(timer.current!); }
    }, 4000);
  };

  const start = async () => {
    setBusy(true); setError("");
    const r = await payApi("sale/start", { sale_id: sale.id, provider, phone, email });
    setBusy(false);
    if (!r?.ok) { setError(r?.error || "The gateway did not accept the payment"); return; }
    setCharge({ amount: r.amount, currency: r.currency });
    setUrl(r.url || null);
    setPhase("waiting");
    if (r.url) window.open(r.url, "_blank", "noopener,width=520,height=760");
    poll();
  };

  const sendLink = () => {
    if (!url) return;
    openWhatsApp(phone, `Please pay ${charge ? `${charge.currency} ${charge.amount.toLocaleString()}` : formatKES(sale.total)} for your purchase here: ${url}`);
  };

  return (
    <Modal open onClose={phase === "waiting" ? () => undefined : onCancel} icon={Globe2} title="Pay online"
      description={`Amount due ${formatKES(sale.total)}`}
      footer={
        phase === "choose" ? (<>
          <Button variant="outline" onClick={onCancel}>Cancel sale</Button>
          <Button onClick={start} disabled={busy || !current || (current.kind === "push" && !looksLikePhone(phone))}>
            {busy && <OrbSpinner />} {current?.kind === "push" ? "Send prompt" : "Open checkout"}
          </Button>
        </>) : phase === "waiting" ? (<>
          <Button variant="outline" onClick={() => { if (timer.current) window.clearInterval(timer.current); onCancel(); }}>Cancel sale</Button>
        </>) : phase === "failed" ? (<>
          <Button variant="outline" onClick={onCancel}>Cancel sale</Button>
          <Button onClick={() => { setPhase("choose"); setError(""); }}>Try again</Button>
        </>) : null
      }>
      {phase === "choose" && (
        <div className="space-y-4">
          {enabled.length === 0 ? <p className="text-sm text-muted-foreground">No online gateway is switched on. Open System → Payment gateways → More gateways.</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {enabled.map((g) => (
                <button key={g.id} type="button" onClick={() => setProvider(g.id)}
                  className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", provider === g.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50")}>
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", g.kind === "push" ? "bg-success/10 text-success" : "bg-info/10 text-info")}>
                    {g.kind === "push" ? <Smartphone className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
                  </span>
                  <span><span className="block text-sm font-semibold">{g.label}</span><span className="text-xs text-muted-foreground">{g.kind === "push" ? "Prompt on the customer's phone" : "Card / wallet checkout page"}</span></span>
                </button>
              ))}
            </div>
          )}
          {current && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={current.kind === "push" ? "Customer's phone *" : "Customer's phone (to send the link)"}>
                <input className="fi" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0772 123 456 or +256…" autoFocus />
              </Field>
              {current.kind === "redirect" && (
                <Field label="Customer's email (optional)"><input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              )}
            </div>
          )}
          {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        </div>
      )}

      {phase === "waiting" && (
        <div className="space-y-4 text-center">
          <OrbSpinner className="mx-auto h-10 w-10 text-primary" />
          <div>
            <p className="font-semibold">{current?.kind === "push" ? "Waiting for the customer to approve on their phone…" : "Waiting for the customer to pay on the checkout page…"}</p>
            {charge && <p className="mt-1 text-sm text-muted-foreground">Charging {charge.currency} {charge.amount.toLocaleString()} through {current?.label}</p>}
          </div>
          {url && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-left">
              <p className="text-xs text-muted-foreground">Checkout link: open it on this screen or send it to the customer's phone.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => window.open(url, "_blank", "noopener")}><ExternalLink /> Open</Button>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url)}><Copy /> Copy</Button>
                <Button size="sm" variant="outline" disabled={!looksLikePhone(phone)} onClick={sendLink}><MessageCircle /> Send on WhatsApp</Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">This updates by itself. The sale completes only when {current?.label} confirms the money.</p>
        </div>
      )}

      {phase === "paid" && (
        <div className="py-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-success" /><p className="mt-3 font-semibold">Payment received</p></div>
      )}
      {phase === "failed" && (
        <div className="py-6 text-center"><XCircle className="mx-auto h-12 w-12 text-destructive" /><p className="mt-3 font-semibold">Payment not completed</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div>
      )}
    </Modal>
  );
}
