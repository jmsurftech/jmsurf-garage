/**
 * What uses SMS: every kind of message JMSURF Garage sends, and which channels each
 * may use. Same keys as MESSAGE_EVENTS in messaging.js on the server, which
 * applies these choices to every send. Saved in erp_settings.sms_uses.
 */
export type MsgChannel = "sms" | "whatsapp";

export type SmsUseEvent = {
  key: string;
  group: "Customers" | "Staff" | "Other";
  label: string;
  when: string;
  /** WhatsApp allowed by default (the sender picks the channel). */
  whatsapp?: boolean;
  /** Always sent (security codes). */
  locked?: boolean;
};

export const SMS_USE_EVENTS: SmsUseEvent[] = [
  // Garage (job cards, bookings, reminders): default texts in messaging.js GARAGE_TEXTS
  { key: "booking_confirmed", group: "Customers", label: "Workshop booking confirmations", when: "When a booking is made", whatsapp: true },
  { key: "booking_reminder", group: "Customers", label: "Workshop booking reminders", when: "Before the booking", whatsapp: true },
  { key: "job_checked_in", group: "Customers", label: "Vehicle checked in (job tag and tracking link)", when: "When a job card is opened", whatsapp: true },
  { key: "estimate_ready", group: "Customers", label: "Estimates to approve", when: "When an estimate is sent", whatsapp: true },
  { key: "extra_work_approval", group: "Customers", label: "Extra work to approve", when: "When the workshop finds more work", whatsapp: true },
  { key: "car_ready", group: "Customers", label: "Vehicle ready for collection", when: "When a job is marked ready", whatsapp: true },
  { key: "payment_received", group: "Customers", label: "Payment received", when: "When a payment is recorded", whatsapp: true },
  { key: "service_due", group: "Customers", label: "Service due reminders", when: "Automatic, by date or mileage", whatsapp: true },
  { key: "document_expiry", group: "Customers", label: "Insurance, inspection, speed governor and PSV expiry", when: "Automatic, before the expiry date", whatsapp: true },
  { key: "win_back", group: "Customers", label: "Win-back messages", when: "Customers who have not visited for a while", whatsapp: true },
  { key: "payment_request", group: "Customers", label: "Invoice and payment links", when: "When you send a payment link", whatsapp: true },
  { key: "missed_call", group: "Customers", label: "Missed-call replies", when: "When a call is missed in the Call Centre", whatsapp: true },
  { key: "debt_reminder", group: "Customers", label: "Unpaid invoice reminders", when: "Automatic, and when you press Remind" },
  { key: "statement", group: "Customers", label: "Customer statements", when: "On the statement schedule" },
  { key: "restock_reminder", group: "Customers", label: "Restock and visit reminders", when: "Automatic" },
  { key: "appointment_booked", group: "Customers", label: "Booking confirmations", when: "When a customer books online" },
  { key: "appointment_reminder", group: "Customers", label: "Appointment reminders", when: "A day before" },
  { key: "event_ticket", group: "Customers", label: "Event registrations", when: "When someone registers" },
  { key: "repair_ready", group: "Customers", label: "Repair ready for collection", when: "When a job is marked ready" },
  { key: "portal_access", group: "Customers", label: "Customer account passwords", when: "When you send account access" },
  { key: "info_request", group: "Customers", label: "Requests for customer details", when: "When you ask a customer for details" },
  { key: "course_link", group: "Customers", label: "Course links", when: "When you send a course" },
  { key: "journey", group: "Customers", label: "Marketing journeys", when: "Each journey step", whatsapp: true },
  { key: "bulk", group: "Customers", label: "Bulk SMS campaigns", when: "Marketing → Bulk SMS" },
  { key: "otp", group: "Customers", label: "Password reset codes", when: "Always sent, for security", locked: true },
  { key: "payslip", group: "Staff", label: "Payslips", when: "When you send payslips" },
  { key: "debt_rep", group: "Staff", label: "Debt alerts to sales reps", when: "Automatic" },
  { key: "note_reminder", group: "Staff", label: "Notebook reminders", when: "At the reminder time" },
  { key: "visitor", group: "Staff", label: "Visitor at reception", when: "When a visitor signs in" },
  { key: "iot_alert", group: "Staff", label: "Device alerts", when: "When a reading is out of range" },
  { key: "water_alert", group: "Staff", label: "Water tank alerts", when: "When a tank runs low" },
  { key: "manual", group: "Other", label: "Messages you send by hand", when: "Receipts, statements and supplier messages you send from a screen", whatsapp: true },
];

export const SMS_USE_LABELS: Record<string, string> = {
  ...Object.fromEntries(SMS_USE_EVENTS.map((e) => [e.key, e.label])),
  receipt: "Sale receipts",
  staff_alert: "Staff alerts",
  test: "Test message",
};

export type SmsUses = {
  events?: Record<string, Partial<Record<MsgChannel, boolean>>>;
  /** Warn when fewer SMS than this are left (0 = never). */
  low_balance?: number;
  /** Also text this number when the balance is low. */
  low_balance_phone?: string;
};

export const DEFAULT_LOW_BALANCE = 100;

/** The channels an event may use (same defaults as the server). */
export function channelsFor(uses: SmsUses | undefined, e: SmsUseEvent): Record<MsgChannel, boolean> {
  if (e.locked) return { sms: true, whatsapp: true };
  const saved = uses?.events?.[e.key] || {};
  return { sms: saved.sms ?? true, whatsapp: saved.whatsapp ?? !!e.whatsapp };
}
