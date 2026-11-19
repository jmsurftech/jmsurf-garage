import {
  LayoutDashboard, Users, FileText, FileCheck, Undo2, HandCoins, ClipboardList, PackageCheck, Package, Box, ArrowRightLeft,
  ClipboardCheck, Tags, CalendarClock, Truck, ShoppingBag, Receipt, DollarSign, Wallet, BarChart3, BadgePercent, Handshake,
  KanbanSquare, Magnet, Clock, LineChart, Globe, MessagesSquare, FileMinus, Banknote, Contact, Megaphone, UserRoundCog, IdCard,
  CalendarCheck, Plane, Calculator, PiggyBank, CalendarDays, History, CheckSquare, StickyNote, FolderOpen, SlidersHorizontal, Layers,
  FolderKanban, ListChecks, Timer, Flag, Factory, Cog, Trash2, ShieldCheck, Wrench, UserPlus, Star, CalendarRange, Boxes,
  Warehouse, ScrollText, Coins, CalendarRange as CalendarIcon, Store, Grid2x2, Landmark, BookText, Scale, PieChart, Lock,
  Repeat, ShoppingCart, FileSpreadsheet, UploadCloud, Blocks, Car, Cpu, Gift, Barcode, type LucideIcon,
  Eye,
  DoorOpen, HardHat, BookOpenCheck, CalendarHeart,
} from "lucide-react";
import { MODULES, MODULE_BY_KEY } from "@/lib/modules";
import { GARAGE_NAV } from "@/garage/nav";

/**
 * The company menu (classic books order). Sections hold entries; an entry with
 * children is a dropdown. `module` hides an entry until that module is on;
 * a whole group whose module is off shows as locked (opens the app store).
 * Modules, System and Help sit at the foot of the sidebar (AppLayout).
 */
export interface NavLeaf {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Extra paths that also mark this entry active (e.g. detail pages). */
  match?: string[];
  /** Module that must be switched on (Garage Core parts have none). */
  module?: string;
  /** Shown only once the module is paid for (not while on trial). */
  paid?: boolean;
}
export interface NavEntry extends NavLeaf {
  children?: NavLeaf[];
  /** Shown locked (with a link to the app store) when its module is off. */
  lockable?: boolean;
}
export interface NavSection {
  title: string | null;
  entries: NavEntry[];
}

const app = (appKey: string, kind: string, label: string, icon: LucideIcon, module = appKey): NavLeaf =>
  ({ path: `/apps/${appKey}/${kind}`, label, icon, module });

export const NAV: NavSection[] = [
  {
    title: null,
    entries: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      ...GARAGE_NAV,
      { path: "/approvals", label: "Approvals", icon: CheckSquare },
      { path: "/calendar", label: "Calendar", icon: CalendarIcon },
      { path: "/me", label: "My Space", icon: UserRoundCog, module: "hrm", paid: true },
      {
        path: "/products-menu", label: "Products & Services", icon: Box,
        children: [
          { path: "/inventory/products", label: "Items", icon: Box, match: ["/inventory/products/"] },
          { path: "/inventory/taxonomy", label: "Categories & Units", icon: Tags },
          { path: "/inventory/variants", label: "Item Groups & Variants", icon: Layers, module: "inventory" },
          { path: "/inventory/composite-items", label: "Composite Items", icon: Boxes, module: "inventory" },
          { path: "/inventory/price-lists", label: "Price Lists", icon: BadgePercent },
        ],
      },
      {
        path: "/inventory-menu", label: "Inventory", icon: Package,
        children: [
          { path: "/inventory/stock", label: "Stock on Hand", icon: Warehouse },
          { path: "/warehouse/receive", label: "Receive Stock", icon: PackageCheck },
          { path: "/inventory/adjustments", label: "Inventory Adjustments", icon: SlidersHorizontal },
          { path: "/warehouse/locations", label: "Warehouses & Bins", icon: Warehouse, module: "inventory" },
          { path: "/warehouse/transfers", label: "Transfer Orders", icon: ArrowRightLeft, module: "inventory" },
          { path: "/inventory/batches", label: "Batches & Expiry", icon: CalendarClock, module: "inventory" },
          { path: "/inventory/serials", label: "Serial Numbers", icon: Barcode, module: "inventory" },
          { path: "/inventory/stock-take", label: "Stock-take", icon: ClipboardCheck, module: "inventory" },
          { path: "/warehouse/packages", label: "Packages", icon: Boxes, module: "inventory" },
          { path: "/warehouse/shipments", label: "Shipments & Delivery Notes", icon: Truck, module: "inventory" },
          { path: "/warehouse/reorder", label: "Reorder", icon: Repeat, module: "inventory" },
          { path: "/apps/fleet", label: "Fleet", icon: Car, module: "fleet", match: ["/apps/fleet"] },
        ],
      },
      {
        path: "/sales-menu", label: "Sales", icon: Receipt,
        children: [
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/sales/quotes", label: "Quotes", icon: FileText },
          { path: "/sales/orders", label: "Sales Orders", icon: ClipboardCheck },
          { path: "/sales/invoices", label: "Invoices", icon: FileCheck },
          { path: "/sales/recurring", label: "Recurring Invoices", icon: Repeat },
          { path: "/sales/payments", label: "Payments Received", icon: Wallet },
          { path: "/sales/credit-notes", label: "Credit Notes", icon: FileMinus },
          { path: "/sales/returns", label: "Sales Returns", icon: Undo2 },
          { path: "/sales/debts", label: "Receivables", icon: HandCoins },
          { path: "/sales/reminders", label: "Reminders", icon: CalendarClock },
          { path: "/sales-reps", label: "Salespersons", icon: BadgePercent },
          { path: "/sales/online-orders", label: "Online Orders", icon: Globe, module: "ecommerce" },
        ],
      },
      {
        path: "/purchases-menu", label: "Purchases", icon: ShoppingBag,
        children: [
          { path: "/purchases/suppliers", label: "Vendors", icon: Truck },
          { path: "/purchases/expenses", label: "Expenses", icon: DollarSign },
          { path: "/purchases/recurring-expenses", label: "Recurring Expenses", icon: Repeat },
          { path: "/purchases/requisitions", label: "Requisitions", icon: ClipboardList },
          { path: "/purchases/rfqs", label: "Requests for Quotation", icon: FileText },
          { path: "/purchases/orders", label: "Purchase Orders", icon: ShoppingBag },
          { path: "/purchases/receives", label: "Purchase Receives", icon: PackageCheck },
          { path: "/purchases/bills", label: "Bills", icon: Receipt },
          { path: "/purchases/recurring-bills", label: "Recurring Bills", icon: Repeat },
          { path: "/purchases/payments", label: "Payments Made", icon: Banknote },
          { path: "/purchases/vendor-credits", label: "Vendor Credits", icon: FileMinus },
          { path: "/purchases/payables", label: "Payables", icon: HandCoins },
          { path: "/purchases/landed-costs", label: "Landed Costs", icon: Truck, module: "inventory" },
        ],
      },
      // Accounting module (included in Business and Pro).
      { path: "/accounting/banking", label: "Banking", icon: Landmark, module: "accounting" },
      {
        path: "/accountant-menu", label: "Accountant", icon: Scale, module: "accounting",
        children: [
          { path: "/accounting/chart-of-accounts", label: "Chart of Accounts", icon: Landmark, module: "accounting" },
          { path: "/accounting/journals", label: "Manual Journals", icon: BookText, module: "accounting" },
          { path: "/accounting/statements", label: "Financial Statements", icon: FileSpreadsheet, module: "accounting" },
          { path: "/accounting/vat-return", label: "VAT Return", icon: BadgePercent, module: "accounting" },
          { path: "/accounting/opening-balances", label: "Opening Balances", icon: Scale, module: "accounting" },
          { path: "/accounting/budgets", label: "Budgets", icon: PieChart, module: "accounting" },
          { path: "/accounting/lock", label: "Transaction Locking", icon: Lock, module: "accounting" },
        ],
      },
      {
        path: "/crm-menu", label: "CRM", icon: Handshake, module: "crm", lockable: true,
        children: [
          { path: "/crm", label: "CRM home", icon: KanbanSquare, module: "crm" },
          { path: "/crm/leads", label: "Leads", icon: Magnet, match: ["/crm/lead"], module: "crm" },
          { path: "/crm/contacts", label: "Contacts", icon: Contact, module: "crm" },
          { path: "/crm/accounts", label: "Accounts", icon: Contact, module: "crm" },
          { path: "/crm/deals", label: "Deals", icon: Handshake, module: "crm" },
          { path: "/crm/tasks", label: "Tasks", icon: Clock, module: "crm" },
          { path: "/crm/meetings", label: "Meetings", icon: Clock, module: "crm" },
          { path: "/crm/calls", label: "Calls", icon: Clock, module: "crm" },
          { path: "/crm/activities", label: "All activities", icon: Clock, module: "crm" },
          { path: "/crm/webforms", label: "Web forms", icon: Megaphone, module: "crm" },
          { path: "/crm/visits", label: "Visits", icon: Eye, module: "crm" },
          { path: "/crm/campaigns", label: "Campaigns", icon: Megaphone, module: "crm" },
          { path: "/crm/forecast", label: "Forecast", icon: LineChart, module: "crm" },
          { path: "/crm/analysis", label: "Pipeline Analysis", icon: BarChart3, module: "crm" },
        ],
      },
      {
        path: "/projects-menu", label: "Projects", icon: FolderKanban, module: "projects", lockable: true,
        children: [
          app("projects", "project", "Projects", FolderKanban),
          app("projects", "task", "Tasks", ListChecks),
          app("projects", "milestone", "Milestones", Flag),
          app("projects", "timesheet", "Timesheets", Timer),
          app("projects", "project_expense", "Project Costs", Coins),
        ],
      },
      {
        path: "/hrm-menu", label: "HRM", icon: UserRoundCog, module: "hrm", lockable: true,
        children: [
          { path: "/hrm", label: "HR Overview", icon: LayoutDashboard, module: "hrm" },
          { path: "/hrm/employees", label: "Employees", icon: IdCard, module: "hrm" },
          { path: "/hrm/registrations", label: "Registrations", icon: UserPlus, module: "hrm" },
          { path: "/hrm/attendance", label: "Attendance", icon: CalendarCheck, module: "hrm" },
          { path: "/hrm/leave", label: "Time Off", icon: Plane, module: "hrm" },
          { path: "/hrm/payroll", label: "Payroll", icon: Calculator, module: "hrm" },
          { path: "/hrm/loans", label: "Loans & Advances", icon: PiggyBank, module: "hrm" },
          { path: "/hrm/holidays", label: "Holidays", icon: CalendarDays, module: "hrm" },
          { path: "/hrm/contracts", label: "Contracts", icon: ScrollText, module: "hrm" },
          { path: "/hrm/movements", label: "Promotions & Transfers", icon: ArrowRightLeft, module: "hrm" },
          { path: "/hrm/onboarding", label: "Onboarding & Exits", icon: ListChecks, module: "hrm" },
          { path: "/hrm/exits", label: "Separations", icon: DoorOpen, module: "hrm" },
          { path: "/hrm/timesheets", label: "Timesheets", icon: Timer, module: "hrm" },
          { path: "/hrm/casuals", label: "Casual Workers", icon: HardHat, module: "hrm" },
          { path: "/hrm/memos", label: "Memos", icon: Megaphone, module: "hrm" },
          { path: "/hrm/policies", label: "Policies", icon: BookOpenCheck, module: "hrm" },
          { path: "/hrm/events", label: "Events", icon: CalendarHeart, module: "hrm" },
          app("recruitment", "applicant", "Recruitment", UserPlus),
          app("appraisals", "appraisal", "Appraisals", Star),
          app("planning", "shift", "Shift Planning", CalendarRange),
          app("expense", "claim", "Expense Claims", Wallet),
        ],
      },
      // Manufacturing is not offered to garages (hidden, not deleted: see src/lib/modules.ts).
      { path: "/reports", label: "Reports", icon: BarChart3, match: ["/finance"] },
      { path: "/documents", label: "Documents", icon: FolderOpen },
    ],
  },
];

/** Modules that have their own place in the main menu above. */
const IN_MAIN_MENU = new Set(["garage_core", "crm", "projects", "hrm", "manufacturing", "inventory", "expense", "accounting"]);

/** Every other module the company switched on, each as a group of its apps, in one "Apps" section. */
export function appsSection(has: (key: string) => boolean, custom: { app_key: string; name: string }[] = []): NavSection {
  const entries: NavEntry[] = [
    { path: "/notebook", label: "Notebook", icon: StickyNote },
    { path: "/apps/discuss", label: "Team chat", icon: MessagesSquare, match: ["/apps/discuss"] },
  ];
  for (const m of MODULES) {
    // Garage modules bring their own menu entries (src/garage/*); hidden suites never show.
    if (IN_MAIN_MENU.has(m.key) || m.included || m.garage || m.hidden || !has(m.key)) continue;
    const label = m.name.replace(/^JMSURF /, "");
    const kids: NavLeaf[] = m.apps.map((x) => ({ path: x.home.split("?")[0], label: x.name, icon: x.icon, module: x.key, match: x.home.startsWith("/apps/") ? [x.home] : undefined }));
    if (m.key === "studio") kids.push(...custom.map((c) => ({ path: `/apps/studio:${c.app_key}`, label: c.name, icon: Blocks, module: "studio" })));
    // Contracts and Sign are each a button of their own.
    if (m.key === "contracts") entries.push(...kids);
    else if (kids.length === 1) entries.push({ ...kids[0], label, icon: m.icon });
    else entries.push({ path: `/${m.key}-menu`, label, icon: m.icon, module: m.key, children: kids });
  }
  return { title: "Apps", entries };
}

/** Phone tab bar: the everyday screens (the last tab opens the full menu). */
export const PRIMARY: NavLeaf[] = [
  { path: "/dashboard", label: "Home", icon: LayoutDashboard },
  { path: "/sales/invoices", label: "Invoices", icon: FileCheck },
  { path: "/customers", label: "Customers", icon: Users },
  { path: "/reports", label: "Reports", icon: BarChart3 },
];

/** Pages reached from the sidebar foot (System, Help) or inside System, for titles. */
const EXTRA: { leaf: NavLeaf; section: string }[] = [
  { leaf: { path: "/settings", label: "System", icon: LayoutDashboard }, section: "System" },
  { leaf: { path: "/modules", label: "Modules & billing", icon: Grid2x2 }, section: "System" },
  { leaf: { path: "/billing", label: "Billing", icon: Grid2x2 }, section: "System" },
  { leaf: { path: "/help", label: "Help centre", icon: LayoutDashboard }, section: "System" },
  { leaf: { path: "/whats-new", label: "What's new", icon: LayoutDashboard }, section: "System" },
  { leaf: { path: "/staff", label: "Staff", icon: Users }, section: "System" },
  { leaf: { path: "/branches", label: "Branches", icon: Store }, section: "System" },
  { leaf: { path: "/audit-log", label: "Audit Log", icon: History }, section: "System" },
  { leaf: { path: "/crm/config", label: "CRM Configuration", icon: Handshake }, section: "System" },
  { leaf: { path: "/hrm/config", label: "HRM Configuration", icon: UserRoundCog }, section: "System" },
  { leaf: { path: "/profile", label: "My profile", icon: Users }, section: "Account" },
  { leaf: { path: "/pos", label: "Point of Sale", icon: ShoppingCart }, section: "Apps" },
  { leaf: { path: "/companies", label: "My companies", icon: Store }, section: "Account" },
  { leaf: { path: "/import", label: "Move in", icon: UploadCloud }, section: "System" },
  { leaf: { path: "/migrate", label: "Move in", icon: UploadCloud }, section: "System" },
];

/** Every path in the menu, flattened (for titles and prefetching). */
export function allLeaves(): { leaf: NavLeaf; parent?: NavEntry; section: string | null }[] {
  const out: { leaf: NavLeaf; parent?: NavEntry; section: string | null }[] = [];
  for (const s of NAV) {
    for (const e of s.entries) {
      if (e.children) e.children.forEach((c) => out.push({ leaf: c, parent: e, section: s.title }));
      else out.push({ leaf: e, section: s.title });
    }
  }
  for (const m of MODULES) for (const x of m.apps) {
    if (x.home.startsWith("/apps/") || x.home === "/callcentre" || x.home === "/ai") out.push({ leaf: { path: x.home, label: x.name, icon: x.icon }, section: "Apps" });
  }
  EXTRA.forEach((x) => out.push({ leaf: x.leaf, section: x.section }));
  return out;
}

export { MODULE_BY_KEY };

/**
 * Menu items a company may hide (System → Menu items). Core screens the rest of the
 * system depends on are never listed: items, stock, customers, invoices, payments,
 * vendors, bills, expenses, banking and the books, CRM's pipeline and HRM's employees.
 */
const CORE_MENU = new Set([
  "/dashboard", "/inventory/products", "/inventory/taxonomy", "/inventory/stock", "/inventory/adjustments",
  "/customers", "/sales/invoices", "/sales/payments", "/sales/debts",
  "/purchases/suppliers", "/purchases/expenses", "/purchases/bills", "/purchases/payments",
  "/accounting/banking", "/accounting/chart-of-accounts", "/accounting/journals", "/accounting/statements", "/accounting/opening-balances",
  "/crm", "/crm/leads", "/crm/contacts", "/crm/accounts", "/crm/activities",
  "/hrm", "/hrm/employees", "/hrm/payroll", "/reports", "/documents",
]);
export function hideableMenu(): { group: NavEntry; items: NavLeaf[] }[] {
  const out: { group: NavEntry; items: NavLeaf[] }[] = [];
  for (const s of NAV) for (const e of s.entries) {
    if (!e.children?.length) continue;
    // The first entry of a group (its overview or main list) always stays.
    const items = e.children.filter((c, i) => i > 0 && !CORE_MENU.has(c.path));
    if (items.length) out.push({ group: e, items });
  }
  return out;
}
/** Whole menus that can be switched off (e.g. Inventory). Sales, Purchases and the Accountant menu stay: the books depend on them. */
const CORE_GROUPS = new Set(["/products-menu", "/sales-menu", "/purchases-menu", "/accountant-menu"]);
export function hideableGroups(): NavEntry[] {
  const out: NavEntry[] = [];
  for (const s of NAV) for (const e of s.entries) if (e.children?.length && !CORE_GROUPS.has(e.path)) out.push(e);
  return out;
}
export const isHideableMenu = (path: string) => hideableMenu().some((g) => g.items.some((i) => i.path === path));
