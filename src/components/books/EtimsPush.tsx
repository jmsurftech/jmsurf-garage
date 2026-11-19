import { useState } from "react";
import { CheckCircle2, RefreshCw, UploadCloud } from "lucide-react";
import { erpApi } from "@/lib/erpApi";
import { BrandLogo } from "@/components/BrandLogo";
import { OrbSpinner } from "@/components/orbs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * "Push to eTIMS" for an invoice or credit note: sends it to KRA and, once signed,
 * shows the KRA receipt number linking to KRA's receipt page.
 */
export function EtimsPush({ kind, doc, onDone, className }: { kind: "invoice" | "credit_note"; doc: any; onDone?: () => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  if (doc.etims_status === "signed") {
    const badge = (
      <span className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border border-success/30 bg-success/10 px-3 text-sm font-semibold text-success", className)}>
        <CheckCircle2 className="h-4 w-4" /> Pushed to eTIMS{doc.etims_rcpt_no ? ` · ${doc.etims_rcpt_no}` : ""}
      </span>
    );
    return doc.etims_qr_url ? <a href={doc.etims_qr_url} target="_blank" rel="noopener noreferrer" title="Open the KRA receipt">{badge}</a> : badge;
  }
  if (doc.etims_status === "pending") {
    return <span title={doc.etims_error || "Waiting for KRA"} className={cn("inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-muted-foreground", className)}><OrbSpinner /> Waiting for KRA</span>;
  }
  const failed = doc.etims_status === "failed" || !!doc.etims_error;
  const push = async () => {
    setBusy(true);
    try {
      const r = await erpApi(kind === "credit_note" ? "etims/sign-credit-note" : "etims/sign-invoice", { id: doc.id });
      if (r.pending) toast.message("Sent — waiting for KRA", { description: "It is signed automatically as soon as KRA answers." });
      else toast.success("Pushed to eTIMS", { description: r.rcpt_no ? `KRA receipt ${r.rcpt_no}` : undefined });
    } catch (e: any) {
      toast.error("Not pushed to eTIMS", { description: e.message });
    } finally { setBusy(false); onDone?.(); }
  };
  return (
    <button type="button" disabled={busy} onClick={() => void push()} title={failed ? `Last attempt: ${doc.etims_error || "failed"}` : "Send this document to KRA eTIMS"}
      className={cn("inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors disabled:opacity-60",
        failed ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10" : "border-border bg-card hover:border-primary/40 hover:text-primary", className)}>
      {busy ? <OrbSpinner /> : <BrandLogo id="kra" name="KRA" className="h-5 w-5 rounded-md border-0" />}
      {failed ? <><RefreshCw className="h-3.5 w-3.5" /> Retry push to eTIMS</> : <><UploadCloud className="h-3.5 w-3.5" /> Push to eTIMS</>}
    </button>
  );
}
