import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Platform support contacts, edited by the platform owner in the CMS. */
export function useSupportContact() {
  const { data } = useQuery({
    queryKey: ["support-contact"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("cms_content").select("section, content").in("section", ["whatsapp", "contact"]);
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.section] = r.content || {}; });
      return map;
    },
  });
  const wa = data?.whatsapp || {};
  const contact = data?.contact || {};
  return {
    whatsapp: String(wa.number || "254712504593").replace(/\D/g, ""),
    whatsappEnabled: wa.enabled !== false,
    email: String(contact.email || ""),
    phone: String(contact.phone || ""),
  };
}

export function supportWhatsAppUrl(number: string, shop?: string, page?: string) {
  const text = `Hello JMSURF Garage support${shop ? `, this is ${shop}` : ""}. I need help${page ? ` with ${page}` : ""}: `;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
