import type { BusinessType } from "@/lib/businessType";

/** One editable column in the bulk product grids. */
export type BulkCol = {
  key: string;
  label: string;
  /** Header names accepted when importing a file (lower case). */
  aliases?: string[];
  type?: "text" | "number" | "select";
  options?: { value: string; label: string }[];
  width?: string;
  required?: boolean;
  hint?: string;
  /** Only shown when adding (not in bulk edit). */
  addOnly?: boolean;
};

const PRODUCT_TYPES = [
  { value: "simple", label: "Simple" },
  { value: "standard", label: "Standard" },
  { value: "sized", label: "Sizes" },
  { value: "sized_color", label: "Sizes & colours" },
];

/** Columns for the shop's type: every shop gets the basics, liquor and clothing get their extras. */
export function bulkColumns(type: BusinessType, vatEnabled: boolean): BulkCol[] {
  const base: BulkCol[] = [
    { key: "name", label: "Name", aliases: ["name", "product", "product name", "item"], required: true, width: "min-w-[200px]" },
    { key: "category", label: "Category", aliases: ["category"], width: "min-w-[140px]" },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "code", "ean"], width: "min-w-[130px]" },
    { key: "cost_price", label: "Buying price", aliases: ["buying price", "cost", "cost price", "buying"], type: "number", width: "w-28" },
    { key: "price", label: "Selling price", aliases: ["selling price", "price", "selling"], type: "number", required: true, width: "w-28" },
  ];
  const stock: BulkCol[] = [
    { key: "stock", label: type === "clothing" ? "Stock (each size/colour)" : "Opening stock", aliases: ["stock", "quantity", "qty", "opening stock"], type: "number", width: "w-28", addOnly: true },
    { key: "reorder_level", label: "Reorder at", aliases: ["reorder level", "reorder", "reorder at"], type: "number", width: "w-24" },
    { key: "unit", label: "Unit", aliases: ["unit"], width: "w-24" },
  ];
  const vat: BulkCol[] = vatEnabled ? [{ key: "vat_rate", label: "VAT %", aliases: ["vat rate", "vat", "tax"], type: "number", width: "w-20" }] : [];
  const liquor: BulkCol[] = type === "liquor" ? [
    { key: "bottle_size", label: "Bottle size", aliases: ["bottle size", "size", "volume"], width: "w-28", hint: "e.g. 750ml" },
    { key: "units_per_crate", label: "Per crate", aliases: ["units per crate", "per crate", "crate"], type: "number", width: "w-24" },
    { key: "crate_deposit", label: "Crate deposit", aliases: ["crate deposit", "deposit"], type: "number", width: "w-28" },
    { key: "tot_price", label: "Tot price", aliases: ["tot price", "shot price"], type: "number", width: "w-24" },
    { key: "tots_per_bottle", label: "Tots per bottle", aliases: ["tots per bottle", "tots"], type: "number", width: "w-28" },
  ] : [];
  const clothing: BulkCol[] = type === "clothing" ? [
    { key: "brand", label: "Brand", aliases: ["brand"], width: "min-w-[120px]" },
    { key: "product_type", label: "Type", aliases: ["type", "product type"], type: "select", options: PRODUCT_TYPES, width: "w-36" },
    { key: "sizes", label: "Sizes", aliases: ["sizes"], width: "min-w-[150px]", hint: "S, M, L or 38, 40", addOnly: true },
    { key: "colors", label: "Colours", aliases: ["colours", "colors", "colour", "color"], width: "min-w-[150px]", hint: "Black, White", addOnly: true },
  ] : [];
  return [...base, ...clothing, ...liquor, ...stock, ...vat];
}

export const NUMERIC_KEYS = new Set(["cost_price", "price", "stock", "reorder_level", "vat_rate", "units_per_crate", "crate_deposit", "tot_price", "tots_per_bottle"]);

export const listOf = (v: unknown) => String(v ?? "").split(/[,;/|]/).map((s) => s.trim()).filter(Boolean);

/** Map a spreadsheet header row onto column keys. */
export function mapHeader(header: unknown[], cols: BulkCol[]) {
  const norm = header.map((h) => String(h ?? "").toLowerCase().trim());
  const map: Record<string, number> = {};
  cols.forEach((c) => {
    const aliases = [c.label.toLowerCase(), ...(c.aliases || [])];
    const i = norm.findIndex((h) => aliases.includes(h));
    if (i >= 0) map[c.key] = i;
  });
  return map;
}

/** Reads a CSV or Excel file into rows of cells. */
export async function readSheet(file: File): Promise<unknown[][]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
      const out: string[] = [];
      let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    });
  }
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as unknown[][];
}

/** Template file with the shop type's columns and one example row. */
export async function downloadTemplate(cols: BulkCol[], type: BusinessType) {
  const example: Record<string, string | number> = {
    name: type === "liquor" ? "Tusker Lager" : type === "clothing" ? "School shirt" : "Sugar 1kg",
    category: type === "liquor" ? "Beer" : type === "clothing" ? "Shirts" : "Groceries",
    barcode: "", cost_price: type === "liquor" ? 180 : 100, price: type === "liquor" ? 250 : 150,
    stock: 24, reorder_level: 5, unit: type === "liquor" ? "bottle" : "piece", vat_rate: 16,
    bottle_size: "500ml", units_per_crate: 25, crate_deposit: 200, tot_price: "", tots_per_bottle: "",
    brand: "Uniforms Ltd", product_type: "sized_color", sizes: "S, M, L", colors: "White, Blue",
  };
  const XLSX = await import("@e965/xlsx");
  const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c.label), cols.map((c) => example[c.key] ?? "")]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.writeFile(wb, `product-template-${type}.xlsx`);
}
