import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Percent, Plus, Trash2, Landmark, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useBusinessSettings } from "@/hooks/useData";
import { useTenantId } from "@/hooks/useTenantId";
import { resolveTax, type TaxSettings } from "@/lib/tax";
import { friendlyError } from "@/lib/friendlyError";

/** System → Taxes (VAT): VAT rates, VAT settings and withholding VAT. */
export default function TaxTab({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const [t, setT] = useState<TaxSettings>(() => resolveTax(null));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setT(resolveTax((biz as any)?.tax_settings, biz)); }, [biz]);

  const up = (patch: Partial<TaxSettings>) => setT((x) => ({ ...x, ...patch }));
  const setRate = (i: number, patch: Partial<TaxSettings["rates"][number]>) => up({ rates: t.rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    if (!tenantId) return;
    if (t.rates.some((r) => !r.name.trim() || r.rate < 0 || r.rate > 100)) return toast.error("Every VAT rate needs a name and a rate between 0 and 100.");
    setBusy(true);
    const { error } = await (supabase as any).from("business_settings").update({
      tax_settings: t,
      vat_number: t.regNumber || null,
      default_vat_rate: t.registered ? t.defaultRate : 0,
    }).eq("tenant_id", tenantId);
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["business-settings", tenantId] });
    toast.success("Tax settings saved");
  };

  const off = !canManage;
  return (
    <div className="space-y-5">
      <Panel title="VAT rates" icon={Percent} description="The rates you can pick on items, invoices, bills and every other document.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3">VAT name</th><th className="py-2 pr-3">Rate (%)</th><th className="py-2 pr-3">Default</th><th className="py-2 pr-3">Active</th><th /></tr></thead>
            <tbody>
              {t.rates.map((r, i) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-3"><input className="fi h-9" value={r.name} disabled={off} onChange={(e) => setRate(i, { name: e.target.value })} /></td>
                  <td className="py-2 pr-3"><input className="fi h-9 w-24" type="number" min={0} max={100} step="0.01" value={r.rate} disabled={off} onChange={(e) => setRate(i, { rate: Number(e.target.value) })} /></td>
                  <td className="py-2 pr-3"><input type="radio" name="default-vat" className="h-4 w-4 accent-primary" checked={t.defaultRate === r.rate} disabled={off || !r.active} onChange={() => up({ defaultRate: r.rate })} aria-label={`Make ${r.name} the default`} /></td>
                  <td className="py-2 pr-3"><Switch checked={r.active} disabled={off} onCheckedChange={(v) => setRate(i, { active: v })} aria-label={`${r.name} active`} /></td>
                  <td className="py-2 text-right">{canManage && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Delete ${r.name}`} onClick={() => up({ rates: t.rates.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => up({ rates: [...t.rates, { id: `r${Date.now()}`, name: "", rate: 0, active: true }] })}><Plus className="h-4 w-4" /> New VAT rate</Button>}
        <p className="mt-2 text-xs text-muted-foreground">New items and document lines start with the default rate. A line can always be marked Non-taxable.</p>
      </Panel>

      <Panel title="VAT settings" icon={Landmark} description="Your VAT registration. When you are not registered, documents carry no VAT.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <span><span className="block text-sm font-medium">Is your business registered for VAT?</span><span className="block text-xs text-muted-foreground">{t.registered ? "Yes: VAT rates show on items and documents." : "No: every line is non-taxable."}</span></span>
            <Switch checked={t.registered} disabled={off} onCheckedChange={(v) => up({ registered: v })} aria-label="Registered for VAT" />
          </div>
          {t.registered && (
            <>
              <Field label="VAT registration number label"><input className="fi" value={t.regLabel} disabled={off} onChange={(e) => up({ regLabel: e.target.value })} placeholder="PIN" /></Field>
              <Field label="VAT registration number"><input className="fi" value={t.regNumber} disabled={off} onChange={(e) => up({ regNumber: e.target.value.toUpperCase() })} placeholder="P051234567X" /></Field>
              <Field label="VAT registered on"><input className="fi" type="date" value={t.registeredOn || ""} disabled={off} onChange={(e) => up({ registeredOn: e.target.value || null })} /></Field>
              <Field label="Generate first tax return from"><input className="fi" type="date" value={t.firstReturnFrom || ""} disabled={off} onChange={(e) => up({ firstReturnFrom: e.target.value || null })} /></Field>
              <Field label="Reporting period">
                <select className="fi" value={t.period} disabled={off} onChange={(e) => up({ period: e.target.value as TaxSettings["period"] })}>
                  <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Every six months</option><option value="yearly">Yearly</option>
                </select>
              </Field>
              <Field label="New documents start with prices" hint="Each quote, invoice, credit note, purchase order and bill can still switch.">
                <select className="fi" value={t.pricesIncludeTax ? "inclusive" : "exclusive"} disabled={off} onChange={(e) => up({ pricesIncludeTax: e.target.value === "inclusive" })}>
                  <option value="exclusive">Tax Exclusive (VAT added on top)</option>
                  <option value="inclusive">Tax Inclusive (VAT included in the price)</option>
                </select>
              </Field>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Withholding VAT" icon={HandCoins} description="VAT withheld by the payer (e.g. 2% by government bodies). Turn it on per customer or vendor.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <span className="text-sm font-medium">Withholding VAT</span>
            <Switch checked={t.withholding.enabled} disabled={off} onCheckedChange={(v) => up({ withholding: { ...t.withholding, enabled: v } })} aria-label="Withholding VAT" />
          </div>
          {t.withholding.enabled && (
            <>
              <Field label="Rate (%)"><input className="fi" type="number" min={0} max={100} step="0.01" value={t.withholding.rate} disabled={off} onChange={(e) => up({ withholding: { ...t.withholding, rate: Number(e.target.value) } })} /></Field>
              <Field label="Applies to">
                <select className="fi" value={t.withholding.appliesTo} disabled={off} onChange={(e) => up({ withholding: { ...t.withholding, appliesTo: e.target.value as any } })}>
                  <option value="customers">Customers</option><option value="vendors">Vendors</option><option value="both">Customers and vendors</option>
                </select>
              </Field>
            </>
          )}
        </div>
      </Panel>

      {canManage && <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save tax settings"}</Button></div>}
    </div>
  );
}
