// KRA eTIMS code lists used on items (the same lists KRA publishes for OSCU/VSCU).

/** Item type (itemTyCd). */
export const KRA_ITEM_TYPES = [
  { code: "2", name: "Finished product" },
  { code: "1", name: "Raw material" },
  { code: "3", name: "Service" },
] as const;

/** Packaging unit (pkgUnitCd, code class 17). */
export const KRA_PACKAGING_UNITS: [string, string][] = [
  ["NT", "Net (no packaging)"], ["CT", "Carton"], ["BX", "Box"], ["BG", "Bag"], ["BL", "Bale"], ["BE", "Bundle"], ["BA", "Barrel"],
  ["BQ", "Bottle"], ["BC", "Bottle crate"], ["BJ", "Bucket"], ["BK", "Basket"], ["CA", "Can"], ["CY", "Cylinder"], ["DR", "Drum"],
  ["JR", "Jar"], ["JY", "Jerrycan"], ["KZ", "Canister"], ["PU", "Tray pack"], ["RL", "Reel"], ["RO", "Roll"], ["SK", "Skeleton case"],
  ["TY", "Tank"], ["CR", "Wooden box / crate"], ["AM", "Ampoule"], ["PI", "Pipe"], ["PG", "Plate"], ["CL", "Coil"], ["BR", "Bar"],
  ["VL", "Bulk liquid"], ["VR", "Bulk solid, granular"], ["VY", "Bulk solid, fine"], ["VO", "Bulk solid, large"], ["VG", "Bulk gas"], ["OU", "Other packaging"],
];

/** Quantity unit (qtyUnitCd, code class 10). */
export const KRA_QUANTITY_UNITS: [string, string][] = [
  ["U", "Pieces / items"], ["NO", "Number"], ["KG", "Kilogram"], ["GRM", "Gram"], ["MGM", "Milligram"], ["TNE", "Tonne"], ["LTR", "Litre"],
  ["L", "Litre (L)"], ["MLT", "Millilitre"], ["MTR", "Metre"], ["CMT", "Centimetre"], ["KTM", "Kilometre"], ["M2", "Square metre"], ["M3", "Cubic metre"],
  ["BX", "Box"], ["DZ", "Dozen"], ["PR", "Pair"], ["SET", "Set"], ["PA", "Packet"], ["BG", "Bag"], ["CA", "Can"], ["DR", "Drum"], ["RL", "Reel"],
  ["RO", "Roll"], ["ST", "Sheet"], ["TU", "Tube"], ["GLL", "Gallon"], ["LBR", "Pound"], ["YRD", "Yard"], ["KWT", "Kilowatt"], ["MWT", "Megawatt hour"],
];

/** Country of origin (ISO 3166 alpha-2), most used first. */
export const KRA_COUNTRIES: [string, string][] = [
  ["KE", "Kenya"], ["UG", "Uganda"], ["TZ", "Tanzania"], ["RW", "Rwanda"], ["BI", "Burundi"], ["SS", "South Sudan"], ["ET", "Ethiopia"], ["SO", "Somalia"],
  ["CD", "DR Congo"], ["CN", "China"], ["IN", "India"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["EG", "Egypt"], ["ZA", "South Africa"],
  ["NG", "Nigeria"], ["GH", "Ghana"], ["TR", "Turkey"], ["PK", "Pakistan"], ["JP", "Japan"], ["KR", "South Korea"], ["MY", "Malaysia"], ["ID", "Indonesia"],
  ["TH", "Thailand"], ["VN", "Vietnam"], ["SG", "Singapore"], ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["ES", "Spain"], ["SE", "Sweden"], ["CH", "Switzerland"], ["CA", "Canada"], ["BR", "Brazil"],
  ["AU", "Australia"], ["IL", "Israel"], ["MU", "Mauritius"], ["MA", "Morocco"], ["ZM", "Zambia"], ["MW", "Malawi"], ["MZ", "Mozambique"], ["ZW", "Zimbabwe"],
];

/** A unit typed on the item (pcs, kg, litre …) → KRA quantity unit code. */
export function kraQtyUnitFor(unit?: string | null): string {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return "U";
  const exact = KRA_QUANTITY_UNITS.find(([c]) => c.toLowerCase() === u);
  if (exact) return exact[0];
  if (/^(kg|kgs|kilo)/.test(u)) return "KG";
  if (/^(g|gm|gms|gram)/.test(u)) return "GRM";
  if (/^(l|lt|ltr|litre|liter)/.test(u)) return "LTR";
  if (/^ml/.test(u)) return "MLT";
  if (/^(m|mtr|metre|meter)$/.test(u)) return "MTR";
  if (/^box/.test(u)) return "BX";
  if (/^dozen|^dz/.test(u)) return "DZ";
  if (/^pair/.test(u)) return "PR";
  if (/^set/.test(u)) return "SET";
  if (/^pack|^pkt/.test(u)) return "PA";
  if (/^bag/.test(u)) return "BG";
  if (/^roll/.test(u)) return "RO";
  if (/^ton/.test(u)) return "TNE";
  return "U";
}
