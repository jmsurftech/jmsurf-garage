import { formatItemLabel } from "@/lib/businessType";

export interface LineItemLike {
  name: string;
  size?: string | null;
  color?: string | null;
  bottle_size?: string | null;
  unit_type?: string | null;
}

/**
 * One renderer for item lines across POS, invoices, quotes, purchase orders,
 * delivery notes, packing lists and receipts.
 */
export default function ItemLineLabel({
  item,
  className = "",
}: {
  item: LineItemLike;
  className?: string;
}) {
  const label = formatItemLabel({
    name: item.name,
    size: item.size,
    color: item.color,
    bottleSize: item.bottle_size,
    unitType: item.unit_type,
  });
  return <span className={className}>{label}</span>;
}

/** Plain-string version for PDFs, CSV exports and print templates. */
export function itemLineText(item: LineItemLike) {
  return formatItemLabel({
    name: item.name,
    size: item.size,
    color: item.color,
    bottleSize: item.bottle_size,
    unitType: item.unit_type,
  });
}
