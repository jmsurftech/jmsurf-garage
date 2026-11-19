import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { legacyKeys } from "@/lib/permissionCatalog";

// Default permissions for standard roles when DB hasn't been configured yet
const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  manager: {
    hrm: true, documents: true, dashboard: true, pos: true, customers: true, sales: true, quotes: true,
    invoices: true, inventory: true, purchases: true, expenses: true, bills: true,
    reports: true, staff: true, settings: true, billing: true, packing: true, delivery: true,
  },
  finance: {
    dashboard: true, documents: true, customers: true, sales: true, quotes: true, invoices: true,
    purchases: true, expenses: true, bills: true, reports: true, billing: true,
  },
  customer_service: {
    dashboard: true, documents: true, customers: true, sales: true, quotes: true, invoices: true,
  },
  cashier: {
    pos: true, customers: true, sales: true, invoices: true, quotes: true,
    // Cashiers get the Staff page so they can start and close their own shifts.
    staff: true,
    // Reception at a water shop is usually the cashier: delivery orders.
    delivery: true,
  },
  stock_manager: {
    dashboard: true, inventory: true, purchases: true, expenses: true,
    reports: true, packing: true,
  },
  rider: {
    delivery: true,
  },
  packaging: {
    packing: true,
  },
  sales_person: {
    pos: true, customers: true, sales: true, invoices: true, quotes: true,
    packing: true, delivery: true,
  },
};

export function usePermissions() {
  const { role } = useAuth();

  const { data: permissions = {}, isLoading: permissionsLoading } = useQuery({
    queryKey: ["role-permissions", role],
    staleTime: 10 * 60_000,
    enabled: !!role,
    queryFn: async () => {
      if (role === "super_admin" || role === "admin") {
        return {} as Record<string, boolean>;
      }
      // A company role (Settings → Users & Roles) decides everything for its users.
      const { data: mine } = await (supabase as any).rpc("my_company_role");
      if (mine?.id) {
        const granular = (mine.permissions || {}) as Record<string, boolean>;
        return { ...legacyKeys(granular), ...granular, __scope: mine.data_scope || "all" } as Record<string, any>;
      }
      const { data, error } = await supabase
        .from("role_permissions")
        .select("permission, allowed")
        .eq("role", role!);
      if (error) throw error;
      // Merge defaults with DB overrides
      const defaults = DEFAULT_ROLE_PERMISSIONS[role!] || {};
      const map: Record<string, boolean> = { ...defaults };
      (data || []).forEach((r: any) => {
        map[r.permission] = r.allowed;
      });
      return map;
    },
  });

  const hasPermission = (permission: string): boolean => {
    if (!role) return false;
    // Admin and super_admin always have access
    if (role === "admin" || role === "super_admin") return true;
    // Deny access while loading to prevent flash of unauthorized content
    if (permissionsLoading) return false;
    return permissions[permission] ?? false;
  };

  // Get the first allowed route for redirection
  const getDefaultRoute = (): string => {
    if (!role) return "/dashboard";
    if (role === "admin" || role === "super_admin") return "/dashboard";
    // Riders work from their own delivery screen.
    if (role === "rider") return "/rider";

    const routeOrder = [
      { perm: "dashboard", path: "/dashboard" },
      { perm: "pos", path: "/pos" },
      { perm: "sales", path: "/customers" },
      { perm: "inventory", path: "/inventory/products" },
      { perm: "purchases", path: "/purchases/orders" },
      { perm: "reports", path: "/reports" },
      { perm: "delivery", path: "/sales/delivery-notes" },
    ];

    for (const r of routeOrder) {
      if (permissions[r.perm]) return r.path;
    }
    return "/pos"; // fallback for cashiers
  };

  /** One action on one thing, e.g. can("invoices", "void"), can("reports.sales", "export"). Owners can do everything. */
  const can = (resource: string, action = "view"): boolean => {
    if (role === "admin" || role === "super_admin") return true;
    if (permissionsLoading) return false;
    const k = `${resource}.${action}`;
    if (k in permissions) return !!permissions[k];
    // Not a company role: fall back to the older switches for that area.
    return !!permissions[resource] || !!permissions[resource.split(".")[0]];
  };
  /** What records the person sees: all, only their own, or only their assigned customers'. */
  const scope = ((permissions as any).__scope || "all") as "all" | "own" | "assigned";

  // Owners see everything; other roles are known once their permissions load.
  const ready = !!role && (role === "admin" || role === "super_admin" || !permissionsLoading);
  return { hasPermission, can, scope, getDefaultRoute, permissions, ready };
}

// Map routes to permission keys
export const ROUTE_PERMISSION_MAP: Record<string, string> = {

  "/documents": "documents",
  "/inventory/adjustments": "inventory",
  "/purchases/vendor-credits": "purchases",
  "/crm/deals": "sales",
  "/calendar": "dashboard",
  "/purchases/receives": "purchases",
  "/sales/credit-notes": "invoices",
  "/purchases/payments": "purchases",
  "/purchases/payables": "purchases",
  "/hrm": "hrm",
  "/hrm/employees": "hrm",


  "/hrm/payroll": "hrm",
  "/hrm/loans": "hrm",
  "/hrm/holidays": "hrm",
  "/hrm/contracts": "hrm",
  "/hrm/movements": "hrm",
  "/hrm/onboarding": "hrm",
  "/hrm/exits": "hrm",
  "/hrm/timesheets": "hrm",
  "/hrm/casuals": "hrm",
  "/hrm/memos": "hrm",
  "/hrm/policies": "hrm",
  "/hrm/registrations": "hrm",
  "/hrm/events": "hrm",
  "/me": "dashboard",
  "/hrm/reports": "hrm",
  "/hrm/config": "settings",
  "/crm/campaigns": "sales",
  "/crm/contacts": "sales",
  "/tickets": "sales",
  "/dashboard": "dashboard",
  "/pos": "pos",
  "/customers": "customers",
  "/sales/quotes": "quotes",
  "/sales/invoices": "invoices",
  "/sales/credit-balances": "sales",
  "/sales/debts": "sales",
  "/sales/online-orders": "sales",
  "/sales-reps": "sales",
  "/finance": "reports",
  "/marketing/sms": "settings",
  "/crm": "sales",
  "/crm/leads": "sales",
  "/crm/activities": "sales",
  "/crm/forecast": "sales",
  "/crm/analysis": "sales",
  "/crm/config": "settings",
  "/sales/reminders": "sales",
  "/payments": "sales",
  "/inventory/products": "inventory",
  "/inventory/services": "inventory",
  "/inventory/transfer": "inventory",
  "/inventory/stock": "inventory",
  "/purchases/orders": "purchases",
  "/purchases/requisitions": "purchases",
  "/purchases/expenses": "expenses",
  "/purchases/bills": "bills",
  "/purchases/recurring-bills": "bills",
  "/purchases/recurring-expenses": "expenses",
  "/purchases/suppliers": "purchases",
  "/reports": "reports",
  "/accounting/vat-return": "reports",
  "/reports/sales": "reports",
  "/reports/purchases": "reports",
  "/reports/expenses-bills": "reports",
  "/reports/stock-expiry": "reports",
  "/reports/per-product": "reports",
  "/email-logs": "communication",
  "/communication": "sales",
  "/staff": "staff",
  "/settings": "settings",
  "/billing": "billing",
  "/audit-log": "settings",
  "/sales/delivery-notes": "delivery",
  "/sales/packing-lists": "packing",
  "/water/tanks": "inventory",
  "/water/orders": "delivery",
  "/water/reports": "reports",
  "/water/delivered": "delivery",
  "/water/website": "settings",
  "/water/products": "inventory",
  "/rider": "delivery",
  "/rider/orders": "delivery",
  "/rider/delivered": "delivery",
  "/rider/map": "delivery",
  "/rider/tickets": "delivery",
  "/rider/settings": "delivery",
};

// Map nav items to permission keys
export const NAV_PERMISSION_MAP: Record<string, string> = {

  "/documents": "documents",
  "/inventory/adjustments": "inventory",
  "/crm/deals": "sales",
  "/calendar": "dashboard",
  "/purchases/receives": "purchases",
  "/sales/credit-notes": "invoices",
  "/purchases/payments": "purchases",
  "/purchases/payables": "purchases",
  "/hrm": "hrm",
  "/hrm/employees": "hrm",


  "/hrm/payroll": "hrm",
  "/hrm/loans": "hrm",
  "/hrm/holidays": "hrm",
  "/hrm/contracts": "hrm",
  "/hrm/movements": "hrm",
  "/hrm/onboarding": "hrm",
  "/hrm/exits": "hrm",
  "/hrm/timesheets": "hrm",
  "/hrm/casuals": "hrm",
  "/hrm/memos": "hrm",
  "/hrm/policies": "hrm",
  "/hrm/registrations": "hrm",
  "/hrm/events": "hrm",
  "/me": "dashboard",
  "/hrm/reports": "hrm",
  "/hrm/config": "settings",
  "/crm/campaigns": "sales",
  "/crm/contacts": "sales",
  "/tickets": "sales",
  "/": "dashboard",
  "/pos": "pos",
  "/sales": "sales",
  "/inventory": "inventory",
  "/purchases": "purchases",
  "/reports": "reports",
  "/accounting/vat-return": "reports",
  "/reports/sales": "reports",
  "/reports/purchases": "reports",
  "/reports/expenses-bills": "reports",
  "/reports/stock-expiry": "reports",
  "/reports/per-product": "reports",
  "/comms": "communication",
  "/email-logs": "communication",
  "/staff": "staff",
  "/settings": "settings",
  "/billing": "billing",
  "/audit-log": "settings",
  "/communication": "sales",
  "/customers": "customers",
  "/sales/quotes": "quotes",
  "/sales/invoices": "invoices",
  "/sales/credit-balances": "sales",
  "/sales/debts": "sales",
  "/sales/online-orders": "sales",
  "/sales-reps": "sales",
  "/finance": "reports",
  "/marketing/sms": "settings",
  "/crm": "sales",
  "/crm/leads": "sales",
  "/crm/activities": "sales",
  "/crm/forecast": "sales",
  "/crm/analysis": "sales",
  "/crm/config": "settings",
  "/sales/reminders": "sales",
  "/sales/packing-lists": "packing",
  "/sales/delivery-notes": "delivery",
  "/payments": "sales",
  "/inventory/products": "inventory",
  "/inventory/services": "inventory",
  "/inventory/transfer": "inventory",
  "/inventory/stock": "inventory",
  "/purchases/suppliers": "purchases",
  "/purchases/orders": "purchases",
  "/purchases/requisitions": "purchases",
  "/purchases/expenses": "expenses",
  "/purchases/bills": "bills",
  "/purchases/recurring-bills": "bills",
  "/purchases/recurring-expenses": "expenses",
  "/water/tanks": "inventory",
  "/water/orders": "delivery",
  "/water/reports": "reports",
  "/water/delivered": "delivery",
  "/water/website": "settings",
  "/water/products": "inventory",
  "/rider": "delivery",
};
