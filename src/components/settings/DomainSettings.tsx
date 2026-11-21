import { useCallback, useEffect, useRef, useState } from "react";
import { Globe2, Trash2, ExternalLink, RefreshCw, CheckCircle2, Copy, Smartphone } from "lucide-react";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { callServer } from "@/lib/serverStaff";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";

interface DnsState { a: string[]; aaaa: string[]; pointed: boolean; ok: boolean; proxied?: boolean; error?: string }
interface Domain {
  id: string; host: string; alias_host: string | null; alias_ok: boolean; status: string;
  dns?: DnsState; alias_dns?: DnsState | null; live?: boolean;
}
interface State {
  server_ip: string; price_kes: number; paid: boolean; paid_via: string | null;
  pending_payment: { id: string } | null; domain: Domain | null; public_base: string;
}

const isOn = (d: Domain) => d.status === "approved" || d.status === "active";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * System › Custom domain (owner only), the JMSURF ISP way: pay once by M-Pesa, then connect one
 * domain (a main domain brings its www too). The owner points an A record at the server and presses
 * Check; when public DNS shows only that record the domain goes live with its own certificate, and
 * the company's customer pages, website and staff sign-in open there.
 */
export default function DomainSettings() {
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<"" | "pay" | "waiting" | "connect" | "check" | "remove">("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (check = false) => {
    const r = await callServer<State>("/api/staff/domains", { check });
    if (!alive.current) return null;
    if (r.error || !r.data) { setFailed(r.error || "Could not load your domain. Try again."); return null; }
    setFailed(null);
    setState(r.data);
    return r.data;
  }, []);

  useEffect(() => { void load(true); }, [load]);

  /** Waits for the M-Pesa payment (about two minutes), then reloads the page state. */
  const waitForPayment = useCallback(async (id: string) => {
    setBusy("waiting");
    for (let i = 0; i < 30 && alive.current; i++) {
      await sleep(4000);
      const r = await callServer<{ status: string }>("/api/staff/domain-pay-status", { id });
      const s = r.data?.status;
      if (s === "completed") { toast({ title: "Paid. Thank you", description: "Now connect your domain." }); break; }
      if (s === "failed" || s === "cancelled") {
        toast({ title: s === "cancelled" ? "Payment cancelled" : "Payment did not go through", description: "Nothing was charged. Try again.", variant: "destructive" });
        break;
      }
    }
    await load();
    if (alive.current) setBusy("");
  }, [load, toast]);

  const pay = async () => {
    setBusy("pay");
    const r = await callServer<{ id?: string; status: string }>("/api/staff/domain-pay", { phone });
    if (r.error || !r.data) { setBusy(""); toast({ title: "Could not send the M-Pesa prompt", description: r.error || "Try again.", variant: "destructive" }); return; }
    if (r.data.status === "completed") { setBusy(""); await load(); return; }
    toast({ title: "Check your phone", description: "Enter your M-Pesa PIN to pay." });
    await waitForPayment(String(r.data.id));
  };

  const connect = async () => {
    setBusy("connect");
    const r = await callServer<State>("/api/staff/domain-connect", { host });
    setBusy("");
    if (r.error || !r.data) { toast({ title: "Could not connect the domain", description: r.error || "Try again.", variant: "destructive" }); return; }
    setState(r.data);
    setHost("");
  };

  const check = async (d: Domain) => {
    setBusy("check");
    const r = await callServer<State>("/api/staff/domain-check", { id: d.id });
    setBusy("");
    if (r.error || !r.data?.domain) { toast({ title: "Could not check", description: r.error || "Try again.", variant: "destructive" }); return; }
    setState(r.data);
    const x = r.data.domain;
    if (x.live) toast({ title: `${x.host} is live` });
    else if (isOn(x)) toast({ title: "DNS is right", description: "The secure certificate is being issued. Check again in a few minutes." });
    else toast({ title: "DNS not ready yet", description: "DNS changes can take a few minutes, sometimes a few hours.", variant: "destructive" });
  };

  const remove = async (d: Domain) => {
    if (!(await confirmAction({ title: `Remove ${d.host}?`, message: "Your pages stop opening there within a few minutes. You can connect it, or another domain, again without paying.", danger: true, confirmLabel: "Remove" }))) return;
    setBusy("remove");
    const r = await callServer<State>("/api/staff/domain-remove", { id: d.id });
    setBusy("");
    if (r.error) { toast({ title: "Could not remove", description: r.error, variant: "destructive" }); return; }
    if (r.data) setState(r.data); else void load();
  };

  const copy = (v: string) => { void navigator.clipboard?.writeText(v); toast({ title: "Copied", description: v }); };

  if (failed && !state) {
    return (
      <Panel title="Custom domain" icon={Globe2}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">{failed}<Button size="sm" variant="outline" onClick={() => void load(true)}><RefreshCw /> Try again</Button></div>
      </Panel>
    );
  }
  if (!state) return <div className="flex justify-center py-10"><OrbSpinner className="h-5 w-5 text-muted-foreground" /></div>;

  const d = state.domain;
  const waiting = busy === "waiting" || (!!state.pending_payment && busy === "");

  // 1. Not paid yet: what it is, the price, pay by M-Pesa.
  if (!state.paid) {
    return (
      <Panel title="Use your own domain" icon={Globe2}>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Your customers open your pages at <span className="font-mono text-foreground">{state.public_base.replace(/^https:\/\//, "")}</span>.
            With your own domain (e.g. mygarage.co.ke) your job tracking, payment links, customer portal and website open there, and your staff can sign in there too.
          </p>
          <p><b>{kes(state.price_kes)}</b>, paid once. Changing or removing the domain later is free.</p>
          {waiting ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 p-3">
              <OrbSpinner className="h-4 w-4" />
              <span className="flex-1">Waiting for your M-Pesa payment. Enter your PIN on your phone.</span>
              {state.pending_payment && busy === "" && <Button size="sm" variant="outline" onClick={() => void waitForPayment(state.pending_payment!.id)}>Check payment</Button>}
            </div>
          ) : (
            <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (phone.trim()) void pay(); }}>
              <Field label="M-Pesa number" className="flex-1">
                <input className="fi" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter M-Pesa number" inputMode="tel" autoComplete="tel" />
              </Field>
              <Button type="submit" disabled={!phone.trim() || busy === "pay"}>{busy === "pay" ? <OrbSpinner /> : <Smartphone />} Pay {kes(state.price_kes)} by M-Pesa</Button>
            </form>
          )}
        </div>
      </Panel>
    );
  }

  // 2. Paid, no domain yet: one field.
  if (!d) {
    return (
      <Panel title="Connect your domain" icon={Globe2}>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (host.trim()) void connect(); }}>
          <Field label="Domain" hint="A main domain (mygarage.co.ke) comes with its www. A subdomain (portal.mygarage.co.ke) works too." className="flex-1">
            <input className="fi font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Enter your domain" autoCapitalize="none" spellCheck={false} />
          </Field>
          <Button type="submit" disabled={!host.trim() || busy === "connect"}>{busy === "connect" ? <OrbSpinner /> : <Globe2 />} Connect</Button>
        </form>
      </Panel>
    );
  }

  // 3. The domain: state, the DNS to add, Check, Remove.
  const records = [
    { name: d.alias_host ? "@" : d.host.split(".")[0], full: d.host, dns: d.dns },
    ...(d.alias_host ? [{ name: "www", full: d.alias_host, dns: d.alias_dns || undefined }] : []),
  ];
  const problem = (x?: DnsState) => !x || x.ok ? null
    : x.error ? x.error
    : x.a.length === 0 ? "No A record found yet."
    : !x.pointed ? `Points to ${x.a.join(", ")}${x.proxied ? " (Cloudflare proxy: switch the record to DNS only, grey cloud)" : ""}. Change it to ${state.server_ip}.`
    : `Remove the AAAA record ${x.aaaa.join(", ")}.`;

  return (
    <Panel title={d.host} icon={Globe2}
      actions={<div className="flex items-center gap-2">
        {d.live ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Live</Pill> : isOn(d) ? <Pill tone="info">Securing…</Pill> : <Pill tone="warning">Waiting for DNS</Pill>}
        <button type="button" className="icon-btn-danger h-8 w-8" disabled={!!busy} onClick={() => void remove(d)} aria-label="Remove domain"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>}>
      <div className="space-y-4 text-sm">
        {d.live && (
          <p className="text-muted-foreground">
            Your pages open at <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-foreground hover:text-primary">{d.host}<ExternalLink className="h-3 w-3" /></a>
            {d.alias_host && (d.alias_ok ? <> and {d.alias_host}</> : <>; {d.alias_host} follows once its record is right</>)}.
          </p>
        )}
        {(!d.live || (d.alias_host && !d.alias_ok)) && (
          <>
            <p className="text-muted-foreground">Where you bought the domain, open its DNS settings and add {records.length > 1 ? "these records" : "this record"}. Delete any other A or AAAA record on the same name, and any parking or forwarding. On Cloudflare keep it DNS only (grey cloud).</p>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Value</th></tr></thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.full} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-mono">A</td>
                      <td className="px-3 py-2"><span className="font-mono">{r.name}</span><span className="block text-[11px] text-muted-foreground">{r.full}</span>
                        {problem(r.dns) && <span className="mt-1 block text-[11px] text-destructive">{problem(r.dns)}</span>}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => copy(state.server_ip)} className="inline-flex items-center gap-1 font-mono hover:text-primary">{state.server_ip}<Copy className="h-3 w-3" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">No AAAA (IPv6) record. When the DNS is right, Check connects the domain and its padlock comes within a few minutes.</p>
          </>
        )}
        <Button variant="outline" disabled={!!busy} onClick={() => void check(d)}>{busy === "check" ? <OrbSpinner /> : <RefreshCw />} Check</Button>
      </div>
    </Panel>
  );
}
