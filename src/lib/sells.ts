/** What a company sells: goods, services or both (business_settings.sells; empty = both). */
export type Sells = "goods" | "services" | "both";
export const SELLS_OPTIONS: { value: Sells; label: string; hint: string }[] = [
  { value: "both", label: "Products and services", hint: "Stock items and services, e.g. a tech company that installs and supports" },
  { value: "services", label: "Services only", hint: "Consulting, clinics, agencies, repairs: no stock screens" },
  { value: "goods", label: "Products only", hint: "Shops, distributors, wholesalers" },
];
/** Stock screens a services-only company does not need. */
export const STOCK_PATHS = ["/inventory-menu", "/inventory/stock", "/warehouse/receive", "/inventory/adjustments", "/purchases/receives", "/warehouse/packages", "/sales/delivery-notes", "/inventory/reorder"];
