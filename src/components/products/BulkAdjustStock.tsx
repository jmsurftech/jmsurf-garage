import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Modal, Field, Segmented } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;
type Line = { key: string; productId: string; variantId: string | null; name: string; detail: string; current: number; unit: string };

const REASONS = [
  { value: "restock", label: "Restock / delivery" },
  { value: "count", label: "Stock count correction" },
  { value: "damage", label: "Damaged / expired" },
  { value: "return", label: "Customer return" },
  { value: "other", label: "Other" },
];

/**
 * Change stock for many products at one branch. Each line goes through the
 * same logged adjustment as a single change, so the history stays complete.
 * Clothing sizes and colours appear as their own lines.
 */
export default function BulkAdjustStock({ open, onClose, products, locationId, locationName }: {
  open: boolean;
  onClose: () => void;
  products: any[];
  locationId: string;
  locationName?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"change" | "set">("change");
  const [reason, setReason] = useState("restock");
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [same, setSame] = useState("");

  useEffect(() => {
    if (!open) return;
    setValues({});
    const ids = products.map((p) => p.id);
    sb.from("product_variants").select("id, product_id, size, color, stock").in("product_id", ids).eq("is_active", true)
      .then(({ data }: any) => {
        const byProduct = new Map<string, any[]>();
        (data || []).forEach((v: any) => byProduct.set(v.product_id, [...(byProduct.get(v.product_id) || []), v]));
        const out: Line[] = [];
        [...products].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((p) => {
          const vs = byProduct.get(p.id) || [];
          if (vs.length) {
            vs.sort((a, b) => `${a.size}${a.color}`.localeCompare(`${b.size}${b.color}`)).forEach((v) =>
              out.push({ key: v.id, productId: p.id, variantId: v.id, name: p.name, detail: [v.size, v.color].filter(Boolean).join(" · "), current: Number(v.stock) || 0, unit: p.unit || "" }));
          } else {
            out.push({ key: p.id, productId: p.id, variantId: null, name: p.name, detail: "", current: Number(p.stock) || 0, unit: p.unit || "" });
          }
        });
        setLines(out);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, products.map((p) => p.id).join(",")]);

  const plan = useMemo(() => lines.map((l) => {
    const raw = values[l.key];
    if (raw === undefined || raw.trim() === "") return { ...l, delta: 0, after: l.current, bad: false };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ...l, delta: 0, after: l.current, bad: true };
    const after = mode === "set" ? n : l.current + n;
    return { ...l, delta: after - l.current, after, bad: after < 0 || (mode === "set" && n < 0) };
  }), [lines, values, mode]);

  const todo = plan.filter((p) => p.delta !== 0 && !p.bad);
  const badCount = plan.filter((p) => p.bad).length;

  const fillAll = () => {
    if (same.trim() === "") return;
    setValues(Object.fromEntries(lines.map((l) => [l.key, same])));
  };

  const save = async () => {
    if (badCount) { toast({ title: "Some lines would go below zero or are not numbers", variant: "destructive" }); return; }
    if (!todo.length) { toast({ title: "Nothing to change" }); return; }
    if (!navigator.onLine) { toast({ title: "Connect to the internet to adjust stock", variant: "destructive" }); return; }
    setSaving(true);
    const failures: string[] = [];
    let done = 0;
    for (const line of todo) {
      setProgress(`Updating ${done + 1} of ${todo.length}…`);
      const { error } = await sb.rpc("adjust_product_stock", {
        p_product_id: line.productId, p_location_id: locationId, p_delta: line.delta, p_reason: reason, p_variant_id: line.variantId,
      });
      if (error) failures.push(`${line.name}${line.detail ? ` (${line.detail})` : ""}: ${error.message}`);
      else done++;
    }
    setSaving(false);
    setProgress("");
    ["products", "product-stocks", "product-variants", "stock-adjustments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (failures.length) toast({ title: `${done} updated, ${failures.length} failed`, description: failures.slice(0, 3).join(" · "), variant: "destructive" });
    else { toast({ title: `Stock updated for ${done} line${done === 1 ? "" : "s"}`, description: REASONS.find((r) => r.value === reason)?.label }); onClose(); }
  };

  return (
    <Modal open={open} onClose={() => !saving && onClose()} size="2xl" icon={Boxes} title={`Adjust stock${locationName ? ` · ${locationName}` : ""}`}
      description="Enter how many to add or remove, or switch to 'Set counted stock' and type what is on the shelf."
      footer={<>
        {progress && <span className="mr-auto text-sm text-muted-foreground">{progress}</span>}
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || !todo.length || badCount > 0}>{saving && <OrbSpinner />} Apply {todo.length || ""} change{todo.length === 1 ? "" : "s"}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Segmented value={mode} onChange={(v) => { setMode(v as any); setValues({}); }} options={[{ value: "change", label: "Add / remove" }, { value: "set", label: "Set counted stock" }]} />
          <Field label="Reason">
            <select className="fi" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-1.5">
            <Field label={mode === "set" ? "Same count for all" : "Same change for all"}><input className="fi w-28 text-right" inputMode="decimal" value={same} onChange={(e) => setSame(e.target.value)} placeholder={mode === "set" ? "e.g. 24" : "e.g. 12 or -2"} /></Field>
            <Button variant="outline" onClick={fillAll}>Fill</Button>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
          <table className="dt">
            <thead><tr><th>Product</th><th className="num">Now</th><th className="num w-36">{mode === "set" ? "Counted" : "Add (−remove)"}</th><th className="num">After</th></tr></thead>
            <tbody>
              {plan.map((l) => (
                <tr key={l.key} className={cn(l.bad && "bg-destructive/5")}>
                  <td><p className="font-medium">{l.name}</p>{l.detail && <p className="text-xs text-muted-foreground">{l.detail}</p>}</td>
                  <td className="num text-muted-foreground">{l.current} {l.unit}</td>
                  <td className="num !py-1">
                    <input className={cn("fi h-9 text-right tabular-nums", l.bad && "border-destructive")} inputMode="decimal" value={values[l.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [l.key]: e.target.value }))} placeholder={mode === "set" ? String(l.current) : "0"} />
                  </td>
                  <td className={cn("num font-semibold", l.delta > 0 ? "text-success" : l.delta < 0 ? "text-destructive" : "text-muted-foreground")}>
                    {l.after}{l.delta !== 0 && <span className="ml-1 text-xs font-normal">({l.delta > 0 ? "+" : ""}{l.delta})</span>}
                  </td>
                </tr>
              ))}
              {plan.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
