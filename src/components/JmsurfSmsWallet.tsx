import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, RefreshCw, Smartphone, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { messagingApi } from "@/lib/messaging";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

export type JmsurfSmsBalance = {
  ok: boolean;
  balance_kes?: number;
  sms_remaining?: number;
  rate_kes_per_sms?: number;
  billing?: "prepaid" | "internal";
  /** JMSURF's built-in SMS: prepaid credit kept in JMSURF Garage. */
  builtin?: boolean;
  min_topup_kes?: number;
  error?: string;
  needsKey?: boolean;
};

/** Live JMSURF SMS balance for the company's saved API key. */
export function useJmsurfSmsBalance(enabled = true) {
  return useQuery({
    queryKey: ["jmsurf-sms-balance"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => (await messagingApi("jmsurf/balance", {})) as JmsurfSmsBalance,
  });
}

/** Balance card with an M-Pesa top-up, so the owner never has to sign in to JMSURF SMS. */
export function JmsurfSmsWallet({ className, compact, lowAt }: { className?: string; compact?: boolean; /** Warn below this many SMS. */ lowAt?: number }) {
  const { data, isFetching, refetch } = useJmsurfSmsBalance();
  const [topup, setTopup] = useState(false);
  if (data?.needsKey) return null;
  const low = !!data?.ok && data.billing !== "internal" && !!lowAt && Number(data.sms_remaining ?? 0) < lowAt;
  return (
    <div className={cn("rounded-2xl border bg-card p-4", low ? "border-warning/50" : "border-border", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-full", low ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary")}><Wallet className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SMS balance</p>
          {data?.ok ? (
            <p className="font-display text-xl font-bold">
              {data.billing === "internal" ? "No limit" : `${Number(data.sms_remaining ?? 0).toLocaleString()} SMS`}{" "}
              <span className="text-sm font-medium text-muted-foreground">· {formatKES(Number(data.balance_kes ?? 0))}{data.rate_kes_per_sms ? ` · KES ${Number(data.rate_kes_per_sms).toFixed(2)} per SMS` : ""}</span>
            </p>
          ) : data ? <p className="text-sm text-destructive">{data.error}</p> : <OrbSpinner className="size-5" />}
        </div>
        <Button size={compact ? "sm" : "default"} variant="ghost" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh balance"><RefreshCw className={cn(isFetching && "animate-spin")} /></Button>
        <Button size={compact ? "sm" : "default"} onClick={() => setTopup(true)}><Smartphone /> Top up</Button>
      </div>
      {low && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          Your SMS balance is low. Top up so receipts, reminders and alerts keep going out.
        </p>
      )}
      {topup && <TopupModal onClose={() => setTopup(false)} rate={data?.rate_kes_per_sms} builtin={!!data?.builtin} min={data?.min_topup_kes} />}
    </div>
  );
}

const DONE = ["completed", "success", "succeeded", "paid"];
const FAILED = ["failed", "cancelled", "canceled", "expired"];

function TopupModal({ onClose, rate, builtin, min = 10 }: { onClose: () => void; rate?: number; builtin?: boolean; min?: number }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("500");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<{ step: "form" | "waiting" | "done" | "failed"; id?: string; msg?: string; estimate?: number }>({ step: "form" });
  const timer = useRef<number>();
  useEffect(() => () => window.clearInterval(timer.current), []);
  const refresh = () => ["jmsurf-sms-balance", "sms-overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const start = async () => {
    setState({ step: "waiting", msg: "Sending the M-Pesa prompt…" });
    const r: any = await messagingApi("jmsurf/topup", { amount: Number(amount), phone });
    if (!r.ok) return setState({ step: "form", msg: r.error });
    refresh();
    setState({ step: "waiting", id: r.id, estimate: r.sms_estimate, msg: `Check ${phone} and enter your M-Pesa PIN.` });
    const began = Date.now();
    timer.current = window.setInterval(async () => {
      const s: any = await messagingApi("jmsurf/topup-status", { id: r.id });
      const st = String(s?.status || "").toLowerCase();
      if (DONE.includes(st)) {
        window.clearInterval(timer.current);
        setState({ step: "done", msg: `Paid. You now have ${Number(s.sms_remaining ?? 0).toLocaleString()} SMS.` });
        refresh();
      } else if (FAILED.includes(st) || Date.now() - began > 150_000) {
        window.clearInterval(timer.current);
        setState({ step: "failed", msg: FAILED.includes(st) ? "The payment was not completed." : "No answer from M-Pesa yet. If you paid, the SMS are added in a few minutes." });
        refresh();
      }
    }, 4000);
  };

  const presets = [200, 500, 1000, 2500, 5000];
  const estimate = rate && Number(amount) > 0 ? Math.floor(Number(amount) / rate) : 0;
  return (
    <Modal open onClose={onClose} locked={state.step === "waiting"} title="Top up SMS" icon={Smartphone} description="Pay by M-Pesa. The SMS are added as soon as you pay."
      footer={state.step === "form" ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={start} disabled={!(Number(amount) >= min) || phone.replace(/\D/g, "").length < 9}>Send M-Pesa prompt</Button></>
        : <Button onClick={onClose} disabled={state.step === "waiting"}>{state.step === "waiting" ? "Waiting…" : "Close"}</Button>}>
      {state.step === "form" && (
        <div className="space-y-4">
          <Field label="Amount (KES)" hint={estimate ? `About ${estimate.toLocaleString()} SMS at KES ${rate!.toFixed(2)} each.` : `Between KES ${min.toLocaleString()} and 100,000.`}>
            <input className="fi" type="number" min={min} max={100000} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">{presets.map((p) => <button key={p} type="button" onClick={() => setAmount(String(p))} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", Number(amount) === p ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{p.toLocaleString()}</button>)}</div>
          </Field>
          <Field label="M-Pesa number to pay from"><input className="fi" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          {state.msg && <p className="text-sm text-destructive">{state.msg}</p>}
          {!builtin && <a href="https://jmsurfsms.co.ke" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Pay by card instead on JMSURF SMS <ExternalLink className="h-3 w-3" /></a>}
        </div>
      )}
      {state.step !== "form" && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          {state.step === "waiting" ? <OrbSpinner className="size-14" /> : state.step === "done" ? <CheckCircle2 className="h-12 w-12 text-success" /> : <XCircle className="h-12 w-12 text-destructive" />}
          <p className="font-medium">{state.msg}</p>
          {state.step === "waiting" && state.estimate ? <p className="text-sm text-muted-foreground">About {state.estimate.toLocaleString()} SMS.</p> : null}
        </div>
      )}
    </Modal>
  );
}
