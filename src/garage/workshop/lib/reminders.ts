import { customerUrl } from "@/lib/host";
/**
 * Service and document reminders: what is due for a vehicle on a given day, the message
 * texts (English and Swahili) and the SMS length counter.
 *
 * garage-workshop.js (the server job) uses the same rules in plain JavaScript; keep the two
 * in step (dueItems / render / smsParts).
 */
export type ReminderKind = "service" | "insurance" | "inspection" | "speed_governor" | "psv" | "winback" | "booking";
export type Lang = "en" | "sw";

export interface KindSettings { on: boolean; lead_days: number; text_en: string; text_sw: string }
export interface ReminderSettings {
  enabled: boolean;
  channel: "sms" | "whatsapp";
  lang: Lang;
  send_hour: number;
  kinds: Record<ReminderKind, KindSettings>;
  /** Months after the last visit to send a "we miss you" message. */
  winback_months: number[];
  /** Km before the service mileage to send the service reminder. */
  lead_km: number;
}

export const KIND_LABEL: Record<ReminderKind, string> = {
  service: "Service due", insurance: "Insurance expiry", inspection: "Inspection expiry", speed_governor: "Speed governor expiry",
  psv: "PSV licence expiry", winback: "We miss you (6 / 12 months)", booking: "Booking reminder (day before)",
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  channel: "sms",
  lang: "en",
  send_hour: 9,
  lead_km: 500,
  winback_months: [6, 12],
  kinds: {
    service: { on: true, lead_days: 7, text_en: "Hi {name}, {plate} is due for service on {date}. Book at {garage}: {link} or call {phone}.", text_sw: "Habari {name}, {plate} inahitaji service tarehe {date}. Weka nafasi {garage}: {link} au piga {phone}." },
    insurance: { on: true, lead_days: 14, text_en: "Hi {name}, the insurance for {plate} expires on {date}. Renew in time to stay covered. {garage} {phone}", text_sw: "Habari {name}, bima ya {plate} inaisha tarehe {date}. Lipia mapema. {garage} {phone}" },
    inspection: { on: true, lead_days: 14, text_en: "Hi {name}, the inspection for {plate} expires on {date}. We can prepare it for you: {link} {garage}", text_sw: "Habari {name}, ukaguzi wa {plate} unaisha tarehe {date}. Tunaweza kuiandaa: {link} {garage}" },
    speed_governor: { on: true, lead_days: 14, text_en: "Hi {name}, the speed governor certificate for {plate} expires on {date}. Call {garage} on {phone}.", text_sw: "Habari {name}, cheti cha speed governor cha {plate} kinaisha {date}. Piga {garage} {phone}." },
    psv: { on: false, lead_days: 14, text_en: "Hi {name}, the PSV licence for {plate} expires on {date}. Call {garage} on {phone}.", text_sw: "Habari {name}, leseni ya PSV ya {plate} inaisha {date}. Piga {garage} {phone}." },
    winback: { on: false, lead_days: 0, text_en: "Hi {name}, it has been a while since {plate} visited {garage}. Book a check-up: {link}", text_sw: "Habari {name}, ni muda tangu {plate} itembelee {garage}. Weka nafasi ya ukaguzi: {link}" },
    booking: { on: true, lead_days: 1, text_en: "Reminder: {plate} is booked at {garage} on {date}. To change it call {phone}.", text_sw: "Kumbusho: {plate} imewekwa {garage} tarehe {date}. Kubadilisha piga {phone}." },
  },
};

/** Saved settings merged over the defaults. */
export function reminderSettings(saved: any): ReminderSettings {
  const s = saved && typeof saved === "object" ? saved : {};
  const kinds = { ...DEFAULT_REMINDERS.kinds } as Record<ReminderKind, KindSettings>;
  for (const k of Object.keys(kinds) as ReminderKind[]) kinds[k] = { ...kinds[k], ...(s.kinds?.[k] || {}) };
  return { ...DEFAULT_REMINDERS, ...s, kinds, winback_months: Array.isArray(s.winback_months) ? s.winback_months : DEFAULT_REMINDERS.winback_months };
}

const DAY = 86_400_000;
/** Calendar day number in Nairobi time (UTC+3). */
export const nairobiDay = (ms: number) => Math.floor((ms + 3 * 3600_000) / DAY);
const dayOf = (iso: string) => nairobiDay(Date.parse(iso.length === 10 ? `${iso}T00:00:00+03:00` : iso));

export interface VehicleForReminders {
  id: string;
  mileage?: number | null;
  next_service_date?: string | null;
  next_service_km?: number | null;
  last_service_at?: string | null;
  insurance_expiry?: string | null;
  inspection_expiry?: string | null;
  speed_governor_expiry?: string | null;
  psv_expiry?: string | null;
  /** Average km per day from the mileage log (optional). */
  km_per_day?: number | null;
  /** When the mileage was last read (optional). */
  mileage_at?: string | null;
}

export interface DueItem { kind: ReminderKind; due: string; key: string }

const EXPIRY: [ReminderKind, keyof VehicleForReminders][] = [
  ["insurance", "insurance_expiry"], ["inspection", "inspection_expiry"], ["speed_governor", "speed_governor_expiry"], ["psv", "psv_expiry"],
];

/** Km the car has probably done by today, from the last reading and the usual km per day. */
export function estimatedMileage(v: VehicleForReminders, now: number): number | null {
  if (v.mileage === null || v.mileage === undefined) return null;
  if (!v.km_per_day || !v.mileage_at) return Number(v.mileage);
  const days = Math.max(0, (now - Date.parse(v.mileage_at)) / DAY);
  return Math.round(Number(v.mileage) + days * Number(v.km_per_day));
}

/** Average km per day from mileage readings (oldest to newest); null with too little data. */
export function kmPerDay(readings: { mileage: number; at: string }[]): number | null {
  const r = [...readings].filter((x) => Number.isFinite(Number(x.mileage))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (r.length < 2) return null;
  const first = r[0], last = r[r.length - 1];
  const days = (Date.parse(last.at) - Date.parse(first.at)) / DAY;
  const km = Number(last.mileage) - Number(first.mileage);
  if (days < 7 || km <= 0) return null;
  return Math.round((km / days) * 10) / 10;
}

const iso = (dayNo: number) => new Date(dayNo * DAY).toISOString().slice(0, 10);

/**
 * Reminders due today for one vehicle. Each item has a key that is the same every day
 * for the same due date, so the log sends it once only. Nothing is sent for things more
 * than a week past due (stale data), except the service by mileage.
 */
export function dueItems(v: VehicleForReminders, cfg: ReminderSettings, now = Date.now()): DueItem[] {
  const today = nairobiDay(now);
  const out: DueItem[] = [];
  const k = cfg.kinds;

  if (k.service?.on) {
    let hit: DueItem | null = null;
    if (v.next_service_date) {
      const d = dayOf(v.next_service_date);
      if (today >= d - (Number(k.service.lead_days) || 0) && today <= d + 7) hit = { kind: "service", due: v.next_service_date.slice(0, 10), key: `service:${v.id}:${v.next_service_date.slice(0, 10)}` };
    }
    if (!hit && v.next_service_km) {
      const est = estimatedMileage(v, now);
      if (est !== null && est >= Number(v.next_service_km) - (Number(cfg.lead_km) || 0)) {
        hit = { kind: "service", due: `${v.next_service_km} km`, key: `service:${v.id}:km${v.next_service_km}` };
      }
    }
    if (hit) out.push(hit);
  }

  for (const [kind, col] of EXPIRY) {
    const val = v[col] as string | null | undefined;
    if (!k[kind]?.on || !val) continue;
    const d = dayOf(val);
    if (today >= d - (Number(k[kind].lead_days) || 0) && today <= d + 7) out.push({ kind, due: val.slice(0, 10), key: `${kind}:${v.id}:${val.slice(0, 10)}` });
  }

  if (k.winback?.on && v.last_service_at) {
    const last = dayOf(v.last_service_at);
    for (const months of cfg.winback_months || []) {
      const d = new Date(Date.parse(v.last_service_at));
      d.setUTCMonth(d.getUTCMonth() + Number(months));
      const at = nairobiDay(d.getTime());
      if (today >= at && today <= at + 14) out.push({ kind: "winback", due: iso(at), key: `winback${months}:${v.id}:${iso(last)}` });
    }
  }
  return out;
}

/** Bookings to remind today: those starting tomorrow (Nairobi calendar), once the send hour has passed. */
export function bookingDue(startsAt: string, cfg: ReminderSettings, now = Date.now()): boolean {
  if (!cfg.kinds.booking?.on) return false;
  const hour = new Date(now + 3 * 3600_000).getUTCHours();
  const lead = Math.max(1, Number(cfg.kinds.booking.lead_days) || 1);
  const start = Date.parse(startsAt);
  if (!(start > now)) return false;
  const diff = nairobiDay(start) - nairobiDay(now);
  return diff >= 1 && diff <= lead && hour >= (Number(cfg.send_hour) || 0);
}

/** Fills {name}, {plate}… in a message. Unknown fields become empty. */
export function render(template: string, vars: Record<string, string | number | null | undefined>): string {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => (vars[key] === null || vars[key] === undefined ? "" : String(vars[key])))
    .replace(/[ \t]{2,}/g, " ").trim();
}

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM_EXT = "^{}\\[~]|€";

/** SMS length: characters used, parts, and the limit of one part (160 plain, 70 with emoji/special letters). */
export function smsInfo(text: string): { length: number; parts: number; limit: number; unicode: boolean } {
  const chars = Array.from(String(text || ""));
  const gsm = chars.every((c) => GSM.includes(c));
  const length = gsm ? chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0) : chars.length;
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return { length, parts: length <= single ? 1 : Math.ceil(length / multi), limit: single, unicode: !gsm };
}

/** Sample values used to measure a template (longest realistic values, so the real message still fits). */
export const MEASURE_VARS = {
  name: "Xxxxxxxxx", plate: "KDA 123A", date: "28 Nov 2026", garage: "Xxxxxxxxxxxxxxxx", phone: "07XXXXXXXX",
  link: "app.jmsurfgarage.co.ke/book/xxxxxxxxxx",
};

/** Short public link for a garage page whose path names the company (no https://, so it fits in one SMS part). */
export const shortLink = (path: string) => customerUrl(path).replace(/^https?:\/\//, "").replace(/^(app\.jmsurfgarage\.co\.ke)\/[a-z0-9-]+(?=\/)/, "$1");
