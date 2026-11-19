// ---------------------------------------------------------------------------
// Move-in by API: pull a company's records from its previous cloud books
// (the Books / CRM / People family of APIs, OAuth 2 with data centres) and stage
// them for import.
//
// Connection (per company): either the platform's OAuth client (env
// MIGRATE_CLIENT_ID / MIGRATE_CLIENT_SECRET, redirect
// https://app.<root>/api/migrate/oauth/callback) or a "self client" the company
// creates in its old system's API console and pastes here (client id, secret,
// one-time grant code). Refresh token + client are kept in integration_secrets
// (migrate_*), never sent back to the browser.
//
// Jobs (migration_jobs) run in this process: every list page is fetched, and for
// documents with lines (quotes, invoices, credit notes, bills, payments,
// journals) each record's detail too. Rows are flattened to the same column
// names as the old system's CSV exports and staged in migration_rows, so the
// browser imports them with the file importer's engine. The API allows about
// 100 calls a minute and a daily quota; jobs pace themselves and pause until
// the quota resets.
// ---------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ROOT_HOST = process.env.ROOT_HOST || "garage.jmsurf.co.ke";
const CLIENT_ID = process.env.MIGRATE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MIGRATE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.MIGRATE_REDIRECT_URI || `https://app.${ROOT_HOST}/api/migrate/oauth/callback`;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(30000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database error ${res.status}`);
  return j;
}
const one = async (path) => (await db(path))?.[0] || null;

// ---- data centres --------------------------------------------------------
export const DATA_CENTRES = {
  com: { label: "United States / global (.com)", accounts: "https://accounts.zoho.com" },
  eu: { label: "Europe (.eu)", accounts: "https://accounts.zoho.eu" },
  in: { label: "India (.in)", accounts: "https://accounts.zoho.in" },
  au: { label: "Australia (.com.au)", accounts: "https://accounts.zoho.com.au" },
  jp: { label: "Japan (.jp)", accounts: "https://accounts.zoho.jp" },
  ca: { label: "Canada (.ca)", accounts: "https://accounts.zohocloud.ca" },
  sa: { label: "Saudi Arabia (.sa)", accounts: "https://accounts.zoho.sa" },
  uk: { label: "United Kingdom (.uk)", accounts: "https://accounts.zoho.uk" },
};
const SAFE_ACCOUNTS = /^https:\/\/accounts\.zoho(cloud)?\.[a-z]{2,3}(\.[a-z]{2})?$/;
const SAFE_API = /^https:\/\/(www\.)?zohoapis\.[a-z]{2,3}(\.[a-z]{2})?$|^https:\/\/www\.zohoapis\.(com|eu|in|com\.au|jp|ca|sa|uk)$/;

const SCOPES_BOOKS = [
  "ZohoBooks.settings.READ", "ZohoBooks.contacts.READ", "ZohoBooks.estimates.READ", "ZohoBooks.invoices.READ",
  "ZohoBooks.creditnotes.READ", "ZohoBooks.customerpayments.READ", "ZohoBooks.bills.READ", "ZohoBooks.vendorpayments.READ",
  "ZohoBooks.expenses.READ", "ZohoBooks.accountants.READ", "ZohoBooks.salesorders.READ",
  "ZohoBooks.banking.READ", "ZohoBooks.purchaseorders.READ", "ZohoBooks.debitnotes.READ", "ZohoBooks.projects.READ",
].join(",");
const SCOPES = [SCOPES_BOOKS, "ZohoCRM.modules.READ", "ZOHOPEOPLE.forms.READ", "ZohoProjects.portals.READ", "ZohoProjects.projects.READ", "ZohoProjects.tasks.READ"].join(",");

// ---- secrets ---------------------------------------------------------------
async function secrets(tenantId) {
  return Object.fromEntries((await db(`integration_secrets?tenant_id=eq.${tenantId}&name=like.migrate_*&select=name,value`)).map((x) => [x.name, x.value]));
}
async function setSecret(tenantId, name, value) {
  await db(`integration_secrets?tenant_id=eq.${tenantId}&name=eq.${enc(name)}`, { method: "DELETE", prefer: "return=minimal" });
  if (value) await db("integration_secrets", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, name, value: String(value), updated_at: new Date().toISOString() } });
}
async function settings(tenantId) {
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=id,erp_settings`);
  return { id: s?.id, erp: s?.erp_settings || {}, m: s?.erp_settings?.migrate || {} };
}
async function saveSettings(tenantId, patch) {
  const s = await settings(tenantId);
  if (!s.id) throw new HttpError(400, "Company settings are missing");
  await db(`business_settings?id=eq.${s.id}`, { method: "PATCH", prefer: "return=minimal", body: { erp_settings: { ...s.erp, migrate: { ...s.m, ...patch } } } });
}

// ---- tokens ----------------------------------------------------------------
async function exchange(accounts, params) {
  if (!SAFE_ACCOUNTS.test(accounts)) throw new HttpError(400, "Unknown data centre");
  const res = await fetch(`${accounts}/oauth/v2/token?${new URLSearchParams(params)}`, { method: "POST", signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.access_token) throw new HttpError(400, j.error === "invalid_code" ? "That code has expired or was already used. Generate a new one and paste it within 3 minutes." : `The old system refused the connection (${str(j.error) || res.status}).`);
  return j;
}

const access = new Map(); // tenantId → { token, until }
async function conn(tenantId) {
  const sec = await secrets(tenantId);
  const { m } = await settings(tenantId);
  if (!sec.migrate_refresh_token) throw new HttpError(400, "Connect your previous system first.");
  const clientId = sec.migrate_client_id || CLIENT_ID;
  const clientSecret = sec.migrate_client_secret || CLIENT_SECRET;
  const accounts = m.accounts || DATA_CENTRES.com.accounts;
  const api = SAFE_API.test(str(m.api_domain)) ? m.api_domain : "https://www.zohoapis.com";
  const hit = access.get(tenantId);
  if (hit && hit.until > Date.now()) return { ...m, api, accounts, token: hit.token };
  const j = await exchange(accounts, { refresh_token: sec.migrate_refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  access.set(tenantId, { token: j.access_token, until: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 });
  return { ...m, api, accounts, token: j.access_token };
}

class QuotaError extends Error { constructor(daily) { super(daily ? "Daily API limit reached" : "Rate limited"); this.daily = daily; } }

/** One API call. Throws QuotaError on 429 so the job can pause. */
async function api(c, url) {
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${c.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(45000) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 429) throw new QuotaError(/day|daily/i.test(str(j.message)));
  if (res.status === 401) { access.clear(); throw new HttpError(401, "The connection expired. Reconnect your previous system."); }
  if (res.status === 204) return {};
  if (!res.ok || (j.code !== undefined && j.code !== 0 && !j.data && !j.response)) throw new HttpError(502, str(j.message) || `The old system replied ${res.status}`);
  return j;
}
const books = (c, path, q = {}) => `${c.api}/books/v3/${path}?${new URLSearchParams({ organization_id: c.org_id, ...q })}`;

// ---- flatteners: API JSON → CSV-style rows (column names normalised like the importer) ----
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const R = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [norm(k), String(v)]));
const lineCols = (li) => ({ "Item Name": li.name || li.account_name || li.description, "Item Desc": li.description, Quantity: li.quantity, "Item Price": li.rate, "Item Total": li.item_total, "Item Tax %": li.tax_percentage, Discount: li.discount_amount || li.discount, Account: li.account_name });
/** Header + one row per line (or a single totals line when the detail was not fetched). */
function docRows(head, detail, total) {
  const lines = detail?.line_items?.length ? detail.line_items : [{ name: "Imported total", quantity: 1, rate: total, item_total: total }];
  return lines.map((li, i) => ({ ext: `${i}`, row: R({ ...head, ...lineCols(li) }) }));
}

const KIND_DEFS = {
  accounts: { list: "chartofaccounts", key: "chartofaccounts", id: "account_id",
    rows: (a) => [{ ext: "0", row: R({ "Account Name": a.account_name, "Account Code": a.account_code, "Account Type": a.account_type, Description: a.description, "Account Status": a.is_active === false ? "Inactive" : "Active" }) }] },
  contacts: { list: "contacts", key: "contacts", id: "contact_id", params: { contact_type: "customer", filter_by: "Status.All" },
    kindOf: (c) => (c.contact_type === "vendor" ? "vendors" : "customers"),
    rows: (c) => [{ ext: "0", row: R({ "Display Name": c.contact_name, "Company Name": c.company_name, "Contact Type": c.contact_type, "Customer Sub Type": c.customer_sub_type, EmailID: c.email, "Mobile Phone": c.mobile, Phone: c.phone, "First Name": c.first_name, "Last Name": c.last_name, "Payment Terms Label": c.payment_terms_label, Website: c.website, Status: c.status }) }] },
  // Zoho lists vendors only when asked for them (contact_type=vendor), so they are fetched on their own.
  // Some accounts ignore the filter and return every contact: customers are dropped here, or each one
  // would also become a vendor.
  vendor_contacts: { list: "contacts", key: "contacts", id: "contact_id", params: { contact_type: "vendor", filter_by: "Status.All" },
    keep: (c) => !c.contact_type || /vendor/i.test(String(c.contact_type)),
    kindOf: () => "vendors",
    rows: (c) => [{ ext: "0", row: R({ "Display Name": c.contact_name, "Company Name": c.company_name, "Contact Type": c.contact_type, "Customer Sub Type": c.customer_sub_type, EmailID: c.email, "Mobile Phone": c.mobile, Phone: c.phone, "First Name": c.first_name, "Last Name": c.last_name, "Payment Terms Label": c.payment_terms_label, Website: c.website, Status: c.status }) }] },
  items: { list: "items", key: "items", id: "item_id",
    rows: (it) => [{ ext: "0", row: R({ "Item Name": it.name, SKU: it.sku, Rate: it.rate, "Purchase Rate": it.purchase_rate, "Purchase Description": it.purchase_description, "Can Be Sold": it.can_be_sold === false ? "false" : "true", "Can Be Purchased": it.can_be_purchased === false ? "false" : "true", "Usage unit": it.unit, "Tax Percentage": it.tax_percentage, Description: it.description, Status: it.status, "Product Type": it.product_type === "service" ? "service" : "goods", "Stock On Hand": it.stock_on_hand, "Reorder Level": it.reorder_level, UPC: it.upc || it.ean || it.isbn, "Category Name": it.category_name }) }] },
  quotes: { list: "estimates", key: "estimates", id: "estimate_id", detail: (x) => `estimates/${x.estimate_id}`, detailKey: "estimate",
    rows: (q, d) => docRows({ "Estimate Number": q.estimate_number, "Customer Name": q.customer_name, "Estimate Date": q.date, "Expiry Date": q.expiry_date, "Estimate Status": q.status, Total: q.total, SubTotal: d?.sub_total, "Tax Total": d?.tax_total, Notes: d?.notes, Terms: d?.terms, "Reference#": q.reference_number, "Sales person": q.salesperson_name }, d, q.total) },
  invoices: { list: "invoices", key: "invoices", id: "invoice_id", detail: (x) => `invoices/${x.invoice_id}`, detailKey: "invoice",
    rows: (v, d) => docRows({ "Invoice Number": v.invoice_number, "Customer Name": v.customer_name, "Invoice Date": v.date, "Due Date": v.due_date, "Invoice Status": v.status, Total: v.total, Balance: v.balance, SubTotal: d?.sub_total, "Tax Total": d?.tax_total, Notes: d?.notes, Terms: d?.terms, "Reference#": v.reference_number, "Sales person": v.salesperson_name, "Entity Discount Amount": d?.discount_total || undefined, "eTIMS Status": (d?.einvoice_details || v.einvoice_details)?.status, "eTIMS QR": (d?.einvoice_details || v.einvoice_details)?.qr_code }, d, v.total) },
  credit_notes: { list: "creditnotes", key: "creditnotes", id: "creditnote_id", detail: (x) => `creditnotes/${x.creditnote_id}`, detailKey: "creditnote", needsDetail: true,
    rows: (v, d) => docRows({ "Credit Note Number": v.creditnote_number, "Customer Name": v.customer_name, "Credit Note Date": v.date, "Credit Note Status": v.status, "eTIMS Status": (d?.einvoice_details || v.einvoice_details)?.status, "eTIMS QR": (d?.einvoice_details || v.einvoice_details)?.qr_code, Total: v.total, Balance: v.balance ?? d?.balance, SubTotal: d?.sub_total, "Tax Total": d?.tax_total, Reason: d?.reason, "Reference#": v.reference_number,
      "Invoices Credited": JSON.stringify((d?.invoices_credited || []).map((x) => ({ invoice_number: x.invoice_number, amount: x.credited_amount ?? x.amount_applied ?? x.amount }))) }, d, v.total) },
  bank_accounts: { list: "bankaccounts", key: "bankaccounts", id: "account_id",
    rows: (a) => [{ ext: "0", row: R({ "Account Name": a.account_name, "Account Type": a.account_type, "Account Number": a.account_number, "Bank Name": a.bank_name, Currency: a.currency_code, Balance: a.balance }) }] },
  purchase_orders: { list: "purchaseorders", key: "purchaseorders", id: "purchaseorder_id", detail: (x) => `purchaseorders/${x.purchaseorder_id}`, detailKey: "purchaseorder", needsDetail: true,
    rows: (po, d) => {
      const lines = d?.line_items?.length ? d.line_items : [{ name: "Imported total", quantity: 1, rate: po.total, item_total: po.total }];
      return lines.map((li, i) => ({ ext: `${i}`, row: R({ "Purchase Order Number": po.purchaseorder_number, "Vendor Name": po.vendor_name, "Purchase Order Date": po.date, "Delivery Date": po.delivery_date || d?.delivery_date, Status: po.order_status || po.status, Billed: po.billed_status || d?.billed_status, Total: po.total, SubTotal: d?.sub_total, "Tax Total": d?.tax_total, "Reference#": po.reference_number, Notes: d?.notes, "Quantity Received": li.quantity_received, ...lineCols(li) }) }));
    } },
  vendor_credits: { list: "vendorcredits", key: "vendorcredits", id: "vendor_credit_id", detail: (x) => `vendorcredits/${x.vendor_credit_id}`, detailKey: "vendor_credit", needsDetail: true,
    rows: (v, d) => docRows({ "Vendor Credit Number": v.vendor_credit_number, "Vendor Name": v.vendor_name, "Vendor Credit Date": v.date, Status: v.status, Total: v.total, Balance: v.balance ?? d?.balance, "Reference#": v.reference_number, Notes: d?.notes,
      "Bills Credited": JSON.stringify((d?.bills_credited || []).map((x) => ({ bill_number: x.bill_number, amount: x.credited_amount ?? x.amount ?? x.amount_applied }))) }, d, v.total) },
  recurring_invoices: { list: "recurringinvoices", key: "recurring_invoices", id: "recurrence_id", detail: (x) => `recurringinvoices/${x.recurrence_id}`, detailKey: "recurring_invoice",
    rows: (r, d) => docRows({ "Profile Name": r.recurrence_name, "Customer Name": r.customer_name, Frequency: r.recurrence_frequency, "Repeat Every": r.repeat_every, "Next Date": r.next_invoice_date, Status: r.status, Total: r.total }, d, r.total) },
  recurring_bills: { list: "recurringbills", key: "recurring_bills", id: "recurring_bill_id", detail: (x) => `recurringbills/${x.recurring_bill_id}`, detailKey: "recurring_bill",
    rows: (r, d) => docRows({ "Profile Name": r.recurrence_name, "Vendor Name": r.vendor_name, Frequency: r.recurrence_frequency, "Repeat Every": r.repeat_every, "Next Date": r.next_bill_date, Status: r.status, Total: r.total }, d, r.total) },
  price_lists: { list: "pricebooks", key: "pricebooks", id: "pricebook_id", detail: (x) => `pricebooks/${x.pricebook_id}`, detailKey: "pricebook", needsDetail: true,
    rows: (pb, d) => {
      const head = { "Price List Name": pb.name, Type: pb.pricebook_type || d?.pricebook_type, Percentage: pb.percentage ?? d?.percentage, "Markup or Markdown": (pb.is_increase ?? d?.is_increase) === false ? "markdown" : "markup", Status: pb.status, Description: pb.description || d?.description };
      const its = d?.pricebook_items || d?.items || [];
      return its.length ? its.map((it, i) => ({ ext: `${i}`, row: R({ ...head, "Item Name": it.name || it.item_name, Rate: it.pricebook_rate ?? it.rate }) })) : [{ ext: "0", row: R(head) }];
    } },
  timesheets: { list: "projects/timeentries", key: "time_entries", id: "time_entry_id",
    rows: (t) => [{ ext: "0", row: R({ "Time Entry ID": t.time_entry_id, "Project ID": t.project_id, "Project Name": t.project_name, "Task ID": t.task_id, "Task Name": t.task_name, "User Name": t.user_name, "Log Date": t.log_date, "Logged Hours": t.log_time, Billable: t.is_billable === false ? "no" : "yes", "Billed Status": t.billed_status, Notes: t.notes }) }] },
  recurring_expenses: { list: "recurringexpenses", key: "recurring_expenses", id: "recurring_expense_id",
    rows: (r) => [{ ext: "0", row: R({ "Profile Name": r.recurrence_name, "Expense Account": r.account_name, Total: r.total, Vendor: r.vendor_name, Frequency: r.recurrence_frequency, "Repeat Every": r.repeat_every, "Next Date": r.next_expense_date, Status: r.status }) }] },
  sales_orders: { list: "salesorders", key: "salesorders", id: "salesorder_id", detail: (x) => `salesorders/${x.salesorder_id}`, detailKey: "salesorder",
    rows: (v, d) => docRows({ "SalesOrder Number": v.salesorder_number, "Customer Name": v.customer_name, "Order Date": v.date, "Expected Shipment Date": v.shipment_date, Status: v.status, Total: v.total, SubTotal: d?.sub_total, "Tax Total": d?.tax_total, Notes: d?.notes, Terms: d?.terms, "Reference#": v.reference_number }, d, v.total) },
  payments: { list: "customerpayments", key: "customerpayments", id: "payment_id", detail: (x) => `customerpayments/${x.payment_id}`, detailKey: "payment", needsDetail: true,
    // One invoice (or none), nothing left unused, no tax withheld: the list says it all, no detail call.
    listEnough: (p) => !String(p.invoice_numbers || "").includes(",") && !(Number(p.unused_amount) > 0) && !(Number(p.tax_amount_withheld) > 0),
    rows: (p, d) => {
      const head = { "Payment Number": p.payment_number, "Customer Name": p.customer_name, Date: p.date, Amount: p.amount, Mode: p.payment_mode, "Reference Number": p.reference_number, Description: p.description };
      const inv = d?.invoices || (!d && p.invoice_numbers ? [{ invoice_number: String(p.invoice_numbers).trim(), amount_applied: p.amount }] : []);
      return inv.length ? inv.map((x, i) => ({ ext: `${i}`, row: R({ ...head, "Invoice Number": x.invoice_number, "Amount Applied to Invoice": x.amount_applied }) })) : [{ ext: "0", row: R(head) }];
    } },
  bills: { list: "bills", key: "bills", id: "bill_id", detail: (x) => `bills/${x.bill_id}`, detailKey: "bill",
    rows: (b, d) => {
      const lines = d?.line_items?.length ? d.line_items : [{ name: "Imported total", quantity: 1, rate: b.total, item_total: b.total }];
      return lines.map((li, i) => ({ ext: `${i}`, row: R({ "Bill Number": b.bill_number, "Vendor Name": b.vendor_name, "Vendor Credit IDs": (d?.vendor_credits || []).map((v) => v.vendor_credit_id).filter(Boolean).join(","), "Bill Date": b.date, "Due Date": b.due_date, "Bill Status": b.status, Total: b.total, Balance: b.balance, "Reference Number": b.reference_number, Notes: d?.notes, "Tax Amount": i === 0 ? d?.tax_total : 0, ...lineCols(li) }) }));
    } },
  vendor_payments: { list: "vendorpayments", key: "vendorpayments", id: "payment_id", detail: (x) => `vendorpayments/${x.payment_id}`, detailKey: "vendorpayment", needsDetail: true,
    listEnough: (p) => !String(p.bill_numbers || "").includes(",") && !(Number(p.balance) > 0),
    rows: (p, d) => {
      const head = { "Payment Number": p.payment_number, "Vendor Name": p.vendor_name, Date: p.date, Amount: p.amount, Mode: p.payment_mode, Description: p.description };
      const bl = d?.bills || (!d && p.bill_numbers ? [{ bill_number: String(p.bill_numbers).trim(), amount_applied: p.amount }] : []);
      return bl.length ? bl.map((x, i) => ({ ext: `${i}`, row: R({ ...head, "Bill Number": x.bill_number, "Amount Applied to Bill": x.amount_applied }) })) : [{ ext: "0", row: R(head) }];
    } },
  expenses: { list: "expenses", key: "expenses", id: "expense_id",
    rows: (e) => [{ ext: "0", row: R({ "Expense Date": e.date, "Expense Account": e.account_name, Total: e.total, "Tax Amount": e.tax_amount, Vendor: e.vendor_name, "Paid Through": e.paid_through_account_name, "Reference#": e.reference_number, Description: e.description, "Customer Name": e.customer_name }) }] },
  journals: { list: "journals", key: "journals", id: "journal_id", detail: (x) => `journals/${x.journal_id}`, detailKey: "journal", needsDetail: true,
    rows: (j, d) => (d?.line_items || []).map((li, i) => ({ ext: `${i}`, row: R({ "Journal Number": j.entry_number || j.journal_number || j.journal_id, "Journal Date": j.journal_date, Notes: j.notes || d?.notes, "Reference Number": j.reference_number, Account: li.account_name, Description: li.description, Debit: li.debit_or_credit === "debit" ? li.amount : 0, Credit: li.debit_or_credit === "credit" ? li.amount : 0 }) })) },
};
// Which kinds come from which list (contacts feed both customers and vendors).
const SOURCE_OF = { customers: "contacts", vendors: "vendor_contacts" };
export const API_KINDS = ["accounts", "bank_accounts", "customers", "vendors", "items", "quotes", "sales_orders", "invoices", "credit_notes", "payments", "purchase_orders", "bills", "vendor_credits", "vendor_payments", "expenses", "journals", "opening_balances", "bank_transactions", "recurring_invoices", "recurring_bills", "recurring_expenses", "price_lists", "projects", "timesheets", "attachments", "leads", "crm", "employees"];
// CRM modules read by the "crm" kind, with the fields asked for (the CRM API needs them named).
const CRM_MODULES = [
  ["Accounts", "Account_Name,Account_Type,Phone,Website,Industry,Billing_Street,Billing_City,Billing_State,Billing_Country,Billing_Code,Description,Account_Number"],
  ["Contacts", "First_Name,Last_Name,Salutation,Email,Phone,Mobile,Title,Department,Account_Name,Mailing_Street,Mailing_City,Mailing_Country,Description"],
  ["Products", "Product_Name,Product_Code,Product_Category,Manufacturer,Unit_Price,Usage_Unit,Qty_in_Stock,Description,Product_Active,Tax,Vendor_Name"],
  ["Deals", "Deal_Name,Account_Name,Contact_Name,Amount,Stage,Probability,Closing_Date,Lead_Source,Next_Step,Description,Type"],
  ["Notes", "Note_Title,Note_Content,Parent_Id,Created_Time"],
];
const lk = (v) => (v && typeof v === "object" ? v.name : v);
/** Milliseconds since 1970 → YYYY-MM-DD (Nairobi), or undefined. */
const isoDay = (ms) => (Number(ms) > 0 ? new Date(Number(ms) + 3 * 3600_000).toISOString().slice(0, 10) : undefined);
/** One CRM record → [staged kind, row]. Accounts and contacts without an account become customers (or vendors); products become items. */
function crmRow(mod, x) {
  if (mod === "Accounts") {
    const vendor = /vendor|supplier/i.test(str(x.Account_Type));
    return [vendor ? "vendors" : "customers", R({ "Display Name": x.Account_Name, "Company Name": x.Account_Name, "Contact Type": vendor ? "vendor" : "customer", "Customer Sub Type": "business", Phone: x.Phone, Website: x.Website,
      "Billing Address": x.Billing_Street, "Billing City": x.Billing_City, "Billing State": x.Billing_State, "Billing Country": x.Billing_Country, "Billing Code": x.Billing_Code,
      Notes: [x.Industry && `Industry: ${x.Industry}`, x.Account_Type && `Type: ${x.Account_Type}`, x.Description].filter(Boolean).join("\n"), "Customer Number": x.Account_Number })];
  }
  if (mod === "Contacts") {
    const account = lk(x.Account_Name);
    if (account) return ["crm_contacts", R({ "Account Name": account, Salutation: x.Salutation, "First Name": x.First_Name, "Last Name": x.Last_Name, Email: x.Email, Phone: x.Phone, Mobile: x.Mobile, Title: x.Title, Department: x.Department })];
    return ["customers", R({ "Display Name": [x.First_Name, x.Last_Name].filter(Boolean).join(" "), "First Name": x.First_Name, "Last Name": x.Last_Name, Salutation: x.Salutation, EmailID: x.Email, "Mobile Phone": x.Mobile, Phone: x.Phone, Designation: x.Title,
      "Billing Address": x.Mailing_Street, "Billing City": x.Mailing_City, "Billing Country": x.Mailing_Country, Notes: x.Description, "Contact Type": "customer", "Customer Sub Type": "individual" })];
  }
  if (mod === "Products") return ["items", R({ "Item Name": x.Product_Name, SKU: x.Product_Code, "Category Name": x.Product_Category, Brand: x.Manufacturer, Rate: x.Unit_Price, "Usage unit": x.Usage_Unit, Description: x.Description,
    Status: x.Product_Active === false ? "Inactive" : "Active", "Opening Stock": x.Qty_in_Stock, "Preferred Vendor": lk(x.Vendor_Name) })];
  if (mod === "Deals") return ["deals", R({ "Deal Name": x.Deal_Name, "Account Name": lk(x.Account_Name), "Contact Name": lk(x.Contact_Name), Amount: x.Amount, Stage: x.Stage, Probability: x.Probability, "Closing Date": x.Closing_Date, "Lead Source": x.Lead_Source, "Next Step": x.Next_Step, Description: x.Description, Type: x.Type })];
  if (mod === "Notes") {
    const p = x.Parent_Id || {};
    return ["crm_notes", R({ "Parent Module": p.module?.api_name || x.$se_module, "Parent Name": p.name, Title: x.Note_Title, Content: x.Note_Content, Created: x.Created_Time })];
  }
  return [null, null];
}
// Documents whose files are copied when "attachments" is chosen: kind → [record type in DASH, API path, number].
const ATTACH = {
  invoices: ["invoice", "invoices", (x) => x.invoice_number], quotes: ["quote", "estimates", (x) => x.estimate_number], sales_orders: ["sales_order", "salesorders", (x) => x.salesorder_number],
  credit_notes: ["credit_note", "creditnotes", (x) => x.creditnote_number], bills: ["bill", "bills", (x) => x.bill_number], purchase_orders: ["purchase_order", "purchaseorders", (x) => x.purchaseorder_number],
  vendor_credits: ["vendor_credit", "vendorcredits", (x) => x.vendor_credit_number], journals: ["journal", "journals", (x) => x.entry_number || x.journal_number],
};
const ATTACH_ID = { invoices: "invoice_id", quotes: "estimate_id", sales_orders: "salesorder_id", credit_notes: "creditnote_id", bills: "bill_id", purchase_orders: "purchaseorder_id", vendor_credits: "vendor_credit_id", journals: "journal_id", expenses: "expense_id" };
const safeName = (v) => str(v).replace(/[^a-z0-9.]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80) || "file";
/** Copies one file into the company's private document store. */
async function storePut(path, buf, type) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${path.split("/").map(enc).join("/")}`, {
    method: "POST", signal: AbortSignal.timeout(60000), body: buf,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": type || "application/octet-stream", "x-upsert": "true" },
  });
  if (!res.ok) throw new Error(`Could not store ${path}: ${res.status}`);
}
// Bank transactions the old system made from documents imported on their own (or from opening balances).
const BANK_FROM_DOCS = /^(customer_?payment|vendor_?payment|expense|bill|invoice|journal|manual_?journal|opening_?balance|vendor_?credit_?refund|vendor_?refund|debit_?note_?refund)$/i;

// ---- worker ------------------------------------------------------------------
const running = new Set();
const drops = new Map(); // jobId → connection drops in a row
let windowStart = Date.now(); let windowCalls = 0;
async function pace() {
  // Stay under ~90 calls a minute across all jobs in this process.
  if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); windowCalls = 0; }
  if (windowCalls >= 90) { await sleep(60_000 - (Date.now() - windowStart) + 500); windowStart = Date.now(); windowCalls = 0; }
  windowCalls++;
}

/** Runs fn over list, n at a time (stops at the first error, e.g. a limit that pauses the job). */
async function eachOf(list, n, fn) {
  let i = 0; let err = null;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => {
    while (!err && i < list.length) { try { await fn(list[i++]); } catch (e) { err = e; } }
  }));
  if (err) throw err;
}

const ZOHO_SERIES = [
  ["invoice", "invoices/editpage", "invoices", "invoice_number"], ["quote", "estimates/editpage", "quotes", "quote_number"],
  ["sales_order", "salesorders/editpage", "sales_orders", "quote_number"], ["credit_note", "creditnotes/editpage", "credit_notes", "credit_note_number"],
  ["payment", "customerpayments/editpage", "payments_received", "payment_number"], ["po", "purchaseorders/editpage", "purchases", "po_number"],
  ["vendor_credit", "vendorcredits/editpage", "vendor_credits", "credit_number"], ["journal", "journals/editpage", "journals", "journal_number"],
];
/** After a Zoho move-in: each document series continues from Zoho's next number, with Zoho's prefix and zero-padding. */
async function zohoNumbering(tenantId, orgId) {
  const c = await conn(tenantId);
  if (orgId) c.org_id = orgId;
  const out = {};
  for (const [kind, path, table, col] of ZOHO_SERIES) {
    await pace();
    const j = await api(c, books(c, path)).catch(() => null);
    const st = j && Object.entries(j).find(([k, v]) => /_settings$/.test(k) && v && typeof v === "object" && ("next_number" in v))?.[1];
    const next = str(st?.next_number);
    if (!/^\d+$/.test(next)) continue;
    const prefix = str(st?.prefix_string);
    // Never hand out a number already used here: the highest one in this series, plus one.
    const used = await db(`${table}?tenant_id=eq.${tenantId}&${col}=like.${encodeURIComponent(prefix.replace(/[%_]/g, ""))}*&select=${col}`).catch(() => []);
    const highest = used.map((r) => str(r[col])).filter((v) => v.startsWith(prefix) && /^\d+$/.test(v.slice(prefix.length))).reduce((m, v) => Math.max(m, Number(v.slice(prefix.length))), 0);
    const value = Math.max(Number(next), highest + 1);
    await db("doc_sequences?on_conflict=tenant_id,kind", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { tenant_id: tenantId, kind, prefix, next_value: value, pad: next.length } });
    out[kind] = `${prefix}${String(value).padStart(next.length, "0")}`;
  }
  return out;
}

/**
 * The organisation's profile in the old books: name, address, phone, email, website, tax PIN and logo
 * become the company's details here, its document header and its reply-to address. Only empty values
 * are filled, so nothing the company already set is overwritten.
 */
async function applyZohoProfile(tenantId, c) {
  await pace();
  const org = (await api(c, books(c, `organizations/${c.org_id}`))).organization || {};
  if (!org.name) return { note: "No organisation profile" };
  const a = org.address || {};
  const address = [a.street_address1, a.street_address2, a.city, a.state, a.country].map(str).filter(Boolean).join(", ");
  const postal = str(a.zip);
  const pin = str(org.tax_settings?.tax_reg_no || org.tax_id_value || org.company_id_value);
  const t = (await db(`tenants?id=eq.${tenantId}&select=logo_url,business_email,business_phone,business_address,industry`))[0] || {};
  const s = (await db(`business_settings?tenant_id=eq.${tenantId}&select=id,business_phone,business_email,business_address,postal_address,tax_pin,business_website,doc_contact,erp_settings`))[0];
  const done = [];
  // The logo: the old system's own copy, stored as this company's logo.
  if (!t.logo_url && org.logo_url) {
    const path = str(org.logo_url).replace(/^https:\/\/[^/]+\/api\/v3\//, "");
    await pace();
    const res = await fetch(`${c.api}/books/v3/${path}?organization_id=${c.org_id}`, { headers: { Authorization: `Zoho-oauthtoken ${c.token}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    const type = str(res?.headers.get("content-type")).split(";")[0];
    if (res?.ok && type.startsWith("image/")) {
      const file = `${tenantId}/logo-${Date.now()}.${type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1] || "png"}`;
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tenant-logos/${file}`, { method: "POST", body: Buffer.from(await res.arrayBuffer()), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": type, "x-upsert": "true" }, signal: AbortSignal.timeout(30000) });
      if (up.ok) {
        const base = (process.env.PUBLIC_SUPABASE_URL || `https://${ROOT_HOST}`).replace(/\/+$/, "");
        await db(`tenants?id=eq.${tenantId}`, { method: "PATCH", prefer: "return=minimal", body: { logo_url: `${base}/storage/v1/object/public/tenant-logos/${file}` } });
        done.push("logo");
      }
    }
  }
  const tp = {};
  if (!t.business_email && org.email) tp.business_email = org.email;
  if (!t.business_phone && org.phone) tp.business_phone = org.phone;
  if (!t.business_address && address) tp.business_address = address;
  if (Object.keys(tp).length) await db(`tenants?id=eq.${tenantId}`, { method: "PATCH", prefer: "return=minimal", body: tp });
  if (s?.id) {
    const sp = {};
    if (!s.business_phone && org.phone) sp.business_phone = org.phone;
    if (!s.business_email && org.email) sp.business_email = org.email;
    if (!s.business_address && address) sp.business_address = address;
    if (!s.postal_address && postal) sp.postal_address = postal;
    if (!s.tax_pin && pin) sp.tax_pin = pin;
    if (!s.business_website && org.website) sp.business_website = org.website;
    // What the documents print under the company name.
    if (!s.doc_contact) sp.doc_contact = { fields: [
      { key: "postal", show: !!postal, value: postal || null }, { key: "address", show: !!address, value: address || null },
      { key: "website", show: !!org.website, value: org.website || null }, { key: "email", show: !!org.email, value: org.email || null },
      { key: "phone", show: !!org.phone, value: org.phone || null }, { key: "kraPin", show: !!pin, value: pin || null },
      { key: "vatNumber", show: false, value: null }, { key: "extra", show: false, value: null },
    ] };
    // Replies to emails go to the company's own address, under its name.
    const em = s.erp_settings?.email || {};
    if (org.email && (!em.reply_to || !em.from_name)) sp.erp_settings = { ...(s.erp_settings || {}), email: { ...em, reply_to: em.reply_to || org.email, from_name: em.from_name || org.name } };
    if (Object.keys(sp).length) { await db(`business_settings?id=eq.${s.id}`, { method: "PATCH", prefer: "return=minimal", body: sp }); done.push(...Object.keys(sp).filter((k) => k !== "erp_settings"), ...(sp.erp_settings ? ["email reply-to"] : [])); }
  }
  return { fetched: done.length, note: done.length ? `Brought: ${done.join(", ").replace(/_/g, " ")}` : "Profile already set here" };
}

async function stage(job, kind, docId, rows) {
  if (!rows.length) return;
  await db("migration_rows?on_conflict=job_id,kind,ext_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: rows.map((r) => ({ job_id: job.id, tenant_id: job.tenant_id, kind, doc_id: String(docId), ext_id: `${docId}:${r.ext}`, row: r.row })) });
}
async function patchJob(id, body) {
  await db(`migration_jobs?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { ...body, updated_at: new Date().toISOString() } });
}

/** The ordered list of sources a job walks. */
function sourcesFor(kinds) {
  const out = [];
  for (const k of API_KINDS) {
    if (!kinds.includes(k) || k === "attachments") continue;
    const src = SOURCE_OF[k] || k;
    if (!out.includes(src)) out.push(src);
    // Projects also live in the separate projects app (more projects, owners, dates).
    if (k === "projects" && !out.includes("projects_app")) out.push("projects_app");
  }
  return out;
}

async function runJob(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    let job = await one(`migration_jobs?id=eq.${jobId}&select=*`);
    if (!job || !["fetching", "paused"].includes(job.status)) return;
    if (job.status === "paused") await patchJob(job.id, { status: "fetching", resume_after: null, error: null });
    if (job.source && job.source !== "books_api") { await runSourceJob(job); return; }
    const c = await conn(job.tenant_id);
    c.org_id = job.org_id;
    const srcs = sourcesFor(job.kinds);
    const cur = { src: 0, page: 1, ...job.cursor };
    const progress = { ...job.progress };
    let calls = job.api_calls;
    const call = async (url) => { await pace(); calls++; return api(c, url); };
    // Files: a binary answer is the file; a JSON answer means "not here", try the next address.
    const raw = async (url) => {
      await pace(); calls++;
      const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${c.token}` }, signal: AbortSignal.timeout(90000) });
      if (res.status === 429) throw new QuotaError(false);
      const type = str(res.headers.get("content-type")).split(";")[0];
      if (!res.ok || type === "application/json") return null;
      return { buf: Buffer.from(await res.arrayBuffer()), type };
    };
    const copyFiles = async (src, x, docs, urlFor) => {
      if (!job.kinds.includes("attachments") || !docs?.length) return;
      const [entity, , numberOf] = ATTACH[src] || ["expense", "expenses", () => ""];
      const id = String(x[ATTACH_ID[src]]);
      const docKey = `${src}:${id}`;
      const done = new Set((await db(`migration_rows?job_id=eq.${job.id}&kind=eq.attachments&doc_id=eq.${enc(docKey)}&select=ext_id`)).map((r) => r.ext_id));
      for (const doc of docs) {
        const docId = String(doc.document_id || doc.attachment_id || "receipt");
        if (done.has(`${docKey}:${docId}`)) continue;
        if (Number(doc.file_size || 0) > 20 * 1024 * 1024) { progress.attachments = { ...(progress.attachments || {}), note: "Files over 20 MB were left in the old system." }; continue; }
        let file = null;
        for (const u of urlFor(id, docId)) { file = await raw(u); if (file) break; }
        if (!file) continue;
        const number = str(numberOf(x)) || id;
        const path = `${job.tenant_id}/migration/${entity}/${safeName(number)}/${safeName(docId)}-${safeName(doc.file_name || doc.receipt_name || "attachment")}`;
        await storePut(path, file.buf, file.type || doc.file_type);
        await stage(job, "attachments", docKey, [{ ext: docId, row: R({ Module: entity, Number: entity === "expense" ? "" : number, "Storage Path": path, "File Name": doc.file_name || doc.receipt_name || "Attachment", "Mime Type": file.type || doc.file_type, Size: file.buf.length, Date: x.date, Amount: x.total }) }]);
        progress.attachments = { ...(progress.attachments || {}), fetched: Number(progress.attachments?.fetched || 0) + 1 };
      }
    };

    for (; cur.src < srcs.length; cur.src++, cur.page = 1) {
      const src = srcs[cur.src];
      for (;;) {
        // Cancelled from the browser?
        const fresh = await one(`migration_jobs?id=eq.${job.id}&select=status`);
        if (fresh?.status !== "fetching") return;
        let items = []; let more = false;
        if (src === "leads") {
          const j = await call(`${c.api}/crm/v7/Leads?${new URLSearchParams({ fields: "First_Name,Last_Name,Company,Email,Phone,Mobile,Website,City,Country,Lead_Source,Lead_Status,Description,Annual_Revenue", page: String(cur.page), per_page: "200" })}`).catch((e) => {
            if (e instanceof QuotaError) throw e;
            progress.leads = { ...(progress.leads || {}), note: "No CRM data (or no access)." }; return {};
          });
          items = j.data || []; more = !!j.info?.more_records;
          for (const l of items) await stage(job, "leads", l.id, [{ ext: "0", row: R({ "First Name": l.First_Name, "Last Name": l.Last_Name, Company: l.Company, Email: l.Email, Phone: l.Phone, Mobile: l.Mobile, Website: l.Website, City: l.City, Country: l.Country, "Lead Source": l.Lead_Source, "Lead Status": l.Lead_Status, Description: l.Description, "Annual Revenue": l.Annual_Revenue }) }]);
          progress.leads = { ...(progress.leads || {}), fetched: Number(progress.leads?.fetched || 0) + items.length };
        } else if (src === "projects_app") {
          // The projects app: every portal's projects (open and archived) with their tasks.
          const host = c.api.replace("www.zohoapis.", "projectsapi.zoho.");
          const none = (e) => { if (e instanceof QuotaError) throw e; progress.projects = { ...(progress.projects || {}), note: "No projects app data, or the connection was made before it was added: connect again to include it." }; return {}; };
          if (!cur.portals) {
            const pj = await call(`${host}/restapi/portals/`).catch(none);
            cur.portals = (pj.portals || []).map((p) => String(p.id_string || p.id));
            cur.portal = 0;
          }
          const portal = cur.portals[cur.portal];
          if (!portal) { items = []; more = false; }
          else {
            const j = await call(`${host}/restapi/portal/${portal}/projects/?${new URLSearchParams({ index: String((cur.page - 1) * 100 + 1), range: "100" })}`).catch(none);
            items = j.projects || [];
            for (const pr of items) {
              const pid = String(pr.id_string || pr.id);
              await stage(job, "projects", `zp:${pid}`, [{ ext: "0", row: R({ "Record Type": "project", "Project ID": `zp${pid}`, "Project Name": pr.name, Status: pr.custom_status_name || pr.status, Description: pr.description, "Start Date": isoDay(pr.start_date_long), "End Date": isoDay(pr.end_date_long), Owner: pr.owner_name }) }]);
              for (let tp = 0; tp < 50; tp++) {
                const tj = await call(`${host}/restapi/portal/${portal}/projects/${pid}/tasks/?${new URLSearchParams({ index: String(tp * 100 + 1), range: "100" })}`).catch((e) => { if (e instanceof QuotaError) throw e; return {}; });
                const ts = tj.tasks || [];
                for (const t of ts) await stage(job, "projects", `zt:${t.id_string || t.id}`, [{ ext: "0", row: R({ "Record Type": "task", "Task ID": `zt${t.id_string || t.id}`, "Task Name": t.name, "Project ID": `zp${pid}`, "Project Name": pr.name,
                  Status: t.status?.name || t.status, "Due Date": isoDay(t.end_date_long), "Budget Hours": t.duration && /hrs?|hours?/i.test(String(t.duration_type || "")) ? t.duration : undefined, Description: t.description, Owner: (t.details?.owners || []).map((o) => o.name).filter(Boolean).join(", ") }) }]);
                if (ts.length < 100) break;
              }
              progress.projects = { ...(progress.projects || {}), fetched: Number(progress.projects?.fetched || 0) + 1 };
            }
            more = items.length === 100;
            if (!more) { cur.portal++; cur.page = 0; more = cur.portal < cur.portals.length; }
          }
        } else if (src === "crm") {
          // Accounts, contacts, products, deals and notes, one module after another.
          cur.crm = Number(cur.crm || 0);
          const [mod, fields] = CRM_MODULES[cur.crm] || [];
          if (!mod) { items = []; more = false; }
          else {
            const j = await call(`${c.api}/crm/v7/${mod}?${new URLSearchParams({ fields, page: String(cur.page), per_page: "200" })}`).catch((e) => {
              if (e instanceof QuotaError) throw e;
              progress.crm = { ...(progress.crm || {}), note: "No CRM data, or the connection was made before CRM was added: connect again to allow it." }; return {};
            });
            items = j.data || []; more = !!j.info?.more_records;
            for (const x of items) {
              const [kind, row] = crmRow(mod, x);
              if (kind) await stage(job, kind, `crm:${x.id}`, [{ ext: "0", row }]);
            }
            const counts = { ...(progress.crm?.counts || {}), [mod]: Number(progress.crm?.counts?.[mod] || 0) + items.length };
            progress.crm = { ...(progress.crm || {}), counts, fetched: Object.values(counts).reduce((a, n) => a + n, 0) };
            if (!more) { cur.crm++; cur.page = 0; more = cur.crm < CRM_MODULES.length; }
          }
        } else if (src === "employees") {
          const people = c.api.replace("www.zohoapis.", "people.zoho.");
          const j = await call(`${people}/people/api/forms/employee/getRecords?${new URLSearchParams({ sIndex: String((cur.page - 1) * 200 + 1), limit: "200" })}`).catch((e) => {
            if (e instanceof QuotaError) throw e;
            progress.employees = { ...(progress.employees || {}), note: "No People data (or no access)." }; return {};
          });
          const res = j.response?.result || [];
          items = res.flatMap((rec) => Object.entries(rec).map(([id, arr]) => ({ id, ...(Array.isArray(arr) ? arr[0] : arr) })));
          more = items.length === 200;
          for (const e of items) await stage(job, "employees", e.id, [{ ext: "0", row: R({ "Employee ID": e.EmployeeID, "First Name": e.FirstName, "Last Name": e.LastName, "Email ID": e.EmailID, "Mobile Phone": e.Mobile || e.Work_phone, "Date of Joining": e.Dateofjoining, Gender: e.Gender, "Date of Birth": e.Date_of_birth, Designation: e.Designation, "Employee Status": e.Employeestatus }) }]);
          progress.employees = { ...(progress.employees || {}), fetched: Number(progress.employees?.fetched || 0) + items.length };
        } else if (src === "projects") {
          const j = await call(books(c, "projects", { page: String(cur.page), per_page: "200" }));
          items = j.projects || []; more = !!j.page_context?.has_more_page;
          for (const pr of items) {
            await stage(job, "projects", `p:${pr.project_id}`, [{ ext: "0", row: R({ "Record Type": "project", "Project ID": pr.project_id, "Project Name": pr.project_name, "Customer Name": pr.customer_name, Status: pr.status, "Billing Method": pr.billing_type, Rate: pr.rate, "Budget Hours": pr.budget_hours, "Budget Amount": pr.budget_amount || pr.cost_budget_amount, Description: pr.description }) }]);
            for (let tp = 1; tp < 50; tp++) {
              const tj = await call(books(c, `projects/${pr.project_id}/tasks`, { page: String(tp), per_page: "200" })).catch((e) => { if (e instanceof QuotaError) throw e; return {}; });
              const ts = tj.task || tj.tasks || [];
              for (const t of ts) await stage(job, "projects", `t:${t.task_id}`, [{ ext: "0", row: R({ "Record Type": "task", "Task ID": t.task_id, "Task Name": t.task_name, "Project ID": pr.project_id, "Project Name": pr.project_name, Status: t.status, Rate: t.rate, "Budget Hours": t.budget_hours, Description: t.description, Billable: t.is_billable === false ? "no" : "yes" }) }]);
              if (!tj.page_context?.has_more_page) break;
            }
            progress.projects = { ...(progress.projects || {}), fetched: Number(progress.projects?.fetched || 0) + 1 };
          }
        } else if (src === "opening_balances") {
          const j = await call(books(c, "settings/openingbalances")).catch((e) => {
            if (e instanceof QuotaError) throw e;
            progress.opening_balances = { ...(progress.opening_balances || {}), note: "No opening balances in the old system." }; return {};
          });
          const ob = j.opening_balance || {};
          items = ob.accounts || []; more = false;
          await stage(job, "opening_balances", "opening", items.map((a, i) => ({ ext: String(i), row: R({ Account: a.account_name, Debit: a.debit_or_credit === "debit" ? a.amount : 0, Credit: a.debit_or_credit === "credit" ? a.amount : 0, "Opening Date": ob.date }) })));
          progress.opening_balances = { ...(progress.opening_balances || {}), fetched: items.length };
        } else if (src === "bank_transactions") {
          if (!cur.accts) {
            const j = await call(books(c, "bankaccounts", { per_page: "200" }));
            cur.accts = (j.bankaccounts || []).map((a) => ({ id: String(a.account_id), name: str(a.account_name) }));
            cur.acct = 0;
          }
          const acct = cur.accts[cur.acct];
          if (!acct) { items = []; more = false; }
          else {
            const j = await call(books(c, "banktransactions", { account_id: acct.id, page: String(cur.page), per_page: "200", filter_by: "Status.All" }));
            items = j.banktransactions || [];
            for (const t of items) {
              const type = str(t.transaction_type);
              if (BANK_FROM_DOCS.test(type)) continue;
              // A transfer shows under both accounts; one copy is enough.
              const staged = await db(`migration_rows?job_id=eq.${job.id}&kind=eq.bank_transactions&doc_id=eq.${enc(String(t.transaction_id))}&select=doc_id&limit=1`);
              if (staged.length) continue;
              // Some listed rows (payment refunds, for one) are not banking transactions to Zoho's detail call
              // ("transaction ID … specific to banking"): keep the list's own figures for them.
              const d = /uncategori/i.test(str(t.status)) ? null : await call(books(c, `banktransactions/${t.transaction_id}`))
                .then((x) => x.banktransaction || null)
                .catch((e) => { if (e instanceof QuotaError) throw e; return null; });
              await stage(job, "bank_transactions", t.transaction_id, [{ ext: "0", row: R({ "Bank Account": acct.name, "Transaction ID": t.transaction_id, Date: t.date, Type: type, Direction: t.debit_or_credit, Amount: t.amount, Payee: t.payee, Reference: t.reference_number, Description: t.description, Status: t.status, "From Account": d?.from_account_name, "To Account": d?.to_account_name }) }]);
              progress.bank_transactions = { ...(progress.bank_transactions || {}), fetched: Number(progress.bank_transactions?.fetched || 0) + 1 };
            }
            more = !!j.page_context?.has_more_page;
            if (!more) { cur.acct++; cur.page = 0; more = cur.acct < cur.accts.length; }
          }
        } else {
          const def = KIND_DEFS[src];
          const j = await call(books(c, def.list, { page: String(cur.page), per_page: "200", ...(def.params || {}) }));
          items = j[def.key] || []; more = !!j.page_context?.has_more_page;
          const wantDetail = def.detail && (def.needsDetail || job.with_lines);
          let have = new Set();
          // The same document fetched by an earlier move-in of this company and not changed since: copied, no call.
          const prev = new Map();
          if (wantDetail && items.length) {
            const ids = items.map((x) => String(x[def.id]));
            const k = src;
            const inList = ids.map((x) => `"${x}"`).join(",");
            have = new Set((await db(`migration_rows?job_id=eq.${job.id}&kind=eq.${k}&doc_id=in.(${inList})&select=doc_id`)).map((x) => x.doc_id));
            const old = await db(`migration_rows?tenant_id=eq.${job.tenant_id}&kind=eq.${k}&job_id=neq.${job.id}&doc_id=in.(${inList})&select=job_id,doc_id,ext_id,row&order=id.desc&limit=5000`).catch(() => []);
            for (const r of old) {
              const p = prev.get(r.doc_id);
              if (p && p.job !== r.job_id) continue;
              if (!p) prev.set(r.doc_id, { job: r.job_id, rows: [r] }); else p.rows.push(r);
            }
          }
          await eachOf(items, wantDetail ? 4 : 1, async (x) => {
            if (def.keep && !def.keep(x)) return;
            const kind = def.kindOf ? def.kindOf(x) : src;
            if (def.kindOf && !job.kinds.includes(kind)) return;
            let d = null;
            // One document the old system refuses to open must not stop the whole move-in: it is left out,
            // counted and named in the step's note, and everything else carries on. Limits still pause the job.
            const detail = async () => {
              try { return (await call(books(c, def.detail(x))))[def.detailKey] || null; }
              catch (e) {
                if (e instanceof QuotaError) throw e;
                const p = progress[kind] || {};
                const left = [...(p.left || []), str(x.invoice_number || x.bill_number || x.estimate_number || x.salesorder_number || x.purchaseorder_number || x.creditnote_number || x.vendor_credit_number || x.payment_number || x.contact_name || x.name || x[def.id])].slice(-10);
                progress[kind] = { ...p, skipped: Number(p.skipped || 0) + 1, left, note: `${Number(p.skipped || 0) + 1} left out (the old system would not open them): ${left.join(", ")}` };
                console.error("[migrate]", job.id, kind, x[def.id], str(e.message).slice(0, 200));
                return undefined;
              }
            };
            const modified = str(x.last_modified_time);
            if (wantDetail) {
              if (have.has(String(x[def.id]))) return;
              const p = prev.get(String(x[def.id]));
              if (modified && p && p.rows.every((r) => r.row?.zohomodified === modified)) {
                await stage(job, kind, x[def.id], p.rows.map((r) => ({ ext: String(r.ext_id).split(":").slice(1).join(":"), row: r.row })));
                progress[kind] = { ...(progress[kind] || {}), fetched: Number(progress[kind]?.fetched || 0) + 1 };
                return;
              }
              if (!(def.listEnough && def.listEnough(x))) {
                d = await detail();
                if (d === undefined) return;
              }
            } else if (def.detail && x.einvoice_details?.status === "pushed") {
              // Reported to KRA eTIMS: only the full document carries the KRA receipt QR link.
              d = await detail();
              if (d === undefined) d = null;
            }
            const rows = def.rows(x, d);
            if (wantDetail && modified) rows.forEach((r) => { r.row.zohomodified = modified; });
            await stage(job, kind, x[def.id], rows);
            progress[kind] = { ...(progress[kind] || {}), fetched: Number(progress[kind]?.fetched || 0) + 1 };
            if (ATTACH[src] && d?.documents?.length) {
              const mod = ATTACH[src][1];
              await copyFiles(src, x, d.documents, (id, docId) => [books(c, `${mod}/${id}/documents/${docId}`), books(c, `${mod}/${id}/attachment`)]);
            } else if (src === "expenses" && (x.has_attachment || x.has_receipt || x.receipt_name)) {
              await copyFiles(src, x, [{ document_id: "receipt", file_name: x.receipt_name || `receipt-${x.expense_id}` }], (id) => [books(c, `expenses/${id}/receipt`)]);
            }
          });
        }
        cur.page++;
        await patchJob(job.id, { cursor: cur, progress, api_calls: calls });
        // Zoho's vendor credit list can leave out credits that are already applied; the bills name them.
        if (src === "vendor_credits" && !more && job.kinds.includes("vendor_credits")) {
          const named = new Set((await db(`migration_rows?job_id=eq.${job.id}&kind=eq.bills&row->>vendorcreditids=neq.&select=row`).catch(() => []))
            .flatMap((r) => String(r.row?.vendorcreditids || "").split(",")).filter(Boolean));
          const got = new Set((await db(`migration_rows?job_id=eq.${job.id}&kind=eq.vendor_credits&select=doc_id`).catch(() => [])).map((r) => String(r.doc_id)));
          const def = KIND_DEFS.vendor_credits;
          for (const id of named) {
            if (got.has(id)) continue;
            const d = (await call(books(c, `vendorcredits/${id}`)).catch((e) => { if (e instanceof QuotaError) throw e; return null; }))?.vendor_credit;
            if (!d) continue;
            await stage(job, "vendor_credits", id, def.rows(d, d));
            progress.vendor_credits = { ...(progress.vendor_credits || {}), fetched: Number(progress.vendor_credits?.fetched || 0) + 1 };
          }
        }
        if (!more || (!items.length && src !== "bank_transactions")) break;
      }
    }
    // The company's profile and logo from the old system (only what is still empty here).
    progress.profile = await applyZohoProfile(job.tenant_id, c).catch((e) => ({ note: `Profile not brought: ${str(e.message).slice(0, 120)}` }));
    await patchJob(job.id, { status: "fetched", cursor: cur, progress, api_calls: calls });
    drops.delete(jobId);
  } catch (e) {
    if (e instanceof QuotaError) {
      const wait = e.daily ? 6 * 3600_000 : 70_000;
      await patchJob(jobId, { status: "paused", resume_after: new Date(Date.now() + wait).toISOString(), error: e.daily ? "The old system's daily API limit was reached. The fetch continues automatically when it resets." : null }).catch(() => {});
    } else if (/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|aborted|timeout/i.test(`${e?.message} ${e?.cause?.code || ""}`) && Number(drops.get(jobId) || 0) < 8) {
      drops.set(jobId, Number(drops.get(jobId) || 0) + 1);
      console.error("[migrate]", jobId, "connection dropped, resuming in a minute:", e.message, e?.cause?.code || "", e?.cause?.message || "");
      await patchJob(jobId, { status: "paused", resume_after: new Date(Date.now() + 60_000).toISOString(), error: null }).catch(() => {});
    } else {
      console.error("[migrate]", jobId, e.message, e?.cause?.code || "", e?.cause?.message || "");
      await patchJob(jobId, { status: "failed", error: str(e.message).slice(0, 500) }).catch(() => {});
    }
  } finally { running.delete(jobId); }
}

async function tick() {
  const jobs = await db(`migration_jobs?or=(status.eq.fetching,and(status.eq.paused,resume_after.lt.${enc(new Date().toISOString())}))&select=id&limit=5`);
  for (const j of jobs) void runJob(j.id);
}
export function startMigrationJobs() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  setTimeout(() => void tick().catch((e) => console.error("[migrate]", e.message)), 20_000);
  setInterval(() => void tick().catch((e) => console.error("[migrate]", e.message)), 60_000);
}

// ---- OAuth state (signed, 15 minutes) ------------------------------------------
const sign = (payload) => {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b}.${createHmac("sha256", SERVICE_KEY).update(b).digest("base64url")}`;
};
const verify = (state) => {
  const [b, s] = str(state).split(".");
  if (!b || !s) return null;
  const want = createHmac("sha256", SERVICE_KEY).update(b).digest("base64url");
  if (want.length !== s.length || !timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  return p.exp > Date.now() ? p : null;
};

async function companyOrigin(tenantId) {
  const t = await one(`tenants?id=eq.${tenantId}&select=slug`);
  return t?.slug ? `https://${t.slug}.${ROOT_HOST}` : `https://app.${ROOT_HOST}`;
}

async function afterConnect(tenantId, j, accounts) {
  if (!j.refresh_token) throw new HttpError(400, "No long-lived access was granted. Try again and accept the request.");
  await setSecret(tenantId, "migrate_refresh_token", j.refresh_token);
  const api = SAFE_API.test(str(j.api_domain)) ? j.api_domain : "https://www.zohoapis.com";
  access.set(tenantId, { token: j.access_token, until: Date.now() + 3000_000 });
  // Organisations available to this login.
  const c = { api, token: j.access_token };
  const orgs = ((await api_(c, `${api}/books/v3/organizations`).catch(() => ({}))).organizations || [])
    .map((o) => ({ id: String(o.organization_id), name: str(o.name), currency: str(o.currency_code), default: !!o.is_default_org }));
  const pick = orgs.find((o) => o.default) || orgs[0];
  await saveSettings(tenantId, { accounts, api_domain: api, orgs, org_id: pick?.id || null, org_name: pick?.name || null, connected_at: new Date().toISOString() });
  return { orgs };
}
const api_ = (c, url) => api(c, url);

/** GET /api/migrate/oauth/callback (no session: the signed state carries the company). */
export async function handleMigrateCallback(req, res, search) {
  const q = new URLSearchParams(search || "");
  const st = verify(q.get("state"));
  const redirect = (url) => { res.writeHead(302, { Location: url, "Cache-Control": "no-store" }); res.end(); };
  if (!st) return redirect(`https://app.${ROOT_HOST}/`);
  const back = `${await companyOrigin(st.t)}/migrate`;
  try {
    if (q.get("error")) throw new HttpError(400, "access was not granted");
    const accounts = str(q.get("accounts-server")) || DATA_CENTRES[st.dc]?.accounts || DATA_CENTRES.com.accounts;
    const j = await exchange(accounts, { code: str(q.get("code")), client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" });
    await setSecret(st.t, "migrate_client_id", ""); await setSecret(st.t, "migrate_client_secret", "");
    await afterConnect(st.t, j, accounts);
    return redirect(`${back}?connected=1`);
  } catch (e) {
    return redirect(`${back}?error=${enc(str(e.message).slice(0, 160))}`);
  }
}

// ---- routes (POST /api/erp/migrate/*, signed-in admins) ------------------------
const admin = (who) => { if (!who.owner && !who.manager) throw new HttpError(403, "Only admins can move data in"); };
const jobView = (j) => j && ({ ...j, cursor: undefined });

export const migrateRoutes = {
  "/api/erp/migrate/status": async (who) => {
    admin(who);
    const { m } = await settings(who.tenantId);
    const sec = await secrets(who.tenantId);
    const jobs = await db(`migration_jobs?tenant_id=eq.${who.tenantId}&select=*&order=created_at.desc&limit=10`);
    return {
      oauth_available: !!(CLIENT_ID && CLIENT_SECRET), redirect_uri: REDIRECT_URI, scopes: SCOPES, scopes_books: SCOPES_BOOKS,
      data_centres: Object.fromEntries(Object.entries(DATA_CENTRES).map(([k, v]) => [k, v.label])),
      connected: !!sec.migrate_refresh_token, org_id: m.org_id || null, org_name: m.org_name || null, orgs: m.orgs || [], connected_at: m.connected_at || null,
      kinds: API_KINDS, jobs: jobs.map(jobView),
      odoo: sec.migrate_odoo_key && m.odoo ? { url: m.odoo.url, db: m.odoo.db, name: m.odoo.name, username: m.odoo.username, connected_at: m.odoo.connected_at } : null,
      quickbooks: sec.migrate_qbo_refresh && m.qbo ? { name: m.qbo.name, connected_at: m.qbo.connected_at } : null,
      qbo_available: !!(QBO_ID && QBO_SECRET), source_kinds: SOURCE_KINDS,
      oauth_sources: { sage: !!(SAGE_ID && SAGE_SECRET), xero: !!(XERO_ID && XERO_SECRET) },
      sources: {
        sage: sec.migrate_sage_refresh && m.sage ? { name: m.sage.name, org: m.sage.org, orgs: m.sage.orgs || [], connected_at: m.sage.connected_at } : null,
        xero: sec.migrate_xero_refresh && m.xero ? { name: m.xero.name, org: m.xero.org, orgs: m.xero.orgs || [], connected_at: m.xero.connected_at } : null,
        erpnext: sec.migrate_erpnext_key && m.erpnext ? { name: m.erpnext.name, url: m.erpnext.url, username: m.erpnext.user, connected_at: m.erpnext.connected_at } : null,
        loyverse: sec.migrate_loyverse_token && m.loyverse ? { name: m.loyverse.name, connected_at: m.loyverse.connected_at } : null,
      },
    };
  },
  "/api/erp/migrate/oauth-start": async (who, b) => {
    admin(who);
    if (!CLIENT_ID || !CLIENT_SECRET) throw new HttpError(400, "One-click connect is not set up on this platform yet. Use the self-client option.");
    const dc = DATA_CENTRES[str(b.dc)] ? str(b.dc) : "com";
    const state = sign({ t: who.tenantId, u: who.user.id, dc, exp: Date.now() + 15 * 60_000 });
    const url = `${DATA_CENTRES[dc].accounts}/oauth/v2/auth?${new URLSearchParams({ scope: str(b.plan) === "books" ? SCOPES_BOOKS : SCOPES, client_id: CLIENT_ID, response_type: "code", access_type: "offline", prompt: "consent", redirect_uri: REDIRECT_URI, state })}`;
    return { url };
  },
  "/api/erp/migrate/self-client": async (who, b) => {
    admin(who);
    const dc = DATA_CENTRES[str(b.dc)] ? str(b.dc) : "com";
    const clientId = str(b.client_id); const clientSecret = str(b.client_secret); const code = str(b.code);
    if (!clientId || !clientSecret || !code) throw new HttpError(400, "Paste the client ID, client secret and the generated code.");
    const accounts = DATA_CENTRES[dc].accounts;
    const j = await exchange(accounts, { code, client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code" });
    await setSecret(who.tenantId, "migrate_client_id", clientId);
    await setSecret(who.tenantId, "migrate_client_secret", clientSecret);
    return afterConnect(who.tenantId, j, accounts);
  },
  "/api/erp/migrate/select-org": async (who, b) => {
    admin(who);
    const { m } = await settings(who.tenantId);
    const o = (m.orgs || []).find((x) => x.id === str(b.org_id));
    if (!o) throw new HttpError(404, "Organisation not found");
    await saveSettings(who.tenantId, { org_id: o.id, org_name: o.name });
    return { ok: true };
  },
  "/api/erp/migrate/disconnect": async (who) => {
    admin(who);
    for (const n of ["migrate_refresh_token", "migrate_client_id", "migrate_client_secret"]) await setSecret(who.tenantId, n, "");
    access.delete(who.tenantId);
    await saveSettings(who.tenantId, { org_id: null, org_name: null, orgs: [], connected_at: null });
    await db(`migration_jobs?tenant_id=eq.${who.tenantId}&status=in.(fetching,paused)`, { method: "PATCH", prefer: "return=minimal", body: { status: "cancelled" } });
    return { ok: true };
  },
  "/api/erp/migrate/start": async (who, b) => {
    admin(who);
    const { m } = await settings(who.tenantId);
    const source = ["odoo", "quickbooks", "sage", "xero", "erpnext", "loyverse"].includes(str(b.source)) ? str(b.source) : "books_api";
    const org = source === "odoo" ? { id: m.odoo?.db, name: m.odoo?.name } : source === "quickbooks" ? { id: m.qbo?.realm, name: m.qbo?.name } : FETCHERS[source] ? await sourceOrg(who.tenantId, source) : { id: m.org_id, name: m.org_name };
    if (!org.id) throw new HttpError(400, "Connect and choose the organisation first.");
    const busy = await one(`migration_jobs?tenant_id=eq.${who.tenantId}&status=in.(fetching,paused)&select=id`);
    if (busy) throw new HttpError(409, "A fetch is already running for this company.");
    const allowed = source === "books_api" ? API_KINDS : SOURCE_KINDS[source];
    const kinds = (Array.isArray(b.kinds) ? b.kinds : allowed).map(str).filter((k) => allowed.includes(k));
    if (!kinds.length) throw new HttpError(400, "Choose what to bring over.");
    // Fails early if the connection is broken.
    if (source === "books_api") await conn(who.tenantId); else if (source === "odoo") await odooConn(who.tenantId); else if (source === "quickbooks") await qboConn(who.tenantId); else await FETCHERS[source].conn({ tenant_id: who.tenantId });
    const [job] = await db("migration_jobs", { method: "POST", prefer: "return=representation", body: { tenant_id: who.tenantId, source, org_id: org.id, org_name: org.name, kinds, with_lines: b.with_lines !== false, created_by: who.user.id } });
    void runJob(job.id);
    return { job: jobView(job) };
  },
  "/api/erp/migrate/cancel": async (who, b) => {
    admin(who);
    await db(`migration_jobs?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&status=in.(fetching,paused)`, { method: "PATCH", prefer: "return=minimal", body: { status: "cancelled" } });
    return { ok: true };
  },
  "/api/erp/migrate/resume": async (who, b) => {
    admin(who);
    const j = await one(`migration_jobs?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=id,status`);
    if (!j || !["paused", "failed"].includes(j.status)) throw new HttpError(400, "This fetch cannot be resumed.");
    await patchJob(j.id, { status: "fetching", error: null, resume_after: null });
    void runJob(j.id);
    return { ok: true };
  },
  "/api/erp/migrate/imported": async (who, b) => {
    admin(who);
    await db(`migration_jobs?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "imported", imported_at: new Date().toISOString(), import_log: Array.isArray(b.log) ? b.log.slice(0, 40) : null } });
    const job = await one(`migration_jobs?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=source,org_id`).catch(() => null);
    const numbering = job && (!job.source || job.source === "books_api") ? await zohoNumbering(who.tenantId, job.org_id).catch((e) => ({ error: str(e.message) })) : null;
    return { ok: true, numbering };
  },
};

// =============================================================================
// More previous systems: Odoo (any edition, JSON-RPC with an API key) and
// QuickBooks Online (Intuit OAuth 2, env QBO_CLIENT_ID / QBO_CLIENT_SECRET,
// redirect https://app.<root>/api/migrate/qbo/callback). Both stage rows with
// the same column names as above, so the same importer brings them in.
// =============================================================================
const QBO_ID = process.env.QBO_CLIENT_ID || "";
const QBO_SECRET = process.env.QBO_CLIENT_SECRET || "";
const QBO_REDIRECT = process.env.QBO_REDIRECT_URI || `https://app.${ROOT_HOST}/api/migrate/qbo/callback`;
const QBO_API = process.env.QBO_SANDBOX === "1" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
const SOURCE_KINDS = {
  odoo: ["accounts", "customers", "vendors", "items", "quotes", "sales_orders", "invoices", "credit_notes", "payments", "bills", "vendor_payments", "expenses", "journals", "leads", "employees"],
  quickbooks: ["accounts", "customers", "vendors", "items", "quotes", "invoices", "credit_notes", "payments", "bills", "vendor_payments", "expenses", "journals", "employees"],
};
const m2o = (v) => (Array.isArray(v) ? v[1] : v || undefined);
const today = () => new Date().toISOString().slice(0, 10);
const docStatus = ({ draft, cancelled, total, balance, due }) =>
  draft ? "Draft" : cancelled ? "Void" : Number(balance) <= 0.004 ? "Paid" : Number(balance) < Number(total) ? "PartiallyPaid" : due && due < today() ? "Overdue" : "Sent";

/** Only public https addresses: never this server's own network. */
function safeUrl(raw, label = "Odoo") {
  let u;
  try { u = new URL(/^https?:\/\//i.test(str(raw)) ? str(raw) : `https://${str(raw)}`); } catch { throw new HttpError(400, `Enter the ${label} address, e.g. https://mycompany.${label === "Odoo" ? "odoo.com" : "erpnext.com"}`); }
  if (u.protocol !== "https:") throw new HttpError(400, `The ${label} address must start with https://`);
  if (/^(localhost|\[)/i.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || /\.(local|internal|lan)$/i.test(u.hostname)) throw new HttpError(400, "That address is not reachable from the internet");
  return u.origin;
}

// ---- Odoo ---------------------------------------------------------------------
async function odooRpc(url, service, method, args) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
  }).catch(() => null);
  if (!res) throw new HttpError(502, "Could not reach the Odoo address");
  const j = await res.json().catch(() => ({}));
  if (j.error) {
    const msg = str(j.error.data?.message || j.error.message);
    const e = new HttpError(400, /access denied|wrong login|invalid/i.test(msg) ? "Odoo did not accept the login or API key" : msg.slice(0, 300));
    e.odoo = msg; throw e;
  }
  return j.result;
}
async function odooConn(tenantId) {
  const sec = await secrets(tenantId);
  const { m } = await settings(tenantId);
  const o = m.odoo || {};
  if (!sec.migrate_odoo_key || !o.url || !o.uid) throw new HttpError(400, "Connect Odoo first.");
  const exec = (model, method, args, kw = {}) => odooRpc(o.url, "object", "execute_kw", [o.db, o.uid, sec.migrate_odoo_key, model, method, args, kw]);
  return { ...o, exec };
}
/** search_read that drops fields this Odoo version does not have. */
async function odooRead(c, model, domain, fields, extra = {}) {
  let f = [...fields];
  for (let i = 0; i < 6; i++) {
    try { return await c.exec(model, "search_read", [domain], { fields: f, ...extra }); }
    catch (e) {
      const bad = /Invalid field '?([a-z0-9_]+)'?|field[s]? \W?([a-z0-9_]+)\W? (does not exist|on model)/i.exec(str(e.odoo || e.message));
      const name = bad?.[1] || bad?.[2];
      if (name && f.includes(name)) { f = f.filter((x) => x !== name); continue; }
      throw e;
    }
  }
  return [];
}
const ODOO = {
  accounts: { model: "account.account", domain: [], fields: ["code", "name", "account_type", "user_type_id", "deprecated"],
    rows: (a) => [{ ext: "0", row: R({ "Account Name": a.name, "Account Code": a.code, "Account Type": a.account_type || m2o(a.user_type_id), "Account Status": a.deprecated ? "Inactive" : "Active" }) }] },
  customers: { model: "res.partner", domain: [["customer_rank", ">", 0]], fields: ["name", "commercial_company_name", "is_company", "email", "mobile", "phone", "website", "street", "city", "country_id", "vat", "property_payment_term_id", "active"],
    rows: (p) => [{ ext: "0", row: R({ "Display Name": p.name, "Company Name": p.is_company ? p.name : p.commercial_company_name, "Contact Type": "customer", EmailID: p.email, "Mobile Phone": p.mobile, Phone: p.phone, Website: p.website, "Billing Address": p.street, "Billing City": p.city, "Billing Country": m2o(p.country_id), "Tax Registration Number": p.vat, "Payment Terms Label": m2o(p.property_payment_term_id), Status: p.active === false ? "Inactive" : "Active" }) }] },
  vendors: { model: "res.partner", domain: [["supplier_rank", ">", 0]], fields: ["name", "commercial_company_name", "is_company", "email", "mobile", "phone", "website", "street", "city", "country_id", "vat", "active"],
    rows: (p) => [{ ext: "0", row: R({ "Display Name": p.name, "Company Name": p.is_company ? p.name : p.commercial_company_name, "Contact Type": "vendor", EmailID: p.email, "Mobile Phone": p.mobile, Phone: p.phone, Website: p.website, "Billing Address": p.street, "Billing City": p.city, "Billing Country": m2o(p.country_id), "Tax Registration Number": p.vat, Status: p.active === false ? "Inactive" : "Active" }) }] },
  items: { model: "product.product", domain: [], fields: ["name", "default_code", "list_price", "standard_price", "uom_id", "detailed_type", "type", "qty_available", "categ_id", "barcode", "description_sale", "active", "taxes_id"],
    rows: (p, _l, x) => [{ ext: "0", row: R({ "Item Name": p.name, SKU: p.default_code, Rate: p.list_price, "Purchase Rate": p.standard_price, "Usage unit": m2o(p.uom_id), "Product Type": (p.detailed_type || p.type) === "service" ? "service" : "goods", "Stock On Hand": p.qty_available, "Category Name": m2o(p.categ_id), UPC: p.barcode, Description: p.description_sale, Status: p.active === false ? "Inactive" : "Active", "Tax Percentage": x.taxPct(p.taxes_id) }) }] },
  quotes: { model: "sale.order", domain: [["state", "in", ["draft", "sent", "cancel"]]], fields: ["name", "partner_id", "date_order", "validity_date", "state", "amount_total", "amount_untaxed", "amount_tax", "note", "client_order_ref", "user_id"],
    lines: { model: "sale.order.line", key: "order_id", fields: ["order_id", "product_id", "name", "product_uom_qty", "price_unit", "price_subtotal", "discount", "tax_id", "display_type"] },
    rows: (o, lines, x) => x.doc({ "Estimate Number": o.name, "Customer Name": m2o(o.partner_id), "Estimate Date": str(o.date_order).slice(0, 10), "Expiry Date": o.validity_date, "Estimate Status": o.state === "cancel" ? "Declined" : o.state === "sent" ? "Sent" : "Draft", Total: o.amount_total, SubTotal: o.amount_untaxed, "Tax Total": o.amount_tax, Notes: o.note, "Reference#": o.client_order_ref, "Sales person": m2o(o.user_id) }, lines, o.amount_total) },
  sales_orders: { model: "sale.order", domain: [["state", "in", ["sale", "done"]]], fields: ["name", "partner_id", "date_order", "commitment_date", "state", "amount_total", "amount_untaxed", "amount_tax", "note", "client_order_ref"],
    lines: { model: "sale.order.line", key: "order_id", fields: ["order_id", "product_id", "name", "product_uom_qty", "price_unit", "price_subtotal", "discount", "tax_id", "display_type"] },
    rows: (o, lines, x) => x.doc({ "SalesOrder Number": o.name, "Customer Name": m2o(o.partner_id), "Order Date": str(o.date_order).slice(0, 10), "Expected Shipment Date": str(o.commitment_date || "").slice(0, 10), Status: o.state === "done" ? "Closed" : "Confirmed", Total: o.amount_total, SubTotal: o.amount_untaxed, "Tax Total": o.amount_tax, Notes: o.note, "Reference#": o.client_order_ref }, lines, o.amount_total) },
  invoices: { model: "account.move", domain: [["move_type", "=", "out_invoice"]], fields: ["name", "partner_id", "invoice_date", "invoice_date_due", "state", "payment_state", "amount_total", "amount_residual", "amount_untaxed", "amount_tax", "ref", "invoice_user_id", "narration"], lines: "move",
    rows: (v, lines, x) => x.doc({ "Invoice Number": v.name, "Customer Name": m2o(v.partner_id), "Invoice Date": v.invoice_date, "Due Date": v.invoice_date_due, "Invoice Status": docStatus({ draft: v.state === "draft", cancelled: v.state === "cancel", total: v.amount_total, balance: v.amount_residual, due: v.invoice_date_due }), Total: v.amount_total, Balance: v.amount_residual, SubTotal: v.amount_untaxed, "Tax Total": v.amount_tax, Notes: typeof v.narration === "string" ? v.narration.replace(/<[^>]+>/g, " ").trim() : undefined, "Reference#": v.ref, "Sales person": m2o(v.invoice_user_id) }, lines, v.amount_total) },
  credit_notes: { model: "account.move", domain: [["move_type", "=", "out_refund"]], fields: ["name", "partner_id", "invoice_date", "state", "amount_total", "amount_untaxed", "amount_tax", "ref"], lines: "move",
    rows: (v, lines, x) => x.doc({ "Credit Note Number": v.name, "Customer Name": m2o(v.partner_id), "Credit Note Date": v.invoice_date, "Credit Note Status": v.state === "draft" ? "Draft" : v.state === "cancel" ? "Void" : "Open", Total: v.amount_total, SubTotal: v.amount_untaxed, "Tax Total": v.amount_tax, "Reference#": v.ref }, lines, v.amount_total) },
  bills: { model: "account.move", domain: [["move_type", "=", "in_invoice"]], fields: ["name", "ref", "partner_id", "invoice_date", "invoice_date_due", "state", "payment_state", "amount_total", "amount_residual", "amount_tax", "narration"], lines: "move",
    rows: (b, lines, x) => x.lineRows(lines, b.amount_total).map((li, i) => ({ ext: `${i}`, row: R({ "Bill Number": b.ref || b.name, "Vendor Name": m2o(b.partner_id), "Bill Date": b.invoice_date, "Due Date": b.invoice_date_due, "Bill Status": docStatus({ draft: b.state === "draft", cancelled: b.state === "cancel", total: b.amount_total, balance: b.amount_residual, due: b.invoice_date_due }).replace("Sent", "Open"), Total: b.amount_total, Balance: b.amount_residual, "Reference Number": b.name, "Tax Amount": i === 0 ? b.amount_tax : 0, ...li }) })) },
  payments: { model: "account.payment", domain: [["payment_type", "=", "inbound"], ["partner_type", "=", "customer"], ["state", "not in", ["draft", "cancel", "canceled"]]], fields: ["name", "partner_id", "date", "amount", "journal_id", "ref", "memo", "reconciled_invoice_ids"],
    rows: async (p, _l, x) => {
      const head = { "Payment Number": p.name, "Customer Name": m2o(p.partner_id), Date: p.date, Amount: p.amount, Mode: m2o(p.journal_id), "Reference Number": p.ref || p.memo };
      const applied = await x.applied(p.reconciled_invoice_ids, p.amount);
      return applied.length ? applied.map((a, i) => ({ ext: `${i}`, row: R({ ...head, "Invoice Number": a.name, "Amount Applied to Invoice": a.amount }) })) : [{ ext: "0", row: R(head) }];
    } },
  vendor_payments: { model: "account.payment", domain: [["payment_type", "=", "outbound"], ["partner_type", "=", "supplier"], ["state", "not in", ["draft", "cancel", "canceled"]]], fields: ["name", "partner_id", "date", "amount", "journal_id", "ref", "memo", "reconciled_bill_ids"],
    rows: async (p, _l, x) => {
      const head = { "Payment Number": p.name, "Vendor Name": m2o(p.partner_id), Date: p.date, Amount: p.amount, Mode: m2o(p.journal_id), Description: p.ref || p.memo };
      const applied = await x.applied(p.reconciled_bill_ids, p.amount, true);
      return applied.length ? applied.map((a, i) => ({ ext: `${i}`, row: R({ ...head, "Bill Number": a.name, "Amount Applied to Bill": a.amount }) })) : [{ ext: "0", row: R(head) }];
    } },
  expenses: { model: "hr.expense", domain: [], fields: ["date", "name", "total_amount", "total_amount_currency", "product_id", "employee_id", "reference", "description", "account_id"], optional: "No expenses app (or no access).",
    rows: (e) => [{ ext: "0", row: R({ "Expense Date": e.date, "Expense Account": m2o(e.account_id) || m2o(e.product_id), Total: e.total_amount ?? e.total_amount_currency, "Reference#": e.reference, Description: [e.name, m2o(e.employee_id), e.description].filter(Boolean).join(" · ") }) }] },
  journals: { model: "account.move", domain: [["move_type", "=", "entry"], ["state", "=", "posted"]], fields: ["name", "date", "ref", "narration"], lines: "journal",
    rows: (j, lines) => lines.map((li, i) => ({ ext: `${i}`, row: R({ "Journal Number": j.name, "Journal Date": j.date, Notes: j.ref, "Reference Number": j.ref, Account: m2o(li.account_id), Description: li.name, Debit: li.debit, Credit: li.credit }) })) },
  leads: { model: "crm.lead", domain: [], fields: ["name", "partner_name", "contact_name", "email_from", "phone", "mobile", "website", "city", "country_id", "source_id", "stage_id", "description", "expected_revenue", "type"], optional: "No CRM app (or no access).",
    rows: (l) => { const [first, ...rest] = str(l.contact_name || l.name).split(" "); return [{ ext: "0", row: R({ "First Name": first, "Last Name": rest.join(" ") || first, Company: l.partner_name || l.name, Email: l.email_from, Phone: l.phone, Mobile: l.mobile, Website: l.website, City: l.city, Country: m2o(l.country_id), "Lead Source": m2o(l.source_id), "Lead Status": m2o(l.stage_id), Description: typeof l.description === "string" ? l.description.replace(/<[^>]+>/g, " ").trim() : undefined, "Annual Revenue": l.expected_revenue }) }]; } },
  employees: { model: "hr.employee", domain: [], fields: ["name", "work_email", "mobile_phone", "work_phone", "job_title", "department_id", "gender", "birthday", "identification_id", "barcode", "active"], optional: "No Employees app (or no access).",
    rows: (e) => { const [first, ...rest] = str(e.name).split(" "); return [{ ext: "0", row: R({ "Employee ID": e.barcode || e.identification_id, "First Name": first, "Last Name": rest.join(" "), "Email ID": e.work_email, "Mobile Phone": e.mobile_phone || e.work_phone, Gender: e.gender, "Date of Birth": e.birthday, Designation: e.job_title, Department: m2o(e.department_id), "Employee Status": e.active === false ? "Inactive" : "Active" }) }]; } },
};

async function runOdoo(job, cur, progress, alive) {
  const c = await odooConn(job.tenant_id);
  // Tax rates once, for "Tax %" on lines and items.
  const taxes = new Map((await odooRead(c, "account.tax", [], ["amount", "amount_type"]).catch(() => [])).map((t) => [t.id, t.amount_type === "percent" ? t.amount : 0]));
  const x = {
    taxPct: (ids) => (Array.isArray(ids) && ids.length ? taxes.get(ids[0]) : undefined),
    lineRows: (lines, total) => (lines.length ? lines : [{ name: "Imported total", quantity: 1, price_unit: total, price_subtotal: total }]).map((li) => ({
      "Item Name": m2o(li.product_id) || li.name, "Item Desc": li.name, Quantity: li.quantity ?? li.product_uom_qty, "Item Price": li.price_unit, "Item Total": li.price_subtotal,
      "Item Tax %": x.taxPct(li.tax_ids || li.tax_id), Discount: li.discount ? `${li.discount}%` : undefined, Account: m2o(li.account_id),
    })),
    doc: (head, lines, total) => x.lineRows(lines, total).map((li, i) => ({ ext: `${i}`, row: R({ ...head, ...li }) })),
    applied: async (ids, amount, bills) => {
      if (!Array.isArray(ids) || !ids.length) return [];
      const docs = await odooRead(c, "account.move", [["id", "in", ids]], ["name", "ref", "amount_total"]);
      let left = Number(amount || 0);
      return docs.map((d) => { const a = Math.min(left, Number(d.amount_total || 0)); left -= a; return { name: bills ? d.ref || d.name : d.name, amount: a }; }).filter((a) => a.amount > 0);
    },
  };
  const kinds = SOURCE_KINDS.odoo.filter((k) => job.kinds.includes(k));
  for (; cur.src < kinds.length; cur.src++, cur.page = 1) {
    const kind = kinds[cur.src]; const def = ODOO[kind];
    for (;;) {
      if (!(await alive())) return false;
      let items = [];
      try { items = await odooRead(c, def.model, def.domain, def.fields, { offset: (cur.page - 1) * 200, limit: 200, order: "id" }); }
      catch (e) { if (def.optional || /does not exist|object .* doesn't exist|unknown model/i.test(str(e.odoo || e.message))) { progress[kind] = { ...(progress[kind] || {}), note: def.optional || "Not available in this Odoo." }; break; } throw e; }
      let byDoc = new Map();
      if (def.lines && items.length && (job.with_lines || def.lines === "journal")) {
        const ids = items.map((i) => i.id);
        let lines = [];
        if (def.lines === "move" || def.lines === "journal") {
          lines = await odooRead(c, "account.move.line", [["move_id", "in", ids]], ["move_id", "product_id", "name", "quantity", "price_unit", "price_subtotal", "discount", "tax_ids", "tax_line_id", "display_type", "exclude_from_invoice_tab", "account_id", "debit", "credit"]);
          if (def.lines === "move") lines = lines.filter((l) => l.display_type === "product" || (!l.display_type && !l.tax_line_id && l.exclude_from_invoice_tab !== true && (l.exclude_from_invoice_tab === false || l.product_id || Number(l.price_unit))));
        } else {
          lines = (await odooRead(c, def.lines.model, [[def.lines.key, "in", ids]], def.lines.fields)).filter((l) => !l.display_type);
        }
        const key = def.lines.key || "move_id";
        for (const l of lines) { const id = Array.isArray(l[key]) ? l[key][0] : l[key]; if (!byDoc.has(id)) byDoc.set(id, []); byDoc.get(id).push(l); }
      }
      for (const it of items) {
        await stage(job, kind, it.id, await def.rows(it, byDoc.get(it.id) || [], x));
        progress[kind] = { ...(progress[kind] || {}), fetched: Number(progress[kind]?.fetched || 0) + 1 };
      }
      cur.page++;
      await patchJob(job.id, { cursor: cur, progress });
      if (items.length < 200) break;
    }
  }
  return true;
}

// ---- QuickBooks Online ------------------------------------------------------------
const qboAccess = new Map();
async function qboToken(params) {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${Buffer.from(`${QBO_ID}:${QBO_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new HttpError(400, j.error === "invalid_grant" ? "QuickBooks access has expired. Connect again." : `QuickBooks refused the connection (${str(j.error) || res.status}).`);
  return j;
}
async function qboConn(tenantId) {
  const { m } = await settings(tenantId);
  const sec = await secrets(tenantId);
  if (!m.qbo?.realm || !sec.migrate_qbo_refresh) throw new HttpError(400, "Connect QuickBooks first.");
  const hit = qboAccess.get(tenantId);
  if (hit && hit.until > Date.now()) return { realm: m.qbo.realm, token: hit.token };
  const j = await qboToken({ grant_type: "refresh_token", refresh_token: sec.migrate_qbo_refresh });
  if (j.refresh_token && j.refresh_token !== sec.migrate_qbo_refresh) await setSecret(tenantId, "migrate_qbo_refresh", j.refresh_token);
  qboAccess.set(tenantId, { token: j.access_token, until: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 });
  return { realm: m.qbo.realm, token: j.access_token };
}
async function qboGet(c, path) {
  await pace();
  const res = await fetch(`${QBO_API}/v3/company/${c.realm}/${path}${path.includes("?") ? "&" : "?"}minorversion=70`, { headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  if (res.status === 429) throw new QuotaError(false);
  if (res.status === 401) { qboAccess.clear(); throw new HttpError(401, "The QuickBooks connection expired. Connect again."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, str(j?.Fault?.Error?.[0]?.Detail || j?.Fault?.Error?.[0]?.Message) || `QuickBooks replied ${res.status}`);
  return j;
}
const qLines = (lines, total) => {
  const out = (lines || []).filter((l) => /ItemLineDetail|ItemBasedExpense|AccountBasedExpense/.test(str(l.DetailType))).map((l) => {
    const d = l.SalesItemLineDetail || l.ItemBasedExpenseLineDetail || l.AccountBasedExpenseLineDetail || {};
    return { "Item Name": d.ItemRef?.name || d.AccountRef?.name || l.Description, "Item Desc": l.Description, Quantity: d.Qty ?? 1, "Item Price": d.UnitPrice ?? l.Amount, "Item Total": l.Amount, Account: d.AccountRef?.name };
  });
  return out.length ? out : [{ "Item Name": "Imported total", Quantity: 1, "Item Price": total, "Item Total": total }];
};
const qDoc = (head, lines, total) => qLines(lines, total).map((li, i) => ({ ext: `${i}`, row: R({ ...head, ...li }) }));
const qName = (o) => o?.name || o?.value;
async function qLinked(job, line, txnType, kind, col) {
  const out = [];
  for (const l of line || []) for (const t of l.LinkedTxn || []) if (t.TxnType === txnType) {
    const r = await one(`migration_rows?job_id=eq.${job.id}&kind=eq.${kind}&doc_id=eq.${enc(String(t.TxnId))}&select=row`);
    out.push({ name: r?.row?.[col] || `${txnType} ${t.TxnId}`, amount: l.Amount });
  }
  return out;
}
const QBO = {
  accounts: { entity: "Account", rows: (a) => [{ ext: "0", row: R({ "Account Name": a.Name, "Account Code": a.AcctNum, "Account Type": a.AccountType, Description: a.Description, "Account Status": a.Active === false ? "Inactive" : "Active" }) }] },
  customers: { entity: "Customer", rows: (c) => [{ ext: "0", row: R({ "Display Name": c.DisplayName, "Company Name": c.CompanyName, "Contact Type": "customer", EmailID: c.PrimaryEmailAddr?.Address, "Mobile Phone": c.Mobile?.FreeFormNumber, Phone: c.PrimaryPhone?.FreeFormNumber, "First Name": c.GivenName, "Last Name": c.FamilyName, Website: c.WebAddr?.URI, "Payment Terms Label": qName(c.SalesTermRef), "Billing Address": c.BillAddr?.Line1, "Billing City": c.BillAddr?.City, Status: c.Active === false ? "Inactive" : "Active" }) }] },
  vendors: { entity: "Vendor", rows: (c) => [{ ext: "0", row: R({ "Display Name": c.DisplayName, "Company Name": c.CompanyName, "Contact Type": "vendor", EmailID: c.PrimaryEmailAddr?.Address, "Mobile Phone": c.Mobile?.FreeFormNumber, Phone: c.PrimaryPhone?.FreeFormNumber, "First Name": c.GivenName, "Last Name": c.FamilyName, Website: c.WebAddr?.URI, Status: c.Active === false ? "Inactive" : "Active" }) }] },
  items: { entity: "Item", rows: (it) => [{ ext: "0", row: R({ "Item Name": it.Name, SKU: it.Sku, Rate: it.UnitPrice, "Purchase Rate": it.PurchaseCost, "Product Type": it.Type === "Service" ? "service" : "goods", "Stock On Hand": it.QtyOnHand, Description: it.Description, Status: it.Active === false ? "Inactive" : "Active" }) }] },
  quotes: { entity: "Estimate", rows: (q) => qDoc({ "Estimate Number": q.DocNumber || q.Id, "Customer Name": qName(q.CustomerRef), "Estimate Date": q.TxnDate, "Expiry Date": q.ExpirationDate, "Estimate Status": q.TxnStatus === "Accepted" ? "Accepted" : q.TxnStatus === "Rejected" ? "Declined" : q.TxnStatus === "Closed" ? "Invoiced" : "Sent", Total: q.TotalAmt, "Tax Total": q.TxnTaxDetail?.TotalTax, Notes: q.CustomerMemo?.value, Terms: q.PrivateNote }, q.Line, q.TotalAmt) },
  invoices: { entity: "Invoice", rows: (v) => qDoc({ "Invoice Number": v.DocNumber || v.Id, "Customer Name": qName(v.CustomerRef), "Invoice Date": v.TxnDate, "Due Date": v.DueDate, "Invoice Status": docStatus({ total: v.TotalAmt, balance: v.Balance, due: v.DueDate }), Total: v.TotalAmt, Balance: v.Balance, "Tax Total": v.TxnTaxDetail?.TotalTax, Notes: v.CustomerMemo?.value }, v.Line, v.TotalAmt) },
  credit_notes: { entity: "CreditMemo", rows: (v) => qDoc({ "Credit Note Number": v.DocNumber || v.Id, "Customer Name": qName(v.CustomerRef), "Credit Note Date": v.TxnDate, "Credit Note Status": Number(v.RemainingCredit) > 0 ? "Open" : "Closed", Total: v.TotalAmt, "Tax Total": v.TxnTaxDetail?.TotalTax }, v.Line, v.TotalAmt) },
  payments: { entity: "Payment", rows: async (p, job) => {
    const head = { "Payment Number": p.PaymentRefNum || p.Id, "Customer Name": qName(p.CustomerRef), Date: p.TxnDate, Amount: p.TotalAmt, Mode: qName(p.PaymentMethodRef), "Reference Number": p.PaymentRefNum };
    const inv = await qLinked(job, p.Line, "Invoice", "invoices", "invoicenumber");
    return inv.length ? inv.map((a, i) => ({ ext: `${i}`, row: R({ ...head, "Invoice Number": a.name, "Amount Applied to Invoice": a.amount }) })) : [{ ext: "0", row: R(head) }];
  } },
  bills: { entity: "Bill", rows: (b) => qLines(b.Line, b.TotalAmt).map((li, i) => ({ ext: `${i}`, row: R({ "Bill Number": b.DocNumber || b.Id, "Vendor Name": qName(b.VendorRef), "Bill Date": b.TxnDate, "Due Date": b.DueDate, "Bill Status": docStatus({ total: b.TotalAmt, balance: b.Balance, due: b.DueDate }).replace("Sent", "Open"), Total: b.TotalAmt, Balance: b.Balance, Notes: b.PrivateNote, "Tax Amount": i === 0 ? b.TxnTaxDetail?.TotalTax : 0, ...li }) })) },
  vendor_payments: { entity: "BillPayment", rows: async (p, job) => {
    const head = { "Payment Number": p.DocNumber || p.Id, "Vendor Name": qName(p.VendorRef), Date: p.TxnDate, Amount: p.TotalAmt, Mode: p.PayType, Description: p.PrivateNote };
    const bl = await qLinked(job, p.Line, "Bill", "bills", "billnumber");
    return bl.length ? bl.map((a, i) => ({ ext: `${i}`, row: R({ ...head, "Bill Number": a.name, "Amount Applied to Bill": a.amount }) })) : [{ ext: "0", row: R(head) }];
  } },
  expenses: { entity: "Purchase", rows: (e) => [{ ext: "0", row: R({ "Expense Date": e.TxnDate, "Expense Account": e.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name || e.Line?.[0]?.ItemBasedExpenseLineDetail?.ItemRef?.name, Total: e.TotalAmt, "Tax Amount": e.TxnTaxDetail?.TotalTax, Vendor: qName(e.EntityRef), "Paid Through": qName(e.AccountRef), "Reference#": e.DocNumber, Description: e.PrivateNote || e.Line?.[0]?.Description }) }] },
  journals: { entity: "JournalEntry", rows: (j) => (j.Line || []).filter((l) => l.JournalEntryLineDetail).map((l, i) => ({ ext: `${i}`, row: R({ "Journal Number": j.DocNumber || j.Id, "Journal Date": j.TxnDate, Notes: j.PrivateNote, Account: l.JournalEntryLineDetail.AccountRef?.name, Description: l.Description, Debit: l.JournalEntryLineDetail.PostingType === "Debit" ? l.Amount : 0, Credit: l.JournalEntryLineDetail.PostingType === "Credit" ? l.Amount : 0 }) })) },
  employees: { entity: "Employee", rows: (e) => [{ ext: "0", row: R({ "Employee ID": e.EmployeeNumber || e.Id, "First Name": e.GivenName, "Last Name": e.FamilyName, "Email ID": e.PrimaryEmailAddr?.Address, "Mobile Phone": e.Mobile?.FreeFormNumber || e.PrimaryPhone?.FreeFormNumber, "Date of Joining": e.HiredDate, Gender: e.Gender, "Date of Birth": e.BirthDate, "Employee Status": e.Active === false ? "Inactive" : "Active" }) }] },
};

async function runQbo(job, cur, progress, alive) {
  const kinds = SOURCE_KINDS.quickbooks.filter((k) => job.kinds.includes(k));
  for (; cur.src < kinds.length; cur.src++, cur.page = 1) {
    const kind = kinds[cur.src]; const def = QBO[kind];
    for (;;) {
      if (!(await alive())) return false;
      const c = await qboConn(job.tenant_id);
      const start = (cur.page - 1) * 500 + 1;
      const j = await qboGet(c, `query?query=${enc(`select * from ${def.entity} STARTPOSITION ${start} MAXRESULTS 500`)}`);
      const items = j.QueryResponse?.[def.entity] || [];
      for (const it of items) {
        await stage(job, kind, it.Id, await def.rows(it, job));
        progress[kind] = { ...(progress[kind] || {}), fetched: Number(progress[kind]?.fetched || 0) + 1 };
      }
      cur.page++;
      await patchJob(job.id, { cursor: cur, progress });
      if (items.length < 500) break;
    }
  }
  return true;
}

/** Fetches a job from Odoo, QuickBooks, Sage, Xero, ERPNext or Loyverse (Zoho is runJob above). */
async function runSourceJob(job) {
  const cur = { src: 0, page: 1, ...job.cursor };
  const progress = { ...job.progress };
  const alive = async () => (await one(`migration_jobs?id=eq.${job.id}&select=status`))?.status === "fetching";
  const done = job.source === "odoo" ? await runOdoo(job, cur, progress, alive) : job.source === "quickbooks" ? await runQbo(job, cur, progress, alive) : await runPaged(job, cur, progress, alive);
  if (done) await patchJob(job.id, { status: "fetched", cursor: cur, progress });
}

/** GET /api/migrate/qbo/callback (the signed state carries the company). */
export async function handleQboCallback(req, res, search) {
  const q = new URLSearchParams(search || "");
  const st = verify(q.get("state"));
  const redirect = (url) => { res.writeHead(302, { Location: url, "Cache-Control": "no-store" }); res.end(); };
  if (!st || st.src !== "qbo") return redirect(`https://app.${ROOT_HOST}/`);
  const back = `${await companyOrigin(st.t)}/migrate?from=quickbooks`;
  try {
    if (q.get("error")) throw new HttpError(400, "access was not granted");
    const realm = str(q.get("realmId"));
    if (!/^\d+$/.test(realm)) throw new HttpError(400, "QuickBooks did not say which company");
    const j = await qboToken({ grant_type: "authorization_code", code: str(q.get("code")), redirect_uri: QBO_REDIRECT });
    await setSecret(st.t, "migrate_qbo_refresh", j.refresh_token);
    qboAccess.set(st.t, { token: j.access_token, until: Date.now() + 3000_000 });
    const info = await qboGet({ realm, token: j.access_token }, `companyinfo/${realm}`).catch(() => ({}));
    await saveSettings(st.t, { qbo: { realm, name: str(info?.CompanyInfo?.CompanyName) || `QuickBooks company ${realm}`, connected_at: new Date().toISOString() } });
    return redirect(`${back}&connected=1`);
  } catch (e) {
    return redirect(`${back}&error=${enc(str(e.message).slice(0, 160))}`);
  }
}

Object.assign(migrateRoutes, {
  "/api/erp/migrate/odoo-connect": async (who, b) => {
    admin(who);
    const url = safeUrl(b.url);
    const dbName = str(b.db) || new URL(url).hostname.split(".")[0];
    const username = str(b.username); const key = str(b.api_key);
    if (!username || !key) throw new HttpError(400, "Enter the Odoo login email and an API key.");
    const uid = await odooRpc(url, "common", "authenticate", [dbName, username, key, {}]);
    if (!uid) throw new HttpError(400, "Odoo did not accept the login or API key (check the database name too).");
    await setSecret(who.tenantId, "migrate_odoo_key", key);
    const company = (await odooRpc(url, "object", "execute_kw", [dbName, uid, key, "res.company", "search_read", [[]], { fields: ["name", "currency_id"], limit: 1 }]).catch(() => []))[0];
    await saveSettings(who.tenantId, { odoo: { url, db: dbName, username, uid, name: str(company?.name) || dbName, currency: m2o(company?.currency_id) || null, connected_at: new Date().toISOString() } });
    return { ok: true, name: str(company?.name) || dbName };
  },
  "/api/erp/migrate/qbo-start": async (who) => {
    admin(who);
    if (!QBO_ID || !QBO_SECRET) throw new HttpError(400, "QuickBooks connect is not switched on for this platform yet. Ask JMSURF support, or upload QuickBooks export files instead.");
    const state = sign({ t: who.tenantId, u: who.user.id, src: "qbo", exp: Date.now() + 15 * 60_000 });
    return { url: `https://appcenter.intuit.com/connect/oauth2?${new URLSearchParams({ client_id: QBO_ID, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: QBO_REDIRECT, state })}` };
  },
  "/api/erp/migrate/source-disconnect": async (who, b) => {
    admin(who);
    const src = str(b.source);
    if (src === "odoo") { await setSecret(who.tenantId, "migrate_odoo_key", ""); await saveSettings(who.tenantId, { odoo: null }); }
    if (src === "quickbooks") { await setSecret(who.tenantId, "migrate_qbo_refresh", ""); qboAccess.delete(who.tenantId); await saveSettings(who.tenantId, { qbo: null }); }
    if (src === "sage" || src === "xero") { await setSecret(who.tenantId, `migrate_${src}_refresh`, ""); tokenCache.delete(`${src}:${who.tenantId}`); await saveSettings(who.tenantId, { [src]: null }); }
    if (src === "erpnext") { await setSecret(who.tenantId, "migrate_erpnext_key", ""); await saveSettings(who.tenantId, { erpnext: null }); }
    if (src === "loyverse") { await setSecret(who.tenantId, "migrate_loyverse_token", ""); await saveSettings(who.tenantId, { loyverse: null }); }
    await db(`migration_jobs?tenant_id=eq.${who.tenantId}&source=eq.${enc(src)}&status=in.(fetching,paused)`, { method: "PATCH", prefer: "return=minimal", body: { status: "cancelled" } });
    return { ok: true };
  },
});


// =============================================================================
// More systems used in Kenya: Sage Business Cloud Accounting and Xero (OAuth 2,
// env SAGE_CLIENT_ID / SAGE_CLIENT_SECRET and XERO_CLIENT_ID / XERO_CLIENT_SECRET,
// redirects https://app.<root>/api/migrate/sage|xero/callback), ERPNext / Frappe
// (API key and secret) and Loyverse POS (access token). Rows are staged with the
// same column names as above, so the same importer brings them in.
// =============================================================================
const SAGE_ID = process.env.SAGE_CLIENT_ID || "";
const SAGE_SECRET = process.env.SAGE_CLIENT_SECRET || "";
const SAGE_REDIRECT = process.env.SAGE_REDIRECT_URI || `https://app.${ROOT_HOST}/api/migrate/sage/callback`;
const XERO_ID = process.env.XERO_CLIENT_ID || "";
const XERO_SECRET = process.env.XERO_CLIENT_SECRET || "";
const XERO_REDIRECT = process.env.XERO_REDIRECT_URI || `https://app.${ROOT_HOST}/api/migrate/xero/callback`;
const XERO_SCOPES = process.env.XERO_SCOPES || "offline_access accounting.transactions.read accounting.contacts.read accounting.settings.read";
const SAGE_API = "https://api.accounting.sage.com/v3.1";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const LOYVERSE_API = "https://api.loyverse.com/v1.0";

Object.assign(SOURCE_KINDS, {
  sage: ["accounts", "customers", "vendors", "items", "quotes", "invoices", "credit_notes", "payments", "bills", "vendor_payments", "journals"],
  xero: ["accounts", "customers", "vendors", "items", "quotes", "invoices", "credit_notes", "payments", "bills", "vendor_payments", "expenses", "journals"],
  erpnext: ["accounts", "customers", "vendors", "items", "quotes", "sales_orders", "invoices", "credit_notes", "payments", "bills", "vendor_payments", "journals", "leads", "employees"],
  loyverse: ["customers", "vendors", "items", "invoices"],
});
const SOURCE_NAMES = { sage: "Sage", xero: "Xero", erpnext: "ERPNext", loyverse: "Loyverse" };

/** GET returning JSON; 429 pauses the job, 401/403 asks to connect again. */
async function getJson(url, headers, who) {
  await pace();
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(60000) }).catch(() => null);
  if (!res) throw new HttpError(502, `Could not reach ${who}`);
  if (res.status === 429) throw new QuotaError(false);
  if (res.status === 401 || res.status === 403) throw new HttpError(401, `${who} refused access. Connect again.`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.message || j?.Message || j?.Detail || j?.[0]?.$message || j?.errors?.[0]?.message || j?.exception || j?.exc_type;
    throw new HttpError(502, str(msg).slice(0, 300) || `${who} replied ${res.status}`);
  }
  return j;
}

// ---- OAuth sources (Sage, Xero) ----------------------------------------------------
const OAUTH = {
  sage: {
    name: "Sage", id: SAGE_ID, secret: SAGE_SECRET, redirect: SAGE_REDIRECT, token: "https://oauth.accounting.sage.com/token", basic: false,
    authorize: (state) => `https://www.sageone.com/oauth2/auth/central?${new URLSearchParams({ filter: "apiv3.1", response_type: "code", client_id: SAGE_ID, redirect_uri: SAGE_REDIRECT, scope: "readonly", state })}`,
    orgs: async (token) => {
      const j = await getJson(`${SAGE_API}/businesses`, { Authorization: `Bearer ${token}` }, "Sage");
      return (Array.isArray(j) ? j : j.$items || []).map((b) => ({ id: str(b.id), name: str(b.displayed_as || b.name) }));
    },
  },
  xero: {
    name: "Xero", id: XERO_ID, secret: XERO_SECRET, redirect: XERO_REDIRECT, token: "https://identity.xero.com/connect/token", basic: true,
    authorize: (state) => `https://login.xero.com/identity/connect/authorize?${new URLSearchParams({ response_type: "code", client_id: XERO_ID, redirect_uri: XERO_REDIRECT, scope: XERO_SCOPES, state })}`,
    orgs: async (token) => (await getJson("https://api.xero.com/connections", { Authorization: `Bearer ${token}` }, "Xero")).map((t) => ({ id: str(t.tenantId), name: str(t.tenantName) })),
  },
};
async function oauthToken(cfg, params) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = new URLSearchParams(params);
  if (cfg.basic) headers.Authorization = `Basic ${Buffer.from(`${cfg.id}:${cfg.secret}`).toString("base64")}`;
  else { body.set("client_id", cfg.id); body.set("client_secret", cfg.secret); }
  const res = await fetch(cfg.token, { method: "POST", headers, body: body.toString(), signal: AbortSignal.timeout(20000) }).catch(() => null);
  const j = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok || !j.access_token) throw new HttpError(400, j.error === "invalid_grant" ? `${cfg.name} access has expired. Connect again.` : `${cfg.name} refused the connection (${str(j.error) || res?.status || "no reply"}).`);
  return j;
}
const tokenCache = new Map(); // "src:tenant" → { token, until }
async function oauthConn(tenantId, src) {
  const cfg = OAUTH[src];
  const { m } = await settings(tenantId);
  const sec = await secrets(tenantId);
  const info = m[src]; const refresh = sec[`migrate_${src}_refresh`];
  if (!info?.org || !refresh) throw new HttpError(400, `Connect ${cfg.name} first.`);
  const k = `${src}:${tenantId}`; const hit = tokenCache.get(k);
  if (hit && hit.until > Date.now()) return { ...info, token: hit.token };
  const j = await oauthToken(cfg, { grant_type: "refresh_token", refresh_token: refresh });
  if (j.refresh_token && j.refresh_token !== refresh) await setSecret(tenantId, `migrate_${src}_refresh`, j.refresh_token);
  tokenCache.set(k, { token: j.access_token, until: Date.now() + (Number(j.expires_in || 1800) - 120) * 1000 });
  return { ...info, token: j.access_token };
}

/** GET /api/migrate/sage/callback and /api/migrate/xero/callback. */
export async function handleSourceCallback(req, res, src, search) {
  const cfg = OAUTH[src];
  const q = new URLSearchParams(search || "");
  const st = verify(q.get("state"));
  const redirect = (url) => { res.writeHead(302, { Location: url, "Cache-Control": "no-store" }); res.end(); };
  if (!cfg || !st || st.src !== src) return redirect(`https://app.${ROOT_HOST}/`);
  const back = `${await companyOrigin(st.t)}/migrate?from=${src}`;
  try {
    if (q.get("error")) throw new HttpError(400, "access was not granted");
    const j = await oauthToken(cfg, { grant_type: "authorization_code", code: str(q.get("code")), redirect_uri: cfg.redirect });
    if (!j.refresh_token) throw new HttpError(400, "no long-lived access was granted");
    await setSecret(st.t, `migrate_${src}_refresh`, j.refresh_token);
    tokenCache.set(`${src}:${st.t}`, { token: j.access_token, until: Date.now() + (Number(j.expires_in || 1800) - 120) * 1000 });
    const orgs = await cfg.orgs(j.access_token).catch(() => []);
    if (!orgs.length) throw new HttpError(400, `no ${cfg.name} organisation was shared`);
    await saveSettings(st.t, { [src]: { org: orgs[0].id, name: orgs[0].name, orgs, connected_at: new Date().toISOString() } });
    return redirect(`${back}&connected=1`);
  } catch (e) {
    return redirect(`${back}&error=${enc(str(e.message).slice(0, 160))}`);
  }
}

// ---- token sources (ERPNext, Loyverse) -----------------------------------------------
async function erpConn(tenantId) {
  const { m } = await settings(tenantId);
  const sec = await secrets(tenantId);
  if (!m.erpnext?.url || !sec.migrate_erpnext_key) throw new HttpError(400, "Connect ERPNext first.");
  return { ...m.erpnext, auth: `token ${sec.migrate_erpnext_key}` };
}
async function loyConn(tenantId) {
  const { m } = await settings(tenantId);
  const sec = await secrets(tenantId);
  if (!sec.migrate_loyverse_token) throw new HttpError(400, "Connect Loyverse first.");
  return { ...(m.loyverse || {}), token: sec.migrate_loyverse_token };
}

// ---- shared mapping helpers ----------------------------------------------------------
const pct = (tax, net) => (Number(net) ? Math.round((Number(tax || 0) / Number(net)) * 1000) / 10 : undefined);
const lineDoc = (head, lines, total) => (lines.length ? lines : [{ "Item Name": "Imported total", Quantity: 1, "Item Price": total, "Item Total": total }]).map((li, i) => ({ ext: `${i}`, row: R({ ...head, ...li }) }));
const applied = (head, list, numberCol, amountCol) => (list.length ? list.map((a, i) => ({ ext: `${i}`, row: R({ ...head, [numberCol]: a.name, [amountCol]: a.amount }) })) : [{ ext: "0", row: R(head) }]);
const jobCache = new Map(); // job id → lookups loaded once per fetch
const cacheOf = (job) => { if (!jobCache.has(job.id)) jobCache.set(job.id, {}); return jobCache.get(job.id); };

// ---- Sage Business Cloud Accounting -------------------------------------------------------
const SAGE_ACC = { SALES: "Income", OTHER_INCOME: "Other Income", DIRECT_EXPENSES: "Cost of Goods Sold", OVERHEADS: "Expense", DEPRECIATION: "Expense", CURRENT_ASSETS: "Other Current Asset", FIXED_ASSETS: "Fixed Asset", FUTURE_ASSETS: "Other Asset", BANK: "Bank", CURRENT_LIABILITY: "Other Current Liability", FUTURE_LIABILITY: "Long Term Liability", LT_LIABILITY: "Long Term Liability", EQUITY: "Equity" };
const sName = (o) => o?.displayed_as || o?.name;
const sLines = (lines) => (lines || []).map((l) => ({ "Item Name": sName(l.product) || sName(l.service) || l.description, "Item Desc": l.description, Quantity: l.quantity, "Item Price": l.unit_price, "Item Total": l.net_amount, "Item Tax %": l.tax_rate?.percentage ?? pct(l.tax_amount, l.net_amount), Discount: Number(l.discount_amount) || undefined, Account: sName(l.ledger_account) }));
const sContact = (c, type) => R({
  "Display Name": c.name || c.displayed_as, "Company Name": c.name, "Contact Type": type, EmailID: c.email || c.main_contact_person?.email, "Mobile Phone": c.main_contact_person?.mobile || c.mobile,
  Phone: c.main_contact_person?.telephone || c.telephone, "Billing Address": c.main_address?.address_line_1, "Billing City": c.main_address?.city, "Billing Country": sName(c.main_address?.country),
  "Tax Registration Number": c.tax_number, "Credit Limit": c.credit_limit, "Customer Number": c.reference, Notes: c.notes,
});
const sPage = (path, extra = {}) => async (c, cur) => {
  const j = await getJson(`${SAGE_API}/${path}?${new URLSearchParams({ items_per_page: "200", attributes: "all", page: String(cur.page), ...extra })}`, { Authorization: `Bearer ${c.token}`, "X-Business": c.org }, "Sage");
  return { items: j.$items || [], more: !!j.$next };
};
const sStatus = (v, balanceKey = "outstanding_amount") => docStatus({ draft: v.status?.id === "DRAFT", cancelled: v.status?.id === "VOID", total: v.total_amount, balance: v[balanceKey] ?? v.total_amount, due: v.due_date });
const sAllocated = (p) => (p.allocated_artefacts || []).map((a) => ({ name: sName(a.artefact), amount: a.amount })).filter((a) => a.name && Number(a.amount));
const SAGE = {
  accounts: { page: sPage("ledger_accounts"), rows: (a) => [{ ext: "0", row: R({ "Account Name": a.name || a.displayed_as, "Account Code": a.nominal_code, "Account Type": SAGE_ACC[a.ledger_account_type?.id] || "Expense", Description: a.display_name, "Account Status": a.visible_in_chart_of_accounts === false ? "Inactive" : "Active" }) }] },
  customers: { page: sPage("contacts", { contact_type_id: "CUSTOMER" }), rows: (c) => [{ ext: "0", row: sContact(c, "customer") }] },
  vendors: { page: sPage("contacts", { contact_type_id: "VENDOR" }), rows: (c) => [{ ext: "0", row: sContact(c, "vendor") }] },
  items: {
    // Products first, then services.
    page: async (c, cur) => {
      const p = await sPage(cur.sub === "services" ? "services" : "products")(c, cur);
      p.items = p.items.map((x) => ({ ...x, _service: cur.sub === "services" }));
      if (!p.more && cur.sub !== "services") { cur.sub = "services"; cur.page = 0; p.more = true; }
      return p;
    },
    id: (x) => `${x._service ? "s" : "p"}${x.id}`,
    rows: (p) => [{ ext: "0", row: R({ "Item Name": p.description || p.displayed_as, SKU: p.item_code, Rate: p._service ? p.sales_rates?.[0]?.rate : p.sales_prices?.[0]?.price, "Purchase Rate": p.cost_price, "Product Type": p._service ? "service" : "goods", "Stock On Hand": p._service ? undefined : p.quantity_in_stock, Description: p.notes, Status: p.active === false ? "Inactive" : "Active" }) }],
  },
  quotes: { page: sPage("sales_quotes"), rows: (q) => lineDoc({ "Estimate Number": q.quote_number || q.displayed_as, "Customer Name": sName(q.contact), "Estimate Date": q.date, "Expiry Date": q.expiry_date, "Estimate Status": { ACCEPTED: "Accepted", DECLINED: "Declined", DRAFT: "Draft", INVOICED: "Invoiced" }[q.status?.id] || "Sent", Total: q.total_amount, SubTotal: q.net_amount, "Tax Total": q.tax_amount, Notes: q.notes, "Reference#": q.reference }, sLines(q.quote_lines), q.total_amount) },
  invoices: { page: sPage("sales_invoices"), rows: (v) => lineDoc({ "Invoice Number": v.invoice_number || v.displayed_as, "Customer Name": sName(v.contact), "Invoice Date": v.date, "Due Date": v.due_date, "Invoice Status": sStatus(v), Total: v.total_amount, Balance: v.outstanding_amount, SubTotal: v.net_amount, "Tax Total": v.tax_amount, Notes: v.notes, "Reference#": v.reference }, sLines(v.invoice_lines), v.total_amount) },
  credit_notes: { page: sPage("sales_credit_notes"), rows: (v) => lineDoc({ "Credit Note Number": v.credit_note_number || v.displayed_as, "Customer Name": sName(v.contact), "Credit Note Date": v.date, "Credit Note Status": v.status?.id === "DRAFT" ? "Draft" : v.status?.id === "VOID" ? "Void" : "Open", Total: v.total_amount, SubTotal: v.net_amount, "Tax Total": v.tax_amount, Reason: v.notes }, sLines(v.credit_note_lines), v.total_amount) },
  payments: { page: sPage("contact_payments", { transaction_type_id: "CUSTOMER_RECEIPT" }), rows: (p) => applied({ "Payment Number": p.reference || p.id, "Customer Name": sName(p.contact), Date: p.date, Amount: p.total_amount, Mode: sName(p.payment_method), "Reference Number": p.reference }, sAllocated(p), "Invoice Number", "Amount Applied to Invoice") },
  bills: { page: sPage("purchase_invoices"), rows: (b) => lineDoc({ "Bill Number": b.vendor_reference || b.reference || b.displayed_as, "Vendor Name": sName(b.contact), "Bill Date": b.date, "Due Date": b.due_date, "Bill Status": sStatus(b).replace("Sent", "Open"), Total: b.total_amount, Balance: b.outstanding_amount, "Reference Number": b.reference, Notes: b.notes }, sLines(b.invoice_lines), b.total_amount).map((r, i) => (i === 0 ? { ...r, row: { ...r.row, ...R({ "Tax Amount": b.tax_amount }) } } : r)) },
  vendor_payments: { page: sPage("contact_payments", { transaction_type_id: "VENDOR_PAYMENT" }), rows: (p) => applied({ "Payment Number": p.reference || p.id, "Vendor Name": sName(p.contact), Date: p.date, Amount: p.total_amount, Mode: sName(p.payment_method), Description: p.reference }, sAllocated(p), "Bill Number", "Amount Applied to Bill") },
  journals: { page: sPage("journals"), rows: (j) => (j.journal_lines || []).map((l, i) => ({ ext: `${i}`, row: R({ "Journal Number": j.reference || j.id, "Journal Date": j.date, Notes: j.description, Account: sName(l.ledger_account), Description: l.details, Debit: l.debit, Credit: l.credit }) })) },
};

// ---- Xero ----------------------------------------------------------------------------------
const XERO_ACC = { BANK: "Bank", CURRENT: "Other Current Asset", CURRLIAB: "Other Current Liability", DEPRECIATN: "Expense", DIRECTCOSTS: "Cost of Goods Sold", EQUITY: "Equity", EXPENSE: "Expense", FIXED: "Fixed Asset", INVENTORY: "Stock", LIABILITY: "Other Current Liability", NONCURRENT: "Other Asset", OTHERINCOME: "Other Income", OVERHEADS: "Expense", PREPAYMENT: "Other Current Asset", REVENUE: "Income", SALES: "Income", TERMLIAB: "Long Term Liability" };
const xDate = (o, k) => {
  const s = o?.[`${k}String`]; if (s) return str(s).slice(0, 10);
  const ms = /Date\((\d+)/.exec(str(o?.[k]))?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : undefined;
};
const xPhone = (c, type) => { const p = (c.Phones || []).find((x) => x.PhoneType === type && x.PhoneNumber); return p ? [p.PhoneCountryCode, p.PhoneAreaCode, p.PhoneNumber].filter(Boolean).join(" ") : undefined; };
const xContact = (c, type) => {
  const a = (c.Addresses || []).find((x) => x.AddressLine1) || {};
  return R({ "Display Name": c.Name, "Company Name": c.Name, "Contact Type": type, EmailID: c.EmailAddress, "Mobile Phone": xPhone(c, "MOBILE"), Phone: xPhone(c, "DEFAULT"), "First Name": c.FirstName, "Last Name": c.LastName, "Billing Address": a.AddressLine1, "Billing City": a.City, "Billing Country": a.Country, "Tax Registration Number": c.TaxNumber, "Customer Number": c.AccountNumber, Status: c.ContactStatus === "ARCHIVED" ? "Inactive" : "Active" });
};
const xLines = (lines) => (lines || []).map((l) => ({ "Item Name": l.Item?.Name || l.ItemCode || l.Description, "Item Desc": l.Description, Quantity: l.Quantity ?? 1, "Item Price": l.UnitAmount, "Item Total": l.LineAmount, "Item Tax %": pct(l.TaxAmount, l.LineAmount), Discount: l.DiscountRate ? `${l.DiscountRate}%` : undefined, Account: l.AccountCode }));
const xGet = (c, path, params = {}) => getJson(`${XERO_API}/${path}?${new URLSearchParams(params)}`, { Authorization: `Bearer ${c.token}`, "xero-tenant-id": c.org }, "Xero");
const xPage = (entity, where, list = entity) => async (c, cur) => {
  const j = await xGet(c, entity, { page: String(cur.page), pageSize: "100", ...(where ? { where } : {}) });
  const items = j[list] || [];
  return { items, more: items.length >= 100 };
};
const xOnce = (entity) => async (c, cur) => (cur.page > 1 ? { items: [], more: false } : { items: (await xGet(c, entity))[entity] || [], more: false });
/** Account code → name, loaded once per fetch (journals and expenses give codes). */
async function xAccounts(c, job) {
  const cache = cacheOf(job);
  if (!cache.xacc) cache.xacc = new Map(((await xGet(c, "Accounts")).Accounts || []).map((a) => [a.Code, a.Name]));
  return cache.xacc;
}
const xStatus = (v) => docStatus({ draft: v.Status === "DRAFT" || v.Status === "SUBMITTED", cancelled: v.Status === "VOIDED" || v.Status === "DELETED", total: v.Total, balance: v.AmountDue ?? v.RemainingCredit, due: xDate(v, "DueDate") });
const XERO = {
  accounts: { page: xOnce("Accounts"), id: (a) => a.AccountID, rows: (a) => [{ ext: "0", row: R({ "Account Name": a.Name, "Account Code": a.Code, "Account Type": a.SystemAccount === "DEBTORS" ? "Accounts Receivable" : a.SystemAccount === "CREDITORS" ? "Accounts Payable" : XERO_ACC[a.Type] || "Expense", Description: a.Description, "Account Status": a.Status === "ARCHIVED" ? "Inactive" : "Active" }) }] },
  customers: { page: xPage("Contacts", "IsCustomer==true"), id: (c) => c.ContactID, rows: (c) => [{ ext: "0", row: xContact(c, "customer") }] },
  vendors: { page: xPage("Contacts", "IsSupplier==true"), id: (c) => c.ContactID, rows: (c) => [{ ext: "0", row: xContact(c, "vendor") }] },
  items: { page: xOnce("Items"), id: (i) => i.ItemID, rows: (i) => [{ ext: "0", row: R({ "Item Name": i.Name || i.Code, SKU: i.Code, Rate: i.SalesDetails?.UnitPrice, "Purchase Rate": i.PurchaseDetails?.UnitPrice, "Product Type": i.IsTrackedAsInventory || i.IsPurchased ? "goods" : "service", "Stock On Hand": i.QuantityOnHand, Description: i.Description }) }] },
  quotes: { page: xPage("Quotes"), id: (q) => q.QuoteID, rows: (q) => lineDoc({ "Estimate Number": q.QuoteNumber, "Customer Name": q.Contact?.Name, "Estimate Date": xDate(q, "Date"), "Expiry Date": xDate(q, "ExpiryDate"), "Estimate Status": { ACCEPTED: "Accepted", DECLINED: "Declined", DRAFT: "Draft", INVOICED: "Invoiced" }[q.Status] || "Sent", Total: q.Total, SubTotal: q.SubTotal, "Tax Total": q.TotalTax, Terms: q.Terms, "Reference#": q.Reference }, xLines(q.LineItems), q.Total) },
  invoices: { page: xPage("Invoices", 'Type=="ACCREC"&&Status!="DELETED"'), id: (v) => v.InvoiceID, rows: (v) => lineDoc({ "Invoice Number": v.InvoiceNumber, "Customer Name": v.Contact?.Name, "Invoice Date": xDate(v, "Date"), "Due Date": xDate(v, "DueDate"), "Invoice Status": xStatus(v), Total: v.Total, Balance: v.AmountDue, SubTotal: v.SubTotal, "Tax Total": v.TotalTax, "Reference#": v.Reference }, xLines(v.LineItems), v.Total) },
  credit_notes: { page: xPage("CreditNotes", 'Type=="ACCRECCREDIT"'), id: (v) => v.CreditNoteID, rows: (v) => lineDoc({ "Credit Note Number": v.CreditNoteNumber, "Customer Name": v.Contact?.Name, "Credit Note Date": xDate(v, "Date"), "Credit Note Status": v.Status === "DRAFT" ? "Draft" : v.Status === "VOIDED" ? "Void" : "Open", Total: v.Total, SubTotal: v.SubTotal, "Tax Total": v.TotalTax, Reason: v.Reference }, xLines(v.LineItems), v.Total) },
  payments: { page: xPage("Payments", 'PaymentType=="ACCRECPAYMENT"'), id: (p) => p.PaymentID, rows: (p) => [{ ext: "0", row: R({ "Payment Number": p.PaymentID, "Customer Name": p.Invoice?.Contact?.Name, Date: xDate(p, "Date"), Amount: p.Amount, Mode: p.Account?.Name || p.Account?.Code, "Reference Number": p.Reference, "Invoice Number": p.Invoice?.InvoiceNumber, "Amount Applied to Invoice": p.Amount }) }] },
  bills: { page: xPage("Invoices", 'Type=="ACCPAY"&&Status!="DELETED"'), id: (b) => b.InvoiceID, rows: (b) => lineDoc({ "Bill Number": b.InvoiceNumber || b.Reference || str(b.InvoiceID).slice(0, 8), "Vendor Name": b.Contact?.Name, "Bill Date": xDate(b, "Date"), "Due Date": xDate(b, "DueDate"), "Bill Status": xStatus(b).replace("Sent", "Open"), Total: b.Total, Balance: b.AmountDue, "Reference Number": b.Reference }, xLines(b.LineItems), b.Total).map((r, i) => (i === 0 ? { ...r, row: { ...r.row, ...R({ "Tax Amount": b.TotalTax }) } } : r)) },
  vendor_payments: { page: xPage("Payments", 'PaymentType=="ACCPAYPAYMENT"'), id: (p) => p.PaymentID, rows: (p) => [{ ext: "0", row: R({ "Payment Number": p.PaymentID, "Vendor Name": p.Invoice?.Contact?.Name, Date: xDate(p, "Date"), Amount: p.Amount, Mode: p.Account?.Name || p.Account?.Code, Description: p.Reference, "Bill Number": p.Invoice?.InvoiceNumber || p.Invoice?.Reference, "Amount Applied to Bill": p.Amount }) }] },
  expenses: { page: xPage("BankTransactions", 'Type=="SPEND"&&Status!="DELETED"', "BankTransactions"), id: (e) => e.BankTransactionID,
    rows: async (e, c, job) => { const acc = await xAccounts(c, job); const l = e.LineItems?.[0] || {}; return [{ ext: "0", row: R({ "Expense Date": xDate(e, "Date"), "Expense Account": acc.get(l.AccountCode) || l.AccountCode, Total: e.Total, "Tax Amount": e.TotalTax, Vendor: e.Contact?.Name, "Paid Through": e.BankAccount?.Name, "Reference#": e.Reference, Description: l.Description }) }]; } },
  journals: { page: xPage("ManualJournals"), id: (j) => j.ManualJournalID,
    rows: async (j, c, job) => { const acc = await xAccounts(c, job); return (j.JournalLines || []).map((l, i) => ({ ext: `${i}`, row: R({ "Journal Number": str(j.ManualJournalID).slice(0, 8), "Journal Date": xDate(j, "Date"), Notes: j.Narration, Account: acc.get(l.AccountCode) || l.AccountCode, Description: l.Description, Debit: Number(l.LineAmount) > 0 ? l.LineAmount : 0, Credit: Number(l.LineAmount) < 0 ? -Number(l.LineAmount) : 0 }) })); } },
};

// ---- ERPNext / Frappe -----------------------------------------------------------------------
const fGet = (c, path, params = {}) => getJson(`${c.url}/api/${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`, { Authorization: c.auth }, "ERPNext");
const fPage = (doctype, fields, filters = []) => async (c, cur) => {
  const j = await fGet(c, `resource/${enc(doctype)}`, { fields: JSON.stringify(fields), filters: JSON.stringify(filters), limit_start: String((cur.page - 1) * 200), limit_page_length: "200", order_by: "creation asc" });
  const items = j.data || [];
  return { items, more: items.length >= 200 };
};
const fDoc = async (c, doctype, name) => (await fGet(c, `resource/${enc(doctype)}/${enc(name)}`)).data || {};
const fLines = (items) => (items || []).map((l) => ({ "Item Name": l.item_name || l.item_code, "Item Desc": l.description ? str(l.description).replace(/<[^>]+>/g, " ").trim() : undefined, Quantity: Math.abs(Number(l.qty ?? 1)), "Item Price": l.rate, "Item Total": Math.abs(Number(l.amount || 0)), Discount: Number(l.discount_percentage) ? `${l.discount_percentage}%` : undefined, Account: l.income_account || l.expense_account, "Usage unit": l.uom }));
const plain = (html) => (html ? str(html).replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/(,\s*)+$/, "").trim() : undefined);
const fAcc = (a) => ({ Bank: "Bank", Cash: "Cash", Receivable: "Accounts Receivable", Payable: "Accounts Payable", Stock: "Stock", "Fixed Asset": "Fixed Asset", "Cost of Goods Sold": "Cost of Goods Sold", Depreciation: "Expense", Equity: "Equity" }[a.account_type]
  || (a.account_type === "Tax" ? (a.root_type === "Liability" ? "Other Current Liability" : "Other Current Asset") : { Asset: "Other Current Asset", Liability: "Other Current Liability", Equity: "Equity", Income: "Income", Expense: "Expense" }[a.root_type] || "Expense"));
const baseAccount = (name) => str(name).replace(/\s+-\s+[^-]+$/, "");
const fStatus = (v) => docStatus({ draft: Number(v.docstatus) === 0, cancelled: Number(v.docstatus) === 2, total: Math.abs(Number(v.grand_total || 0)), balance: Math.abs(Number(v.outstanding_amount ?? v.grand_total ?? 0)), due: v.due_date });
async function fRefs(c, name, doctype) {
  const d = await fDoc(c, "Payment Entry", name);
  return (d.references || []).filter((r) => r.reference_doctype === doctype).map((r) => ({ name: r.reference_name, amount: r.allocated_amount }));
}
async function fStock(c, job) {
  const cache = cacheOf(job);
  if (!cache.bins) {
    cache.bins = new Map();
    for (let p = 1; p < 500; p++) {
      const { items, more } = await fPage("Bin", ["item_code", "actual_qty"])(c, { page: p });
      for (const b of items) cache.bins.set(b.item_code, (cache.bins.get(b.item_code) || 0) + Number(b.actual_qty || 0));
      if (!more) break;
    }
  }
  return cache.bins;
}
const SALE_FIELDS = ["name", "customer", "customer_name", "posting_date", "due_date", "status", "grand_total", "outstanding_amount", "net_total", "total_taxes_and_charges", "docstatus", "remarks", "po_no"];
const ERPNEXT = {
  accounts: { page: fPage("Account", ["name", "account_name", "account_number", "root_type", "account_type", "disabled"], [["is_group", "=", 0]]), id: (a) => a.name,
    rows: (a) => [{ ext: "0", row: R({ "Account Name": a.account_name, "Account Code": a.account_number, "Account Type": fAcc(a), "Account Status": Number(a.disabled) ? "Inactive" : "Active" }) }] },
  customers: { page: fPage("Customer", ["name", "customer_name", "customer_type", "mobile_no", "email_id", "tax_id", "customer_group", "territory", "disabled", "primary_address"]), id: (x) => x.name,
    rows: (x) => [{ ext: "0", row: R({ "Display Name": x.customer_name || x.name, "Company Name": x.customer_type === "Company" ? x.customer_name : undefined, "Contact Type": "customer", EmailID: x.email_id, "Mobile Phone": x.mobile_no, "Billing Address": plain(x.primary_address), "Billing State": x.territory, "Tax Registration Number": x.tax_id, Status: Number(x.disabled) ? "Inactive" : "Active" }) }] },
  vendors: { page: fPage("Supplier", ["name", "supplier_name", "mobile_no", "email_id", "tax_id", "supplier_group", "disabled", "primary_address"]), id: (x) => x.name,
    rows: (x) => [{ ext: "0", row: R({ "Display Name": x.supplier_name || x.name, "Company Name": x.supplier_name, "Contact Type": "vendor", EmailID: x.email_id, "Mobile Phone": x.mobile_no, "Billing Address": plain(x.primary_address), "Tax Registration Number": x.tax_id, Status: Number(x.disabled) ? "Inactive" : "Active" }) }] },
  items: { page: fPage("Item", ["name", "item_code", "item_name", "item_group", "stock_uom", "is_stock_item", "standard_rate", "valuation_rate", "description", "disabled"]), id: (x) => x.name,
    rows: async (x, c, job) => { const stock = await fStock(c, job).catch(() => new Map()); return [{ ext: "0", row: R({ "Item Name": x.item_name || x.item_code, SKU: x.item_code, Rate: x.standard_rate, "Purchase Rate": x.valuation_rate, "Usage unit": x.stock_uom, "Product Type": Number(x.is_stock_item) ? "goods" : "service", "Stock On Hand": Number(x.is_stock_item) ? stock.get(x.item_code) : undefined, "Category Name": x.item_group, Description: plain(x.description), Status: Number(x.disabled) ? "Inactive" : "Active" }) }]; } },
  quotes: { page: fPage("Quotation", ["name", "party_name", "customer_name", "transaction_date", "valid_till", "status", "grand_total", "net_total", "total_taxes_and_charges", "docstatus"], [["docstatus", "<", 2]]), id: (x) => x.name,
    rows: async (q, c, job) => lineDoc({ "Estimate Number": q.name, "Customer Name": q.customer_name || q.party_name, "Estimate Date": q.transaction_date, "Expiry Date": q.valid_till, "Estimate Status": Number(q.docstatus) === 0 ? "Draft" : q.status === "Ordered" ? "Accepted" : q.status === "Lost" ? "Declined" : "Sent", Total: q.grand_total, SubTotal: q.net_total, "Tax Total": q.total_taxes_and_charges }, job.with_lines ? fLines((await fDoc(c, "Quotation", q.name)).items) : [], q.grand_total) },
  sales_orders: { page: fPage("Sales Order", ["name", "customer", "customer_name", "transaction_date", "delivery_date", "status", "grand_total", "net_total", "total_taxes_and_charges", "docstatus", "po_no"], [["docstatus", "<", 2]]), id: (x) => x.name,
    rows: async (o, c, job) => lineDoc({ "SalesOrder Number": o.name, "Customer Name": o.customer_name || o.customer, "Order Date": o.transaction_date, "Expected Shipment Date": o.delivery_date, Status: Number(o.docstatus) === 0 ? "Draft" : /complete|closed/i.test(o.status) ? "Closed" : "Confirmed", Total: o.grand_total, SubTotal: o.net_total, "Tax Total": o.total_taxes_and_charges, "Reference#": o.po_no }, job.with_lines ? fLines((await fDoc(c, "Sales Order", o.name)).items) : [], o.grand_total) },
  invoices: { page: fPage("Sales Invoice", SALE_FIELDS, [["is_return", "=", 0], ["docstatus", "<", 2]]), id: (x) => x.name,
    rows: async (v, c, job) => lineDoc({ "Invoice Number": v.name, "Customer Name": v.customer_name || v.customer, "Invoice Date": v.posting_date, "Due Date": v.due_date, "Invoice Status": fStatus(v), Total: v.grand_total, Balance: v.outstanding_amount, SubTotal: v.net_total, "Tax Total": v.total_taxes_and_charges, Notes: v.remarks, "Reference#": v.po_no }, job.with_lines ? fLines((await fDoc(c, "Sales Invoice", v.name)).items) : [], v.grand_total) },
  credit_notes: { page: fPage("Sales Invoice", SALE_FIELDS, [["is_return", "=", 1], ["docstatus", "<", 2]]), id: (x) => x.name,
    rows: async (v, c, job) => lineDoc({ "Credit Note Number": v.name, "Customer Name": v.customer_name || v.customer, "Credit Note Date": v.posting_date, "Credit Note Status": Number(v.docstatus) === 0 ? "Draft" : "Open", Total: Math.abs(Number(v.grand_total || 0)), SubTotal: Math.abs(Number(v.net_total || 0)), "Tax Total": Math.abs(Number(v.total_taxes_and_charges || 0)), Reason: v.remarks }, job.with_lines ? fLines((await fDoc(c, "Sales Invoice", v.name)).items) : [], Math.abs(Number(v.grand_total || 0))) },
  payments: { page: fPage("Payment Entry", ["name", "party", "party_name", "posting_date", "paid_amount", "mode_of_payment", "reference_no"], [["payment_type", "=", "Receive"], ["docstatus", "=", 1]]), id: (x) => x.name,
    rows: async (p, c) => applied({ "Payment Number": p.name, "Customer Name": p.party_name || p.party, Date: p.posting_date, Amount: p.paid_amount, Mode: p.mode_of_payment, "Reference Number": p.reference_no }, await fRefs(c, p.name, "Sales Invoice"), "Invoice Number", "Amount Applied to Invoice") },
  bills: { page: fPage("Purchase Invoice", ["name", "supplier", "supplier_name", "bill_no", "posting_date", "due_date", "status", "grand_total", "outstanding_amount", "total_taxes_and_charges", "docstatus", "remarks"], [["is_return", "=", 0], ["docstatus", "<", 2]]), id: (x) => x.name,
    rows: async (b, c, job) => lineDoc({ "Bill Number": b.name, "Vendor Name": b.supplier_name || b.supplier, "Bill Date": b.posting_date, "Due Date": b.due_date, "Bill Status": fStatus(b).replace("Sent", "Open"), Total: b.grand_total, Balance: b.outstanding_amount, "Reference Number": b.bill_no, Notes: b.remarks }, job.with_lines ? fLines((await fDoc(c, "Purchase Invoice", b.name)).items) : [], b.grand_total).map((r, i) => (i === 0 ? { ...r, row: { ...r.row, ...R({ "Tax Amount": b.total_taxes_and_charges }) } } : r)) },
  vendor_payments: { page: fPage("Payment Entry", ["name", "party", "party_name", "posting_date", "paid_amount", "mode_of_payment", "reference_no"], [["payment_type", "=", "Pay"], ["party_type", "=", "Supplier"], ["docstatus", "=", 1]]), id: (x) => x.name,
    rows: async (p, c) => applied({ "Payment Number": p.name, "Vendor Name": p.party_name || p.party, Date: p.posting_date, Amount: p.paid_amount, Mode: p.mode_of_payment, Description: p.reference_no }, await fRefs(c, p.name, "Purchase Invoice"), "Bill Number", "Amount Applied to Bill") },
  journals: { page: fPage("Journal Entry", ["name", "posting_date", "user_remark", "voucher_type"], [["docstatus", "=", 1]]), id: (x) => x.name,
    rows: async (j, c) => ((await fDoc(c, "Journal Entry", j.name)).accounts || []).map((l, i) => ({ ext: `${i}`, row: R({ "Journal Number": j.name, "Journal Date": j.posting_date, Notes: j.user_remark || j.voucher_type, Account: baseAccount(l.account), Description: l.user_remark, Debit: l.debit_in_account_currency ?? l.debit, Credit: l.credit_in_account_currency ?? l.credit }) })) },
  leads: { page: fPage("Lead", ["name", "lead_name", "company_name", "email_id", "mobile_no", "phone", "source", "status", "city", "country"]), id: (x) => x.name, optional: "No CRM leads (or no access).",
    rows: (l) => { const [first, ...rest] = str(l.lead_name || l.company_name).split(" "); return [{ ext: "0", row: R({ "First Name": first, "Last Name": rest.join(" ") || first, Company: l.company_name, Email: l.email_id, Phone: l.phone, Mobile: l.mobile_no, City: l.city, Country: l.country, "Lead Source": l.source, "Lead Status": l.status }) }]; } },
  employees: { page: fPage("Employee", ["name", "employee_name", "first_name", "last_name", "company_email", "personal_email", "cell_number", "gender", "date_of_birth", "date_of_joining", "designation", "department", "status"]), id: (x) => x.name, optional: "No employees (or no access to HR).",
    rows: (e) => [{ ext: "0", row: R({ "Employee ID": e.name, "First Name": e.first_name || str(e.employee_name).split(" ")[0], "Last Name": e.last_name || str(e.employee_name).split(" ").slice(1).join(" "), "Email ID": e.company_email || e.personal_email, "Mobile Phone": e.cell_number, Gender: e.gender, "Date of Birth": e.date_of_birth, "Date of Joining": e.date_of_joining, Designation: e.designation, Department: baseAccount(e.department), "Employee Status": e.status === "Active" ? "Active" : "Inactive" }) }] },
};

// ---- Loyverse POS ------------------------------------------------------------------------------
const lGet = (c, path, params = {}) => getJson(`${LOYVERSE_API}/${path}?${new URLSearchParams(params)}`, { Authorization: `Bearer ${c.token}` }, "Loyverse");
const lPage = (path, list = path) => async (c, cur) => {
  const j = await lGet(c, path, { limit: "250", ...(cur.next ? { cursor: cur.next } : {}) });
  return { items: j[list] || [], more: !!j.cursor, next: j.cursor || null };
};
async function lLookups(c, job) {
  const cache = cacheOf(job);
  if (!cache.loy) {
    const all = async (path, list) => { const out = []; let cursor = null; for (let i = 0; i < 400; i++) { const j = await lGet(c, path, { limit: "250", ...(cursor ? { cursor } : {}) }); out.push(...(j[list] || [])); cursor = j.cursor; if (!cursor) break; } return out; };
    const [cats, inv, custs] = await Promise.all([all("categories", "categories").catch(() => []), all("inventory", "inventory_levels").catch(() => []), all("customers", "customers").catch(() => [])]);
    const stock = new Map();
    for (const l of inv) stock.set(l.variant_id, (stock.get(l.variant_id) || 0) + Number(l.in_stock || 0));
    cache.loy = { cats: new Map(cats.map((x) => [x.id, x.name])), stock, custs: new Map(custs.map((x) => [x.id, x.name])) };
  }
  return cache.loy;
}
const LOYVERSE = {
  customers: { page: lPage("customers"), rows: (x) => [{ ext: "0", row: R({ "Display Name": x.name, "Contact Type": "customer", EmailID: x.email, "Mobile Phone": x.phone_number, "Billing Address": x.address, "Billing City": x.city, "Customer Number": x.customer_code, Notes: x.note }) }] },
  vendors: { page: lPage("suppliers"), rows: (x) => [{ ext: "0", row: R({ "Display Name": x.name, "Company Name": x.name, "Contact Type": "vendor", EmailID: x.email, Phone: x.phone_number, "Billing Address": x.address_1, "Billing City": x.city, "First Name": x.contact, Notes: x.note }) }] },
  items: { page: lPage("items"),
    rows: async (it, c, job) => {
      const { cats, stock } = await lLookups(c, job);
      const variants = it.variants?.length ? it.variants : [{}];
      return variants.map((v, i) => {
        const opts = [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" / ");
        return { ext: `${i}`, row: R({ "Item Name": opts ? `${it.item_name} (${opts})` : it.item_name, SKU: v.sku, UPC: v.barcode, Rate: v.default_price ?? v.stores?.[0]?.price, "Purchase Rate": v.cost, "Product Type": it.track_stock === false ? "service" : "goods", "Stock On Hand": stock.get(v.variant_id), "Category Name": cats.get(it.category_id), Description: it.description }) };
      });
    } },
  invoices: { page: lPage("receipts"), id: (r) => r.receipt_number,
    rows: async (r, c, job) => {
      if (r.receipt_type === "REFUND" || r.cancelled_at) return [];
      const { custs } = await lLookups(c, job);
      const lines = (r.line_items || []).map((l) => ({ "Item Name": [l.item_name, l.variant_name].filter(Boolean).join(" "), Quantity: l.quantity, "Item Price": l.price, "Item Total": l.total_money, Discount: Number(l.total_discount) || undefined, "Item Tax %": l.line_taxes?.[0]?.rate }));
      return lineDoc({ "Invoice Number": `LV-${r.receipt_number}`, "Customer Name": custs.get(r.customer_id) || "Walk-in customer", "Invoice Date": str(r.receipt_date || r.created_at).slice(0, 10), "Invoice Status": "Paid", Total: r.total_money, Balance: 0, "Tax Total": r.total_tax, Notes: [r.note, (r.payments || []).map((p) => p.name).filter(Boolean).join(", ")].filter(Boolean).join(" · ") }, lines, r.total_money);
    } },
};

const FETCHERS = {
  sage: { defs: SAGE, conn: (job) => oauthConn(job.tenant_id, "sage") },
  xero: { defs: XERO, conn: (job) => oauthConn(job.tenant_id, "xero") },
  erpnext: { defs: ERPNEXT, conn: (job) => erpConn(job.tenant_id) },
  loyverse: { defs: LOYVERSE, conn: (job) => loyConn(job.tenant_id) },
};

/** Walks every chosen kind of a Sage, Xero, ERPNext or Loyverse job, page by page. */
async function runPaged(job, cur, progress, alive) {
  const f = FETCHERS[job.source];
  const kinds = SOURCE_KINDS[job.source].filter((k) => job.kinds.includes(k));
  try {
    for (; cur.src < kinds.length; cur.src++, cur.page = 1, cur.next = null, cur.sub = null) {
      const kind = kinds[cur.src]; const def = f.defs[kind];
      for (;;) {
        if (!(await alive())) return false;
        const c = await f.conn(job);
        let page;
        try { page = await def.page(c, cur, job); }
        catch (e) { if (def.optional && !(e instanceof QuotaError)) { progress[kind] = { ...(progress[kind] || {}), note: def.optional }; break; } throw e; }
        for (const it of page.items) {
          await stage(job, kind, def.id ? def.id(it) : it.id, await def.rows(it, c, job));
          progress[kind] = { ...(progress[kind] || {}), fetched: Number(progress[kind]?.fetched || 0) + 1 };
        }
        cur.page++; cur.next = page.next || null;
        await patchJob(job.id, { cursor: cur, progress });
        if (!page.more) break;
      }
    }
    return true;
  } finally { jobCache.delete(job.id); }
}

/** The connection to check before a fetch starts, and what to show as the organisation. */
async function sourceOrg(tenantId, source) {
  const { m } = await settings(tenantId);
  const x = m[source];
  if (!x) return {};
  return { id: x.org || x.url || source, name: x.name };
}

Object.assign(migrateRoutes, {
  "/api/erp/migrate/oauth-source-start": async (who, b) => {
    admin(who);
    const src = str(b.source); const cfg = OAUTH[src];
    if (!cfg) throw new HttpError(400, "Unknown system");
    if (!cfg.id || !cfg.secret) throw new HttpError(400, `${cfg.name} connect is not switched on for this platform yet. Ask JMSURF support, or upload ${cfg.name} export files instead.`);
    const state = sign({ t: who.tenantId, u: who.user.id, src, exp: Date.now() + 15 * 60_000 });
    return { url: cfg.authorize(state) };
  },
  "/api/erp/migrate/source-org": async (who, b) => {
    admin(who);
    const src = str(b.source);
    const { m } = await settings(who.tenantId);
    const o = (m[src]?.orgs || []).find((x) => x.id === str(b.org_id));
    if (!o) throw new HttpError(400, "Choose one of the connected organisations.");
    await saveSettings(who.tenantId, { [src]: { ...m[src], org: o.id, name: o.name } });
    return { ok: true };
  },
  "/api/erp/migrate/erpnext-connect": async (who, b) => {
    admin(who);
    const url = safeUrl(b.url, "ERPNext");
    const key = str(b.api_key); const secret = str(b.api_secret);
    if (!key || !secret) throw new HttpError(400, "Enter the API key and API secret.");
    const c = { url, auth: `token ${key}:${secret}` };
    const me = await fGet(c, "method/frappe.auth.get_logged_user").catch((e) => { throw new HttpError(400, e.status === 401 ? "ERPNext did not accept the API key and secret." : e.message); });
    const company = ((await fGet(c, "resource/Company", { fields: JSON.stringify(["name", "default_currency"]), limit_page_length: "1" }).catch(() => ({}))).data || [])[0];
    await setSecret(who.tenantId, "migrate_erpnext_key", `${key}:${secret}`);
    await saveSettings(who.tenantId, { erpnext: { url, user: str(me.message), name: str(company?.name) || new URL(url).hostname, currency: company?.default_currency || null, connected_at: new Date().toISOString() } });
    return { ok: true, name: str(company?.name) || new URL(url).hostname };
  },
  "/api/erp/migrate/loyverse-connect": async (who, b) => {
    admin(who);
    const token = str(b.token);
    if (!token) throw new HttpError(400, "Paste the Loyverse access token.");
    const me = await lGet({ token }, "merchant/").catch((e) => { throw new HttpError(400, e.status === 401 ? "Loyverse did not accept the token." : e.message); });
    await setSecret(who.tenantId, "migrate_loyverse_token", token);
    await saveSettings(who.tenantId, { loyverse: { name: str(me.business_name) || "Loyverse", currency: me.currency?.code || null, connected_at: new Date().toISOString() } });
    return { ok: true, name: str(me.business_name) || "Loyverse" };
  },
});

export { HttpError as MigrateError };
