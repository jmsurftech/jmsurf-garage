/**
 * Vendor-specific shop types. The tenant's business_type decides which
 * dashboard, POS screen, product form and document line editors are used.
 */
export type BusinessType = "general" | "liquor" | "clothing" | "water";

export const BUSINESS_TYPES: {
  key: BusinessType;
  label: string;
}[] = [
  {
    key: "general",
    label: "General Retail",
  },
  {
    key: "liquor",
    label: "Liquor Store",
  },
  {
    key: "clothing",
    label: "Clothe Line",
  },
  {
    key: "water",
    label: "Water Refill",
  },
];

/** Standard refill sizes, in litres, for water refill shops. */
export const WATER_SIZES = [0.5, 1, 5, 10, 20];

/** "500ml", "1L", "20L" … */
export function formatLitres(litres: number) {
  return litres < 1 ? `${Math.round(litres * 1000)}ml` : `${+litres.toFixed(3)}L`;
}

/** Product types available when adding an item. */
export type ProductType = "simple" | "sized" | "sized_color" | "standard";

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  simple: "Simple item (one price, one stock)",
  sized: "Sized item (e.g. shoes 28, 40, 42)",
  sized_color: "Sized & coloured item (e.g. shirts S–XXXL in colours)",
  standard: "Standard only (e.g. ties, badges)",
};

export const DEFAULT_CLOTHING_SIZES = [
  "S", "M", "L", "XL", "XXL", "XXXL",
];

export const DEFAULT_SCHOOL_SIZES = [
  "2", "4", "6", "8", "10", "12", "14", "16", "18", "20", "22", "24",
];

export const DEFAULT_SHOE_SIZES = [
  "28", "30", "32", "34", "36", "38", "39", "40", "41", "42", "43", "44", "45", "46",
];

export const DEFAULT_COLORS = [
  "White", "Black", "Navy", "Blue", "Red", "Maroon", "Green", "Grey", "Brown", "Yellow",
];

export const LIQUOR_CATEGORIES = [
  "Beer", "Spirits", "Wines", "RTD / Ready to Drink", "Soft Drinks", "Cigarettes", "Snacks",
];

export const BOTTLE_SIZES = ["250ml", "300ml", "330ml", "500ml", "750ml", "1L", "1.5L", "2L"];

interface TypeConfig {
  posTitle: string;
  /** Extra nav paths only this business type sees. */
  extraNav: string[];
  /** Nav paths hidden for this business type. */
  hiddenNav: string[];
}

export const BUSINESS_TYPE_CONFIG: Record<BusinessType, TypeConfig> = {
  general: { posTitle: "Point of Sale", extraNav: [], hiddenNav: [] },
  liquor: {
    posTitle: "Bar / Counter",
    extraNav: ["/bills/open", "/inventory/empties", "/shift-cashup"],
    hiddenNav: [],
  },
  clothing: {
    posTitle: "Shop Counter",
    extraNav: ["/sales/exchanges", "/sales/layaway"],
    hiddenNav: [],
  },
  water: {
    posTitle: "Refill Counter",
    extraNav: ["/water/tanks", "/water/orders"],
    hiddenNav: [],
  },
};

/** Human label for a cart / document line, e.g. "Shirt — White / M". */
export function formatItemLabel(opts: {
  name: string;
  size?: string | null;
  color?: string | null;
  bottleSize?: string | null;
  unitType?: string | null;
}) {
  const { name, size, color, bottleSize, unitType } = opts;
  const bits: string[] = [];
  if (color) bits.push(color);
  if (size) bits.push(size);
  if (bottleSize) bits.push(bottleSize);
  if (unitType && unitType !== "unit" && unitType !== "bottle") bits.push(unitType);
  return bits.length ? `${name} — ${bits.join(" / ")}` : name;
}
