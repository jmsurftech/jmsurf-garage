/** Help centre articles: every part of JMSURF Garage, with a link to the screen it is about. */
export type HelpArticle = { q: string; a: string[]; to?: string };
export type HelpTopic = { id: string; title: string; icon: string; articles: HelpArticle[] };

export const HELP_TOPICS: HelpTopic[] = [
  { id: "start", title: "Getting started", icon: "Rocket", articles: [
    { q: "What should I set up first?", to: "/dashboard", a: ["The dashboard shows 'Set up your dashboard' with the steps: company details and logo, bring your data, switch on your apps, invite your team, get paid by M-Pesa and send your first invoice.", "Each step opens the right screen and ticks itself off when done."] },
    { q: "How do I move around the system?", a: ["The menu on the left groups everything by area. Star any page (the star appears when you point at it) to pin it under Favourites at the top.", "Press Ctrl+K anywhere for Quick find: pages, customers, items and documents.", "Choose another menu layout in your profile menu or System → Theme: one sidebar, two sidebars (apps on the left, pages beside them), a top menu or a bottom dock."] },
    { q: "Where are the settings?", to: "/settings", a: ["Press System at the bottom of the menu. Settings open as a page of their own with their own menu (search it at the top); press Close to go back to where you were."] },
    { q: "Can I use only one app, like CRM?", to: "/modules", a: ["Yes. Sign up from the app's 'Use only…' button on the website, or open Modules and choose 'Use on its own'. The menu then shows only that app (and any other you switch on). 'Show the full suite' brings everything back."] },
    { q: "Is there a demo I can try?", a: ["Yes: 'Try the live demo' on the website opens a sample company with data. Anything you change there is put back every night and nothing is sent to anyone."] },
  ] },
  { id: "dashboard", title: "Dashboard & reports", icon: "LayoutDashboard", articles: [
    { q: "What does the dashboard show?", to: "/dashboard", a: ["Sales with the change against the period before, gross profit, what customers owe you and what you owe, then orders, stock value, approvals and low stock.", "'Needs attention' lists overdue invoices, bills due this week, approvals waiting and items to reorder. Below are charts you can filter by category, item, rep and customer."] },
    { q: "Where are the reports?", to: "/reports", a: ["Reports has sales, profit, stock, debtors and creditors, tax (VAT), payroll and accounting statements (profit and loss, balance sheet, trial balance, cash flow). Every report can be filtered by date and branch and exported."] },
  ] },
  { id: "sales", title: "Sales & invoicing", icon: "Receipt", articles: [
    { q: "How do I send a quote and turn it into an invoice?", to: "/sales/quotes", a: ["Sales → Quotes → New. Add the customer and items, then Send (email, WhatsApp or PDF).", "When the customer agrees, press Convert to Sales Order or Convert to Invoice: nothing is typed twice."] },
    { q: "How do I invoice and get paid by M-Pesa?", to: "/sales/invoices", a: ["Create the invoice and press M-Pesa prompt: the customer gets a PIN prompt on their phone and the payment is recorded by itself.", "You can also Record Payment (cash, bank, card, cheque) or let the customer pay from the link in the invoice email."] },
    { q: "How do I push an invoice to KRA eTIMS?", to: "/settings?tab=etims", a: ["Connect eTIMS once in System → KRA eTIMS. Then press Push to eTIMS on any sent invoice or credit note.", "When KRA signs it, the button turns into 'Pushed to eTIMS' with the KRA receipt number and the QR code prints on the invoice. If KRA refuses, the button shows the reason and Retry."] },
    { q: "Recurring invoices, credit notes and statements", to: "/sales/recurring", a: ["Recurring invoices are created and sent on schedule. Credit notes reduce what a customer owes or refund them. Customer statements can be emailed on the dates you choose (System → Customer statements)."] },
    { q: "How do approvals work on sales documents?", to: "/approvals", a: ["Switch approval on per document type in System → Approvals and set stages: who approves first, then who, and whether any one or all of them must approve. The sender is told at every stage."] },
  ] },
  { id: "pos", title: "Point of Sale", icon: "ShoppingCart", articles: [
    { q: "How do I make a sale at the till?", to: "/pos", a: ["Tap products or scan barcodes, then Charge. Choose cash, M-Pesa, card, credit or split. The receipt prints or goes by WhatsApp/SMS."] },
    { q: "Can I sell offline?", a: ["Yes. Sales made offline are kept on the device and sent when the connection returns. M-Pesa prompts need a connection."] },
    { q: "Where are receipt and barcode settings?", to: "/settings?tab=pos", a: ["System → Point of Sale holds the till, receipt and barcode/label settings. Receipt layouts are also under System → Documents → Till receipts."] },
    { q: "Refunds, layaways and cash-up", a: ["Sales → Returns & Refunds puts money back and stock back. Layaway takes part payments. Close the shift to count cash and see differences."] },
  ] },
  { id: "purchases", title: "Purchases & supply chain", icon: "Truck", articles: [
    { q: "Purchase orders and receiving stock", to: "/purchases/orders", a: ["Create a purchase order, send it, then Receive when goods arrive (part deliveries are fine). Enter batch numbers and expiry dates on receipt for items that need them."] },
    { q: "Requests for quotation (RFQ)", to: "/purchases/rfqs", a: ["Send one RFQ to several suppliers, enter their prices, compare side by side and award: the winning quote becomes a purchase order."] },
    { q: "Landed costs", to: "/purchases/landed-costs", a: ["Spread freight, duty and clearing over the items of a receipt (by value, quantity or weight) so the item cost is right."] },
    { q: "Bills, supplier payments and expenses", to: "/purchases/bills", a: ["Record supplier bills, pay them (fully or partly) and track what you owe. Expenses record money spent with receipts attached. Reorder suggestions turn into draft POs."] },
  ] },
  { id: "stock", title: "Inventory & warehouse", icon: "Package", articles: [
    { q: "Items, variants, composites and price lists", to: "/inventory/products", a: ["Add items with price, cost, tax and reorder level. Item groups hold sizes/colours. Composite items are kits sold as one. Price lists give customers or branches their own prices."] },
    { q: "Batches and expiry (FEFO)", to: "/inventory/batches", a: ["Items with batches take stock out earliest-expiry first. Batches & Expiry shows what expires soon."] },
    { q: "Warehouses, bins and transfers", to: "/warehouse/locations", a: ["Set up warehouses and branches with bins. Transfer Orders move stock between them: shipped stock is 'in transit' until received."] },
    { q: "Packages, shipments and delivery notes", to: "/warehouse/packages", a: ["Pack what a sales order or invoice asks for, batch by batch, then Ship it: a delivery note is created with items, quantities, batches and expiry dates, never prices.", "If you prefer stock to leave when goods ship (not when the invoice is sent), switch it in System → Inventory."] },
    { q: "Stock-take and adjustments", to: "/inventory/stock-take", a: ["Count a branch or category, save as you go and finish to correct stock by the difference. Adjustments record damages, losses and found stock with a reason."] },
    { q: "Samples at no charge", to: "/sales/samples", a: ["Issue samples to customers or prospects at zero value: stock goes out, the cost goes to Samples & promotions, and you can follow up or invoice later."] },
  ] },
  { id: "branches", title: "Branches", icon: "Building2", articles: [
    { q: "How do branches work?", to: "/branches", a: ["Each branch keeps its own sales, purchases, expenses and stock. Assign people to a branch (one can be the manager); their new documents belong to it. Switch the branch you are looking at in the top bar."] },
  ] },
  { id: "accounting", title: "Accounting & banking", icon: "Landmark", articles: [
    { q: "Do I need to post journals?", to: "/accounting", a: ["No. Sales, payments, purchases, expenses, payroll and stock post to the books automatically. Manual journals are there for adjustments."] },
    { q: "Bank reconciliation and transaction locking", a: ["Import or match bank statements against payments. Lock a period (System → Transaction locking) once it is closed so nothing changes it."] },
    { q: "Financial statements", to: "/accounting/statements", a: ["Profit and loss, balance sheet, trial balance and cash flow, by period and branch."] },
  ] },
  { id: "crm", title: "CRM & marketing", icon: "Handshake", articles: [
    { q: "Leads, pipeline and follow-ups", to: "/crm/leads", a: ["Add leads, move them through the pipeline, schedule follow-ups and convert them to customers and quotes. The salesperson is alerted when a lead is given to them or tagged."] },
    { q: "Campaigns: email, SMS, WhatsApp and social", to: "/marketing/sms", a: ["Marketing sends email and SMS campaigns, WhatsApp messages and social posts, with automation journeys and surveys."] },
  ] },
  { id: "hrm", title: "People & payroll", icon: "UserRoundCog", articles: [
    { q: "Employees, leave and attendance", to: "/hrm", a: ["Keep employee files and documents, approve leave (staff are told by bell, email or SMS), and track attendance."] },
    { q: "Payroll", to: "/hrm/payroll", a: ["Run payroll with Kenyan statutory deductions (PAYE, SHIF, NSSF, housing levy), print payslips and post to the books. Staff see their payslips under My profile."] },
    { q: "Recruitment and appraisals", a: ["HRM includes job openings and applicants, and performance appraisals."] },
  ] },
  { id: "work", title: "Projects, service & documents", icon: "FolderKanban", articles: [
    { q: "Projects and tasks", to: "/apps/projects", a: ["Plan projects with tasks, due dates and people; assignees are alerted and get a morning list of what is due."] },
    { q: "Helpdesk tickets", to: "/apps/helpdesk", a: ["Tickets from email, the website chat, calls or staff, with priorities, assignment and replies."] },
    { q: "Documents", to: "/documents", a: ["Documents shows files by module (customers, suppliers, employees, bills…), then by record. My folders holds your own folders. All files lists everything with expiry dates."] },
    { q: "Calendar and meetings", to: "/calendar", a: ["Invite colleagues to meetings; they are reminded before it starts (by bell, email, SMS or WhatsApp as your company chooses)."] },
  ] },
  { id: "callcentre", title: "Call Centre", icon: "Headset", articles: [
    { q: "Calling from DASH", a: ["With the Call Centre switched on, a phone button sits in the corner. It signs in with your DASH login, rings for incoming calls and dials any number; click-to-call on customers uses it too."] },
    { q: "Setting up the line", to: "/callcentre", a: ["In the Call Centre's Settings, connect your Africa's Talking voice number and paste the callback link. Add agents, phone menus and queues."] },
    { q: "Messages and billing", a: ["The Call Centre's Messages page holds SMS conversations with callers. Billing shows your plan and this month's minutes and cost: airtime is charged by Africa's Talking, the plan by JMSURF."] },
  ] },
  { id: "alerts", title: "Notifications & approvals", icon: "Bell", articles: [
    { q: "Choosing who is told and how", to: "/settings?tab=notifications", a: ["System → Notifications lists every event (approvals, quotes, payments, leads, tasks, meetings, tickets, leave) with bell, email, SMS and WhatsApp for each. Quiet hours hold SMS and WhatsApp at night."] },
    { q: "Customer reminders", to: "/settings?tab=alerts", a: ["Debt reminders (before and after the due date) and repeat-purchase reminders go to customers by SMS and email."] },
  ] },
  { id: "ai", title: "Garage AI", icon: "Sparkles", articles: [
    { q: "What can Garage AI do?", to: "/ai", a: ["Ask about your business in plain words (sales, debtors, stock) by typing or speaking, and let it draft invoices, reminders and tasks, always with your confirmation. Open it from the sparkle button in the top bar."] },
  ] },
  { id: "website", title: "Website & online shop", icon: "Globe", articles: [
    { q: "Your website and shop", to: "/settings?tab=shop", a: ["Publish a website and online shop on your own address. Items marked 'Show on online shop' (when eCommerce is on) are listed for sale; orders and payments come into DASH."] },
    { q: "Customer portal", to: "/settings?tab=portal", a: ["Customers sign in to see invoices and statements and pay online."] },
  ] },
  { id: "data", title: "Data, import & backups", icon: "DatabaseBackup", articles: [
    { q: "Bringing data from another system", to: "/migrate", a: ["System → Move in connects your previous cloud books, Odoo or QuickBooks Online and brings accounts, customers, vendors, items, documents, payments, journals, leads and employees. You can also upload export files."] },
    { q: "Backups and restore", to: "/settings?tab=backup", a: ["Backups run on the schedule you choose (and on demand), for every module or the ones you pick. Download any backup, copy each one to your own storage (Cloudflare R2, Amazon S3 and others) and restore everything or one module."] },
  ] },
  { id: "settings", title: "Settings & connections", icon: "Settings", articles: [
    { q: "Email", to: "/settings?tab=smtp", a: ["Send from JMSURF's mail server (no set-up) or your own provider (Google Workspace, Microsoft 365, your host, SES, SendGrid and more). Set where replies go and send yourself copies."] },
    { q: "SMS and WhatsApp gateways", to: "/settings?tab=sms", a: ["JMSURF SMS is the default. You can use your own Africa's Talking, Twilio, Infobip, Advanta, Celcom Africa or SendBulkSMS account instead, and WhatsApp through APIWAP."] },
    { q: "Payment gateways", to: "/settings?tab=payments", a: ["Take M-Pesa (Till, Paybill or bank) through JMSURF Pay or Paystack, plus cards and mobile money for other countries."] },
    { q: "Documents and templates", to: "/settings/documents", a: ["Choose the layout, colours, columns and fields of invoices, quotes, delivery notes and receipts."] },
    { q: "Theme and appearance", to: "/settings?tab=theme", a: ["Light, dark or follow the device, almost thirty colour themes or your own colour, sidebar style, corners and text size."] },
  ] },
  { id: "billing", title: "Plans & billing", icon: "CreditCard", articles: [
    { q: "How am I billed?", to: "/billing", a: ["Your plan plus any apps you switch on (each free for 14 days). Pay by M-Pesa in Kenya. Companies in other countries see prices in US dollars (with their own currency alongside) and pay by card."] },
  ] },
  { id: "security", title: "Security & your account", icon: "ShieldCheck", articles: [
    { q: "Two-step sign-in, password and devices", to: "/profile", a: ["My profile lets you change your password, turn on two-step sign-in with an authenticator app, and sign out other devices."] },
    { q: "Staff, roles and what they can see", to: "/staff", a: ["Invite staff, give each a role and fine-tune permissions. The audit log records who did what."] },
    { q: "Is my data safe?", a: ["Each company's data is separate, connections are encrypted, and data is backed up and copied to a second data centre."] },
  ] },
  { id: "mobile", title: "Phone & offline", icon: "Smartphone", articles: [
    { q: "Using DASH on a phone", a: ["Everything works on a phone: the bottom bar has the main pages and Menu opens everything else. Install it as an app from the browser menu (Add to Home screen)."] },
  ] },
];
