import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PencilLine, Wand2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { logActivity } from "@/lib/auditLog";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bulkColumns, NUMERIC_KEYS } from "./bulkColumns";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;
type Row = Record<string, string>;

const toRow = (p: any, keys: string[]): Row =>
  Object.fromEntries(keys.map((k) => [k, p[k] === null || p[k] === undefined ? "" : String(p[k])]));

/** Edit many products in one grid, or change them all at once. */
export default function BulkEditProducts({ open, onClose, productIds }: { open: boolean; onClose: () => void; productIds: string[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { businessType } = useBusinessType();
  const { vatEnabled } = useVatEnabled();
  const cols = useMemo(() => bulkColumns(businessType, vatEnabled).filter((c) => !c.addOnly), [businessType, vatEnabled]);
  const keys = cols.map((c) => c.key);

  const [original, setOriginal] = useState<Record<string, Row>>({});
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // "Apply to all" tools
  const [setCategory, setSetCategory] = useState("");
  const [priceField, setPriceField] = useState<"price" | "cost_price">("price");
  const [priceMode, setPriceMode] = useState<"pct_up" | "pct_down" | "add" | "sub" | "set">("pct_up");
  const [priceValue, setPriceValue] = useState("");
  const [setVat, setSetVat] = useState("");
  const [setReorder, setSetReorder] = useState("");
  const [setUnit, setSetUnit] = useState("");

  useEffect(() => {
    if (!open || productIds.length === 0) return;
    setLoading(true);
    sb.from("products").select("*").in("id", productIds).then(({ data, error }: any) => {
      setLoading(false);
      if (error) { toast({ title: "Could not load products", description: error.message, variant: "destructive" }); return; }
      const byId: Record<string, Row> = {};
      (data || []).forEach((p: any) => { byId[p.id] = toRow(p, keys); });
      setOriginal(byId);
      setRows(JSON.parse(JSON.stringify(byId)));
      setOrder((data || []).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))).map((p: any) => p.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productIds.join(",")]);

  const setCell = (id: string, k: string, v: string) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));
  const changedIds = order.filter((id) => keys.some((k) => (rows[id]?.[k] ?? "") !== (original[id]?.[k] ?? "")));

  const applyAll = () => {
    const n = Number(priceValue);
    setRows((prev) => {
      const next = { ...prev };
      for (const id of order) {
        const r = { ...next[id] };
        if (setCategory.trim()) r.category = setCategory.trim();
        if (priceValue !== "" && Number.isFinite(n)) {
          const cur = Number(r[priceField]) || 0;
          const v = priceMode === "pct_up" ? cur * (1 + n / 100) : priceMode === "pct_down" ? cur * (1 - n / 100)
            : priceMode === "add" ? cur + n : priceMode === "sub" ? cur - n : n;
          r[priceField] = String(Math.max(0, Math.round(v * 100) / 100));
        }
        if (setVat !== "" && keys.includes("vat_rate")) r.vat_rate = setVat;
        if (setReorder !== "") r.reorder_level = setReorder;
        if (setUnit.trim()) r.unit = setUnit.trim();
        next[id] = r;
      }
      return next;
    });
    toast({ title: "Applied to all rows", description: "Nothing is saved until you press Save." });
  };

  const bad = (r: Row) =>
    !String(r.name || "").trim() ? "Name is empty"
      : [...NUMERIC_KEYS].some((k) => r[k] !== undefined && r[k] !== "" && (!Number.isFinite(Number(r[k])) || Number(r[k]) < 0)) ? "Check the numbers"
      : null;

  const save = async () => {
    const problems = changedIds.filter((id) => bad(rows[id]));
    if (problems.length) { toast({ title: `Fix ${problems.length} row${problems.length === 1 ? "" : "s"} first`, variant: "destructive" }); return; }
    if (!changedIds.length) { onClose(); return; }
    setSaving(true);
    let failed = 0;
    for (const id of changedIds) {
      const r = rows[id], o = original[id];
      const patch: any = {};
      keys.forEach((k) => {
        if ((r[k] ?? "") === (o[k] ?? "")) return;
        if (NUMERIC_KEYS.has(k)) patch[k] = r[k] === "" ? (k === "tot_price" || k === "units_per_crate" || k === "tots_per_bottle" ? null : 0) : Number(r[k]);
        else patch[k] = r[k] === "" ? (k === "barcode" || k === "brand" || k === "bottle_size" ? null : "") : r[k].trim();
      });
      if ("reorder_level" in patch) patch.reorder_level = Math.round(patch.reorder_level);
      const { error } = await sb.from("products").update(patch).eq("id", id);
      if (error) { failed++; continue; }
      // Branch low-stock alerts use the branch copy of the reorder level.
      if ("reorder_level" in patch) await sb.from("product_stocks").update({ reorder_level: patch.reorder_level }).eq("product_id", id);
    }
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-stocks"] });
    logActivity({ action: "update", entity_type: "product", description: `Edited ${changedIds.length - failed} products in bulk` });
    if (failed) toast({ title: `${changedIds.length - failed} saved, ${failed} failed`, variant: "destructive" });
    else { toast({ title: `${changedIds.length} product${changedIds.length === 1 ? "" : "s"} updated` }); onClose(); }
  };

  return (
    <Modal open={open} onClose={() => !saving && onClose()} size="full" icon={PencilLine} title={`Edit ${productIds.length} product${productIds.length === 1 ? "" : "s"}`}
      description="Change any cell, or use Apply to all. Changed cells are highlighted; only changed products are saved."
      footer={<>
        <span className="mr-auto text-sm text-muted-foreground">{changedIds.length} changed</span>
        <Button variant="outline" onClick={() => setRows(JSON.parse(JSON.stringify(original)))} disabled={saving || !changedIds.length}><RotateCcw /> Undo changes</Button>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || !changedIds.length}>{saving && <OrbSpinner />} Save changes</Button>
      </>}>
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Wand2 className="h-4 w-4 text-primary" /> Apply to all {order.length}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Field label="Category"><input className="fi" value={setCategory} onChange={(e) => setSetCategory(e.target.value)} placeholder="Leave empty to keep" /></Field>
            <Field label="Change" className="lg:col-span-2">
              <div className="flex gap-1.5">
                <select className="fi w-auto" value={priceField} onChange={(e) => setPriceField(e.target.value as any)}>
                  <option value="price">Selling price</option><option value="cost_price">Buying price</option>
                </select>
                <select className="fi w-auto" value={priceMode} onChange={(e) => setPriceMode(e.target.value as any)}>
                  <option value="pct_up">+ %</option><option value="pct_down">− %</option><option value="add">+ amount</option><option value="sub">− amount</option><option value="set">set to</option>
                </select>
                <input className="fi w-24 text-right" inputMode="decimal" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} placeholder="0" />
              </div>
            </Field>
            {keys.includes("vat_rate") && <Field label="VAT %"><input className="fi" inputMode="decimal" value={setVat} onChange={(e) => setSetVat(e.target.value)} placeholder="Keep" /></Field>}
            <Field label="Reorder at"><input className="fi" inputMode="numeric" value={setReorder} onChange={(e) => setSetReorder(e.target.value)} placeholder="Keep" /></Field>
            <Field label="Unit"><input className="fi" value={setUnit} onChange={(e) => setSetUnit(e.target.value)} placeholder="Keep" /></Field>
          </div>
          <Button size="sm" className="mt-3" onClick={applyAll}><Wand2 /> Apply to all rows</Button>
        </section>

        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p> : (
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
            <table className="dt">
              <thead><tr>{cols.map((c) => <th key={c.key} className={c.width}>{c.label}</th>)}</tr></thead>
              <tbody>
                {order.map((id) => {
                  const r = rows[id] || {}, o = original[id] || {};
                  const err = bad(r);
                  return (
                    <tr key={id} className={cn(err && "bg-destructive/5")} title={err || undefined}>
                      {cols.map((c) => {
                        const changed = (r[c.key] ?? "") !== (o[c.key] ?? "");
                        return (
                          <td key={c.key} className="!p-1">
                            {c.type === "select" ? (
                              <select className={cn("fi h-9", changed && "border-primary bg-primary/5")} value={r[c.key] || ""} onChange={(e) => setCell(id, c.key, e.target.value)}>
                                {c.options!.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                              </select>
                            ) : (
                              <input className={cn("fi h-9", c.type === "number" && "text-right tabular-nums", changed && "border-primary bg-primary/5")}
                                inputMode={c.type === "number" ? "decimal" : undefined} value={r[c.key] || ""} onChange={(e) => setCell(id, c.key, e.target.value)} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
