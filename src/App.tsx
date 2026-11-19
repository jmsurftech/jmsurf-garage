import { useBootCover } from "@/lib/bootScreen";
import { Toaster } from "@/components/ui/toaster";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { devicePersister, keepOnDevice } from "@/lib/queryPersist";
import PageBoundary from "@/components/PageBoundary";
import { Orb } from "@/components/Orb";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TenantProvider, useTenantLoginPath, useTenant } from "@/hooks/useTenant";
import { usePermissions, ROUTE_PERMISSION_MAP } from "@/hooks/usePermissions";
import { Suspense, useEffect, useState } from "react";
import { lazyPage, registerRoutes } from "@/lib/lazyPage";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import { getHostSlug, isApexHost, isReservedSubdomain, tenantUrl, isDevHost, isPlatformHost, isAppHost, PLATFORM_ORIGIN, SITE_ORIGIN, ROOT_HOST, APP_ORIGIN } from "@/lib/host";
import RequireModule from "@/components/RequireModule";
import { portal, getToken } from "@/lib/portalApi";
import { mergeSite } from "@/lib/shopSite";
import { setCurrency } from "@/lib/format";
import { useSubscriptionLock } from "@/hooks/useSubscriptionLock";
import { RENEWAL_ROLES } from "@/lib/subscriptionLock";
import { trackPageView } from "@/lib/tracking";
import { startOutbox } from "@/lib/offlineOutbox";
import { installOutboxGuard } from "@/lib/offlineGuard";

/** Meta Pixel page views for in-app navigation (the first one fires on load). */
function RouteTracker() {
  const loc = useLocation();
  const [first, setFirst] = useState(true);
  useEffect(() => { if (first) { setFirst(false); return; } trackPageView(); }, [loc.pathname]);
  return null;
}

const RESERVED_FIRST_SEGMENTS = new Set([
  "admin","login","register","reset-password","whats-new","subscription-expired","billing","dashboard","pos",
  "inventory","customers","sales","purchases","payments","email-logs","reports","ai-analysis","staff","settings",
  "delivery-confirm","stock-transfer","purchase-orders","suppliers","invoices","quotes","expenses",
  "bills","services","mpesa-history","credit-balances","unsubscribe","audit-log","aggregator","pay","404",
  "order","rider","water","tickets"
]);

/**
 * Which JMSURF Garage address this is (see lib/host.ts): the website, the super
 * admin (admin.), the staff workspace (app.: sign in, then the company comes from
 * the membership), a company (subdomain / own domain: workspace + its website and
 * customer portal) or local development (everything, /<slug>/… paths).
 */
// The old dash.<root> super admin address moves to admin.<root>.
if (typeof window !== "undefined" && window.location.hostname === `dash.${ROOT_HOST}`) {
  const p = window.location.pathname === "/" ? "/admin" : window.location.pathname;
  window.location.replace(PLATFORM_ORIGIN + p + window.location.search + window.location.hash);
}
const PLATFORM_MODE = isPlatformHost();
const APP_MODE = isAppHost();
const DEV_MODE = isDevHost();
const COMPANY_MODE = !!getHostSlug();
/** Company screens on clean paths: a company address, or app. (the signed-in company). */
const WORKSPACE_MODE = COMPANY_MODE || APP_MODE;

/** app.<root>: signed in → the company's dashboard; otherwise sign in. */
function AppRoot() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  return user ? <Navigate to="/dashboard" replace /> : <Login />;
}

/** Sends the browser to the same path on the other address (website ↔ ERP). */
function GoTo({ origin }: { origin: string }) {
  useEffect(() => { window.location.replace(origin + window.location.pathname + window.location.search + window.location.hash); }, [origin]);
  return <PageLoader />;
}
/** A company's own website pages (shop, about, contact, portal): only on a company address. */
const Site = ({ children }: { children: React.ReactNode }) => (COMPANY_MODE || DEV_MODE ? <>{children}</> : <Navigate to="/" replace />);

/**
 * A company's address: staff go to their dashboard; visitors see the company's
 * website when it has one switched on, otherwise the sign-in page.
 */
function CompanyRoot() {
  const { user, loading } = useAuth();
  const [site, setSite] = useState<boolean | null>(null);
  useEffect(() => {
    if (user) return;
    fetch("/api/shop/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setSite(!!d?.shop?.site_enabled)).catch(() => setSite(false));
  }, [user]);
  if (loading || (!user && site === null)) return <PageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return site ? <Suspense fallback={<PageLoader />}><ShopHome /></Suspense> : <Navigate to="/login" replace />;
}

/** The super admin address opens the platform console; elsewhere /admin moves there. */
const PlatformOnly = ({ children }: { children: React.ReactNode }) =>
  (PLATFORM_MODE || DEV_MODE ? <>{children}</> : <GoTo origin={PLATFORM_ORIGIN} />);

/** Slug taken from <slug>.garage.jmsurf.co.ke — stable for the whole session. */
const HOST_SLUG = getHostSlug();

const CURRENT_HOST = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";

/**
 * Slug-in-the-path URLs (garage.jmsurf.co.ke/azil/...) are retired on the live
 * domain: every shop is reached at its own address. They stay mounted on
 * preview and local hosts, which have no subdomains to use.
 */
const SLUG_PATHS_ENABLED = !HOST_SLUG && !isApexHost(CURRENT_HOST);

/**
 * Host handling on boot:
 *  - tenant subdomain  → nothing to do, bare tenant routes are mounted
 *  - apex /<slug>/...  → 301-style redirect to the shop's own subdomain
 *  - custom domain     → rewrite the URL with the resolved slug prefix
 */
function HostRedirector() {
  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname;

    // Skip on lovable preview/staging hosts and bare localhost/IP
    if (host.endsWith(".lovable.app") || host.endsWith(".lovable.dev") || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return;

    // Already on a tenant subdomain — routes render as-is.
    if (HOST_SLUG) return;

    // www and the bare domain both serve the app; no in-app redirect here.


    if (isApexHost(host)) {
      // Legacy path form: garage.jmsurf.co.ke/<slug>/... → <slug>.garage.jmsurf.co.ke/...
      const parts = path.split("/").filter(Boolean);
      const first = (parts[0] || "").toLowerCase();
      if (!first || RESERVED_FIRST_SEGMENTS.has(first) || isReservedSubdomain(first)) return;
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(first)) return;
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("tenants_public").select("slug").ilike("slug", first).maybeSingle();
          if (!data?.slug) return;
          const rest = "/" + parts.slice(1).join("/");
          window.location.replace(
            tenantUrl(data.slug, rest === "/" ? "/dashboard" : rest) + window.location.search + window.location.hash
          );
        } catch { /* stay on the path-based URL */ }
      })();
      return;
    }

    // Custom domain → look up and rewrite with the slug prefix
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("tenant_domains_public")
          .select("slug")
          .eq("host", host)
          .maybeSingle();
        const slug = data?.slug;
        if (!slug) return;
        const first = path.split("/").filter(Boolean)[0];
        if (first === slug) return;
        if (first && RESERVED_FIRST_SEGMENTS.has(first)) return;
        const newPath = path === "/" ? `/${slug}/dashboard` : `/${slug}${path}`;
        window.history.replaceState({}, "", newPath + window.location.search + window.location.hash);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch { /* ignore */ }
    })();
  }, []);
  return null;
}

/**
 * The shop's own address ("/" on <slug>.garage.jmsurf.co.ke or its custom domain).
 * A water shop shows its website to everyone (signed-in staff get a link to
 * their dashboard on it), or the ordering page when the website is off.
 * Any other shop sends staff to their work screen and visitors to sign in.
 */
function ShopRoot({ slug }: { slug: string }) {
  const { user, loading, role } = useAuth();
  const [shop, setShop] = useState<any | null | false>(null);
  useEffect(() => {
    let cancelled = false;
    portal(slug, "shop").then((d) => { if (!cancelled) { setCurrency(d.shop.currency); setShop(d); } }).catch(() => { if (!cancelled) setShop(false); });
    return () => { cancelled = true; };
  }, [slug]);
  const home = role === "rider" ? "/rider" : "/dashboard";
  const customer = !user && !!getToken(slug);
  if (loading || shop === null) return <PageLoader />;
  if (shop === false) return <Navigate to={user ? home : "/login"} replace />;
  if (shop.site_off) return <Navigate to="/order" replace />;
  return (
    <Suspense fallback={<PageLoader />}>
      <ShopLanding shop={shop.shop} sizes={shop.sizes} site={mergeSite(shop.shop.name, shop.shop.phone, shop.site)} orderHref="/order"
        signInHref={user ? home : customer ? "/order" : "/signin"}
        signInLabel={user ? (role === "rider" ? "My deliveries" : "Dashboard") : customer ? "My account" : "Sign in"} />
      {user && (
        <a href={home} className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2.5 text-sm font-semibold text-white shadow-xl backdrop-blur hover:bg-slate-900">
          ← {role === "rider" ? "My deliveries" : "Dashboard"}
        </a>
      )}
    </Suspense>
  );
}

function TenantSlugRedirect() {
  const { slug } = useParams<{ slug: string }>();
  const lower = (slug || "").toLowerCase();
  const [state, setState] = useState<"checking" | "found" | "missing">("checking");

  useEffect(() => {
    let cancelled = false;
    if (!lower) { setState("missing"); return; }
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("tenants_public")
          .select("slug")
          .ilike("slug", lower)
          .maybeSingle();
        if (cancelled) return;
        setState(data ? "found" : "missing");
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => { cancelled = true; };
  }, [lower]);

  if (state === "checking") return <PageLoader />;
  if (state === "missing") return <Navigate to="/404" replace />;
  return <Navigate to={`/${lower}/login`} replace />;
}

/** Live domain only: send any leftover /<slug>/... link to the shop's address. */
function SlugToSubdomain() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const lower = (slug || "").toLowerCase();

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!lower) { setFailed(true); return; }
    let cancelled = false;
    const rest = location.pathname.replace(new RegExp(`^/${lower}`), "") || "/dashboard";
    const timer = setTimeout(() => { if (!cancelled) setFailed(true); }, 8000);
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("tenants_public").select("slug").ilike("slug", lower).maybeSingle();
        if (cancelled) return;
        if (!data?.slug) { setFailed(true); return; }
        window.location.replace(tenantUrl(data.slug, rest) + location.search + location.hash);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lower, location.pathname, location.search, location.hash]);

  if (failed) return <Navigate to="/404" replace />;
  return <PageLoader />;
}


/**
 * Pass-through wrapper. Data is always scoped to the signed-in account's own
 * shop, so no extra lookups are needed here and nothing ever blocks rendering.
 */
function TenantSlugGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


// Lazy-loaded pages
const Login = lazyPage(() => import("@/pages/Login"));
const Register = lazyPage(() => import("@/pages/Register"));
const ResetPassword = lazyPage(() => import("@/pages/ResetPassword"));
const Landing = lazyPage(() => import("@/pages/Landing"));
const Solution = lazyPage(() => import("@/pages/Solution"));
const Solutions = lazyPage(() => import("@/pages/Solutions"));
const Pricing = lazyPage(() => import("@/pages/Pricing"));
const PhotoCredits = lazyPage(() => import("@/pages/PhotoCredits"));
const DemoStart = lazyPage(() => import("@/pages/DemoStart"));
const Legal = lazyPage(() => import("@/pages/Legal"));
const Status = lazyPage(() => import("@/pages/Status"));
const AdminHealth = lazyPage(() => import("@/pages/admin/AdminHealth"));
const TenantLogin = lazyPage(() => import("@/pages/TenantLogin"));
const SubscriptionExpired = lazyPage(() => import("@/pages/SubscriptionExpired"));
const NotFound = lazyPage(() => import("@/pages/NotFound"));
const Unsubscribe = lazyPage(() => import("@/pages/Unsubscribe"));
import { GARAGE_ROUTES, GARAGE_PUBLIC_ROUTES } from "@/garage/routes";
const OAuthConsent = lazyPage(() => import("@/pages/OAuthConsent"));


const Dashboard = lazyPage(() => import("@/pages/Dashboard"));
const PointOfSale = lazyPage(() => import("@/pages/PointOfSale"));
const Inventory = lazyPage(() => import("@/pages/Inventory"));
const InventoryTaxonomy = lazyPage(() => import("@/pages/InventoryTaxonomy"));
const PriceLists = lazyPage(() => import("@/pages/items/PriceLists"));
const CompositeItems = lazyPage(() => import("@/pages/items/PriceLists").then((m) => ({ default: m.CompositeItems })));
const InventoryBatches = lazyPage(() => import("@/pages/InventoryBatches"));
const SerialNumbers = lazyPage(() => import("@/pages/inventory/SerialNumbers"));
const Adjustments = lazyPage(() => import("@/pages/inventory/Adjustments"));
const AdjustmentForm = lazyPage(() => import("@/pages/inventory/Adjustments").then((m) => ({ default: m.AdjustmentForm })));
const Services = lazyPage(() => import("@/pages/Services"));
const StockTransfer = lazyPage(() => import("@/pages/StockTransfer"));
const Reports = lazyPage(() => import("@/pages/reports/Reports"));
const CreditNotes = lazyPage(() => import("@/pages/sales/CreditNotes"));
const SupplierPayments = lazyPage(() => import("@/pages/supply/SupplierPayments"));
const HrOverview = lazyPage(() => import("@/pages/hrm/HrPages").then((m) => ({ default: m.HrOverview })));
const HrLeave = lazyPage(() => import("@/pages/hrm/LeaveAttendance").then((m) => ({ default: m.Leave })));
const HrAttendance = lazyPage(() => import("@/pages/hrm/LeaveAttendance").then((m) => ({ default: m.Attendance })));
const HrLoans = lazyPage(() => import("@/pages/hrm/HrPages").then((m) => ({ default: m.Loans })));
const HrHolidays = lazyPage(() => import("@/pages/hrm/HrPages").then((m) => ({ default: m.Holidays })));
const HrConfig = lazyPage(() => import("@/pages/hrm/HrPages").then((m) => ({ default: m.HrConfig })));
const HrEmployees = lazyPage(() => import("@/pages/hrm/Employees"));
const HrPayroll = lazyPage(() => import("@/pages/hrm/Payroll"));
const HrContracts = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Contracts })));
const HrMovements = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Movements })));
const HrOnboarding = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Onboarding })));
const HrExits = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Separations })));
const HrMemos = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Memos })));
const HrPolicies = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Policies })));
const HrCasuals = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Casuals })));
const HrTimesheets = lazyPage(() => import("@/pages/hrm/HrMore").then((m) => ({ default: m.Timesheets })));
const HrRegistrations = lazyPage(() => import("@/pages/hrm/Registrations"));
const HrEventsPage = lazyPage(() => import("@/pages/hrm/HrEvents").then((m) => ({ default: m.HrEvents })));
const MySpace = lazyPage(() => import("@/pages/me/MySpace"));
const CrmCampaigns = lazyPage(() => import("@/pages/crm/CrmExtras").then((m) => ({ default: m.Campaigns })));
const CrmHome = lazyPage(() => import("@/pages/crm/hub/CrmHome"));
const CrmRecordList = lazyPage(() => import("@/pages/crm/hub/RecordList"));
const CrmRecordDetail = lazyPage(() => import("@/pages/crm/hub/RecordDetail"));
const CrmActivities = lazyPage(() => import("@/pages/crm/hub/ActivitiesPage"));
const CrmForecast = lazyPage(() => import("@/pages/crm/hub/Forecast"));
const CrmLeadRedirect = lazyPage(() => import("@/pages/crm/hub/LeadRedirect"));
const CrmWebForms = lazyPage(() => import("@/pages/crm/hub/WebForms"));
const CalendarPage = lazyPage(() => import("@/pages/calendar/Calendar"));
const ReceiveForm = lazyPage(() => import("@/pages/purchases/PurchaseDocs").then((m) => ({ default: m.ReceiveForm })));
const VendorCredits = lazyPage(() => import("@/pages/purchases/PurchaseDocs").then((m) => ({ default: m.VendorCredits })));
const SystemShell = lazyPage(() => import("@/pages/settings/SystemShell"));
const Approvals = lazyPage(() => import("@/pages/approvals/Approvals"));
const ProfilePage = lazyPage(() => import("@/pages/profile/Profile"));
const MfaGate = lazyPage(() => import("@/pages/profile/Profile").then((m) => ({ default: m.MfaGate })));
const SuppliersZ = lazyPage(() => import("@/pages/purchases/Suppliers"));
const DocumentsPage = lazyPage(() => import("@/pages/documents/Documents"));
const PurchaseOrdersZ = lazyPage(() => import("@/pages/purchases/Purchasing").then((m) => ({ default: m.PurchaseOrders })));
const PurchaseReceives = lazyPage(() => import("@/pages/purchases/Purchasing").then((m) => ({ default: m.PurchaseReceives })));
const BillsZ = lazyPage(() => import("@/pages/purchases/Purchasing").then((m) => ({ default: m.Bills })));
const Staff = lazyPage(() => import("@/pages/Staff"));
const StaffFormPage = lazyPage(() => import("@/pages/StaffFormPage"));
const SettingsPage = lazyPage(() => import("@/pages/Settings"));
const Expenses = lazyPage(() => import("@/pages/Expenses"));
const PurchaseCategories = lazyPage(() => import("@/pages/PurchaseCategories"));
const SalesDocs = lazyPage(() => import("@/pages/sales/SalesDocs"));
const SalesDocForm = lazyPage(() => import("@/pages/sales/SalesDocForm"));
const PaymentsReceived = lazyPage(() => import("@/pages/sales/PaymentsReceived"));
const DocumentSettings = lazyPage(() => import("@/pages/settings/DocumentSettings"));
const Items = lazyPage(() => import("@/pages/items/Items"));
const Debts = lazyPage(() => import("@/pages/sales/Debts"));
const Payables = lazyPage(() => import("@/pages/purchases/Payables"));
const UsersPage = lazyPage(() => import("@/pages/settings/UsersPage"));
const RolesPage = lazyPage(() => import("@/pages/settings/RolesPage"));
const OnlineOrders = lazyPage(() => import("@/pages/sales/OnlineOrders"));
const ShopHome = lazyPage(() => import("@/shop/pages/Home"));
const ShopCatalogue = lazyPage(() => import("@/shop/pages/Catalogue"));
const ShopProduct = lazyPage(() => import("@/shop/pages/ProductPage"));
const ShopCart = lazyPage(() => import("@/shop/pages/CartCheckout").then((m) => ({ default: m.CartPage })));
const ShopCheckout = lazyPage(() => import("@/shop/pages/CartCheckout").then((m) => ({ default: m.CheckoutPage })));
const ShopOrder = lazyPage(() => import("@/shop/pages/CartCheckout").then((m) => ({ default: m.OrderPage })));
const ShopAbout = lazyPage(() => import("@/shop/pages/InfoPages").then((m) => ({ default: m.AboutPage })));
const ShopContact = lazyPage(() => import("@/shop/pages/InfoPages").then((m) => ({ default: m.ContactPage })));
const CrmConfig = lazyPage(() => import("@/pages/crm/CrmConfig"));
const BulkSms = lazyPage(() => import("@/pages/marketing/BulkSms"));
const Requisitions = lazyPage(() => import("@/pages/supply/Requisitions"));
const ErpDashboard = lazyPage(() => import("@/pages/dashboard/ErpDashboard"));
const SalesReps = lazyPage(() => import("@/pages/reps/SalesReps"));
const ZCustomers = lazyPage(() => import("@/pages/customers/Customers"));
const ZCustomerForm = lazyPage(() => import("@/pages/customers/CustomerForm"));
const CustomerPortalPreview = lazyPage(() => import("@/pages/customers/PortalPreview"));
const Reminders = lazyPage(() => import("@/pages/sales/Reminders"));
const ItemForm = lazyPage(() => import("@/pages/items/ItemForm"));
const Suppliers = lazyPage(() => import("@/pages/Suppliers"));
const Payments = lazyPage(() => import("@/pages/Payments"));
const RecordPayment = lazyPage(() => import("@/pages/RecordPayment"));
const CreditBalances = lazyPage(() => import("@/pages/CreditBalances"));
const EmailLogs = lazyPage(() => import("@/pages/EmailLogs"));
const Billing = lazyPage(() => import("@/pages/Billing"));
const OpenBills = lazyPage(() => import("@/pages/OpenBills"));
const VariantStock = lazyPage(() => import("@/pages/VariantStock"));
const Empties = lazyPage(() => import("@/pages/Empties"));
const Exchanges = lazyPage(() => import("@/pages/Exchanges"));
const Returns = lazyPage(() => import("@/pages/Returns"));
const Bills = lazyPage(() => import("@/pages/Bills"));
const Help = lazyPage(() => import("@/pages/Help"));
const WhatsNew = lazyPage(() => import("@/pages/WhatsNew"));
const StockTakes = lazyPage(() => import("@/pages/StockTakes"));
const Layaway = lazyPage(() => import("@/pages/Layaway"));
const WaterTanks = lazyPage(() => import("@/pages/water/Tanks"));
const WaterOrders = lazyPage(() => import("@/pages/water/Orders"));
const WaterReports = lazyPage(() => import("@/pages/water/Reports"));
const WaterProducts = lazyPage(() => import("@/pages/water/Products"));
const RiderApp = lazyPage(() => import("@/pages/water/RiderApp"));
const Tickets = lazyPage(() => import("@/pages/Tickets"));
const OrderPortal = lazyPage(() => import("@/pages/portal/OrderPortal"));
const ShopLanding = lazyPage(() => import("@/pages/portal/ShopLanding"));
const ShopSignIn = lazyPage(() => import("@/pages/portal/ShopSignIn"));
const CustomerLogin = lazyPage(() => import("@/shop/portal/CustomerLogin"));
const CustomerPortal = lazyPage(() => import("@/shop/portal/Portal"));
const DeliveryConfirmation = lazyPage(() => import("@/pages/DeliveryConfirmation"));
const CustomerDisplay = lazyPage(() => import("@/pages/CustomerDisplay"));
const AuditLog = lazyPage(() => import("@/pages/AuditLog"));

const AdminLayout = lazyPage(() => import("@/pages/admin/AdminLayout"));
const AdminDashboard = lazyPage(() => import("@/pages/admin/AdminDashboard"));
const AdminCustomers = lazyPage(() => import("@/pages/admin/AdminCustomers"));
const AdminSubscriptions = lazyPage(() => import("@/pages/admin/AdminSubscriptions"));
const AdminCMS = lazyPage(() => import("@/pages/admin/AdminCMS"));
const AdminSettings = lazyPage(() => import("@/pages/admin/AdminSettings"));
const AdminPayments = lazyPage(() => import("@/pages/admin/AdminPayments"));
const AdminUsers = lazyPage(() => import("@/pages/admin/AdminUsers"));
const AdminAuditLog = lazyPage(() => import("@/pages/admin/AdminAuditLog"));
const AdminUsage = lazyPage(() => import("@/pages/admin/AdminUsage"));
const AdminDomains = lazyPage(() => import("@/pages/admin/AdminDomains"));
const AdminEtimsTokens = lazyPage(() => import("@/pages/admin/AdminEtimsTokens"));
const AdminMessages = lazyPage(() => import("@/pages/admin/AdminMessages"));
const AdminReports = lazyPage(() => import("@/pages/admin/AdminReports"));
const AdminModules = lazyPage(() => import("@/pages/admin/AdminModules"));
const AdminCrm = lazyPage(() => import("@/pages/admin/AdminCrm"));
const AdminNotifications = lazyPage(() => import("@/pages/admin/AdminNotifications"));
const AdminSupport = lazyPage(() => import("@/pages/admin/AdminSupport"));
const ModulesStore = lazyPage(() => import("@/pages/modules/ModulesStore"));
const AppPage = lazyPage(() => import("@/apps/AppPage"));
const Studio = lazyPage(() => import("@/apps/Studio"));
const Companies = lazyPage(() => import("@/pages/companies/Companies"));
const Handoff = lazyPage(() => import("@/pages/Handoff"));
const MigrateImport = lazyPage(() => import("@/pages/migrate/MigrateImport"));
const CallCentrePage = lazyPage(() => import("@/pages/callcentre/CallCentre"));
const WhLocations = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.Warehouses })));
const WhReceive = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.ReceiveStock })));
const WhTransfers = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.Transfers })));
const WhPackages = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.Packages })));
const WhShipments = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.Shipments })));
const WhReorder = lazyPage(() => import("@/pages/warehouse/Warehouse").then((m) => ({ default: m.Reorder })));
const RfqsPage = lazyPage(() => import("@/pages/supply/SupplyChain").then((m) => ({ default: m.Rfqs })));
const LandedCostsPage = lazyPage(() => import("@/pages/supply/SupplyChain").then((m) => ({ default: m.LandedCosts })));
const SamplesPage = lazyPage(() => import("@/pages/samples/Samples"));
const BranchesPage = lazyPage(() => import("@/pages/branches/Branches"));
const SignaturesPage = lazyPage(() => import("@/pages/settings/Signatures"));
const CrmVisits = lazyPage(() => import("@/pages/crm/Visits"));
const RecurringInvoices = lazyPage(() => import("@/pages/sales/RecurringInvoices"));
const DashAIPage = lazyPage(() => import("@/components/dashai/DashAI"));
const ChartOfAccounts = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.ChartOfAccounts })));
const AccountLedger = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.AccountLedger })));
const ManualJournals = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.ManualJournals })));
const Banking = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.Banking })));
const FinancialStatements = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.FinancialStatements })));
const OpeningBalances = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.OpeningBalances })));
const Budgets = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.Budgets })));
const TransactionLocking = lazyPage(() => import("@/pages/accounting/Accounting").then((m) => ({ default: m.TransactionLocking })));
const SignDocument = lazyPage(() => import("@/pages/public/SignDocument"));
const ContractLink = lazyPage(() => import("@/pages/public/ContractLink"));
const PayInvoice = lazyPage(() => import("@/pages/public/PayInvoice"));
const VatReturnPage = lazyPage(() => import("@/pages/reports/VatReturn"));
const ContractsPage = lazyPage(() => import("@/pages/contracts/Contracts"));
const NotebookPage = lazyPage(() => import("@/pages/notebook/Notebook"));
const BookPage = lazyPage(() => import("@/pages/public/PublicEngage").then((m) => ({ default: m.BookPage })));
const EventsPage = lazyPage(() => import("@/pages/public/PublicEngage").then((m) => ({ default: m.EventsPage })));
const LearnPage = lazyPage(() => import("@/pages/public/PublicEngage").then((m) => ({ default: m.LearnPage })));
const StaffJoin = lazyPage(() => import("@/pages/public/HrPublic").then((m) => ({ default: m.StaffJoin })));
const CareersPage = lazyPage(() => import("@/pages/public/HrPublic").then((m) => ({ default: m.CareersPage })));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fast by default: screens render straight from cache and stay live via
      // the shop-wide realtime listener (useRealtimeSync) instead of every
      // screen re-fetching on a timer, which used to slow the whole app down.
      // Screens show cached data instantly and refresh in the background when
      // opened if it is older than 15s; live updates cover changes in between.
      staleTime: 1000 * 15,
      gcTime: 1000 * 60 * 60,
      retry: 1,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: "offlineFirst",
    },
    // Saves run even offline: the database client keeps them on the device and sends them later.
    mutations: { networkMode: "always" },
  },
});

// Offline mode: changes made without internet are sent when it is back (only into this address's
// company); then every screen refreshes.
startOutbox();
installOutboxGuard();
if (typeof window !== "undefined") window.addEventListener("dash-outbox-synced", () => { void queryClient.invalidateQueries(); });

// Pages open from the last copy kept in this browser (no empty flash before data
// arrives), then refresh quietly. Only small, often-used data is kept, for 24 hours,
// and it is cleared on sign-out.
const PERSIST_KEYS = new Set(["books-overview", "business-settings", "my-modules", "role-permissions", "tenant-features", "subscription", "subscription-limits",
  "dash-home", "dash-item-pics", "sales-lines", "my-companies", "my-linked-companies", "app-definitions-nav", "approvals-badge",
  "billing-feature-overrides", "locations", "user-locations", "erp-settings", "crm-config"]);
export const CACHE_KEY = "dash-cache-v1";
// The older, smaller copy in localStorage is no longer used (lists now live in IndexedDB: lib/queryPersist.ts).
try { localStorage.removeItem(CACHE_KEY); } catch { /* blocked */ }
void PERSIST_KEYS;

// Instrument react-query for the admin Performance Diagnostics view
import("@/lib/perfMetrics").then(({ recordQuery }) => {
  const startTimes = new Map<string, number>();
  queryClient.getQueryCache().subscribe((evt: any) => {
    const key = JSON.stringify(evt?.query?.queryKey ?? []);
    if (evt?.type === "updated" && evt?.action?.type === "fetch") {
      startTimes.set(key, performance.now());
    } else if (evt?.type === "updated" && (evt?.action?.type === "success" || evt?.action?.type === "error")) {
      const t0 = startTimes.get(key);
      if (t0 != null) {
        recordQuery({ key, ms: performance.now() - t0, at: Date.now(), ok: evt.action.type === "success" });
        startTimes.delete(key);
      }
    }
  });
});

function PageLoader() {
  useBootCover();
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <Orb state="working" label="Loading" />
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-background text-center px-6">
      <p className="text-muted-foreground text-sm">We could not load your company. Please check your connection.</p>
      <button onClick={onRetry} className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
        Try again
      </button>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role, profileReady, subscription, profile } = useAuth();
  const { tenant, loading: tenantLoading, refetch } = useTenant();
  const { hasPermission, getDefaultRoute, ready: permsReady } = usePermissions();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const loginPath = useTenantLoginPath();
  const lock = useSubscriptionLock();
  // Two-step sign-in: an account with an authenticator must pass the code once per session.
  const { data: aal, refetch: refetchAal } = useQuery({
    queryKey: ["aal", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data,
  });

  // The platform owner opened this company from Admin after two-step sign-in there (support pass).
  const { data: supportPass } = useQuery({
    queryKey: ["support-pass", user?.id, aal?.currentLevel],
    enabled: !!user && !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2",
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("support_pass_ok");
      return !error && data === true;
    },
  });
  const { data: platformOwner } = useQuery({
    queryKey: ["is-platform-admin", user?.id],
    enabled: !!user && lock !== "open",
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("is_platform_admin");
      return !error && data === true;
    },
  });

  // Signing in resolves the account and the shop a moment apart. Instead of
  // flashing an error in that gap, keep loading and quietly try again a few
  // times; only a genuinely unreachable shop reaches the error screen.
  const gap = Boolean(user) && profileReady && (!role || (!!profile?.tenant_id && !tenant));
  // A lookup still on its way is left to finish: trying again would only cancel it.
  const unresolved = gap && !tenantLoading;
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!gap) { if (attempts !== 0) setAttempts(0); return; }
    if (!unresolved || attempts >= 3) return;
    const t = setTimeout(() => { setAttempts((n) => n + 1); refetch(); }, 1200);
    return () => clearTimeout(t);
  }, [gap, unresolved, attempts, refetch]);

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={loginPath} replace />;
  // Wait for the account details, but never spin forever if they fail to load.
  if (!profileReady) return <PageLoader />;
  // Only block on the very first shop lookup. Later background refreshes must
  // never tear the page down, otherwise the screen flashes blank.
  if (tenantLoading && !tenant) return <PageLoader />;
  if (unresolved) {
    if (attempts < 3) return <PageLoader />;
    return <LoadFailed onRetry={() => window.location.reload()} />;
  }

  const needsCode = !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  if (needsCode && supportPass === undefined) return <PageLoader />;
  if (needsCode && !supportPass) return <Suspense fallback={<PageLoader />}><MfaGate onDone={() => void refetchAal()} /></Suspense>;
  if (role === "super_admin") return <>{children}</>;

  // The platform owner (support, opened from Admin) works in an ended company; its own people
  // still go to Billing. Checked by the database, so it cannot be claimed from the browser.
  if (lock !== "open" && platformOwner === undefined) return <PageLoader />;
  if (lock !== "open" && platformOwner) return <>{children}</>;

  // Package or trial ended (or the shop was suspended): owners and managers
  // wait on Billing until they pay, everyone else is signed out.
  if (lock === "suspended") return <SubscriptionExpired />;
  if (lock === "expired") {
    if (role && RENEWAL_ROLES.includes(role)) return <Navigate to={slug ? `/${slug}/billing` : "/billing"} replace />;
    return <ExpiredSignOut loginPath={loginPath} />;
  }

  const pathForPerm = slug
    ? location.pathname.replace(`/${slug}`, "")
    : location.pathname;
  const permKey = ROUTE_PERMISSION_MAP[pathForPerm] || ROUTE_PERMISSION_MAP[location.pathname];
  // Permissions still loading (e.g. after a refresh): wait instead of bouncing the page.
  if (permKey && !permsReady) return <PageLoader />;
  if (permKey && !hasPermission(permKey)) {
    const defaultRoute = slug ? `/${slug}${getDefaultRoute()}` : getDefaultRoute();
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}

/** Signs staff out of a shop whose package has ended, with a note on the sign-in page. */
function ExpiredSignOut({ loginPath }: { loginPath: string }) {
  const { signOut } = useAuth();
  useEffect(() => {
    void signOut().finally(() => {
      window.location.replace(`${loginPath}${loginPath.includes("?") ? "&" : "?"}expired=1`);
    });
    // Runs once: signOut is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <PageLoader />;
}

function BillingRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loginPath = useTenantLoginPath();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={loginPath} replace />;
  return <>{children}</>;
}

function InlinePageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Orb state="working" label="Loading" />
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <TenantSlugGuard>
      <AppLayout>
        <PageBoundary><Suspense fallback={<InlinePageLoader />}>{children}</Suspense></PageBoundary>
      </AppLayout>
    </TenantSlugGuard>
  </ProtectedRoute>
);

/** Signed-in page without the sidebar layout (rider phone screen). */
const Bare = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <TenantSlugGuard>
      <PageBoundary><Suspense fallback={<InlinePageLoader />}>{children}</Suspense></PageBoundary>
    </TenantSlugGuard>
  </ProtectedRoute>
);

const tenantRoutes = [
  { path: "dashboard", element: <P><ErpDashboard /></P> },
  { path: "dashboard/today", element: <P><Dashboard /></P> },
  { path: "pos", element: <P><PointOfSale /></P> },
  { path: "inventory", element: <P><Navigate to="products" replace /></P> },
  { path: "inventory/products", element: <P><Items /></P> },
  { path: "inventory/products/:id", element: <P><Items /></P> },
  { path: "inventory/stock", element: <P><Inventory /></P> },
  { path: "inventory/products/new", element: <P><ItemForm /></P> },
  { path: "inventory/products/:id/edit", element: <P><ItemForm /></P> },
  { path: "inventory/services", element: <P><Navigate to="/inventory/products?view=service" replace /></P> },
  { path: "inventory/transfer", element: <P><StockTransfer /></P> },
  { path: "inventory/taxonomy", element: <P><InventoryTaxonomy /></P> },
  { path: "inventory/price-lists", element: <P><PriceLists /></P> },
  { path: "inventory/composite-items", element: <P><CompositeItems /></P> },
  { path: "inventory/batches", element: <P><InventoryBatches /></P> },
  { path: "inventory/serials", element: <P><SerialNumbers /></P> },
  { path: "inventory/adjustments", element: <P><Adjustments /></P> },
  { path: "inventory/adjustments/new", element: <P><AdjustmentForm /></P> },
  { path: "inventory/adjustments/:id", element: <P><Adjustments /></P> },
  { path: "inventory/adjustments/:id/edit", element: <P><AdjustmentForm /></P> },
  { path: "customers", element: <P><ZCustomers /></P> },
  { path: "customers/new", element: <P><ZCustomerForm /></P> },
  { path: "customers/:id/edit", element: <P><ZCustomerForm /></P> },
  { path: "customers/:id/portal-view", element: <Bare><CustomerPortalPreview /></Bare> },
  { path: "customers/:id/portal-view/:section", element: <Bare><CustomerPortalPreview /></Bare> },
  { path: "sales/quotes", element: <P><SalesDocs kind="quote" /></P> },
  { path: "sales/quotes/new", element: <P><SalesDocForm kind="quote" /></P> },
  { path: "sales/quotes/:id", element: <P><SalesDocs kind="quote" /></P> },
  { path: "sales/quotes/:id/edit", element: <P><SalesDocForm kind="quote" /></P> },
  { path: "sales/orders", element: <P><SalesDocs kind="sales_order" /></P> },
  { path: "sales/orders/new", element: <P><SalesDocForm kind="sales_order" /></P> },
  { path: "sales/orders/:id", element: <P><SalesDocs kind="sales_order" /></P> },
  { path: "sales/orders/:id/edit", element: <P><SalesDocForm kind="sales_order" /></P> },
  { path: "sales/recurring", element: <P><RecurringInvoices /></P> },
  { path: "purchases/recurring-bills", element: <P><RecurringInvoices kind="bill" /></P> },
  { path: "purchases/recurring-expenses", element: <P><RecurringInvoices kind="expense" /></P> },
  { path: "sales/invoices", element: <P><SalesDocs kind="invoice" /></P> },
  { path: "sales/invoices/new", element: <P><SalesDocForm kind="invoice" /></P> },
  { path: "sales/invoices/:id", element: <P><SalesDocs kind="invoice" /></P> },
  { path: "sales/invoices/:id/edit", element: <P><SalesDocForm kind="invoice" /></P> },
  { path: "sales/payments", element: <P><PaymentsReceived /></P> },
  { path: "sales/debts", element: <P><Debts /></P> },
  { path: "sales/online-orders", element: <P><OnlineOrders /></P> },
  { path: "sales-reps", element: <P><SalesReps /></P> },
  { path: "crm", element: <P><CrmHome /></P> },
  { path: "crm/leads", element: <P><CrmRecordList module="leads" /></P> },
  { path: "crm/contacts", element: <P><CrmRecordList module="contacts" /></P> },
  { path: "crm/accounts", element: <P><CrmRecordList module="accounts" /></P> },
  { path: "crm/deals", element: <P><CrmRecordList module="deals" /></P> },
  { path: "crm/webforms", element: <P><CrmWebForms /></P> },
  { path: "crm/:module/:id", element: <P><CrmRecordDetail /></P> },
  // Older addresses: the pipeline board is the deals board now; lead pages moved under /crm/leads.
  { path: "crm/pipeline", element: <Navigate to="/crm/deals?mode=board" replace /> },
  { path: "crm/lead/:id", element: <P><CrmLeadRedirect /></P> },
  { path: "crm/activities", element: <P><CrmActivities /></P> },
  { path: "crm/tasks", element: <P><CrmActivities kind="task" /></P> },
  { path: "crm/meetings", element: <P><CrmActivities kind="meeting" /></P> },
  { path: "crm/calls", element: <P><CrmActivities kind="call" /></P> },
  { path: "crm/visits", element: <P><CrmVisits /></P> },
  { path: "crm/forecast", element: <P><CrmForecast /></P> },
  { path: "crm/analysis", element: <P><CrmForecast /></P> },
  { path: "crm/config", element: <P><SystemShell><CrmConfig /></SystemShell></P> },
  { path: "crm/campaigns", element: <P><CrmCampaigns /></P> },
  { path: "calendar", element: <P><CalendarPage /></P> },
  { path: "purchases/receives/new", element: <P><ReceiveForm /></P> },
  { path: "purchases/vendor-credits", element: <P><VendorCredits /></P> },
  { path: "purchases/vendor-credits/:id", element: <P><VendorCredits /></P> },
  { path: "marketing/sms", element: <P><BulkSms /></P> },
  { path: "finance", element: <P><Navigate to="/reports?view=finance" replace /></P> },
  { path: "sales/reminders", element: <P><Reminders /></P> },
  { path: "sales/payments/:id", element: <P><PaymentsReceived /></P> },
  { path: "sales/credit-balances", element: <P><CreditBalances /></P> },
  { path: "sales/credit-notes", element: <P><CreditNotes /></P> },
  { path: "sales/credit-notes/:id", element: <P><CreditNotes /></P> },
  { path: "purchases/payments", element: <P><SupplierPayments /></P> },
  { path: "purchases/payables", element: <P><Payables /></P> },
  { path: "approvals", element: <P><Approvals /></P> },
  { path: "profile", element: <P><ProfilePage /></P> },
  { path: "hrm", element: <P><HrOverview /></P> },
  { path: "hrm/employees", element: <P><HrEmployees /></P> },
  { path: "hrm/employees/:id", element: <P><HrEmployees /></P> },
  { path: "hrm/attendance", element: <P><HrAttendance /></P> },
  { path: "hrm/leave", element: <P><HrLeave /></P> },
  { path: "hrm/payroll", element: <P><HrPayroll /></P> },
  { path: "hrm/loans", element: <P><HrLoans /></P> },
  { path: "hrm/holidays", element: <P><HrHolidays /></P> },
  { path: "hrm/reports", element: <P><Navigate to="/reports?view=people" replace /></P> },
  { path: "hrm/config", element: <P><HrConfig /></P> },
  { path: "hrm/contracts", element: <P><HrContracts /></P> },
  { path: "hrm/movements", element: <P><HrMovements /></P> },
  { path: "hrm/onboarding", element: <P><HrOnboarding /></P> },
  { path: "hrm/exits", element: <P><HrExits /></P> },
  { path: "hrm/memos", element: <P><HrMemos /></P> },
  { path: "hrm/policies", element: <P><HrPolicies /></P> },
  { path: "hrm/casuals", element: <P><HrCasuals /></P> },
  { path: "hrm/timesheets", element: <P><HrTimesheets /></P> },
  { path: "hrm/registrations", element: <P><HrRegistrations /></P> },
  { path: "hrm/events", element: <P><HrEventsPage /></P> },
  { path: "me", element: <P><MySpace /></P> },
  { path: "purchases", element: <P><Navigate to="orders" replace /></P> },
  { path: "sales", element: <P><Navigate to="invoices" replace /></P> },
  { path: "purchases/orders", element: <P><PurchaseOrdersZ /></P> },
  { path: "purchases/orders/:id", element: <P><PurchaseOrdersZ /></P> },
  { path: "purchases/receives", element: <P><PurchaseReceives /></P> },
  { path: "purchases/bills/:id", element: <P><BillsZ /></P> },
  { path: "purchases/requisitions", element: <P><Requisitions /></P> },
  { path: "purchases/requisitions/:id", element: <P><Requisitions /></P> },
  { path: "purchases/requisitions/:id/edit", element: <P><Requisitions /></P> },
  { path: "purchases/expenses", element: <P><Expenses /></P> },
  { path: "purchases/expenses/:id", element: <P><Expenses /></P> },
  { path: "purchases/bills", element: <P><BillsZ /></P> },
  { path: "purchases/categories", element: <P><PurchaseCategories /></P> },
  { path: "purchases/suppliers", element: <P><SuppliersZ /></P> },
  { path: "purchases/suppliers/:id", element: <P><SuppliersZ /></P> },
  { path: "purchases/suppliers/:id/edit", element: <P><SuppliersZ /></P> },
  { path: "documents", element: <P><DocumentsPage /></P> },
  { path: "payments", element: <P><Payments /></P> },
  { path: "payments/record", element: <P><RecordPayment /></P> },
  { path: "email-logs", element: <P><EmailLogs /></P> },
  { path: "reports", element: <P><Reports /></P> },
  // The old separate report pages are now tabs of /reports.
  { path: "reports/sales", element: <P><Reports /></P> },
  { path: "reports/purchases", element: <P><Reports /></P> },
  { path: "reports/expenses-bills", element: <P><Reports /></P> },
  { path: "reports/stock-expiry", element: <P><Reports /></P> },
  { path: "reports/per-product", element: <P><Reports /></P> },
  // AI analytics is switched off for now.
  { path: "ai-analysis", element: <P><Reports /></P> },
  { path: "staff", element: <P><SystemShell><Staff /></SystemShell></P> },
  { path: "staff/new", element: <P><StaffFormPage /></P> },
  { path: "staff/:id/edit", element: <P><StaffFormPage /></P> },
  { path: "settings", element: <P><SettingsPage /></P> },
  { path: "settings/documents", element: <P><SystemShell><DocumentSettings /></SystemShell></P> },
  { path: "settings/signatures", element: <P><SystemShell><SignaturesPage /></SystemShell></P> },
  { path: "settings/users", element: <P><SystemShell><UsersPage /></SystemShell></P> },
  { path: "settings/roles", element: <P><SystemShell><RolesPage /></SystemShell></P> },
  { path: "audit-log", element: <P><SystemShell><AuditLog /></SystemShell></P> },
  { path: "billing", element: <BillingRoute><AppLayout><Billing /></AppLayout></BillingRoute> },
  { path: "sales/packing-lists", element: <P><Navigate to="/warehouse/packages" replace /></P> },
  { path: "sales/delivery-notes", element: <P><Navigate to="/warehouse/shipments" replace /></P> },
  { path: "bills/open", element: <P><OpenBills /></P> },
  { path: "inventory/variants", element: <P><VariantStock /></P> },
  { path: "inventory/empties", element: <P><Empties /></P> },
  { path: "sales/exchanges", element: <P><Exchanges /></P> },
  { path: "sales/returns", element: <P><Returns /></P> },
  { path: "help", element: <P><Help /></P> },
  { path: "whats-new", element: <P><WhatsNew /></P> },
  { path: "inventory/stock-take", element: <P><StockTakes /></P> },
  { path: "sales/layaway", element: <P><Layaway /></P> },
  { path: "water/tanks", element: <P><WaterTanks /></P> },
  { path: "water/orders", element: <P><WaterOrders /></P> },
  { path: "water/delivered", element: <P><WaterOrders view="done" /></P> },
  { path: "water/products", element: <P><WaterProducts /></P> },
  // The website editor is a tab of Settings now.
  { path: "water/website", element: <P><Navigate to="../../settings?tab=website" relative="path" replace /></P> },
  { path: "water/reports", element: <P><WaterReports /></P> },
  { path: "tickets", element: <P><Tickets /></P> },
  { path: "rider", element: <Bare><RiderApp section="dashboard" /></Bare> },
  { path: "rider/orders", element: <Bare><RiderApp section="orders" /></Bare> },
  { path: "rider/delivered", element: <Bare><RiderApp section="delivered" /></Bare> },
  { path: "rider/map", element: <Bare><RiderApp section="map" /></Bare> },
  { path: "rider/tickets", element: <Bare><RiderApp section="tickets" /></Bare> },
  { path: "rider/settings", element: <Bare><RiderApp section="settings" /></Bare> },
  { path: "customers/:id", element: <P><ZCustomers /></P> },
  { path: "modules", element: <P><ModulesStore /></P> },
  { path: "import", element: <P><MigrateImport /></P> },
  { path: "ai", element: <P><DashAIPage /></P> },
  { path: "migrate", element: <P><MigrateImport /></P> },
  { path: "callcentre", element: <P><CallCentrePage /></P> },
  { path: "warehouse/locations", element: <P><WhLocations /></P> },
  { path: "warehouse/receive", element: <P><WhReceive /></P> },
  { path: "warehouse/transfers", element: <P><WhTransfers /></P> },
  { path: "warehouse/packages", element: <P><WhPackages /></P> },
  { path: "warehouse/shipments", element: <P><WhShipments /></P> },
  { path: "warehouse/reorder", element: <P><WhReorder /></P> },
  { path: "purchases/rfqs", element: <P><RfqsPage /></P> },
  { path: "purchases/landed-costs", element: <P><LandedCostsPage /></P> },
  { path: "sales/samples", element: <P><SamplesPage /></P> },
  { path: "branches", element: <P><BranchesPage /></P> },
  { path: "accounting", element: <P><Navigate to="/accounting/chart-of-accounts" replace /></P> },
  { path: "accounting/chart-of-accounts", element: <P><RequireModule module="accounting"><ChartOfAccounts /></RequireModule></P> },
  { path: "accounting/chart-of-accounts/:id", element: <P><RequireModule module="accounting"><AccountLedger /></RequireModule></P> },
  { path: "accounting/journals", element: <P><RequireModule module="accounting"><ManualJournals /></RequireModule></P> },
  { path: "accounting/banking", element: <P><RequireModule module="accounting"><Banking /></RequireModule></P> },
  { path: "accounting/banking/:id", element: <P><RequireModule module="accounting"><Banking /></RequireModule></P> },
  { path: "accounting/statements", element: <P><RequireModule module="accounting"><FinancialStatements /></RequireModule></P> },
  { path: "accounting/opening-balances", element: <P><RequireModule module="accounting"><OpeningBalances /></RequireModule></P> },
  { path: "accounting/budgets", element: <P><RequireModule module="accounting"><Budgets /></RequireModule></P> },
  { path: "accounting/lock", element: <P><RequireModule module="accounting"><TransactionLocking /></RequireModule></P> },
  { path: "accounting/vat-return", element: <P><RequireModule module="accounting"><VatReturnPage /></RequireModule></P> },
  { path: "companies", element: <P><Companies /></P> },
  { path: "apps/studio", element: <P><Studio /></P> },
  { path: "notebook", element: <P><NotebookPage /></P> },
  { path: "contracts", element: <P><ContractsPage /></P> },
  { path: "contracts/:id", element: <P><ContractsPage /></P> },
  ...GARAGE_ROUTES.map((r) => ({ path: r.path, element: r.bare ? <Bare><r.page /></Bare> : <P><r.page /></P> })),
  { path: "apps/:app", element: <P><AppPage /></P> },
  { path: "apps/:app/:kind", element: <P><AppPage /></P> },
  { path: "apps/:app/:kind/:id", element: <P><AppPage /></P> },
];
registerRoutes(tenantRoutes);

const App = () => (
  <PersistQueryClientProvider client={queryClient} persistOptions={{
    persister: devicePersister, maxAge: 24 * 3600_000, buster: "v2",
    dehydrateOptions: { shouldDehydrateQuery: keepOnDevice },
  }}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <RouteTracker />
        <AuthProvider>
          <TenantProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Home of each address */}
            <Route path="/" element={
              PLATFORM_MODE ? <Navigate to="/admin" replace />
                : APP_MODE ? <AppRoot />
                  : COMPANY_MODE ? <CompanyRoot />
                    : <Landing />
            } />

            {/* A company's website + online shop (eCommerce / Website modules) */}
            <Route path="/shop" element={<Site><ShopCatalogue /></Site>} />
            <Route path="/shop/p/:id" element={<Site><ShopProduct /></Site>} />
            <Route path="/services" element={<Site><ShopCatalogue servicesOnly /></Site>} />
            <Route path="/about" element={<Site><ShopAbout /></Site>} />
            <Route path="/contact" element={<Site><ShopContact /></Site>} />
            <Route path="/cart" element={<Site><ShopCart /></Site>} />
            <Route path="/checkout" element={<Site><ShopCheckout /></Site>} />
            <Route path="/order/:id" element={<Site><ShopOrder /></Site>} />

            {/* Customer portal (switched on per company in System → Customer portal) */}
            <Route path="/account" element={<Site><CustomerPortal /></Site>} />
            <Route path="/account/:section" element={<Site><CustomerPortal /></Site>} />
            <Route path="/portal" element={<Site><CustomerPortal /></Site>} />
            <Route path="/portal/login" element={<Site><CustomerLogin /></Site>} />
            <Route path="/customer-login" element={<Site><CustomerLogin /></Site>} />
            <Route path="/signin" element={<Site><CustomerLogin /></Site>} />

            {/* Sign-in: staff on a company address, "find my company" elsewhere */}
            <Route path="/login" element={COMPANY_MODE ? <TenantLogin /> : <Login />} />
            <Route path="/staff-login" element={COMPANY_MODE ? <TenantLogin /> : <Login />} />
            <Route path="/auth/handoff" element={<Handoff />} />
            <Route path="/register" element={<Register />} />
            <Route path="/signup" element={<Navigate to="/register" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            {GARAGE_PUBLIC_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<r.page />} />)}
            <Route path="/terms" element={<Legal />} />
            <Route path="/privacy" element={<Legal />} />
            <Route path="/status" element={<Status />} />
            <Route path="/photo-credits" element={<PhotoCredits />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/features" element={<Landing />} />
            <Route path="/solutions/:key" element={<Solution />} />
            <Route path="/solutions" element={<Solutions />} />
            <Route path="/api/demo/start" element={<DemoStart />} />
            <Route path="/subscription-expired" element={<SubscriptionExpired />} />
            <Route path="/delivery-confirm/:noteId" element={<DeliveryConfirmation />} />
            <Route path="/sign/:id" element={<SignDocument />} />
            <Route path="/contract/:token" element={<ContractLink />} />
            {/* Public company pages: online booking, events, learner links */}
            <Route path="/book" element={<Site><BookPage /></Site>} />
            <Route path="/events" element={<Site><EventsPage /></Site>} />
            <Route path="/learn" element={<Site><LearnPage /></Site>} />
            <Route path="/careers" element={<Site><CareersPage /></Site>} />
            {/* A new hire sends their details from HR's invite link (no login). */}
            <Route path="/join/:token" element={<StaffJoin />} />
            {/* A customer pays an invoice from its payment link (no login). */}
            <Route path="/pay/:token" element={<PayInvoice />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

            {/* Company address or app.: clean, slug-free routes */}
            {WORKSPACE_MODE && <Route path="/pos/display/:sessionId" element={<CustomerDisplay />} />}
            {WORKSPACE_MODE && tenantRoutes.map(r => (
              <Route key={`host-${r.path}`} path={`/${r.path}`} element={r.element} />
            ))}
            <Route path="/pos/display/local/:sessionId" element={<CustomerDisplay />} />

            {/* Platform super admin (admin.garage.jmsurf.co.ke) */}
            <Route path="/admin" element={<PlatformOnly><AdminLayout /></PlatformOnly>}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="customers" element={<AdminCustomers />} />
              <Route path="subscriptions" element={<AdminSubscriptions />} />
              <Route path="modules" element={<AdminModules />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="cms" element={<AdminCMS />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="audit" element={<AdminAuditLog />} />
              <Route path="usage" element={<AdminUsage />} />
              <Route path="diagnostics" element={<Navigate to="/admin/health" replace />} />
              <Route path="health" element={<AdminHealth />} />
              <Route path="domains" element={<AdminDomains />} />
              <Route path="etims-tokens" element={<AdminEtimsTokens />} />
              <Route path="messages" element={<AdminMessages />} />
              <Route path="leads" element={<AdminCrm />} />
              <Route path="notifications" element={<AdminNotifications />} />
              <Route path="support" element={<AdminSupport />} />
              <Route path="account" element={<div className="p-4 sm:p-6"><ProfilePage /></div>} />
            </Route>

            {/* Local development: /<slug>/... */}
            {DEV_MODE && <Route path="/:slug/login" element={<TenantLogin />} />}
            {DEV_MODE && tenantRoutes.map(r => (
              <Route key={`slug-${r.path}`} path={`/:slug/${r.path}`} element={r.element} />
            ))}
            {DEV_MODE && <Route path="/:slug" element={<TenantSlugRedirect />} />}

            {/* Company pages opened on the website: the workspace runs on app. */}
            {!WORKSPACE_MODE && !DEV_MODE && <Route path="/dashboard" element={<GoTo origin={APP_ORIGIN} />} />}

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </TenantProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </PersistQueryClientProvider>
);

export default App;
