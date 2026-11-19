import { useState } from "react";
import { Send, Copy, FileText, MessageCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { StatusPill } from "@/components/kit";
import { sb, must, wsApi } from "../lib/api";
import { useGarageSettings } from "../lib/data";
import { jobTotals, lineGross } from "../lib/totals";
import { money, when } from "./bits";
import { publicUrl } from "../lib/nav";

/**
 * Estimates: a snapshot of the lines still waiting for the customer, sent as a link (/e/<token>)
 * where the customer approves or declines each line. A new estimate supersedes the open one
 * (version history kept). Extra work found mid-job goes out as an "extra work" estimate.
 */
export default function JobEstimate({ data, onChange }: { data: any; onChange: () => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: settings } = useGarageSettings();
  const { job, lines, estimates } = data;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deposit, setDeposit] = useState("");
  const waiting = lines.filter((l: any) => l.approved === null && l.status !== "cancelled");
  const hadApproval = lines.some((l: any) => l.approved === true);
  const open = estimates.find((e: any) => ["draft", "sent", "viewed"].includes(e.status));

  const make = async () => {
    if (!waiting.length) return toast({ title: "Every line already has an answer", description: "Add new lines first.", variant: "destructive" });
    setBusy("make");
    try {
      if (open) must(await sb.from("garage_estimates").update({ status: "superseded" }).eq("id", open.id));
      const t = jobTotals(waiting);
      const version = (estimates[0]?.version || 0) + 1;
      const snap = waiting.map((l: any) => ({ id: l.id, kind: l.kind, description: l.description, qty: Number(l.qty), rate: Number(l.rate), discount: Number(l.discount) || 0, tax_rate: Number(l.tax_rate) || 0, priority: l.priority, amount: lineGross(l), decision: null }));
      must(await sb.from("garage_estimates").insert({
        tenant_id: tenantId, job_id: job.id, version, kind: open ? "revision" : hadApproval ? "extra" : "initial", status: "draft", lines: snap,
        subtotal: t.subtotal, tax: t.tax, total: t.total, message: message.trim() || null, deposit_amount: Number(deposit) || null,
        expires_at: new Date(Date.now() + (Number(settings?.estimate_valid_days) || 14) * 86_400_000).toISOString(),
      }));
      toast({ title: `Estimate v${version} ready to send` });
      onChange();
    } catch (e: any) { toast({ title: "Estimate not made", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const send = async (est: any, channel: "sms" | "whatsapp") => {
    setBusy(`${est.id}-${channel}`);
    try { const r: any = await wsApi("send-estimate", { estimate_id: est.id, channel }); toast({ title: `Sent by ${r.channel === "whatsapp" ? "WhatsApp" : "SMS"}` }); onChange(); }
    catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const copy = async (est: any) => {
    if (est.status === "draft") await sb.from("garage_estimates").update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "link" }).eq("id", est.id);
    await navigator.clipboard?.writeText(publicUrl(`/e/${est.token}`)).catch(() => undefined);
    toast({ title: "Approval link copied", description: "Paste it in any chat with the customer." });
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border p-2.5">
        <p className="text-sm"><b>{waiting.length}</b> line(s) waiting for the customer · {money(jobTotals(waiting).total)}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <input className="fi" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter a short note to the customer (optional)" />
          <input className="fi" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="Deposit asked (optional)" />
          <button type="button" disabled={!!busy || !waiting.length} onClick={make} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {open ? "New version" : hadApproval ? "Extra work estimate" : "Make estimate"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Valid for {settings?.estimate_valid_days || 14} days. The customer approves or declines each line on their phone; the time and the channel are saved on each line.</p>
      </div>

      {!estimates.length && <p className="text-sm text-muted-foreground">No estimates yet.</p>}
      {estimates.map((e: any) => (
        <div key={e.id} className="rounded-xl border border-border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">v{e.version}</b>
            <span className="text-xs text-muted-foreground">{e.kind === "extra" ? "Extra work" : e.kind === "revision" ? "Revision" : "Estimate"} · {when(e.created_at)}</span>
            <StatusPill status={e.status} />
            <span className="ml-auto text-sm font-semibold tabular-nums">{money(e.total)}{["approved", "partly_approved"].includes(e.status) ? <span className="ml-1 text-success">({money(e.approved_total)} approved)</span> : null}</span>
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {(e.lines || []).map((l: any) => (
              <li key={l.id} className="flex gap-2">
                <span className={l.decision === "approved" ? "text-success" : l.decision === "declined" ? "text-destructive line-through" : ""}>{l.description}</span>
                {l.priority !== "must" && <span className="text-muted-foreground">({l.priority})</span>}
                <span className="ml-auto tabular-nums">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          {e.customer_note && <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs">Customer: "{e.customer_note}"</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {e.sent_at ? `Sent ${when(e.sent_at)} by ${e.sent_via || "link"}` : "Not sent"}{e.viewed_at ? ` · opened ${when(e.viewed_at)}` : ""}{e.responded_at ? ` · answered ${when(e.responded_at)}` : ""}{e.expires_at ? ` · valid to ${when(e.expires_at, false)}` : ""}
          </p>
          {["draft", "sent", "viewed"].includes(e.status) && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => send(e, "sms")} className="inline-flex h-8 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">{busy === `${e.id}-sms` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}SMS</button>
              <button type="button" disabled={!!busy} onClick={() => send(e, "whatsapp")} className="inline-flex h-8 items-center gap-1 rounded-xl border border-border px-2.5 text-xs font-semibold disabled:opacity-60"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</button>
              <button type="button" onClick={() => copy(e)} className="inline-flex h-8 items-center gap-1 rounded-xl border border-border px-2.5 text-xs"><Copy className="h-3.5 w-3.5" />Copy link</button>
              <a href={publicUrl(`/e/${e.token}`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-xl border border-border px-2.5 text-xs">Preview</a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
