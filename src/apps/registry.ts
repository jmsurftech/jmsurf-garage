import type { AppDef, FieldDef, KindDef, StageDef } from "./types";

const s = (key: string, label: string, tone: StageDef["tone"], done?: boolean): StageDef => ({ key, label, tone, done });
const f = (key: string, label: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, ...extra });

const OPEN_DONE = [s("open", "Open", "blue"), s("in_progress", "In progress", "amber"), s("done", "Done", "green", true), s("cancelled", "Cancelled", "slate", true)];
const PRIORITY = f("priority", "Priority", "select", { column: "priority", options: ["Low", "Normal", "High", "Urgent"], defaultValue: "Normal", half: true });
const OWNER = f("assigned_to", "Owner", "user", { column: "assigned_to", list: true, half: true });
const NOTES = f("notes", "Notes", "textarea");

/** Every engine-backed module. Keys match src/lib/modules.ts. */
export const APPS: AppDef[] = [
  // ── Projects ───────────────────────────────────────────────────────────
  {
    key: "projects",
    kinds: [
      {
        key: "project", label: "Project", plural: "Projects", prefix: "PRJ-", titleLabel: "Project name",
        views: ["kanban", "list", "calendar"], children: ["milestone", "task", "timesheet", "project_expense"],
        stages: [s("planning", "Planning", "slate"), s("active", "Active", "blue"), s("on_hold", "On hold", "amber"), s("completed", "Completed", "green", true), s("cancelled", "Cancelled", "red", true)],
        stats: [{ label: "Active projects", where: { stage: ["active"] } }, { label: "Budget (active)", sum: "amount", where: { stage: ["planning", "active"] } }],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true }),
          { ...OWNER, label: "Project manager" },
          f("starts_at", "Start date", "date", { column: "starts_at", half: true }),
          f("due_date", "Deadline", "date", { column: "due_date", list: true, half: true }),
          f("billing", "Billing method", "select", { options: ["Fixed price", "Time & materials (task rate)", "Time & materials (staff rate)", "Not billable"], half: true, defaultValue: "Fixed price" }),
          f("amount", "Budget / contract value", "money", { column: "amount", list: true, half: true }),
          f("rate", "Default hourly rate", "money", { half: true }),
          f("budget_hours", "Budget hours", "number", { half: true }),
          f("color", "Colour", "color", { half: true }),
          f("description", "Description", "textarea"),
        ],
      },
      {
        key: "milestone", label: "Milestone", plural: "Milestones", titleLabel: "Milestone",
        views: ["list", "calendar"], stages: [s("open", "Open", "blue"), s("reached", "Reached", "green", true)],
        fields: [
          f("parent_id", "Project", "record", { column: "parent_id", ref: "project", required: true, list: true }),
          f("due_date", "Due", "date", { column: "due_date", list: true, half: true }),
          f("amount", "Amount to invoice", "money", { column: "amount", list: true, half: true }),
          NOTES,
        ],
      },
      {
        key: "task", label: "Task", plural: "Tasks", prefix: "TSK-", titleLabel: "Task",
        views: ["kanban", "list", "calendar"],
        stages: [s("todo", "To do", "slate"), s("in_progress", "In progress", "blue"), s("review", "Review", "violet"), s("done", "Done", "green", true)],
        stats: [{ label: "Open tasks", where: { stage: ["todo", "in_progress", "review"] } }],
        fields: [
          f("parent_id", "Project", "record", { column: "parent_id", ref: "project", list: true, half: true }),
          { ...OWNER, label: "Assignee" },
          PRIORITY,
          f("due_date", "Due", "date", { column: "due_date", list: true, half: true }),
          f("quantity", "Estimate (hours)", "number", { column: "quantity", half: true }),
          f("billable", "Billable", "checkbox", { half: true, defaultValue: true }),
          f("description", "Description", "textarea"),
          f("checklist", "Checklist", "lines", { lineFields: [f("item", "Item", "text"), f("done", "Done", "checkbox")] }),
        ],
      },
      {
        key: "timesheet", label: "Time entry", plural: "Timesheets", titleLabel: "Work done",
        views: ["list", "calendar"], stages: [s("draft", "Draft", "slate"), s("approved", "Approved", "green"), s("invoiced", "Invoiced", "violet", true)],
        stats: [{ label: "Hours logged", sum: "quantity" }],
        fields: [
          f("parent_id", "Project", "record", { column: "parent_id", ref: "project", required: true, list: true, half: true }),
          f("task", "Task", "record", { ref: "task", half: true }),
          f("employee_id", "Staff", "employee", { column: "employee_id", list: true, half: true }),
          f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }),
          f("quantity", "Hours", "number", { column: "quantity", list: true, half: true, required: true }),
          f("amount", "Billable amount", "money", { column: "amount", list: true, half: true }),
          f("billable", "Billable", "checkbox", { half: true, defaultValue: true }),
        ],
      },
      {
        key: "project_expense", label: "Project cost", plural: "Project costs", titleLabel: "Cost",
        views: ["list"], stages: [s("unbilled", "Unbilled", "amber"), s("billed", "Billed", "green", true)],
        fields: [
          f("parent_id", "Project", "record", { column: "parent_id", ref: "project", required: true, list: true }),
          f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }),
          f("amount", "Amount", "money", { column: "amount", list: true, half: true, required: true }),
          f("supplier_id", "Supplier", "supplier", { column: "supplier_id", half: true }),
          f("billable", "Re-bill to customer", "checkbox", { half: true }),
          NOTES,
        ],
      },
    ],
  },

  // ── Manufacturing ──────────────────────────────────────────────────────
  {
    key: "manufacturing",
    kinds: [
      {
        key: "mo", label: "Manufacturing order", plural: "Manufacturing orders", prefix: "MO-", titleLabel: "Reference",
        views: ["kanban", "list", "calendar"],
        stages: [s("draft", "Draft", "slate"), s("confirmed", "Confirmed", "blue"), s("in_progress", "In progress", "amber"), s("done", "Done", "green", true), s("cancelled", "Cancelled", "red", true)],
        stats: [{ label: "Orders in progress", where: { stage: ["confirmed", "in_progress"] } }, { label: "Units planned", sum: "quantity", where: { stage: ["confirmed", "in_progress"] } }],
        fields: [
          f("product_id", "Product to make", "product", { column: "product_id", required: true, list: true }),
          f("quantity", "Quantity", "number", { column: "quantity", required: true, list: true, half: true, defaultValue: 1 }),
          f("bom", "Bill of materials", "record", { ref: "bom", half: true }),
          f("starts_at", "Scheduled start", "date", { column: "starts_at", list: true, half: true }),
          f("due_date", "Deadline", "date", { column: "due_date", half: true }),
          f("work_center", "Work centre", "record", { ref: "work_center", half: true }),
          { ...OWNER, label: "Responsible" },
          f("amount", "Production cost", "money", { column: "amount", list: true, half: true, help: "Filled in from the components when the order is produced." }),
          NOTES,
        ],
      },
      {
        key: "bom", label: "Bill of materials", plural: "Bills of materials", prefix: "BOM-", titleLabel: "BOM name",
        views: ["list"], stages: [s("active", "Active", "green"), s("archived", "Archived", "slate", true)],
        fields: [
          f("product_id", "Finished product", "product", { column: "product_id", required: true, list: true }),
          f("quantity", "Produces quantity", "number", { column: "quantity", required: true, half: true, defaultValue: 1, list: true }),
          f("type", "BOM type", "select", { options: ["Manufacture", "Kit", "Subcontracting"], half: true, defaultValue: "Manufacture" }),
          f("components", "Components", "lines", { lineFields: [f("product_id", "Component", "product"), f("qty", "Quantity", "number"), f("unit", "Unit", "text")] }),
          f("operations", "Operations", "lines", { lineFields: [f("name", "Operation", "text"), f("work_center", "Work centre", "text"), f("minutes", "Minutes", "number")] }),
          f("amount", "Extra cost per batch (labour, overhead)", "money", { column: "amount", half: true }),
        ],
      },
      {
        key: "work_center", label: "Work centre", plural: "Work centres", titleLabel: "Name",
        views: ["list"], stages: [s("available", "Available", "green"), s("busy", "Busy", "amber"), s("down", "Down", "red")],
        fields: [
          f("code", "Code", "text", { half: true, list: true }),
          f("capacity", "Capacity (units/hour)", "number", { half: true, list: true }),
          f("amount", "Cost per hour", "money", { column: "amount", half: true, list: true }),
          f("oee", "OEE target %", "percent", { half: true }),
        ],
      },
      {
        key: "scrap", label: "Scrap", plural: "Scrap", titleLabel: "Reason",
        views: ["list"], stages: [s("done", "Recorded", "red", true)],
        fields: [
          f("product_id", "Product", "product", { column: "product_id", required: true, list: true }),
          f("quantity", "Quantity", "number", { column: "quantity", required: true, list: true, half: true }),
          f("parent_id", "Manufacturing order", "record", { column: "parent_id", ref: "mo", half: true }),
        ],
      },
    ],
  },

  // ── Expense ────────────────────────────────────────────────────────────
  {
    key: "expense",
    kinds: [
      {
        key: "claim", label: "Expense claim", plural: "Expense claims", prefix: "EXR-", titleLabel: "Purpose",
        views: ["list", "kanban"],
        stages: [s("draft", "Draft", "slate"), s("submitted", "Submitted", "blue"), s("approved", "Approved", "green"), s("reimbursed", "Reimbursed", "violet", true), s("rejected", "Rejected", "red", true)],
        stats: [{ label: "Awaiting approval", sum: "amount", where: { stage: ["submitted"] } }, { label: "To reimburse", sum: "amount", where: { stage: ["approved"] } }],
        fields: [
          f("employee_id", "Employee", "employee", { column: "employee_id", required: true, list: true, half: true }),
          f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }),
          f("lines", "Expenses", "lines", { lineFields: [f("date", "Date", "date"), f("category", "Category", "text"), f("merchant", "Merchant", "text"), f("amount", "Amount", "money")] }),
          f("amount", "Total", "money", { column: "amount", list: true, half: true }),
          f("trip", "Trip", "record", { ref: "trip", half: true }),
          f("customer_id", "Billable to customer", "customer", { column: "customer_id", half: true }),
          f("method", "Reimburse via", "select", { options: ["M-Pesa", "Bank transfer", "Payroll", "Cash"], half: true }),
          NOTES,
        ],
      },
      {
        key: "trip", label: "Trip", plural: "Trips", prefix: "TRIP-", titleLabel: "Destination",
        views: ["list", "calendar"], stages: [s("planned", "Planned", "blue"), s("approved", "Approved", "green"), s("completed", "Completed", "slate", true)],
        fields: [
          f("employee_id", "Traveller", "employee", { column: "employee_id", list: true, half: true }),
          f("starts_at", "From", "date", { column: "starts_at", list: true, half: true }),
          f("ends_at", "To", "date", { column: "ends_at", list: true, half: true }),
          f("amount", "Per diem budget", "money", { column: "amount", half: true }),
          f("purpose", "Purpose", "textarea"),
        ],
      },
      {
        key: "advance", label: "Cash advance", plural: "Advances", prefix: "ADV-", titleLabel: "Purpose",
        views: ["list"], stages: [s("requested", "Requested", "blue"), s("paid", "Paid", "amber"), s("settled", "Settled", "green", true)],
        fields: [
          f("employee_id", "Employee", "employee", { column: "employee_id", required: true, list: true, half: true }),
          f("amount", "Amount", "money", { column: "amount", required: true, list: true, half: true }),
          f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }),
        ],
      },
    ],
  },

  // ── Helpdesk ───────────────────────────────────────────────────────────
  {
    key: "helpdesk",
    kinds: [
      {
        key: "ticket", label: "Ticket", plural: "Tickets", prefix: "TKT-", titleLabel: "Subject",
        views: ["kanban", "list"],
        stages: [s("new", "New", "blue"), s("in_progress", "In progress", "amber"), s("waiting", "Waiting on customer", "violet"), s("resolved", "Resolved", "green", true), s("closed", "Closed", "slate", true)],
        stats: [{ label: "Open tickets", where: { stage: ["new", "in_progress", "waiting"] } }],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true }),
          { ...OWNER, label: "Agent" },
          PRIORITY,
          f("channel", "Channel", "select", { options: ["Email", "Phone", "WhatsApp", "Portal", "Walk-in", "Web form", "Live chat"], half: true }),
          f("from_email", "Customer email", "email", { half: true, help: "Replies from the Conversation box go here." }),
          f("team", "Team", "text", { half: true }),
          f("due_date", "SLA deadline", "date", { column: "due_date", list: true, half: true }),
          f("description", "Description", "textarea"),
        ],
      },
    ],
  },

  // ── Field service ──────────────────────────────────────────────────────
  {
    key: "field_service",
    kinds: [
      {
        key: "job", label: "Work order", plural: "Work orders", prefix: "WO-", titleLabel: "Job",
        views: ["kanban", "list", "calendar"],
        stages: [s("new", "New", "blue"), s("scheduled", "Scheduled", "violet"), s("on_site", "On site", "amber"), s("done", "Done", "green", true), s("cancelled", "Cancelled", "slate", true)],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", required: true, list: true, half: true }),
          { ...OWNER, label: "Technician" },
          f("starts_at", "Scheduled", "datetime", { column: "starts_at", list: true, half: true }),
          f("location", "Site / address", "text", { half: true }),
          PRIORITY,
          f("parts", "Parts used", "lines", { lineFields: [f("product_id", "Part", "product"), f("qty", "Qty", "number")] }),
          f("quantity", "Hours", "number", { column: "quantity", half: true }),
          f("amount", "Charge", "money", { column: "amount", list: true, half: true }),
          f("signature", "Customer sign-off", "signature"),
          NOTES,
        ],
      },
    ],
  },

  // ── Appointments ───────────────────────────────────────────────────────
  {
    key: "appointments",
    kinds: [
      {
        key: "booking", label: "Appointment", plural: "Appointments", prefix: "APT-", titleLabel: "Title",
        views: ["calendar", "list"], stages: [s("booked", "Booked", "blue"), s("confirmed", "Confirmed", "green"), s("done", "Done", "slate", true), s("no_show", "No-show", "red", true), s("cancelled", "Cancelled", "slate", true)],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true }),
          f("type", "Appointment type", "record", { ref: "appointment_type", half: true }),
          f("starts_at", "Starts", "datetime", { column: "starts_at", required: true, list: true, half: true }),
          f("ends_at", "Ends", "datetime", { column: "ends_at", half: true }),
          { ...OWNER, label: "With" },
          f("phone", "Phone", "phone", { half: true }),
          NOTES,
        ],
      },
      {
        key: "appointment_type", label: "Appointment type", plural: "Appointment types", titleLabel: "Name",
        views: ["list"], fields: [
          f("minutes", "Duration (minutes)", "number", { half: true, list: true, defaultValue: 30 }),
          f("capacity", "People at the same time", "number", { half: true, defaultValue: 1 }),
          f("online", "Bookable online", "checkbox", { half: true, defaultValue: true }),
          f("amount", "Price", "money", { column: "amount", half: true, list: true }),
          f("description", "Description", "textarea"),
        ],
      },
    ],
  },

  // ── Contracts ──────────────────────────────────────────────────────────
  {
    key: "contracts",
    kinds: [
      {
        key: "contract", label: "Contract", plural: "Contracts", prefix: "CTR-", titleLabel: "Contract title",
        views: ["kanban", "list", "calendar"],
        stages: [s("draft", "Draft", "slate"), s("review", "Legal review", "violet"), s("signing", "Out for signature", "amber"), s("active", "Active", "green"), s("expired", "Expired", "red", true), s("terminated", "Terminated", "slate", true)],
        stats: [{ label: "Active contract value", sum: "amount", where: { stage: ["active"] } }],
        fields: [
          f("type", "Type", "select", { options: ["Sales", "Purchase", "Service / SLA", "Employment", "Lease", "NDA", "Partnership", "Other"], half: true, list: true }),
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true }),
          f("supplier_id", "Supplier", "supplier", { column: "supplier_id", half: true }),
          f("employee_id", "Employee", "employee", { column: "employee_id", half: true }),
          f("starts_at", "Start", "date", { column: "starts_at", half: true }),
          f("ends_at", "End", "date", { column: "ends_at", list: true, half: true }),
          f("amount", "Contract value", "money", { column: "amount", list: true, half: true }),
          f("renewal", "Renewal", "select", { options: ["None", "Auto-renew", "Notify before expiry"], half: true }),
          f("notice_days", "Notice period (days)", "number", { half: true }),
          { ...OWNER, label: "Contract owner" },
          f("obligations", "Obligations & milestones", "lines", { lineFields: [f("item", "Obligation", "text"), f("due", "Due", "date"), f("done", "Done", "checkbox")] }),
          f("body", "Contract terms", "textarea"),
        ],
      },
    ],
  },

  // ── Sign ───────────────────────────────────────────────────────────────
  {
    key: "sign",
    kinds: [
      {
        key: "request", label: "Signature request", plural: "Signature requests", prefix: "SIGN-", titleLabel: "Document title",
        views: ["list", "kanban"],
        stages: [s("draft", "Draft", "slate"), s("sent", "Sent", "blue"), s("partially", "Partially signed", "amber"), s("signed", "Signed", "green", true), s("declined", "Declined", "red", true), s("expired", "Expired", "slate", true)],
        fields: [
          f("signers", "Signers", "lines", { lineFields: [f("name", "Name", "text"), f("email", "Email", "email"), f("phone", "Phone", "phone"), f("signed_at", "Signed", "text")] }),
          f("customer_id", "Customer", "customer", { column: "customer_id", half: true, list: true }),
          f("due_date", "Sign by", "date", { column: "due_date", half: true, list: true }),
          f("message", "Message to signers", "textarea"),
          f("body", "Document text", "textarea", { help: "Or attach the PDF in the Files section." }),
          f("signature", "Signature", "signature"),
        ],
      },
    ],
  },

  // ── Subscriptions ──────────────────────────────────────────────────────
  {
    key: "subscriptions",
    kinds: [
      {
        key: "subscription", label: "Subscription", plural: "Subscriptions", prefix: "SUB-", titleLabel: "Subscription",
        views: ["list", "kanban"],
        stages: [s("trial", "Trial", "violet"), s("active", "Active", "green"), s("paused", "Paused", "amber"), s("cancelled", "Cancelled", "slate", true)],
        stats: [{ label: "MRR (active)", sum: "amount", where: { stage: ["active"] } }],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", required: true, list: true, half: true }),
          f("plan", "Plan", "record", { ref: "plan", half: true }),
          f("amount", "Recurring amount", "money", { column: "amount", required: true, list: true, half: true }),
          f("interval", "Bills every", "select", { options: ["Week", "Month", "Quarter", "6 months", "Year"], half: true, defaultValue: "Month" }),
          f("starts_at", "Start", "date", { column: "starts_at", half: true }),
          f("due_date", "Next invoice", "date", { column: "due_date", list: true, half: true }),
          f("auto_invoice", "Create invoices automatically", "checkbox", { defaultValue: true }),
        ],
      },
      { key: "plan", label: "Plan", plural: "Plans", titleLabel: "Plan name", views: ["list"],
        fields: [f("amount", "Price", "money", { column: "amount", list: true, half: true }), f("interval", "Interval", "select", { options: ["Week", "Month", "Quarter", "6 months", "Year"], half: true, list: true }), f("description", "Description", "textarea")] },
    ],
  },

  // ── Repairs (workshop job cards) ─────────────────────────────────────
  {
    key: "repairs",
    kinds: [
      {
        key: "job", label: "Repair job", plural: "Repair jobs", prefix: "RPR-", titleLabel: "Item & fault",
        views: ["kanban", "list"],
        stages: [
          s("received", "Received", "blue"), s("diagnosing", "Diagnosing", "violet"), s("waiting_approval", "Waiting for customer OK", "amber"),
          s("waiting_parts", "Waiting for parts", "amber"), s("repairing", "Repairing", "violet"), s("ready", "Ready for collection", "green"),
          s("collected", "Collected", "green", true), s("cancelled", "Cancelled / not repairable", "slate", true),
        ],
        stats: [
          { label: "Jobs in the workshop", where: { stage: ["received", "diagnosing", "waiting_approval", "waiting_parts", "repairing"] } },
          { label: "Ready for collection", where: { stage: ["ready"] } },
          { label: "Estimates on open jobs", sum: "amount", where: { stage: ["received", "diagnosing", "waiting_approval", "waiting_parts", "repairing", "ready"] } },
        ],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true, required: true }),
          f("phone", "Customer phone", "phone", { half: true, help: "We text this number when the job is ready." }),
          f("item_type", "Item", "select", { options: ["Phone", "Laptop", "Tablet", "TV", "Printer", "Vehicle", "Motorbike", "Appliance", "Machine", "Other"], half: true, list: true }),
          f("brand_model", "Brand & model", "text", { half: true, list: true }),
          f("serial", "Serial / IMEI / reg. no.", "text", { half: true }),
          { ...OWNER, label: "Technician" },
          PRIORITY,
          f("due_date", "Promised date", "date", { column: "due_date", list: true, half: true }),
          f("fault", "Fault reported by customer", "textarea"),
          f("accessories", "Received with it", "text", { help: "Charger, case, SIM, battery, keys…" }),
          f("condition", "Condition on arrival", "textarea", { help: "Scratches, cracks, missing parts: protects you at collection." }),
          f("diagnosis", "Diagnosis", "textarea"),
          f("amount", "Estimate / price", "money", { column: "amount", list: true, half: true }),
          f("deposit", "Deposit paid", "money", { half: true }),
          f("parts", "Parts used", "lines", { help: "Parts taken from stock for this job." }),
          f("warranty", "Warranty on the repair", "select", { options: ["None", "7 days", "30 days", "90 days", "6 months", "1 year"], defaultValue: "30 days", half: true }),
          f("collected_by", "Collected by", "text", { half: true }),
          f("signature", "Customer signature", "signature"),
        ],
      },
    ],
  },

  // ── Front desk (visitors) ────────────────────────────────────────────
  {
    key: "frontdesk",
    kinds: [
      {
        key: "visit", label: "Visit", plural: "Visits", prefix: "VIS-", titleLabel: "Visitor name",
        views: ["kanban", "list"],
        stages: [s("expected", "Expected", "blue"), s("signed_in", "On site", "green"), s("signed_out", "Signed out", "slate", true), s("cancelled", "Did not come", "slate", true)],
        stats: [{ label: "Visitors on site now", where: { stage: ["signed_in"] } }, { label: "Expected", where: { stage: ["expected"] } }],
        fields: [
          f("phone", "Phone", "phone", { half: true, list: true }),
          f("company", "Company", "text", { half: true, list: true }),
          f("employee_id", "Visiting (host)", "employee", { column: "employee_id", half: true, list: true, help: "The host is told when the visitor signs in." }),
          f("purpose", "Purpose", "select", { options: ["Meeting", "Interview", "Delivery", "Collection", "Maintenance", "Sales visit", "Personal", "Other"], half: true, list: true }),
          f("starts_at", "Arrival", "datetime", { column: "starts_at", half: true, list: true }),
          f("ends_at", "Departure", "datetime", { column: "ends_at", half: true }),
          f("id_number", "ID / passport no.", "text", { half: true }),
          f("badge", "Badge no.", "text", { half: true }),
          f("vehicle", "Vehicle reg.", "text", { half: true }),
          f("items", "Items brought in", "text", { half: true, help: "Laptops, tools, parcels…" }),
          f("signature", "Visitor signature", "signature", { help: "Agrees to the site rules." }),
          NOTES,
        ],
      },
    ],
  },

  // ── Rental ─────────────────────────────────────────────────────────────
  {
    key: "rental",
    kinds: [
      {
        key: "rental_order", label: "Rental order", plural: "Rental orders", prefix: "RNT-", titleLabel: "Reference",
        views: ["kanban", "list", "calendar"],
        stages: [s("quotation", "Quotation", "slate"), s("reserved", "Reserved", "blue"), s("picked_up", "Picked up", "amber"), s("returned", "Returned", "green", true), s("late", "Late", "red")],
        fields: [
          f("customer_id", "Customer", "customer", { column: "customer_id", required: true, list: true, half: true }),
          f("product_id", "Item rented", "product", { column: "product_id", list: true, half: true }),
          f("quantity", "Quantity", "number", { column: "quantity", half: true, defaultValue: 1 }),
          f("starts_at", "Pick-up", "datetime", { column: "starts_at", list: true, half: true }),
          f("ends_at", "Return", "datetime", { column: "ends_at", list: true, half: true }),
          f("amount", "Rental price", "money", { column: "amount", list: true, half: true }),
          f("deposit", "Deposit", "money", { half: true }),
          NOTES,
        ],
      },
    ],
  },

  // ── Loyalty ────────────────────────────────────────────────────────────
  {
    key: "loyalty",
    kinds: [
      { key: "program", label: "Programme", plural: "Programmes", titleLabel: "Name", views: ["list"], stages: [s("active", "Active", "green"), s("ended", "Ended", "slate", true)],
        fields: [f("type", "Type", "select", { options: ["Points", "Gift card", "Coupon", "Buy X get Y", "Discount code"], half: true, list: true }), f("rule", "Earning rule", "text", { placeholder: "1 point per KES 100", half: true }), f("reward", "Reward", "text", { placeholder: "100 points = KES 100 off" })] },
      { key: "card", label: "Card / voucher", plural: "Cards & vouchers", prefix: "GC-", titleLabel: "Code", views: ["list"], stages: [s("active", "Active", "green"), s("used", "Used", "slate", true), s("expired", "Expired", "red", true)],
        fields: [f("customer_id", "Customer", "customer", { column: "customer_id", list: true, half: true }), f("amount", "Balance / points", "number", { column: "amount", list: true, half: true }), f("due_date", "Expires", "date", { column: "due_date", list: true, half: true })] },
    ],
  },

  // ── Fixed assets ───────────────────────────────────────────────────────
  {
    key: "fixed_assets",
    kinds: [
      {
        key: "asset", label: "Asset", plural: "Assets", prefix: "FA-", titleLabel: "Asset name",
        views: ["list"], stages: [s("in_use", "In use", "green"), s("in_repair", "In repair", "amber"), s("disposed", "Disposed", "slate", true)],
        stats: [{ label: "Cost of assets in use", sum: "amount", where: { stage: ["in_use", "in_repair"] } }],
        fields: [
          f("category", "Category", "select", { options: ["Land & buildings", "Motor vehicles", "Furniture & fittings", "Computers & equipment", "Plant & machinery", "Intangibles"], half: true, list: true }),
          f("tag", "Asset tag", "text", { half: true, list: true }),
          f("starts_at", "Purchase date", "date", { column: "starts_at", half: true }),
          f("amount", "Cost", "money", { column: "amount", required: true, list: true, half: true }),
          f("method", "Depreciation", "select", { options: ["Straight line", "Reducing balance"], half: true, defaultValue: "Straight line" }),
          f("rate", "Rate % per year", "percent", { half: true, defaultValue: 12.5 }),
          f("salvage", "Salvage value", "money", { half: true }),
          f("employee_id", "Custodian", "employee", { column: "employee_id", half: true }),
          f("supplier_id", "Supplier", "supplier", { column: "supplier_id", half: true }),
          f("location", "Location", "text", { half: true }),
          f("serial", "Serial number", "text", { half: true }),
        ],
      },
    ],
  },

  // ── ESG ────────────────────────────────────────────────────────────────
  {
    key: "esg",
    kinds: [
      { key: "metric", label: "ESG entry", plural: "ESG entries", titleLabel: "Description", views: ["list"],
        fields: [f("pillar", "Pillar", "select", { options: ["Environmental", "Social", "Governance"], half: true, list: true }), f("type", "Metric", "select", { options: ["Electricity (kWh)", "Fuel (litres)", "Water (m³)", "Waste (kg)", "Scope 1 tCO2e", "Scope 2 tCO2e", "Scope 3 tCO2e", "Employees trained", "Women in leadership %", "Community spend"], half: true, list: true }), f("quantity", "Value", "number", { column: "quantity", list: true, half: true }), f("starts_at", "Period", "date", { column: "starts_at", list: true, half: true })] },
      { key: "initiative", label: "Initiative", plural: "Initiatives", titleLabel: "Initiative", views: ["kanban", "list"], stages: OPEN_DONE,
        fields: [OWNER, f("amount", "Budget", "money", { column: "amount", half: true }), f("target", "Target", "text"), NOTES] },
    ],
  },

  // ── PLM ────────────────────────────────────────────────────────────────
  {
    key: "plm",
    kinds: [
      { key: "eco", label: "Engineering change", plural: "Engineering changes", prefix: "ECO-", titleLabel: "Change", views: ["kanban", "list"],
        stages: [s("new", "New", "blue"), s("in_progress", "In progress", "amber"), s("approval", "Approval", "violet"), s("done", "Applied", "green", true), s("rejected", "Rejected", "red", true)],
        fields: [f("product_id", "Product", "product", { column: "product_id", list: true, half: true }), f("type", "Type", "select", { options: ["BOM change", "New version", "Product data", "Routing"], half: true }), OWNER, f("version", "New version", "text", { half: true }), f("description", "Description", "textarea")] },
    ],
  },

  // ── Quality ────────────────────────────────────────────────────────────
  {
    key: "quality",
    kinds: [
      { key: "check", label: "Quality check", plural: "Quality checks", prefix: "QC-", titleLabel: "Check", views: ["list", "kanban"],
        stages: [s("todo", "To do", "slate"), s("passed", "Passed", "green", true), s("failed", "Failed", "red", true)],
        fields: [f("product_id", "Product", "product", { column: "product_id", list: true, half: true }), f("type", "Type", "select", { options: ["Pass / fail", "Measure", "Visual", "Instructions"], half: true }), f("quantity", "Measured value", "number", { column: "quantity", half: true }), OWNER, NOTES] },
      { key: "alert", label: "Quality alert", plural: "Quality alerts", prefix: "QA-", titleLabel: "Problem", views: ["kanban", "list"],
        stages: [s("new", "New", "red"), s("investigating", "Investigating", "amber"), s("action", "Corrective action", "violet"), s("closed", "Closed", "green", true)],
        fields: [f("product_id", "Product", "product", { column: "product_id", list: true, half: true }), f("supplier_id", "Supplier", "supplier", { column: "supplier_id", half: true }), PRIORITY, OWNER, f("root_cause", "Root cause", "textarea"), f("action", "Corrective / preventive action", "textarea")] },
    ],
  },

  // ── Maintenance ────────────────────────────────────────────────────────
  {
    key: "maintenance",
    kinds: [
      { key: "equipment", label: "Equipment", plural: "Equipment", prefix: "EQ-", titleLabel: "Equipment", views: ["list"],
        stages: [s("operational", "Operational", "green"), s("maintenance", "Under maintenance", "amber"), s("scrapped", "Scrapped", "slate", true)],
        fields: [f("category", "Category", "text", { half: true, list: true }), f("serial", "Serial number", "text", { half: true, list: true }), f("location", "Location", "text", { half: true }), f("due_date", "Warranty until", "date", { column: "due_date", half: true }), f("interval_days", "Preventive every (days)", "number", { half: true }), OWNER] },
      { key: "request", label: "Maintenance request", plural: "Maintenance requests", prefix: "MR-", titleLabel: "Request", views: ["kanban", "list", "calendar"],
        stages: [s("new", "New", "blue"), s("in_progress", "In progress", "amber"), s("repaired", "Repaired", "green", true), s("scrap", "Scrap", "red", true)],
        fields: [f("parent_id", "Equipment", "record", { column: "parent_id", ref: "equipment", list: true, half: true }), f("type", "Type", "select", { options: ["Corrective", "Preventive"], half: true, list: true }), f("starts_at", "Scheduled", "datetime", { column: "starts_at", half: true }), PRIORITY, { ...OWNER, label: "Technician" }, f("amount", "Cost", "money", { column: "amount", half: true }), NOTES] },
    ],
  },

  // ── Fleet ──────────────────────────────────────────────────────────────
  {
    key: "fleet",
    kinds: [
      { key: "vehicle", label: "Vehicle", plural: "Vehicles", titleLabel: "Registration", views: ["list", "kanban"], children: ["fuel", "service"],
        stages: [s("active", "Active", "green"), s("workshop", "In workshop", "amber"), s("sold", "Sold", "slate", true)],
        fields: [f("model", "Make & model", "text", { half: true, list: true }), f("employee_id", "Driver", "employee", { column: "employee_id", half: true, list: true }), f("odometer", "Odometer (km)", "number", { half: true }), f("insurance_until", "Insurance until", "date", { half: true, list: true }), f("inspection_until", "Inspection until", "date", { half: true }), f("amount", "Purchase value", "money", { column: "amount", half: true })] },
      { key: "fuel", label: "Fuel log", plural: "Fuel logs", titleLabel: "Station", views: ["list"],
        fields: [f("parent_id", "Vehicle", "record", { column: "parent_id", ref: "vehicle", required: true, list: true, half: true }), f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }), f("quantity", "Litres", "number", { column: "quantity", list: true, half: true }), f("amount", "Cost", "money", { column: "amount", list: true, half: true }), f("odometer", "Odometer", "number", { half: true })] },
      { key: "service", label: "Service log", plural: "Service logs", titleLabel: "Service", views: ["list"],
        fields: [f("parent_id", "Vehicle", "record", { column: "parent_id", ref: "vehicle", required: true, list: true, half: true }), f("starts_at", "Date", "date", { column: "starts_at", list: true, half: true }), f("amount", "Cost", "money", { column: "amount", list: true, half: true }), f("supplier_id", "Garage", "supplier", { column: "supplier_id", half: true }), NOTES] },
    ],
  },

  // ── IoT ────────────────────────────────────────────────────────────────
  {
    key: "iot",
    kinds: [
      { key: "device", label: "Device", plural: "Devices", titleLabel: "Device name", views: ["list"], stages: [s("online", "Online", "green"), s("offline", "Offline", "slate")],
        fields: [f("type", "Type", "select", { options: ["Scale", "Receipt printer", "Barcode scanner", "Temperature sensor", "Energy meter", "Camera", "Other"], half: true, list: true }), f("identifier", "Serial / MAC", "text", { half: true, list: true }), f("location", "Location", "text", { half: true }),
          f("metric", "Measures", "text", { half: true, placeholder: "temperature" }), f("unit", "Unit", "text", { half: true, placeholder: "°C" }),
          f("min", "Alert below", "number", { half: true }), f("max", "Alert above", "number", { half: true }), f("alert_phone", "SMS alerts to", "phone", { half: true })] },
    ],
  },

  // ── Recruitment ────────────────────────────────────────────────────────
  {
    key: "recruitment",
    kinds: [
      { key: "job", label: "Job position", plural: "Job positions", prefix: "JOB-", titleLabel: "Job title", views: ["list", "kanban"], children: ["applicant"],
        stages: [s("open", "Recruiting", "green"), s("paused", "Paused", "amber"), s("filled", "Filled", "slate", true)],
        fields: [f("department", "Department", "text", { half: true, list: true }), f("quantity", "Openings", "number", { column: "quantity", half: true, list: true }), f("location", "Location", "text", { half: true }), f("type", "Type", "select", { options: ["Full-time", "Part-time", "Contract", "Internship", "Casual"], half: true }), f("amount", "Salary budget", "money", { column: "amount", half: true }), OWNER, f("closes", "Applications close", "date", { half: true }), f("public", "Show on the careers page", "checkbox", { half: true, help: "Listed at /careers on your company address while Recruiting, with an apply form." }), f("description", "Job description", "textarea")] },
      { key: "applicant", label: "Applicant", plural: "Applicants", titleLabel: "Full name", views: ["kanban", "list"],
        stages: [s("new", "Applied", "blue"), s("screening", "Shortlisted", "cyan"), s("interview", "Interview", "violet"), s("offer", "Offer", "amber"), s("hired", "Hired", "green", true), s("rejected", "Rejected", "slate", true)],
        fields: [f("parent_id", "Job", "record", { column: "parent_id", ref: "job", list: true, half: true }), f("email", "Email", "email", { half: true, list: true }), f("phone", "Phone", "phone", { half: true }), f("source", "Source", "select", { options: ["Website", "LinkedIn", "BrighterMonday", "Referral", "Walk-in", "Other"], half: true }), f("referred_by", "Referred by", "employee", { half: true }), f("rating", "Rating", "rating", { half: true }), f("amount", "Expected salary", "money", { column: "amount", half: true }), f("starts_at", "Interview", "datetime", { column: "starts_at", half: true }), NOTES] },
    ],
  },

  // ── Appraisals ─────────────────────────────────────────────────────────
  {
    key: "appraisals",
    kinds: [
      { key: "appraisal", label: "Appraisal", plural: "Appraisals", prefix: "APR-", titleLabel: "Review period", views: ["kanban", "list"],
        stages: [s("pending", "To start", "slate"), s("self", "Self review", "blue"), s("manager", "Manager review", "violet"), s("done", "Done", "green", true)],
        fields: [f("employee_id", "Employee", "employee", { column: "employee_id", required: true, list: true, half: true }), { ...OWNER, label: "Reviewer" }, f("due_date", "Due", "date", { column: "due_date", list: true, half: true }), f("rating", "Final rating", "rating", { half: true, list: true }), f("goals", "Goals & scores", "lines", { lineFields: [f("goal", "Goal / KPI", "text"), f("weight", "Weight %", "number"), f("score", "Score (1-5)", "number")] }), f("feedback", "Feedback", "textarea")] },
    ],
  },

  // ── Planning ───────────────────────────────────────────────────────────
  {
    key: "planning",
    kinds: [
      { key: "shift", label: "Shift", plural: "Shifts", titleLabel: "Role / shift", views: ["calendar", "list"], stages: [s("draft", "Draft", "slate"), s("published", "Published", "green")],
        fields: [f("employee_id", "Employee", "employee", { column: "employee_id", list: true, half: true }), f("starts_at", "Starts", "datetime", { column: "starts_at", required: true, list: true, half: true }), f("ends_at", "Ends", "datetime", { column: "ends_at", required: true, list: true, half: true }), f("location", "Branch", "text", { half: true })] },
    ],
  },

  // ── Marketing ──────────────────────────────────────────────────────────
  {
    key: "marketing_automation",
    kinds: [
      { key: "journey", label: "Journey", plural: "Journeys", titleLabel: "Journey name", views: ["list", "kanban"], stages: [s("draft", "Draft", "slate"), s("running", "Running", "green"), s("stopped", "Stopped", "red", true)],
        fields: [f("trigger", "Starts when", "select", { options: ["Lead created", "Customer created", "Invoice overdue", "Invoice paid", "Birthday", "No purchase in 30 days", "Tag added", "Form submitted"], list: true }), f("steps", "Steps", "lines", { lineFields: [f("wait", "Wait (days)", "number"), f("channel", "Channel", "text"), f("message", "Message", "text")] }), f("audience", "Audience filter", "text")] },
    ],
  },
  {
    key: "email_marketing",
    kinds: [
      { key: "campaign", label: "Email campaign", plural: "Email campaigns", titleLabel: "Subject", views: ["list", "kanban"], stages: [s("draft", "Draft", "slate"), s("scheduled", "Scheduled", "blue"), s("sent", "Sent", "green", true)],
        fields: [f("list", "Mailing list", "record", { ref: "mailing_list", half: true, list: true }), f("starts_at", "Send at", "datetime", { column: "starts_at", half: true, list: true }), f("preheader", "Preview text", "text"), f("body", "Content", "textarea")] },
      { key: "mailing_list", label: "Mailing list", plural: "Mailing lists", titleLabel: "List name", views: ["list"],
        fields: [f("source", "Contacts", "select", { options: ["All customers", "CRM leads", "Customers with a balance", "Custom"], list: true }), f("emails", "Extra addresses (one per line)", "textarea")] },
    ],
  },
  {
    key: "social",
    kinds: [
      { key: "post", label: "Post", plural: "Posts", titleLabel: "Post", views: ["calendar", "kanban", "list"], stages: [s("idea", "Idea", "slate"), s("scheduled", "Scheduled", "blue"), s("published", "Published", "green", true)],
        fields: [f("channels", "Channels", "multiselect", { options: ["Facebook", "Instagram", "X (Twitter)", "LinkedIn", "TikTok", "WhatsApp Status", "YouTube"], list: true }), f("starts_at", "Publish at", "datetime", { column: "starts_at", list: true, half: true }), OWNER, f("body", "Caption", "textarea"), f("link", "Link", "url"), f("image_url", "Image URL", "url", { help: "A public picture link (needed for Instagram)." })] },
    ],
  },
  {
    key: "events",
    kinds: [
      { key: "event", label: "Event", plural: "Events", prefix: "EVT-", titleLabel: "Event name", views: ["calendar", "list", "kanban"], children: ["registration"],
        stages: [s("draft", "Draft", "slate"), s("published", "Published", "blue"), s("done", "Done", "green", true), s("cancelled", "Cancelled", "red", true)],
        fields: [f("starts_at", "Starts", "datetime", { column: "starts_at", list: true, half: true }), f("ends_at", "Ends", "datetime", { column: "ends_at", half: true }), f("venue", "Venue", "text", { half: true, list: true }), f("quantity", "Seats", "number", { column: "quantity", half: true }), f("amount", "Ticket price", "money", { column: "amount", half: true }), f("description", "Description", "textarea")] },
      { key: "registration", label: "Registration", plural: "Registrations", prefix: "TIX-", titleLabel: "Attendee", views: ["list"],
        stages: [s("registered", "Registered", "blue"), s("paid", "Paid", "green"), s("attended", "Attended", "violet", true), s("cancelled", "Cancelled", "slate", true)],
        fields: [f("parent_id", "Event", "record", { column: "parent_id", ref: "event", required: true, list: true, half: true }), f("phone", "Phone", "phone", { half: true, list: true }), f("email", "Email", "email", { half: true }), f("amount", "Paid", "money", { column: "amount", half: true })] },
    ],
  },
  {
    key: "surveys",
    kinds: [
      { key: "survey", label: "Survey / form", plural: "Surveys & forms", titleLabel: "Title", views: ["list"], children: ["response"], stages: [s("draft", "Draft", "slate"), s("open", "Collecting", "green"), s("closed", "Closed", "slate", true)],
        fields: [f("questions", "Questions", "lines", { lineFields: [f("question", "Question", "text"), f("type", "Answer type", "text"), f("options", "Options (comma separated)", "text")] }), f("description", "Introduction", "textarea")] },
      { key: "response", label: "Response", plural: "Responses", titleLabel: "Respondent", views: ["list"],
        fields: [f("parent_id", "Survey", "record", { column: "parent_id", ref: "survey", required: true, list: true }), f("answers", "Answers", "lines", { lineFields: [f("question", "Question", "text"), f("answer", "Answer", "text")] }), f("rating", "Score", "rating", { list: true })] },
    ],
  },

  // ── Website extras ─────────────────────────────────────────────────────
  {
    key: "blog",
    kinds: [{ key: "post", label: "Blog post", plural: "Blog posts", titleLabel: "Title", views: ["list", "kanban"], stages: [s("draft", "Draft", "slate"), s("published", "Published", "green")],
      fields: [f("category", "Category", "text", { half: true, list: true }), f("starts_at", "Publish date", "date", { column: "starts_at", half: true, list: true }), OWNER, f("summary", "Summary (SEO description)", "textarea"), f("body", "Content", "textarea")] }],
  },
  {
    key: "forum",
    kinds: [{ key: "topic", label: "Topic", plural: "Topics", titleLabel: "Question", views: ["list"], stages: [s("open", "Open", "blue"), s("answered", "Answered", "green"), s("closed", "Closed", "slate", true)],
      fields: [f("category", "Category", "text", { half: true, list: true }), f("customer_id", "Asked by", "customer", { column: "customer_id", half: true }), f("body", "Question", "textarea"), f("answer", "Accepted answer", "textarea")] }],
  },
  {
    key: "elearning",
    kinds: [
      { key: "course", label: "Course", plural: "Courses", titleLabel: "Course title", views: ["list", "kanban"], children: ["enrollment"], stages: [s("draft", "Draft", "slate"), s("published", "Published", "green")],
        fields: [f("amount", "Price", "money", { column: "amount", half: true, list: true }), OWNER, f("lessons", "Lessons", "lines", { lineFields: [f("title", "Lesson", "text"), f("minutes", "Minutes", "number"), f("link", "Video / link", "text"), f("body", "Notes", "text"), f("question", "Quiz question", "text"), f("answer", "Answer", "text")] }), f("description", "Description", "textarea")] },
      { key: "enrollment", label: "Enrolment", plural: "Enrolments", titleLabel: "Learner", views: ["list"], stages: [s("enrolled", "Enrolled", "blue"), s("in_progress", "In progress", "amber"), s("completed", "Completed", "green", true)],
        fields: [f("parent_id", "Course", "record", { column: "parent_id", ref: "course", required: true, list: true, half: true }), f("customer_id", "Customer", "customer", { column: "customer_id", half: true }), f("employee_id", "Employee", "employee", { column: "employee_id", half: true }), f("phone", "Learner phone", "phone", { half: true }), f("quantity", "Progress %", "percent", { column: "quantity", half: true, list: true })] },
    ],
  },
  {
    key: "live_chat",
    kinds: [{ key: "conversation", label: "Conversation", plural: "Conversations", titleLabel: "Visitor", views: ["kanban", "list"], stages: [s("waiting", "Waiting", "red"), s("active", "Active", "blue"), s("closed", "Closed", "slate", true)],
      fields: [f("channel", "Channel", "select", { options: ["Website", "WhatsApp", "Facebook", "Instagram"], half: true, list: true }), f("customer_id", "Customer", "customer", { column: "customer_id", half: true }), { ...OWNER, label: "Operator" }, f("transcript", "Transcript", "textarea")] }],
  },

  // ── Productivity ───────────────────────────────────────────────────────
  {
    key: "discuss",
    kinds: [{ key: "channel", label: "Channel", plural: "Channels", titleLabel: "Channel name", views: ["list"], fields: [f("purpose", "Purpose", "textarea", { list: true })], description: "Open a channel to post messages; replies appear in its timeline." }],
  },
  {
    key: "knowledge",
    kinds: [{ key: "article", label: "Article", plural: "Articles", titleLabel: "Title", views: ["list"], stages: [s("draft", "Draft", "slate"), s("published", "Published", "green")],
      fields: [f("category", "Category", "text", { half: true, list: true }), f("visibility", "Visibility", "select", { options: ["Internal", "Customer portal", "Public"], half: true, list: true }), f("body", "Content", "textarea")] }],
  },
  {
    key: "spreadsheets",
    kinds: [{ key: "sheet", label: "Sheet", plural: "Sheets", titleLabel: "Sheet name", views: ["list"],
      fields: [f("rows", "Rows", "lines", { lineFields: [f("a", "A", "text"), f("b", "B", "text"), f("c", "C", "text"), f("d", "D", "text"), f("e", "E", "text"), f("f", "F", "text")] })] }],
  },
  {
    key: "voip",
    kinds: [{ key: "call", label: "Call", plural: "Calls", titleLabel: "Subject", views: ["list", "calendar"], stages: [s("planned", "Planned", "blue"), s("done", "Done", "green", true), s("missed", "Missed", "red", true)],
      fields: [f("direction", "Direction", "select", { options: ["Outgoing", "Incoming"], half: true, list: true }), f("phone", "Number", "phone", { half: true, list: true }), f("customer_id", "Customer", "customer", { column: "customer_id", half: true }), f("starts_at", "When", "datetime", { column: "starts_at", list: true, half: true }), f("quantity", "Minutes", "number", { column: "quantity", half: true }), OWNER, f("outcome", "Outcome", "textarea")] }],
  },
  {
    key: "practice",
    kinds: [
      { key: "engagement", label: "Engagement", plural: "Engagements", titleLabel: "Engagement", views: ["kanban", "list"], stages: [s("proposal", "Proposal", "slate"), s("active", "Active", "green"), s("closed", "Closed", "slate", true)],
        fields: [f("client", "Client company", "text", { half: true, list: true }), f("service", "Service", "select", { options: ["Bookkeeping", "VAT returns", "Payroll", "Audit", "Tax filing", "Advisory"], half: true, list: true }), f("amount", "Monthly fee", "money", { column: "amount", half: true, list: true }), OWNER] },
      { key: "deadline", label: "Deadline", plural: "Deadlines", titleLabel: "Filing", views: ["calendar", "list"], stages: [s("pending", "Pending", "amber"), s("filed", "Filed", "green", true)],
        fields: [f("client", "Client company", "text", { half: true, list: true }), f("due_date", "Due", "date", { column: "due_date", list: true, half: true }), OWNER] },
    ],
  },
];

export const APP_BY_KEY: Record<string, AppDef> = Object.fromEntries(APPS.map((a) => [a.key, a]));

export function findKind(app: string, kind: string): KindDef | undefined {
  return APP_BY_KEY[app]?.kinds.find((k) => k.key === kind);
}

/** Resolves a "record" field's ref ("kind" or "app.kind") against an app. */
export function refTarget(app: string, ref: string): { app: string; kind: string } {
  const [a, k] = ref.includes(".") ? ref.split(".") : [app, ref];
  return { app: a, kind: k };
}
