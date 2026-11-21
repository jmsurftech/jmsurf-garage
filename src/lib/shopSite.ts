/**
 * Content of a shop's one-page website (shown on its own domain and on
 * app.jmsurfgarage.co.ke/<slug> or its own domain). Stored in shop_sites.content; anything missing
 * falls back to sensible wording built from the shop's name.
 */
export interface SiteFeature { title: string; text: string }

export interface SiteContent {
  accent: "sky" | "teal" | "indigo" | "emerald" | "cyan";
  tagline: string;
  headline: string;
  subheadline: string;
  hero_image: string;
  show_prices: boolean;
  features: SiteFeature[];
  about_title: string;
  about_text: string;
  about_image: string;
  areas: string[];
  hours: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  cta_label: string;
}

export const ACCENTS: Record<SiteContent["accent"], { name: string; from: string; to: string; solid: string; soft: string; text: string }> = {
  sky: { name: "Sky", from: "#0ea5e9", to: "#2563eb", solid: "#0284c7", soft: "#e0f2fe", text: "#075985" },
  cyan: { name: "Lagoon", from: "#06b6d4", to: "#0e7490", solid: "#0891b2", soft: "#cffafe", text: "#155e75" },
  teal: { name: "Teal", from: "#14b8a6", to: "#0f766e", solid: "#0d9488", soft: "#ccfbf1", text: "#115e59" },
  indigo: { name: "Deep blue", from: "#6366f1", to: "#1e3a8a", solid: "#4f46e5", soft: "#e0e7ff", text: "#3730a3" },
  emerald: { name: "Fresh green", from: "#10b981", to: "#047857", solid: "#059669", soft: "#d1fae5", text: "#065f46" },
};

export function defaultSite(shopName: string, phone?: string | null): SiteContent {
  return {
    accent: "sky",
    tagline: "Clean drinking water, delivered",
    headline: `Fresh, safe water from ${shopName}`,
    subheadline: "Order refills from 500ml to 20 litres in a minute. We bring them to your door and you pay on delivery with M-Pesa or cash.",
    hero_image: "",
    show_prices: true,
    features: [
      { title: "Purified and tested", text: "Every litre is treated and checked before it leaves our tanks." },
      { title: "Delivered to your door", text: "Pin your place on the map once; our rider finds you every time." },
      { title: "Pay on delivery", text: "No payment until the water is in your hands. M-Pesa or cash." },
    ],
    about_title: `About ${shopName}`,
    about_text: `${shopName} supplies clean, refreshing water to homes, offices and businesses near you. Order online, track your rider live, and get a receipt for every refill.`,
    about_image: "",
    areas: [],
    hours: "Mon – Sat 7:00 am – 8:00 pm · Sun 9:00 am – 5:00 pm",
    phone: phone || "",
    whatsapp: "",
    email: "",
    address: "",
    cta_label: "Order water now",
  };
}

/** Saved content over the defaults (missing or empty fields keep the default). */
export function mergeSite(shopName: string, phone: string | null | undefined, saved: Partial<SiteContent> | null | undefined): SiteContent {
  const base = defaultSite(shopName, phone);
  if (!saved) return base;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim() && !["hero_image", "about_image", "whatsapp", "email", "address"].includes(k)) continue;
    if (Array.isArray(v) && k === "features" && v.filter((f: any) => f?.title).length === 0) continue;
    out[k] = v;
  }
  if (!ACCENTS[out.accent as SiteContent["accent"]]) out.accent = "sky";
  return out as SiteContent;
}

/** wa.me link for a phone number (local Kenyan numbers become 254…). */
export function whatsappUrl(raw: string) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  return d.length >= 9 ? `https://wa.me/${d}` : "";
}
