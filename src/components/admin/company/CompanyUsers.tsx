import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Ban, Copy, Crown, KeyRound, LogIn, LogOut, Mail, MailCheck, ShieldOff, UserCheck, UserCog, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, MoreMenu, Panel, Pill, Segmented, TableWrap } from "@/components/kit";
import { confirmAction } from "@/components/books/confirm";
import { adminCall, COMPANY_ROLES, roleLabel } from "@/lib/adminApi";
import { openCompany } from "@/components/admin/AdminCompanyGroup";
import type { Company } from "./data";

export type CompanyUser = {
  user_id: string; name: string; email: string; phone: string; role: string; is_owner: boolean; status: string; banned: boolean;
  verified: boolean; mfa: boolean; last_sign_in_at: string | null; last_used_at: string | null; working_here: boolean;
  must_change_password: boolean; created_at: string; missing: boolean;
};
type UsersData = { users: CompanyUser[]; max_users: number; active: number };

export function useCompanyUsers(tenantId: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-company-users", tenantId], enabled: !!tenantId, queryFn: () => adminCall<UsersData>("companies/users", { tenant_id: tenantId }) });
  return { data: q.data, loading: q.isLoading, error: q.error as Error | null, reload: () => qc.invalidateQueries({ queryKey: ["admin-company-users", tenantId] }) };
}

const ago = (d: string | null) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : "Never");

/** Admin → company → Users: everyone in the company and everything the platform owner can do for them. */
export default function CompanyUsers({ company, state, onChanged }: { company: Company; state: ReturnType<typeof useCompanyUsers>; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [roleFor, setRoleFor] = useState<CompanyUser | null>(null);
  const [pwFor, setPwFor] = useState<CompanyUser | null>(null);
  const list = state.data?.users || [];
  const cap = state.data?.max_users || 0;
  const active = state.data?.active || 0;
  const archived = !!company.deleted_at;

  const act = async (path: Parameters<typeof adminCall>[0], body: Record<string, unknown>, ok: string) => {
    try { await adminCall(path, { tenant_id: company.id, ...body }); toast.success(ok); onChanged(); }
    catch (e: any) { toast.error(e.message); }
  };
  const ask = async (title: string, message: string, label: string, danger = false) => confirmAction({ title, message, confirmLabel: label, danger });

  return (
    <>
      <Panel flush title="Users" icon={Users}
        description="Everyone who can sign in to this company. Blocking a sign-in applies to every company the person is in."
        actions={!archived && <>
          <span className="hidden text-xs text-muted-foreground sm:inline">{active}{cap ? ` of ${cap}` : ""} active</span>
          <Button size="sm" onClick={() => setAdding(true)} disabled={!!cap && active >= cap} title={cap && active >= cap ? "The plan's user limit is reached: raise it under Subscription → Custom deal" : undefined}><UserPlus /> Add user</Button>
        </>}>
        {state.error ? <EmptyState icon={Users} title="Could not load the users" description={state.error.message} action={<Button size="sm" variant="outline" onClick={() => void state.reload()}>Try again</Button>} />
          : !list.length ? <EmptyState icon={Users} title={state.loading ? "Loading…" : "Nobody yet"} />
          : (
            <TableWrap>
              <table className="dt">
                <thead><tr><th>Name</th><th className="hidden md:table-cell">Phone</th><th>Role</th><th>Status</th><th className="hidden lg:table-cell">Last sign-in</th><th className="w-10" /></tr></thead>
                <tbody>
                  {list.map((u) => (
                    <tr key={u.user_id}>
                      <td>
                        <p className="flex flex-wrap items-center gap-1.5 font-medium"><span className="max-w-[220px] truncate">{u.name || u.email || "Unnamed"}</span>{u.is_owner && <Pill tone="primary"><Crown className="h-3 w-3" /> Owner</Pill>}</p>
                        <p className="max-w-[260px] truncate text-xs text-muted-foreground">{u.email || "No email"}</p>
                      </td>
                      <td className="hidden whitespace-nowrap md:table-cell">{u.phone || "—"}</td>
                      <td className="whitespace-nowrap">{roleLabel(u.role)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {u.banned ? <Pill tone="danger">Sign-in blocked</Pill> : u.status !== "active" ? <Pill tone="warning">No access</Pill> : <Pill tone="success">Active</Pill>}
                          {u.mfa && <Pill tone="info">Two-step</Pill>}
                          {u.must_change_password && <Pill>New password due</Pill>}
                          {!u.verified && <Pill tone="warning">Email not confirmed</Pill>}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell" title={u.last_sign_in_at ? format(new Date(u.last_sign_in_at), "d MMM yyyy, HH:mm") : undefined}>{ago(u.last_sign_in_at)}</td>
                      <td>
                        <MoreMenu iconOnly items={[
                          { label: "Change role", icon: UserCog, onSelect: () => setRoleFor(u), hidden: u.is_owner || archived },
                          { label: "Make owner", icon: Crown, hidden: u.is_owner || u.status !== "active" || archived, onSelect: async () => {
                            if (await ask(`Make ${u.name || u.email} the owner?`, `They become the owner and administrator of ${company.business_name}, and its contact. The current owner stays in the company.`, "Make owner")) void act("companies/owner", { user_id: u.user_id }, "Ownership transferred");
                          } },
                          { label: "Open as this person", icon: LogIn, hidden: archived || u.banned || u.status !== "active", separator: true, onSelect: async () => { const err = await openCompany(company.id, u.user_id); if (err) toast.error(err); } },
                          { label: "Send password reset link", icon: Mail, hidden: !u.email, onSelect: () => void act("users/reset", { user_id: u.user_id }, `Reset link sent to ${u.email}`) },
                          { label: "Set a one-time password", icon: KeyRound, onSelect: () => setPwFor(u) },
                          { label: "Mark email confirmed", icon: MailCheck, hidden: u.verified, onSelect: () => void act("users/verify", { user_id: u.user_id }, "Email confirmed") },
                          { label: "Reset two-step sign-in", icon: ShieldOff, hidden: !u.mfa, onSelect: async () => {
                            if (await ask("Reset two-step sign-in?", "Their authenticator is removed and they are signed out. They can set it up again after signing in.", "Reset")) void act("users/mfa", { user_id: u.user_id }, "Two-step sign-in reset");
                          } },
                          { label: "Sign out everywhere", icon: LogOut, onSelect: () => void act("users/signout", { user_id: u.user_id }, "Signed out everywhere") },
                          u.banned
                            ? { label: "Allow sign-in", icon: UserCheck, separator: true, onSelect: () => void act("users/login", { user_id: u.user_id, enabled: true }, "Sign-in allowed") }
                            : { label: "Block sign-in", icon: Ban, separator: true, onSelect: async () => {
                              if (await ask("Block sign-in?", "They are signed out now and cannot sign in to any company until you allow it again.", "Block", true)) void act("users/login", { user_id: u.user_id, enabled: false }, "Sign-in blocked");
                            } },
                          { label: "Remove from company", icon: UserMinus, danger: true, hidden: u.is_owner, onSelect: async () => {
                            if (await ask(`Remove ${u.name || u.email}?`, "They lose access to this company. If it was their only company, their sign-in is blocked too. Their records stay.", "Remove", true)) void act("companies/user-remove", { user_id: u.user_id }, "Removed from the company");
                          } },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Panel>

      <AddUserModal open={adding} company={company} onClose={() => setAdding(false)} onDone={onChanged} />
      <OneTimePasswordModal user={pwFor ? { user_id: pwFor.user_id, label: pwFor.name || pwFor.email } : null} tenantId={company.id} onClose={() => setPwFor(null)} onDone={onChanged} />
      <RoleModal user={roleFor} onClose={() => setRoleFor(null)} onSave={async (role) => { await act("companies/user-role", { user_id: roleFor!.user_id, role }, "Role changed"); setRoleFor(null); }} />
    </>
  );
}

/** Sets a one-time password (typed, or made here) and shows it once; they choose their own at the next sign-in. */
export function OneTimePasswordModal({ user, tenantId, onClose, onDone }: { user: { user_id: string; label: string } | null; tenantId?: string; onClose: () => void; onDone?: () => void }) {
  const [pw, setPw] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) { setPw(""); setShown(null); } }, [user]);
  const save = async () => {
    setBusy(true);
    try { const r = await adminCall<{ password: string }>("users/password", { user_id: user!.user_id, tenant_id: tenantId, password: pw || undefined }); setShown(r.password); onDone?.(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal center open={!!user} onClose={onClose} size="sm" icon={KeyRound} title="Set a one-time password" description={user?.label}
      footer={shown ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (!!pw && pw.length < 8)} onClick={save}>{busy ? "Saving…" : "Set password"}</Button>
      </>}>
      {shown ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-success/10 p-3">Give them this password. They are signed out now and choose their own at the next sign-in. It is not shown again.</p>
          <div className="flex items-center gap-2 rounded-xl border border-border p-3">
            <code className="min-w-0 flex-1 truncate font-mono text-base">{shown}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(shown); toast.success("Copied"); }}><Copy /> Copy</Button>
          </div>
        </div>
      ) : (
        <Field label="One-time password" hint="Leave empty to make one. At least 8 characters.">
          <input className="fi" type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Enter a one-time password" autoFocus />
        </Field>
      )}
    </Modal>
  );
}

function RoleModal({ user, onClose, onSave }: { user: CompanyUser | null; onClose: () => void; onSave: (role: string) => Promise<void> }) {
  const [role, setRole] = useState("cashier");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) setRole(user.role); }, [user]);
  return (
    <Modal center open={!!user} onClose={onClose} size="sm" icon={UserCog} title="Change role" description={user ? user.name || user.email : ""}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || role === user?.role} onClick={async () => { setBusy(true); await onSave(role); setBusy(false); }}>{busy ? "Saving…" : "Save"}</Button>
      </>}>
      <Field label="Role"><select className="fi" value={role} onChange={(e) => setRole(e.target.value)}>{COMPANY_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    </Modal>
  );
}

const BLANK = { email: "", name: "", phone: "", role: "cashier", method: "link" as "link" | "password", password: "" };

/** A new person in the company: a new login, or an existing login given access. */
function AddUserModal({ open, company, onClose, onDone }: { open: boolean; company: Company; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; password?: string; existing?: boolean; emailed?: boolean } | null>(null);
  useEffect(() => { if (open) { setF(BLANK); setResult(null); } }, [open]);
  const set = (k: keyof typeof BLANK, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await adminCall<{ password?: string; existing?: boolean; emailed?: boolean }>("companies/user-add", {
        tenant_id: company.id, email: f.email.trim(), name: f.name.trim(), phone: f.phone.trim(), role: f.role, method: f.method,
        password: f.method === "password" ? f.password : undefined,
      });
      onDone();
      setResult({ email: f.email.trim(), ...r });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={UserPlus} title="Add user" description={company.business_name}
      footer={result ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || !f.email.includes("@") || !f.name.trim() || (f.method === "password" && !!f.password && f.password.length < 8)}>{busy ? "Adding…" : "Add user"}</Button>
      </>}>
      {result ? (
        <div className="space-y-3 text-sm">
          {result.existing ? (
            <p className="rounded-xl bg-success/10 p-3">{result.email} already had a JMSURF Garage login. They now have access to {company.business_name}{result.emailed ? " and were told by email" : ""}.</p>
          ) : result.password ? (
            <>
              <p className="rounded-xl bg-success/10 p-3">Login created for {result.email}. Give them this one-time password; they choose their own at the first sign-in. It is not shown again.</p>
              <div className="flex items-center gap-2 rounded-xl border border-border p-3">
                <code className="min-w-0 flex-1 truncate font-mono text-base">{result.password}</code>
                <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(result.password || ""); toast.success("Copied"); }}><Copy /> Copy</Button>
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-success/10 p-3">Login created for {result.email}. {result.emailed ? "They were emailed a link to set their password." : "The email did not go out: use Send password reset link on their row."}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" required className="sm:col-span-2" hint="If this email already has a login, they are given access to this company."><input className="fi" type="email" placeholder="Enter email" value={f.email} onChange={(e) => set("email", e.target.value)} autoFocus /></Field>
            <Field label="Full name" required><input className="fi" placeholder="Enter full name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Phone"><input className="fi" inputMode="tel" placeholder="Enter phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Role" className="sm:col-span-2"><select className="fi" value={f.role} onChange={(e) => set("role", e.target.value)}>{COMPANY_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">First sign-in</p>
            <Segmented value={f.method} onChange={(v) => set("method", v)} options={[{ value: "link", label: "Email a set-password link" }, { value: "password", label: "One-time password" }]} />
            {f.method === "password" ? (
              <Field hint="Leave empty to make one. They must change it when they first sign in.">
                <input className="fi" type="text" autoComplete="new-password" placeholder="Enter a one-time password" value={f.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
            ) : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><KeyRound className="h-3.5 w-3.5" /> They get an email with a link to choose their own password.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
