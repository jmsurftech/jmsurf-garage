import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Plus, Trash2, Upload, FileDown, AlertCircle, ClipboardPaste } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useData";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { LIQUOR_CATEGORIES } from "@/lib/businessType";
import { logActivity } from "@/lib/auditLog";
import { Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bulkColumns, NUMERIC_KEYS, listOf, mapHeader, readSheet, downloadTemplate } from "./bulkColumns";
import { OrbSpinner } from "@/components/orbs";

type Row = Record<string, string> & { _key: string };
const sb: any = supabase;
const blank = (defaults: Record<string, string>): Row => ({ _key: crypto.randomUUID(), ...defaults } as Row);

/**
 * Add many products at once: type them in, paste from Excel, or load a CSV /
 * Excel file, check the grid, then save. Columns follow the shop type.
 */
export default function BulkAddProducts({ open, onClose, defaultLocationId, existing, initialFile }: {
  open: boolean;
  onClose: () => void;
  defaultLocationId?: string;
  /** Products already in the shop, to catch duplicate barcodes. */
  existing: { name: string; barcode?: string | null; category?: string | null }[];
  initialFile?: File | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data: locations = [] } = useLocations();
  const { businessType } = useBusinessType();
  const { vatEnabled } = useVatEnabled();
  const { data: inv } = useInventorySettings();
  const cols = useMemo(() => bulkColumns(businessType, vatEnabled), [businessType, vatEnabled]);
  const defaults = useMemo<Record<string, string>>(() => ({
    unit: businessType === "liquor" ? "bottle" : "piece",
    reorder_level: "5",
    vat_rate: String((inv as any)?.default_vat_rate ?? 16),
    product_type: businessType === "clothing" ? "simple" : "",
  }), [businessType, inv]);

  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, () => blank(defaults)));
  const [branches, setBranches] = useState<Set<string>>(() => new Set(defaultLocationId && defaultLocationId !== "__all__" ? [defaultLocationId] : []));
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedFile = useRef<File | null>(null);

  // A file chosen from the Import button opens straight into the grid.
  useEffect(() => {
    if (open && initialFile && loadedFile.current !== initialFile) {
      loadedFile.current = initialFile;
      void loadFile(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);
  // Default to every branch when none was chosen yet.
  useEffect(() => {
    if (branches.size === 0 && locations.length) setBranches(new Set(locations.map((l: any) => l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations.length]);

  const categories = useMemo(() => {
    const set = new Set<string>(businessType === "liquor" ? LIQUOR_CATEGORIES : []);
    existing.forEach((p) => p.category && set.add(p.category));
    rows.forEach((r) => r.category && set.add(r.category));
    return Array.from(set).sort();
  }, [existing, rows, businessType]);

  const filled = rows.filter((r) => String(r.name || "").trim());

  // Row problems shown inline and blocking save.
  const errors = useMemo(() => {
    const out = new Map<string, string>();
    const known = new Set(existing.map((p) => String(p.barcode || "").trim()).filter(Boolean));
    const seen = new Set<string>();
    for (const r of filled) {
      const price = Number(r.price);
      const bc = String(r.barcode || "").trim();
      if (r.price === undefined || r.price === "" || !Number.isFinite(price) || price < 0) out.set(r._key, "Enter a selling price");
      else if ([...NUMERIC_KEYS].some((k) => r[k] !== undefined && r[k] !== "" && !Number.isFinite(Number(r[k])))) out.set(r._key, "A number field has text in it");
      else if ([...NUMERIC_KEYS].some((k) => Number(r[k]) < 0)) out.set(r._key, "Numbers cannot be negative");
      else if (bc && known.has(bc)) out.set(r._key, "This barcode is already on another product");
      else if (bc && seen.has(bc)) out.set(r._key, "Barcode repeated in this list");
      else if (businessType === "clothing" && ["sized", "sized_color"].includes(r.product_type) && listOf(r.sizes).length === 0) out.set(r._key, "Add the sizes, e.g. S, M, L");
      else if (businessType === "clothing" && r.product_type === "sized_color" && listOf(r.colors).length === 0) out.set(r._key, "Add the colours, e.g. Black, White");
      if (bc) seen.add(bc);
    }
    return out;
  }, [filled, existing, businessType]);

  const setCell = (key: string, col: string, value: string) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, [col]: value } : r)));
  const addRows = (n = 5) => setRows((rs) => [...rs, ...Array.from({ length: n }, () => blank(defaults))]);
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r._key !== key) : [blank(defaults)]));

  /** Pasting several cells from Excel fills the grid from that cell onwards. */
  const onPaste = (e: React.ClipboardEvent, rowIndex: number, colIndex: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l.length || i < a.length - 1);
    setRows((rs) => {
      const next = [...rs];
      lines.forEach((line, li) => {
        const cells = line.split("\t");
        const at = rowIndex + li;
        while (next.length <= at) next.push(blank(defaults));
        const r = { ...next[at] };
        cells.forEach((cell, ci) => { const col = cols[colIndex + ci]; if (col) r[col.key] = cell.trim(); });
        next[at] = r;
      });
      return next;
    });
  };

  async function loadFile(file: File) {
    try {
      const sheet = await readSheet(file);
      if (sheet.length < 2) { toast({ title: "The file has no product rows", variant: "destructive" }); return; }
      const map = mapHeader(sheet[0], cols);
      if (map.name === undefined) { toast({ title: "No Name column found", description: "Download the template to see the expected columns.", variant: "destructive" }); return; }
      const loaded = sheet.slice(1).filter((r) => String(r[map.name] ?? "").trim()).map((r) => {
        const row = blank(defaults);
        Object.entries(map).forEach(([k, i]) => { const v = r[i]; if (v !== undefined && v !== null && String(v).trim() !== "") row[k] = String(v).trim(); });
        return row;
      });
      setRows((rs) => [...rs.filter((r) => String(r.name || "").trim()), ...loaded]);
      toast({ title: `${loaded.length} rows loaded`, description: "Check them, then press Save." });
    } catch (e: any) {
      toast({ title: "Could not read the file", description: e.message, variant: "destructive" });
    }
  }

  const save = async () => {
    if (!profile?.tenant_id) return;
    if (filled.length === 0) { toast({ title: "Type at least one product", variant: "destructive" }); return; }
    if (errors.size) { toast({ title: `Fix ${errors.size} row${errors.size === 1 ? "" : "s"} first`, description: "They are marked in red.", variant: "destructive" }); return; }
    if (branches.size === 0) { toast({ title: "Choose at least one branch", variant: "destructive" }); return; }
    if (!navigator.onLine) { toast({ title: "Connect to the internet to add products in bulk", variant: "destructive" }); return; }
    setSaving(true);
    const prefix = String((inv as any)?.sku_prefix || "PRD").toUpperCase();
    const stamp = Date.now().toString(36).toUpperCase();
    const num = (v: string | undefined, d = 0) => (v === undefined || v === "" ? d : Number(v));
    const ok: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (let i = 0; i < filled.length; i += 25) {
      const chunk = filled.slice(i, i + 25);
      setProgress(`Saving ${Math.min(i + 25, filled.length)} of ${filled.length}…`);
      for (const [j, r] of chunk.entries()) {
        const id = crypto.randomUUID();
        const variantItem = businessType === "clothing" && ["sized", "sized_color"].includes(r.product_type);
        const stock = variantItem ? 0 : Math.max(0, num(r.stock));
        const reorder = Math.max(0, Math.round(num(r.reorder_level, 5)));
        const product: any = {
          id, tenant_id: profile.tenant_id,
          name: r.name.trim(), sku: `${prefix}-${stamp}${i + j}`,
          barcode: String(r.barcode || "").trim() || null,
          category: String(r.category || "").trim() || "Other", subcategory: "",
          price: num(r.price), cost_price: num(r.cost_price),
          stock: 0, reorder_level: reorder,
          unit: String(r.unit || defaults.unit).trim(),
          vat_rate: vatEnabled ? num(r.vat_rate, Number(defaults.vat_rate)) : 0,
          product_type: businessType === "clothing" ? r.product_type || "simple" : "simple",
          brand: businessType === "clothing" ? String(r.brand || "").trim() || null : null,
          bottle_size: businessType === "liquor" ? String(r.bottle_size || "").trim() || null : null,
          units_per_crate: businessType === "liquor" && r.units_per_crate ? Math.round(num(r.units_per_crate)) : null,
          crate_deposit: businessType === "liquor" ? num(r.crate_deposit) : 0,
          tot_price: businessType === "liquor" && r.tot_price ? num(r.tot_price) : null,
          tots_per_bottle: businessType === "liquor" && r.tots_per_bottle ? Math.round(num(r.tots_per_bottle)) : null,
        };
        const { error } = await sb.from("products").insert(product);
        if (error) { failed.push({ name: product.name, error: error.message }); continue; }

        const stockRows = [...branches].map((location_id) => ({ product_id: id, location_id, stock, reorder_level: reorder }));
        const { error: sErr } = await sb.from("product_stocks").upsert(stockRows, { onConflict: "product_id,location_id" });
        if (sErr) { failed.push({ name: product.name, error: `Saved, but branch stock failed: ${sErr.message}` }); continue; }

        if (variantItem) {
          const sizes = listOf(r.sizes);
          const colors = r.product_type === "sized_color" ? listOf(r.colors) : [""];
          const each = Math.max(0, Math.round(num(r.stock)));
          const variants = sizes.flatMap((size) => colors.map((color) => ({
            id: crypto.randomUUID(), tenant_id: profile.tenant_id, product_id: id,
            size, color: color || null, price: product.price, cost_price: product.cost_price,
            stock: each, reorder_level: reorder, is_active: true,
          })));
          const { error: vErr } = await sb.from("product_variants").insert(variants);
          if (vErr) { failed.push({ name: product.name, error: `Saved, but sizes/colours failed: ${vErr.message}` }); continue; }
        }
        ok.push(r._key);
      }
    }

    setSaving(false);
    setProgress("");
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-stocks"] });
    qc.invalidateQueries({ queryKey: ["product-variants"] });
    if (ok.length) logActivity({ action: "create", entity_type: "product", description: `Added ${ok.length} products in bulk` });
    if (failed.length) {
      setRows((rs) => rs.filter((r) => !ok.includes(r._key)));
      toast({ title: `${ok.length} added, ${failed.length} not saved`, description: failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join(" · "), variant: "destructive" });
    } else {
      toast({ title: `${ok.length} product${ok.length === 1 ? "" : "s"} added` });
      setRows(Array.from({ length: 5 }, () => blank(defaults)));
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={() => !saving && onClose()} size="full" icon={PackagePlus} title="Add products in bulk"
      description="Type or paste rows from Excel (click a cell and press Ctrl+V), or load a file. Empty rows are skipped."
      footer={<>
        {progress && <span className="mr-auto text-sm text-muted-foreground">{progress}</span>}
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || filled.length === 0}>{saving && <OrbSpinner />} Save {filled.length || ""} product{filled.length === 1 ? "" : "s"}</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload /> Load CSV / Excel</Button>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate(cols, businessType)}><FileDown /> Template</Button>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><ClipboardPaste className="h-3.5 w-3.5" /> Paste many rows at once into any cell</span>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Add to:</span>
            {locations.map((l: any) => (
              <label key={l.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", branches.has(l.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={branches.has(l.id)}
                  onChange={() => setBranches((b) => { const n = new Set(b); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} />
                {l.name}
              </label>
            ))}
          </div>
        </div>

        <datalist id="bulk-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
          <table className="dt">
            <thead>
              <tr>
                <th className="w-10 !px-2 text-center">#</th>
                {cols.map((c) => <th key={c.key} className={c.width} title={c.hint}>{c.label}{c.required && <span className="text-destructive"> *</span>}</th>)}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const err = errors.get(r._key);
                return (
                  <tr key={r._key} className={cn(err && "bg-destructive/5")}>
                    <td className="!px-2 text-center text-xs text-muted-foreground" title={err}>{err ? <AlertCircle className="mx-auto h-4 w-4 text-destructive" /> : ri + 1}</td>
                    {cols.map((c, ci) => (
                      <td key={c.key} className="!p-1">
                        {c.type === "select" ? (
                          <select className="fi h-9" value={r[c.key] || ""} onChange={(e) => setCell(r._key, c.key, e.target.value)}>
                            {c.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input className={cn("fi h-9", c.type === "number" && "text-right tabular-nums")} value={r[c.key] || ""}
                            inputMode={c.type === "number" ? "decimal" : undefined} placeholder={c.hint || ""}
                            list={c.key === "category" ? "bulk-categories" : undefined}
                            disabled={c.key === "colors" && r.product_type !== "sized_color" || (c.key === "sizes" && !["sized", "sized_color"].includes(r.product_type))}
                            onChange={(e) => setCell(r._key, c.key, e.target.value)} onPaste={(e) => onPaste(e, ri, ci)} />
                        )}
                      </td>
                    ))}
                    <td className="!px-1"><button className="icon-btn-danger" onClick={() => removeRow(r._key)} aria-label="Remove row"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => addRows(5)}><Plus /> 5 rows</Button>
            <Button variant="outline" size="sm" onClick={() => addRows(20)}><Plus /> 20 rows</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {filled.length} filled{errors.size ? ` · ${errors.size} need fixing (hover the red mark)` : ""}
            {businessType === "clothing" ? " · Sized items create one line for every size and colour" : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}
