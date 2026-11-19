import {
  BookOpen, Package, Handshake, UserRoundCog, FolderKanban, Wallet, Factory, ShoppingCart, Globe, FileSignature,
  LifeBuoy, Megaphone, Sparkles, Blocks, Landmark, Headset, BookMarked, Repeat, KeyRound, Star, Leaf, Briefcase,
  Truck, ShieldCheck, Wrench, DoorOpen, Layers, Cpu, UserPlus, CalendarRange, Mail, MessageSquare, Share2, Ticket, ClipboardList,
  MessagesSquare, CalendarClock, Hammer, Newspaper, Users, GraduationCap, Table, FileText, BarChart3, Store, Gift,
  type LucideIcon,
} from "lucide-react";

/**
 * JMSURF Garage suites.
 *
 * JMSURF BOOKS (accounting, sales, purchases, items, banking, reports,
 * documents, approvals, team chat) is the base every company gets. Everything
 * else is a suite the company switches on in System → Modules; it then appears
 * in the sidebar with all of its apps. Prices (KES per company per month) are
 * defaults: the platform owner changes them in the super admin
 * (platform_modules), which wins at runtime. Prices are shown in the app only.
 *
 * Older single-app keys (helpdesk, recruitment, social…) still name the apps
 * inside a suite: suiteOf() maps them, here and in the database (module_of).
 */
export type ModuleCategory = "Finance" | "Sales & Marketing" | "Operations" | "People" | "Services" | "Digital" | "Productivity";

export interface SuiteApp {
  key: string;
  name: string;
  home: string;
  icon: LucideIcon;
  /** One line on what the app does. */
  desc: string;
}

export interface ModuleDef {
  key: string;
  /** Product name shown in the app store. */
  name: string;
  category: ModuleCategory;
  tagline: string;
  /** A full paragraph for the app store and the website. */
  description: string;
  /** What is in the suite. */
  apps: SuiteApp[];
  features: string[];
  /** Default monthly price in KES (0 = included). */
  price: number;
  /** Part of JMSURF BOOKS: always on. */
  included?: boolean;
  icon: LucideIcon;
  /** Tile colour. */
  color: string;
  /** Where "Open" goes. */
  home: string;
}

export const MODULE_CATEGORIES: ModuleCategory[] = ["Finance", "Sales & Marketing", "Operations", "People", "Services", "Digital", "Productivity"];

const a = (key: string, name: string, home: string, icon: LucideIcon, desc: string): SuiteApp => ({ key, name, home, icon, desc });

export const MODULES: ModuleDef[] = [
  // ── Finance ─────────────────────────────────────────────────────────────
  { key: "books", name: "JMSURF BOOKS", category: "Finance", included: true, price: 0, icon: BookOpen, color: "#a8121b", home: "/dashboard",
    tagline: "Accounting, invoicing, purchases, banking and reports: the heart of every company.",
    description: "Double-entry accounting that runs itself. Every quote, sales order, invoice, payment, bill, expense, stock movement and payroll run posts to the ledger automatically, so the trial balance, profit and loss and balance sheet are always current. Customers pay invoices by M-Pesa, card or bank from a link; KRA eTIMS signs invoices; VAT, withholding and multi-currency are built in. Documents, approvals and team chat come with it.",
    apps: [
      a("sales", "Sales", "/sales/invoices", FileText, "Quotes, sales orders, invoices, recurring invoices, payments, credit notes, receivables."),
      a("purchases", "Purchases", "/purchases/bills", Wallet, "Vendors, purchase orders, receives, bills, payments made, vendor credits, expenses."),
      a("banking", "Banking", "/accounting/banking", Landmark, "Bank and M-Pesa statement import, matching rules and reconciliation."),
      a("accountant", "Accountant", "/accounting/chart-of-accounts", BookMarked, "Chart of accounts, manual journals, budgets, opening balances, transaction locking."),
      a("reports", "Reports", "/reports", BarChart3, "Profit and loss, balance sheet, cash flow, aged receivables and payables, VAT, 50+ reports."),
      a("documents", "Documents", "/documents", FileText, "Every file in one place, linked to its customer, vendor or document."),
      a("approvals", "Approvals", "/approvals", ShieldCheck, "Approval rules for quotes, invoices, bills, expenses and purchases."),
      a("discuss", "Team chat", "/apps/discuss", MessagesSquare, "Channels and direct messages for the whole company."),
    ],
    features: ["Automatic double-entry ledger", "Quotes → sales orders → invoices → payments", "M-Pesa, card and bank payment links", "KRA eTIMS signing and VAT returns", "Bills, purchase orders and vendor credits", "Bank statement import and reconciliation", "Multi-currency and multi-branch", "50+ financial and management reports", "Customer portal with statements"] },

  { key: "finance_plus", name: "JMSURF FINANCE+", category: "Finance", price: 1500, icon: Landmark, color: "#7c2d12", home: "/apps/fixed_assets",
    tagline: "Fixed assets, subscription billing, ESG reporting and practice management for accountants.",
    description: "Everything a finance team adds on top of the books. Keep an asset register with straight-line or reducing-balance depreciation posted every month. Bill customers on recurring plans with automatic renewals and dunning. Measure emissions, energy, water and social metrics for ESG and sustainability reports. Accounting firms run their whole practice here: every client company, engagement, deadline and task in one dashboard.",
    apps: [
      a("fixed_assets", "Fixed Assets", "/apps/fixed_assets", Landmark, "Asset register, depreciation schedules, revaluation and disposals."),
      a("subscriptions", "Subscription Billing", "/apps/subscriptions", Repeat, "Plans, renewals, proration, dunning and automatic invoices."),
      a("esg", "ESG & Sustainability", "/apps/esg", Leaf, "Emissions, energy, water, waste and social metrics with targets."),
      a("practice", "Accountant Practice", "/apps/practice", Briefcase, "Client engagements, statutory deadlines and work papers for firms."),
    ],
    features: ["Monthly depreciation posted to the ledger", "Asset disposal with gain or loss", "Recurring plans with trials and proration", "Failed-payment retries and reminders", "Scope 1, 2 and 3 emissions tracking", "Targets and progress dashboards", "Client engagements and KRA deadlines", "One view across every client company"] },

  { key: "expense", name: "JMSURF EXPENSE", category: "Finance", price: 800, icon: Wallet, color: "#9a3412", home: "/apps/expense",
    tagline: "Expense claims, trips, mileage and advances with approvals and M-Pesa reimbursement.",
    description: "Staff snap a receipt, claim mileage or per diem and submit from their phone. Managers approve in one tap with policy limits checked automatically, finance reimburses by M-Pesa or bank and every approved claim posts to the right expense account and cost centre. Travel requests, cash advances and their settlement are tracked against each trip.",
    apps: [
      a("expense", "Expense Claims", "/apps/expense", Wallet, "Receipts, mileage, per diem and claims with multi-level approval."),
    ],
    features: ["Receipt capture on phone", "Mileage and per-diem rates", "Policy limits per category and grade", "Multi-level approvals", "Cash advances and settlement", "Trips and travel requests", "Reimburse by M-Pesa or bank", "Posts to the ledger by cost centre"] },

  // ── Sales & Marketing ───────────────────────────────────────────────────
  { key: "crm", name: "JMSURF CRM", category: "Sales & Marketing", price: 1500, icon: Handshake, color: "#1d4ed8", home: "/crm",
    tagline: "Leads, deals, pipeline, activities and forecasts, connected to quotes and invoices.",
    description: "Capture leads from your website, WhatsApp, calls and imports, score them and move deals through a visual pipeline. Every call, email, meeting and task sits on the contact's timeline, and a deal becomes a quote, sales order and invoice without retyping. Forecasts, win/loss analysis and salesperson targets show where revenue is coming from.",
    apps: [
      a("pipeline", "Pipeline & Deals", "/crm", Handshake, "Kanban pipeline with stages, probabilities and expected revenue."),
      a("leads", "Leads", "/crm/leads", UserPlus, "Capture, score, assign and convert leads."),
      a("activities", "Activities", "/crm/activities", CalendarClock, "Calls, meetings, emails and tasks on every contact."),
      a("forecast", "Forecast & Analysis", "/crm/forecast", BarChart3, "Revenue forecast, win rates and pipeline analysis."),
    ],
    features: ["Visual pipeline with drag and drop", "Lead capture from web forms and WhatsApp", "Lead scoring and round-robin assignment", "Deal to quote to invoice in one click", "Activity timeline per contact", "Targets and commissions per salesperson", "Forecast and win/loss analysis", "Duplicate detection and merge"] },

  { key: "marketing", name: "JMSURF MARKETING", category: "Sales & Marketing", price: 2000, icon: Megaphone, color: "#c026d3", home: "/apps/marketing_automation",
    tagline: "Email, SMS, WhatsApp and social media campaigns, automation journeys, events and surveys in one suite.",
    description: "Plan and run every campaign from one place. Design emails with your brand and send them to segments built from CRM and sales data, send bulk SMS and WhatsApp messages, and schedule posts to Facebook, Instagram, LinkedIn and X. Automation journeys react to what people do: a welcome series, a reminder when an invoice is due, a win-back offer. Run events with ticket sales paid by M-Pesa, and collect feedback with surveys and forms. Opens, clicks, replies, registrations and revenue are reported per campaign.",
    apps: [
      a("marketing_automation", "Automation Journeys", "/apps/marketing_automation", Sparkles, "Triggers, waits, conditions and actions across every channel."),
      a("email_marketing", "Email Campaigns", "/apps/email_marketing", Mail, "Branded emails to segments with open and click tracking."),
      a("sms_marketing", "SMS & WhatsApp", "/marketing/sms", MessageSquare, "Bulk and personalised SMS and WhatsApp messages."),
      a("social", "Social Media", "/apps/social", Share2, "Schedule and publish to Facebook, Instagram, LinkedIn and X."),
      a("events", "Events & Tickets", "/apps/events", Ticket, "Event pages, ticket sales by M-Pesa, check-in."),
      a("surveys", "Surveys & Forms", "/apps/surveys", ClipboardList, "Feedback, registration and lead forms with reports."),
    ],
    features: ["Segments from CRM, sales and portal data", "Drag-and-drop email designer", "Bulk SMS and WhatsApp with personalisation", "Scheduled social posting", "Automation journeys with conditions", "Unsubscribe handling and consent", "Event ticketing with M-Pesa checkout", "Surveys and forms that create leads", "Campaign revenue attribution"] },

  { key: "commerce", name: "JMSURF COMMERCE", category: "Sales & Marketing", price: 2000, icon: ShoppingCart, color: "#0f766e", home: "/pos",
    tagline: "Point of sale, online store, rentals and loyalty, all on the same stock and books.",
    description: "Sell everywhere from one catalogue. The point of sale works on any tablet or PC, online or offline, with M-Pesa, card and cash. Your online store runs on your own domain with live stock and checkout. Rent out equipment, vehicles or venues with deposits, return checks and late fees. Reward customers with points, gift cards and vouchers that work in the shop and online.",
    apps: [
      a("pos", "Point of Sale", "/pos", ShoppingCart, "Fast till with barcode, receipts, M-Pesa, card and cash, offline mode."),
      a("ecommerce", "Online Store", "/sales/online-orders", Store, "Your shop on your domain with live stock, checkout and delivery."),
      a("rental", "Rental", "/apps/rental", KeyRound, "Bookings, deposits, pick-up and return, late fees."),
      a("repairs", "Repairs", "/apps/repairs", Wrench, "Workshop job cards: intake with condition and signature, diagnosis, parts, estimate, ready-for-collection SMS, warranty."),
      a("loyalty", "Loyalty & Gift Cards", "/apps/loyalty", Gift, "Points, rewards, gift cards and vouchers."),
    ],
    features: ["Works offline and syncs when back", "M-Pesa STK, card and cash", "Shifts, cash-up and Z-reports", "Online store with your domain", "Delivery zones and order tracking", "Rental calendar with deposits", "Points, tiers and gift cards", "One stock across shop, web and warehouse"] },

  // ── Operations ──────────────────────────────────────────────────────────
  { key: "inventory", name: "JMSURF INVENTORY", category: "Operations", price: 1500, icon: Package, color: "#0369a1", home: "/inventory/stock",
    tagline: "Warehouses, transfers, batches, serials, composite items, deliveries and fleet.",
    description: "Know exactly what you have and where. Track stock across warehouses and branches with transfer orders, batches and expiry dates, serial numbers and stock-takes. Build composite items and kits that consume components when sold. Pick, pack and ship with packages and delivery notes, and run your own vehicles: drivers, fuel, insurance, service costs and trips.",
    apps: [
      a("stock", "Stock & Warehouses", "/inventory/stock", Package, "Stock on hand per warehouse, reorder levels and valuation."),
      a("transfers", "Transfers & Batches", "/inventory/transfer", Truck, "Transfer orders, batches, expiry and serial numbers."),
      a("shipments", "Packages & Shipments", "/sales/delivery-notes", Truck, "Picking, packing, delivery notes and proof of delivery."),
      a("fleet", "Fleet", "/apps/fleet", Truck, "Vehicles, drivers, fuel, insurance and service costs."),
    ],
    features: ["Multi-warehouse stock", "Transfer orders between branches", "Batches, expiry and serial numbers", "Composite items and kits", "FIFO or average costing", "Reorder alerts and purchase suggestions", "Stock-takes with variance posting", "Fleet costs per vehicle"] },

  { key: "manufacturing", name: "JMSURF MANUFACTURING", category: "Operations", price: 3000, icon: Factory, color: "#b45309", home: "/apps/manufacturing",
    tagline: "Bills of materials, production, quality, maintenance, engineering changes and connected devices.",
    description: "Plan and run production end to end. Bills of materials and routings define how products are made; manufacturing orders consume components, add labour and overheads and put finished goods into stock at their true cost. Quality checks stop bad batches, maintenance keeps machines running, engineering change orders version every product, and IoT devices (scales, meters, sensors) feed readings straight into the system.",
    apps: [
      a("manufacturing", "Production", "/apps/manufacturing", Factory, "Bills of materials, manufacturing orders, work centres, scrap."),
      a("quality", "Quality", "/apps/quality", ShieldCheck, "Quality checks, alerts and non-conformance."),
      a("maintenance", "Maintenance", "/apps/maintenance", Wrench, "Equipment register, preventive and corrective maintenance."),
      a("plm", "Engineering Changes (PLM)", "/apps/plm", Layers, "Change orders, approvals and product versions."),
      a("iot", "Devices (IoT)", "/apps/iot", Cpu, "Connect scales, meters and sensors; alerts on readings."),
    ],
    features: ["Multi-level bills of materials", "Production consumes stock and posts cost", "Work centres and capacity", "Scrap and by-products", "Quality checkpoints per step", "Preventive maintenance schedules", "Engineering change approvals", "Device readings with thresholds and alerts"] },

  // ── People ──────────────────────────────────────────────────────────────
  { key: "hrm", name: "JMSURF HRM", category: "People", price: 2500, icon: UserRoundCog, color: "#047857", home: "/hrm",
    tagline: "Employees, attendance, time off, Kenyan payroll, recruitment, appraisals and shift planning.",
    description: "The whole employee journey in one suite. Recruit with job posts and an applicant pipeline, onboard into a complete employee file, track attendance and time off, and run payroll with PAYE, NSSF, SHIF, Housing Levy and NITA calculated and posted to the books, with payslips sent by email and SMS. Appraisals with goals and 360° feedback, shift planning and loans and advances complete it.",
    apps: [
      a("employees", "Employees", "/hrm/employees", Users, "Employee files, contracts, documents and departments."),
      a("attendance", "Attendance & Time Off", "/hrm/attendance", CalendarClock, "Clock-in, leave types, balances and approvals."),
      a("payroll", "Payroll", "/hrm/payroll", Wallet, "Kenyan statutory payroll, payslips, P9 and bank/M-Pesa files."),
      a("recruitment", "Recruitment", "/apps/recruitment", UserPlus, "Job posts, applicants, interviews and offers."),
      a("appraisals", "Appraisals", "/apps/appraisals", Star, "Goals, reviews and 360° feedback."),
      a("planning", "Shift Planning", "/apps/planning", CalendarRange, "Rosters and shifts by team and location."),
    ],
    features: ["PAYE, NSSF, SHIF, Housing Levy, NITA", "Payslips by email and SMS", "Payroll posts to the ledger", "Leave policies and balances", "Recruitment pipeline to employee in one click", "Goals and appraisal cycles", "Shift rosters", "Loans and salary advances"] },

  // ── Services ────────────────────────────────────────────────────────────
  { key: "projects", name: "JMSURF PROJECTS", category: "Services", price: 1200, icon: FolderKanban, color: "#4338ca", home: "/apps/projects",
    tagline: "Projects, tasks, milestones, timesheets and project billing.",
    description: "Plan work with projects, milestones and tasks on boards, lists or calendars. Teams log time against tasks, costs are captured as they happen, and billable hours and expenses become an invoice in one click. Budgets against actuals show which projects make money.",
    apps: [
      a("projects", "Projects & Tasks", "/apps/projects", FolderKanban, "Projects, milestones and tasks on boards, lists and calendars."),
      a("timesheets", "Timesheets", "/apps/projects/timesheet", CalendarClock, "Time entries by person, task and project."),
    ],
    features: ["Kanban, list and calendar views", "Milestones and dependencies", "Timesheets with billable rates", "Project costs and budgets", "Invoice time and expenses in one click", "Profitability per project", "Client access through the portal"] },

  { key: "service", name: "JMSURF SERVICE", category: "Services", price: 1800, icon: LifeBuoy, color: "#0e7490", home: "/apps/helpdesk",
    tagline: "Helpdesk tickets from email, website live chat, field service and online appointment booking.",
    description: "Look after customers on every channel. Emails to your support address become tickets automatically with SLAs and assignment, and the live-chat bubble on your website lands in the same inbox. Dispatch technicians to jobs with checklists, signatures and parts used, and let customers book appointments online from a public page with SMS confirmations.",
    apps: [
      a("helpdesk", "Helpdesk", "/apps/helpdesk", LifeBuoy, "Tickets from email and portal with SLAs and replies."),
      a("live_chat", "Live Chat", "/apps/live_chat", MessagesSquare, "Chat bubble for your website, answered from DASH."),
      a("field_service", "Field Service", "/apps/field_service", Hammer, "Jobs, technicians, checklists, signatures and parts."),
      a("appointments", "Appointments", "/apps/appointments", CalendarClock, "Public booking page with SMS confirmations."),
      a("frontdesk", "Front Desk", "/apps/frontdesk", DoorOpen, "Visitor sign-in and sign-out, hosts told on arrival, badges, ID and signatures."),
    ],
    features: ["Email-to-ticket from your own mailbox", "Replies from DASH by email", "SLA targets and escalation", "Website live-chat widget", "Technician job cards with signature", "Parts used deduct stock and bill the customer", "Online booking page", "SMS reminders before appointments"] },

  { key: "contracts", name: "JMSURF SIGN & CONTRACTS", category: "Services", price: 1200, icon: FileSignature, color: "#6d28d9", home: "/contracts",
    tagline: "Contract lifecycle and legally binding electronic signatures.",
    description: "Draft contracts from templates, route them for approval, send for signature and track every renewal and obligation. Signers sign on any phone from a link, with an audit trail of who signed, when and from where. Signed documents are stored against the customer, vendor or employee.",
    apps: [
      a("contracts", "Contracts", "/contracts", FileText, "Draft from templates, sign and stamp, online signing, renewals, breaches and amendments."),
      a("sign", "Sign", "/apps/sign", FileSignature, "Send documents for e-signature with an audit trail."),
    ],
    features: ["Contract templates", "Approval routing", "Renewal and expiry alerts", "Signature on any phone", "Audit trail per signature", "Signed copies stored automatically"] },

  { key: "callcentre", name: "JMSURF CALL CENTRE", category: "Services", price: 2500, icon: Headset, color: "#be123c", home: "/callcentre",
    tagline: "Cloud call centre with IVR, queues, browser phones and call recording, linked to every customer.",
    description: "A complete cloud call centre that runs at jmsurfcallcentre.co.ke and works inside DASH. Incoming calls go through your IVR menu into queues, agents answer in the browser, and the caller's account (balance, open invoices, tickets, deals) pops up on screen. Click any phone number in DASH to call, every call is logged on the customer with its recording, and missed calls turn into callbacks or tickets.",
    apps: [
      a("callcentre", "Call Centre", "/callcentre", Headset, "Calls, recordings, queues and agents, connected to DASH."),
    ],
    features: ["IVR menus and business hours", "Queues with ring strategies", "Browser phone for agents", "Caller screen-pop from DASH", "Click-to-call anywhere in DASH", "Call recording and notes", "Missed calls become callbacks or tickets", "Live wallboard and agent reports"] },

  // ── Digital ─────────────────────────────────────────────────────────────
  { key: "website", name: "JMSURF SITES", category: "Digital", price: 1200, icon: Globe, color: "#2563eb", home: "/settings?tab=website",
    tagline: "Website, blog, community forum and online courses on your own domain.",
    description: "Publish a fast website for your company on your own domain, with your products, services and contact forms connected to CRM. Write a blog, run a community forum, and sell or share online courses with lessons, quizzes and progress tracking for customers or staff.",
    apps: [
      a("website", "Website", "/settings?tab=website", Globe, "Pages, products and forms on your own domain."),
      a("blog", "Blog", "/apps/blog", Newspaper, "Posts with SEO settings."),
      a("forum", "Forum", "/apps/forum", Users, "Questions, answers and community."),
      a("elearning", "eLearning", "/apps/elearning", GraduationCap, "Courses, lessons, quizzes and progress."),
    ],
    features: ["Your own domain with SSL", "SEO and social previews", "Forms that create leads", "Blog with categories", "Community forum", "Courses with a lesson player and progress"] },

  // ── Productivity ────────────────────────────────────────────────────────
  { key: "workplace", name: "JMSURF WORKPLACE", category: "Productivity", price: 600, icon: BookMarked, color: "#475569", home: "/apps/knowledge",
    tagline: "Company knowledge base and spreadsheets next to your data.",
    description: "Write down how your company works: procedures, policies and guides in a searchable knowledge base, and keep working sheets next to the data they describe.",
    apps: [
      a("knowledge", "Knowledge", "/apps/knowledge", BookMarked, "Articles, procedures and policies."),
      a("spreadsheets", "Spreadsheets", "/apps/spreadsheets", Table, "Sheets for planning and analysis."),
    ],
    features: ["Searchable knowledge base", "Article categories and owners", "Spreadsheets with formulas", "Shared with the right teams"] },

  { key: "ai", name: "Garage AI", category: "Productivity", price: 1900, icon: Sparkles, color: "#a8121b", home: "/ai",
    tagline: "Your AI business assistant and analytics: ask, analyse and act by chat or voice.",
    description: "Ask about your business in plain language, by typing or speaking: who owes you the most, which products are slowing down, what changed in profit this month. Garage AI reads your company's data with your own access rights, explains the numbers, drafts invoices, reminders and emails, and only acts after you confirm. Analytics dashboards and trends come with it.",
    apps: [
      a("ai", "Garage AI", "/ai", Sparkles, "Chat and voice assistant over your company data."),
      a("analytics", "Analytics", "/reports", BarChart3, "Dashboards, trends and KPIs."),
    ],
    features: ["Answers from your live data", "Voice in and out", "Respects each person's access rights", "Drafts documents and messages", "Acts only after you confirm", "Trend and anomaly explanations"] },

  { key: "studio", name: "JMSURF STUDIO", category: "Productivity", price: 2500, icon: Blocks, color: "#a8121b", home: "/apps/studio",
    tagline: "Build your own apps, fields and workflows without code.",
    description: "When your business needs something no one else has, build it. Create apps with your own record types, fields, statuses and views, and they appear in the sidebar for your team with the same permissions, history and search as everything else.",
    apps: [a("studio", "Studio", "/apps/studio", Blocks, "Custom apps, fields, statuses and views.")],
    features: ["Custom apps and record types", "Custom fields and statuses", "Kanban, list and calendar views", "Numbering and history", "Same permissions as the rest of DASH"] },
];

export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** App key (or old single-app module key) → the suite that sells it. Keep in sync with public.module_of(). */
const SUITE_OF: Record<string, string> = Object.fromEntries(MODULES.flatMap((m) => m.apps.map((x) => [x.key, m.key])));
Object.assign(SUITE_OF, { voip: "callcentre", documents: "books", approvals: "books", discuss: "books", pos: "commerce", ecommerce: "commerce" });
MODULES.forEach((m) => { SUITE_OF[m.key] = m.key; });
export const suiteOf = (key: string) => SUITE_OF[key] || key;
/** The suite for any app or module key. */
export const moduleFor = (key: string): ModuleDef | undefined => MODULE_BY_KEY[suiteOf(key)];
/** Display name of an app inside a suite (or the suite itself). */
export const appName = (key: string) => {
  for (const m of MODULES) { const x = m.apps.find((p) => p.key === key); if (x) return x.name; }
  return MODULE_BY_KEY[key]?.name || key;
};

/** Price of the all-suites bundle, KES per month. */
export const ALL_IN_ONE_PRICE = 15000;

export const moduleName = (key: string) => moduleFor(key)?.name || key;
