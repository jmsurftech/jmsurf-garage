import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, ShieldCheck, X } from "lucide-react";
import { ClassPicker } from "@/components/books/KraClassPicker";
import { KRA_COUNTRIES, KRA_ITEM_TYPES, KRA_PACKAGING_UNITS, KRA_QUANTITY_UNITS, kraQtyUnitFor } from "@/lib/kraCodes";

export type EtimsItem = {
  etims_item_cls_cd: string; etims_tax_type: string; etims_item_type: string; etims_pkg_unit: string; etims_qty_unit: string; etims_origin: string;
};

/** Starting values for an item (saved ones, else from its VAT rate and unit). */
export function etimsItemDefaults(p: any, unit?: string | null): EtimsItem {
  return {
    etims_item_cls_cd: p?.etims_item_cls_cd || "", etims_tax_type: p?.etims_tax_type || "",
    etims_item_type: p?.etims_item_type || (p?.product_type === "service" ? "3" : "2"),
    etims_pkg_unit: p?.etims_pkg_unit || "NT", etims_qty_unit: p?.etims_qty_unit || kraQtyUnitFor(unit ?? p?.unit), etims_origin: p?.etims_origin || "KE",
  };
}

/** KRA tax type from the VAT rate when none is chosen: B 16%, E 8%, A exempt, C zero-rated, D non-VAT. */
export const autoTaxBand = (vat: string | number) => (Number(vat) >= 15 ? "B" : Number(vat) > 0 ? "E" : "A");
const BANDS: [string, string][] = [["B", "B · Standard 16%"], ["E", "E · Reduced 8%"], ["C", "C · Zero-rated"], ["A", "A · Exempt"], ["D", "D · Non-VAT"]];

/**
 * KRA eTIMS on the item form. Shown only when the company is connected to KRA: the item
 * classification is required, and the item is sent to KRA when it is saved.
 */
export function EtimsItemFields({ value, onChange, vatRate, connected, env = "prod", service, kraCode, kraError }: {
  value: EtimsItem; onChange: (v: EtimsItem) => void; vatRate: string | number; connected: boolean;
  env?: string; service?: boolean; kraCode?: string | null; kraError?: string | null;
}) {
  const [more, setMore] = useState(false);
  if (!connected) return null;
  const set = (k: keyof EtimsItem, v: string) => onChange({ ...value, [k]: v });
  const auto = autoTaxBand(vatRate);
  return (
    <section className="rounded-2xl border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-sm font-semibold">KRA eTIMS</h2>
        {kraCode ? <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Registered · <span className="font-mono">{kraCode}</span></span>
          : kraError ? <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive" title={kraError}><CircleAlert className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Not accepted by KRA</span></span>
          : <span className="text-xs text-muted-foreground">Sent to KRA when you save</span>}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label className="mb-1 block text-sm font-medium">Item classification <span className="text-destructive">*</span></label>
          {value.etims_item_cls_cd ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="flex-1 font-mono">{value.etims_item_cls_cd}</span>
              <button type="button" onClick={() => set("etims_item_cls_cd", "")} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Change classification"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <ClassPicker value="" env={env} placeholder="Search a KRA class or type the 10-digit code" onChange={(v) => set("etims_item_cls_cd", v)} />
          )}
          {kraError && <p className="mt-1 text-xs text-destructive">{kraError}</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">KRA tax type</label>
          <select className="fi" value={value.etims_tax_type} onChange={(e) => set("etims_tax_type", e.target.value)}>
            <option value="">{BANDS.find(([c]) => c === auto)?.[1]} (from VAT)</option>
            {BANDS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
      </div>
      <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center gap-1 border-t border-border px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} />
        More KRA details <span className="ml-1 font-normal">· {service ? "Service" : KRA_ITEM_TYPES.find((t) => t.code === value.etims_item_type)?.name} · {value.etims_pkg_unit}/{value.etims_qty_unit} · {value.etims_origin}</span>
      </button>
      {more && (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {!service && (
            <div>
              <label className="mb-1 block text-xs font-medium">Product type</label>
              <select className="fi" value={value.etims_item_type} onChange={(e) => set("etims_item_type", e.target.value)}>
                {KRA_ITEM_TYPES.filter((t) => t.code !== "3").map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium">Packaging unit</label>
            <select className="fi" value={value.etims_pkg_unit} onChange={(e) => set("etims_pkg_unit", e.target.value)}>{KRA_PACKAGING_UNITS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Quantity unit</label>
            <select className="fi" value={value.etims_qty_unit} onChange={(e) => set("etims_qty_unit", e.target.value)}>{KRA_QUANTITY_UNITS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Country of origin</label>
            <select className="fi" value={value.etims_origin} onChange={(e) => set("etims_origin", e.target.value)}>{KRA_COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </div>
        </div>
      )}
    </section>
  );
}
