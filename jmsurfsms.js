// JMSURF SMS public API client (jmsurfsms.co.ke /api/v1). The shop's API key
// (jms_live_…) is kept server-side in integration_secrets.jmsurf_sms_key.
import { randomUUID } from "node:crypto";

const BASE = (process.env.JMSURF_SMS_URL || "https://jmsurfsms.co.ke").replace(/\/+$/, "");
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

async function call(key, path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    signal: AbortSignal.timeout(method === "POST" ? 30000 : 12000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = str(data?.error?.message || data?.message || data?.error) || `JMSURF SMS replied ${res.status}`;
    return { ok: false, status: res.status, error: msg, code: data?.error?.code };
  }
  return { ok: true, ...data };
}

/** One SMS. */
export const jmsSend = (key, to, message, senderId) =>
  call(key, "/sms/send", { method: "POST", body: { to, message, reference: randomUUID(), ...(senderId ? { sender_id: senderId } : {}) } });

/** Bulk campaign: recipients [{phone, name}] with {name} placeholders in the message. */
export const jmsBulk = (key, { name, message, recipients, senderId, sendAt }) =>
  call(key, "/sms/bulk", {
    method: "POST",
    body: { name: name || "JMSURF Garage campaign", message, recipients, ...(senderId ? { sender_id: senderId } : {}), ...(sendAt ? { send_at: sendAt } : {}) },
  });

export const jmsBalance = (key) => call(key, "/balance");

/** M-Pesa top-up of the SMS wallet: the payer gets a prompt on their phone. */
export const jmsTopup = (key, amount, phone) =>
  call(key, "/topups", { method: "POST", body: { amount: Math.round(Number(amount)), phone, reference: randomUUID() } });

export const jmsTopupStatus = (key, id) => call(key, `/topups/${encodeURIComponent(id)}`);
