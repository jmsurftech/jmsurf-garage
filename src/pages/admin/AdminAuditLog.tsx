import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Activity, Users, CreditCard, Building2, Package, RefreshCw, ShieldAlert, UserCog, ToggleRight, Download } from "lucide-react";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, EmptyState, PageLoader } from "@/components/kit";
import Pager from "@/components/Pager";
import { Button } from "@/components/ui/button";

interface AuditEntry {
  id: string;
  type: "signup" | "subscription" | "payment" | "login" | "tenant_access" | "admin" | "features";
  description: string;
  tenant_name?: string;
  created_at: string;
  metadata?: Record<string, any>;
}

const ACTION: Record<string, string> = { set_role: "changed the role of", reset_mfa: "reset two-step sign-in for", sign_out_everywhere: "signed out everywhere" };

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [days, setDays] = useState("30");
  const pageSize = 25;

  useEffect(() => { loadAudit(); }, [days]);
  useEffect(() => { setPage(1); }, [search, typeFilter, days]);

  const loadAudit = async () => {
    setLoading(true);
    // Everything in the chosen period, not just the latest few.
    const since = days === "all" ? "1970-01-01T00:00:00Z" : new Date(Date.now() - Number(days) * 86400000).toISOString();
    const sb = supabase as any;
    const [{ data: allTenants }, { data: subs }, { data: payments }, { data: access }, { data: actions }, { data: features }] = await Promise.all([
      allRows(() => sb.from("tenants").select("id, business_name, created_at, contact_email").order("created_at", { ascending: false })),
      allRows(() => sb.from("subscriptions").select("id, tenant_id, plan_name, status, created_at, updated_at").gte("created_at", since).order("created_at", { ascending: false })),
      allRows(() => sb.from("subscription_payments").select("id, tenant_id, amount, gateway, status, created_at").gte("created_at", since).order("created_at", { ascending: false })),
      allRows(() => sb.from("tenant_access_audit").select("id, user_email, user_tenant_slug, attempted_url, attempted_slug, redirected_to, created_at").gte("created_at", since).order("created_at", { ascending: false })),
      allRows(() => sb.from("platform_admin_actions").select("id, admin_id, action, target_type, target_id, detail, created_at").gte("created_at", since).order("created_at", { ascending: false })),
      allRows(() => sb.from("feature_audit_logs").select("id, actor_email, scope, tenant_id, diff, created_at").gte("created_at", since).order("created_at", { ascending: false })),
    ]);

    const tenantMap: Record<string, string> = {};
    (allTenants || []).forEach((t: any) => { tenantMap[t.id] = t.business_name; });
    const tenants = (allTenants || []).filter((t: any) => new Date(t.created_at) >= new Date(since));

    // Names for the admins and the people they acted on.
    const ids = [...new Set((actions || []).flatMap((a: any) => [a.admin_id, a.target_id]).filter(Boolean))];
    const people: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await sb.from("profiles").select("user_id, display_name").in("user_id", ids);
      (profs || []).forEach((p: any) => { people[p.user_id] = p.display_name; });
    }

    const auditEntries: AuditEntry[] = [];

    (actions || []).forEach((a: any) => {
      const who = people[a.admin_id] || "An admin";
      const target = people[a.target_id] || tenantMap[a.target_id] || "a user";
      let description = `${who} ${ACTION[a.action] || a.action} ${target}`;
      if (a.action === "set_role") description += ` (${a.detail?.from || "none"} → ${a.detail?.to})`;
      if (a.action === "sign_out_everywhere") description = `${who} signed ${target} out everywhere (${a.detail?.sessions_ended ?? 0} sessions)`;
      auditEntries.push({ id: `adm-${a.id}`, type: "admin", description, created_at: a.created_at });
    });

    (features || []).forEach((f: any) => {
      const changed = Object.keys(f.diff || {}).length;
      const where = f.scope === "plan" ? "on a package" : `for ${tenantMap[f.tenant_id] || "a company"}`;
      auditEntries.push({
        id: `feat-${f.id}`,
        type: "features",
        description: `${f.actor_email || "An admin"} changed ${changed || "the"} feature${changed === 1 ? "" : "s"} ${where}`,
        tenant_name: tenantMap[f.tenant_id],
        created_at: f.created_at,
      });
    });

    tenants.forEach((t: any) => {
      auditEntries.push({
        id: `signup-${t.id}`,
        type: "signup",
        description: `${t.business_name} signed up (${t.contact_email})`,
        tenant_name: t.business_name,
        created_at: t.created_at,
      });
    });

    (subs || []).forEach((s: any) => {
      auditEntries.push({
        id: `sub-${s.id}`,
        type: "subscription",
        description: `${tenantMap[s.tenant_id] || "Unknown"} → ${s.plan_name} (${s.status})`,
        tenant_name: tenantMap[s.tenant_id],
        created_at: s.created_at,
      });
    });

    (payments || []).forEach((p: any) => {
      auditEntries.push({
        id: `pay-${p.id}`,
        type: "payment",
        description: `KSh ${Number(p.amount).toLocaleString()} ${p.gateway === "paystack" ? "by Paystack" : p.gateway === "manual" ? "recorded manually" : "by M-Pesa"} (${p.status})`,
        tenant_name: tenantMap[p.tenant_id],
        created_at: p.created_at,
      });
    });

    (access || []).forEach((a: any) => {
      auditEntries.push({
        id: `acc-${a.id}`,
        type: "tenant_access",
        description: `${a.user_email || "Unknown user"} (own: /${a.user_tenant_slug || "—"}) tried ${a.attempted_url} → redirected to ${a.redirected_to}`,
        tenant_name: a.user_tenant_slug || undefined,
        created_at: a.created_at,
      });
    });

    auditEntries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setEntries(auditEntries);
    setLoading(false);
  };

  const META: Record<AuditEntry["type"], { icon: any; tone: string; label: string }> = {
    signup: { icon: Building2, tone: "bg-info/10 text-info", label: "Sign-up" },
    subscription: { icon: Package, tone: "bg-primary/10 text-primary", label: "Package" },
    payment: { icon: CreditCard, tone: "bg-success/10 text-success", label: "Payment" },
    login: { icon: Users, tone: "bg-muted text-muted-foreground", label: "Login" },
    tenant_access: { icon: ShieldAlert, tone: "bg-destructive/10 text-destructive", label: "Blocked access" },
    admin: { icon: UserCog, tone: "bg-warning/10 text-warning", label: "Admin action" },
    features: { icon: ToggleRight, tone: "bg-primary/10 text-primary", label: "Features" },
  };

  const filtered = entries.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    const q = search.toLowerCase();
    if (q && !e.description.toLowerCase().includes(q) && !(e.tenant_name || "").toLowerCase().includes(q)) return false;
    return true;
  });
  const count = (t: string) => entries.filter((e) => e.type === t).length;
  const exportCsv = () => downloadCsv(`dash-audit-${new Date().toISOString().slice(0, 10)}.csv`, ["When", "Type", "Company", "Event"],
    filtered.map((e) => [format(new Date(e.created_at), "yyyy-MM-dd HH:mm"), META[e.type].label, e.tenant_name, e.description]));

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="Audit log" description="Sign-ups, package changes, payments, admin actions, feature changes and blocked cross-company access." icon={Activity}
        actions={<>
          <select className="fi h-9 w-auto" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
            <option value="all">Everything</option>
          </select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}><Download /> Export</Button>
          <Button variant="outline" size="sm" onClick={loadAudit} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button>
        </>} />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search events…" />
        <Segmented value={typeFilter} onChange={setTypeFilter} options={[
          { value: "all", label: "All", count: entries.length },
          { value: "signup", label: "Sign-ups", count: count("signup") },
          { value: "subscription", label: "Packages", count: count("subscription") },
          { value: "payment", label: "Payments", count: count("payment") },
          { value: "admin", label: "Admin", count: count("admin") },
          { value: "features", label: "Features", count: count("features") },
          { value: "tenant_access", label: "Blocked", count: count("tenant_access") },
        ]} />
      </Toolbar>
      <Panel flush>
        {loading ? <PageLoader label="Loading activity…" /> : filtered.length === 0 ? <EmptyState icon={Activity} title="No events found" /> : (
          <>
            <ul className="divide-y divide-border">
              {filtered.slice((page - 1) * pageSize, page * pageSize).map((entry) => {
                const m = META[entry.type];
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${m.tone}`}><m.icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{entry.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{m.label}{entry.tenant_name ? ` · ${entry.tenant_name}` : ""}</p>
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{format(new Date(entry.created_at), "d MMM, HH:mm")}</time>
                  </li>
                );
              })}
            </ul>
            {filtered.length > pageSize && (
              <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} className="border-t border-border" />
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
