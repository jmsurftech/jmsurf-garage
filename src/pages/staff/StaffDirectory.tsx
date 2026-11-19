import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Search, UserPlus, KeyRound, Pencil, Trash2, Shield, Mail, Phone, MapPin, IdCard, Copy, CheckCircle2, XCircle, BadgePercent, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useStaff } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, EmptyState, Modal, Pill, TableWrap } from "@/components/kit";
import Pager, { usePaged } from "@/components/Pager";
import ImportExport from "@/components/ImportExport";
import { confirmAction } from "@/components/books/confirm";
import { ALL_PERMISSIONS } from "@/components/RoleSettings";
import { resetStaffPassword, deleteStaffAccount } from "@/lib/serverStaff";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const ROLE: Record<string, string> = { admin: "Owner / Admin", manager: "Manager", cashier: "Cashier", stock_manager: "Stock manager", sales_person: "Sales rep", rider: "Rider", packaging: "Packaging" };
const DEFAULTS: Record<string, string[]> = {
  manager: ["dashboard", "pos", "customers", "sales", "quotes", "invoices", "inventory", "purchases", "expenses", "bills", "reports", "staff", "settings", "hrm", "documents"],
  cashier: ["pos", "customers", "sales", "invoices", "quotes", "staff"],
  stock_manager: ["dashboard", "inventory", "purchases", "expenses", "reports"],
  sales_person: ["pos", "customers", "sales", "invoices", "quotes"],
};

type Person = { key: string; user_id: string | null; employee_id: string | null; name: string; email: string | null; phone: string | null; role: string | null; role_id: string | null; location: string | null; employee: any; rep: boolean; last_seen: string | null };

/** Everyone in the business: staff with a login and employees from HRM. */
export default function StaffDirectory() {
  const tenantId = useTenantId();
  const { user, role: myRole } = useAuth() as any;
  const navigate = useNavigate();
  const { data: staff = [] } = useStaff();
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [open, setOpen] = useState<Person | null>(null);
  const isAdmin = myRole === "admin" || myRole === "super_admin";
  const { data: extra } = useQuery({
    queryKey: ["staff-extra", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const [e, r, s] = await Promise.all([
        sb.from("hr_employees").select("id,user_id,first_name,last_name,other_names,phone,email,status,employee_no,hr_designations(name)").eq("tenant_id", tenantId),
        sb.from("sales_reps").select("user_id,is_active").eq("tenant_id", tenantId),
        sb.rpc("team_active_sessions").then((x: any) => x, () => ({ data: [] })),
      ]);
      return { emps: (e.data || []) as any[], reps: new Set(((r.data || []) as any[]).filter((x) => x.is_active).map((x) => x.user_id)), seen: new Map(((s.data || []) as any[]).map((x) => [x.user_id, x.refreshed_at])) };
    },
  });
  const people = useMemo<Person[]>(() => {
    const emps = extra?.emps || [];
    const out: Person[] = (staff as any[]).map((s) => {
      const emp = emps.find((e) => e.user_id === s.user_id);
      return { key: s.user_id, user_id: s.user_id, employee_id: emp?.id || null, name: s.display_name || "Staff", email: s.email || emp?.email || null, phone: s.phone || emp?.phone || null, role: s.role, role_id: s.role_id, location: s.store_location || null, employee: emp || null, rep: !!extra?.reps.has(s.user_id), last_seen: (extra?.seen.get(s.user_id) as string) || null };
    });
    for (const e of emps) if (!e.user_id && !["terminated", "resigned"].includes(e.status)) out.push({ key: e.id, user_id: null, employee_id: e.id, name: [e.first_name, e.other_names, e.last_name].filter(Boolean).join(" "), email: e.email, phone: e.phone, role: null, role_id: null, location: null, employee: e, rep: false, last_seen: null });
    return out;
  }, [staff, extra]);
  const rows = people.filter((p) => (!roleF || (roleF === "none" ? !p.user_id : p.role === roleF)) && (!q.trim() || `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(q.trim().toLowerCase())));
  const paged = usePaged(rows, 20);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi w-auto" value={roleF} onChange={(e) => setRoleF(e.target.value)}><option value="">Everyone</option>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="none">No system access</option></select>
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="flex-1" />
        <ImportExport entity="staff" rows={people.map((p) => ({ name: p.name, email: p.email, phone: p.phone, role: p.role ? ROLE[p.role] || p.role : "No system access", employee_no: p.employee?.employee_no, job_title: p.employee?.hr_designations?.name, sales_rep: p.rep ? "yes" : "no" }))} />
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Users} title="Nobody here" /> : <>
          <TableWrap><table className="dt">
            <thead><tr><th>Name</th><th className="hidden md:table-cell">Email</th><th className="hidden lg:table-cell">Phone</th><th>Role</th><th className="hidden sm:table-cell">Employee</th><th className="hidden lg:table-cell">Last active</th></tr></thead>
            <tbody>{paged.rows.map((p: Person) => {
              const online = p.last_seen && Date.now() - Date.parse(p.last_seen) < 75 * 60000;
              return (
                <tr key={p.key} className="cursor-pointer" onClick={() => setOpen(p)}>
                  <td><span className="flex items-center gap-3"><span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground">{p.name.charAt(0).toUpperCase()}{online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />}</span>
                    <span className="min-w-0"><span className="block truncate font-semibold">{p.name}{p.user_id === user?.id && <span className="ml-1 text-xs text-primary">(you)</span>}</span>{p.rep && <span className="text-xs text-success">Sales rep</span>}</span></span></td>
                  <td className="hidden text-muted-foreground md:table-cell">{p.email || "—"}</td>
                  <td className="hidden lg:table-cell">{p.phone || "—"}</td>
                  <td>{p.role ? <Pill tone={p.role === "admin" ? "primary" : "info"}>{ROLE[p.role] || p.role}</Pill> : <Pill>No system access</Pill>}</td>
                  <td className="hidden sm:table-cell">{p.employee ? <span className="text-xs">{p.employee.employee_no}<span className="block text-muted-foreground">{p.employee.hr_designations?.name || ""}</span></span> : <span className="text-xs text-muted-foreground">—</span>}</td>
                  <td className="hidden text-xs text-muted-foreground lg:table-cell">{p.last_seen ? new Date(p.last_seen).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>
      {open && <PersonPanel p={open} isAdmin={isAdmin} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PersonPanel({ p, isAdmin, onClose }: { p: Person; isAdmin: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth() as any;
  const [tab, setTab] = useState<"details" | "access">("details");
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const { data: perms = [] } = useQuery({ queryKey: ["role-permissions"], queryFn: async () => (await sb.from("role_permissions").select("*")).data || [] });
  const has = (perm: string) => {
    if (!p.role) return false;
    if (p.role === "admin") return true;
    const row = (perms as any[]).find((x) => x.role === p.role && x.permission === perm);
    return row ? row.allowed : (DEFAULTS[p.role] || []).includes(perm);
  };
  const toggle = async (perm: string) => {
    if (!p.role || p.role === "admin") return;
    const row = (perms as any[]).find((x) => x.role === p.role && x.permission === perm);
    const next = !has(perm);
    const { error } = row ? await sb.from("role_permissions").update({ allowed: next }).eq("id", row.id) : await sb.from("role_permissions").insert({ role: p.role, permission: perm, allowed: next });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `${next ? "Allowed" : "Removed"} for every ${ROLE[p.role] || p.role}` });
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
  };
  const changeRole = async (role: string) => {
    if (!p.role_id) return;
    const { error } = await sb.from("user_roles").update({ role }).eq("id", p.role_id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `Role changed to ${ROLE[role] || role}` }); qc.invalidateQueries({ queryKey: ["staff"] }); onClose();
  };
  const reset = async () => {
    if (!p.user_id || !(await confirmAction({ title: `Reset ${p.name}'s password?`, message: "They get a new temporary password and must change it when they sign in.", confirmLabel: "Reset" }))) return;
    setBusy("reset");
    const { data, error } = await resetStaffPassword(p.user_id);
    setBusy("");
    if (error) return toast({ title: "Not reset", description: error, variant: "destructive" });
    setTemp(data?.password || null);
    toast({ title: "Password reset", description: data?.message });
  };
  const remove = async () => {
    if (!p.user_id || !(await confirmAction({ title: `Remove ${p.name}'s access?`, message: "Their login is deleted. Sales and records they made stay. Their employee record (if any) is kept.", danger: true, confirmLabel: "Remove access" }))) return;
    setBusy("del");
    const { error } = await deleteStaffAccount(p.user_id);
    setBusy("");
    if (error) return toast({ title: "Not removed", description: error, variant: "destructive" });
    toast({ title: "Access removed" }); qc.invalidateQueries({ queryKey: ["staff"] }); onClose();
  };
  const e = p.employee;
  return (
    <Modal open onClose={onClose} title={p.name} description={p.role ? ROLE[p.role] || p.role : "Employee without system access"} icon={Users} size="xl"
      footer={<div className="flex w-full flex-wrap gap-2">
        {isAdmin && p.user_id && <Button variant="outline" onClick={() => navigate(`/staff/${p.user_id}/edit`)}><Pencil /> Edit</Button>}
        {isAdmin && p.user_id && p.user_id !== user?.id && <Button variant="outline" onClick={reset} disabled={busy === "reset"}><KeyRound /> Reset password</Button>}
        {isAdmin && !p.user_id && p.employee_id && <Button onClick={() => navigate(`/staff/new?employee=${p.employee_id}`)}><UserPlus /> Give system access</Button>}
        {p.employee_id && <Button variant="outline" asChild><Link to={`/hrm/employees/${p.employee_id}`}><IdCard /> Employee file</Link></Button>}
        {isAdmin && p.user_id && p.user_id !== user?.id && <Button variant="ghost" className="ml-auto text-destructive" onClick={remove} disabled={busy === "del"}><Trash2 /> Remove access</Button>}
      </div>}>
      <div className="mb-4 flex gap-1 rounded-xl bg-muted p-1">{([["details", "Details"], ["access", "Module access"]] as const).map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={cn("flex-1 rounded-lg px-3 py-1.5 text-sm", tab === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
      {temp && <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">Temporary password: <b className="font-mono">{temp}</b> <button className="icon-btn" onClick={() => navigator.clipboard?.writeText(temp)} aria-label="Copy"><Copy className="h-4 w-4" /></button><span className="block text-xs text-muted-foreground">Share it privately. They will be asked to change it.</span></div>}
      {tab === "details" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[[Mail, "Email", p.email || "—"], [Phone, "Phone", p.phone || "—"], [MapPin, "Branch", p.location || "—"], [Shield, "Role", p.role ? ROLE[p.role] || p.role : "No login"], [BadgePercent, "Sales rep", p.rep ? "Yes, earns commission" : "No"], [Clock, "Last active", p.last_seen ? new Date(p.last_seen).toLocaleString("en-GB") : "—"],
            ...(e ? [[IdCard, "Employee number", e.employee_no || "—"], [IdCard, "Job title", e.hr_designations?.name || "—"]] : [])].map(([I, l, v]: any) => (
            <div key={l} className="rounded-xl border border-border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><I className="h-3.5 w-3.5" />{l}</p><p className="mt-0.5 font-medium">{v}</p></div>
          ))}
          {isAdmin && p.role_id && p.user_id !== user?.id && (
            <div className="rounded-xl border border-border p-3 sm:col-span-2">
              <p className="mb-2 text-xs text-muted-foreground">Change role</p>
              <div className="flex flex-wrap gap-2">{Object.entries(ROLE).map(([k, l]) => <button key={k} onClick={() => k !== p.role && changeRole(k)} className={cn("rounded-full border px-3 py-1.5 text-sm", k === p.role ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary")}>{l}</button>)}</div>
            </div>
          )}
        </div>
      ) : !p.role ? <p className="text-sm text-muted-foreground">Give this employee system access to choose what they can use.</p> : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{p.role === "admin" ? "Owners can use everything." : <>Access is set per role: changes apply to every <b>{ROLE[p.role] || p.role}</b>.</>}</p>
          <ul className="divide-y divide-border rounded-2xl border border-border">{ALL_PERMISSIONS.map((perm) => (
            <li key={perm.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {has(perm.key) ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-muted-foreground/50" />}
              <span className="flex-1">{perm.label}</span>
              <Switch checked={has(perm.key)} onCheckedChange={() => toggle(perm.key)} disabled={!isAdmin || p.role === "admin"} />
            </li>
          ))}</ul>
        </div>
      )}
    </Modal>
  );
}
