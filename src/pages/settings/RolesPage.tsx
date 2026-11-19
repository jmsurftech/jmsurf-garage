import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Pencil, Copy, Trash2, ChevronDown, Lock, Users, Sparkles, Save, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Panel, EmptyState, Field, Pill } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";
import { PERMISSION_GROUPS, PERMISSION_SWITCHES, REPORT_GROUPS, REPORT_ACTIONS, PRESET_ROLES, type Perms, type Action } from "@/lib/permissionCatalog";

const sb: any = supabase;
const ACTIONS: Action[] = ["view", "create", "edit", "delete", "approve"];
const ACTION_LABEL: Record<Action, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve" };
/** The database access level behind a role (row-level security): what the role's people can reach at most. */
export const BASE_ROLES: [string, string][] = [
  ["admin", "Admin: everything, including users and settings"],
  ["manager", "Manager: all company data"],
  ["finance", "Finance: the books, sales and purchases"],
  ["sales_person", "Sales: customers and sales documents"],
  ["customer_service", "Customer service: customers and sales"],
  ["stock_manager", "Stock: items, stock and purchasing"],
  ["cashier", "Cashier: the till and receipts"],
  ["packaging", "Packing: packing lists"],
  ["rider", "Rider: deliveries"],
];
const SCOPES: [string, string, string][] = [
  ["all", "All records", "Sees every customer, document and transaction their permissions allow."],
  ["own", "Only their own", "Sees only what they created or are the salesperson / owner of."],
  ["assigned", "Assigned customers only", "Sees only the customers assigned to them and those customers' documents."],
];

export function useCompanyRoles() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["company-roles", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("company_roles").select("*").eq("tenant_id", tenantId).order("is_system", { ascending: false }).order("name")).data || []) as any[],
  });
}

/** Settings → Users & Roles → Roles: the company's own roles, with permissions down to each action. */
export default function RolesPage() {
  const tenantId = useTenantId();
  const { role } = useAuth() as any;
  const canManage = ["admin", "super_admin"].includes(role);
  const qc = useQueryClient();
  const { data: roles = [], isLoading } = useCompanyRoles();
  const { data: counts = {} } = useQuery({
    queryKey: ["company-role-users", tenantId], enabled: !!tenantId,
    queryFn: async () => { const { data } = await sb.from("profiles").select("company_role_id").eq("tenant_id", tenantId); const m: Record<string, number> = {}; for (const p of data || []) if (p.company_role_id) m[p.company_role_id] = (m[p.company_role_id] || 0) + 1; return m; },
  });
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["company-roles"] }); void qc.invalidateQueries({ queryKey: ["company-role-users"] }); };

  const seed = async () => {
    const { error } = await sb.from("company_roles").insert(PRESET_ROLES.map((r) => ({ tenant_id: tenantId, name: r.name, description: r.description, base_role: r.base_role, data_scope: r.data_scope || "all", permissions: r.permissions, is_system: true })));
    if (error) return toast.error(friendlyError(error));
    toast.success("Starter roles added", { description: "Change them to suit the company, or make your own." });
    refresh();
  };
  const remove = async (r: any) => {
    if (counts[r.id]) return toast.error(`${counts[r.id]} user${counts[r.id] === 1 ? " has" : "s have"} this role`, { description: "Give them another role first." });
    if (!(await confirmAction({ title: `Delete the ${r.name} role?`, confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("company_roles").delete().eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    refresh();
  };

  if (isLoading) return <OrbLoader label="Loading roles…" />;
  if (edit) return <RoleEditor role={edit} onClose={(saved) => { setEdit(null); if (saved) refresh(); }} />;
  return (
    <div className="space-y-5">
      <Panel title="Roles" icon={ShieldCheck} description="What each role may see and do, action by action. The Admin can do everything."
        actions={canManage && <Button onClick={() => setEdit({ name: "", description: "", base_role: "cashier", data_scope: "all", permissions: {} })}><Plus /> New role</Button>}>
        <div className="divide-y divide-border rounded-2xl border border-border">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Lock className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="font-semibold">Admin</p><p className="text-xs text-muted-foreground">Unrestricted access to everything, including users, roles and billing. Cannot be changed.</p></div>
            <Pill tone="primary">Built in</Pill>
          </div>
          {roles.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted"><ShieldCheck className="h-4 w-4 text-primary" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.name} {r.data_scope !== "all" && <span className="ml-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">{r.data_scope === "own" ? "Own records" : "Assigned customers"}</span>}</p>
                <p className="text-xs text-muted-foreground">{r.description || "—"} · {Object.values(r.permissions || {}).filter(Boolean).length} permissions</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> {counts[r.id] || 0}</span>
              {canManage && <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEdit(r)}><Pencil /> Edit</Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" title="Copy this role" aria-label="Copy this role" onClick={() => setEdit({ ...r, id: undefined, name: `${r.name} (copy)`, is_system: false })}><Copy /></Button>
                <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" title="Delete" aria-label="Delete" onClick={() => void remove(r)}><Trash2 /></Button>
              </div>}
            </div>
          ))}
        </div>
        {!roles.length && (
          <EmptyState icon={Sparkles} className="mt-4" title="No company roles yet" description="Start with ready-made roles and change them as you like."
            action={canManage ? <Button onClick={() => void seed()}><Sparkles /> Add the starter roles</Button> : undefined} />
        )}
      </Panel>
    </div>
  );
}

function RoleEditor({ role, onClose }: { role: any; onClose: (saved?: boolean) => void }) {
  const tenantId = useTenantId();
  const [f, setF] = useState({ name: role.name || "", description: role.description || "", base_role: role.base_role || "cashier", data_scope: role.data_scope || "all" });
  const [p, setP] = useState<Perms>({ ...(role.permissions || {}) });
  const [more, setMore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const on = (k: string) => !!p[k];
  const set = (keys: string[], v: boolean) => setP((x) => { const n = { ...x }; for (const k of keys) { if (v) n[k] = true; else delete n[k]; } return n; });
  // Creating, editing, deleting or approving needs seeing; taking away "view" takes away everything on that row.
  const toggle = (k: string, action: Action, res: string) => {
    if (!on(k)) return set(action === "view" ? [k] : [k, `${res}.view`], true);
    set(action === "view" ? Object.keys(p).filter((x) => x.startsWith(`${res}.`)) : [k], false);
  };
  const save = async () => {
    if (!f.name.trim()) return toast.error("Give the role a name");
    if (f.name.trim().toLowerCase() === "admin") return toast.error("Admin is built in: choose another name");
    setBusy(true);
    const row = { name: f.name.trim(), description: f.description.trim() || null, base_role: f.base_role, data_scope: f.data_scope, permissions: p, updated_at: new Date().toISOString() };
    const { error } = role.id ? await sb.from("company_roles").update(row).eq("id", role.id) : await sb.from("company_roles").insert({ ...row, tenant_id: tenantId });
    setBusy(false);
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? "A role with that name already exists" : friendlyError(error));
    toast.success(role.id ? "Role saved" : "Role created", { description: "People with this role see the change the next time a page loads." });
    onClose(true);
  };
  const reportsAll = useMemo(() => REPORT_GROUPS.every(([g]) => REPORT_ACTIONS.every(([a]) => p[`reports.${g}.${a}`])), [p]);
  const cell = "px-2 py-2 text-center";
  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6"><ShieldCheck className="h-5 w-5 text-primary" /><h1 className="flex-1 font-display text-xl font-bold">{role.id ? `Edit role: ${role.name}` : "New role"}</h1><Button size="icon" variant="ghost" onClick={() => onClose()} aria-label="Close"><X /></Button></div>
      <div className="flex-1 space-y-6 px-4 py-6 sm:px-6">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <Field label="Role name" required><input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Branch supervisor" /></Field>
          <Field label="Access level" hint="The most this role can reach in the database. Permissions below narrow it down."><select className="fi" value={f.base_role} onChange={(e) => setF({ ...f, base_role: e.target.value })}>{BASE_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Description" className="sm:col-span-2"><textarea className="fi" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="max-w-4xl">
          <p className="mb-2 text-sm font-medium">Records this role sees</p>
          <div className="grid gap-2 sm:grid-cols-3">{SCOPES.map(([v, l, d]) => (
            <label key={v} className={cn("flex cursor-pointer gap-3 rounded-xl border-2 p-3", f.data_scope === v ? "border-primary bg-primary/5" : "border-border")}>
              <input type="radio" className="mt-1 accent-primary" checked={f.data_scope === v} onChange={() => setF({ ...f, data_scope: v })} />
              <span><span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
            </label>
          ))}</div>
        </div>

        {PERMISSION_GROUPS.map((g) => {
          const hasApprove = g.resources.some((r) => r.actions.includes("approve"));
          return (
            <section key={g.key} className="overflow-visible rounded-2xl border border-border">
              <p className="border-b border-border bg-muted/50 px-4 py-2.5 font-semibold">{g.label}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="text-xs text-muted-foreground"><th className="px-4 py-2 text-left font-medium">Particulars</th><th className={cell}>Full</th>{ACTIONS.filter((a) => a !== "approve" || hasApprove).map((a) => <th key={a} className={cell}>{ACTION_LABEL[a]}</th>)}<th className="px-4 py-2 text-left font-medium">Others</th></tr></thead>
                  <tbody>{g.resources.map((r) => {
                    const keys = [...r.actions.map((a) => `${r.key}.${a}`), ...(r.more || []).map(([m]) => `${r.key}.${m}`)];
                    const all = keys.every(on); const some = keys.some(on);
                    const moreOn = (r.more || []).filter(([m]) => on(`${r.key}.${m}`)).length;
                    return (
                      <tr key={r.key} className="border-t border-border">
                        <td className="px-4 py-2 font-medium">{r.label}</td>
                        <td className={cell}><input type="checkbox" className="h-4 w-4 accent-primary" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={() => set(keys, !all)} aria-label={`Full access to ${r.label}`} /></td>
                        {ACTIONS.filter((a) => a !== "approve" || hasApprove).map((a) => (
                          <td key={a} className={cell}>{r.actions.includes(a) ? <input type="checkbox" className="h-4 w-4 accent-primary" checked={on(`${r.key}.${a}`)} onChange={() => toggle(`${r.key}.${a}`, a, r.key)} aria-label={`${ACTION_LABEL[a]} ${r.label}`} /> : null}</td>
                        ))}
                        <td className="relative px-4 py-2">
                          {r.more?.length ? <>
                            <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-primary" onClick={() => setMore(more === r.key ? null : r.key)}>More permissions {moreOn > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{moreOn}</span>}<ChevronDown className="h-3.5 w-3.5" /></button>
                            {more === r.key && (
                              <div className="absolute left-4 top-9 z-30 w-72 space-y-1 rounded-xl border border-border bg-card p-2 shadow-xl">
                                {r.more.map(([m, l]) => (
                                  <label key={m} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={on(`${r.key}.${m}`)} onChange={() => { const v = !on(`${r.key}.${m}`); set([`${r.key}.${m}`, ...(v ? [`${r.key}.view`] : [])], v); }} /> {l}</label>
                                ))}
                                <button type="button" className="w-full rounded-lg px-2 py-1 text-right text-xs font-semibold text-muted-foreground" onClick={() => setMore(null)}>Done</button>
                              </div>
                            )}
                          </> : null}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </section>
          );
        })}

        <div className="grid gap-4 lg:grid-cols-3">
          {PERMISSION_SWITCHES.map((s) => (
            <section key={s.key} className="rounded-2xl border border-border">
              <div className="flex items-center border-b border-border bg-muted/50 px-4 py-2.5"><p className="flex-1 font-semibold">{s.label}</p>
                <button type="button" className="text-xs font-semibold text-primary" onClick={() => { const keys = s.items.map(([k]) => `${s.key}.${k}`); set(keys, !keys.every(on)); }}>{s.items.every(([k]) => on(`${s.key}.${k}`)) ? "Clear all" : "Select all"}</button></div>
              <div className="space-y-0.5 p-2">{s.items.map(([k, l]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" className="h-4 w-4 accent-primary" checked={on(`${s.key}.${k}`)} onChange={() => set([`${s.key}.${k}`], !on(`${s.key}.${k}`))} /> {l}</label>
              ))}</div>
            </section>
          ))}
        </div>

        <section className="rounded-2xl border border-border">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/50 px-4 py-2.5"><p className="flex-1 font-semibold">Reports</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={reportsAll} onChange={() => set(REPORT_GROUPS.flatMap(([g]) => REPORT_ACTIONS.map(([a]) => `reports.${g}.${a}`)), !reportsAll)} /> Full access to all reports</label></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-xs text-muted-foreground"><th className="px-4 py-2 text-left font-medium">Report group</th><th className={cell}>Full</th>{REPORT_ACTIONS.map(([, l]) => <th key={l} className={cell}>{l}</th>)}</tr></thead>
              <tbody>{REPORT_GROUPS.map(([g, l]) => {
                const keys = REPORT_ACTIONS.map(([a]) => `reports.${g}.${a}`); const all = keys.every(on);
                return (
                  <tr key={g} className="border-t border-border"><td className="px-4 py-2">{l}</td>
                    <td className={cell}><input type="checkbox" className="h-4 w-4 accent-primary" checked={all} onChange={() => set(keys, !all)} aria-label={`Full access to ${l}`} /></td>
                    {REPORT_ACTIONS.map(([a, al]) => <td key={a} className={cell}><input type="checkbox" className="h-4 w-4 accent-primary" checked={on(`reports.${g}.${a}`)} onChange={() => { const k = `reports.${g}.${a}`; const v = !on(k); set([k, ...(v && a !== "view" ? [`reports.${g}.view`] : []), ...(!v && a === "view" ? keys : [])], v); }} aria-label={`${al} ${l}`} /></td>)}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="sticky bottom-0 z-10 flex gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Button onClick={() => void save()} disabled={busy}><Save /> {role.id ? "Save role" : "Create role"}</Button>
        <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
        <span className="ml-auto self-center text-xs text-muted-foreground">{Object.values(p).filter(Boolean).length} permissions on</span>
      </div>
    </div>
  );
}
