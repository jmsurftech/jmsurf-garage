import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, KeyRound, Send, Users, Copy, LineChart, LayoutList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, Pill, Segmented } from "@/components/kit";
import { useErpSettings, Toggle } from "@/pages/settings/ErpSettingsTabs";
import { useTenant } from "@/hooks/useTenant";
import { ROOT_HOST } from "@/lib/host";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

const sb = supabase as any;

/**
 * System → Customer portal & website. The company opens its customer portal
 * (customers see invoices, statements, pay by M-Pesa, order) and sends each
 * customer their sign-in by SMS; the company website shows at its address.
 */
export default function PortalTab({ canManage }: { canManage: boolean }) {
  const { settings, save } = useErpSettings();
  const { tenant } = useTenant();
  const shop = settings.shop || {};
  const [portal, setPortal] = useState(false);
  const [site, setSite] = useState(false);
  const [signups, setSignups] = useState(true);
  const [pixel, setPixel] = useState("");
  const [ga, setGa] = useState("");
  useEffect(() => {
    setPortal(shop.portal_enabled === true); setSite(shop.site_enabled === true); setSignups(shop.approve_signups !== false);
    setPixel(shop.site?.tracking?.meta_pixel_id || ""); setGa(shop.site?.tracking?.ga4_id || "");
  }, [settings.shop]);
  const { data: domain } = useQuery({
    queryKey: ["portal-domain", tenant?.id], enabled: !!tenant?.id,
    queryFn: async () => (await sb.from("tenant_domains").select("host").eq("kind", "custom").in("status", ["approved", "active"]).limit(1).maybeSingle()).data?.host as string | undefined,
  });
  const origin = domain ? `https://${domain}` : `https://${tenant?.slug}.${ROOT_HOST}`;

  const persist = async (patch: Record<string, any>) => {
    const next = { ...shop, ...patch };
    const { error } = await save("shop", next);
    if (error) toast.error(friendlyError(error)); else toast.success("Saved");
  };

  return (
    <div className="space-y-5">
      <Panel title="Customer portal" icon={KeyRound} description="Customers sign in with their phone number to see quotes, invoices and statements, pay, message you, download documents and order again.">
        <div className="space-y-3">
          <Toggle label="Open the customer portal" hint={portal ? `Customers sign in at ${origin}/portal/login` : "Closed: nobody can sign in or sign up."} checked={portal} disabled={!canManage}
            onChange={(v) => { setPortal(v); void persist({ portal_enabled: v }); }} />
          <Toggle label="New sign-ups wait for your approval" hint="Customers who register themselves appear under Customers for approval." checked={signups} disabled={!canManage || !portal}
            onChange={(v) => { setSignups(v); void persist({ approve_signups: v }); }} />
          {portal && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm">
              <span className="font-mono">{origin}/portal/login</span>
              <button onClick={() => { void navigator.clipboard.writeText(`${origin}/portal/login`); toast.success("Link copied"); }} className="icon-btn"><Copy className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </Panel>

      {portal && <PortalSections shop={shop} canManage={canManage} persist={persist} />}

      {portal && <SendAccess />}

      <Panel title="Company website" icon={Globe} description="A public website at your address with your products, services and contacts (edit it under Online shop & website).">
        <Toggle label="Show the website at my address" hint={site ? `Visitors to ${origin} see your website; staff still sign in at ${origin}/login.` : `Visitors to ${origin} see your sign-in page.`} checked={site} disabled={!canManage}
          onChange={(v) => { setSite(v); void persist({ site_enabled: v }); }} />
      </Panel>

      <Panel title="Website tracking" icon={LineChart} description="Measure ads and visits on your own website.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meta (Facebook) Pixel ID"><input className="fi" value={pixel} disabled={!canManage} onChange={(e) => setPixel(e.target.value.replace(/\D/g, ""))} placeholder="123456789012345" /></Field>
          <Field label="Google Analytics 4 ID"><input className="fi" value={ga} disabled={!canManage} onChange={(e) => setGa(e.target.value.trim().toUpperCase())} placeholder="G-XXXXXXXXXX" /></Field>
        </div>
        <button disabled={!canManage} onClick={() => void persist({ site: { ...(shop.site || {}), tracking: { meta_pixel_id: pixel, ga4_id: ga } } })} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save tracking</button>
      </Panel>
    </div>
  );
}

const SECTION_SWITCHES: [string, string, string][] = [
  ["quotes", "Quotes", "Customers see their quotes and accept (with their typed name) or decline them. You are told at once."],
  ["messages", "Messages", "Customers write to you; you reply from the customer's page, Messages tab."],
  ["documents", "Documents", "Files you mark “Share with customer” on the customer's Documents tab."],
  ["projects", "Projects", "Their projects' status and progress (when JMSURF PROJECTS is on)."],
  ["orders", "Online orders", "Orders from your online shop and buying again."],
  ["offers", "Offers", "Products on offer from your online shop."],
  ["reminders", "Reminders", "Restock and visit reminders you set for them."],
];

/** Which parts of the portal customers see. Invoices, payments, statement and credit notes are always on. */
function PortalSections({ shop, canManage, persist }: { shop: any; canManage: boolean; persist: (patch: Record<string, any>) => Promise<void> }) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState(false);
  useEffect(() => {
    const s = shop.portal_sections || {};
    setOn(Object.fromEntries(SECTION_SWITCHES.map(([k]) => [k, s[k] !== false])));
    setReview(shop.portal_profile_review === true);
  }, [shop.portal_sections, shop.portal_profile_review]);
  return (
    <Panel title="What customers see" icon={LayoutList} description="Home, invoices, payments, statement and credit notes are always there. Switch the other parts on or off.">
      <div className="space-y-3">
        {SECTION_SWITCHES.map(([k, label, hint]) => (
          <Toggle key={k} label={label} hint={hint} checked={on[k] !== false} disabled={!canManage}
            onChange={(v) => { const next = { ...on, [k]: v }; setOn(next); void persist({ portal_sections: next }); }} />
        ))}
        <Toggle label="Contact changes wait for your approval" hint={review ? "Changes to name, phone, email, KRA PIN or address wait on the customer's page, Online account tab." : "Customers' changes apply at once and you get a bell notice."} checked={review} disabled={!canManage}
          onChange={(v) => { setReview(v); void persist({ portal_profile_review: v }); }} />
      </div>
    </Panel>
  );
}

/** Send customers their portal sign-in (a one-time password) by SMS. */
function SendAccess() {
  const [who, setWho] = useState<"owing" | "all" | "pick">("owing");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; failed: string[] } | null>(null);
  const { data: customers = [] } = useQuery({
    queryKey: ["portal-customers"],
    queryFn: async () => {
      const [{ data: cs }, { data: accs }, { data: owing }] = await Promise.all([
        sb.from("customers").select("id,name,phone").order("name").limit(5000),
        sb.from("customer_accounts").select("customer_id"),
        sb.from("invoices").select("customer_id").in("status", ["sent", "overdue", "partially_paid"]).limit(10000),
      ]);
      const has = new Set((accs || []).map((a: any) => a.customer_id));
      const owes = new Set((owing || []).map((a: any) => a.customer_id));
      return (cs || []).map((c: any) => ({ ...c, account: has.has(c.id), owes: owes.has(c.id) }));
    },
  });
  const targets = useMemo(() => customers.filter((c: any) => c.phone && (who === "all" || (who === "owing" && c.owes) || (who === "pick" && picked.has(c.id)))), [customers, who, picked]);
  const send = async () => {
    setBusy(true); setDone(null);
    const { data: { session } } = await supabase.auth.getSession();
    let ok = 0; const failed: string[] = [];
    for (const c of targets) {
      const r = await fetch("/api/erp/customer/portal-password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ customer_id: c.id }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.error) ok++; else failed.push(`${c.name}: ${j.error || r.status}`);
    }
    setDone({ ok, failed }); setBusy(false);
    toast.success(`Portal access sent to ${ok} customer${ok === 1 ? "" : "s"}`);
  };
  return (
    <Panel title="Send customers their access" icon={Send} description="Each customer gets an SMS with the portal link and a one-time password they change on first sign-in.">
      <Segmented value={who} onChange={setWho as any} options={[
        { value: "owing", label: "Customers with unpaid invoices", count: customers.filter((c: any) => c.owes && c.phone).length },
        { value: "all", label: "All with a phone", count: customers.filter((c: any) => c.phone).length },
        { value: "pick", label: "Choose" },
      ]} />
      {who === "pick" && (
        <div className="mt-3 space-y-2">
          <input className="fi" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {customers.filter((c: any) => c.phone && (!q || c.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 200).map((c: any) => (
              <label key={c.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(c.id) : n.delete(c.id); setPicked(n); }} />
                <span className="flex-1">{c.name} <span className="text-muted-foreground">{c.phone}</span></span>
                {c.account && <Pill tone="success">Has access</Pill>}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy || !targets.length} onClick={() => void send()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Users className="h-4 w-4" /> {busy ? "Sending…" : `Send to ${targets.length} customer${targets.length === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-muted-foreground">Uses your SMS units (System → SMS & WhatsApp).</span>
      </div>
      {done?.failed.length ? <ul className="mt-3 space-y-1 text-xs text-destructive">{done.failed.slice(0, 10).map((f) => <li key={f}>{f}</li>)}</ul> : null}
    </Panel>
  );
}
