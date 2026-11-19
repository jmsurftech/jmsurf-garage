/**
 * Everything a role can be allowed to do, grouped like the menu. A permission is "resource.action"
 * (e.g. "invoices.void", "reports.sales.export", "settings.taxes"). Company roles store the ones they allow.
 */
export type Action = "view" | "create" | "edit" | "delete" | "approve";
export type Resource = { key: string; label: string; actions: Action[]; more?: [string, string][]; module?: string };
export type Group = { key: string; label: string; resources: Resource[]; module?: string };

const CRUD: Action[] = ["view", "create", "edit", "delete"];
const CRUDA: Action[] = ["view", "create", "edit", "delete", "approve"];

export const PERMISSION_GROUPS: Group[] = [
  { key: "contacts", label: "Contacts", resources: [
    { key: "customers", label: "Customers", actions: CRUD, more: [["assign_owner", "Assign the salesperson / owner"], ["portal", "Manage customer portal access"], ["credit_limit", "Change credit limits"]] },
    { key: "vendors", label: "Vendors", actions: CRUD, more: [["view_bank", "View vendor bank / M-Pesa details"], ["manage_bank", "Manage vendor bank / M-Pesa details"]] },
  ] },
  { key: "items", label: "Items & Inventory", resources: [
    { key: "items", label: "Items & services", actions: CRUDA, more: [["view_cost", "See cost prices and margins"]] },
    { key: "price_lists", label: "Price lists", actions: CRUD },
    { key: "inventory_adjustments", label: "Inventory adjustments", actions: CRUDA },
    { key: "stock_transfers", label: "Transfer orders", actions: CRUDA },
    { key: "stock_takes", label: "Stock takes", actions: CRUDA },
  ] },
  { key: "banking", label: "Banking", resources: [
    { key: "banking", label: "Banking", actions: CRUD, more: [["reconcile", "Reconcile accounts"], ["import_statements", "Import bank and M-Pesa statements"]] },
  ] },
  { key: "sales", label: "Sales", resources: [
    { key: "quotes", label: "Quotes", actions: CRUDA, more: [["communicate", "Email, SMS and WhatsApp quotes"]] },
    { key: "sales_orders", label: "Sales orders", actions: CRUDA, more: [["communicate", "Email and share sales orders"]] },
    { key: "invoices", label: "Invoices", actions: CRUDA, more: [["communicate", "Email, SMS and WhatsApp invoices"], ["void", "Void invoices"], ["write_off", "Write off invoices"], ["edit_approved", "Edit and delete approved invoices"], ["etims", "Sign invoices with KRA eTIMS"]] },
    { key: "recurring_invoices", label: "Recurring invoices", actions: CRUD },
    { key: "payments_received", label: "Customer payments", actions: CRUD, more: [["refund", "Refund customers"], ["mpesa_prompt", "Send M-Pesa payment prompts"]] },
    { key: "credit_notes", label: "Credit notes", actions: CRUDA, more: [["refund", "Refund credit notes"], ["void", "Void credit notes"]] },
    { key: "sales_returns", label: "Sales returns", actions: CRUDA },
    { key: "delivery_notes", label: "Packing & delivery notes", actions: CRUD },
    { key: "receivables", label: "Receivables & reminders", actions: ["view"], more: [["remind", "Send payment reminders and statements"]] },
  ] },
  { key: "pos", label: "Point of Sale", module: "pos", resources: [
    { key: "pos", label: "Till", actions: ["view", "create"], more: [["discount", "Give discounts"], ["price_override", "Change prices at the till"], ["refund", "Refund or return sales"], ["void_sale", "Void a sale"], ["close_shift", "Close shifts and count cash"], ["open_drawer", "Open the cash drawer without a sale"]] },
  ] },
  { key: "purchases", label: "Purchases", resources: [
    { key: "requisitions", label: "Requisitions", actions: CRUDA },
    { key: "rfqs", label: "Requests for quotation", actions: CRUD, more: [["communicate", "Send RFQs to vendors"]] },
    { key: "purchase_orders", label: "Purchase orders", actions: CRUDA, more: [["communicate", "Email and share purchase orders"]] },
    { key: "purchase_receives", label: "Purchase receives", actions: CRUD },
    { key: "bills", label: "Bills", actions: CRUDA, more: [["void", "Void bills"]] },
    { key: "payments_made", label: "Vendor payments", actions: CRUD },
    { key: "expenses", label: "Expenses", actions: CRUDA },
    { key: "vendor_credits", label: "Vendor credits", actions: CRUDA },
    { key: "landed_costs", label: "Landed costs", actions: CRUD },
  ] },
  { key: "accountant", label: "Accountant", resources: [
    { key: "chart_of_accounts", label: "Chart of accounts", actions: CRUD },
    { key: "journals", label: "Manual journals", actions: CRUDA },
    { key: "budgets", label: "Budgets", actions: CRUD },
    { key: "opening_balances", label: "Opening balances", actions: ["view", "edit"] },
    { key: "transaction_lock", label: "Transaction locking", actions: ["view", "edit"] },
  ] },
  { key: "crm", label: "CRM", module: "crm", resources: [
    { key: "leads", label: "Leads", actions: CRUD, more: [["convert", "Convert leads"]] },
    { key: "deals", label: "Deals", actions: CRUD },
    { key: "crm_activities", label: "Tasks, calls & meetings", actions: CRUD },
    { key: "campaigns", label: "Campaigns", actions: CRUD, more: [["send", "Send campaigns"]] },
  ] },
  { key: "projects", label: "Projects & Timesheets", module: "projects", resources: [
    { key: "projects", label: "Projects", actions: CRUD },
    { key: "timesheets", label: "Timesheets", actions: CRUDA, more: [["others", "Log time for other people"]] },
  ] },
  { key: "hrm", label: "HRM", module: "hrm", resources: [
    { key: "employees", label: "Employees", actions: CRUD, more: [["salary", "See salaries and bank details"]] },
    { key: "payroll", label: "Payroll", actions: CRUDA, more: [["send_payslips", "Send payslips"]] },
    { key: "leave", label: "Leave", actions: CRUDA },
    { key: "attendance", label: "Attendance & shifts", actions: CRUD },
    { key: "hr_loans", label: "Staff loans & advances", actions: CRUDA },
  ] },
  { key: "contracts", label: "Contracts & Sign", resources: [
    { key: "contracts", label: "Contracts", actions: CRUDA },
    { key: "sign", label: "Signatures & stamps", actions: ["view", "create"], more: [["sign_for_company", "Sign documents for the company"]] },
  ] },
];

/** Single switches: documents, settings, dashboard widgets. */
export const PERMISSION_SWITCHES: { key: string; label: string; items: [string, string][] }[] = [
  { key: "documents", label: "Documents", items: [["view", "View documents"], ["upload", "Upload documents"], ["delete", "Delete documents"], ["folders", "Manage folders"]] },
  { key: "settings", label: "Settings", items: [
    ["org_profile", "Update the company profile and branding"], ["users", "Users and roles"], ["branches", "Branches and warehouses"], ["taxes", "Taxes and KRA eTIMS"],
    ["preferences", "General preferences"], ["templates", "Document templates and numbering"], ["email", "Email, SMS and WhatsApp settings"], ["payments", "Payment gateways (M-Pesa, cards)"],
    ["integrations", "Integrations and move-in"], ["automation", "Automation, reminders and approvals"], ["modules", "Modules, plan and billing"], ["backups", "Backups"],
    ["export", "Export data"], ["audit", "Audit log"],
  ] },
  { key: "dashboard", label: "Dashboard", items: [
    ["receivables", "Total receivables"], ["payables", "Total payables"], ["cash_flow", "Cash flow"], ["income_expense", "Income and expenses"],
    ["top_expenses", "Top expenses"], ["sales", "Sales and best sellers"], ["stock", "Stock alerts"], ["bank", "Bank and M-Pesa balances"],
  ] },
];

export const REPORT_GROUPS: [string, string][] = [
  ["business_overview", "Business overview (P&L, balance sheet, cash flow)"], ["sales", "Sales"], ["inventory", "Inventory"], ["receivables", "Receivables"],
  ["payments_received", "Payments received"], ["payables", "Payables"], ["purchases_expenses", "Purchases and expenses"], ["taxes", "Taxes (VAT, eTIMS)"],
  ["banking", "Banking"], ["accountant", "Accountant (ledger, trial balance, journals)"], ["hrm", "HR and payroll"], ["projects", "Projects and timesheets"], ["activity", "Activity and audit"],
];
export const REPORT_ACTIONS: [string, string][] = [["view", "View"], ["export", "Export"], ["schedule", "Schedule"], ["share", "Share"]];

export type Perms = Record<string, boolean>;

/** Every permission key there is. */
export function allPermissionKeys(): string[] {
  const out: string[] = [];
  for (const g of PERMISSION_GROUPS) for (const r of g.resources) { for (const a of r.actions) out.push(`${r.key}.${a}`); for (const [m] of r.more || []) out.push(`${r.key}.${m}`); }
  for (const s of PERMISSION_SWITCHES) for (const [k] of s.items) out.push(`${s.key}.${k}`);
  for (const [g] of REPORT_GROUPS) for (const [a] of REPORT_ACTIONS) out.push(`reports.${g}.${a}`);
  return out;
}

const grant = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, true])) as Perms;
const viewAll = (resources: string[]) => resources.map((r) => `${r}.view`);
const full = (resources: string[]) => resources.flatMap((r) => ["view", "create", "edit", "delete"].map((a) => `${r}.${a}`));
const reports = (groups: string[], actions = ["view", "export"]) => groups.flatMap((g) => actions.map((a) => `reports.${g}.${a}`));
const dash = (items: string[]) => items.map((i) => `dashboard.${i}`);

/** Ready-made roles each company starts with (they can be changed or copied). */
export const PRESET_ROLES: { name: string; description: string; base_role: string; data_scope?: string; permissions: Perms }[] = [
  { name: "Manager", description: "Runs the business day to day: everything except users, billing and backups.", base_role: "manager",
    permissions: grant(allPermissionKeys().filter((k) => !["settings.users", "settings.modules", "settings.backups"].includes(k))) },
  { name: "Accountant", description: "The books: banking, journals, bills, payments, taxes and all reports.", base_role: "finance",
    permissions: grant([...full(["banking", "chart_of_accounts", "journals", "budgets", "bills", "payments_made", "expenses", "payments_received", "credit_notes", "vendor_credits"]), "opening_balances.view", "opening_balances.edit", "transaction_lock.view", "transaction_lock.edit", "journals.approve", "bills.approve", "expenses.approve",
      ...viewAll(["customers", "vendors", "items", "quotes", "sales_orders", "invoices", "purchase_orders", "receivables"]), "banking.reconcile", "banking.import_statements", "settings.taxes", "settings.export", "documents.view", "documents.upload",
      ...reports(REPORT_GROUPS.map((g) => g[0]), ["view", "export", "schedule", "share"]), ...dash(["receivables", "payables", "cash_flow", "income_expense", "top_expenses", "bank"])]) },
  { name: "Staff", description: "All sales, purchases and items work, without reports, settings, banking or the accountant menu.", base_role: "manager",
    permissions: grant([...full(["customers", "vendors", "items", "quotes", "sales_orders", "invoices", "payments_received", "credit_notes", "sales_returns", "delivery_notes", "requisitions", "rfqs", "purchase_orders", "purchase_receives", "bills", "payments_made", "expenses", "vendor_credits", "inventory_adjustments", "stock_transfers"]),
      "receivables.view", "receivables.remind", "invoices.communicate", "quotes.communicate", "purchase_orders.communicate", "rfqs.communicate", "pos.view", "pos.create", "documents.view", "documents.upload", ...dash(["receivables", "sales", "stock"])]) },
  { name: "Staff (assigned customers only)", description: "Like Staff, but only for the customers assigned to them.", base_role: "sales_person", data_scope: "assigned",
    permissions: grant([...full(["customers", "quotes", "sales_orders", "invoices", "payments_received", "credit_notes", "delivery_notes"]), "items.view", "receivables.view", "receivables.remind", "invoices.communicate", "quotes.communicate", "documents.view", ...dash(["receivables", "sales"])]) },
  { name: "Sales person", description: "Quotes, orders, invoices and payments for their own customers and sales.", base_role: "sales_person", data_scope: "own",
    permissions: grant([...full(["customers", "quotes", "sales_orders", "invoices"]), "payments_received.view", "payments_received.create", "items.view", "receivables.view", "receivables.remind", "invoices.communicate", "quotes.communicate", "leads.view", "leads.create", "leads.edit", "deals.view", "deals.create", "deals.edit", "crm_activities.view", "crm_activities.create", "crm_activities.edit", ...dash(["sales"]), ...reports(["sales"], ["view"])]) },
  { name: "Cashier", description: "The till, receipts and customer payments.", base_role: "cashier",
    permissions: grant(["pos.view", "pos.create", "pos.close_shift", "customers.view", "customers.create", "items.view", "invoices.view", "invoices.create", "payments_received.view", "payments_received.create", "quotes.view", "quotes.create", "attendance.view"]) },
  { name: "Stock controller", description: "Items, stock, transfers, stock takes, receiving and purchase orders.", base_role: "stock_manager",
    permissions: grant([...full(["items", "price_lists", "inventory_adjustments", "stock_transfers", "stock_takes", "purchase_receives", "requisitions"]), "purchase_orders.view", "purchase_orders.create", "purchase_orders.edit", "vendors.view", "rfqs.view", "rfqs.create", "delivery_notes.view", "delivery_notes.create", ...reports(["inventory"]), ...dash(["stock"])]) },
  { name: "HR officer", description: "Employees, leave, attendance, payroll and staff loans.", base_role: "manager",
    permissions: grant([...full(["employees", "payroll", "leave", "attendance", "hr_loans"]), "employees.salary", "payroll.send_payslips", "leave.approve", "documents.view", "documents.upload", ...reports(["hrm"])]) },
  { name: "Rider", description: "Deliveries assigned to them.", base_role: "rider", data_scope: "own", permissions: grant(["delivery_notes.view", "delivery_notes.edit"]) },
  // Employee logins made from HR: My Space only (their own payslips, leave, attendance and details).
  { name: "Employee (My Space only)", description: "Their own payslips, leave, attendance and details. Nothing else.", base_role: "sales_person", data_scope: "own", permissions: grant([]) },
];

/** Older access keys the app checks (pages and menus) worked out from the detailed permissions. */
export function legacyKeys(p: Perms): Record<string, boolean> {
  const any = (...keys: string[]) => keys.some((k) => p[k]);
  const anyPrefix = (prefix: string) => Object.keys(p).some((k) => p[k] && k.startsWith(prefix));
  return {
    dashboard: anyPrefix("dashboard.") || any("invoices.view", "pos.view", "items.view"),
    pos: any("pos.view"),
    customers: any("customers.view"), customers_delete: any("customers.delete"),
    sales: any("quotes.view", "sales_orders.view", "invoices.view", "payments_received.view", "receivables.view", "leads.view", "deals.view"),
    quotes: any("quotes.view", "sales_orders.view"), invoices: any("invoices.view", "credit_notes.view"),
    inventory: any("items.view", "inventory_adjustments.view", "stock_transfers.view"), services: any("items.view"),
    purchases: any("purchase_orders.view", "vendors.view", "requisitions.view", "rfqs.view", "payments_made.view", "purchase_receives.view"), purchases_delete: any("purchase_orders.delete"),
    suppliers: any("vendors.view"), expenses: any("expenses.view"), expenses_delete: any("expenses.delete"), bills: any("bills.view"),
    reports: anyPrefix("reports."), hrm: any("employees.view", "payroll.view", "leave.view"), staff: any("employees.view", "attendance.view", "pos.close_shift"),
    settings: anyPrefix("settings."), billing: any("settings.modules"), communication: any("settings.email"),
    documents: anyPrefix("documents."), packing: any("delivery_notes.view"), delivery: any("delivery_notes.view"),
  };
}
