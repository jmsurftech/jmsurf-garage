import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags, Plus, Trash2, Search, Percent, ListOrdered, Layers, PackagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, TableWrap } from "@/components/kit";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const money = (n: number) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useProducts() {
  return useQuery({ queryKey: ["pl-products"], queryFn: async () => ((await sb.from("products").select("id,name,sku,price,cost_price,product_type,is_composite,unit").eq("is_active", true).order("name").limit(5000)).data || []) as any[] });
}

/* ---------------------------------------------------------------- price lists */

/** Products & Services → Price Lists: special rates for groups of customers. */
export default function PriceLists() {
  const qc = useQueryClient();
  const { data: lists = [] } = useQuery({ queryKey: ["price-lists-full"], queryFn: async () => ((await sb.from("price_lists").select("*").order("name")).data || []) as any[] });
  const { data: counts = [] } = useQuery({ queryKey: ["price-list-customers"], queryFn: async () => ((await sb.from("customers").select("price_list_id").not("price_list_id", "is", null).limit(20000)).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["price-lists-full"] }); void qc.invalidateQueries({ queryKey: ["price-lists"] }); };
  return (
    <div className="space-y-6">
      <PageHeader title="Price Lists" icon={Tags} description="Wholesale, distributor or VIP prices. Give a customer a price list and their quotes, sales orders and invoices use it automatically."
        actions={<button onClick={() => setEdit({ name: "", kind: "percent", percent: -10, round_to: 0, is_active: true })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New price list</button>} />
      <Panel flush>
        {!lists.length ? <EmptyState icon={Tags} title="No price lists yet" description="Create one, e.g. Wholesale at 10% off, then pick it on a customer." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Name</th><th>Type</th><th>Rule</th><th>Customers</th><th>Status</th></tr></thead><tbody>
            <PagedRows rows={lists} colSpan={5}>{(pageRows) => pageRows.map((l) => (
              <tr key={l.id} onClick={() => setEdit(l)} className="cursor-pointer hover:bg-muted/40">
                <td className="font-semibold">{l.name}</td>
                <td>{l.kind === "percent" ? "Percentage" : "Per item"}</td>
                <td>{l.kind === "percent" ? `${Number(l.percent) > 0 ? "+" : ""}${Number(l.percent)}% on every item${Number(l.round_to) ? `, rounded to ${l.round_to}` : ""}` : "Own rate per item"}</td>
                <td className="tabular-nums">{counts.filter((c) => c.price_list_id === l.id).length}</td>
                <td>{l.is_active ? <Pill tone="success">Active</Pill> : <Pill>Off</Pill>}</td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {edit && <PriceListEditor list={edit} onClose={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function PriceListEditor({ list, onClose }: { list: any; onClose: () => void }) {
  const [f, setF] = useState(list);
  const [q, setQ] = useState("");
  const [rates, setRates] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: products = [] } = useProducts();
  useQuery({
    queryKey: ["price-list-items", list.id], enabled: !!list.id,
    queryFn: async () => { const rows = ((await sb.from("price_list_items").select("product_id,rate").eq("price_list_id", list.id)).data || []) as any[]; setRates(Object.fromEntries(rows.map((r) => [r.product_id, String(r.rate)]))); return rows; },
  });
  const shown = useMemo(() => products.filter((p) => !q.trim() || `${p.name} ${p.sku || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 300), [products, q]);
  const save = async () => {
    if (!String(f.name || "").trim()) return toast.error("Give the price list a name");
    setBusy(true);
    try {
      const row = { name: f.name.trim(), kind: f.kind, percent: Number(f.percent) || 0, round_to: Number(f.round_to) || 0, description: f.description || null, is_active: f.is_active !== false, updated_at: new Date().toISOString() };
      const { data, error } = list.id ? await sb.from("price_lists").update(row).eq("id", list.id).select("id").single() : await sb.from("price_lists").insert(row).select("id").single();
      if (error) throw error;
      if (f.kind === "items" && rates) {
        await sb.from("price_list_items").delete().eq("price_list_id", data.id);
        const items = Object.entries(rates).filter(([, v]) => String(v).trim() !== "" && Number(v) >= 0).map(([product_id, v]) => ({ price_list_id: data.id, product_id, rate: Number(v) }));
        for (let i = 0; i < items.length; i += 500) { const { error: e2 } = await sb.from("price_list_items").insert(items.slice(i, i + 500)); if (e2) throw e2; }
      }
      toast.success("Price list saved"); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete ${list.name}?`, message: "Customers on it go back to standard prices. Past documents keep their rates.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("price_lists").delete().eq("id", list.id);
    if (error) return toast.error(friendlyError(error));
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="xl" title={list.id ? list.name : "New price list"} icon={Tags}
      footer={<>{list.id && <button onClick={() => void remove()} className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /> Delete</button>}
        <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button>
        <button disabled={busy} onClick={() => void save()} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Wholesale" /></Field>
          <Field label="Status"><select className="fi" value={f.is_active === false ? "off" : "on"} onChange={(e) => setF({ ...f, is_active: e.target.value === "on" })}><option value="on">Active</option><option value="off">Off</option></select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[["percent", "Percentage on every item", Percent], ["items", "Own rate per item", ListOrdered]].map(([k, l, I]: any) => (
            <button key={k} onClick={() => setF({ ...f, kind: k })} className={cn("flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-medium", f.kind === k ? "border-primary bg-primary/5 text-primary" : "border-border")}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
        {f.kind === "percent" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mark up (+) or down (−) %" hint="e.g. −10 for 10% off, 15 for 15% more"><input className="fi" type="number" step="0.1" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>
            <Field label="Round to the nearest" hint="0 = no rounding, 5 = nearest 5 shillings"><input className="fi" type="number" min={0} value={f.round_to} onChange={(e) => setF({ ...f, round_to: e.target.value })} /></Field>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" /></div>
            <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Standard</th><th className="w-40 px-3 py-2 text-right">List rate</th></tr></thead><tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t border-border"><td className="px-3 py-1.5">{p.name}{p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}</td><td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{money(p.price)}</td>
                    <td className="px-3 py-1"><input className="fi h-8 text-right" type="number" min={0} step="any" value={rates?.[p.id] ?? ""} onChange={(e) => setRates({ ...(rates || {}), [p.id]: e.target.value })} placeholder="—" /></td></tr>
                ))}
              </tbody></table>
            </div>
            <p className="text-xs text-muted-foreground">Leave a rate empty to use the item's standard price.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- composite items */

/** Products & Services → Composite Items: kits and bundles that take their components out of stock when sold. */
export function CompositeItems() {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: comps = [] } = useQuery({ queryKey: ["composite-components"], queryFn: async () => ((await sb.from("composite_components").select("id,product_id,component_id,quantity").limit(20000)).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const kits = products.filter((p) => p.is_composite);
  const byId = new Map(products.map((p) => [p.id, p]));
  const cost = (id: string): number => comps.filter((c) => c.product_id === id).reduce((a, c) => a + Number(c.quantity) * (byId.get(c.component_id)?.is_composite ? cost(c.component_id) : Number(byId.get(c.component_id)?.cost_price || 0)), 0);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["pl-products"] }); void qc.invalidateQueries({ queryKey: ["composite-components"] }); };
  return (
    <div className="space-y-6">
      <PageHeader title="Composite Items" icon={Layers} description="Kits, bundles and hampers made of other items. Selling one (invoice or point of sale) takes its components out of stock and costs it at their cost."
        actions={<button onClick={() => setEdit({ name: "", sku: "", price: "", lines: [{ component_id: "", quantity: 1 }] })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New composite item</button>} />
      <Panel flush>
        {!kits.length ? <EmptyState icon={PackagePlus} title="No composite items yet" description="Create a kit, e.g. a Starter Pack of 2 × Part A and 1 × Part B." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Item</th><th>Components</th><th className="text-right">Cost</th><th className="text-right">Price</th><th className="text-right">Margin</th></tr></thead><tbody>
            <PagedRows rows={kits} colSpan={5}>{(pageRows) => pageRows.map((k) => {
              const c = cost(k.id);
              return (
                <tr key={k.id} onClick={() => setEdit({ ...k, lines: comps.filter((x) => x.product_id === k.id).map((x) => ({ component_id: x.component_id, quantity: x.quantity })) })} className="cursor-pointer hover:bg-muted/40">
                  <td className="font-semibold">{k.name}{k.sku && <span className="ml-2 text-xs font-normal text-muted-foreground">{k.sku}</span>}</td>
                  <td className="text-sm text-muted-foreground">{comps.filter((x) => x.product_id === k.id).map((x) => `${Number(x.quantity)} × ${byId.get(x.component_id)?.name || "?"}`).join(", ")}</td>
                  <td className="text-right tabular-nums">{money(c)}</td><td className="text-right tabular-nums">{money(k.price)}</td>
                  <td className="text-right tabular-nums">{Number(k.price) > 0 ? `${Math.round(((Number(k.price) - c) / Number(k.price)) * 100)}%` : "—"}</td>
                </tr>
              );
            })}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {edit && <CompositeEditor item={edit} products={products} onClose={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function CompositeEditor({ item, products, onClose }: { item: any; products: any[]; onClose: () => void }) {
  const [f, setF] = useState({ ...item, price: String(item.price ?? "") });
  const [busy, setBusy] = useState(false);
  const choices = products.filter((p) => p.id !== item.id && p.product_type !== "service");
  const setLine = (i: number, patch: any) => setF({ ...f, lines: f.lines.map((l: any, j: number) => (j === i ? { ...l, ...patch } : l)) });
  const save = async () => {
    const lines = f.lines.filter((l: any) => l.component_id && Number(l.quantity) > 0);
    if (!String(f.name || "").trim()) return toast.error("Name the composite item");
    if (!lines.length) return toast.error("Add at least one component");
    setBusy(true);
    try {
      let id = item.id;
      if (id) {
        const { error } = await sb.from("products").update({ name: f.name.trim(), sku: f.sku || null, price: Number(f.price) || 0, is_composite: true }).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("products").insert({ name: f.name.trim(), sku: f.sku || `KIT-${Date.now().toString(36).toUpperCase()}`, price: Number(f.price) || 0, cost_price: 0, category: "Kits", product_type: "product", is_composite: true, unit: "piece" }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      await sb.from("composite_components").delete().eq("product_id", id);
      const { error: e2 } = await sb.from("composite_components").insert(lines.map((l: any) => ({ product_id: id, component_id: l.component_id, quantity: Number(l.quantity) })));
      if (e2) throw e2;
      toast.success("Composite item saved"); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={item.id ? item.name : "New composite item"} icon={Layers}
      footer={<><button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={() => void save()} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3"><Field label="Name" required><input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Starter pack" /></Field></div>
          <Field label="SKU"><input className="fi" value={f.sku || ""} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          <Field label="Selling price"><input className="fi" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Components</p>
          {f.lines.map((l: any, i: number) => (
            <div key={i} className="flex gap-2">
              <select className="fi flex-1" value={l.component_id} onChange={(e) => setLine(i, { component_id: e.target.value })}>
                <option value="">Choose an item…</option>
                {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
              <input className="fi w-24 text-right" type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" />
              <button onClick={() => setF({ ...f, lines: f.lines.filter((_: any, j: number) => j !== i) })} className="icon-btn-danger" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={() => setF({ ...f, lines: [...f.lines, { component_id: "", quantity: 1 }] })} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><Plus className="h-4 w-4" /> Add component</button>
        </div>
      </div>
    </Modal>
  );
}
