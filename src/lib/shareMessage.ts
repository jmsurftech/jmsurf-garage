/**
 * Opens WhatsApp or the phone's SMS app with a message already written, so a
 * receipt or statement can be sent without any paid messaging service.
 */

/** Digits in international form. Numbers starting 0 are treated as Kenyan (+254). */
export function toInternational(phone: string, defaultCountryCode = "254"): string {
  let d = String(phone || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return defaultCountryCode + d.slice(1);
  return d;
}

export function openWhatsApp(phone: string, text: string) {
  const to = toInternational(phone);
  const url = `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener");
}

export function openSms(phone: string, text: string) {
  // iOS uses "&body", Android accepts "?body"; "?&body" works on both.
  const to = phone.trim().startsWith("+") ? phone.replace(/[^\d+]/g, "") : phone.replace(/\D/g, "");
  window.location.href = `sms:${to}?&body=${encodeURIComponent(text)}`;
}

export const looksLikePhone = (phone: string) => /^\+?\d{7,15}$/.test(String(phone || "").replace(/[\s\-().]/g, ""));
