import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, FileSignature, Pencil, Send, Link2, Scale, Download, ShieldAlert, FilePlus2, RefreshCw, Ban, Trash2, History, MessageSquareWarning,
  Activity, Paperclip, Check, X, MoreHorizontal, ExternalLink, Copy, Save,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Modal, Field, Pill, Segmented, TableWrap, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { SignBanner } from "@/components/books/SignBanner";
import { confirmAction } from "@/components/books/confirm";
import { ContractPaper, type PaperSigner } from "@/components/contracts/ContractPaper";
import { ContractEditor } from "@/components/contracts/ContractEditor";
import DocumentsPanel from "@/components/DocumentsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessSettings } from "@/hooks/useData";
import { useDocSignature, signatureUrl } from "@/lib/signing";
import { contractRoles, type ContractType } from "@/lib/contractTemplates";
import { buildContractPdf } from "@/lib/contractPdf";
import { shareOnWhatsApp } from "@/lib/docSend";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { friendlyError } from "@/lib/friendlyError";
import { PARTY_LABEL, STATUS, daysLeft, logEvent, sb, sendMail, shareUrl, toBase64, type Contract } from "./contractData";

import { PagedRows } from "@/components/Pager";
type Tab = "document" | "files" | "activity" | "issues" | "linked" | "versions";
const EDITABLE: Contract["status"][] = ["draft", "review", "sent", "amend_requested"];
const LINK_TYPES = [
  { key: "invoice", label: "Invoice", table: "invoices", num: "invoice_number", amount: "total", date: "issue_date", by: "customer_id", path: "/sales/invoices/" },
  { key: "sales_order", label: "Sales order", table: "sales_orders", num: "quote_number", amount: "total", date: "issue_date", by: "customer_id", path: "/sales/orders/" },
  { key: "quote", label: "Quotation", table: "quotes", num: "quote_number", amount: "total", date: "issue_date", by: "customer_id", path: "/sales/quotes/" },
  { key: "bill", label: "Bill", table: "bills", num: "bill_number", amount: "amount", date: "bill_date", by: "supplier_id", path: "/purchases/bills/" },
  { key: "purchase_order", label: "Purchase order", table: "purchases", num: "po_number", amount: "total", date: "order_date", by: "supplier_id", path: "/purchases/orders/" },
  { key: "expense", label: "Expense", table: "expenses", num: "expense_number", amount: "amount", date: "expense_date", by: "supplier_id", path: "/expenses?open=" },
] as const;

export default function ContractDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const me = profile?.display_name || null;
  const { data: biz } = useBusinessSettings();
  const [tab, setTab] = useState<Tab>("document");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [modal, setModal] = useState<null | "send" | "lawyer" | "breach" | "terminate" | "link">(null);
  const [busy, setBusy] = useState("");

  const { data: c, isLoading } = useQuery({
    queryKey: ["contract", id],
    queryFn: async () => ((await sb.from("contracts").select("*").eq("id", id).maybeSingle()).data || null) as Contract | null,
  });
  const { data: tenant } = useQuery({
    queryKey: ["tenant-logo", tenantId], enabled: !!tenantId, staleTime: 300_000,
    queryFn: async () => (await sb.from("tenants").select("business_name,logo_url").eq("id", tenantId).maybeSingle()).data,
  });
  const sig = useDocSignature("contract", c?.id);
  // A signature given before the last edit no longer counts.
  const stale = !!(sig.signed && c?.edited_at && sig.req?.signed_at && sig.req.signed_at < c.edited_at);
  const sigView = stale ? { ...sig, req: null, signed: false, blocked: true } : sig;
  const { data: our } = useQuery({
    queryKey: ["contract-our-signer", sig.req?.id, sig.signed], enabled: !!sig.signed && !!sig.req?.signed_by,
    queryFn: async (): Promise<PaperSigner> => {
      const { data: us } = await sb.from("user_signatures").select("full_name,title,signature_path,stamp_path").eq("user_id", sig.req!.signed_by).maybeSingle();
      const [signatureUrl_, stampUrl] = await Promise.all([signatureUrl(us?.signature_path), signatureUrl(us?.stamp_path)]);
      return { name: us?.full_name || sig.req!.signed_by_name, title: us?.title, at: sig.req!.signed_at, signatureUrl: signatureUrl_, stampUrl };
    },
  });
  const ourSigner = stale ? null : our || null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["contract", id] }); void qc.invalidateQueries({ queryKey: ["contracts"] }); void qc.invalidateQueries({ queryKey: ["contract-events", id] }); };

  if (isLoading) return <div className="p-10"><OrbLoader /></div>;
  if (!c) return <EmptyState icon={FileSignature} title="Contract not found" action={<Button onClick={() => navigate("/contracts")}>Back to contracts</Button>} />;

  const roles = contractRoles((c.type as ContractType) || "service", c.party_kind);
  const company = (biz as any)?.business_name || tenant?.business_name || "Our company";
  const partySigner: PaperSigner = { name: c.party_signer_name, title: c.party_signer_title, at: c.party_signed_at, signatureUrl: c.party_signature, uploaded: !!c.party_upload_path || (c.source === "uploaded" && !!c.party_signed_at) };
  const left = ["active", "signed"].includes(c.status) ? daysLeft(c.end_date) : null;
  const canEdit = c.status !== "terminated" && (c.source === "drafted" || !!c.body.trim());
  const sendBlocked = sigView.blocked;

  const pdf = async () => buildContractPdf({ title: c.title, body: c.body, number: c.number, company, logoUrl: tenant?.logo_url, roles, partyName: c.party_name || "the other party", our: ourSigner, party: partySigner });
  const download = async () => {
    setBusy("pdf");
    try {
      const bytes = await pdf();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${c.number || "contract"}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };
  const openFile = async (path: string | null) => { const u = await signatureUrl(path, 600); if (u) window.open(u, "_blank"); else toast.error("The file could not be opened"); };
  const patch = async (p: Partial<Contract>, msg?: string) => {
    const { error } = await sb.from("contracts").update({ ...p, updated_at: new Date().toISOString() }).eq("id", c.id);
    if (error) { toast.error(friendlyError(error)); return false; }
    if (msg) toast.success(msg);
    refresh();
    return true;
  };

  const saveEdit = async () => {
    if (draft === c.body) { setEditing(false); return; }
    setBusy("save");
    try {
      const v = c.version + 1;
      const back = c.status === "sent" || c.status === "amend_requested";
      const { error } = await sb.from("contracts").update({ body: draft, version: v, edited_at: new Date().toISOString(), status: back ? "draft" : c.status, updated_at: new Date().toISOString() }).eq("id", c.id);
      if (error) throw error;
      await sb.from("contract_versions").insert({ contract_id: c.id, version: v, body: draft, note: note.trim() || null, created_by_name: me });
      await logEvent(c, "edited", me, `Saved version ${v}${note.trim() ? `: ${note.trim()}` : ""}`);
      toast.success(`Version ${v} saved`, { description: back ? "Send it again so the other party sees the new text." : sig.rule.enabled && sig.signed ? "Submit it for signing again." : undefined });
      setEditing(false); setNote(""); refresh();
      void qc.invalidateQueries({ queryKey: ["contract-versions", id] });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };

  const child = async (kind: "amendment" | "renewal", extra?: string) => {
    setBusy(kind);
    try {
      const { count } = await sb.from("contracts").select("id", { count: "exact", head: true }).eq("parent_id", c.id);
      const n = (count || 0) + 1;
      let row: any;
      if (kind === "renewal") {
        const term = c.start_date && c.end_date ? Math.max(1, Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 86400000)) : 365;
        const start = c.end_date ? new Date(Date.parse(c.end_date) + 86400000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const end = new Date(Date.parse(start) + term * 86400000).toISOString().slice(0, 10);
        row = { title: `${c.title} (renewal)`, start_date: start, end_date: end, body: c.body.split(fmtLong(c.start_date)).join(fmtLong(start)).split(fmtLong(c.end_date)).join(fmtLong(end)) };
      } else {
        const today = new Date().toISOString().slice(0, 10);
        row = {
          title: `Amendment No. ${n} to ${c.number}`, start_date: today, end_date: c.end_date,
          body: [`AMENDMENT NO. ${n} TO ${c.title.toUpperCase()}`, "",
            `This Amendment is made on ${fmtLong(today)} between ${company} ("${roles.us}") and ${c.party_name} ("${roles.them}"). It changes the agreement ${c.number}${c.start_date ? ` dated ${fmtLong(c.start_date)}` : ""} (the "Agreement").`, "",
            "1. CHANGES", "", `1.1 ${extra || "[Describe each change, e.g. clause 3.1 of the Agreement is replaced with: \"…\"]"}`, "",
            "2. EVERYTHING ELSE STAYS THE SAME", "", "2.1 Except as changed by this Amendment, the Agreement continues in full force. If this Amendment and the Agreement conflict, this Amendment prevails.", "",
            "3. EFFECTIVE DATE", "", `3.1 This Amendment takes effect on ${fmtLong(today)}.`, "",
            "SIGNED by the parties on the dates shown below."].join("\n"),
        };
      }
      const { data, error } = await sb.from("contracts").insert({
        ...row, type: c.type, area: c.area, party_kind: c.party_kind, party_id: c.party_id, party_name: c.party_name, party_contact: c.party_contact, party_email: c.party_email, party_phone: c.party_phone,
        party_address: c.party_address, party_pin: c.party_pin, value: kind === "renewal" ? c.value : 0, currency: c.currency, renewal: c.renewal, notice_days: c.notice_days, parent_id: c.id, owner_id: c.owner_id,
      }).select("id").single();
      if (error) throw error;
      await sb.from("contract_versions").insert({ contract_id: data.id, version: 1, body: row.body, note: kind === "renewal" ? `Renewal of ${c.number}` : `Amendment to ${c.number}`, created_by_name: me });
      await logEvent(data, "created", me, kind === "renewal" ? `Renewal of ${c.number}` : `Amendment No. ${n} to ${c.number}`);
      await logEvent(c, kind === "renewal" ? "renewed" : "amendment", me, kind === "renewal" ? "Renewal drafted" : `Amendment No. ${n} drafted`);
      refresh();
      navigate(`/contracts/${data.id}`);
      toast.success(kind === "renewal" ? "Renewal drafted" : "Amendment drafted", { description: "Check the text, then sign and send it." });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };

  const status = STATUS[c.status];
  return (
    <div className="space-y-5">
      <button type="button" onClick={() => navigate("/contracts")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Contracts</button>
      <PageHeader title={`${c.number || ""} · ${c.title}`} icon={FileSignature}
        description={<span className="flex flex-wrap items-center gap-2"><Pill tone={status.tone}>{status.label}</Pill>
          <span>{PARTY_LABEL[c.party_kind]}: <b>{c.party_name}</b></span>
          {c.start_date && <span>· {fmtDate(c.start_date)} – {c.end_date ? fmtDate(c.end_date) : "open-ended"}</span>}
          {left !== null && left <= 60 && <Pill tone={left <= 7 ? "danger" : "warning"}>{left <= 0 ? "Ends today" : `${left} days left`}</Pill>}
          {Number(c.value) > 0 && <span>· {formatKES(Number(c.value))}</span>}
          {c.lawyer_status && <Pill tone={c.lawyer_status === "approved" ? "success" : c.lawyer_status === "changes" ? "danger" : "info"}><Scale className="h-3 w-3" /> {c.lawyer_status === "approved" ? "Lawyer approved" : c.lawyer_status === "changes" ? "Lawyer comments" : "With lawyer"}</Pill>}
          <span className="text-xs">v{c.version}</span></span>}
        actions={<>
          {canEdit && !editing && <Button variant="outline" onClick={() => { setDraft(c.body); setEditing(true); setTab("document"); }}><Pencil /> Edit</Button>}
          {["draft", "review", "sent", "amend_requested"].includes(c.status) && <Button disabled={sendBlocked || editing} title={sendBlocked ? "Sign it first" : undefined} onClick={() => setModal("send")}><Send /> {c.status === "sent" ? "Send again" : "Send to sign"}</Button>}
          <Button variant="outline" disabled={busy === "pdf"} onClick={() => void download()}>{busy === "pdf" ? <OrbSpinner /> : <Download />} PDF</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="font-semibold" aria-label="More actions"><MoreHorizontal className="!h-5 !w-5" /> More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {c.status !== "draft" && <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(shareUrl(c.share_token)); toast.success("Link copied"); }}><Copy /> Copy signing link</DropdownMenuItem>}
              {c.status !== "draft" && c.party_phone && <DropdownMenuItem onSelect={() => shareOnWhatsApp(c.party_phone, `Hello ${c.party_contact || c.party_name}, please review and sign ${c.title} (${c.number}): ${shareUrl(c.share_token)}`)}><Send /> Share on WhatsApp</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setModal("lawyer")}><Scale /> Send to lawyer for review</DropdownMenuItem>
              {c.file_path && <DropdownMenuItem onSelect={() => void openFile(c.file_path)}><Paperclip /> Open uploaded contract</DropdownMenuItem>}
              {c.party_upload_path && <DropdownMenuItem onSelect={() => void openFile(c.party_upload_path)}><Paperclip /> Open signed copy</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setModal("breach")}><ShieldAlert /> Record a breach</DropdownMenuItem>
              {["active", "signed", "expired"].includes(c.status) && <DropdownMenuItem onSelect={() => void child("amendment")}><FilePlus2 /> Draft an amendment</DropdownMenuItem>}
              {["active", "signed", "expired"].includes(c.status) && <DropdownMenuItem onSelect={() => void child("renewal")}><RefreshCw /> Renew</DropdownMenuItem>}
              {["active", "signed"].includes(c.status) && <DropdownMenuItem onSelect={() => setModal("terminate")}><Ban /> Terminate</DropdownMenuItem>}
              {c.parent_id && <DropdownMenuItem onSelect={() => navigate(`/contracts/${c.parent_id}`)}><ExternalLink /> Open the original contract</DropdownMenuItem>}
              {c.status === "draft" && <DropdownMenuItem danger onSelect={async () => {
                if (!(await confirmAction({ title: `Delete ${c.number}?`, message: "The draft and its history are removed.", danger: true, confirmLabel: "Delete" }))) return;
                const { error } = await sb.from("contracts").delete().eq("id", c.id);
                if (error) return toast.error(friendlyError(error));
                void qc.invalidateQueries({ queryKey: ["contracts"] }); navigate("/contracts");
              }}><Trash2 /> Delete draft</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>} />

      {c.source === "drafted" && <SignBanner sig={sigView} number={c.number} title={`Contract ${c.number || ""} · ${c.party_name || ""}`} amount={Number(c.value || 0)} />}
      {!sig.rule.enabled && c.source === "drafted" && EDITABLE.includes(c.status) && (
        <p className="rounded-2xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">To sign and stamp contracts automatically before they go out, switch on <b>Contracts</b> under System → Approvals → Signing, and upload signatures in System → Signatures & stamps.</p>
      )}
      {c.status === "amend_requested" && <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm"><MessageSquareWarning className="mr-1 inline h-4 w-4 text-destructive" /> {c.party_name} asked for changes. See <button className="font-semibold text-primary" onClick={() => setTab("issues")}>Changes & breaches</button>, edit the text, then send it again.</p>}

      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: "document", label: "Contract" }, { value: "files", label: "Files" }, { value: "activity", label: "Activity" }, { value: "issues", label: "Changes & breaches" },
        { value: "linked", label: "Invoices & spend" }, { value: "versions", label: `Versions (${c.version})` },
      ]} />

      {tab === "document" && (editing ? (
        <Panel title={`Edit ${c.number || "contract"}`} icon={Pencil}
          description={["signed", "active", "expired"].includes(c.status) ? "This contract is already signed: changes are kept as a new version. For changes both sides must agree to, draft an amendment instead (⋯ menu)." : "Edit any part of the text, or add new sections and clauses."}
          actions={<><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button disabled={busy === "save"} onClick={() => void saveEdit()}>{busy === "save" ? <OrbSpinner /> : <Save />} Save version {c.version + 1}</Button></>}>
          <div className="space-y-3">
            <ContractEditor value={draft} onChange={setDraft} paper={{ number: c.number, company, logoUrl: tenant?.logo_url, roles, partyName: c.party_name || "" }} />
            <input className="fi" value={note} placeholder="What changed? (optional, kept with the version)" onChange={(e) => setNote(e.target.value)} />
          </div>
        </Panel>
      ) : c.source === "uploaded" && !c.body.trim() ? (
        <UploadedView c={c} onText={refresh} />
      ) : (
        <div className="rounded-2xl bg-muted/40 p-3 sm:p-6"><ContractPaper body={c.body} number={c.number} company={company} logoUrl={tenant?.logo_url} roles={roles} partyName={c.party_name || ""} our={ourSigner} party={partySigner} /></div>
      ))}
      {tab === "files" && <Panel title="Files" icon={Paperclip} description="Everything filed for this contract. It is also in Documents → Contracts."><DocumentsPanel entityType="contract" entityId={c.id} entityName={`${c.number} · ${c.party_name || ""} — ${c.title}`} /></Panel>}
      {tab === "activity" && <ActivityTab id={c.id} />}
      {tab === "issues" && <IssuesTab c={c} me={me} onAmend={(text) => void child("amendment", text)} onEdit={() => { setDraft(c.body); setEditing(true); setTab("document"); }} />}
      {tab === "linked" && <LinkedTab c={c} />}
      {tab === "versions" && <VersionsTab c={c} onRestore={(body) => { setDraft(body); setEditing(true); setTab("document"); }} canEdit={canEdit} />}

      {modal === "send" && <SendModal c={c} company={company} pdf={pdf} me={me} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "lawyer" && <LawyerModal c={c} company={company} pdf={pdf} me={me} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "breach" && <BreachModal c={c} company={company} me={me} onClose={() => setModal(null)} onDone={() => { refresh(); setTab("issues"); void qc.invalidateQueries({ queryKey: ["contract-issues", id] }); }} />}
      {modal === "terminate" && <TerminateModal c={c} me={me} patch={patch} onClose={() => setModal(null)} />}
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtLong = (d?: string | null) => { if (!d) return "\u0000"; const x = new Date(d); return isNaN(x.getTime()) ? d : `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };

function UploadedView({ c, onText }: { c: Contract; onText: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const { profile } = useAuth() as any;
  const makeEditable = async () => {
    if (!url) return;
    setReading(true);
    try {
      const blob = await (await fetch(url)).blob();
      const type = blob.type || (/\.pdf$/i.test(c.file_path || "") ? "application/pdf" : "image/jpeg");
      const data = toBase64(new Uint8Array(await blob.arrayBuffer()));
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/ai/extract-contract", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ file: { name: "contract", type, data } }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "The contract could not be read");
      const x = out.contract || {};
      if (!String(x.full_text || "").trim()) throw new Error("No text could be read from the file");
      // Fill only what is missing; the particulars already saved stay.
      const patch: any = { body: x.full_text, edited_at: null, updated_at: new Date().toISOString() };
      if (!c.end_date && /^\d{4}-\d{2}-\d{2}$/.test(x.end_date || "")) patch.end_date = x.end_date;
      if (!c.start_date && /^\d{4}-\d{2}-\d{2}$/.test(x.start_date || "")) patch.start_date = x.start_date;
      if (!Number(c.value) && x.value) patch.value = x.value;
      const { error } = await sb.from("contracts").update(patch).eq("id", c.id);
      if (error) throw error;
      await sb.from("contract_versions").insert({ contract_id: c.id, version: c.version, body: x.full_text, note: "Text read from the uploaded file", created_by_name: profile?.display_name || null });
      toast.success("The text is ready to edit", { description: out.truncated ? "It is long: check the end of the text against the file." : undefined });
      onText();
    } catch (e) { toast.error(friendlyError(e)); } finally { setReading(false); }
  };
  useEffect(() => { void signatureUrl(c.party_upload_path || c.file_path, 1800).then(setUrl); }, [c.file_path, c.party_upload_path]);
  const isPdf = /\.pdf$/i.test(c.party_upload_path || c.file_path || "");
  return (
    <Panel title="Contract file" icon={Paperclip} description={c.party_upload_path ? "The signed copy returned by the other party." : "The uploaded contract."}
      actions={url && <><Button size="sm" disabled={reading} onClick={() => void makeEditable()}>{reading ? <OrbSpinner /> : <Pencil />} {reading ? "Reading…" : "Make the text editable"}</Button><Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button></>}>
      {!url ? <OrbLoader /> : isPdf ? <iframe title="Contract" src={url} className="h-[75vh] w-full rounded-xl border border-border" /> : <img src={url} alt="Contract" className="mx-auto max-h-[80vh] rounded-xl" />}
    </Panel>
  );
}

function ActivityTab({ id }: { id: string }) {
  const { data = [] } = useQuery({ queryKey: ["contract-events", id], queryFn: async () => ((await sb.from("contract_events").select("*").eq("contract_id", id).order("created_at", { ascending: false }).limit(300)).data || []) as any[] });
  const tone = (k: string) => (/signed|approved|uploaded/.test(k) ? "bg-success" : /breach|amend|expired|terminated|lawyer_comment/.test(k) ? "bg-destructive" : /sent|viewed|reminder/.test(k) ? "bg-warning" : "bg-primary");
  return (
    <Panel title="Activity" icon={Activity}>
      {data.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {data.map((e) => (
            <li key={e.id} className="relative">
              <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${tone(e.kind)}`} />
              <p className="text-sm"><b>{e.actor || "Someone"}</b> <span className="text-muted-foreground">· {new Date(e.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></p>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{e.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function IssuesTab({ c, me, onAmend, onEdit }: { c: Contract; me: string | null; onAmend: (text: string) => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["contract-issues", c.id], queryFn: async () => ((await sb.from("contract_issues").select("*").eq("contract_id", c.id).order("created_at", { ascending: false })).data || []) as any[] });
  const [closing, setClosing] = useState<{ row: any; to: "resolved" | "accepted" | "declined" } | null>(null);
  const [text, setText] = useState("");
  const close = async () => {
    if (!closing) return;
    const { row, to } = closing;
    const { error } = await sb.from("contract_issues").update({ status: to, resolution: text.trim() || null, resolved_at: new Date().toISOString() }).eq("id", row.id);
    if (error) return toast.error(friendlyError(error));
    await logEvent(c, "resolved", me, `${row.kind === "breach" ? "Breach" : row.kind === "review" ? "Lawyer comment" : "Change request"} ${to}${text.trim() ? `: ${text.trim()}` : ""}`);
    setClosing(null); setText("");
    void qc.invalidateQueries({ queryKey: ["contract-issues", c.id] }); void qc.invalidateQueries({ queryKey: ["contract-events", c.id] }); void qc.invalidateQueries({ queryKey: ["contract-open-breaches"] });
    if (to === "accepted" && row.kind !== "breach") {
      if (["active", "signed"].includes(c.status)) onAmend(row.details); else onEdit();
    }
  };
  const label = (r: any) => (r.kind === "breach" ? `Breach by ${r.side === "us" ? "us" : "the other party"}` : r.kind === "review" ? "Lawyer comment" : r.side === "party" ? "Change requested by the other party" : "Change request");
  return (
    <Panel title="Changes & breaches" icon={MessageSquareWarning} description="Change requests from the other party, your lawyer's comments, and breaches with their remedy.">
      {data.length === 0 ? <p className="text-sm text-muted-foreground">No change requests, comments or breaches.</p> : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={r.kind === "breach" ? "danger" : r.kind === "review" ? "info" : "warning"}>{label(r)}</Pill>
                {r.kind === "breach" && <Pill tone={r.severity === "high" ? "danger" : r.severity === "medium" ? "warning" : "muted"}>{r.severity}</Pill>}
                <Pill tone={r.status === "open" ? "warning" : r.status === "declined" ? "muted" : "success"}>{r.status}</Pill>
                <span className="text-xs text-muted-foreground">{r.raised_by_name || ""} · {new Date(r.created_at).toLocaleDateString("en-GB")}{r.clause ? ` · Clause ${r.clause}` : ""}{r.remedy_due ? ` · Remedy by ${fmtDate(r.remedy_due)}` : ""}</span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{r.details}</p>
              {r.resolution && <p className="mt-1 text-sm text-muted-foreground">→ {r.resolution}</p>}
              {r.status === "open" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.kind === "breach" ? <Button size="sm" variant="outline" onClick={() => setClosing({ row: r, to: "resolved" })}><Check /> Mark remedied</Button> : <>
                    <Button size="sm" onClick={() => setClosing({ row: r, to: "accepted" })}><Check /> Accept and change</Button>
                    <Button size="sm" variant="outline" onClick={() => setClosing({ row: r, to: "declined" })}><X /> Decline</Button>
                    {r.kind === "review" && <Button size="sm" variant="ghost" onClick={() => setClosing({ row: r, to: "resolved" })}>Mark done</Button>}
                  </>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {closing && (
        <Modal open center onClose={() => setClosing(null)} title={closing.to === "declined" ? "Decline" : closing.to === "accepted" ? "Accept the change" : "Close it"} icon={Check}
          footer={<><Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button><Button onClick={() => void close()}>Save</Button></>}>
          <Field label={closing.to === "declined" ? "Why? (they see this on their link)" : "Note"} hint={closing.to === "accepted" ? (["active", "signed"].includes(c.status) ? "An amendment is drafted next." : "The contract opens for editing next.") : undefined}>
            <textarea className="fi min-h-[90px]" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </Modal>
      )}
    </Panel>
  );
}

function LinkedTab({ c }: { c: Contract }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<(typeof LINK_TYPES)[number]["key"]>(c.party_kind === "supplier" ? "bill" : "invoice");
  const { data: links = [] } = useQuery({
    queryKey: ["contract-links", c.id],
    queryFn: async () => {
      const { data } = await sb.from("contract_links").select("*").eq("contract_id", c.id);
      const out: any[] = [];
      for (const t of LINK_TYPES) {
        const ids = (data || []).filter((l: any) => l.entity_type === t.key).map((l: any) => l.entity_id);
        if (!ids.length) continue;
        const { data: rows } = await sb.from(t.table).select(`id,${t.num},${t.amount},${t.date}${t.key === "invoice" ? ",amount_paid,status" : t.key === "bill" ? ",amount_paid,status" : ""}`).in("id", ids);
        for (const r of rows || []) out.push({ type: t, id: r.id, number: r[t.num], amount: Number(r[t.amount] || 0), date: r[t.date], paid: Number(r.amount_paid || 0), status: r.status });
      }
      return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },
  });
  const t = LINK_TYPES.find((x) => x.key === type)!;
  const { data: candidates = [] } = useQuery({
    queryKey: ["contract-link-candidates", c.id, type], enabled: adding,
    queryFn: async () => {
      let q = sb.from(t.table).select(`id,${t.num},${t.amount},${t.date}`).order(t.date, { ascending: false }).limit(60);
      if (c.party_id && ((t.by === "customer_id" && c.party_kind === "customer") || (t.by === "supplier_id" && c.party_kind === "supplier"))) q = q.eq(t.by, c.party_id);
      return ((await q).data || []) as any[];
    },
  });
  const link = async (entityId: string) => {
    const { error } = await sb.from("contract_links").insert({ contract_id: c.id, entity_type: type, entity_id: entityId });
    if (error) return toast.error(error.code === "23505" ? "Already linked" : friendlyError(error));
    await logEvent(c, "linked", null, `${t.label} linked to the contract`);
    void qc.invalidateQueries({ queryKey: ["contract-links", c.id] });
  };
  const unlink = async (l: any) => {
    await sb.from("contract_links").delete().eq("contract_id", c.id).eq("entity_type", l.type.key).eq("entity_id", l.id);
    void qc.invalidateQueries({ queryKey: ["contract-links", c.id] });
  };
  const income = links.filter((l) => l.type.key === "invoice").reduce((a, l) => a + l.amount, 0);
  const received = links.filter((l) => l.type.key === "invoice").reduce((a, l) => a + l.paid, 0);
  const spent = links.filter((l) => ["bill", "expense"].includes(l.type.key)).reduce((a, l) => a + l.amount, 0);
  const value = Number(c.value || 0);
  const used = value ? Math.min(100, ((c.party_kind === "supplier" ? spent : income) / value) * 100) : 0;
  return (
    <Panel title="Invoices & spend" icon={Link2} description="Invoices, orders, bills and expenses raised under this contract, e.g. each delivery of a tender supply."
      actions={<div className="flex flex-wrap gap-2">
        {c.party_kind === "customer" && c.party_id && <Button size="sm" variant="outline" onClick={() => navigate(`/sales/invoices/new?customer=${c.party_id}&contract=${c.id}`)}><FilePlus2 /> New invoice</Button>}
        {c.party_kind === "supplier" && c.party_id && <>
          <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/orders/new?supplier=${c.party_id}&contract=${c.id}`)}><FilePlus2 /> New purchase order</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/bills/new?supplier=${c.party_id}&contract=${c.id}`)}><FilePlus2 /> New bill</Button>
        </>}
        <Button size="sm" onClick={() => setAdding(true)}><Link2 /> Link a document</Button>
      </div>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[["Contract value", value], ["Invoiced", income], ["Received", received], ["Spent (bills & expenses)", spent]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="font-display text-lg font-bold">{formatKES(Number(v))}</p></div>
        ))}
      </div>
      {value > 0 && (
        <div className="mb-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${used}%` }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{used.toFixed(0)}% of the contract value {c.party_kind === "supplier" ? "spent" : "invoiced"}{income && spent ? ` · margin ${formatKES(income - spent)}` : ""}</p>
        </div>
      )}
      {links.length === 0 ? <p className="text-sm text-muted-foreground">Nothing linked yet.</p> : (
        <TableWrap><table className="dt"><thead><tr><th>Document</th><th>Date</th><th className="num">Amount</th><th /></tr></thead><tbody>
          <PagedRows rows={links} colSpan={4}>{(pageRows) => pageRows.map((l) => (
            <tr key={`${l.type.key}-${l.id}`}>
              <td><button className="font-semibold text-primary" onClick={() => navigate(`${l.type.path}${l.id}`)}>{l.type.label} {l.number || ""}</button>{l.status && <span className="ml-2 text-xs capitalize text-muted-foreground">{String(l.status).replace(/_/g, " ")}</span>}</td>
              <td>{fmtDate(l.date)}</td><td className="num">{formatKES(l.amount)}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => void unlink(l)}><X /></Button></td>
            </tr>
          ))}</PagedRows>
        </tbody></table></TableWrap>
      )}
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Link a document" icon={Link2} size="lg">
          <div className="space-y-3">
            <select className="fi" value={type} onChange={(e) => setType(e.target.value as any)}>{LINK_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
            <ul className="max-h-[55vh] divide-y divide-border overflow-auto rounded-xl border border-border">
              {candidates.length === 0 && <li className="p-3 text-sm text-muted-foreground">None found.</li>}
              {candidates.map((r) => {
                const done = links.some((l) => l.type.key === type && l.id === r.id);
                return (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1"><b>{r[t.num] || "—"}</b> <span className="text-muted-foreground">· {fmtDate(r[t.date])}</span></span>
                    <span>{formatKES(Number(r[t.amount] || 0))}</span>
                    <Button size="sm" variant={done ? "ghost" : "outline"} disabled={done} onClick={() => void link(r.id)}>{done ? "Linked" : "Link"}</Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function VersionsTab({ c, onRestore, canEdit }: { c: Contract; onRestore: (body: string) => void; canEdit: boolean }) {
  const { data = [] } = useQuery({ queryKey: ["contract-versions", c.id], queryFn: async () => ((await sb.from("contract_versions").select("*").eq("contract_id", c.id).order("version", { ascending: false })).data || []) as any[] });
  const [open, setOpen] = useState<any>(null);
  return (
    <Panel title="Versions" icon={History} description="Every saved version of the text.">
      {data.length === 0 ? <p className="text-sm text-muted-foreground">No versions saved.</p> : (
        <ul className="divide-y divide-border">
          {data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Pill tone={v.version === c.version ? "success" : "muted"}>v{v.version}</Pill>
              <span className="min-w-0 flex-1 truncate">{v.note || "—"} <span className="text-muted-foreground">· {v.created_by_name || ""} · {new Date(v.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
              <Button size="sm" variant="outline" onClick={() => setOpen(v)}>View</Button>
              {canEdit && v.version !== c.version && <Button size="sm" variant="ghost" onClick={() => onRestore(v.body)}>Restore</Button>}
            </li>
          ))}
        </ul>
      )}
      {open && <Modal open onClose={() => setOpen(null)} title={`Version ${open.version}`} icon={History} size="2xl"><pre className="whitespace-pre-wrap font-sans text-sm">{open.body}</pre></Modal>}
    </Panel>
  );
}

function SendModal({ c, company, pdf, me, onClose, onDone }: { c: Contract; company: string; pdf: () => Promise<Uint8Array>; me: string | null; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(c.party_email || "");
  const link = shareUrl(c.share_token);
  const [subject, setSubject] = useState(`${c.title} (${c.number}) for your signature`);
  const [message, setMessage] = useState(`Dear ${c.party_contact || c.party_name},\n\nPlease find ${c.title} attached. You can read it, sign it on your phone or computer, or ask for changes here:\n\n${link}\n\nIf you prefer, print it, sign it, and upload the signed copy on the same link.\n\nRegards,\n${me || ""}\n${company}`);
  const [busy, setBusy] = useState(false);
  const go = async (email: boolean) => {
    setBusy(true);
    try {
      if (email) {
        const list = to.split(/[,;\s]+/).filter(Boolean);
        if (!list.length) throw new Error("Enter the email address");
        await sendMail(list, subject, message, await pdf(), `${c.number || "contract"}.pdf`);
      }
      await sb.from("contracts").update({ status: "sent", sent_at: new Date().toISOString(), party_email: c.party_email || to.split(/[,;\s]+/)[0] || null, updated_at: new Date().toISOString() }).eq("id", c.id);
      await logEvent(c, "sent", me, email ? `Sent to ${to} with the signing link` : "Marked as sent (link shared another way)");
      if (!email) { await navigator.clipboard.writeText(link).catch(() => {}); toast.success("Link copied", { description: "Share it any way you like." }); }
      else toast.success("Sent", { description: "You are told when they open, sign or ask for changes." });
      onDone(); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Send to sign" icon={Send} size="xl" description="They get the PDF and a private link to sign on screen, ask for changes, or upload a signed copy."
      footer={<><Button variant="ghost" disabled={busy} onClick={() => void go(false)}><Copy /> Just copy the link</Button><Button disabled={busy} onClick={() => void go(true)}>{busy ? <OrbSpinner /> : <Send />} Send email</Button></>}>
      <div className="space-y-3">
        <Field label="To"><input className="fi" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.co.ke" /></Field>
        <Field label="Subject"><input className="fi" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="fi min-h-[200px]" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function LawyerModal({ c, company, pdf, me, onClose, onDone }: { c: Contract; company: string; pdf: () => Promise<Uint8Array>; me: string | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(c.lawyer_name || "");
  const [email, setEmail] = useState(c.lawyer_email || "");
  const link = shareUrl(c.review_token);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const body = message || `Dear ${name || "Counsel"},\n\nPlease review ${c.title} (${c.number}) between ${company} and ${c.party_name}. The PDF is attached. You can comment on any clause, or approve it, here:\n\n${link}\n\nRegards,\n${me || ""}\n${company}`;
  const go = async () => {
    if (!email.trim()) return toast.error("Enter the lawyer's email");
    setBusy(true);
    try {
      await sendMail([email.trim()], `Contract for review: ${c.title} (${c.number})`, body, await pdf(), `${c.number || "contract"}.pdf`);
      await sb.from("contracts").update({ lawyer_name: name.trim() || null, lawyer_email: email.trim(), lawyer_status: "pending", status: c.status === "draft" ? "review" : c.status, updated_at: new Date().toISOString() }).eq("id", c.id);
      await logEvent(c, "lawyer_sent", me, `Sent to ${name || email} for legal review`);
      toast.success("Sent to your lawyer", { description: "Their comments appear under Changes & breaches." });
      onDone(); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Legal review" icon={Scale} size="xl" description="Your lawyer gets the PDF and a private link to comment on clauses or approve."
      footer={<Button disabled={busy} onClick={() => void go()}>{busy ? <OrbSpinner /> : <Send />} Send for review</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lawyer's name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Message" className="sm:col-span-2"><textarea className="fi min-h-[180px]" value={body} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function BreachModal({ c, company, me, onClose, onDone }: { c: Contract; company: string; me: string | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ side: "party" as "party" | "us", severity: "medium", clause: "", details: "", due: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), notify: !!c.party_email });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!f.details.trim()) return toast.error("Describe the breach");
    setBusy(true);
    try {
      const { error } = await sb.from("contract_issues").insert({ contract_id: c.id, kind: "breach", side: f.side, severity: f.severity, clause: f.clause.trim() || null, details: f.details.trim(), remedy_due: f.due || null, title: "Breach", raised_by_name: me });
      if (error) throw error;
      await logEvent(c, "breach", me, `Breach by ${f.side === "us" ? "us" : c.party_name}${f.clause ? ` (clause ${f.clause})` : ""}: ${f.details.trim()}`);
      if (f.notify && f.side === "party" && c.party_email) {
        await sendMail([c.party_email], `Notice of breach: ${c.title} (${c.number})`,
          `Dear ${c.party_contact || c.party_name},\n\nWe write under ${c.title} (${c.number}) to give notice of the following breach${f.clause ? ` of clause ${f.clause}` : ""}:\n\n${f.details.trim()}\n\nPlease remedy it by ${fmtDate(f.due)}, as provided under the clause "Breach and remedy" of the contract, and confirm in writing what has been done.\n\nRegards,\n${me || ""}\n${company}`);
        await logEvent(c, "note", me, `Breach notice emailed to ${c.party_email}`);
      }
      toast.success("Breach recorded"); onDone(); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record a breach" icon={ShieldAlert} size="lg" footer={<Button variant="destructive" disabled={busy} onClick={() => void go()}>{busy && <OrbSpinner />} Record breach</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who is in breach?"><select className="fi" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as any })}><option value="party">{c.party_name}</option><option value="us">Us</option></select></Field>
        <Field label="How serious?"><select className="fi" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High (material)</option></select></Field>
        <Field label="Clause"><input className="fi" value={f.clause} placeholder="e.g. 4.2" onChange={(e) => setF({ ...f, clause: e.target.value })} /></Field>
        <Field label="Remedy by"><input type="date" className="fi" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="What happened" className="sm:col-span-2"><textarea className="fi min-h-[110px]" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
        {f.side === "party" && c.party_email && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Email a breach notice to {c.party_email}</label>}
      </div>
    </Modal>
  );
}

function TerminateModal({ c, me, patch, onClose }: { c: Contract; me: string | null; patch: (p: Partial<Contract>, msg?: string) => Promise<boolean>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const go = async () => {
    if (!reason.trim()) return toast.error("Give the reason");
    if (await patch({ status: "terminated", terminated_at: new Date().toISOString(), termination_reason: reason.trim() }, "Contract terminated")) {
      await logEvent(c, "terminated", me, reason.trim());
      onClose();
    }
  };
  return (
    <Modal open center onClose={onClose} title={`Terminate ${c.number}?`} icon={Ban}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={() => void go()}>Terminate</Button></>}>
      <Field label="Reason" hint={`Check the notice period (${c.notice_days} days) and give written notice to ${c.party_name}.`}><textarea className="fi min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

