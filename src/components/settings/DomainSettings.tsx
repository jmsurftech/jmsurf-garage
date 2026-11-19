import { useCallback, useEffect, useState } from "react";
import { Globe2, Plus, Trash2, ExternalLink, RefreshCw, CheckCircle2, Copy } from "lucide-react";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { callServer } from "@/lib/serverStaff";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";

interface DnsState { a: string[]; aaaa: string[]; pointed: boolean; ok: boolean }
interface Domain { id: string; host: string; status: string; dns?: DnsState; live?: boolean }

const isOn = (d: Domain) => d.status === "approved" || d.status === "active";

/**
 * Settings › Domain: the owner connects the shop's own domain. They add it,
 * point an A record at the server and press Check; once DNS is right it goes
 * live with its own certificate, and the domain opens this shop exactly like
 * <slug>.garage.jmsurf.co.ke (website, ordering, staff and rider sign-in).
 */
export default function DomainSettings() {
  const { toast } = useToast();
  const [ip, setIp] = useState("37.60.255.35");
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const check = useCallback(async (d: Domain) => {
    setBusy(d.id);
    const r = await callServer<{ domain: Domain; server_ip: string }>("/api/staff/domain-check", { id: d.id });
    setBusy(null);
    if (r.data?.domain) setDomains((all) => (all || []).map((x) => (x.id === d.id ? r.data!.domain : x)));
    return r.data?.domain;
  }, []);

  useEffect(() => {
    (async () => {
      const r = await callServer<{ domains: Domain[]; server_ip: string }>("/api/staff/domains", {});
      if (r.error || !r.data) { setDomains([]); if (r.error) toast({ title: "Could not load domains", description: r.error, variant: "destructive" }); return; }
      setIp(r.data.server_ip);
      setDomains(r.data.domains);
      r.data.domains.forEach((d) => { void check(d); });
    })();
  }, [check, toast]);

  const add = async () => {
    setBusy("new");
    const r = await callServer<{ domain: Domain; server_ip: string }>("/api/staff/domain-connect", { host });
    setBusy(null);
    if (r.error || !r.data?.domain) { toast({ title: "Could not add the domain", description: r.error || "Try again.", variant: "destructive" }); return; }
    const d = r.data.domain;
    setDomains((all) => [...(all || []).filter((x) => x.id !== d.id), d]);
    setHost("");
    toast({ title: isOn(d) ? "Domain connected" : "Domain added", description: isOn(d) ? "It opens your company within a few minutes." : "Now set its DNS as shown, then press Check." });
  };

  const remove = async (d: Domain) => {
    if (!(await confirmAction({ title: `Stop opening your shop on ${d.host}?`, danger: true, confirmLabel: "Stop" }))) return;
    setBusy(d.id);
    const r = await callServer("/api/staff/domain-remove", { id: d.id });
    setBusy(null);
    if (r.error) { toast({ title: "Could not remove", description: r.error, variant: "destructive" }); return; }
    setDomains((all) => (all || []).filter((x) => x.id !== d.id));
  };

  const recheck = async (d: Domain) => {
    const res = await check(d);
    if (!res) return;
    if (res.live) toast({ title: `${res.host} is live` });
    else if (isOn(res)) toast({ title: "DNS is correct", description: "The secure certificate is being issued. Check again in a minute or two." });
    else toast({ title: "DNS not ready yet", description: "Changes can take from a few minutes up to a few hours to spread.", variant: "destructive" });
  };

  const copy = (v: string) => { void navigator.clipboard?.writeText(v); toast({ title: "Copied", description: v }); };

  return (
    <div className="space-y-5">
      <Panel title="Your own domain" icon={Globe2} description="Open your company on your own address, e.g. myshop.co.ke. Customers order there, and staff and riders sign in there.">
        <div className="space-y-4">
          {domains === null ? (
            <div className="flex justify-center py-6"><OrbSpinner className="h-5 w-5 text-muted-foreground" /></div>
          ) : domains.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {domains.map((d) => (
                <li key={d.id} className="space-y-2 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono font-medium hover:text-primary">{d.host}<ExternalLink className="h-3 w-3 shrink-0" /></a>
                    {d.live ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Live</Pill>
                      : isOn(d) ? <Pill tone="info">Securing…</Pill>
                      : <Pill tone="warning">Waiting for DNS</Pill>}
                    <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => recheck(d)}>
                      {busy === d.id ? <OrbSpinner /> : <RefreshCw />} Check
                    </Button>
                    <button type="button" className="icon-btn-danger h-8 w-8" disabled={busy === d.id} onClick={() => remove(d)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  {d.dns && !d.dns.ok && (
                    <p className="text-xs text-muted-foreground">
                      {d.dns.a.length === 0 ? "No A record found yet."
                        : !d.dns.pointed ? <>The domain points to <span className="font-mono">{d.dns.a.join(", ")}</span>. Change the A record to <span className="font-mono text-foreground">{ip}</span>{d.dns.a.some((x) => x.startsWith("104.") || x.startsWith("172.6")) ? ". On Cloudflare make sure the record's value is that IP and SSL/TLS mode is Full" : ""}.</>
                        : <>Remove the AAAA (IPv6) record <span className="font-mono">{d.dns.aaaa.join(", ")}</span>; only the A record is needed.</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Field label="Add a domain" hint="Your main domain (myshop.co.ke) or a subdomain (order.myshop.co.ke). Add www.myshop.co.ke separately if you want it too.">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (host.trim()) void add(); }}>
              <input className="fi flex-1 font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="myshop.co.ke" autoCapitalize="none" spellCheck={false} />
              <Button type="submit" disabled={!host.trim() || busy === "new"}>{busy === "new" ? <OrbSpinner /> : <Plus />} Connect</Button>
            </form>
          </Field>
        </div>
      </Panel>

      <Panel title="How to connect it" description="Do this where you bought the domain (e.g. Truehost, HostPinnacle, Safaricom, GoDaddy, Namecheap or Cloudflare).">
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>Open the domain's <b>DNS settings</b>.</li>
          <li>
            Add an <b>A record</b>:
            <div className="mt-2 grid gap-2 rounded-xl bg-muted/60 p-3 font-mono text-xs sm:grid-cols-3">
              <span><span className="block font-sans text-[11px] text-muted-foreground">Type</span>A</span>
              <span><span className="block font-sans text-[11px] text-muted-foreground">Name / Host</span>@ <span className="font-sans text-muted-foreground">(or the subdomain, e.g. order / www)</span></span>
              <button type="button" onClick={() => copy(ip)} className="text-left hover:text-primary"><span className="block font-sans text-[11px] text-muted-foreground">Value / Points to</span>{ip} <Copy className="inline h-3 w-3" /></button>
            </div>
          </li>
          <li>Delete any other <b>A</b> or <b>AAAA</b> records on that same name, and any parking or forwarding.</li>
          <li>On Cloudflare, either keep the record <b>DNS only</b> (grey cloud), or if you keep the orange cloud set <b>SSL/TLS</b> to <b>Full</b> (not Flexible).</li>
          <li>Come back and press <b>Check</b>. When the DNS is right the domain is connected and secured automatically.</li>
        </ol>
      </Panel>
    </div>
  );
}
