/**
 * What's new in JMSURF Garage (as in JMSURF ISP). EVERY release that adds or changes something companies can see
 * adds an entry here, newest first. Slugs are unique and never reused. Plain words for business owners; no
 * competitor names. Body: "- " lines become a list.
 */
export type WhatsNewTag = "new" | "improved" | "fixed" | "notice";
export interface WhatsNewEntry { slug: string; date: string; tag: WhatsNewTag; title: string; body: string }

export const WHATS_NEW: WhatsNewEntry[] = [
  { slug: "item-table-full-width-fields", date: "2026-11-18", tag: "fixed", title: "Item lines show every field in full",
    body: "- On quotes, invoices, sales orders, credit notes, purchase orders and bills, Rate, Discount, Tax and Amount keep their full width however long the item name is\n- Long item names wrap onto more lines instead of being cut off\n- Item descriptions, the document description, customer notes and terms grow as you type, so all the text shows" },
  { slug: "customer-portal-v2", date: "2026-11-16", tag: "new", title: "A bigger customer portal",
    body: "- Home: balance due, what is overdue, invoices to pay, quotes to answer and recent payments, with a Pay now button\n- Quotes: customers view them and accept (typing their name as a signature, with a comment) or decline with a reason; you get a bell notice and an email, and the quote changes to accepted or declined\n- Invoices, receipts and credit notes open, print and download as PDF, laid out like yours; Pay now opens the invoice's payment page (M-Pesa or card)\n- Statement for any dates with opening and closing balance, to print or download\n- Messages: customers write to you, with a file if needed; reply from the customer's page, Messages tab, and they get an email\n- Documents: share files from the customer's Documents tab\n- Projects: their projects' progress and milestones, when JMSURF PROJECTS is on\n- My details: customers update phone, email, address and KRA PIN; choose whether changes wait for your approval\n- View as customer: from the customer's page, see their portal read-only\n- System → Customer portal: switch each part on or off" },
  { slug: "workflow-rules", date: "2026-11-16", tag: "new", title: "Workflow rules: automate the routine",
    body: "- System → Workflow rules: when an invoice, quote, sales order, bill, customer, item, lead, expense or payment is created, changed, or a field changes to a value, do something automatically\n- Or on a date: for example 3 days after an invoice's due date, checked every morning\n- Send an email or SMS (to the customer, the salesperson, a role or set addresses), ring the bell, change a field or call one of your webhooks\n- Messages fill in {{invoice_number}}, {{customer_name}}, {{balance}}, {{due_date}} and more\n- Add conditions, such as balance more than 10,000\n- A run log on each rule shows what ran, when, and any error. Up to 50 rules" },
  { slug: "reporting-tags", date: "2026-11-16", tag: "new", title: "Reporting tags",
    body: "- System → Reporting tags: your own tags with values, such as Region: Nairobi, Mombasa, Kisumu\n- Pick them on invoices, bills, expenses, journals and credit notes, optional or required per document\n- Financial Statements: see the profit and loss for one value, or every value side by side\n- Filter the invoice and expense lists by a tag, and see totals per value" },
  { slug: "customers-keep-ordering", date: "2026-11-16", tag: "notice", title: "Your customers keep ordering when your plan ends",
    body: "- When your JMSURF Garage plan ends, staff screens show only Billing until you renew\n- Your online shop, customer portal, payment links, bookings and website keep working the whole time\n- Renewal reminders now say that staff are on hold and that your customers can still order\n- Our Terms and Privacy Policy now show our registration with the Office of the Data Protection Commissioner (194-9812-26EB)" },
  { slug: "vat-return-vat3", date: "2026-11-14", tag: "new", title: "KRA VAT return (VAT3)",
    body: "- Accountant → VAT Return: output and input VAT for a month, split into 16%, 8%, zero-rated and exempt\n- Withholding VAT your customers deducted counts as a credit, and you see what is payable or carried forward\n- Download the sales and purchases schedules for iTax as CSV, or everything in one Excel file\n- Record withholding VAT certificate numbers and see which ones are still missing" },
  { slug: "invoice-payment-links", date: "2026-11-14", tag: "new", title: "Pay now links on invoices",
    body: "- Every sent invoice has its own Pay now link: your customer sees the invoice and pays by M-Pesa or card\n- Payments are recorded against the invoice automatically\n- Copy the link from the invoice; it is added to invoice emails, WhatsApp messages and payment reminders\n- Turn a link off at any time" },
  { slug: "pages-open-from-device", date: "2026-11-14", tag: "improved", title: "Pages open faster", body: "Lists you have opened before now show straight away from the copy kept on your device, then refresh quietly. Pay and payroll are never kept, and everything is cleared when you sign out." },
  { slug: "whats-new-page", date: "2026-11-14", tag: "new", title: "What's new", body: "This page: every change to JMSURF Garage, newest first. A dot on your name tells you when something new has arrived." },
  { slug: "hrm-registration-recruitment", date: "2026-11-14", tag: "new", title: "New hires register themselves, and recruitment to hire",
    body: "- Send a new hire a link: they fill in their details, statutory numbers, next of kin, bank and documents; HR approves and the employee is created\n- Vacancies and candidates from applied to hired, with CVs and files; one click hires a candidate and starts onboarding\n- A careers page lists your open vacancies with an apply form\n- HR events (trainings, meetings, celebrations) on the HRM overview and in My Space\n- 11 more HR reports, from age and retirement to the muster roll and payroll checks" },
  { slug: "crm-accounts", date: "2026-11-14", tag: "improved", title: "CRM Accounts: one page for everyone you deal with", body: "Contacts and Accounts are now one Accounts page, with All, Businesses, People and Lead contacts tabs." },
  { slug: "payroll-documents", date: "2026-11-14", tag: "new", title: "Stored payslips and P9s, NSSF scheme split and bank codes",
    body: "- Every payslip is stored with the payroll run, with who it was sent to, when, and whether they opened it; resend in one click\n- Make, store and email everyone's P9 for the year at once\n- Staff find their payslips and P9s in My Space\n- Send part of NSSF Tier II to a private pension scheme, shown separately on payslips and returns\n- Upload one-off pay lines from a spreadsheet into a draft payroll\n- Kenyan bank and branch codes on employees and in the bank payment file" },
  { slug: "leave-workflow", date: "2026-11-14", tag: "new", title: "Leave approved by the line manager, then HR",
    body: "- Leave goes to the person's line manager first, then HR (switch the manager step off in HRM settings)\n- Pick a colleague to stand in while you are away\n- Half days, and coming back early gives the unused days back\n- A leave calendar shows who is off each day\n- Work from home requests from My Space" },
  { slug: "staff-logins-pay-permission", date: "2026-11-14", tag: "new", title: "Staff logins from the employee record",
    body: "- Create a login for an employee and email their sign-in details, or do everyone at once\n- New logins see only My Space: their payslips, leave, attendance and details\n- Only people allowed to see salaries see pay, payslips and bank details" },
  { slug: "insurance-premium-net-pay", date: "2026-11-14", tag: "improved", title: "Insurance premiums come off net pay", body: "An employee's life or health insurance premium is now deducted from net pay and shown on the payslip, as well as earning the 15% tax relief." },
  { slug: "theme-from-logo", date: "2026-11-14", tag: "new", title: "Colours from your logo", body: "Settings → Appearance reads your logo and offers its colours as themes. One click makes the whole system and your documents match your brand." },
  { slug: "move-in-faster", date: "2026-11-14", tag: "improved", title: "Moving in from your old system is much faster",
    body: "- Records are posted several at a time\n- Fewer calls to the old system, and a repeat move reuses what has not changed\n- A dropped connection no longer stops the move\n- Document numbers carry on exactly where your old system left off" },
  { slug: "etims-enable", date: "2026-11-14", tag: "improved", title: "KRA eTIMS starts when you enable it", body: "KRA eTIMS stays off until an admin presses Enable and accepts the terms. Your device serial number is issued then, not before." },
  { slug: "cleaner-lists", date: "2026-11-14", tag: "improved", title: "Cleaner lists and side menu",
    body: "- Your company logo at the top of the side menu, and every menu name on one line\n- Long names stay on one line in lists, with the full text when you point at them\n- Pages open at once, and key figures sit in one tidy strip" },
  { slug: "credit-notes-layout", date: "2026-11-12", tag: "improved", title: "Credit notes look like your invoices", body: "Credit notes now use the same layout as invoices, with the official KRA logo on eTIMS details." },
  { slug: "support-tickets", date: "2026-11-07", tag: "new", title: "Talk to us from the Help centre", body: "Raise a support ticket from Help centre → Talk to us and follow the replies there and by email." },
  { slug: "dashboard-redesign", date: "2026-11-06", tag: "improved", title: "A new dashboard",
    body: "- A greeting with your name and four key figures\n- Sales chart with orders, average sale and gross profit\n- What needs attention, best sellers and latest activity\n- Income against expenses with totals" },
  { slug: "dash-ai-free", date: "2026-11-06", tag: "new", title: "Garage AI answers everyday questions free", body: "Ask Garage AI about sales, stock, customers and what is owed: everyday questions are answered straight from your books at no cost." },
  { slug: "bank-rules", date: "2026-11-02", tag: "new", title: "Bank rules", body: "Tell DASH how to treat statement lines that match a rule (for example bank charges) and they are categorised or excluded on import, or in one click." },
  { slug: "hrm-my-space", date: "2026-10-28", tag: "new", title: "HRM and payroll for Kenya, and My Space for staff",
    body: "- Employees, leave, attendance, payroll with PAYE, NSSF, SHA and the Housing Levy, loans and statutory returns\n- My Space: staff see their payslips, leave and details" },
];

/** Entries the viewer has not seen yet (remembered on this device). */
const KEY = "garage.whatsNew.seen";
export function lastSeenWhatsNew(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function unseenWhatsNew(): number {
  const seen = lastSeenWhatsNew();
  if (!seen) return Math.min(WHATS_NEW.length, 3);
  return WHATS_NEW.filter((e) => e.date > seen).length;
}
export function markWhatsNewSeen() {
  try { localStorage.setItem(KEY, WHATS_NEW[0]?.date || ""); window.dispatchEvent(new Event("dash-whats-new-seen")); } catch { /* storage off */ }
}
