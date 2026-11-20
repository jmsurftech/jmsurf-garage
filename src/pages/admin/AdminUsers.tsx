import { useEffect, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { supabase } from "@/integrations/supabase/client";
import { createStaffAccount, deleteStaffAccount, listStaffAccounts, resetStaffPassword, verifyUserAccount } from "@/lib/serverStaff";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Key, Trash2, UserPlus, AlertTriangle, MailCheck, Users as UsersIcon, Building2, ShieldOff, LogOut, Download, ShieldCheck, LogIn } from "lucide-react";
import { fetchAll, downloadCsv } from "@/lib/fetchAll";
import AdminUserAccess from "./AdminUserAccess";
import { PageHeader, Toolbar, SearchBox, Panel, TableWrap, EmptyState, Field, Modal, Pill, StatGrid, StatTile, MoreMenu, ExportMenu, btnPrimaryCls } from "@/components/kit";

interface UserRow {
  user_id: string;
  email: string;
  phone: string;
  display_name: string;
  role: string;
  tenant_id: string | null;
  tenant_name: string;
  created_at: string;
  verified: boolean;
  mfa: boolean;
  last_sign_in: string | null;
  sessions: number;
}

interface TenantOption {
  id: string;
  business_name: string;
}

const ROLES = ["super_admin", "admin", "manager", "cashier", "stock_manager", "sales_person", "packaging", "rider"];

const usersCache: { users: UserRow[]; tenants: TenantOption[] } = { users: [], tenants: [] };

export default function AdminUsers() {
  // The last list is kept for the session, so coming back to Users shows it at once.
  const [users, setUsersState] = useState<UserRow[]>(() => usersCache.users);
  const [tenants, setTenantsState] = useState<TenantOption[]>(() => usersCache.tenants);
  const setUsers = (v: UserRow[]) => { usersCache.users = v; setUsersState(v); };
  const setTenants = (v: TenantOption[]) => { usersCache.tenants = v; setTenantsState(v); };
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", display_name: "", role: "cashier", tenant_id: "" });
  const [loading, setLoading] = useState(false);
  const [resetPwId, setResetPwId] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<UserRow | null>(null);
  const [verifyLookup, setVerifyLookup] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [shopFilter, setShopFilter] = useState("all");
  const [secFilter, setSecFilter] = useState("all");
  const [confirm, setConfirm] = useState<{ kind: "mfa" | "signout"; user: UserRow } | null>(null);
  const { toast } = useToast();

  const load = async () => {
    // Every row, not the database API's first 1,000.
    const [profiles, roles, tenantData, security] = await Promise.all([
      fetchAll<any>(() => supabase.from("profiles").select("user_id, display_name, phone, tenant_id, created_at").order("created_at")).catch(() => null),
      fetchAll<any>(() => supabase.from("user_roles").select("user_id, role").order("user_id")).catch(() => []),
      fetchAll<any>(() => (supabase as any).from("tenants").select("id, business_name").order("business_name")).catch(() => []),
      fetchAll<any>(() => (supabase as any).rpc("admin_user_security")).catch(() => []),
    ]);
    if (!profiles) return;
    const secMap: Record<string, { mfa: boolean; last_sign_in: string | null; sessions: number }> = {};
    (security || []).forEach((r: any) => { secMap[r.user_id] = { mfa: !!r.mfa, last_sign_in: r.last_sign_in, sessions: r.sessions || 0 }; });
    const sec = (id: string) => secMap[id] || { mfa: false, last_sign_in: null, sessions: 0 };
    
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    
    const tenantMap: Record<string, string> = {};
    const tenantList: TenantOption[] = [];
    (tenantData || []).forEach((t: any) => { 
      tenantMap[t.id] = t.business_name; 
      tenantList.push({ id: t.id, business_name: t.business_name });
    });
    setTenants(tenantList);
    if (!usersCache.users.length) {
      setUsers((profiles as any[]).map((p) => ({ user_id: p.user_id, email: "…", phone: p.phone || "—", display_name: p.display_name, role: roleMap[p.user_id] || "cashier", tenant_id: p.tenant_id, tenant_name: p.tenant_id ? (tenantMap[p.tenant_id] || "—") : "—", created_at: p.created_at, verified: false, ...sec(p.user_id) })));
    }

    const { data: authUsers } = await listStaffAccounts();
    const emailMap: Record<string, string> = {};
    const phoneMap: Record<string, string> = {};
    const verifiedMap: Record<string, boolean> = {};
    const liveIds = new Set<string>();
    if (authUsers?.users) {
      authUsers.users.forEach((u: any) => {
        liveIds.add(u.id);
        emailMap[u.id] = u.email;
        if (u.phone) phoneMap[u.id] = u.phone;
        verifiedMap[u.id] = !!u.email_confirmed_at;
      });
    }

    const seen = new Set<string>();
    const mapped: UserRow[] = (profiles as any[])
      // A login that no longer exists must disappear from this list at once.
      .filter(p => (liveIds.size === 0 || liveIds.has(p.user_id)) && !seen.has(p.user_id) && seen.add(p.user_id) !== undefined)
      .map(p => ({
        user_id: p.user_id,
        email: emailMap[p.user_id] || "—",
        phone: phoneMap[p.user_id] || p.phone || "—",
        display_name: p.display_name,
        role: roleMap[p.user_id] || "cashier",
        tenant_id: p.tenant_id,
        tenant_name: p.tenant_id ? (tenantMap[p.tenant_id] || "—") : "—",
        created_at: p.created_at,
        verified: !!verifiedMap[p.user_id],
        ...sec(p.user_id),
      }));
    setUsers(mapped);
  };

  useEffect(() => {
    load();
    // Keep this list in step with the shops: anybody added or removed anywhere
    // shows up here straight away, without a page refresh.
    const channel = supabase
      .channel("admin-users-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const secOk = (u: UserRow) => secFilter === "all" || (secFilter === "mfa" ? u.mfa : secFilter === "nomfa" ? !u.mfa : secFilter === "unverified" ? !u.verified : secFilter === "never" ? !u.last_sign_in : u.sessions > 0);
  const filtered = users.filter(u => (roleFilter === "all" || u.role === roleFilter) && (shopFilter === "all" || (shopFilter === "none" ? !u.tenant_id : u.tenant_id === shopFilter)) && secOk(u)).filter(u =>
    (u.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.phone || "").toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase()) ||
    u.tenant_name.toLowerCase().includes(search.toLowerCase())
  );

  const addUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.display_name) return;
    setLoading(true);
    try {
      const body: any = { 
        email: newUser.email, password: newUser.password, 
        display_name: newUser.display_name, role: newUser.role 
      };
      if (newUser.tenant_id) body.tenant_id = newUser.tenant_id;
      
      const { error } = await createStaffAccount(body);
      if (error) throw new Error(error);
      toast({ title: "User created", description: `${newUser.email} added as ${newUser.role}` });
      setShowAdd(false);
      setNewUser({ email: "", password: "", display_name: "", role: "cashier", tenant_id: "" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (userId: string) => {
    setLoading(true);
    try {
      const { data, error } = await resetStaffPassword(userId);
      if (error) throw new Error(error);
      toast({ title: "Password reset", description: data?.message || "The new password was sent to the user.", duration: 15000 });
      setResetPwId(null);
      setNewPassword("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Mark an account's email as verified by hand (super admin override).
  const verifyUser = async (payload: { user_id?: string; email?: string }) => {
    setLoading(true);
    try {
      const { data, error } = await verifyUserAccount(payload);
      if (error) throw new Error(error);
      toast({
        title: data?.alreadyVerified ? "Already verified" : "Account verified",
        description: `${data?.email || "The account"} can now sign in.`,
      });
      setVerifyLookup("");
      setShowVerify(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };


  const deleteUser = async (userId: string) => {
    setLoading(true);
    try {
      const { error } = await deleteStaffAccount(userId);
      if (error) throw new Error(error);
      toast({ title: "User deleted", description: "User has been permanently removed" });
      setDeleteConfirm(null);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Through the database so the change is checked (platform owners only) and recorded.
  const changeRole = async (userId: string, newRole: string) => {
    const { error } = await (supabase as any).rpc("admin_set_user_role", { p_user: userId, p_role: newRole });
    if (error) toast({ title: "Role not changed", description: error.message, variant: "destructive" });
    else toast({ title: "Role updated" });
    load();
  };

  const runSecurity = async () => {
    if (!confirm) return;
    setLoading(true);
    const fn = confirm.kind === "mfa" ? "admin_reset_user_mfa" : "admin_sign_out_user";
    const { data, error } = await (supabase as any).rpc(fn, { p_user: confirm.user.user_id });
    setLoading(false);
    if (error) { toast({ title: "Not done", description: error.message, variant: "destructive" }); return; }
    toast({ title: confirm.kind === "mfa" ? "Two-step sign-in reset" : "Signed out everywhere",
      description: confirm.kind === "mfa" ? `${data || 0} authenticator(s) removed. They can set it up again after signing in.` : `${data || 0} session(s) ended.` });
    setConfirm(null);
    load();
  };

  const exportCsv = () => downloadCsv(`dash-users-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Name", "Email", "Phone", "Company", "Role", "Email verified", "Two-step", "Last sign-in", "Active sessions", "Joined"],
    filtered.map((u) => [u.display_name, u.email, u.phone, u.tenant_id ? u.tenant_name : "Admin panel", u.role, u.verified ? "Yes" : "No", u.mfa ? "On" : "Off", u.last_sign_in ? new Date(u.last_sign_in).toLocaleString() : "Never", u.sessions, new Date(u.created_at).toLocaleDateString()]));
  const ago = (d: string | null) => {
    if (!d) return "Never";
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 43200 ? `${Math.round(m / 1440)} d ago` : new Date(d).toLocaleDateString();
  };
  const stats = { total: users.length, mfa: users.filter((u) => u.mfa).length, unverified: users.filter((u) => !u.verified).length, online: users.filter((u) => u.sessions > 0).length };

  const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const resetTarget = users.find((u) => u.user_id === resetPwId) || null;

  return (
    <div className="space-y-3">
      <PageHeader title="Users" icon={UsersIcon}
        actions={<>
          <ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !filtered.length, onSelect: exportCsv }]} />
          <MoreMenu items={[{ label: "Verify an email", icon: MailCheck, onSelect: () => setShowVerify(true) }]} />
          <button type="button" className={btnPrimaryCls} onClick={() => setShowAdd(true)}><UserPlus className="h-4 w-4" /> Add user</button>
        </>} />

      <StatGrid>
        <StatTile label="Logins" value={stats.total} icon={UsersIcon} />
        <StatTile label="Two-step on" value={stats.mfa} icon={ShieldCheck} tone="success" />
        <StatTile label="Signed in" value={stats.online} icon={LogIn} tone="info" />
        <StatTile label="Not verified" value={stats.unverified} icon={MailCheck} tone={stats.unverified ? "warning" : "muted"} />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search users" />
        <select className="fi w-auto max-w-full" value={shopFilter} onChange={(e) => setShopFilter(e.target.value)} aria-label="Company">
          <option value="all">All companies</option>
          <option value="none">Admin panel only</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.business_name}</option>)}
        </select>
        <select className="fi w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select className="fi w-auto" value={secFilter} onChange={(e) => setSecFilter(e.target.value)} aria-label="Security">
          <option value="all">Any status</option>
          <option value="signedin">Signed in now</option>
          <option value="mfa">Two-step on</option>
          <option value="nomfa">Two-step off</option>
          <option value="unverified">Email not verified</option>
          <option value="never">Never signed in</option>
        </select>
      </Toolbar>

      <Panel flush>
        {filtered.length === 0 ? <EmptyState icon={UsersIcon} title="No users found" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>User</th><th className="hidden lg:table-cell">Phone</th><th>Company</th><th>Role</th><th className="hidden md:table-cell">Security</th><th className="hidden xl:table-cell">Last sign-in</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={7}>{(pageRows) => pageRows.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{(u.display_name || u.email || "?").charAt(0).toUpperCase()}</span>
                        <div className="min-w-0">
                          <p className="max-w-[200px] truncate font-medium">{u.display_name || "Unnamed"}</p>
                          <p className="max-w-[200px] truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden text-muted-foreground lg:table-cell">{u.phone}</td>
                    <td className="max-w-[180px] truncate">{u.tenant_id ? u.tenant_name : <Pill tone="primary">Admin panel</Pill>}</td>
                    <td>
                      <select value={u.role} onChange={(e) => changeRole(u.user_id, e.target.value)} className="fi h-8 w-auto py-0 text-xs" aria-label="Role">
                        {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {u.verified ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Not verified</Pill>}
                        {u.mfa && <Pill tone="primary">Two-step</Pill>}
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell" title={`Joined ${new Date(u.created_at).toLocaleDateString()}`}>
                      {ago(u.last_sign_in)}{u.sessions > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-success align-middle" title={`${u.sessions} active session(s)`} />}
                    </td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        {!u.verified && (
                          <button className="icon-btn" title="Mark email verified" disabled={loading}
                            onClick={() => verifyUser({ user_id: u.user_id, email: u.email !== "—" ? u.email : undefined })}><MailCheck className="h-4 w-4" /></button>
                        )}
                        <button className="icon-btn" title="Companies and linked logins" onClick={() => setAccessFor(u)}><Building2 className="h-4 w-4" /></button>
                        <button className="icon-btn" title="Email a temporary password" onClick={() => setResetPwId(u.user_id)}><Key className="h-4 w-4" /></button>
                        {u.mfa && <button className="icon-btn" title="Reset two-step sign-in (lost phone)" onClick={() => setConfirm({ kind: "mfa", user: u })}><ShieldOff className="h-4 w-4" /></button>}
                        {u.sessions > 0 && <button className="icon-btn" title="Sign out everywhere" onClick={() => setConfirm({ kind: "signout", user: u })}><LogOut className="h-4 w-4" /></button>}
                        {u.role !== "super_admin" && (
                          <button className="icon-btn-danger" title="Delete login" onClick={() => setDeleteConfirm(u)}><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="lg" icon={UserPlus} title="Add a user"
        description={newUser.tenant_id ? "Signs in to the selected company." : "No company: admin panel only."}
        footer={<>
          <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button onClick={addUser} disabled={loading || !newUser.email || !newUser.password || !newUser.display_name}>{loading ? "Creating…" : "Create user"}</Button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required><input className="fi" placeholder="Enter full name" value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} /></Field>
          <Field label="Email" required><input className="fi" type="email" placeholder="Enter email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></Field>
          <Field label="Password" required hint="At least 6 characters"><input className="fi" type="password" placeholder="Enter password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></Field>
          <Field label="Role">
            <select className="fi" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </Field>
          <Field label="Company" className="sm:col-span-2">
            <select className="fi" value={newUser.tenant_id} onChange={(e) => setNewUser({ ...newUser, tenant_id: e.target.value })}>
              <option value="">No company — admin panel only</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.business_name}</option>)}
            </select>
          </Field>
        </div>
      </Modal>

      <Modal open={showVerify} onClose={() => setShowVerify(false)} size="sm" icon={MailCheck} title="Verify an email"
        description="Marks the email verified at once."
        footer={<>
          <Button variant="outline" onClick={() => setShowVerify(false)}>Cancel</Button>
          <Button disabled={loading || !verifyLookup.includes("@")} onClick={() => verifyUser({ email: verifyLookup.trim() })}>{loading ? "Working…" : "Verify"}</Button>
        </>}>
        <Field label="Email address"><input className="fi" type="email" value={verifyLookup} onChange={(e) => setVerifyLookup(e.target.value)} placeholder="Enter email address" autoFocus /></Field>
      </Modal>

      <Modal center open={!!resetTarget} onClose={() => setResetPwId(null)} size="sm" icon={Key} title="Send a temporary password?"
        description="A new password is emailed to the user. Their current password stops working."
        footer={<>
          <Button variant="outline" onClick={() => setResetPwId(null)}>Cancel</Button>
          <Button onClick={() => resetTarget && resetPassword(resetTarget.user_id)} disabled={loading}>{loading ? "Sending…" : "Send password"}</Button>
        </>}>
        {resetTarget && <div className="rounded-xl bg-muted/60 p-3 text-sm"><p className="font-semibold">{resetTarget.display_name}</p><p className="text-muted-foreground">{resetTarget.email}</p></div>}
      </Modal>

      <Modal center open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} size="sm" icon={AlertTriangle} title="Delete this login?"
        description="The person can no longer sign in. Their past sales and records are kept."
        footer={<>
          <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => deleteConfirm && deleteUser(deleteConfirm.user_id)} disabled={loading}>{loading ? "Deleting…" : "Delete login"}</Button>
        </>}>
        {deleteConfirm && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="font-semibold">{deleteConfirm.display_name}</p>
            <p className="text-muted-foreground">{deleteConfirm.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">{roleLabel(deleteConfirm.role)} · {deleteConfirm.tenant_name}</p>
          </div>
        )}
      </Modal>
      <Modal center open={!!confirm} onClose={() => setConfirm(null)} size="sm" icon={confirm?.kind === "mfa" ? ShieldOff : LogOut}
        title={confirm?.kind === "mfa" ? "Reset two-step sign-in?" : "Sign out everywhere?"}
        description={confirm?.kind === "mfa" ? "Removes their authenticator app (lost phone). They sign in with the password and can set it up again." : "Ends every session on every device. They have to sign in again."}
        footer={<>
          <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="destructive" onClick={runSecurity} disabled={loading}>{loading ? "Working…" : confirm?.kind === "mfa" ? "Reset two-step" : "Sign out"}</Button>
        </>}>
        {confirm && <div className="rounded-xl bg-muted/60 p-3 text-sm"><p className="font-semibold">{confirm.user.display_name}</p><p className="text-muted-foreground">{confirm.user.email}</p></div>}
      </Modal>
      {accessFor && <AdminUserAccess user={accessFor} tenants={tenants} onClose={() => { setAccessFor(null); void load(); }} />}
    </div>
  );
}
