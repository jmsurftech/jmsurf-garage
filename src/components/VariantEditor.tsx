import { useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import {
  DEFAULT_CLOTHING_SIZES,
  DEFAULT_SCHOOL_SIZES,
  DEFAULT_SHOE_SIZES,
  DEFAULT_COLORS,
} from "@/lib/businessType";

export interface VariantDraft {
  id?: string;
  size: string;
  color: string;
  price: string;
  cost_price: string;
  stock: string;
  reorder_level: string;
}

export const emptyVariant = (): VariantDraft => ({
  size: "",
  color: "",
  price: "",
  cost_price: "",
  stock: "0",
  reorder_level: "2",
});

/**
 * Size / colour grid used by clothing shops. Each row is its own sellable
 * variant with its own price and stock.
 */
export default function VariantEditor({
  variants,
  onChange,
  defaultPrice,
  defaultCost,
}: {
  variants: VariantDraft[];
  onChange: (v: VariantDraft[]) => void;
  defaultPrice?: string;
  defaultCost?: string;
}) {
  const [sizeSet, setSizeSet] = useState<"clothing" | "school" | "shoes">("clothing");
  const [pickedColors, setPickedColors] = useState<string[]>([]);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkQty, setBulkQty] = useState("");

  const applyAll = (key: "price" | "stock", value: string) => {
    if (value === "") return;
    onChange(variants.map((v) => ({ ...v, [key]: value })));
  };

  const sizes =
    sizeSet === "clothing"
      ? DEFAULT_CLOTHING_SIZES
      : sizeSet === "school"
        ? DEFAULT_SCHOOL_SIZES
        : DEFAULT_SHOE_SIZES;

  const update = (i: number, key: keyof VariantDraft, val: string) => {
    const next = [...variants];
    next[i] = { ...next[i], [key]: val };
    onChange(next);
  };

  const generate = () => {
    const colors = pickedColors.length ? pickedColors : [""];
    const rows: VariantDraft[] = [];
    colors.forEach((c) =>
      sizes.forEach((s) => {
        const exists = variants.find((v) => v.size === s && v.color === c);
        rows.push(
          exists || {
            ...emptyVariant(),
            size: s,
            color: c,
            price: defaultPrice || "",
            cost_price: defaultCost || "",
          },
        );
      }),
    );
    onChange(rows);
  };

  return (
    <div className="col-span-2 border border-input rounded-xl p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-sm font-medium">Sizes, colours, stock &amp; prices</label>
        <div className="flex items-center gap-1.5">
          <select
            value={sizeSet}
            onChange={(e) => setSizeSet(e.target.value as any)}
            className="fi"
          >
            <option value="clothing">S – XXXL</option>
            <option value="school">School sizes 2 – 24</option>
            <option value="shoes">Shoe sizes</option>
          </select>
          <button
            type="button"
            onClick={generate}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-secondary text-secondary-foreground flex items-center gap-1"
          >
            <Wand2 className="w-3.5 h-3.5" /> Fill grid
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_COLORS.map((c) => {
          const on = pickedColors.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() =>
                setPickedColors((prev) =>
                  on ? prev.filter((x) => x !== c) : [...prev, c],
                )
              }
              className={`px-2.5 py-1 rounded-full text-xs border ${
                on
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      {variants.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-input pt-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Set selling price for all</label>
            <div className="flex gap-1.5">
              <input
                type="number" min="0" step="0.01" value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                placeholder="e.g. 850"
                className="fi w-24"
              />
              <button type="button" onClick={() => applyAll("price", bulkPrice)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-input">Apply</button>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Set quantity for all</label>
            <div className="flex gap-1.5">
              <input
                type="number" min="0" value={bulkQty}
                onChange={(e) => setBulkQty(e.target.value)}
                placeholder="e.g. 10"
                className="fi w-24"
              />
              <button type="button" onClick={() => applyAll("stock", bulkQty)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-input">Apply</button>
            </div>
          </div>
        </div>
      )}

      <div className="hidden sm:grid grid-cols-12 gap-1.5 text-[11px] text-muted-foreground px-1">
        <span className="col-span-2">Size</span>
        <span className="col-span-3">Colour</span>
        <span className="col-span-2">Quantity</span>
        <span className="col-span-2">Buying</span>
        <span className="col-span-2">Selling</span>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-1.5">
        {variants.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            Pick colours and a size set, then tap "Fill grid" — or add rows one by one.
          </p>
        )}
        {variants.map((v, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <input
              value={v.size}
              onChange={(e) => update(i, "size", e.target.value)}
              placeholder="Size"
              className="fi col-span-2"
            />
            <input
              value={v.color}
              onChange={(e) => update(i, "color", e.target.value)}
              placeholder="Colour"
              className="fi col-span-3"
            />
            <input
              type="number"
              min="0"
              value={v.stock}
              onChange={(e) => update(i, "stock", e.target.value)}
              placeholder="Qty"
              className="fi col-span-2"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={v.cost_price}
              onChange={(e) => update(i, "cost_price", e.target.value)}
              placeholder="Buy"
              className="fi col-span-2"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={v.price}
              onChange={(e) => update(i, "price", e.target.value)}
              placeholder="Sell"
              className="fi col-span-2"
            />
            <button
              type="button"
              onClick={() => onChange(variants.filter((_, x) => x !== i))}
              className="col-span-1 p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"
              aria-label="Remove row"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          onChange([
            ...variants,
            { ...emptyVariant(), price: defaultPrice || "", cost_price: defaultCost || "" },
          ])
        }
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-input flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" /> Add row
      </button>
    </div>
  );
}
