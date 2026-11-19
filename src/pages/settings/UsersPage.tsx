import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Search, Pencil, KeyRound, Ban, CheckCircle2, Trash2, MailCheck, MoreHorizontal, ShieldCheck, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel, Modal, Field, Pill, EmptyState } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { createStaffAccount, listStaffAccounts, resetStaffPassword, deleteStaffAccount, updateStaffAccount } from "@/lib/serverStaff";
import { useCompanyRoles, BASE_ROLES } from "@/pages/settings/RolesPage";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
type Person = { user_id: string; display_name: string; phone: string | null; email: string; role: string; company_role_id: string | null; status: string; location_ids: string[] | null;
  cost_per_hour: number | null; address: string | null; remarks: string | null; last_sign_in_at: string | null; invited_at: string | null; created_at: string; banned: boolean };

/** Settings → Users & Roles → Users: invite people, give them a role and branches, make them inactive, reset their password. */
export default function UsersPage() {
  const tenantId = useTenantId();
  const { user, role: myRole } = useAuth() as any;
  const canManage = ["admin", "super_admin"].includes(myRole);
  const qc = useQueryClient();
  const { data: roles = [] } = useCompanyRoles();
  const { data: locations = [] } = useLocations();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<Partial<Person> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["users-page", tenantId], enabled: !!tenantId,
    queryFn: async (): Promise<Person[]> => {
      // Members of this company, with the role, branches and status they have here (each company keeps its own).
      const [m, acc, t] = await Promise.all([
        sb.rpc("company_users"),
        listStaffAccounts(),
        sb.from("tenants").select("owner_user_id").eq("id", tenantId).maybeSingle(),
      ]);
      const auth = new Map(((acc.data?.users || []) as any[]).map((u) => [u.id, u]));
      const owner = t.data?.owner_user_id;
      return ((m.data || []) as any[]).map((x) => {
        const a: any = auth.get(x.user_id) || {};
        return { ...x, display_name: x.display_name || a.email || "User", email: a.email || "", status: x.member_status === "disabled" ? "inactive" : "active",
          role: owner === x.user_id || x.is_owner ? "owner" : x.role || "cashier", last_sign_in_at: a.last_sign_in_at || null, banned: false };
      }).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
    },
  });
  const roleName = (p: Person) => p.role === "owner" ? "Owner (Admin)" : p.role === "admin" ? "Admin" : roles.find((r) => r.id === p.company_role_id)?.name || BASE_ROLES.find(([v]) => v === p.role)?.[1].split(":")[0] || p.role;
  const stateOf = (p: Person) => (p.status === "inactive" || p.banned ? "inactive" : !p.last_sign_in_at ? "invited" : "active");
  const list = useMemo(() => people.filter((p) => (status === "all" || stateOf(p) === status) && (!q.trim() || `${p.display_name} ${p.email} ${p.phone || ""} ${roleName(p)}`.toLowerCase().includes(q.trim().toLowerCase()))), [people, status, q, roles]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users-page"] });
  const selected = people.find((p) => p.user_id === open) || null;

  const act = async (key: string, fn: () => Promise<{ error: string | null; data?: any }>, ok: string) => {
    setBusy(key);
    const r = await fn();
    setBusy("");
    if (r.error) return toast.error(r.error);
    toast.success(r.data?.message || ok);
    refresh();
  };
  const setActive = (p: Person, active: boolean) => act(`st-${p.user_id}`, () => updateStaffAccount({ user_id: p.user_id, status: active ? "active" : "inactive" }), active ? `${p.display_name} can sign in again` : `${p.display_name} is inactive and cannot sign in`);
  const reset = async (p: Person, invite: boolean) => {
    if (!(await confirmAction({ title: invite ? `Resend the invitation to ${p.display_name}?` : `Reset ${p.display_name}'s password?`, message: `A new temporary password is emailed to ${p.email}. They choose their own when they sign in.`, confirmLabel: invite ? "Resend invitation" : "Reset password" }))) return;
    void act(`pw-${p.user_id}`, () => resetStaffPassword(p.user_id), invite ? "Invitation sent again" : "Temporary password sent");
  };
  const remove = async (p: Person) => {
    if (!(await confirmAction({ title: `Delete ${p.display_name}?`, message: "Their sign-in is removed. What they recorded stays. To keep the account but stop them signing in, mark them inactive instead.", confirmLabel: "Delete user", danger: true }))) return;
    void act(`del-${p.user_id}`, () => deleteStaffAccount(p.user_id), "User deleted").then(() => setOpen(null));
  };

  if (isLoading) return <OrbLoader label="Loading users…" />;
  const counts = { all: people.length, active: people.filter((p) => stateOf(p) === "active").length, invited: people.filter((p) => stateOf(p) === "invited").length, inactive: people.filter((p) => stateOf(p) === "inactive").length };
  return (
    <div className="space-y-5">
      <Panel title="Users" icon={Users} description="Everyone who signs in. Invite people and set their role and branches."
        actions={canManage && <Button onClick={() => setForm({ status: "active" })}><UserPlus /> Invite user</Button>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(["all", "active", "invited", "inactive"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium capitalize", status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{s === "all" ? "All users" : s} <span className="opacity-70">{counts[s]}</span></button>
          ))}
          <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, email, phone or role…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {!roles.length && canManage && <p className="mb-3 rounded-xl bg-primary/5 px-3 py-2 text-sm">Make roles with detailed permissions under <Link to="/settings/roles" className="font-semibold text-primary">Roles</Link>, then give them to people here.</p>}
        {!list.length ? <EmptyState icon={Users} title="Nobody here" /> : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="dt min-w-[760px]">
              <thead><tr><th>User</th><th>Role</th><th>Branches</th><th>Status</th><th>Last signed in</th><th /></tr></thead>
              <tbody><PagedRows rows={list} colSpan={6}>{(pageRows) => pageRows.map((p) => { const st = stateOf(p); return (
                <tr key={p.user_id} className="cursor-pointer" onClick={() => setOpen(p.user_id)}>
                  <td><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{String(p.display_name || p.email || "?").charAt(0).toUpperCase()}</span><span><b>{p.display_name}</b>{p.user_id === user?.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}<span className="block text-xs text-muted-foreground">{p.email}</span></span></div></td>
                  <td>{roleName(p)}</td>
                  <td className="text-xs text-muted-foreground">{p.location_ids?.length ? p.location_ids.map((id) => (locations as any[]).find((l) => l.id === id)?.name).filter(Boolean).join(", ") : "All branches"}</td>
                  <td><Pill tone={st === "active" ? "success" : st === "invited" ? "info" : "muted"}>{st}</Pill></td>
                  <td className="text-xs text-muted-foreground">{p.last_sign_in_at ? fmtDate(p.last_sign_in_at) : "Never"}</td>
                  <td onClick={(e) => e.stopPropagation()}>{canManage && p.role !== "owner" && p.user_id !== user?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="User actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setForm(p)}><Pencil /> Edit</DropdownMenuItem>
                        {st === "invited" ? <DropdownMenuItem onSelect={() => void reset(p, true)}><MailCheck /> Resend invitation</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void reset(p, false)}><KeyRound /> Reset password</DropdownMenuItem>}
                        {st === "inactive" ? <DropdownMenuItem onSelect={() => void setActive(p, true)}><CheckCircle2 /> Mark as active</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void setActive(p, false)}><Ban /> Mark as inactive</DropdownMenuItem>}
                        <DropdownMenuItem danger onSelect={() => void remove(p)}><Trash2 /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}</td>
                </tr>
              ); })}</PagedRows></tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <Modal open onClose={() => setOpen(null)} size="lg" title={selected.display_name} icon={Users} description={selected.email}
          footer={canManage && selected.role !== "owner" && selected.user_id !== user?.id ? <div className="flex w-full flex-wrap gap-2">
            <Button onClick={() => { setForm(selected); setOpen(null); }}><Pencil /> Edit</Button>
            {stateOf(selected) === "invited" ? <Button variant="outline" disabled={!!busy} onClick={() => void reset(selected, true)}><MailCheck /> Resend invitation</Button> : <Button variant="outline" disabled={!!busy} onClick={() => void reset(selected, false)}><KeyRound /> Reset password</Button>}
            {stateOf(selected) === "inactive" ? <Button variant="outline" disabled={!!busy} onClick={() => void setActive(selected, true)}><CheckCircle2 /> Mark as active</Button> : <Button variant="outline" disabled={!!busy} onClick={() => void setActive(selected, false)}><Ban /> Mark as inactive</Button>}
            <Button variant="ghost" className="ml-auto text-destructive" disabled={!!busy} onClick={() => void remove(selected)}><Trash2 /> Delete</Button>
          </div> : undefined}>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p><span className="block text-xs text-muted-foreground">Role</span><span className="inline-flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> {roleName(selected)}</span></p>
            <p><span className="block text-xs text-muted-foreground">Status</span><Pill tone={stateOf(selected) === "active" ? "success" : stateOf(selected) === "invited" ? "info" : "muted"}>{stateOf(selected)}</Pill></p>
            <p><span className="block text-xs text-muted-foreground">Phone</span>{selected.phone || "—"}</p>
            <p><span className="block text-xs text-muted-foreground">Cost per hour</span>{selected.cost_per_hour ?? "—"}</p>
            <p><span className="block text-xs text-muted-foreground">Invited</span>{selected.invited_at ? fmtDate(selected.invited_at) : fmtDate(selected.created_at)}</p>
            <p><span className="block text-xs text-muted-foreground">Last signed in</span>{selected.last_sign_in_at ? fmtDate(selected.last_sign_in_at) : "Never"}</p>
            <p className="sm:col-span-2"><span className="block text-xs text-muted-foreground">Accessible branches</span><span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-muted-foreground" />{selected.location_ids?.length ? selected.location_ids.map((id) => (locations as any[]).find((l) => l.id === id)?.name).filter(Boolean).join(", ") : "All branches"}</span></p>
            <p><span className="block text-xs text-muted-foreground">Address</span>{selected.address || "—"}</p>
            <p><span className="block text-xs text-muted-foreground">Remarks</span>{selected.remarks || "—"}</p>
          </div>
        </Modal>
      )}
      {form && <UserForm person={form} roles={roles} locations={locations as any[]} onClose={(saved) => { setForm(null); if (saved) refresh(); }} />}
    </div>
  );
}

function UserForm({ person, roles, locations, onClose }: { person: Partial<Person>; roles: any[]; locations: any[]; onClose: (saved?: boolean) => void }) {
  const editing = !!person.user_id;
  const [f, setF] = useState({ display_name: person.display_name || "", email: person.email || "", phone: person.phone || "", company_role_id: person.company_role_id || "", role: person.role && !["owner"].includes(person.role) ? person.role : "cashier",
    location_ids: person.location_ids || [], cost_per_hour: person.cost_per_hour != null ? String(person.cost_per_hour) : "", address: person.address || "", remarks: person.remarks || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.display_name.trim()) return toast.error("Enter the name");
    if (!editing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return toast.error("Enter a valid email address");
    if (!f.company_role_id && f.role !== "admin" && roles.length) return toast.error("Choose a role");
    setBusy(true);
    const r = editing
      ? await updateStaffAccount({ user_id: person.user_id!, display_name: f.display_name.trim(), phone: f.phone.trim(), location_ids: f.location_ids, cost_per_hour: f.cost_per_hour, address: f.address, remarks: f.remarks, ...(f.company_role_id !== (person.company_role_id || "") ? { company_role_id: f.company_role_id || null } : {}) })
      : await createStaffAccount({ email: f.email.trim().toLowerCase(), password: "", display_name: f.display_name.trim(), phone: f.phone.trim() || null, role: f.role, company_role_id: f.company_role_id || null, location_id: f.location_ids[0] || null, location_ids: f.location_ids, cost_per_hour: f.cost_per_hour, address: f.address, remarks: f.remarks });
    setBusy(false);
    if (r.error) return toast.error(r.error);
    toast.success(editing ? "User saved" : `Invitation sent to ${f.email}`, { description: editing ? undefined : "They get a temporary password by email and choose their own when they first sign in." });
    onClose(true);
  };
  const toggleLoc = (id: string) => setF({ ...f, location_ids: f.location_ids.includes(id) ? f.location_ids.filter((x) => x !== id) : [...f.location_ids, id] });
  return (
    <Modal open onClose={() => onClose()} size="lg" title={editing ? `Edit ${person.display_name}` : "Invite user"} icon={UserPlus} locked={busy}
      footer={<><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>{busy && <OrbSpinner state="working" />} {editing ? "Save" : "Send invitation"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><input className="fi" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} autoFocus /></Field>
        <Field label="Email address" required={!editing} hint={editing ? "The sign-in email cannot be changed here" : undefined}><input className="fi" type="email" value={f.email} disabled={editing} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="fi" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="07XX XXX XXX" /></Field>
        <Field label="Role" required>
          <select className="fi" value={f.company_role_id || (f.role === "admin" ? "__admin" : "")} onChange={(e) => e.target.value === "__admin" ? setF({ ...f, company_role_id: "", role: "admin" }) : setF({ ...f, company_role_id: e.target.value, role: roles.find((r) => r.id === e.target.value)?.base_role || "cashier" })}>
            <option value="">Choose…</option>
            {!editing && <option value="__admin">Admin (everything)</option>}
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Cost per hour" hint="Used for project and timesheet costs"><input className="fi" type="number" min={0} step="any" value={f.cost_per_hour} onChange={(e) => setF({ ...f, cost_per_hour: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">Restrict access to branches</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setF({ ...f, location_ids: [] })} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", !f.location_ids.length ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>All branches</button>
            {locations.map((l) => <button key={l.id} type="button" onClick={() => toggleLoc(l.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", f.location_ids.includes(l.id) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l.name}</button>)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">The first branch picked is their main one (the till opens there).</p>
        </div>
        <Field label="Address" className="sm:col-span-2"><textarea className="fi" rows={2} maxLength={200} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><textarea className="fi" rows={2} maxLength={255} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

