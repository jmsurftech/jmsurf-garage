/**
 * JMSURF Garage plans, sign-up choices and the price box.
 *
 * Base plans go by garage size; Garage Core is in every plan. Modules are
 * priced per month (src/lib/modules.ts). These are defaults: the platform owner
 * edits plans and module prices in the super admin, and the live tables
 * (plans, platform_modules) win at runtime (src/hooks/useGarageCatalogue.ts).
 * Plain data: the website snapshots (src/seo) read this file at build time.
 * Seeded by supabase/migrations/20261120000100_garage_catalogue.sql — keep in step.
 */
import { ADDON_MODULES, MODULE_BY_KEY, PUBLIC_MODULES } from "@/lib/modules";

export type PlanCode = "fundi" | "starter" | "business" | "pro" | "enterprise" | "all_modules";

export interface GaragePlan {
  /** Database id when read from the plans table. */
  id?: string;
  code: PlanCode;
  name: string;
  /** KES per month (0 with quoteOnly = priced on request). */
  price: number;
  /** KES per year (10 x monthly by default: 2 months free). */
  priceYear: number;
  users: number;
  branches: number;
  /** Module keys included at no extra cost. */
  includes: string[];
  /** Who it is for, in plain words. */
  blurb: string;
  /** Enterprise: priced on request. */
  quoteOnly?: boolean;
  /** Shown on the website / store but not chosen by size at sign-up. */
  bundle?: boolean;
}

/** Every garage module (the 16 paid garage modules; the call centre is billed on its own). */
export const BUNDLE_MODULES = [
  "workshop_pro", "inventory", "accounting", "hrm", "insurance", "commerce", "website", "imports",
  "vehicle_yard", "body_paint", "car_wash", "tyres", "fleet_contracts", "towing", "car_hire", "whatsapp",
];

export const EXTRA_BRANCH_PRICE = 2000;
export const TRIAL_DAYS = 14;
/** Yearly payment: 10 x the monthly price (2 months free). */
export const YEAR_MONTHS = 10;

export const DEFAULT_PLANS: GaragePlan[] = [
  { code: "fundi", name: "Fundi", price: 500, priceYear: 5000, users: 3, branches: 1, includes: [],
    blurb: "For the roadside fundi and one-man garage: job cards, M-Pesa, eTIMS invoices and SMS." },
  { code: "starter", name: "Starter", price: 2000, priceYear: 20000, users: 5, branches: 1, includes: [],
    blurb: "For a small garage with a few mechanics and a front desk." },
  { code: "business", name: "Business", price: 5000, priceYear: 50000, users: 15, branches: 1, includes: ["workshop_pro", "inventory", "accounting"],
    blurb: "For a busy workshop: inspections, bay board, full parts stock and accounting included." },
  { code: "pro", name: "Pro", price: 12000, priceYear: 120000, users: 40, branches: 2, includes: ["workshop_pro", "inventory", "accounting", "hrm", "insurance"],
    blurb: "For big workshops and dealers: adds payroll and insurance claims, two branches." },
  { code: "enterprise", name: "Enterprise", price: 0, priceYear: 0, users: 999999, branches: 999, includes: BUNDLE_MODULES, quoteOnly: true,
    blurb: "For groups and dealers with many branches: priced for you. Talk to us." },
  { code: "all_modules", name: "All modules", price: 25000, priceYear: 250000, users: 40, branches: 2, includes: BUNDLE_MODULES, bundle: true,
    blurb: "Pro plus every garage module for one price." },
];

/** Business size at sign-up → base plan. */
export const SIZES: { code: PlanCode; label: string; hint: string }[] = [
  { code: "fundi", label: "Just me and a helper", hint: "Up to 3 people" },
  { code: "starter", label: "Small garage", hint: "Up to 5 people" },
  { code: "business", label: "Busy workshop", hint: "Up to 15 people" },
  { code: "pro", label: "Big workshop or dealer", hint: "Up to 40 people, 2 branches" },
  { code: "enterprise", label: "Group with many branches", hint: "We price it for you" },
];

/** "What does your business do?" → modules ticked for you. */
export const BUSINESS_KINDS: { key: string; label: string; modules: string[] }[] = [
  { key: "mechanical", label: "Mechanical repairs", modules: ["workshop_pro"] },
  { key: "spares", label: "Spares shop", modules: ["inventory", "commerce"] },
  { key: "imports", label: "Imports", modules: ["imports", "inventory"] },
  { key: "yard", label: "Vehicle yard / car sales", modules: ["vehicle_yard"] },
  { key: "body_paint", label: "Body & paint", modules: ["body_paint", "insurance"] },
  { key: "car_wash", label: "Car wash & detailing", modules: ["car_wash"] },
  { key: "tyres", label: "Tyres & alignment", modules: ["tyres"] },
  { key: "fleet", label: "Fleet contracts", modules: ["fleet_contracts"] },
  { key: "towing", label: "Towing / mobile mechanic", modules: ["towing"] },
  { key: "car_hire", label: "Car hire", modules: ["car_hire"] },
];

/** Modules ticked for the chosen kinds of business (no duplicates, catalogue order). */
export function modulesForKinds(kinds: string[]): string[] {
  const want = new Set(BUSINESS_KINDS.filter((k) => kinds.includes(k.key)).flatMap((k) => k.modules));
  return ADDON_MODULES.map((m) => m.key).filter((k) => want.has(k));
}

export interface Catalogue {
  plans: GaragePlan[];
  /** Module key → monthly price. */
  prices: Record<string, number>;
  /** Module keys the platform owner switched off. */
  off: Set<string>;
}

export const DEFAULT_CATALOGUE: Catalogue = {
  plans: DEFAULT_PLANS,
  prices: Object.fromEntries(PUBLIC_MODULES.map((m) => [m.key, m.price])),
  off: new Set(),
};

export const planByCode = (cat: Catalogue, code: string | null | undefined) =>
  cat.plans.find((p) => p.code === code) || cat.plans[0];

export interface PriceLine { key: string; label: string; amount: number; note?: string }

/**
 * The live price box: base plan + each chosen module not in the plan + extra branches.
 * `cycle` "year" uses the yearly prices (10 x monthly).
 */
export function priceBox(cat: Catalogue, planCode: string, modules: string[], opts: { extraBranches?: number; cycle?: "month" | "year" } = {}) {
  const plan = planByCode(cat, planCode);
  const yearly = opts.cycle === "year";
  const lines: PriceLine[] = [];
  lines.push({ key: "plan", label: `${plan.name} plan`, amount: plan.quoteOnly ? 0 : yearly ? plan.priceYear : plan.price, note: plan.quoteOnly ? "Priced for you" : undefined });
  for (const k of modules) {
    const m = MODULE_BY_KEY[k];
    if (!m || m.included || cat.off.has(k)) continue;
    if (plan.includes.includes(k)) { lines.push({ key: k, label: m.name, amount: 0, note: `In ${plan.name}` }); continue; }
    const monthly = cat.prices[k] ?? m.price;
    lines.push({ key: k, label: m.name, amount: yearly ? monthly * YEAR_MONTHS : monthly });
  }
  const extra = Math.max(0, opts.extraBranches || 0);
  if (extra) lines.push({ key: "branches", label: `${extra} extra branch${extra === 1 ? "" : "es"}`, amount: extra * EXTRA_BRANCH_PRICE * (yearly ? YEAR_MONTHS : 1) });
  const total = lines.reduce((a, l) => a + l.amount, 0);
  // The bundle wins when it costs less than plan + modules.
  const bundle = cat.plans.find((p) => p.bundle);
  const bundleTotal = bundle ? (yearly ? bundle.priceYear : bundle.price) + (extra ? extra * EXTRA_BRANCH_PRICE * (yearly ? YEAR_MONTHS : 1) : 0) : null;
  const bundleSaves = bundle && bundleTotal != null && !plan.quoteOnly && plan.code !== bundle.code && bundleTotal < total ? total - bundleTotal : 0;
  return { plan, lines, total, bundle, bundleSaves };
}

/** Normal price of everything in the bundle (Pro + every module not in Pro). */
export function bundleListPrice(cat: Catalogue): number {
  const pro = planByCode(cat, "pro");
  return pro.price + BUNDLE_MODULES.filter((k) => !pro.includes.includes(k)).reduce((a, k) => a + (cat.prices[k] ?? MODULE_BY_KEY[k]?.price ?? 0), 0);
}

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

