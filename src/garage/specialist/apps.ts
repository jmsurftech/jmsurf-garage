/**
 * Record-engine definitions for the specialist modules. Each AppDef key is the
 * module key, so the engine switches it on and off with the module. Custom pages
 * (claim file, fleet account, shipment, yard car…) read and write the same records.
 */
import type { AppDef, FieldDef, StageDef } from "@/apps/types";

const s = (key: string, label: string, tone: StageDef["tone"], done?: boolean): StageDef => ({ key, label, tone, done });
const f = (key: string, label: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, ...extra });

const NOTES = f("notes", "Notes", "textarea");
const CUSTOMER = f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true });
const PLATE = f("plate", "Number plate", "text", { list: true, half: true, placeholder: "Enter number plate" });
const PHONE = (label = "Phone") => f("phone", label, "phone", { half: true, placeholder: "07XXXXXXXX" });

/* ───────────────────────────── stages (shared with the custom pages) ───────────────────────────── */

export const CLAIM_STAGES: StageDef[] = [
  s("new", "New", "slate"), s("estimate_sent", "Estimate sent", "blue"), s("approved", "Approved", "cyan"),
  s("in_repair", "In repair", "amber"), s("repaired", "Repaired", "violet"), s("invoiced", "Invoiced", "pink"),
  s("paid", "Paid", "green", true), s("declined", "Declined", "red", true),
];
export const INSURER_STAGES: StageDef[] = [s("approved", "Approved garage", "green"), s("applied", "Applied", "amber"), s("not_approved", "Not approved", "slate")];
export const FLEET_STAGES: StageDef[] = [s("active", "Active", "green"), s("suspended", "Suspended", "amber"), s("ended", "Ended", "slate", true)];
export const APPROVAL_STAGES: StageDef[] = [s("pending", "Waiting", "amber"), s("approved", "Approved", "green", true), s("declined", "Declined", "red", true)];
export const CHECK_STAGES: StageDef[] = [s("ok", "All good", "green", true), s("faults", "Faults found", "red"), s("sent", "Sent to workshop", "violet", true)];
export const ORDER_STAGES: StageDef[] = [
  s("draft", "Draft", "slate"), s("ordered", "Ordered", "blue"), s("deposit_paid", "Deposit paid", "cyan"), s("paid", "Paid in full", "violet"),
  s("shipped", "Shipped", "amber"), s("received", "Received", "green", true), s("cancelled", "Cancelled", "red", true),
];
export const SHIPMENT_STAGES: StageDef[] = [
  s("booked", "Booked", "slate"), s("at_sea", "At sea", "blue"), s("at_port", "At Mombasa", "amber"), s("clearing", "Clearing", "violet"),
  s("released", "Released", "cyan"), s("delivered", "Delivered", "green", true),
];
export const PREORDER_STAGES: StageDef[] = [
  s("enquiry", "Enquiry", "slate"), s("deposit_paid", "Deposit paid", "blue"), s("ordered", "Ordered", "cyan"), s("shipped", "Shipped", "amber"),
  s("arrived", "Arrived", "violet"), s("cleared", "Cleared", "pink"), s("delivered", "Delivered", "green", true), s("cancelled", "Cancelled", "red", true),
];
export const REG_STAGES: StageDef[] = [s("pending", "Pending registration", "amber"), s("registered", "Registered", "blue"), s("logbook_in", "Logbook received", "violet"), s("released", "Logbook released", "green", true)];
export const CAR_STAGES: StageDef[] = [
  s("at_sea", "At sea", "blue"), s("at_port", "At port", "cyan"), s("prep", "In prep", "amber"), s("in_yard", "In yard", "violet"),
  s("reserved", "Reserved", "pink"), s("sold", "Sold", "green", true), s("withdrawn", "Withdrawn", "slate", true),
];
export const BP_STAGES: StageDef[] = [
  s("booked", "Booked", "slate"), s("strip", "Strip", "blue"), s("panel", "Panel", "cyan"), s("prep", "Prep", "amber"),
  s("paint", "Paint", "violet"), s("polish", "Polish", "pink"), s("refit", "Refit", "blue"), s("done", "Ready", "green", true),
];
export const WASH_STAGES: StageDef[] = [s("queued", "Waiting", "slate"), s("washing", "Washing", "blue"), s("finishing", "Drying / finishing", "amber"), s("ready", "Ready", "violet"), s("collected", "Collected", "green", true)];
export const TOW_STAGES: StageDef[] = [
  s("requested", "Requested", "red"), s("dispatched", "Dispatched", "amber"), s("on_site", "On site", "violet"), s("in_transit", "Towing", "blue"),
  s("delivered", "Delivered", "cyan"), s("closed", "Closed", "green", true), s("cancelled", "Cancelled", "slate", true),
];
export const HIRE_STAGES: StageDef[] = [s("reserved", "Reserved", "blue"), s("out", "Out on hire", "amber"), s("returned", "Returned", "violet"), s("closed", "Closed", "green", true), s("cancelled", "Cancelled", "slate", true)];
export const HIRE_CAR_STAGES: StageDef[] = [s("available", "Available", "green"), s("hired", "On hire", "amber"), s("maintenance", "In workshop", "red"), s("retired", "Retired", "slate", true)];
export const TRUCK_STAGES: StageDef[] = [s("available", "Available", "green"), s("busy", "On a job", "amber"), s("off", "Off duty", "slate")];

/* ───────────────────────────── apps ───────────────────────────── */

export const SPECIALIST_APP_DEFS: AppDef[] = [
  {
    key: "insurance",
    kinds: [
      {
        key: "claim", label: "Claim", plural: "Claims", prefix: "CLM-", titleLabel: "Vehicle / accident",
        views: ["kanban", "list", "calendar"], stages: CLAIM_STAGES, children: ["courtesy"],
        description: "One file per accident: documents, estimate, assessor approval, repair, invoices and payment.",
        stats: [{ label: "Open claims", where: { stage: ["new", "estimate_sent", "approved", "in_repair", "repaired"] } }, { label: "Approved (open)", sum: "amount", where: { stage: ["approved", "in_repair", "repaired"] } }, { label: "Invoiced, unpaid", sum: "amount", where: { stage: ["invoiced"] } }],
        fields: [
          f("parent_id", "Insurer", "record", { column: "parent_id", ref: "insurer", list: true, half: true, required: true }),
          CUSTOMER,
          PLATE,
          f("assessor", "Assessor", "record", { ref: "assessor", half: true }),
          f("policy_no", "Policy number", "text", { half: true, list: true, placeholder: "Enter policy number" }),
          f("claim_no", "Insurer claim number", "text", { half: true, placeholder: "Enter claim number" }),
          f("starts_at", "Accident date", "date", { column: "starts_at", half: true }),
          f("police_abstract", "Police abstract number", "text", { half: true, placeholder: "Enter OB / abstract number" }),
          f("driver", "Driver at the time", "text", { half: true, placeholder: "Enter driver's name" }),
          f("excess", "Excess (customer pays)", "money", { half: true }),
          f("amount", "Approved amount", "money", { column: "amount", list: true, half: true, help: "Filled in from the assessor-approved lines on the claim file." }),
          f("due_date", "Promised delivery", "date", { column: "due_date", half: true }),
          f("courtesy_car", "Courtesy car given", "checkbox", { half: true }),
          f("description", "How the accident happened", "textarea"),
        ],
      },
      {
        key: "insurer", label: "Insurer", plural: "Insurers", titleLabel: "Insurer name", views: ["list"], stages: INSURER_STAGES, children: ["claim", "assessor"],
        description: "Insurance companies you repair for, and whether you are on their approved-garage list.",
        fields: [
          f("customer_id", "Bill to (customer account)", "customer", { column: "customer_id", half: true, required: true, help: "The insurer's customer account; their invoices and statement go here." }),
          f("approved_until", "Approved-garage until", "date", { column: "due_date", list: true, half: true }),
          f("contact", "Claims contact", "text", { half: true, list: true, placeholder: "Enter contact name" }),
          PHONE("Claims phone"),
          f("email", "Claims email", "email", { half: true, placeholder: "Enter claims email" }),
          f("terms_days", "Pays within (days)", "number", { half: true, defaultValue: 30 }),
          f("remind_every", "Remind every (days) when overdue", "number", { half: true, defaultValue: 7 }),
          f("layout", "Estimate layout", "select", { options: ["Parts / labour / paint sections", "One list", "Parts first, then labour"], defaultValue: "Parts / labour / paint sections", half: true }),
          f("labour_rate", "Agreed labour rate per hour", "money", { half: true }),
          NOTES,
        ],
      },
      {
        key: "assessor", label: "Assessor", plural: "Assessors", titleLabel: "Assessor name", views: ["list"],
        fields: [
          f("parent_id", "Insurer", "record", { column: "parent_id", ref: "insurer", list: true, half: true }),
          f("firm", "Firm", "text", { half: true, list: true, placeholder: "Enter assessing firm" }),
          PHONE(),
          f("email", "Email", "email", { half: true, placeholder: "Enter email" }),
        ],
      },
      {
        key: "courtesy", label: "Courtesy car", plural: "Courtesy cars", titleLabel: "Courtesy car plate", views: ["list", "calendar"],
        stages: [s("out", "Out", "amber"), s("returned", "Returned", "green", true)],
        fields: [
          f("parent_id", "Claim", "record", { column: "parent_id", ref: "claim", list: true, half: true }),
          CUSTOMER,
          f("starts_at", "Given out", "datetime", { column: "starts_at", list: true, half: true }),
          f("ends_at", "Returned", "datetime", { column: "ends_at", half: true }),
          f("km_out", "Mileage out", "number", { half: true }), f("km_in", "Mileage in", "number", { half: true }),
          f("fuel_out", "Fuel out (eighths)", "number", { half: true }), f("fuel_in", "Fuel in (eighths)", "number", { half: true }),
          f("amount", "Daily charge to insurer (if any)", "money", { column: "amount", half: true }),
          NOTES,
        ],
      },
    ],
  },
  {
    key: "fleet_contracts",
    kinds: [
      {
        key: "fleet", label: "Fleet account", plural: "Fleet accounts", prefix: "FLT-", titleLabel: "Fleet / company name", views: ["list"], stages: FLEET_STAGES,
        children: ["fleet_vehicle", "lpo", "approval", "fuel", "daily_check"],
        description: "Contract customers with their vehicles, prices, LPOs, approvals, fuel and monthly invoice.",
        stats: [{ label: "Active fleets", where: { stage: ["active"] } }],
        fields: [
          f("customer_id", "Bill to (customer account)", "customer", { column: "customer_id", list: true, half: true, required: true }),
          f("manager", "Fleet manager", "text", { half: true, list: true, placeholder: "Enter fleet manager's name" }),
          PHONE("Fleet manager phone"),
          f("email", "Fleet manager email", "email", { half: true, placeholder: "Enter email" }),
          f("labour_rate", "Contract labour rate per hour", "money", { half: true }),
          f("parts_markup", "Parts markup on cost %", "percent", { half: true }),
          f("lpo_required", "LPO / LSO number required before work", "checkbox", { half: true, defaultValue: true }),
          f("approval_limit", "Approve online above (amount)", "money", { half: true, help: "Jobs above this need the fleet manager's online approval. Leave empty to approve every job." }),
          f("government", "Government / withholding VAT agent", "checkbox", { half: true }),
          f("wht_rate", "Withholding VAT %", "percent", { half: true, help: "Your setting. Confirm the current rate with KRA." }),
          f("starts_at", "Contract start", "date", { column: "starts_at", half: true }),
          f("ends_at", "Contract end", "date", { column: "ends_at", half: true }),
          f("terms_days", "Pays within (days)", "number", { half: true, defaultValue: 30 }),
          f("schedule", "Service schedule", "lines", { lineFields: [f("service", "Service", "text"), f("every_km", "Every km", "number"), f("every_months", "Every months", "number"), f("price", "Fixed price", "money")] }),
          NOTES,
        ],
      },
      {
        key: "fleet_vehicle", label: "Fleet vehicle", plural: "Fleet vehicles", titleLabel: "Number plate", views: ["list"],
        stages: [s("active", "Active", "green"), s("off_road", "Off road", "amber"), s("disposed", "Disposed", "slate", true)],
        fields: [
          f("parent_id", "Fleet", "record", { column: "parent_id", ref: "fleet", required: true, list: true, half: true }),
          f("driver", "Driver", "text", { half: true, list: true, placeholder: "Enter driver's name" }),
          f("driver_phone", "Driver phone", "phone", { half: true, placeholder: "07XXXXXXXX" }),
          f("department", "Department", "text", { half: true, list: true, placeholder: "Enter department" }),
          f("cost_centre", "Cost centre", "text", { half: true, list: true, placeholder: "Enter cost centre" }),
          f("fuel_card", "Fuel card number", "text", { half: true, placeholder: "Enter fuel card number" }),
          f("every_km", "Service every (km)", "number", { half: true }),
          f("every_months", "Service every (months)", "number", { half: true }),
          f("last_km", "Last service mileage", "number", { half: true }),
          f("last_date", "Last service date", "date", { half: true }),
          f("quantity", "Current mileage", "number", { column: "quantity", half: true }),
        ],
      },
      {
        key: "lpo", label: "LPO / LSO", plural: "LPOs & LSOs", titleLabel: "LPO / LSO number", views: ["list"],
        stages: [s("open", "Open", "blue"), s("used", "Used up", "green", true), s("expired", "Expired", "slate", true)],
        fields: [
          f("parent_id", "Fleet", "record", { column: "parent_id", ref: "fleet", required: true, list: true, half: true }),
          f("type", "Type", "select", { options: ["LPO", "LSO"], defaultValue: "LPO", half: true, list: true }),
          f("amount", "Value", "money", { column: "amount", list: true, half: true }),
          f("starts_at", "Issued", "date", { column: "starts_at", half: true }),
          f("due_date", "Valid until", "date", { column: "due_date", list: true, half: true }),
          f("plate", "For vehicle (plate)", "text", { half: true, placeholder: "Enter number plate" }),
          NOTES,
        ],
      },
      {
        key: "approval", label: "Approval request", plural: "Approvals", titleLabel: "Work to approve", views: ["list", "kanban"], stages: APPROVAL_STAGES,
        fields: [
          f("parent_id", "Fleet", "record", { column: "parent_id", ref: "fleet", required: true, list: true, half: true }),
          f("plate", "Vehicle (plate)", "text", { half: true, list: true, placeholder: "Enter number plate" }),
          f("amount", "Estimate", "money", { column: "amount", list: true, half: true }),
          f("lpo_no", "LPO / LSO number", "text", { half: true, placeholder: "Filled in by the fleet manager" }),
          f("decided_by", "Decided by", "text", { half: true }),
          f("lines", "Work", "lines", { lineFields: [f("description", "Description", "text"), f("qty", "Qty", "number"), f("price", "Price", "money")] }),
          NOTES,
        ],
      },
      {
        key: "fuel", label: "Fuel entry", plural: "Fuel log", titleLabel: "Number plate", views: ["list", "calendar"],
        fields: [
          f("parent_id", "Fleet", "record", { column: "parent_id", ref: "fleet", required: true, list: true, half: true }),
          f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }),
          f("quantity", "Litres", "number", { column: "quantity", list: true, half: true }),
          f("amount", "Amount", "money", { column: "amount", list: true, half: true }),
          f("odometer", "Odometer", "number", { half: true, list: true }),
          f("station", "Station", "text", { half: true, placeholder: "Enter station" }),
          f("card", "Fuel card", "text", { half: true }),
        ],
      },
      {
        key: "daily_check", label: "Driver check", plural: "Driver checks", titleLabel: "Vehicle / date", views: ["list"], stages: CHECK_STAGES,
        fields: [
          f("parent_id", "Fleet", "record", { column: "parent_id", ref: "fleet", list: true, half: true }),
          f("driver", "Driver", "text", { half: true, list: true }),
          f("odometer", "Odometer", "number", { half: true }),
          f("starts_at", "Checked at", "datetime", { column: "starts_at", list: true, half: true }),
          f("faults", "Faults", "textarea"),
        ],
      },
    ],
  },
  {
    key: "imports",
    kinds: [
      {
        key: "import_order", label: "Import order", plural: "Import orders", prefix: "IMP-", titleLabel: "Order description", views: ["kanban", "list"], stages: ORDER_STAGES,
        description: "Orders to overseas suppliers and auctions, paid in their currency.",
        stats: [{ label: "Open orders", where: { stage: ["ordered", "deposit_paid", "paid", "shipped"] } }, { label: "Value (open, company currency)", sum: "amount", where: { stage: ["ordered", "deposit_paid", "paid", "shipped"] } }],
        fields: [
          f("supplier_id", "Supplier / auction", "supplier", { column: "supplier_id", list: true, half: true, required: true }),
          f("country", "Country", "select", { options: ["Japan", "United Kingdom", "United Arab Emirates", "Thailand", "South Africa", "China", "Singapore", "Other"], half: true, list: true }),
          f("currency", "Currency", "select", { options: ["USD", "JPY", "GBP", "AED", "CNY", "EUR", "ZAR", "THB", "KES"], half: true, defaultValue: "USD" }),
          f("rate", "Exchange rate on the order", "number", { half: true, help: "Company currency for one unit of the order currency." }),
          f("shipment", "Shipment", "record", { ref: "shipment", half: true }),
          f("starts_at", "Order date", "date", { column: "starts_at", half: true }),
          f("amount", "Value in company currency", "money", { column: "amount", list: true, half: true, help: "Worked out on the order page." }),
          NOTES,
        ],
      },
      {
        key: "shipment", label: "Shipment", plural: "Shipments", prefix: "SHP-", titleLabel: "Container / B/L", views: ["kanban", "list", "calendar"], stages: SHIPMENT_STAGES,
        stats: [{ label: "On the way", where: { stage: ["booked", "at_sea"] } }, { label: "At port / clearing", where: { stage: ["at_port", "clearing"] } }],
        fields: [
          f("bl_no", "Bill of lading", "text", { half: true, list: true, placeholder: "Enter B/L number" }),
          f("booking_no", "Booking number", "text", { half: true, placeholder: "Enter booking number" }),
          f("vessel", "Vessel / voyage", "text", { half: true, list: true, placeholder: "Enter vessel and voyage" }),
          f("container", "Container number(s)", "text", { half: true, placeholder: "Enter container numbers" }),
          f("port_from", "Port of loading", "text", { half: true, placeholder: "Enter port of loading" }),
          f("due_date", "ETA Mombasa", "date", { column: "due_date", list: true, half: true }),
          f("arrived", "Arrived on", "date", { half: true }),
          f("free_days", "Free days at port", "number", { half: true }),
          f("demurrage_rate", "Demurrage / storage per day", "money", { half: true }),
          f("agent", "Clearing agent", "record", { ref: "clearing_agent", half: true }),
          NOTES,
        ],
      },
      {
        key: "preorder", label: "Customer pre-order", plural: "Pre-orders", prefix: "PRE-", titleLabel: "Vehicle wanted", views: ["kanban", "list"], stages: PREORDER_STAGES,
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true, required: true }),
          f("budget", "Budget", "money", { half: true }),
          f("amount", "Agreed price", "money", { column: "amount", list: true, half: true }),
          f("deposit", "Deposit paid", "money", { half: true, list: true }),
          f("order", "Import order", "record", { ref: "import_order", half: true }),
          f("due_date", "Expected delivery", "date", { column: "due_date", half: true }),
          f("spec", "Specification (year, mileage, colour, grade…)", "textarea"),
        ],
      },
      {
        key: "clearing_agent", label: "Clearing agent", plural: "Clearing agents", titleLabel: "Agent name", views: ["list"],
        fields: [
          f("supplier_id", "Supplier account (for bills)", "supplier", { column: "supplier_id", half: true }),
          PHONE(),
          f("email", "Email", "email", { half: true, placeholder: "Enter email" }),
          f("licence", "Customs agent licence number", "text", { half: true, placeholder: "Enter licence number" }),
          f("amount", "Usual agency fee", "money", { column: "amount", half: true, list: true }),
          NOTES,
        ],
      },
      {
        key: "registration", label: "Registration", plural: "NTSA & logbooks", titleLabel: "Chassis / vehicle", views: ["list", "kanban"], stages: REG_STAGES,
        fields: [
          f("customer_id", "Owner", "customer", { column: "customer_id", list: true, half: true }),
          f("plate", "Registration number", "text", { half: true, list: true, placeholder: "Enter registration number" }),
          f("chassis", "Chassis number", "text", { half: true, placeholder: "Enter chassis number" }),
          f("starts_at", "Submitted to NTSA", "date", { column: "starts_at", half: true }),
          f("due_date", "Logbook expected", "date", { column: "due_date", half: true, list: true }),
          f("amount", "Fees paid", "money", { column: "amount", half: true }),
          NOTES,
        ],
      },
    ],
  },
  {
    key: "vehicle_yard",
    kinds: [
      {
        key: "car", label: "Car", plural: "Stock cars", prefix: "CAR-", titleLabel: "Make, model and year", views: ["kanban", "list"], stages: CAR_STAGES,
        description: "Cars for sale: photos, specs, costs, reservation, sale and logbook transfer.",
        stats: [{ label: "In yard", where: { stage: ["in_yard", "prep"] } }, { label: "Stock value (asking)", sum: "amount", where: { stage: ["at_sea", "at_port", "prep", "in_yard", "reserved"] } }, { label: "Sold", where: { stage: ["sold"] } }],
        fields: [
          f("make", "Make", "text", { half: true, placeholder: "Enter make" }), f("model", "Model", "text", { half: true, placeholder: "Enter model" }),
          f("year", "Year", "number", { half: true, list: true }), f("mileage", "Mileage (km)", "number", { half: true, list: true }),
          f("amount", "Asking price", "money", { column: "amount", list: true, half: true }),
          f("min_price", "Lowest price", "money", { half: true }),
          f("colour", "Colour", "text", { half: true }), f("engine_cc", "Engine (cc)", "number", { half: true }),
          f("fuel", "Fuel", "select", { options: ["Petrol", "Diesel", "Hybrid", "Electric"], half: true }),
          f("transmission", "Transmission", "select", { options: ["Automatic", "Manual"], half: true }),
          f("body", "Body type", "select", { options: ["Saloon", "Hatchback", "Station wagon", "SUV", "Pick-up", "Van", "Bus", "Truck", "Coupe", "Other"], half: true }),
          f("chassis", "Chassis / VIN", "text", { half: true }), f("plate", "Number plate", "text", { half: true }),
          f("location", "Location", "text", { half: true, list: true, placeholder: "Enter yard / branch" }),
          f("cost", "Purchase / landed cost", "money", { half: true }),
          f("listed", "Show on the public listings page", "checkbox", { half: true, defaultValue: true }),
          f("features", "Features", "textarea"),
          f("description", "Description", "textarea"),
        ],
      },
      {
        key: "enquiry", label: "Enquiry", plural: "Enquiries", titleLabel: "Name", views: ["list", "kanban"],
        stages: [s("new", "New", "red"), s("contacted", "Contacted", "amber"), s("test_drive", "Test drive", "blue"), s("closed", "Closed", "slate", true)],
        fields: [PHONE(), f("car", "Car", "record", { ref: "car", half: true, list: true }), CUSTOMER, f("message", "Message", "textarea")],
      },
      {
        key: "valuation", label: "Trade-in valuation", plural: "Trade-ins", titleLabel: "Vehicle", views: ["list"],
        stages: [s("valued", "Valued", "blue"), s("accepted", "Accepted", "green", true), s("declined", "Declined", "slate", true)],
        fields: [
          CUSTOMER, PLATE,
          f("year", "Year", "number", { half: true }), f("mileage", "Mileage", "number", { half: true }),
          f("condition", "Condition", "select", { options: ["Excellent", "Good", "Fair", "Needs work"], half: true }),
          f("market", "Market value", "money", { half: true }), f("repairs", "Repairs needed", "money", { half: true }),
          f("amount", "Offered value", "money", { column: "amount", list: true, half: true }),
          f("against", "Against car", "record", { ref: "car", half: true }),
          NOTES,
        ],
      },
    ],
  },
  {
    key: "body_paint",
    kinds: [
      {
        key: "bp_job", label: "Body job", plural: "Body & paint jobs", prefix: "BP-", titleLabel: "Vehicle", views: ["kanban", "list", "calendar"], stages: BP_STAGES,
        description: "Panel estimates, paint costing, booth booking and stage tracking.",
        stats: [{ label: "In the shop", where: { stage: ["strip", "panel", "prep", "paint", "polish", "refit"] } }, { label: "Work value (open)", sum: "amount", where: { stage: ["booked", "strip", "panel", "prep", "paint", "polish", "refit"] } }],
        fields: [
          CUSTOMER, PLATE,
          f("colour_code", "Paint / colour code", "text", { half: true, placeholder: "Enter colour code" }),
          f("booth", "Booth", "select", { options: ["Booth 1", "Booth 2", "Booth 3"], half: true, list: true }),
          f("starts_at", "Booth from", "datetime", { column: "starts_at", half: true }),
          f("ends_at", "Booth until", "datetime", { column: "ends_at", half: true }),
          f("employee_id", "Painter", "employee", { column: "employee_id", half: true, list: true }),
          f("due_date", "Promised", "date", { column: "due_date", half: true }),
          f("amount", "Estimate total", "money", { column: "amount", list: true, half: true }),
          NOTES,
        ],
      },
    ],
  },
  {
    key: "car_wash",
    kinds: [
      {
        key: "wash", label: "Wash", plural: "Washes", prefix: "W-", titleLabel: "Number plate", views: ["kanban", "list"], stages: WASH_STAGES,
        stats: [{ label: "In the bay", where: { stage: ["queued", "washing", "finishing", "ready"] } }, { label: "Takings (all)", sum: "amount" }],
        fields: [
          CUSTOMER, PHONE(),
          f("package", "Package", "record", { ref: "package", half: true, list: true }),
          f("employee_id", "Washer", "employee", { column: "employee_id", half: true, list: true }),
          f("amount", "Price", "money", { column: "amount", list: true, half: true }),
          f("free", "Free (loyalty)", "checkbox", { half: true }),
          f("paid", "Paid", "checkbox", { half: true }),
          NOTES,
        ],
      },
      {
        key: "package", label: "Package / add-on", plural: "Packages", titleLabel: "Name", views: ["list"],
        fields: [
          f("type", "Type", "select", { options: ["Package", "Add-on"], defaultValue: "Package", half: true, list: true }),
          f("amount", "Price", "money", { column: "amount", list: true, half: true }),
          f("minutes", "Takes (minutes)", "number", { half: true }),
          f("commission_pct", "Washer commission %", "percent", { half: true }),
          f("commission_fixed", "Washer commission per wash", "money", { half: true }),
          f("includes", "Includes", "textarea"),
        ],
      },
      {
        key: "subscription", label: "Subscription", plural: "Subscriptions", prefix: "SUB-", titleLabel: "Plan / plate", views: ["list"],
        stages: [s("active", "Active", "green"), s("expired", "Expired", "slate", true), s("cancelled", "Cancelled", "red", true)],
        fields: [
          CUSTOMER, PLATE,
          f("quantity", "Washes per month", "number", { column: "quantity", half: true, list: true }),
          f("amount", "Monthly price", "money", { column: "amount", half: true, list: true }),
          f("starts_at", "Starts", "date", { column: "starts_at", half: true }),
          f("ends_at", "Paid until", "date", { column: "ends_at", half: true, list: true }),
          f("package", "Package", "record", { ref: "package", half: true }),
        ],
      },
    ],
  },
  {
    key: "tyres",
    kinds: [
      {
        key: "tyre_job", label: "Tyre job", plural: "Tyre & alignment jobs", prefix: "TY-", titleLabel: "Vehicle", views: ["list", "kanban"],
        stages: [s("waiting", "Waiting", "slate"), s("working", "Working", "amber"), s("done", "Done", "green", true)],
        fields: [
          CUSTOMER, PLATE,
          f("type", "Work", "multiselect", { options: ["Fitting", "Wheel alignment", "Balancing", "Rotation", "Puncture repair", "Valve / TPMS", "Nitrogen"], list: true }),
          f("size", "Tyre size", "text", { half: true, placeholder: "e.g. 195/65R15" }),
          f("dot", "DOT code of tyres fitted", "text", { half: true, placeholder: "Enter DOT code" }),
          f("mileage", "Mileage", "number", { half: true }),
          f("employee_id", "Technician", "employee", { column: "employee_id", half: true }),
          f("readings", "Alignment readings", "lines", { lineFields: [f("wheel", "Wheel / axle", "text"), f("measure", "Camber / caster / toe", "text"), f("spec", "Spec", "text"), f("before", "Before", "text"), f("after", "After", "text")] }),
          f("balance", "Balancing weights", "lines", { lineFields: [f("wheel", "Wheel", "text"), f("inner", "Inner (g)", "number"), f("outer", "Outer (g)", "number")] }),
          f("amount", "Charge", "money", { column: "amount", list: true, half: true }),
          NOTES,
        ],
      },
      {
        key: "tyre_hotel", label: "Stored tyres", plural: "Tyre hotel", prefix: "TH-", titleLabel: "Customer / set", views: ["list"],
        stages: [s("stored", "In storage", "blue"), s("collected", "Collected", "green", true)],
        fields: [
          CUSTOMER, PLATE,
          f("size", "Size", "text", { half: true, list: true }), f("brand", "Brand", "text", { half: true }),
          f("quantity", "How many", "number", { column: "quantity", half: true, list: true, defaultValue: 4 }),
          f("dot", "DOT codes", "text", { half: true }),
          f("rack", "Rack / bin", "text", { half: true, list: true, placeholder: "Enter rack or bin" }),
          f("starts_at", "Stored on", "date", { column: "starts_at", half: true }),
          f("ends_at", "Paid until", "date", { column: "ends_at", half: true }),
          f("amount", "Storage fee", "money", { column: "amount", half: true }),
          f("tread", "Tread depth (mm) per tyre", "text", { half: true }),
        ],
      },
      {
        key: "battery", label: "Battery", plural: "Batteries", titleLabel: "Serial number", views: ["list"],
        stages: [s("in_warranty", "Under warranty", "green"), s("expired", "Warranty ended", "slate", true), s("replaced", "Replaced under warranty", "violet", true)],
        fields: [
          CUSTOMER, PLATE,
          f("brand", "Brand / model", "text", { half: true, list: true }),
          f("product_id", "Item sold", "product", { column: "product_id", half: true }),
          f("starts_at", "Sold / fitted on", "date", { column: "starts_at", half: true, list: true }),
          f("months", "Warranty (months)", "number", { half: true, defaultValue: 12 }),
          f("invoice_no", "Invoice / receipt number", "text", { half: true }),
          f("tests", "Tests", "lines", { lineFields: [f("date", "Date", "date"), f("volts", "Volts", "number"), f("cca", "CCA measured", "number"), f("result", "Result", "text")] }),
        ],
      },
    ],
  },
  {
    key: "towing",
    kinds: [
      {
        key: "tow", label: "Call-out", plural: "Call-outs", prefix: "TOW-", titleLabel: "Caller / vehicle", views: ["kanban", "list"], stages: TOW_STAGES,
        stats: [{ label: "Live call-outs", where: { stage: ["requested", "dispatched", "on_site", "in_transit"] } }, { label: "Billed (all)", sum: "amount" }],
        fields: [
          f("type", "Service", "select", { options: ["Tow", "Mobile mechanic", "Jump start", "Tyre change", "Fuel delivery", "Lock-out", "Recovery"], defaultValue: "Tow", half: true, list: true }),
          CUSTOMER, PHONE("Caller phone"), PLATE,
          f("pickup", "Pick-up place", "text", { half: true, placeholder: "Enter pick-up place" }),
          f("drop", "Drop-off place", "text", { half: true, placeholder: "Enter drop-off place" }),
          f("truck", "Truck", "record", { ref: "truck", half: true, list: true }),
          f("employee_id", "Driver / mechanic", "employee", { column: "employee_id", half: true }),
          f("km", "Distance (km)", "number", { half: true }),
          f("amount", "Price", "money", { column: "amount", list: true, half: true }),
          f("insurer", "Insurer (towing claim)", "record", { ref: "insurance.insurer", half: true }),
          f("claim_no", "Insurer claim / authority number", "text", { half: true }),
          NOTES,
        ],
      },
      {
        key: "truck", label: "Truck / van", plural: "Trucks & vans", titleLabel: "Number plate", views: ["list"], stages: TRUCK_STAGES,
        fields: [
          f("type", "Type", "select", { options: ["Flatbed", "Wheel-lift", "Heavy recovery", "Service van", "Motorbike"], half: true, list: true }),
          f("employee_id", "Driver", "employee", { column: "employee_id", half: true, list: true }),
          f("phone", "Driver phone", "phone", { half: true, placeholder: "07XXXXXXXX" }),
        ],
      },
    ],
  },
  {
    key: "car_hire",
    kinds: [
      {
        key: "booking", label: "Booking", plural: "Bookings", prefix: "HIRE-", titleLabel: "Hirer / purpose", views: ["calendar", "list", "kanban"], stages: HIRE_STAGES,
        stats: [{ label: "Out on hire", where: { stage: ["out"] } }, { label: "Upcoming", where: { stage: ["reserved"] } }],
        fields: [
          f("parent_id", "Car", "record", { column: "parent_id", ref: "hire_car", required: true, list: true, half: true }),
          CUSTOMER,
          f("starts_at", "Pick-up", "datetime", { column: "starts_at", list: true, half: true }),
          f("ends_at", "Return", "datetime", { column: "ends_at", list: true, half: true }),
          f("amount", "Hire amount", "money", { column: "amount", list: true, half: true }),
          f("deposit", "Deposit", "money", { half: true }),
          f("licence", "Driving licence number", "text", { half: true, placeholder: "Enter licence number" }),
          f("id_no", "ID / passport number", "text", { half: true, placeholder: "Enter ID or passport number" }),
          f("with_driver", "With driver", "checkbox", { half: true }),
          f("destination", "Destination / use", "text", { half: true }),
          NOTES,
        ],
      },
      {
        key: "hire_car", label: "Hire car", plural: "Hire fleet", titleLabel: "Make and model", views: ["list"], stages: HIRE_CAR_STAGES, children: ["booking"],
        fields: [
          f("plate", "Number plate", "text", { half: true, list: true, required: true, placeholder: "Enter number plate" }),
          f("category", "Category", "select", { options: ["Economy", "Saloon", "SUV", "4x4", "Van", "Minibus", "Luxury"], half: true, list: true }),
          f("amount", "Daily rate", "money", { column: "amount", list: true, half: true }),
          f("deposit", "Deposit", "money", { half: true }),
          f("km_per_day", "Free km per day", "number", { half: true }),
          f("extra_km", "Charge per extra km", "money", { half: true }),
          f("fuel_eighth", "Charge per missing 1/8 tank", "money", { half: true }),
          f("service_km", "Service every (km)", "number", { half: true }),
          f("quantity", "Current mileage", "number", { column: "quantity", half: true }),
        ],
      },
    ],
  },
];
