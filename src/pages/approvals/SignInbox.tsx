import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine, Check, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Modal, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import { SIGN_TYPES, type SignatureRequest } from "@/lib/signing";
import { friendlyError } from "@/lib/friendlyError";
import { formatKES } from "@/lib/format";

const sb = supabase as any;
const PREVIEW_KIND: Record<string, string> = { quote: "quote", sales_order: "sales_order", invoice: "invoice", credit_note: "credit_note", purchase_order: "po", bill: "bill" };

/** Approvals → To sign: documents waiting for my signature, with a preview, Sign / Approve and sign, or Reject. */
export default function SignInbox() {
  const { user } = useAuth() as any;
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [reject, setReject] = useState<SignatureRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const { data = [] } = useQuery({
    queryKey: ["signature-requests", user?.id], enabled: !!user?.id, refetchInterval: 30_000,
    queryFn: async () => ((await sb.from("signature_requests").select("*").in("status", ["pending", "signed", "rejected"]).order("created_at", { ascending: false }).limit(200)).data || []) as SignatureRequest[],
  });
  const mine = data.filter((r) => r.status === "pending" && r.signers.includes(user?.id));
  const recent = data.filter((r) => r.status !== "pending" && (r.signed_by === user?.id || r.requested_by === user?.id)).slice(0, 8);
  const decide = async (r: SignatureRequest, sign: boolean, why?: string) => {
    setBusy(r.id);
    try {
      const { error } = await sb.rpc("decide_signature", { p_id: r.id, p_sign: sign, p_reason: why || null });
      if (error) throw error;
      toast.success(sign ? (r.with_approval ? "Approved and signed" : "Signed and stamped") : "Rejected", { description: sign ? "The person who submitted it can send it now." : "They were told why." });
      setReject(null); setReason("");
      void qc.invalidateQueries({ queryKey: ["signature-requests"] });
      void qc.invalidateQueries({ queryKey: ["doc-signature"] });
      void qc.invalidateQueries({ queryKey: ["doc-model"] });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };
  if (!mine.length && !recent.length) return null;
  const label = (t: string) => SIGN_TYPES.find((x) => x.key === t)?.label.replace(/s(\s|$).*/, "") || t;
  return (
    <Panel title={`To sign${mine.length ? ` · ${mine.length}` : ""}`} icon={PenLine} description="Documents waiting for your signature and stamp.">
      {mine.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting for your signature.</p>}
      <ul className="space-y-3">
        {mine.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{label(r.doc_type)} {r.doc_number || ""} <span className="font-normal text-muted-foreground">· {r.title}</span></p>
                <p className="text-xs text-muted-foreground">From {r.requested_by_name || "a colleague"} · {new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{r.amount ? ` · ${formatKES(Number(r.amount))}` : ""}</p>
              </div>
              {r.doc_type === "contract"
                ? <Button size="sm" variant="outline" asChild><Link to={`/contracts/${r.doc_id}`}><Eye /> Read contract</Link></Button>
                : <Button size="sm" variant="outline" onClick={() => setOpen(open === r.id ? null : r.id)}><Eye /> {open === r.id ? "Hide" : "Review"}</Button>}
              <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, true)}><Check /> {r.with_approval ? "Approve and sign" : "Sign"}</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setReject(r); setReason(""); }}><X /> Reject</Button>
            </div>
            {open === r.id && PREVIEW_KIND[r.doc_type] && <div className="mt-3"><DocumentPreview kind={PREVIEW_KIND[r.doc_type] as any} id={r.doc_id} /></div>}
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</p>
          <ul className="space-y-1 text-sm">{recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2"><Pill tone={r.status === "signed" ? "success" : "danger"}>{r.status === "signed" ? "Signed" : "Rejected"}</Pill>
              <span>{label(r.doc_type)} {r.doc_number}</span><span className="text-muted-foreground">by {r.signed_by_name || "—"}{r.signed_at ? ` · ${new Date(r.signed_at).toLocaleDateString("en-GB")}` : ""}{r.reason ? ` · ${r.reason}` : ""}</span></li>
          ))}</ul>
        </div>
      )}
      {reject && (
        <Modal open onClose={() => setReject(null)} title={`Reject ${reject.doc_number || ""}`} icon={X}
          footer={<><Button variant="ghost" onClick={() => setReject(null)}>Cancel</Button><Button variant="destructive" disabled={!reason.trim() || busy === reject.id} onClick={() => void decide(reject, false, reason)}>Reject</Button></>}>
          <Field label="What needs changing?" hint="The person who submitted it sees this and can resubmit."><textarea className="fi min-h-[100px]" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </Panel>
  );
}
