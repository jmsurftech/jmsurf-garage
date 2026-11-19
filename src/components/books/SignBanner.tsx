import { useState } from "react";
import { PenLine, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import type { useDocSignature } from "@/lib/signing";

/** On a document that must be signed: submit for signing, waiting, rejected (with the reason), or signed by whom and when. */
export function SignBanner({ sig, number, title, amount, canSubmit = true }: { sig: ReturnType<typeof useDocSignature>; number: string | null; title: string; amount?: number; canSubmit?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (!sig.rule.enabled) return null;
  const submit = async () => {
    setBusy(true);
    try { await sig.submit(number, title, amount); toast.success("Sent for signing", { description: "The signer is notified. You are told when it is signed." }); }
    catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const r = sig.req;
  if (r?.status === "signed") return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
      <CheckCircle2 className="h-4 w-4 text-success" />
      <span className="flex-1">{r.with_approval ? "Approved and signed" : "Signed"} by <b>{r.signed_by_name || "the signer"}</b>{r.signed_at ? ` on ${new Date(r.signed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}. It is ready to send and print.</span>
    </div>
  );
  if (r?.status === "pending") return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <Clock className="h-4 w-4 text-warning" /><span className="flex-1">Waiting for a signature{r.with_approval ? " and approval" : ""}. It can be sent once it is signed.</span>
    </div>
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
      {r?.status === "rejected" ? <XCircle className="h-4 w-4 text-destructive" /> : <PenLine className="h-4 w-4 text-primary" />}
      <span className="flex-1">{r?.status === "rejected" ? <>Not signed: <b>{r.reason}</b>. Fix it, then submit again.</> : <>This document must be signed{sig.rule.with_approval ? " and approved" : ""} before it is sent.</>}</span>
      {canSubmit && <Button size="sm" disabled={busy} onClick={() => void submit()}><PenLine /> {r?.status === "rejected" ? "Submit again" : "Submit for signing"}</Button>}
    </div>
  );
}
