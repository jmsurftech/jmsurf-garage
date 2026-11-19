/** System → API & webhooks: company API keys, outgoing webhooks, delivery log and API reference. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Webhook, Plus, Trash2, Send, Copy, Check, Eye, EyeOff, BookOpen, History, ShieldCheck, Code2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Panel, Pill, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const ORIGIN = typeof window !== "undefined" ? window.location.origin.replace(/\/\/[^.]+\.(garage\.jmsurf\.co\.ke)/, "//$1") : "https://garage.jmsurf.co.ke";
const BASE = `${ORIGIN}/api/v1`;
const EVENTS: [string, string][] = [
  ["invoice.created", "Invoice created"], ["invoice.paid", "Invoice fully paid"], ["invoice.updated", "Invoice changed"],
  ["payment.received", "Payment received"], ["customer.created", "Customer added"], ["customer.updated", "Customer changed"],
  ["order.created", "Sales order created"], ["order.updated", "Sales order changed"], ["quote.created", "Quote created"], ["quote.accepted", "Quote accepted"],
  ["product.created", "Product added"], ["product.updated", "Product changed"], ["bill.created", "Bill recorded"],
];

async function call<T = any>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(`/api/erp/dev/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}
function CopyBox({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); toast.success("Copied"); setTimeout(() => setDone(false), 1500); }} className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-card" aria-label="Copy">{done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}</button>
    </span>
  );
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

export default function DevelopersTab() {
  const { profile } = useAuth();
  const tenantId = (profile as any)?.tenant_id;
  const [keyName, setKeyName] = useState("");
  const [write, setWrite] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["invoice.created", "invoice.paid", "payment.received", "customer.created"]);
  const [reveal, setReveal] = useState<string | null>(null);
  const { data: keys = [], refetch: refetchKeys } = useQuery({ queryKey: ["dev-keys", tenantId], enabled: !!tenantId, queryFn: async () => ((await sb.from("erp_api_keys").select("id,name,prefix,scopes,last_used_at,revoked_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false })).data || []) as any[] });
  const { data: hooks = [], refetch: refetchHooks } = useQuery({ queryKey: ["dev-hooks", tenantId], enabled: !!tenantId, queryFn: async () => ((await sb.from("erp_webhooks").select("*").eq("tenant_id", tenantId).order("created_at")).data || []) as any[] });
  const { data: log = [], refetch: refetchLog } = useQuery({ queryKey: ["dev-log", tenantId], enabled: !!tenantId, refetchInterval: 30_000, queryFn: async () => ((await sb.from("erp_webhook_deliveries").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50)).data || []) as any[] });

  const createKey = async () => {
    setBusy("key");
    try { const r = await call<{ key: string }>("keys/create", { name: keyName, write }); setCreated(r.key); setKeyName(""); setWrite(false); void refetchKeys(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(""); }
  };
  const addHook = async () => {
    if (!/^https:\/\/.+/.test(url.trim())) return toast.error("Use an https:// address");
    if (!events.length) return toast.error("Choose at least one event");
    setBusy("hook");
    const { error } = await sb.from("erp_webhooks").insert({ tenant_id: tenantId, url: url.trim(), events });
    setBusy("");
    if (error) return toast.error(error.message);
    setUrl(""); void refetchHooks(); toast.success("Webhook added");
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#0f172a,#1e293b_55%,#7a0b14)] p-6 text-white shadow-xl">
        <span aria-hidden className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20"><Code2 className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1"><p className="font-display text-xl font-extrabold">Connect anything to JMSURF Garage</p><p className="text-sm text-white/75">A REST API for your customers, products, invoices, payments and orders, and webhooks the moment something happens.</p></div>
          <a href="#dev-docs" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900">API reference</a>
        </div>
      </div>

      <Panel title="API keys" icon={KeyRound} description="Keep keys on your server only. Read keys can only read; write keys can also add and edit customers and products.">
        {created && (
          <div className="mb-4 space-y-2 rounded-2xl border border-success/40 bg-success/5 p-4">
            <p className="flex items-center gap-2 font-semibold text-success"><ShieldCheck className="h-4 w-4" /> Copy your key now: it is shown only once</p>
            <CopyBox value={created} />
            <Button variant="outline" size="sm" onClick={() => setCreated(null)}>I have saved it</Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input className="fi h-10 min-w-[14rem] flex-1" placeholder="Key name, e.g. Online shop sync" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs font-semibold">{[[false, "Read only"], [true, "Read & write"]].map(([v, l]) => <button key={String(v)} type="button" onClick={() => setWrite(v as boolean)} className={cn("rounded-lg px-3 py-1.5", write === v ? "bg-card shadow" : "text-muted-foreground")}>{l as string}</button>)}</div>
          <Button onClick={() => void createKey()} disabled={busy === "key"}>{busy === "key" ? <OrbSpinner /> : <Plus />} Create key</Button>
        </div>
        <div className="mt-4 divide-y divide-border rounded-2xl border border-border">
          {!keys.length ? <EmptyState icon={KeyRound} title="No API keys yet" /> : keys.map((k) => (
            <div key={k.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", k.revoked_at && "opacity-50")}>
              <KeyRound className="h-4 w-4 text-primary" />
              <span className="min-w-0 flex-1"><b className="block text-sm">{k.name}</b><span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span></span>
              <Pill tone={(k.scopes || []).includes("write") ? "warning" : "info"}>{(k.scopes || []).includes("write") ? "Read & write" : "Read only"}</Pill>
              <span className="text-xs text-muted-foreground">{k.revoked_at ? `Revoked ${when(k.revoked_at)}` : k.last_used_at ? `Used ${when(k.last_used_at)}` : "Never used"}</span>
              {!k.revoked_at && <button onClick={async () => { if (await confirmAction({ title: `Revoke ${k.name}?`, message: "Anything using this key stops working at once.", confirmLabel: "Revoke", danger: true })) { await call("keys/revoke", { id: k.id }).catch((e) => toast.error(e.message)); void refetchKeys(); } }} className="rounded-lg px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10">Revoke</button>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Webhooks" icon={Webhook} description="We POST a signed JSON event to your address when these things happen. Failed deliveries are retried for about 6 hours.">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2"><input className="fi h-10 min-w-[16rem] flex-1" placeholder="https://yourapp.com/webhooks/jmsurf" value={url} onChange={(e) => setUrl(e.target.value)} /><Button onClick={() => void addHook()} disabled={busy === "hook"}>{busy === "hook" ? <OrbSpinner /> : <Plus />} Add endpoint</Button></div>
          <div className="flex flex-wrap gap-1.5">{EVENTS.map(([e, l]) => { const on = events.includes(e); return <button key={e} type="button" title={e} onClick={() => setEvents(on ? events.filter((x) => x !== e) : [...events, e])} className={cn("rounded-full px-3 py-1 text-xs font-semibold", on ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "bg-muted text-muted-foreground")}>{l}</button>; })}</div>
        </div>
        <div className="mt-4 space-y-3">
          {!hooks.length ? <EmptyState icon={Webhook} title="No webhooks yet" /> : hooks.map((h) => (
            <div key={h.id} className="space-y-2 rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{h.url}</p>
                {h.last_status != null && <Pill tone={h.last_status >= 200 && h.last_status < 300 ? "success" : "danger"}>last {h.last_status || "error"}</Pill>}
                <button onClick={async () => { await sb.from("erp_webhooks").update({ is_active: !h.is_active }).eq("id", h.id); void refetchHooks(); }} className={cn("rounded-full px-3 py-1 text-xs font-semibold", h.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{h.is_active ? "Active" : "Paused"}</button>
                <Button variant="outline" size="sm" disabled={busy === h.id} onClick={async () => { setBusy(h.id); try { const r = await call("webhooks/test", { id: h.id }); r.ok ? toast.success(`Delivered (${r.status}, ${r.ms} ms)`) : toast.error(`Failed: ${r.error}`); void refetchHooks(); void refetchLog(); } catch (e: any) { toast.error(e.message); } finally { setBusy(""); } }}>{busy === h.id ? <OrbSpinner /> : <Send />} Send test</Button>
                <button onClick={async () => { if (await confirmAction({ title: "Delete this webhook?", confirmLabel: "Delete", danger: true })) { await sb.from("erp_webhooks").delete().eq("id", h.id); void refetchHooks(); } }} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label="Delete webhook"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1">{(h.events || []).map((e: string) => <Pill key={e} tone="info">{e}</Pill>)}</div>
              <div className="flex items-center gap-2 text-xs"><span className="shrink-0 text-muted-foreground">Signing secret</span>{reveal === h.id ? <><span className="min-w-0 flex-1"><CopyBox value={h.secret} /></span><button onClick={() => setReveal(null)} aria-label="Hide"><EyeOff className="h-4 w-4 text-muted-foreground" /></button></> : <button onClick={() => setReveal(h.id)} className="inline-flex items-center gap-1 font-semibold text-primary"><Eye className="h-3.5 w-3.5" /> Show</button>}</div>
              {h.last_error && <p className="text-xs text-destructive">Last error: {h.last_error}</p>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent deliveries" icon={History} flush>
        {!log.length ? <EmptyState icon={History} title="Nothing delivered yet" /> : (
          <div className="divide-y divide-border"><PagedRows rows={log}>{(pageRows) => pageRows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <span className="text-xs text-muted-foreground">{when(d.created_at)}</span>
              <span className="flex-1 font-mono text-xs">{d.event}</span>
              {d.ms != null && <span className="text-xs text-muted-foreground">{d.ms} ms</span>}
              <Pill tone={d.status >= 200 && d.status < 300 ? "success" : "danger"}>{d.status || "no answer"}</Pill>
            </div>
          ))}</PagedRows></div>
        )}
      </Panel>

      <div id="dev-docs" className="scroll-mt-24">
        <Panel title="API reference" icon={BookOpen} description="JSON over HTTPS. Send your key as Authorization: Bearer jd_live_…">
          <div className="space-y-5 text-sm leading-relaxed">
            <div><p className="mb-1 font-semibold">Base URL</p><CopyBox value={BASE} /></div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[560px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2">Endpoint</th><th className="px-4 py-2">What it does</th></tr></thead>
                <tbody className="divide-y divide-border font-mono text-[12.5px]"><PagedRows rows={[
                  ["GET /company", "Your company name, type, contacts and logo"],
                  ["GET /customers?q=&limit=&offset=", "List or search customers"], ["GET /customers/{id}", "One customer"], ["POST /customers", "Add a customer (write key): name, phone, email…"], ["PATCH /customers/{id}", "Edit a customer (write key)"],
                  ["GET /products?q=", "List or search products"], ["POST /products", "Add a product (write key): name, sku, price…"], ["PATCH /products/{id}", "Edit price, stock alert level, etc. (write key)"],
                  ["GET /invoices?status=&customer_id=", "Invoices with their lines"], ["GET /invoices/{id}", "One invoice"],
                  ["GET /payments", "Payments received"], ["GET /quotes", "Quotes"], ["GET /sales-orders", "Sales orders"], ["GET /bills", "Bills from suppliers"],
                ]} colSpan={2}>{(pageRows) => pageRows.map(([e, d]) => <tr key={e}><td className="px-4 py-2 font-semibold">{e}</td><td className="px-4 py-2 font-sans">{d}</td></tr>)}</PagedRows></tbody></table>
            </div>
            <p>Lists return <code className="rounded bg-muted px-1">{"{ data, total, limit, offset, has_more }"}</code>, newest first, up to 100 per page. Use <code className="rounded bg-muted px-1">created_since</code> (ISO date) to fetch only new records. Limit: 10 requests a second per key.</p>
            <pre className="overflow-x-auto rounded-2xl bg-[#0d1117] p-4 font-mono text-[12.5px] leading-relaxed text-[#e6edf3]">{`curl "${BASE}/invoices?status=unpaid&limit=20" \\
  -H "Authorization: Bearer $JMSURF_DASH_KEY"

curl -X POST "${BASE}/customers" \\
  -H "Authorization: Bearer $JMSURF_DASH_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Customer name","phone":"07XXXXXXXX","email":"customer email address"}'`}</pre>
            <div>
              <p className="mb-1 font-semibold">Verifying webhooks</p>
              <p>Each request carries <code className="rounded bg-muted px-1">X-JMSURF-Signature: t=…,v1=…</code>, where v1 is HMAC-SHA256 of <code className="rounded bg-muted px-1">t + "." + raw body</code> with your signing secret. Reply 2xx within 10 seconds.</p>
              <pre className="mt-2 overflow-x-auto rounded-2xl bg-[#0d1117] p-4 font-mono text-[12.5px] leading-relaxed text-[#e6edf3]">{`const { t, v1 } = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
const ok = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${rawBody}\`).digest("hex") === v1;`}</pre>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
