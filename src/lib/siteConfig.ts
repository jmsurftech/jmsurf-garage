/**
 * Everything the owner can change about the public website, stored in
 * business_settings.erp_settings.shop.site and served by /api/shop/info.
 * Missing values fall back to these defaults, so the site always renders.
 */
export type SiteTemplate = "classic" | "split" | "bold";
export interface SiteConfig {
  template: SiteTemplate;
  colors: { primary: string; accent: string; dark: string };
  topbar: { show: boolean; text: string };
  contact: { phone: string; phone2: string; whatsapp: string; email: string; address: string; hours: string; map_url: string };
  social: { facebook: string; instagram: string; tiktok: string; x: string; youtube: string };
  hero: { badge: string; title: string; text: string; cta: string; cta2: string; images: string[] };
  about: { title: string; text: string; image: string; points: string[] };
  services: { title: string; text: string };
  products: { title: string; text: string; count: number };
  cta: { title: string; text: string; button: string; link: string };
  contact_section: { title: string; text: string };
  footer: { text: string };
  seo: { title: string; description: string };
}

export const DEFAULT_SITE: SiteConfig = {
  template: "classic",
  colors: { primary: "#A8121B", accent: "#15171C", dark: "#1F1A17" },
  topbar: { show: true, text: "" },
  contact: { phone: "", phone2: "", whatsapp: "", email: "", address: "", hours: "Mon – Fri, 8:00 am – 5:00 pm", map_url: "" },
  social: { facebook: "", instagram: "", tiktok: "", x: "", youtube: "" },
  hero: {
    badge: "Welcome",
    title: "Quality products and services you can trust.",
    text: "Browse what we offer, order online and pay with M-Pesa or card. Our team is ready to help.",
    cta: "Shop now", cta2: "Our services", images: [],
  },
  about: {
    title: "About us",
    text: "We are a customer-focused business serving clients with reliable products, fair prices and friendly service.",
    image: "",
    points: ["Trusted quality", "Fast, friendly service", "Easy payments with M-Pesa and card"],
  },
  services: { title: "Products & services", text: "Everything we offer, in one place." },
  products: { title: "Products", text: "Popular right now.", count: 12 },
  cta: { title: "Ready to get started?", text: "Order online in minutes and pay with M-Pesa. Create an account to track orders, invoices and statements.", button: "Start shopping", link: "/shop" },
  contact_section: { title: "Talk to us", text: "Call, WhatsApp or send us a message and we'll get back to you quickly." },
  footer: { text: "" },
  seo: { title: "", description: "" },
};

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merges saved values over the defaults (arrays and strings replace). */
export function mergeSiteConfig(saved: unknown): SiteConfig {
  const out: any = structuredClone(DEFAULT_SITE);
  if (!isObj(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (isObj(v) && isObj(out[k])) {
      for (const [k2, v2] of Object.entries(v)) if (v2 !== undefined && v2 !== null) out[k][k2] = v2;
    } else if (v !== undefined && v !== null) out[k] = v;
  }
  out.products.count = Math.min(48, Math.max(3, Number(out.products.count) || 12));
  return out as SiteConfig;
}
