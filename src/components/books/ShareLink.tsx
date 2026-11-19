import { useState } from "react";
import { Link2, Copy, MessageCircle, Mail } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useTenantId } from "@/hooks/useTenantId";
import { shareDocumentLink, shareOnWhatsApp } from "@/lib/docSend";
import type { DocumentKind } from "@/lib/docModels";
import { friendlyError } from "@/lib/friendlyError";

/** "Share": a link to the document's PDF that anyone can open until it expires. */
export function ShareLinkModal({ kind, id, title, phone, email, onClose }: { kind: DocumentKind; id: string; title: string; phone?: string | null; email?: string | null; onClose: () => void }) {
  const tenantId = useTenantId();
  const [days, setDays] = useState(30);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!tenantId) return;
    setBusy(true);
    try { setUrl(await shareDocumentLink(kind, id, tenantId, days)); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Copy failed: select the link and copy it"); } };
  return (
    <Modal open onClose={onClose} title={`Share ${title}`} icon={Link2} description="Anyone with the link can view and download the PDF until it expires."
      footer={!url ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void make()} disabled={busy}>{busy ? "Creating…" : "Create link"}</Button></> : <Button onClick={onClose}>Done</Button>}>
      {!url ? (
        <Field label="Link expires after">
          <select className="fi w-48" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      ) : (
        <div className="space-y-3">
          <input readOnly className="fi font-mono text-xs" value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy()}><Copy /> Copy link</Button>
            <Button size="sm" variant="outline" onClick={() => shareOnWhatsApp(phone, `${title}: ${url}`)}><MessageCircle /> WhatsApp</Button>
            {email && <Button size="sm" variant="outline" onClick={() => { window.location.href = `mailto:${email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`; }}><Mail /> Email</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Expires in {days} days. Create a new link if the document changes.</p>
        </div>
      )}
    </Modal>
  );
}
