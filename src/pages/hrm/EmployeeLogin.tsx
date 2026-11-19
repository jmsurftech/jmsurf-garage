/**
 * Staff logins made from the employee record (as in Apex HRM): create a JMSURF Garage login for an employee and
 * email them their sign-in details, link an account that already exists, or do it for many employees at once.
 * The login is linked to the employee, so they see their own payslips, leave and attendance in My Space.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Mail, Unlink, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createStaffAccount, listStaffAccounts, resetStaffPassword } from "@/lib/serverStaff";
import { PRESET_ROLES } from "@/lib/permissionCatalog";
import { confirmAction } from "@/components/books/confirm";

const sb = supabase as any;
/** The ready-made role an employee login gets unless another is chosen: My Space only. */
export const SELF_SERVICE_ROLE = "Employee (My Space only)";

type Emp = { id: string; first_name?: string; last_name?: string; email?: string | null; phone?: string | null; user_id?: string | null; status?: string };
const nameOf = (e: Emp) => `${e.first_name || ""} ${e.last_name || ""}`.trim();

/** The company's roles; the My Space role is added the first time it is needed. */
function useRoles() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["company-roles", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("company_roles").select("id,name,base_role").order("name")).data || []) as { id: string; name: string; base_role: string }[],
  });
}
async function ensureRole(tenantId: string, roles: { id: string; name: string }[], name: string): Promise<string | null> {
  const hit = roles.find((r) => r.name === name);
  if (hit) return hit.id;
  const tpl = PRESET_ROLES.find((r) => r.name === name);
  if (!tpl) return null;
  const { data, error } = await sb.from("company_roles").insert({ tenant_id: tenantId, name: tpl.name, description: tpl.description, base_role: tpl.base_role, data_scope: tpl.data_scope || "all", permissions: tpl.permissions, is_system: true }).select("id").single();
  if (error) throw error;
  return data.id;
}

function RolePick({ value, onChange, roles }: { value: string; onChange: (v: string) => void; roles: { id: string; name: string }[] }) {
  const names = useMemo(() => [...new Set([SELF_SERVICE_ROLE, ...roles.map((r) => r.name)])], [roles]);
  return <select className="fi" value={value} onChange={(e) => onChange(e.target.value)}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select>;
}

async function createFor(emp: Emp, email: string, roleId: string | null) {
  const r = await createStaffAccount({ email, password: "", display_name: nameOf(emp) || email, phone: emp.phone || null, company_role_id: roleId });
  if (r.error || !r.data?.user_id) throw new Error(r.error || "The login was not created");
  const { error } = await sb.from("hr_employees").update({ user_id: r.data.user_id }).eq("id", emp.id);
  if (error) throw error;
  return r.data;
}

/** On the employee record: their login, or the way to give them one. */
export function EmployeeLoginCard({ emp }: { emp: Emp }) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { data: roles = [] } = useRoles();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(emp.email || "");
  const [role, setRole] = useState(SELF_SERVICE_ROLE);
  const [busy, setBusy] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["hr-employees"] }); void qc.invalidateQueries({ queryKey: ["staff"] }); void qc.invalidateQueries({ queryKey: ["company-roles"] }); };

  const create = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error("Enter their email address");
    setBusy(true);
    try {
      const roleId = await ensureRole(tenantId!, roles, role);
      const r = await createFor(emp, email.trim().toLowerCase(), roleId);
      toast.success(r && (r as any).existing ? "Linked to their existing account" : "Login created", { description: `Sign-in details were emailed to ${email.trim()}.` });
      setOpen(false); refresh();
    } catch (e: any) { toast.error(e.message || "Not created"); } finally { setBusy(false); }
  };
  const unlink = async () => {
    if (!(await confirmAction({ title: `Unlink ${nameOf(emp)}'s login?`, message: "They keep their login, but it no longer shows their payslips or leave. Remove the login itself under System → Staff.", confirmLabel: "Unlink" }))) return;
    const { error } = await sb.from("hr_employees").update({ user_id: null }).eq("id", emp.id);
    if (error) return toast.error(error.message);
    refresh();
  };
  const reset = async () => {
    const r = await resetStaffPassword(emp.user_id!);
    if (r.error) return toast.error(r.error);
    toast.success(r.data?.message || "A new password was emailed");
  };

  return (
    <div className="rounded-xl border border-border p-3 sm:col-span-2 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted"><KeyRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">System login</p>
          <p className="text-xs text-muted-foreground">{emp.user_id ? "Linked: they see their payslips, leave and attendance in My Space." : "No login yet."}</p>
        </div>
        {emp.user_id ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void reset()}><Mail /> New password</Button>
            <Button size="sm" variant="ghost" onClick={() => void unlink()}><Unlink /> Unlink</Button>
          </div>
        ) : <Button size="sm" onClick={() => setOpen(true)}><UserPlus /> Create login</Button>}
      </div>
      <Modal center open={open} onClose={() => setOpen(false)} title={`Login for ${nameOf(emp)}`} icon={UserPlus}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create and email"}</Button></>}>
        <div className="space-y-3">
          <Field label="Email" hint="Their sign-in details go here."><input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" hint={role === SELF_SERVICE_ROLE ? "Their own payslips, leave, attendance and details only." : undefined}><RolePick value={role} onChange={setRole} roles={roles} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/** On the employee list: link matching accounts by email, or create logins for everyone without one. */
export function EmployeeLoginsBulk({ emps }: { emps: Emp[] }) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { data: roles = [] } = useRoles();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(SELF_SERVICE_ROLE);
  const [busy, setBusy] = useState("");
  const { data: accounts = [] } = useQuery({
    queryKey: ["staff-accounts", tenantId], enabled: open,
    queryFn: async () => (await listStaffAccounts()).data?.users || [],
  });
  const current = emps.filter((e) => !["terminated", "resigned"].includes(String(e.status || "")));
  const without = current.filter((e) => !e.user_id);
  const linked = new Set(emps.map((e) => e.user_id).filter(Boolean));
  const byEmail = new Map(accounts.filter((a) => a.email && !linked.has(a.id)).map((a) => [a.email.toLowerCase(), a.id]));
  const matches = without.filter((e) => e.email && byEmail.has(e.email.toLowerCase()));
  const creatable = without.filter((e) => e.email && !byEmail.has(e.email.toLowerCase()));
  const noEmail = without.filter((e) => !e.email);

  const linkAll = async () => {
    setBusy("link");
    let n = 0;
    for (const e of matches) { const { error } = await sb.from("hr_employees").update({ user_id: byEmail.get(e.email!.toLowerCase()) }).eq("id", e.id); if (!error) n++; }
    setBusy(""); toast.success(`${n} linked`); void qc.invalidateQueries({ queryKey: ["hr-employees"] });
  };
  const createAll = async () => {
    if (!(await confirmAction({ title: `Create ${creatable.length} logins?`, message: `Each person gets an email with their sign-in details. Role: ${role}.`, confirmLabel: "Create" }))) return;
    setBusy("create");
    let ok = 0; const bad: string[] = [];
    try {
      const roleId = await ensureRole(tenantId!, roles, role);
      for (const e of creatable) { try { await createFor(e, e.email!.toLowerCase(), roleId); ok++; } catch (x: any) { bad.push(`${nameOf(e)}: ${x.message}`); if (/package allows/i.test(x.message)) break; } }
    } catch (x: any) { bad.push(x.message); }
    setBusy("");
    if (ok) toast.success(`${ok} logins created and emailed`);
    if (bad.length) toast.error(`${bad.length} not created`, { description: bad.slice(0, 3).join(" · ") });
    void qc.invalidateQueries({ queryKey: ["hr-employees"] }); void qc.invalidateQueries({ queryKey: ["staff"] });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><KeyRound /> Staff logins</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Staff logins" icon={Users} description="Give employees a login so they see their payslips and ask for leave in My Space.">
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border p-3"><p className="text-2xl font-bold tabular-nums">{current.length - without.length}</p><p className="text-xs text-muted-foreground">Have a login</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-2xl font-bold tabular-nums">{without.length}</p><p className="text-xs text-muted-foreground">Without</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-2xl font-bold tabular-nums">{noEmail.length}</p><p className="text-xs text-muted-foreground">No email on file</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <p className="min-w-0 flex-1">{matches.length ? `${matches.length} already have an account with the same email.` : "No existing accounts match by email."}</p>
            <Button size="sm" variant="outline" disabled={!matches.length || !!busy} onClick={() => void linkAll()}>{busy === "link" ? "Linking…" : "Link them"}</Button>
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p>{creatable.length ? `${creatable.length} can get a new login.` : "Nobody else has an email to send a login to."}</p>
            <Field label="Role for the new logins"><RolePick value={role} onChange={setRole} roles={roles} /></Field>
            <Button disabled={!creatable.length || !!busy} onClick={() => void createAll()}>{busy === "create" ? "Creating…" : `Create ${creatable.length} logins`}</Button>
          </div>
          {noEmail.length > 0 && <p className="text-xs text-muted-foreground">Add an email to {noEmail.slice(0, 4).map(nameOf).join(", ")}{noEmail.length > 4 ? ` and ${noEmail.length - 4} more` : ""} to give them a login.</p>}
        </div>
      </Modal>
    </>
  );
}
