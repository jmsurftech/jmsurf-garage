import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, MessageCircle, Save, Send, Wallet, Plus, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Field, Pill, SearchBox, EmptyState, Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { messagingApi } from "@/lib/messaging";
import { OrbSpinner } from "@/components/orbs";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;

type Keys = {
  sms_enabled?: boolean; sendbulksms_api_key?: string; sms_sender_id?: string; price_per_sms?: number;
  wa_enabled?: boolean; apiwap_api_key?: string;
};

/** Platform SMS (SendBulkSMS) and WhatsApp (APIWAP) accounts, and shops' prepaid SMS units. */
export default function AdminMessagingPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keys, setKeys] = useState<Keys>({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [topup, setTopup] = useState<any | null>(null);
  const [units, setUnits] = useState("");
  const [paid, setPaid] = useState("");
  const [ref, setRef] = useState("");

  useEffect(() => {
    sb.from("platform_settings").select("value").eq("key", "messaging").maybeSingle().then(({ data }: any) => setKeys(data?.value || {}));
  }, []);

  const set = (k: keyof Keys, v: any) => setKeys((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    const value = { ...keys, sms_sender_id: String(keys.sms_sender_id || "").trim(), price_per_sms: Number(keys.price_per_sms || 0) || 0.4 };
    const { data: existing } = await sb.from("platform_settings").select("id").eq("key", "messaging").maybeSingle();
    const { error } = existing
      ? await sb.from("platform_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "messaging")
      : await sb.from("platform_settings").insert({ key: "messaging", value });
    setSaving(false);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else toast({ title: "Messaging settings saved" });
  };

  const test = async (channel: "sms" | "whatsapp") => {
    if (!testTo.trim()) { toast({ title: "Enter a phone number", variant: "destructive" }); return; }
    setBusy(channel);
    const r = await messagingApi("admin", { action: "test", channel, to: testTo, keys });
    setBusy("");
    if (r?.ok) toast({ title: "Test sent", description: r.sandbox ? "Test key: accepted but not delivered." : "Check the phone." });
    else toast({ title: "Test failed", description: r?.error || "Not sent", variant: "destructive" });
  };

  const checkBalance = async () => {
    setBalance("…");
    const r = await messagingApi("admin", { action: "balance", keys });
    setBalance(r?.ok ? `${Number(r.balance).toLocaleString()} units${r.sandbox ? " (test key)" : ""}` : r?.error || "Unavailable");
  };

  const { data: shops = [], isLoading } = useQuery({
    queryKey: ["admin-sms-companies"],
    queryFn: async () => {
      const [{ data: tenants }, { data: sms }] = await Promise.all([
        sb.from("tenants").select("id, business_name, slug").is("deleted_at", null).order("business_name"),
        sb.from("tenant_sms_settings").select("tenant_id, balance_units, total_sent"),
      ]);
      const map = new Map((sms || []).map((r: any) => [r.tenant_id, r]));
      return (tenants || []).map((t: any) => ({ ...t, units: Number((map.get(t.id) as any)?.balance_units || 0), sent: Number((map.get(t.id) as any)?.total_sent || 0) }));
    },
  });
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? shops.filter((t: any) => `${t.business_name} ${t.slug}`.toLowerCase().includes(s)) : shops;
  }, [shops, q]);

  const addUnits = async () => {
    const n = parseInt(units, 10);
    if (!n) { toast({ title: "Enter the number of units", variant: "destructive" }); return; }
    setBusy("topup");
    const { data, error } = await sb.rpc("admin_add_sms_units", { p_tenant: topup.id, p_units: n, p_amount: Number(paid || 0), p_reference: ref || null });
    setBusy("");
    if (error) { toast({ title: "Not added", description: error.message, variant: "destructive" }); return; }
    toast({ title: "SMS units updated", description: `${topup.business_name} now has ${Number(data).toLocaleString()} units.` });
    setTopup(null); setUnits(""); setPaid(""); setRef("");
    qc.invalidateQueries({ queryKey: ["admin-sms-companies"] });
  };

  const smsOn = !!(keys.sms_enabled && keys.sendbulksms_api_key);
  const waOn = !!(keys.wa_enabled && keys.apiwap_api_key);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-border bg-muted/30 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /><h4 className="font-semibold">SMS · SendBulkSMS</h4></div>
            {smsOn ? <Pill tone="success">On for companies</Pill> : <Pill>Off</Pill>}
          </div>
          <p className="text-xs text-muted-foreground">Companies that choose "JMSURF account" send through this key and use their prepaid units.</p>
          <Field label="API key" hint="Starts with bsms_live_ (bsms_test_ accepts but doesn't deliver)">
            <input className="fi font-mono" type="password" autoComplete="off" value={keys.sendbulksms_api_key || ""} onChange={(e) => set("sendbulksms_api_key", e.target.value.trim())} placeholder="bsms_live_…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default sender ID"><input className="fi" maxLength={11} value={keys.sms_sender_id || ""} onChange={(e) => set("sms_sender_id", e.target.value)} placeholder="JMSURFPOS" /></Field>
            <Field label="Price per SMS (KES)" hint="Shown to companies"><input className="fi" type="number" min={0} step="0.1" value={keys.price_per_sms ?? 1.5} onChange={(e) => set("price_per_sms", e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!keys.sms_enabled} onChange={(e) => set("sms_enabled", e.target.checked)} /> Let companies send SMS through this account</label>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" onClick={checkBalance} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Wallet className="h-3.5 w-3.5" /> Check balance</button>
            {balance && <span className="text-muted-foreground">{balance}</span>}
            <a href="https://sendbulksms.co.ke" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">sendbulksms.co.ke <ExternalLink className="h-3 w-3" /></a>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-muted/30 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /><h4 className="font-semibold">WhatsApp · APIWAP</h4></div>
            {waOn ? <Pill tone="success">On for companies</Pill> : <Pill>Off</Pill>}
          </div>
          <p className="text-xs text-muted-foreground">Companies that choose "JMSURF account" send receipts from the WhatsApp number linked to this key.</p>
          <Field label="API key" hint="From the APIWAP dashboard, after linking the WhatsApp number">
            <input className="fi font-mono" type="password" autoComplete="off" value={keys.apiwap_api_key || ""} onChange={(e) => set("apiwap_api_key", e.target.value.trim())} placeholder="Paste API key" />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!keys.wa_enabled} onChange={(e) => set("wa_enabled", e.target.checked)} /> Let companies send WhatsApp through this account</label>
          <a href="https://apiwap.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">apiwap.com <ExternalLink className="h-3 w-3" /></a>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>{saving ? <OrbSpinner /> : <Save />} Save</Button>
        <span className="mx-2 hidden h-6 w-px bg-border sm:block" />
        <input className="fi w-56" inputMode="tel" placeholder="Test number, e.g. 0712…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <Button variant="outline" onClick={() => test("sms")} disabled={!!busy || !keys.sendbulksms_api_key}>{busy === "sms" ? <OrbSpinner /> : <Send />} Test SMS</Button>
        <Button variant="outline" onClick={() => test("whatsapp")} disabled={!!busy || !keys.apiwap_api_key}>{busy === "whatsapp" ? <OrbSpinner /> : <MessageCircle />} Test WhatsApp</Button>
      </div>

      <section className="rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h4 className="font-semibold">Company SMS units</h4>
            <p className="text-xs text-muted-foreground">Prepaid units for companies using JMSURF's SMS account. One unit = one SMS part (160 characters).</p>
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="Find a company…" className="w-full sm:w-64" />
        </div>
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : filtered.length === 0 ? <EmptyState title="No companies found" className="py-10" /> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="dt">
              <thead><tr><th>Company</th><th className="num">Units left</th><th className="num">Sent</th><th /></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={4}>{(pageRows) => pageRows.map((t: any) => (
                  <tr key={t.id}>
                    <td><p className="font-medium">{t.business_name || t.slug}</p><p className="font-mono text-[11px] text-muted-foreground">{t.slug}</p></td>
                    <td className="num font-semibold">{t.units.toLocaleString()}</td>
                    <td className="num text-muted-foreground">{t.sent.toLocaleString()}</td>
                    <td className="text-right"><Button size="sm" variant="outline" onClick={() => setTopup(t)}><Plus /> Add units</Button></td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={!!topup} onClose={() => setTopup(null)} icon={Wallet} title={`Add SMS units — ${topup?.business_name || ""}`}
        description={`Currently ${Number(topup?.units || 0).toLocaleString()} units. Use a negative number to correct a mistake.`}
        footer={<><Button variant="outline" onClick={() => setTopup(null)}>Cancel</Button><Button onClick={addUnits} disabled={busy === "topup"}>{busy === "topup" && <OrbSpinner />} Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Units"><input className="fi" type="number" value={units} onChange={(e) => setUnits(e.target.value)} autoFocus /></Field>
          <Field label="Amount paid (KES)"><input className="fi" type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          <Field label="Payment reference" className="sm:col-span-2"><input className="fi" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. M-Pesa code" /></Field>
        </div>
      </Modal>
    </div>
  );
}
