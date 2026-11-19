import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, FileSignature, MessageSquareWarning, PenLine, Printer, Scale, ShieldCheck, Upload, XCircle, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SignaturePad } from "@/apps/fields";
import { ContractPaper, type PaperSigner } from "@/components/contracts/ContractPaper";
import { contractRoles, type ContractType, type PartyKind } from "@/lib/contractTemplates";
import { buildContractPdf } from "@/lib/contractPdf";
import { friendlyError } from "@/lib/friendlyError";
import { fmtDate } from "@/lib/doc-pdf";

type Pub = {
  role: "party" | "lawyer"; id: string; number: string | null; title: string; type: string; status: string; body: string; version: number;
  party_name: string | null; party_kind: PartyKind; party_contact: string | null; value: number; currency: string; start_date: string | null; end_date: string | null; source: string; has_file: boolean;
  party_signed_at: string | null; party_signer_name: string | null; party_signer_title: string | null; party_signature: string | null; party_uploaded: boolean;
  lawyer_name: string | null; lawyer_status: string | null;
  company: { name: string; logo_url: string | null; email: string | null; phone: string | null; address: string | null };
  our_signed_by: string | null; our_signed_at: string | null;
  issues: { kind: string; side: string; status: string; title: string; details: string; clause: string | null; resolution: string | null; created_at: string }[];
};
type Assets = { our: { name: string; title: string | null; at: string; signature_url: string | null; stamp_url: string | null } | null; file_url: string | null; upload_url: string | null };

const rpc = (fn: string, args: any) => (supabase as any).rpc(fn, args);

/** The other party's (or the lawyer's) page for one contract: read, sign, ask for changes, upload a signed copy, or comment. */
export default function ContractLink() {
  const { token = "" } = useParams();
  const [c, setC] = useState<Pub | null | false>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [mode, setMode] = useState<"" | "sign" | "change" | "upload" | "comment">("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [details, setDetails] = useState("");
  const [clause, setClause] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await rpc("contract_public", { p_token: token });
    setC(data || false);
    fetch(`/api/public/contract-assets?token=${encodeURIComponent(token)}`).then((r) => (r.ok ? r.json() : null)).then(setAssets).catch(() => {});
  };
  useEffect(() => { void load().catch(() => setC(false)); }, [token]);

  const run = async (fn: () => Promise<void>, msg: string) => {
    setErr(""); setBusy(true);
    try { await fn(); setDone(msg); setMode(""); await load(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const sign = () => run(async () => {
    const { error } = await rpc("contract_public_sign", { p_token: token, p_name: name, p_title: title, p_signature: sig });
    if (error) throw error;
  }, "Signed. Thank you! A copy is ready to download below.");
  const feedback = (approve: boolean) => run(async () => {
    const { error } = await rpc("contract_public_feedback", { p_token: token, p_name: name, p_details: details, p_clause: clause || null, p_approve: approve });
    if (error) throw error;
    setDetails(""); setClause("");
  }, approve ? "Approved. They have been told." : c && c.role === "lawyer" ? "Comment sent." : "Your request was sent. You will get the updated contract.");
  const upload = () => run(async () => {
    if (!file) throw new Error("Choose the signed file");
    if (file.size > 15 * 1024 * 1024) throw new Error("The file must be under 15 MB");
    const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
    const res = await fetch("/api/public/contract-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name, type: file.type, data }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "The upload failed");
  }, "Signed copy received. Thank you!");

  const roles = c ? contractRoles((c.type as ContractType) || "service", c.party_kind || "customer") : { us: "", them: "" };
  const our: PaperSigner | null = assets?.our ? { name: assets.our.name, title: assets.our.title, at: assets.our.at, signatureUrl: assets.our.signature_url, stampUrl: assets.our.stamp_url }
    : c && c.our_signed_at ? { name: c.our_signed_by, at: c.our_signed_at } : null;
  const party: PaperSigner | null = c ? { name: c.party_signer_name, title: c.party_signer_title, at: c.party_signed_at, signatureUrl: c.party_signature, uploaded: c.party_uploaded } : null;
  const canAct = c && c.role === "party" && ["sent", "amend_requested"].includes(c.status);
  const signedAll = c && ["signed", "active", "expired", "terminated"].includes(c.status);

  const download = async () => {
    if (!c) return;
    const bytes = await buildContractPdf({ title: c.title, body: c.body, number: c.number, company: c.company.name, logoUrl: c.company.logo_url, roles, partyName: c.party_name || "", our, party });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a"); a.href = url; a.download = `${c.number || "contract"}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1f1f1f]">
      <Helmet><title>{c ? `${c.title} | ${c.company.name}` : "Contract"}</title><meta name="robots" content="noindex" /></Helmet>
      <header className="border-b border-black/5 bg-white print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {c && c.company.logo_url ? <img src={c.company.logo_url} alt="" className="h-8 w-auto max-w-[120px] object-contain" /> : <FileSignature className="h-7 w-7 text-[#6d28d9]" />}
            <b className="truncate">{c ? c.company.name : ""}</b>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#5e6369]"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Private link</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        {c === null && <p className="py-20 text-center text-[#5e6369]">Loading…</p>}
        {c === false && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <XCircle className="mx-auto h-10 w-10 text-red-600" />
            <h1 className="mt-3 text-xl font-bold">This link is not open</h1>
            <p className="mt-1 text-sm text-[#5e6369]">It may have been withdrawn. Ask the sender for a new link.</p>
          </div>
        )}
        {c && (<>
          <section className="rounded-2xl bg-white p-5 shadow-sm print:hidden">
            <p className="text-xs uppercase tracking-wider text-[#5e6369]">{c.role === "lawyer" ? "For legal review" : `${c.company.name} · ${c.number || ""}`}</p>
            <h1 className="mt-1 text-xl font-bold">{c.title}</h1>
            <p className="mt-1 text-sm text-[#5e6369]">
              {c.start_date ? `${fmtDate(c.start_date)} – ${c.end_date ? fmtDate(c.end_date) : "open-ended"}` : ""}{Number(c.value) ? ` · ${c.currency} ${Number(c.value).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""} · Version {c.version}
            </p>
            {done && <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {done}</p>}
            {signedAll && !done && <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Signed{c.party_signer_name ? ` by ${c.party_signer_name}` : ""}{c.party_signed_at ? ` on ${fmtDate(c.party_signed_at)}` : ""}.</p>}
            {c.status === "amend_requested" && c.role === "party" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your change request was sent. {c.company.name} will update the contract; you can still sign this version if you prefer.</p>}
            {err && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {canAct && <Btn primary onClick={() => setMode("sign")}><PenLine className="h-4 w-4" /> Sign</Btn>}
              {canAct && <Btn onClick={() => setMode("change")}><MessageSquareWarning className="h-4 w-4" /> Ask for changes</Btn>}
              {c.role === "party" && ["sent", "amend_requested", "signed", "active"].includes(c.status) && !c.party_uploaded && <Btn onClick={() => setMode("upload")}><Upload className="h-4 w-4" /> Upload signed copy</Btn>}
              {c.role === "lawyer" && <Btn primary onClick={() => setMode("comment")}><Scale className="h-4 w-4" /> Comment or approve</Btn>}
              <Btn onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Btn>
              {c.body.trim() && <Btn onClick={() => void download()}><Download className="h-4 w-4" /> PDF</Btn>}
              {assets?.file_url && <a href={assets.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium hover:bg-black/5"><Download className="h-4 w-4" /> Contract file</a>}
            </div>

            {mode === "sign" && (
              <div className="mt-5 space-y-3 border-t border-black/5 pt-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <L label="Your full name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></L>
                  <L label="Your title"><input className="fi" value={title} placeholder="e.g. Director" onChange={(e) => setTitle(e.target.value)} /></L>
                </div>
                <L label={`Sign for ${c.party_name}`}><SignaturePad value={sig} onChange={setSig} /></L>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I have read this contract, I am authorised to sign it for {c.party_name}, and I agree that this electronic signature is as valid as my handwritten signature.</label>
                <Btn primary disabled={busy || !agree || !sig || name.trim().length < 2} onClick={() => void sign()}>{busy ? "Signing…" : "Sign contract"}</Btn>
              </div>
            )}
            {(mode === "change" || mode === "comment") && (
              <div className="mt-5 space-y-3 border-t border-black/5 pt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <L label="Your name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} /></L>
                  <L label="Clause (optional)"><input className="fi" value={clause} placeholder="e.g. 4.2" onChange={(e) => setClause(e.target.value)} /></L>
                </div>
                <L label={mode === "comment" ? "Your comment" : "What should change, and why?"}><textarea className="fi min-h-[120px]" value={details} onChange={(e) => setDetails(e.target.value)} /></L>
                <div className="flex flex-wrap gap-2">
                  <Btn primary disabled={busy || !details.trim() || !name.trim()} onClick={() => void feedback(false)}>{mode === "comment" ? "Send comment" : "Send request"}</Btn>
                  {mode === "comment" && <Btn disabled={busy || !name.trim()} onClick={() => void feedback(true)}><CheckCircle2 className="h-4 w-4" /> Approve the contract</Btn>}
                </div>
              </div>
            )}
            {mode === "upload" && (
              <div className="mt-5 space-y-3 border-t border-black/5 pt-5">
                <p className="text-sm text-[#5e6369]">Print the contract, sign every page where needed, then scan or photograph it and upload it here (PDF, JPG or PNG).</p>
                <L label="Your full name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} /></L>
                <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <Btn onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {file ? file.name : "Choose file"}</Btn>
                <div><Btn primary disabled={busy || !file || name.trim().length < 2} onClick={() => void upload()}>{busy ? "Uploading…" : "Upload signed copy"}</Btn></div>
              </div>
            )}
          </section>

          {c.issues.length > 0 && (
            <section className="rounded-2xl bg-white p-5 shadow-sm print:hidden">
              <h2 className="mb-3 text-sm font-bold">{c.role === "lawyer" ? "Comments and requests" : "Your change requests"}</h2>
              <ul className="space-y-2 text-sm">
                {c.issues.map((i, k) => (
                  <li key={k} className="rounded-xl bg-[#f4f5f7] p-3">
                    <p className="text-xs text-[#5e6369]">{i.side === "lawyer" ? "Lawyer" : "Change request"}{i.clause ? ` · clause ${i.clause}` : ""} · {new Date(i.created_at).toLocaleDateString("en-GB")} · <b className="capitalize">{i.status}</b></p>
                    <p className="mt-1 whitespace-pre-line">{i.details}</p>
                    {i.resolution && <p className="mt-1 text-[#5e6369]">→ {i.resolution}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {c.body.trim() ? <ContractPaper body={c.body} number={c.number} company={c.company.name} logoUrl={c.company.logo_url} roles={roles} partyName={c.party_name || ""} our={our} party={party} />
            : assets?.file_url ? <iframe title="Contract" src={assets.file_url} className="h-[80vh] w-full rounded-2xl bg-white shadow-sm" /> : null}
          <p className="pb-6 text-center text-xs text-[#5e6369] print:hidden">Powered by JMSURF TECHNOLOGIES</p>
        </>)}
      </main>
    </div>
  );
}

function Btn({ primary, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...p} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${primary ? "bg-[#6d28d9] text-white hover:bg-[#5b21b6]" : "border border-black/10 bg-white hover:bg-black/5"}`}>{children}</button>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}
