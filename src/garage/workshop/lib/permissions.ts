/**
 * Workshop permissions and ready-made roles (service advisor, mechanic, foreman, storekeeper).
 * Added to the shared catalogue (src/lib/permissionCatalog.ts) when the workshop area loads, so they
 * show in Settings → Users & Roles like every other permission. Owners and admins can do everything.
 */
import { PERMISSION_GROUPS, PRESET_ROLES, type Group, type Perms } from "@/lib/permissionCatalog";

const CRUD = ["view", "create", "edit", "delete"] as const;
const CRUDA = ["view", "create", "edit", "delete", "approve"] as const;

export const WORKSHOP_PERMISSION_GROUP: Group = {
  key: "garage_workshop", label: "Workshop", resources: [
    { key: "garage_jobs", label: "Job cards", actions: [...CRUDA], more: [["assign", "Assign mechanics and bays"], ["status", "Move jobs between stages"], ["gate", "Release cars at the gate"], ["credit", "Let a car go on credit"], ["invoice", "Make invoices from jobs"], ["see_costs", "See part costs and margins"]] },
    { key: "garage_bookings", label: "Bookings", actions: [...CRUD], more: [["send", "Send booking confirmations"]] },
    { key: "garage_vehicles", label: "Vehicles", actions: [...CRUD] },
    { key: "garage_inspections", label: "Inspections", actions: [...CRUD] },
    { key: "garage_estimates", label: "Estimates", actions: [...CRUDA], more: [["send", "Send estimates for approval"]] },
    { key: "garage_parts", label: "Parts for jobs", actions: ["view", "create"], more: [["issue", "Issue and take back parts (store)"]] },
    { key: "garage_clock", label: "Mechanic clock on / off", actions: ["view", "create"], more: [["others", "Clock for other mechanics"]] },
    { key: "garage_qc", label: "Quality check", actions: ["view", "create"] },
    { key: "garage_reminders", label: "Service reminders", actions: ["view", "edit"] },
    { key: "garage_settings", label: "Workshop settings", actions: ["view", "edit"] },
    { key: "garage_reports", label: "Workshop reports", actions: ["view"] },
  ],
};

const grant = (keys: string[]): Perms => Object.fromEntries(keys.map((k) => [k, true]));
const all = (r: string, acts: readonly string[]) => acts.map((a) => `${r}.${a}`);

export const WORKSHOP_ROLES: typeof PRESET_ROLES = [
  { name: "Service advisor", description: "Reception: bookings, check-in, job cards, estimates, invoices from jobs and the gate.", base_role: "manager",
    permissions: grant([...all("garage_jobs", ["view", "create", "edit", "assign", "status", "gate", "invoice"]), ...all("garage_bookings", [...CRUD, "send"]), ...all("garage_vehicles", ["view", "create", "edit"]),
      ...all("garage_inspections", ["view", "create", "edit"]), ...all("garage_estimates", ["view", "create", "edit", "send"]), "garage_parts.view", "garage_parts.create", "garage_qc.view", "garage_reminders.view",
      "customers.view", "customers.create", "customers.edit", "items.view", "invoices.view", "invoices.create", "invoices.communicate", "payments_received.view", "payments_received.create", "payments_received.mpesa_prompt", "quotes.view", "documents.view", "documents.upload"]) },
  { name: "Mechanic", description: "Their own jobs on the phone: clock on and off, photos, findings, request parts, mark work done.", base_role: "sales_person", data_scope: "own",
    permissions: grant(["garage_jobs.view", "garage_jobs.status", "garage_vehicles.view", "garage_inspections.view", "garage_inspections.create", "garage_inspections.edit", "garage_parts.view", "garage_parts.create", "garage_clock.view", "garage_clock.create", "garage_qc.view"]) },
  { name: "Foreman", description: "Runs the workshop floor: assigns work, bays and mechanics, quality checks, comebacks and reports.", base_role: "manager",
    permissions: grant([...all("garage_jobs", ["view", "create", "edit", "assign", "status", "approve"]), "garage_bookings.view", "garage_bookings.edit", ...all("garage_vehicles", ["view", "edit"]), ...all("garage_inspections", [...CRUD]),
      ...all("garage_estimates", ["view", "create", "edit"]), "garage_parts.view", "garage_parts.create", "garage_clock.view", "garage_clock.create", "garage_clock.others", "garage_qc.view", "garage_qc.create", "garage_reports.view", "items.view"]) },
  { name: "Storekeeper", description: "Issues parts to jobs from stock and takes back unused parts; receives stock.", base_role: "stock_manager",
    permissions: grant(["garage_jobs.view", "garage_parts.view", "garage_parts.create", "garage_parts.issue", ...all("items", ["view", "create", "edit"]), "inventory_adjustments.view", "inventory_adjustments.create",
      "purchase_receives.view", "purchase_receives.create", "purchase_orders.view", "purchase_orders.create", "vendors.view"]) },
];

let done = false;
/** Adds the workshop group and roles to the shared catalogue once. */
export function registerWorkshopPermissions() {
  if (done) return;
  done = true;
  if (!PERMISSION_GROUPS.some((g) => g.key === WORKSHOP_PERMISSION_GROUP.key)) PERMISSION_GROUPS.push(WORKSHOP_PERMISSION_GROUP);
  for (const r of WORKSHOP_ROLES) if (!PRESET_ROLES.some((p) => p.name === r.name)) PRESET_ROLES.push(r);
  // The Manager preset was worked out before this group existed: give it the workshop too.
  const manager = PRESET_ROLES.find((p) => p.name === "Manager");
  if (manager) for (const res of WORKSHOP_PERMISSION_GROUP.resources) {
    for (const a of res.actions) manager.permissions[`${res.key}.${a}`] = true;
    for (const [m] of res.more || []) manager.permissions[`${res.key}.${m}`] = true;
  }
}
