import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, ChevronDown, Save, PlugZap, Smartphone, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Field, Pill, SearchBox } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/currencies";
import { cn } from "@/lib/utils";
import { payApi, useGatewayCatalog, useShopGateways, type GatewayInfo } from "@/lib/gateways";
import { OrbSpinner } from "@/components/orbs";
import { BrandLogo } from "@/components/BrandLogo";

const SIGNUP: Record<string, string> = {
  flutterwave: "https://flutterwave.com", stripe: "https://stripe.com", paypal: "https://developer.paypal.com",
  kopokopo: "https://kopokopo.co.ke", intasend: "https://intasend.com", pesapal: "https://www.pesapal.com",
  mtn_momo: "https://momodeveloper.mtn.com", airtel: "https://developers.airtel.africa", waafipay: "https://waafipay.com", chapa: "https://chapa.co",
};

type Row = { enabled: boolean; config: Record<string, any>; saved: string[] };

/**
 * Settings for the extra gateways.
 * scope "shop": the shop's own accounts, to be paid for sales (secrets are write-only).
 * scope "platform": JMSURF's accounts, to collect package fees (Admin only).
 */
export default function GatewaysPanel({ scope, canManage = true, baseCurrency }: { scope: "shop" | "platform"; canManage?: boolean; baseCurrency: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: catalog = [], isLoading: catLoading } = useGatewayCatalog();
  const { data: shopRows } = useShopGateways();
  const [platform, setPlatform] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (scope !== "platform") return;
    (supabase as any).from("platform_settings").select("value").eq("key", "gateways").maybeSingle()
      .then(({ data }: any) => setPlatform(data?.value || {}));
  }, [scope]);

  useEffect(() => {
    const next: Record<string, Row> = {};
    if (scope === "shop") {
      (shopRows || []).forEach((g) => { next[g.provider] = { enabled: g.enabled, config: { ...g.config }, saved: g.saved || [] }; });
    } else if (platform) {
      Object.entries(platform).forEach(([id, v]: [string, any]) => {
        const { enabled, ...config } = v || {};
        next[id] = { enabled: !!enabled, config, saved: Object.keys(config).filter((k) => String(config[k] ?? "") !== "") };
      });
    }
    setRows(next);
  }, [scope, shopRows, platform]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((g) => !s || `${g.label} ${g.countries}`.toLowerCase().includes(s));
  }, [catalog, q]);

  const row = (id: string): Row => rows[id] || { enabled: false, config: {}, saved: [] };
  const setField = (id: string, key: string, value: any) =>
    setRows((r) => ({ ...r, [id]: { ...row(id), config: { ...row(id).config, [key]: value } } }));
  const setEnabled = (id: string, enabled: boolean) => setRows((r) => ({ ...r, [id]: { ...row(id), enabled } }));

  const save = async (g: GatewayInfo) => {
    setBusy(`save:${g.id}`);
    const r = row(g.id);
    let error: any = null;
    if (scope === "shop") {
      ({ error } = await (supabase as any).rpc("save_tenant_gateway", { p_provider: g.id, p_enabled: r.enabled, p_config: r.config }));
      if (!error) qc.invalidateQueries({ queryKey: ["company-gateways"] });
    } else {
      const next = { ...(platform || {}), [g.id]: { ...r.config, enabled: r.enabled } };
      const { data: existing } = await (supabase as any).from("platform_settings").select("id").eq("key", "gateways").maybeSingle();
      ({ error } = existing
        ? await (supabase as any).from("platform_settings").update({ value: next, updated_at: new Date().toISOString() }).eq("key", "gateways")
        : await (supabase as any).from("platform_settings").insert({ key: "gateways", value: next }));
      if (!error) setPlatform(next);
    }
    setBusy("");
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else toast({ title: `${g.label} saved`, description: r.enabled ? "Switched on." : "Saved but switched off." });
  };

  const test = async (g: GatewayInfo) => {
    setBusy(`test:${g.id}`);
    const r = await payApi("test", { provider: g.id, scope });
    setBusy("");
    if (r?.ok) toast({ title: `${g.label} keys work` });
    else toast({ title: `${g.label} check failed`, description: r?.error || "Save the keys first", variant: "destructive" });
  };

  if (catLoading) return <p className="text-sm text-muted-foreground">Loading gateways…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          {scope === "shop"
            ? "Take card, mobile money and wallet payments in your country. Money goes straight to your own account with the gateway. Switch on as many as you need; the till shows them under “Pay online”."
            : "Extra ways for companies to pay for packages. Every switched-on gateway is offered on the Billing page next to M-Pesa."}
        </p>
        <SearchBox value={q} onChange={setQ} placeholder="Country or gateway…" className="w-full sm:w-60" />
      </div>
      {list.map((g) => {
        const r = row(g.id);
        const isOpen = open === g.id;
        const currency = String(r.config.currency || (g.currencies ? g.currencies[0] : baseCurrency));
        const needsRate = currency !== baseCurrency;
        return (
          <section key={g.id} className={cn("rounded-2xl border bg-card transition-colors", r.enabled ? "border-primary/40" : "border-border")}>
            <button type="button" onClick={() => setOpen(isOpen ? null : g.id)} className="flex w-full items-center gap-3 p-4 text-left">
              <BrandLogo id={g.id} name={g.label} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {g.label}
                  {r.enabled ? <Pill tone="success">On</Pill> : r.saved.length ? <Pill>Saved, off</Pill> : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{g.countries}</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.fields.map((f) => (
                    <Field key={f.key} label={f.label} hint={f.secret && r.saved.includes(f.key) ? "Saved. Leave empty to keep it." : undefined}>
                      {f.options ? (
                        <select className="fi" value={r.config[f.key] || f.options[0][0]} onChange={(e) => setField(g.id, f.key, e.target.value)} disabled={!canManage}>
                          {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : (
                        <input className={cn("fi", f.secret && "font-mono")} type={f.secret ? "password" : "text"} autoComplete="off"
                          placeholder={f.secret && r.saved.includes(f.key) ? "••••••••" : f.placeholder || ""}
                          value={r.config[f.key] || ""} onChange={(e) => setField(g.id, f.key, e.target.value.trim())} disabled={!canManage} />
                      )}
                    </Field>
                  ))}
                  <Field label="Charge in" hint={g.currencies ? `This gateway charges in ${g.currencies.join(" or ")}` : undefined}>
                    <select className="fi" value={currency} onChange={(e) => setField(g.id, "currency", e.target.value)} disabled={!canManage}>
                      {(g.currencies || CURRENCIES.map((c) => c.code)).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  {needsRate && (
                    <Field label={`1 ${currency} = how many ${baseCurrency}?`} hint="Used to convert the amount due. Update it when the rate moves.">
                      <input className="fi" type="number" min={0} step="any" value={r.config.rate || ""} onChange={(e) => setField(g.id, "rate", e.target.value)} disabled={!canManage} />
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={r.enabled} onChange={(e) => setEnabled(g.id, e.target.checked)} disabled={!canManage} />
                    Switch on
                  </label>
                  <span className="flex-1" />
                  <a href={SIGNUP[g.id]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Get an account <ExternalLink className="h-3 w-3" /></a>
                  {canManage && <Button variant="outline" size="sm" onClick={() => test(g)} disabled={!!busy}>{busy === `test:${g.id}` ? <OrbSpinner /> : <PlugZap />} Check keys</Button>}
                  {canManage && <Button size="sm" onClick={() => save(g)} disabled={!!busy}>{busy === `save:${g.id}` ? <OrbSpinner /> : <Save />} Save</Button>}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
