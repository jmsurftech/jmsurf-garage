import { useEffect, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useBusinessSettings } from "@/hooks/useData";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Search, Package, Wrench, GripVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useProducts } from "@/hooks/useData";
import { cn } from "@/lib/utils";
import type { LineItem } from "@/lib/docModels";
import { useTaxSettings, vatChoices } from "@/lib/tax";
import { TraceLink, type LineLot } from "@/components/books/TracePicker";

export interface EditLine extends LineItem {
  key: string;
  quantity: number;
  rate: number;
  discount: number;
  tax_rate: number;
  lots?: LineLot[] | null;
  serials?: string[] | null;
}

/** Number box where zero is a grey placeholder: nothing to delete before typing. */
export function NumField({ value, onValue, ...rest }: { value: number; onValue: (n: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => { if ((Number(text) || 0) !== (Number(value) || 0)) setText(value ? String(value) : ""); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input type="number" inputMode="decimal" placeholder="0" {...rest} value={text} onChange={(e) => { setText(e.target.value); onValue(Number(e.target.value) || 0); }} />;
}

/** Text box that grows with its text (and when its column gets narrower), so the whole text always shows. */
export function AutoGrowText({ value, ...rest }: { value: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <textarea ref={ref} rows={1} value={value} {...rest} style={{ overflow: "hidden", ...(rest.style || {}) }} />;
}

/** Services (and service items) carry no stock. */
export const isServiceItem = (p: any) => !!p && (p._type === "service" || p.product_type === "service");

export const newLine = (): EditLine => ({ key: Math.random().toString(36).slice(2), name: "", description: "", quantity: 1, rate: 0, discount: 0, tax_rate: 0 });

/** Normalises stored lines (old {name, quantity, price} shape included) for editing. */
export function toEditLines(items: unknown): EditLine[] {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((l: any) => ({
    key: Math.random().toString(36).slice(2),
    item_id: l.item_id ?? l.product_id ?? null,
    type: l.type ?? "product",
    name: l.name ?? "",
    description: l.description ?? "",
    unit: l.unit ?? null,
    quantity: Number(l.quantity ?? l.qty ?? 1) || 0,
    rate: Number(l.rate ?? l.price ?? l.unit_price ?? 0) || 0,
    discount: Number(l.discount ?? 0) || 0,
    tax_rate: Number(l.tax_rate ?? 0) || 0,
    lots: Array.isArray(l.lots) && l.lots.length ? l.lots : null,
    serials: Array.isArray(l.serials) && l.serials.length ? l.serials : null,
  }));
}

/** What is saved on the document row. */
export const toStoredLines = (lines: EditLine[]) =>
  lines.filter((l) => String(l.name || "").trim()).map(({ key: _k, ...l }) => ({
    item_id: l.item_id ?? null, type: l.type ?? "product", name: String(l.name).trim(), description: l.description || "",
    unit: l.unit ?? null, quantity: l.quantity, rate: l.rate, price: l.rate, discount: l.discount, tax_rate: l.tax_rate,
    amount: Math.round(l.quantity * l.rate * (1 - l.discount / 100) * 100) / 100,
    ...(l.lots?.length ? { lots: l.lots } : {}), ...(l.serials?.length ? { serials: l.serials } : {}),
  }));

const lineAmount = (l: EditLine) => l.quantity * l.rate * (1 - Math.min(100, Math.max(0, l.discount)) / 100);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Picks a product or service from the shop's catalogue. */
function ItemPicker({ value, onPick, onType, side = "sale" }: { value: string; onPick: (item: any) => void; onType: (name: string) => void; side?: "sale" | "purchase" }) {
  const [open, setOpen] = useState(false);
  const tenantId = useTenantId();
  const { data: products = [] } = useProducts();
  const { data: services = [] } = useQuery({
    queryKey: ["services", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await (supabase as any).from("services").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name")).data || [],
  });
  // Items with Sales (or Purchase) Information switched off are left out of sales (or purchase) documents.
  const usable = (x: any) => (side === "purchase" ? x.purchase_enabled !== false : x.sales_enabled !== false);
  const goods = (products as any[]).filter((x) => usable(x) && x.product_type !== "service");
  const svc = [...(products as any[]).filter((x) => usable(x) && x.product_type === "service").map((x) => ({ ...x, _type: "product" })), ...(services as any[]).filter(usable).map((x) => ({ ...x, _type: "service" }))]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm hover:border-input", !value && "text-muted-foreground")}>
          <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
          {/* The full item name shows, wrapping onto more lines when it is long. */}
          <span className="min-w-0 whitespace-normal break-words font-medium">{value || "Type or click to select an item."}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,92vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products and services…" onValueChange={(v) => onType(v)} />
          <CommandList>
            <CommandEmpty>No match. The typed name is used as a one-off item.</CommandEmpty>
            <CommandGroup heading="Products">
              {goods.slice(0, 200).map((p) => (
                <CommandItem key={p.id} value={`p ${p.name} ${p.sku || ""} ${p.barcode || ""}`} onSelect={() => { onPick({ ...p, _type: "product" }); setOpen(false); }}>
                  <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">Stock {Number(p.stock ?? 0)} · {money(Number(p.price || 0))}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {svc.length > 0 && (
              <CommandGroup heading="Services">
                {svc.map((s) => (
                  <CommandItem key={s.id} value={`s ${s.name}`} onSelect={() => { onPick(s); setOpen(false); }}>
                    <Wrench className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{money(Number(s.price || 0))}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export interface Adjustments { discount: number; shipping: number; adjustment: number }

/** Item table with the totals box under it. */
export function ItemTable({
  lines, onChange, adjustments, onAdjustments, defaultVat = 16, currency = "KES", priceField = "price", productsOnly, rateFor, tracing, stockLocationId, inclusive = false, onInclusive,
}: {
  /** Invoices: choose the batches and serial numbers each line sells. */
  tracing?: boolean;
  stockLocationId?: string | null;
  /** Customer price list: the rate for a picked item (null = its normal price). */
  rateFor?: (itemId: string) => Promise<number | null>;
  /** Which price fills the rate when an item is picked: selling price, or cost for purchases. */
  priceField?: "price" | "cost_price";
  productsOnly?: boolean;
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  adjustments: Adjustments;
  onAdjustments: (a: Adjustments) => void;
  defaultVat?: number;
  currency?: string;
  /** Prices include VAT (VAT is taken out of each line). */
  inclusive?: boolean;
  onInclusive?: (v: boolean) => void;
}) {
  const { data: catalogue = [] } = useProducts();
  const productOf = (id?: string | null) => (id ? (catalogue as any[]).find((p) => p.id === id) : null);
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : [newLine()]);
  // The rates from System → Taxes (VAT).
  const taxSet = useTaxSettings();
  // Items preferences: warn when a sale takes an item below zero stock.
  const { data: bizIt } = useBusinessSettings();
  const itemPrefs = ((bizIt as any)?.items_prefs || {}) as { track_inventory?: boolean; out_of_stock_warning?: boolean; negative_stock?: string };
  const warnStock = priceField === "price" && itemPrefs.track_inventory !== false && (itemPrefs.out_of_stock_warning !== false || itemPrefs.negative_stock === "block");
  const taxOptions = useMemo(() => vatChoices(taxSet), [taxSet]);
  void defaultVat;

  const subtotal = lines.reduce((a, l) => a + lineAmount(l), 0);
  const taxByRate = new Map<number, number>();
  for (const l of lines) if (l.tax_rate > 0) taxByRate.set(l.tax_rate, (taxByRate.get(l.tax_rate) || 0) + lineTax(lineAmount(l), l.tax_rate, inclusive));
  const tax = [...taxByRate.values()].reduce((a, b) => a + b, 0);
  const total = subtotal + (inclusive ? 0 : tax) - adjustments.discount + adjustments.shipping + adjustments.adjustment;

  return (
    <div className="space-y-4">
      {onInclusive && (
        <div className="flex justify-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Prices are</span>
            <select className="fi h-9 w-auto" value={inclusive ? "inclusive" : "exclusive"} onChange={(e) => onInclusive(e.target.value === "inclusive")} aria-label="Prices include VAT or not">
              <option value="exclusive">Tax Exclusive (VAT added on top)</option>
              <option value="inclusive">Tax Inclusive (VAT included)</option>
            </select>
          </label>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
          <p className="text-sm font-semibold">Item Table</p>
        </div>
        {/* Own layout (not the automatic table fitting): the number, tax and amount columns keep a fixed width that
            fits their values, and long item names or descriptions wrap in the item column instead of squeezing them. */}
        {/* No height limit: every line shows in the form (list tables elsewhere scroll inside their own box). */}
        <div className="overflow-x-auto" data-fit-off style={{ maxHeight: "none" }}>
          <table className="dt-phone dt-items w-full min-w-[860px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: 24 }} />
              <col />
              <col style={{ width: 84 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 204 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th />
                <th className="px-3 py-2 text-left">Item details</th>
                <th className="px-3 py-2 text-right">Quantity</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-left">Tax</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-b border-border align-top last:border-b-0">
                  <td className="pl-2 pt-3 text-muted-foreground/40"><GripVertical className="h-4 w-4" /></td>
                  <td className="px-2 py-2">
                    <ItemPicker
                      value={String(l.name || "")}
                      side={priceField === "cost_price" ? "purchase" : "sale"}
                      onType={(name) => set(i, { name, item_id: null })}
                      onPick={(item) => {
                        set(i, {
                          lots: null, serials: null,
                          item_id: item.id, type: item._type, name: item.name, unit: item.unit ?? null,
                          description: (priceField === "cost_price" ? item.purchase_description || item.description : item.description) ?? l.description ?? "",
                          rate: Number(priceField === "cost_price" ? (item.cost_price ?? item.price) : item.price) || 0,
                          tax_rate: Number(item.vat_rate ?? 0) > 0 ? Number(item.vat_rate) : 0,
                        });
                        if (rateFor && item.id) void rateFor(item.id).then((r) => { if (r !== null && r !== undefined) onChange(lines.map((x, idx) => (idx === i ? { ...x, item_id: item.id, type: item._type, name: item.name, unit: item.unit ?? null, description: item.description ?? x.description ?? "", rate: Number(r), tax_rate: Number(item.vat_rate ?? 0) > 0 ? Number(item.vat_rate) : 0 } : x))); });
                      }}
                    />
                    <AutoGrowText
                      value={l.description || ""}
                      onChange={(e) => set(i, { description: e.target.value })}
                      placeholder="Add a description to your item"
                      className="mt-1 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs text-muted-foreground placeholder:text-muted-foreground/60 hover:border-input focus:border-primary focus:outline-none"
                    />
                    {tracing && l.type !== "service" && productOf(l.item_id) && (
                      <TraceLink product={productOf(l.item_id)} quantity={l.quantity} lots={l.lots} serials={l.serials} locationId={stockLocationId}
                        onChange={(p) => set(i, p)} />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <NumField min={0} step="any" value={l.quantity} onValue={(n) => set(i, { quantity: n })} className="fi h-9 w-full min-w-0 text-right" aria-label="Quantity" />
                    {l.unit && <p className="mt-1 text-right text-[11px] text-muted-foreground">{l.unit}</p>}
                    {warnStock && (() => { const p = productOf(l.item_id); return p && !isServiceItem(p) && l.quantity > Number(p.stock ?? 0) ? <p className="mt-1 text-right text-[11px] font-semibold text-destructive">Only {Number(p.stock ?? 0)} in stock</p> : null; })()}
                  </td>
                  <td className="px-2 py-2">
                    <NumField min={0} step="any" value={l.rate} onValue={(n) => set(i, { rate: n })} className="fi h-9 w-full min-w-0 text-right tabular-nums" aria-label="Rate" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="relative">
                      <NumField min={0} max={100} step="any" value={l.discount} onValue={(n) => set(i, { discount: Math.min(100, n) })} className="fi h-9 w-full min-w-0 pr-6 text-right" aria-label="Discount percent" />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <select value={l.tax_rate} onChange={(e) => set(i, { tax_rate: Number(e.target.value) })} className="fi h-9 w-full min-w-0 pl-2.5 pr-7 text-[13px]" aria-label="Tax">
                      {!taxOptions.some((o) => o.v === l.tax_rate) && <option value={l.tax_rate}>VAT [{l.tax_rate}%]</option>}
                      {taxOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 pt-4 text-right font-semibold tabular-nums">{money(lineAmount(l))}</td>
                  <td className="pr-2 pt-2.5">
                    <button type="button" onClick={() => remove(i)} className="icon-btn-danger" aria-label="Remove row"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button type="button" onClick={() => onChange([...lines, newLine()])}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15">
        <Plus className="h-4 w-4" /> Add New Row
      </button>

      <div className="flex justify-end">
        <div className="w-full max-w-md space-y-2 rounded-xl bg-muted/50 p-4 text-sm">
          <div className="flex justify-between"><span className="font-medium">Sub Total{inclusive && <span className="block text-xs font-normal text-muted-foreground">(VAT Inclusive)</span>}</span><span className="tabular-nums">{money(subtotal)}</span></div>
          {[...taxByRate.entries()].sort((a, b) => b[0] - a[0]).map(([r, v]) => (
            <div key={r} className="flex justify-between text-muted-foreground"><span>VAT [{r}%]</span><span className="tabular-nums">{money(v)}</span></div>
          ))}
          {([["discount", "Discount"], ["shipping", "Shipping Charges"], ["adjustment", "Adjustment"]] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <div className="flex items-center gap-2">
                <NumField step="any" value={adjustments[k]} onValue={(n) => onAdjustments({ ...adjustments, [k]: n })}
                  className="fi h-8 w-28 text-right" aria-label={label} />
                <span className="w-24 text-right tabular-nums">{k === "discount" && adjustments.discount ? `-${money(adjustments.discount)}` : money(adjustments[k])}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <span>Total ( {currency} )</span><span className="tabular-nums">{money(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Totals for saving (same maths as the table). */
/** VAT on a line: added on top (16% of the amount), or taken out of a VAT-inclusive amount (16/116 of it). */
export const lineTax = (amount: number, rate: number, inclusive = false) => (rate > 0 ? (inclusive ? (amount * rate) / (100 + rate) : (amount * rate) / 100) : 0);

export function editTotals(lines: EditLine[], a: Adjustments, inclusive = false) {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const tax = lines.reduce((s, l) => s + lineTax(lineAmount(l), l.tax_rate, inclusive), 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { subtotal: r(subtotal), tax: r(tax), total: r(subtotal + (inclusive ? 0 : tax) - a.discount + a.shipping + a.adjustment) };
}
