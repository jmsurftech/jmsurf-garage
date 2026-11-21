import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Ban, Building2, Download, KeyRound, Link2, LogOut, Mail, MailCheck, ShieldOff, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PagedRows } from "@/components/Pager";
import { downloadCsv } from "@/lib/fetchAll";
import { adminCall, roleLabel } from "@/lib/adminApi";
import { confirmAction } from "@/components/books/confirm";
import { EmptyState, ExportMenu, MoreMenu, PageHeader, Panel, Pill, SearchBox, Segmented, TableWrap, Toolbar } from "@/components/kit";
import AdminUserAccess from "./AdminUserAccess";
import { OneTimePasswordModal } from "@/components/admin/company/CompanyUsers";
import { useCompanies } from "@/components/admin/company/data";

type Login = {
  user_id: string; email: string; phone: string; name: string; platform_owner: boolean; verified: boolean; banned: boolean;
  last_sign_in_at: string | null; created_at: string; mfa: boolean; sessions: number; current_tenant_id: string | null;
  companies: { tenant_id: string; name: string; role: string; status: string; is_owner: boolean; archived: boolean }[];
};
const FILTERS = [["all", "All"], ["blocked", "Sign-in blocked"], ["mfa", "Two-step on"], ["never", "Never signed in"], ["none", "No company"]] as const;

/**
 * Admin → Users: find anyone across every company: which companies they are in, their role and last
 * sign-in. Adding people and changing roles happens on the company's Users tab.
 */
export default function AdminUsers() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: users = [], isLoading, error, refetch } = useQuery({ queryKey: ["admin-all-users"], queryFn: async () => (await adminCall<{ users: Login[] }>("users/all")).users });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [access, setAccess] = useState<Login | null>(null);
  const [pwFor, setPwFor] = useState<Login | null>(null);

  const all = useCompanies().companies;
  const companies = useMemo(() => all.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, business_name: c.business_name })).sort((a, b) => a.business_name.localeCompare(b.business_name)), [all]);
  const counts = useMemo(() => ({
    all: users.length, blocked: users.filter((u) => u.banned).length, mfa: users.filter((u) => u.mfa).length,
    never: users.filter((u) => !u.last_sign_in_at).length, none: users.filter((u) => !u.companies.length && !u.platform_owner).length,
  }), [users]);
  const q = search.trim().toLowerCase();
  const rows = users
    .filter((u) => filter === "all" || (filter === "blocked" ? u.banned : filter === "mfa" ? u.mfa : filter === "never" ? !u.last_sign_in_at : !u.companies.length && !u.platform_owner))
    .filter((u) => !q || `${u.name} ${u.email} ${u.phone} ${u.companies.map((c) => c.name).join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => (b.last_sign_in_at || "").localeCompare(a.last_sign_in_at || ""));

  const act = async (path: Parameters<typeof adminCall>[0], u: Login, body: Record<string, unknown>, ok: string) => {
    try { await adminCall(path, { user_id: u.user_id, ...body }); toast.success(ok); void qc.invalidateQueries({ queryKey: ["admin-all-users"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Users" icon={Users} actions={
        <ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !rows.length, onSelect: () => downloadCsv(`garage-users-${new Date().toISOString().slice(0, 10)}.csv`,
          ["Name", "Email", "Phone", "Companies", "Last sign-in", "Two-step", "Sign-in blocked"],
          rows.map((u) => [u.name, u.email, u.phone, u.companies.map((c) => `${c.name} (${roleLabel(c.role)})`).join("; "), u.last_sign_in_at ? u.last_sign_in_at.slice(0, 16).replace("T", " ") : "", u.mfa ? "Yes" : "No", u.banned ? "Yes" : "No"])) }]} />
      } />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email, phone or company" />
        <Segmented value={filter} onChange={setFilter} options={FILTERS.map(([v, l]) => ({ value: v, label: l, count: counts[v] }))} />
      </Toolbar>

      <Panel flush>
        {error ? <EmptyState icon={Users} title="Could not load the users" description={(error as Error).message} action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>} />
          : !rows.length ? <EmptyState icon={Users} title={isLoading ? "Loading…" : q ? "Nobody matches your search" : "Nobody here"} />
          : (
            <TableWrap>
              <table className="dt">
                <thead><tr><th>Name</th><th className="hidden md:table-cell">Phone</th><th>Companies</th><th className="hidden lg:table-cell">Last sign-in</th><th className="w-10" /></tr></thead>
                <tbody>
                  <PagedRows rows={rows} colSpan={5}>{(page) => page.map((u) => (
                    <tr key={u.user_id}>
                      <td>
                        <p className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span className="max-w-[220px] truncate">{u.name || u.email || "Unnamed"}</span>
                          {u.platform_owner && <Pill tone="primary">Platform owner</Pill>}
                          {u.banned && <Pill tone="danger">Blocked</Pill>}
                          {u.mfa && <Pill tone="info">Two-step</Pill>}
                          {!u.verified && <Pill tone="warning">Email not confirmed</Pill>}
                        </p>
                        <p className="max-w-[260px] truncate text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="hidden whitespace-nowrap md:table-cell">{u.phone || "—"}</td>
                      <td>
                        <div className="flex max-w-[360px] flex-wrap gap-1">
                          {u.companies.map((c) => (
                            <Link key={c.tenant_id} to={`/admin/companies/${c.tenant_id}?tab=users`} title={`${c.name}: ${roleLabel(c.role)}${c.status !== "active" ? " (no access)" : ""}`}
                              className={`inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] hover:border-primary/50 hover:text-primary ${c.status !== "active" || c.archived ? "opacity-60" : ""}`}>
                              <Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{c.name}</span><span className="shrink-0 text-muted-foreground">· {c.is_owner ? "Owner" : roleLabel(c.role)}</span>
                            </Link>
                          ))}
                          {!u.companies.length && <span className="text-xs text-muted-foreground">{u.platform_owner ? "All (platform)" : "None"}</span>}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell" title={u.last_sign_in_at ? format(new Date(u.last_sign_in_at), "d MMM yyyy, HH:mm") : undefined}>
                        {u.last_sign_in_at ? formatDistanceToNow(new Date(u.last_sign_in_at), { addSuffix: true }) : "Never"}
                      </td>
                      <td>
                        {!u.platform_owner && (
                          <MoreMenu iconOnly items={[
                            { label: "Open their company", icon: Building2, hidden: !u.companies.length, onSelect: () => nav(`/admin/companies/${u.current_tenant_id && u.companies.some((c) => c.tenant_id === u.current_tenant_id) ? u.current_tenant_id : u.companies[0]?.tenant_id}?tab=users`) },
                            { label: "Companies and linked logins", icon: Link2, onSelect: () => setAccess(u) },
                            { label: "Send password reset link", icon: Mail, separator: true, hidden: !u.email, onSelect: () => void act("users/reset", u, {}, `Reset link sent to ${u.email}`) },
                            { label: "Set a one-time password", icon: KeyRound, onSelect: () => setPwFor(u) },
                            { label: "Mark email confirmed", icon: MailCheck, hidden: u.verified, onSelect: () => void act("users/verify", u, {}, "Email confirmed") },
                            { label: "Reset two-step sign-in", icon: ShieldOff, hidden: !u.mfa, onSelect: async () => { if (await confirmAction({ title: "Reset two-step sign-in?", message: "Their authenticator is removed and they are signed out.", confirmLabel: "Reset" })) void act("users/mfa", u, {}, "Two-step sign-in reset"); } },
                            { label: "Sign out everywhere", icon: LogOut, hidden: !u.sessions, onSelect: () => void act("users/signout", u, {}, "Signed out everywhere") },
                            u.banned
                              ? { label: "Allow sign-in", icon: UserCheck, separator: true, onSelect: () => void act("users/login", u, { enabled: true }, "Sign-in allowed") }
                              : { label: "Block sign-in", icon: Ban, separator: true, danger: true, onSelect: async () => { if (await confirmAction({ title: "Block sign-in?", message: "They are signed out now and cannot sign in to any company until you allow it again.", confirmLabel: "Block", danger: true })) void act("users/login", u, { enabled: false }, "Sign-in blocked"); } },
                            { label: "Delete login for good", icon: Trash2, danger: true, hidden: u.companies.some((c) => c.is_owner && !c.archived), onSelect: async () => { if (await confirmAction({ title: `Delete ${u.email}?`, message: "The login is removed for good and cannot be brought back. Their records stay. To stop them for now, block sign-in instead.", confirmLabel: "Delete for good", danger: true })) void act("users/delete", u, {}, "Login deleted"); } },
                          ]} />
                        )}
                      </td>
                    </tr>
                  ))}</PagedRows>
                </tbody>
              </table>
            </TableWrap>
          )}
      </Panel>

      <OneTimePasswordModal user={pwFor ? { user_id: pwFor.user_id, label: pwFor.name || pwFor.email } : null} onClose={() => setPwFor(null)} />
      {access && <AdminUserAccess user={{ user_id: access.user_id, email: access.email, display_name: access.name || null }} tenants={companies} onClose={() => { setAccess(null); void qc.invalidateQueries({ queryKey: ["admin-all-users"] }); }} />}
    </div>
  );
}
