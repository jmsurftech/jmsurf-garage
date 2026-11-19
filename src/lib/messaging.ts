import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MessagingSettings = {
  sms_mode: "off" | "platform" | "own";
  sms_sender_id: string;
  has_sms_key: boolean;
  wa_mode: "off" | "platform" | "own";
  has_wa_key: boolean;
  auto_receipt_sms: boolean;
  auto_receipt_whatsapp: boolean;
  platform_sms_available: boolean;
  platform_wa_available: boolean;
  sms_units: number;
  sms_price: number;
  sms_total_sent: number;
  /** A JMSURF SMS API key is saved (Settings → Integrations); SMS then goes through it. */
  has_jmsurf_sms?: boolean;
};

/** The shop's SMS / WhatsApp setup (modes and whether keys are saved). */
export function useMessagingSettings() {
  return useQuery({
    queryKey: ["messaging-settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data, error }, secrets] = await Promise.all([
        (supabase as any).rpc("get_messaging_settings"),
        (supabase as any).rpc("integration_secret_status"),
      ]);
      if (error) throw error;
      const has_jmsurf_sms = ((secrets?.data || []) as any[]).some((s) => s.name === "jmsurf_sms_key");
      if (!data) return has_jmsurf_sms ? ({ has_jmsurf_sms, sms_mode: "off", wa_mode: "off" } as MessagingSettings) : null;
      return { ...data, has_jmsurf_sms } as MessagingSettings;
    },
  });
}

export const smsReady = (m?: MessagingSettings | null) =>
  !!m && (!!m.has_jmsurf_sms || (m.sms_mode === "own" && m.has_sms_key) || (m.sms_mode === "platform" && m.platform_sms_available));
export const whatsappReady = (m?: MessagingSettings | null) =>
  !!m && ((m.wa_mode === "own" && m.has_wa_key) || (m.wa_mode === "platform" && m.platform_wa_available));

/** Calls the app server's messaging routes (shop sub-addresses go through www). */
export async function messagingApi(path: "send" | "test" | "balance" | "admin" | "sms-overview" | "jmsurf/balance" | "jmsurf/bulk" | "jmsurf/topup" | "jmsurf/topup-status", body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const base = ""; // same server on every JMSURF Garage address
  try {
    const res = await fetch(`${base}/api/messages/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => ({ ok: false, error: `Server replied ${res.status}` }));
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach the server" };
  }
}

/**
 * `kind` names the event (see src/lib/smsUses.ts and messaging.js MESSAGE_EVENTS; Garage adds job_status,
 * estimate, payment_request, service_reminder, booking, missed_call); without it the message counts as
 * sent by hand. Automatic events are shortened by the server to fit ONE SMS part.
 * WhatsApp goes through the company's WhatsApp Cloud API number when connected, else APIWAP.
 */
export const sendShopMessage = (channel: "sms" | "whatsapp", to: string, text: string, reference?: string, kind?: string) =>
  messagingApi("send", { channel, to, text, reference, kind });

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
/** How many SMS a message uses (GSM-7: 160 / 153 per part; otherwise 70 / 67). Same rule as the server. */
export function smsParts(text: string) {
  const chars = Array.from(String(text || ""));
  const gsm = chars.every((c) => GSM.includes(c));
  const len = gsm ? chars.reduce((n, c) => n + ("^{}\\[~]|€".includes(c) ? 2 : 1), 0) : chars.length;
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return len <= single ? 1 : Math.ceil(len / multi);
}
