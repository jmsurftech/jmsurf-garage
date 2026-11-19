import {
  BookOpen, Package, Handshake, UserRoundCog, FolderKanban, Wallet, Factory, ShoppingCart, Globe, FileSignature,
  LifeBuoy, Megaphone, Sparkles, Blocks, Landmark, Headset, BookMarked, Repeat, KeyRound, Star, Leaf, Briefcase,
  Truck, ShieldCheck, Wrench, DoorOpen, Layers, Cpu, UserPlus, CalendarRange, Mail, MessageSquare, Share2, Ticket, ClipboardList,
  MessagesSquare, CalendarClock, Hammer, Newspaper, Users, GraduationCap, Table, FileText, BarChart3, Store, Gift,
  Car, CarFront, ClipboardCheck, Smartphone, Ship, SprayCan, Droplets, Disc, MessageCircle, Calculator, Scale, Gauge,
  type LucideIcon,
} from "lucide-react";

/**
 * JMSURF Garage modules.
 *
 * Garage Core (job cards, customers and vehicles, estimates, M-Pesa, eTIMS,
 * SMS, basic stock, owner dashboard, plus sales invoices, quotes, payments,
 * expenses, items and reports) is the base every garage gets. Everything else
 * is a module the garage switches on in System → Modules & billing; it then
 * appears in the menu. Prices (KES per garage per month) are defaults: the
 * platform owner changes them in the super admin (platform_modules), which
 * wins at runtime.
 *
 * Module keys are fixed: other parts of the system gate their screens with them.
 * Older app keys (helpdesk, recruitment, social…) still name the apps inside a
 * module: suiteOf() maps them, here and in the database (module_of).
 */
export type ModuleCategory = "Workshop" | "Parts & sales" | "Specialist" | "Finance & people" | "Customers & marketing" | "Extras";

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
  /** Product name shown in the module store. */
  name: string;
  category: ModuleCategory;
  tagline: string;
  /** A full paragraph for the module store and the website. */
  description: string;
  /** What is in the module. */
  apps: SuiteApp[];
  features: string[];
  /** Default monthly price in KES (0 = included). */
  price: number;
  /** Part of Garage Core: always on. */
  included?: boolean;
  /** Not offered to garages (kept for older companies, never shown in the store or on the website). */
  hidden?: boolean;
  /** A garage module: its screens and menu come from src/garage (not the generic Apps menu). */
  garage?: boolean;
  /** Plan codes that include this module at no extra cost (see src/lib/garagePlans.ts). */
  includedIn?: string[];
  icon: LucideIcon;
  /** Tile colour. */
  color: string;
  /** Where "Open" goes ("" = the module's first menu entry). */
  home: string;
}

export const MODULE_CATEGORIES: ModuleCategory[] = ["Workshop", "Parts & sales", "Specialist", "Finance & people", "Customers & marketing", "Extras"];

const a = (key: string, name: string, home: string, icon: LucideIcon, desc: string): SuiteApp => ({ key, name, home, icon, desc });

const BIZ = ["business", "pro"];
const PRO = ["pro"];

export const MODULES: ModuleDef[] = [
  // ── Core ────────────────────────────────────────────────────────────────
  { key: "garage_core", name: "Garage Core", category: "Workshop", included: true, price: 0, icon: Wrench, color: "#a8121b", home: "/dashboard",
    tagline: "Job cards, customers and vehicles, estimates, M-Pesa, eTIMS invoices and SMS: what every garage needs.",
    description: "Everything a garage needs from the first car of the day. Open a job card when a car comes in, record the customer and the vehicle, send an estimate the customer approves on their phone, and turn the finished job into a KRA eTIMS invoice. Customers pay by M-Pesa, the money is matched to the invoice, and SMS updates tell them when the car is ready. Basic stock, expenses, quotes and the owner's dashboard come with it.",
    apps: [
      a("garage_jobs", "Job cards", "/dashboard", ClipboardList, "Book in a car, record the work, parts and labour, and close the job."),
      a("garage_vehicles", "Customers & vehicles", "/customers", Car, "Every customer with their cars, plates, mileage and service history."),
      a("garage_estimates", "Estimates", "/sales/quotes", FileText, "Estimates the customer approves online from a link."),
      a("sales", "Invoices & payments", "/sales/invoices", FileText, "KRA eTIMS invoices, M-Pesa payments, receipts and what customers owe."),
      a("purchases", "Expenses & suppliers", "/purchases/expenses", Wallet, "Expenses, suppliers and bills."),
      a("reports", "Reports", "/reports", BarChart3, "Sales, jobs, profit, what is owed and what you owe."),
      a("documents", "Documents", "/documents", FileText, "Logbooks, photos and files linked to the customer or job."),
      a("approvals", "Approvals", "/approvals", ShieldCheck, "Approval rules for discounts, expenses and purchases."),
      a("discuss", "Team chat", "/apps/discuss", MessagesSquare, "Messages between the front desk, mechanics and the owner."),
    ],
    features: ["Job cards from check-in to collection", "Customers with their vehicles", "Estimates approved online", "M-Pesa payments matched to invoices", "KRA eTIMS invoices", "SMS when the car is ready", "Basic parts stock", "Owner's dashboard"] },

  // ── Workshop ────────────────────────────────────────────────────────────
  { key: "workshop_pro", name: "Workshop Pro", category: "Workshop", garage: true, price: 1000, includedIn: BIZ, icon: ClipboardCheck, color: "#b91c1c", home: "",
    tagline: "Inspections with photos, a live bay board and a phone app for mechanics.",
    description: "Run a busy workshop without shouting across the floor. Mechanics do digital inspections with photos and ticks on their phone, the customer sees them with the estimate, and the bay board shows every car, which bay it is in and who is working on it. Mechanics clock time on each job, so you know who is busy and how long jobs really take.",
    apps: [
      a("workshop_pro_inspections", "Inspections", "", ClipboardCheck, "Checklists with photos and notes, shared with the customer."),
      a("workshop_pro_bays", "Bay board", "", Gauge, "Every bay, the car in it and the mechanic, live on any screen."),
      a("workshop_pro_mechanic", "Mechanic app", "", Smartphone, "Mechanics see their jobs, clock time and add photos from the phone."),
    ],
    features: ["Digital inspections with photos", "Inspection sent with the estimate", "Live bay board for a TV or tablet", "Mechanic phone view", "Time clocked per job", "Who is busy, at a glance"] },

  // ── Parts & sales ───────────────────────────────────────────────────────
  { key: "inventory", name: "Parts & Stock", category: "Parts & sales", price: 1500, includedIn: BIZ, icon: Package, color: "#0369a1", home: "/inventory/stock",
    tagline: "Full parts stock: stores and branches, purchase orders, receiving, transfers and stock-takes.",
    description: "Know which parts you have and where. Keep stock in several stores or branches, raise purchase orders to suppliers, receive parts against them and move stock between branches. Serial numbers, batches, reorder levels and stock-takes keep the count right, and every part used on a job comes off stock by itself.",
    apps: [
      a("stock", "Stock & stores", "/inventory/stock", Package, "Stock on hand per store, reorder levels and value."),
      a("transfers", "Transfers & serials", "/inventory/transfer", Truck, "Move parts between branches; serial numbers and batches."),
      a("shipments", "Packages & deliveries", "/sales/delivery-notes", Truck, "Picking, packing and delivery notes for parts orders."),
      a("fleet", "Company vehicles", "/apps/fleet", Car, "Your own pick-ups and tow trucks: fuel, insurance and service costs."),
    ],
    features: ["Several stores and branches", "Purchase orders and receiving", "Transfers between branches", "Serial numbers and batches", "Reorder alerts", "Stock-takes with differences posted", "Parts on jobs come off stock"] },

  { key: "commerce", name: "Spares POS & Wholesale", category: "Parts & sales", price: 1500, icon: ShoppingCart, color: "#0f766e", home: "/pos",
    tagline: "A fast till for the spares counter, price lists for wholesale buyers, and loyalty.",
    description: "Sell spares over the counter and to other garages. The till works on any tablet or PC, even when the internet drops, with M-Pesa, card and cash. Wholesale customers get their own price lists and credit limits, and loyalty points and vouchers bring retail buyers back.",
    apps: [
      a("pos", "Point of sale", "/pos", ShoppingCart, "Fast till with barcode, receipts, M-Pesa, card and cash, offline mode."),
      a("ecommerce", "Online orders", "/sales/online-orders", Store, "Parts ordered from your website."),
      a("loyalty", "Loyalty & vouchers", "/apps/loyalty", Gift, "Points, rewards, gift cards and vouchers."),
    ],
    features: ["Works offline and catches up later", "M-Pesa STK, card and cash", "Shifts, cash-up and Z-reports", "Wholesale price lists", "Credit limits for trade buyers", "Points and vouchers", "One stock for the counter and the workshop"] },

  { key: "website", name: "Online Parts Shop & Website", category: "Parts & sales", price: 1000, icon: Globe, color: "#2563eb", home: "/settings?tab=website",
    tagline: "Your garage website and an online parts shop on your own address.",
    description: "Put your garage online. A fast website on your own domain shows your services, opening hours and location, lets customers book a service, and sells parts with live stock and M-Pesa checkout.",
    apps: [
      a("website", "Website", "/settings?tab=website", Globe, "Pages, services and booking on your own domain."),
      a("blog", "News & tips", "/apps/blog", Newspaper, "Posts with search engine settings."),
    ],
    features: ["Your own domain with SSL", "Services and opening hours", "Online parts shop with live stock", "M-Pesa checkout", "Search engine ready"] },

  { key: "imports", name: "Imports & Landed Cost", category: "Parts & sales", garage: true, price: 3000, icon: Ship, color: "#1e40af", home: "",
    tagline: "Import parts and vehicles: shipments, duty, clearing and the true landed cost of every item.",
    description: "Follow every import from order to your yard. Record the supplier, the shipment and the container, add freight, duty, clearing and port charges, and spread them over the parts or vehicles so each one carries its true landed cost. You see what is on the water, what is at the port and what has arrived.",
    apps: [
      a("imports_shipments", "Shipments", "", Ship, "Orders, containers and where each shipment is."),
      a("imports_costs", "Landed cost", "", Calculator, "Freight, duty, clearing and charges spread over each item."),
    ],
    features: ["Shipments and containers", "Freight, duty and clearing costs", "Landed cost per part or vehicle", "Foreign currency suppliers", "Arrivals into stock or the yard"] },

  // ── Specialist ──────────────────────────────────────────────────────────
  { key: "insurance", name: "Insurance Claims", category: "Specialist", garage: true, price: 1500, includedIn: PRO, icon: ShieldCheck, color: "#7c3aed", home: "",
    tagline: "Accident repairs for insurers: claims, assessments, approvals, excess and payments.",
    description: "Handle insurance work without losing track. Record the claim, the insurer and the assessor, attach photos and the assessment, follow the approval, and split the bill between the insurer and the customer's excess. See which insurers owe you and for how long.",
    apps: [
      a("insurance_claims", "Claims", "", ShieldCheck, "Claim, insurer, assessor, photos and approval."),
      a("insurance_billing", "Insurer billing", "", FileText, "Bill the insurer and the excess separately."),
    ],
    features: ["Claims with photos and documents", "Assessor and approval steps", "Excess billed to the customer", "Insurer statements", "What each insurer owes"] },

  { key: "vehicle_yard", name: "Vehicle Yard & Car Sales", category: "Specialist", garage: true, price: 2000, icon: CarFront, color: "#0f172a", home: "",
    tagline: "Cars for sale: stock, costs, reconditioning, deposits, sales and logbook transfer.",
    description: "Run a car yard. Every vehicle in stock with its cost, repairs and reconditioning, photos and asking price. Take deposits, sell on cash or finance, and follow the logbook transfer. You know the real profit on every car sold.",
    apps: [
      a("vehicle_yard_stock", "Yard stock", "", CarFront, "Cars for sale with photos, costs and prices."),
      a("vehicle_yard_sales", "Car sales", "", Handshake, "Deposits, sales, finance and logbook transfer."),
    ],
    features: ["Vehicle stock with photos", "Costs and reconditioning per car", "Deposits and part payments", "Profit per car", "Logbook transfer steps"] },

  { key: "body_paint", name: "Body & Paint", category: "Specialist", garage: true, price: 2000, icon: SprayCan, color: "#c2410c", home: "",
    tagline: "Panel beating and spray painting: stages, paint mixing and materials per job.",
    description: "Track body work from strip-down to polish. Each car moves through panel, prep, paint and finish, paint and materials are booked to the job, and photos before and after go to the customer or insurer.",
    apps: [
      a("body_paint_jobs", "Body jobs", "", SprayCan, "Stages from strip-down to polish, with photos."),
      a("body_paint_materials", "Paint & materials", "", Droplets, "Paint and materials booked to each job."),
    ],
    features: ["Stages per car", "Before and after photos", "Paint and materials per job", "Works with insurance claims"] },

  { key: "car_wash", name: "Car Wash & Detailing", category: "Specialist", garage: true, price: 1000, icon: Droplets, color: "#0891b2", home: "",
    tagline: "Washes, packages and detailing with a queue, attendants' commission and M-Pesa.",
    description: "Run the wash bay fast. Cars join the queue by plate, attendants are assigned, packages and add-ons are priced, and customers pay by M-Pesa. Commissions for attendants and wash cards for regulars are worked out for you.",
    apps: [
      a("car_wash_queue", "Wash queue", "", Droplets, "Cars waiting, being washed and done."),
      a("car_wash_packages", "Packages & cards", "", Ticket, "Wash packages, add-ons and prepaid wash cards."),
    ],
    features: ["Queue by number plate", "Packages and add-ons", "Attendants' commission", "Prepaid wash cards", "M-Pesa at the bay"] },

  { key: "tyres", name: "Tyres, Alignment & Batteries", category: "Specialist", garage: true, price: 800, icon: Disc, color: "#334155", home: "",
    tagline: "Tyre sizes and stock, alignment and balancing, battery tests and warranties.",
    description: "Sell and fit tyres and batteries with the right details. Find tyres by size, record wheel alignment and balancing, test batteries, and keep the warranty for each one sold.",
    apps: [
      a("tyres_fitment", "Tyres & fitting", "", Disc, "Tyres by size, fitting, alignment and balancing."),
      a("tyres_batteries", "Batteries", "", Gauge, "Battery tests, sales and warranties."),
    ],
    features: ["Find tyres by size", "Alignment and balancing records", "Battery tests", "Warranties per item"] },

  { key: "fleet_contracts", name: "Fleet Contracts & Fleet Portal", category: "Specialist", garage: true, price: 2500, icon: Truck, color: "#065f46", home: "",
    tagline: "Service contracts for companies with many vehicles, with their own portal.",
    description: "Look after company fleets. Agree contract rates and service schedules per fleet, get reminded when each vehicle is due, and send one monthly statement. The fleet manager logs into a portal to see every vehicle, job and invoice.",
    apps: [
      a("fleet_contracts_contracts", "Fleet contracts", "", Truck, "Fleets, their vehicles, rates and schedules."),
      a("fleet_contracts_portal", "Fleet portal", "", Users, "Fleet managers see their vehicles, jobs and invoices."),
    ],
    features: ["Contract rates per fleet", "Service due reminders", "Monthly fleet statements", "Fleet manager portal", "Job approval by the fleet"] },

  { key: "towing", name: "Towing & Mobile Mechanic", category: "Specialist", garage: true, price: 1500, icon: Truck, color: "#a16207", home: "",
    tagline: "Tow and roadside call-outs: dispatch, distance charges and jobs on the road.",
    description: "Answer the call, send the nearest truck or mechanic, and charge for the distance. Each call-out has its pick-up, drop-off, photos and payment, and turns into a job card when the car reaches the garage.",
    apps: [
      a("towing_callouts", "Call-outs", "", Truck, "Calls, dispatch, distance and payment."),
    ],
    features: ["Call-outs with pick-up and drop-off", "Dispatch to a truck or mechanic", "Charges by distance", "Photos on the road", "Becomes a job card"] },

  { key: "car_hire", name: "Car Hire", category: "Specialist", garage: true, price: 1500, icon: KeyRound, color: "#4338ca", home: "",
    tagline: "Rent out cars: bookings, deposits, hand-over checks and returns.",
    description: "Hire out your cars with less paperwork. A booking calendar per car, deposits by M-Pesa, hand-over and return checks with photos and fuel level, and late or damage charges added to the bill.",
    apps: [
      a("car_hire_bookings", "Bookings", "", CalendarRange, "Calendar per car, deposits and returns."),
    ],
    features: ["Booking calendar per car", "Deposits by M-Pesa", "Hand-over and return checks", "Late and damage charges"] },

  // ── Finance & people ────────────────────────────────────────────────────
  { key: "accounting", name: "Accounting", category: "Finance & people", price: 1500, includedIn: BIZ, icon: Landmark, color: "#7c2d12", home: "/accounting/chart-of-accounts",
    tagline: "Chart of accounts, journals, banking, financial statements, VAT return and budgets.",
    description: "Full books for the garage. Every invoice, payment, expense and stock movement already posts to the ledger; switch on Accounting to see and work with it: the chart of accounts, manual journals, bank and M-Pesa statement matching, profit and loss and balance sheet, the VAT return and budgets.",
    apps: [
      a("accountant", "Accountant", "/accounting/chart-of-accounts", BookMarked, "Chart of accounts, journals, opening balances and locking."),
      a("banking", "Banking", "/accounting/banking", Landmark, "Bank and M-Pesa statements matched to your records."),
      a("statements", "Statements & VAT", "/accounting/statements", Scale, "Profit and loss, balance sheet, cash flow and the VAT return."),
    ],
    features: ["Chart of accounts", "Manual journals", "Bank and M-Pesa matching", "Profit and loss and balance sheet", "VAT return", "Budgets", "Transaction locking"] },

  { key: "hrm", name: "Payroll & HR", category: "Finance & people", price: 1500, includedIn: PRO, icon: UserRoundCog, color: "#047857", home: "/hrm",
    tagline: "Staff files, attendance, leave and Kenyan payroll with PAYE, NSSF, SHIF and Housing Levy.",
    description: "Pay mechanics and staff right. Keep staff files and contracts, record attendance and leave, and run payroll with PAYE, NSSF, SHIF, Housing Levy and NITA worked out. Payslips go by email and SMS, and payroll posts to the books. Casual workers, advances and loans are included.",
    apps: [
      a("employees", "Staff", "/hrm/employees", Users, "Staff files, contracts and documents."),
      a("attendance", "Attendance & leave", "/hrm/attendance", CalendarClock, "Clock-in, leave and approvals."),
      a("payroll", "Payroll", "/hrm/payroll", Wallet, "Kenyan payroll, payslips, P9 and bank or M-Pesa files."),
      a("recruitment", "Recruitment", "/apps/recruitment", UserPlus, "Job posts and applicants."),
      a("appraisals", "Appraisals", "/apps/appraisals", Star, "Goals and reviews."),
      a("planning", "Shifts", "/apps/planning", CalendarRange, "Rosters and shifts."),
    ],
    features: ["PAYE, NSSF, SHIF, Housing Levy, NITA", "Payslips by email and SMS", "Casual workers", "Advances and loans", "Leave and attendance", "Payroll posts to the books"] },

  { key: "expense", name: "Expense Claims", category: "Finance & people", price: 800, icon: Wallet, color: "#9a3412", home: "/apps/expense",
    tagline: "Staff claims for fuel, parts runs and trips, approved and refunded by M-Pesa.",
    description: "Staff snap a receipt and claim from their phone. The owner approves in one tap, the refund goes by M-Pesa, and the claim posts to the right expense.",
    apps: [a("expense", "Expense claims", "/apps/expense", Wallet, "Receipts, mileage and claims with approval.")],
    features: ["Receipt photo on the phone", "Approval in one tap", "Refund by M-Pesa", "Posts to the books"] },

  // ── Customers & marketing ───────────────────────────────────────────────
  { key: "whatsapp", name: "WhatsApp Inbox", category: "Customers & marketing", garage: true, price: 1000, icon: MessageCircle, color: "#15803d", home: "",
    tagline: "One shared WhatsApp inbox for the garage, linked to customers and jobs.",
    description: "Answer customers on WhatsApp from one shared inbox. Messages land on the customer and their job, the team sees who is replying, and estimates, invoices and 'your car is ready' messages go out on WhatsApp.",
    apps: [a("whatsapp_inbox", "WhatsApp inbox", "", MessageCircle, "Shared inbox linked to customers and jobs.")],
    features: ["Shared inbox for the team", "Linked to customers and jobs", "Send estimates and invoices", "Ready-for-collection messages"] },

  { key: "crm", name: "CRM", category: "Customers & marketing", price: 1500, icon: Handshake, color: "#1d4ed8", home: "/crm",
    tagline: "Leads, follow-ups and deals for fleet, dealer and trade customers.",
    description: "Follow up every enquiry. Leads from calls, WhatsApp and your website, follow-up tasks, and deals that turn into estimates and invoices without retyping.",
    apps: [
      a("pipeline", "Pipeline & deals", "/crm", Handshake, "Deals by stage with expected value."),
      a("leads", "Leads", "/crm/leads", UserPlus, "Capture, assign and convert leads."),
      a("activities", "Follow-ups", "/crm/activities", CalendarClock, "Calls, meetings and tasks."),
      a("forecast", "Forecast", "/crm/forecast", BarChart3, "Expected sales and win rates."),
    ],
    features: ["Leads from web, WhatsApp and calls", "Follow-up reminders", "Deal to estimate in one click", "Forecasts"] },

  { key: "marketing", name: "Marketing", category: "Customers & marketing", price: 2000, icon: Megaphone, color: "#c026d3", home: "/apps/marketing_automation",
    tagline: "Service reminders, SMS and email campaigns, and offers to past customers.",
    description: "Bring customers back. Send SMS, email and WhatsApp campaigns to groups of customers, automatic service reminders by mileage or date, and offers to customers you have not seen for a while.",
    apps: [
      a("marketing_automation", "Automations", "/apps/marketing_automation", Sparkles, "Triggers, waits and messages."),
      a("email_marketing", "Email campaigns", "/apps/email_marketing", Mail, "Branded emails to groups of customers."),
      a("sms_marketing", "SMS & WhatsApp", "/marketing/sms", MessageSquare, "Bulk and personal SMS and WhatsApp."),
      a("social", "Social media", "/apps/social", Share2, "Plan and publish posts."),
      a("events", "Events", "/apps/events", Ticket, "Event pages and tickets."),
      a("surveys", "Surveys", "/apps/surveys", ClipboardList, "Feedback after each job."),
    ],
    features: ["Groups from your customers and vehicles", "Bulk SMS and WhatsApp", "Service reminders", "Feedback after the job"] },

  { key: "service", name: "Helpdesk & Bookings", category: "Customers & marketing", price: 1800, icon: LifeBuoy, color: "#0e7490", home: "/apps/helpdesk",
    tagline: "Complaints and warranty tickets, website chat and online appointment booking.",
    description: "Look after customers after the job. Complaints and warranty claims become tickets with someone responsible, the chat bubble on your website lands in the same inbox, and customers book appointments online with SMS confirmations.",
    apps: [
      a("helpdesk", "Helpdesk", "/apps/helpdesk", LifeBuoy, "Tickets from email and the portal."),
      a("live_chat", "Live chat", "/apps/live_chat", MessagesSquare, "Chat bubble for your website."),
      a("field_service", "Field jobs", "/apps/field_service", Hammer, "Jobs away from the garage."),
      a("appointments", "Appointments", "/apps/appointments", CalendarClock, "Online booking with SMS confirmations."),
      a("frontdesk", "Front desk", "/apps/frontdesk", DoorOpen, "Visitor sign-in at reception."),
    ],
    features: ["Warranty and complaint tickets", "Website chat", "Online booking page", "SMS reminders before appointments"] },

  { key: "callcentre", name: "JMSURF Call Centre", category: "Customers & marketing", price: 2500, icon: Headset, color: "#be123c", home: "/callcentre",
    tagline: "Phone lines with a menu, queues and recording, linked to every customer.",
    description: "A cloud call centre from JMSURF that works inside JMSURF Garage. Calls go through your menu into queues, staff answer in the browser, and the caller's vehicles, jobs and balance show on screen. Every call is recorded on the customer.",
    apps: [a("callcentre", "Call centre", "/callcentre", Headset, "Calls, recordings, queues and agents.")],
    features: ["Phone menu and business hours", "Queues", "Browser phone", "Caller details on screen", "Call recording"] },

  // ── Extras ──────────────────────────────────────────────────────────────
  { key: "projects", name: "Projects", category: "Extras", price: 1200, icon: FolderKanban, color: "#4338ca", home: "/apps/projects",
    tagline: "Big jobs such as rebuilds and fleet refits as projects with tasks and costs.",
    description: "Plan long jobs with tasks and milestones, log time and costs as they happen, and bill them when ready.",
    apps: [
      a("projects", "Projects & tasks", "/apps/projects", FolderKanban, "Projects, milestones and tasks."),
      a("timesheets", "Timesheets", "/apps/projects/timesheet", CalendarClock, "Time by person and task."),
    ],
    features: ["Tasks and milestones", "Time and costs", "Bill when ready", "Profit per project"] },

  { key: "contracts", name: "Contracts & e-Sign", category: "Extras", price: 1200, icon: FileSignature, color: "#6d28d9", home: "/contracts",
    tagline: "Service agreements and electronic signatures from any phone.",
    description: "Draft agreements from templates, send them for signature on any phone, and keep the signed copy on the customer.",
    apps: [
      a("contracts", "Contracts", "/contracts", FileText, "Templates, signing, renewals."),
      a("sign", "e-Sign", "/apps/sign", FileSignature, "Send documents for signature."),
    ],
    features: ["Templates", "Signature on any phone", "Renewal reminders", "Signed copies kept"] },

  { key: "workplace", name: "Knowledge & Sheets", category: "Extras", price: 600, icon: BookMarked, color: "#475569", home: "/apps/knowledge",
    tagline: "How-to guides for your team and spreadsheets next to your data.",
    description: "Write down how your garage works: procedures, checklists and guides, and keep working sheets next to your data.",
    apps: [
      a("knowledge", "Knowledge", "/apps/knowledge", BookMarked, "Guides and procedures."),
      a("spreadsheets", "Spreadsheets", "/apps/spreadsheets", Table, "Sheets for planning."),
    ],
    features: ["Searchable guides", "Spreadsheets", "Shared with the right people"] },

  { key: "ai", name: "Garage AI", category: "Extras", price: 1900, icon: Sparkles, color: "#a8121b", home: "/ai",
    tagline: "Ask about your garage in plain words: who owes you, which jobs pay best.",
    description: "Ask about your garage by typing or speaking: who owes you the most, which jobs make the most money, which parts are slow. Garage AI reads your data with your own access rights, explains the numbers and drafts messages, and only acts after you confirm.",
    apps: [
      a("ai", "Garage AI", "/ai", Sparkles, "Chat and voice assistant over your garage data."),
      a("analytics", "Analytics", "/reports", BarChart3, "Dashboards and trends."),
    ],
    features: ["Answers from your live data", "Voice in and out", "Respects each person's access", "Acts only after you confirm"] },

  // ── Not offered to garages (kept, hidden) ───────────────────────────────
  { key: "finance_plus", name: "Finance+", category: "Extras", hidden: true, price: 1500, icon: Landmark, color: "#7c2d12", home: "/apps/fixed_assets",
    tagline: "Fixed assets and subscription billing.", description: "Fixed assets, subscription billing, ESG and practice tools.",
    apps: [
      a("fixed_assets", "Fixed assets", "/apps/fixed_assets", Landmark, "Asset register and depreciation."),
      a("subscriptions", "Subscription billing", "/apps/subscriptions", Repeat, "Plans and renewals."),
      a("esg", "ESG", "/apps/esg", Leaf, "Sustainability metrics."),
      a("practice", "Accountant practice", "/apps/practice", Briefcase, "Client engagements."),
    ], features: [] },
  { key: "manufacturing", name: "Manufacturing", category: "Extras", hidden: true, price: 3000, icon: Factory, color: "#b45309", home: "/apps/manufacturing",
    tagline: "Production.", description: "Bills of materials and production.",
    apps: [
      a("manufacturing", "Production", "/apps/manufacturing", Factory, "Production orders."),
      a("quality", "Quality", "/apps/quality", ShieldCheck, "Quality checks."),
      a("maintenance", "Maintenance", "/apps/maintenance", Wrench, "Equipment maintenance."),
      a("plm", "Engineering changes", "/apps/plm", Layers, "Change orders."),
      a("iot", "Devices", "/apps/iot", Cpu, "Connected devices."),
    ], features: [] },
  { key: "studio", name: "Studio", category: "Extras", hidden: true, price: 2500, icon: Blocks, color: "#a8121b", home: "/apps/studio",
    tagline: "Custom apps.", description: "Build your own apps.", apps: [a("studio", "Studio", "/apps/studio", Blocks, "Custom apps.")], features: [] },
];

/** Modules offered to garages (store, website, sign-up). */
export const PUBLIC_MODULES: ModuleDef[] = MODULES.filter((m) => !m.hidden);
/** Paid modules a garage can switch on. */
export const ADDON_MODULES: ModuleDef[] = PUBLIC_MODULES.filter((m) => !m.included);

export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** App key (or old single-app module key) → the module that sells it. Keep in sync with public.module_of(). */
const SUITE_OF: Record<string, string> = Object.fromEntries(MODULES.flatMap((m) => m.apps.map((x) => [x.key, m.key])));
// Older keys: Books is Garage Core now; its banking and accountant apps are the Accounting module.
// Rental, repairs, forum and eLearning stay with their old suites in the database (module_of).
Object.assign(SUITE_OF, {
  books: "garage_core", voip: "callcentre", pos: "commerce", ecommerce: "commerce",
  rental: "commerce", repairs: "commerce", forum: "website", elearning: "website",
});
MODULES.forEach((m) => { SUITE_OF[m.key] = m.key; });
/** Garage record apps are named after their module: insurance_claim → insurance. */
const GARAGE_PREFIXES = MODULES.filter((m) => m.garage).map((m) => m.key).sort((x, y) => y.length - x.length);
export const suiteOf = (key: string) => {
  if (SUITE_OF[key]) return SUITE_OF[key];
  const hit = GARAGE_PREFIXES.find((p) => key.startsWith(`${p}_`));
  if (hit) return hit;
  if (key.startsWith("garage_")) return "garage_core";
  return key;
};
/** The module for any app or module key. */
export const moduleFor = (key: string): ModuleDef | undefined => MODULE_BY_KEY[suiteOf(key)];
/** Display name of an app inside a module (or the module itself). */
export const appName = (key: string) => {
  for (const m of MODULES) { const x = m.apps.find((p) => p.key === key); if (x) return x.name; }
  return MODULE_BY_KEY[key]?.name || key;
};

/** The module every garage has. */
export const CORE_KEY = "garage_core";

/** Price of the "All modules" bundle, KES per month (see garagePlans.ts). */
export const ALL_IN_ONE_PRICE = 25000;

export const moduleName = (key: string) => moduleFor(key)?.name || key;
