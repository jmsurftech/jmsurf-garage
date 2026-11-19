import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, FileSignature, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SignaturePad } from "@/apps/fields";
import { DashLogo } from "@/components/brand/DashLogo";
import { friendlyError } from "@/lib/friendlyError";

interface Req {
  id: string; number: string | null; title: string; stage: string; body: string | null; message: string | null;
  due_date: string | null; company: string; logo_url: string | null;
  signatures: { name: string; signed_at: string }[];
}

/** Public page where a signer reads and signs a JMSURF SIGN request. */
export default function SignDocument() {
  const { id = "" } = useParams();
  const [req, setReq] = useState<Req | null | false>(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    (supabase as any).rpc("sign_request_public", { p_id: id }).then(({ data }: any) => setReq(data || false)).catch(() => setReq(false));
  }, [id]);

  const submit = async (decline = false) => {
    setErr(""); setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("sign_request_submit", { p_id: id, p_name: name, p_signature: decline ? null : sig, p_decline: decline });
      if (error) throw error;
      setDone(data?.stage || "signed");
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet><title>Sign document | JMSURF SIGN</title><meta name="robots" content="noindex" /></Helmet>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <DashLogo tagline="SIGN" markClassName="h-8 w-8" />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-success" /> Secure signing</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {req === null && <p className="text-center text-muted-foreground">Loading…</p>}
        {req === false && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-3 font-display text-xl font-bold">This link is not open for signing</h1>
            <p className="mt-1 text-sm text-muted-foreground">It may have been withdrawn, already completed or expired. Ask the sender for a new link.</p>
          </div>
        )}
        {req && (done || req.stage === "signed") && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <h1 className="mt-3 font-display text-2xl font-bold">{done === "declined" ? "You declined to sign" : "Signed. Thank you!"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{done === "declined" ? `${req.company} has been told.` : `${req.company} has your signature on “${req.title}”.`}</p>
          </div>
        )}
        {req && !done && req.stage !== "signed" && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                {req.logo_url ? <img src={req.logo_url} alt="" className="h-10 w-10 rounded-lg object-contain" /> : <FileSignature className="h-10 w-10 text-primary" />}
                <div>
                  <p className="text-xs text-muted-foreground">{req.company} asks you to sign {req.number ? `· ${req.number}` : ""}</p>
                  <h1 className="font-display text-xl font-bold">{req.title}</h1>
                </div>
              </div>
              {req.message && <p className="mt-3 rounded-xl bg-muted p-3 text-sm">{req.message}</p>}
            </div>
            {req.body && (
              <article className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-border bg-card p-6 text-sm leading-relaxed">{req.body}</article>
            )}
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <label className="block space-y-1.5"><span className="text-sm font-medium">Your full name</span>
                <input className="fi" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
              <div className="space-y-1.5"><span className="text-sm font-medium">Draw your signature</span><SignaturePad value={sig} onChange={setSig} /></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                I agree that this electronic signature is as valid as my handwritten signature.</label>
              {err && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button disabled={busy || !agree || !sig || name.trim().length < 2} onClick={() => void submit(false)} className="flex-1 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Signing…" : "Sign document"}</button>
                <button disabled={busy || name.trim().length < 2} onClick={() => void submit(true)} className="rounded-xl border border-border px-5 py-3 text-sm font-medium text-muted-foreground hover:text-destructive">Decline</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
