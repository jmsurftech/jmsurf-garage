import { useCallback, useEffect, useState } from "react";
import { Globe2, Trash2, ExternalLink, Unlock, RefreshCw } from "lucide-react";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callServer } from "@/lib/serverStaff";
import { confirmAction } from "@/components/books/confirm";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;

interface Domain { id: string; host: string; alias_host: string | null; status: string; live?: boolean }
interface State { server_ip: string; price_kes: number; paid: boolean; paid_via: string | null; domain: Domain | null; public_base: string }

/**
 * Platform admin: a company's custom domain. Unlock it free (no M-Pesa payment), connect its one
 * domain for it, check or remove it. The company sees the same domain under System › Custom domain.
 */
export default function CustomDomainPanel({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (check = false) => {
    const r = await callServer<State>("/api/staff/domains", { tenant_id: tenantId, check });
    if (r.data && !r.error) setState(r.data);
    else toast({ title: "Could not load the domain", description: r.error || "Try again.", variant: "destructive" });
  }, [tenantId, toast]);
  useEffect(() => { void load(); }, [load]);

  const unlock = async (on: boolean) => {
    setBusy(true);
    const { error } = await sb.rpc("garage_domain_unlock", { p_tenant: tenantId, p_unlock: on });
    setBusy(false);
    if (error) { toast({ title: "Could not change it", description: error.message, variant: "destructive" }); return; }
    toast({ title: on ? "Custom domain unlocked free" : "Custom domain locked" });
    void load();
  };

  const call = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    const r = await callServer<State>(path, { tenant_id: tenantId, ...body });
    setBusy(false);
    if (r.error || !r.data) { toast({ title: "Did not go through", description: r.error || "Try again.", variant: "destructive" }); return; }
    if ("domain" in r.data) setState(r.data); else void load();
    toast({ title: done });
  };

  const remove = async (d: Domain) => {
    if (!(await confirmAction({ title: `Remove ${d.host}?`, message: "The company stops opening there within a few minutes. It can connect a domain again without paying.", danger: true, confirmLabel: "Remove" }))) return;
    await call("/api/staff/domain-remove", { id: d.id }, "Domain removed");
  };

  if (!state) return <Panel title="Custom domain" icon={Globe2}><div className="flex justify-center py-4"><OrbSpinner className="h-4 w-4 text-muted-foreground" /></div></Panel>;
  const d = state.domain;
  const on = d && (d.status === "approved" || d.status === "active");

  return (
    <Panel title="Custom domain" icon={Globe2}
      actions={state.paid
        ? <Pill tone="success">{state.paid_via === "free" ? "Unlocked free" : state.paid_via === "existing" ? "Had a domain" : "Paid"}</Pill>
        : <Button size="sm" variant="outline" disabled={busy} onClick={() => void unlock(true)}><Unlock /> Unlock free</Button>}>
      <div className="space-y-3 text-sm">
        {!state.paid && <p className="text-muted-foreground">Not paid (KES {state.price_kes.toLocaleString("en-KE")} once). The company pays from System › Custom domain, or unlock it free here.</p>}
        {d ? (
          <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 font-mono hover:text-primary">
              <span className="truncate">{d.host}{d.alias_host ? ` + ${d.alias_host}` : ""}</span><ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            <Pill tone={d.live ? "success" : on ? "info" : "warning"}>{d.live ? "Live" : on ? "Securing" : "Waiting for DNS"}</Pill>
            <button type="button" className="icon-btn h-7 w-7" disabled={busy} onClick={() => void call("/api/staff/domain-check", { id: d.id }, "Checked")} aria-label="Check"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button type="button" className="icon-btn-danger h-7 w-7" disabled={busy} onClick={() => void remove(d)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) : state.paid && (
          <Field label="Connect a domain">
            <form className="flex min-w-0 gap-2" onSubmit={(e) => { e.preventDefault(); if (host.trim()) void call("/api/staff/domain-connect", { host }, "Domain added").then(() => setHost("")); }}>
              <input className="fi min-w-0 flex-1 font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Enter domain" autoCapitalize="none" spellCheck={false} />
              <Button type="submit" disabled={!host.trim() || busy}>Connect</Button>
            </form>
          </Field>
        )}
        {d && !d.live && <p className="text-xs text-muted-foreground">DNS: A record{d.alias_host ? "s for @ and www" : ""} to <span className="font-mono text-foreground">{state.server_ip}</span>, no AAAA, DNS only on Cloudflare.</p>}
        {state.paid && state.paid_via === "free" && <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={() => void unlock(false)}>Lock again</button>}
      </div>
    </Panel>
  );
}
