import { describe, expect, it } from "vitest";
import { GARAGE_TEXTS, garageText, MESSAGE_EVENTS, eventChannels, isAutomaticEvent } from "../../../messaging.js";
import { smsPartsOf } from "../../../integrations-core.js";
import { SMS_USE_EVENTS } from "@/lib/smsUses";

const KEYS = ["booking_confirmed", "booking_reminder", "job_checked_in", "estimate_ready", "extra_work_approval", "car_ready", "service_due", "document_expiry", "win_back", "payment_received"];

describe("garage message events", () => {
  it("every event exists on the server, in What uses SMS, and has a default text", () => {
    for (const k of KEYS) {
      expect(MESSAGE_EVENTS[k]).toBeTruthy();
      expect(GARAGE_TEXTS[k]).toBeTruthy();
      expect(SMS_USE_EVENTS.some((e) => e.key === k)).toBe(true);
      expect(isAutomaticEvent(k)).toBe(true);
    }
  });
  it("each default text fits one SMS with realistic values", () => {
    const vars = { company: "Acme Motors Westlands", name: "Customer", reg: "KDA 123A", date: "Mon 24 Nov", time: "9:00", job: "JC-0042", link: "https://acme.garage.jmsurf.co.ke/t/0123456789abcdef", amount: "12,500", total: "48,300", item: "front brake pads and discs", doc: "speed governor certificate", receipt: "TKA1B2C3D4" };
    for (const k of Object.keys(GARAGE_TEXTS)) expect(smsPartsOf(garageText(k, vars))).toBe(1);
  });
  it("fills placeholders and drops labels whose value is missing", () => {
    expect(garageText("job_checked_in", { company: "Acme", reg: "KDA 123A", job: "JC-1", link: "https://x.garage.jmsurf.co.ke/t/1" }))
      .toBe("Acme: KDA 123A is checked in, job JC-1. Follow the progress here: https://x.garage.jmsurf.co.ke/t/1");
    expect(garageText("payment_received", { company: "Acme", amount: "500", reg: "KDA 123A" })).toBe("Acme: we received KES 500 for KDA 123A. Thank you!");
  });
  it("companies can switch each event per channel", () => {
    expect(eventChannels({}, "car_ready")).toEqual({ sms: true, whatsapp: true });
    expect(eventChannels({ events: { car_ready: { sms: false } } }, "car_ready")).toEqual({ sms: false, whatsapp: true });
  });
});
