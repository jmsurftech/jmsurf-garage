import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Building2, Calendar, CreditCard, LogIn, MessageSquare, PauseCircle, PlayCircle, RotateCcw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Field, LineTabs, Modal, MoreMenu, PageHeader, PageLoader, RecordSplit, StatGrid, StatTile } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { adminCall } from "@/lib/adminApi";
import { openCompany } from "@/components/admin/AdminCompanyGroup";
import { companyName, endOf, ksh, useCompanies } from "@/components/admin/company/data";
import { CompanyStatusPill } from "@/components/admin/company/CompanyStatusPill";
import { useCompanyUsers } from "@/components/admin/company/CompanyUsers";
import CompanyOverview from "@/components/admin/company/CompanyOverview";
import CompanySubscription from "@/components/admin/company/CompanySubscription";
import CompanyUsers from "@/components/admin/company/CompanyUsers";
import CompanySms from "@/components/admin/company/CompanySms";
import CompanyActivity from "@/components/admin/company/CompanyActivity";
import { confirmAction } from "@/components/books/confirm";

const TABS = ["overview", "subscription", "users", "sms", "activity"] as const;
type Tab = (typeof TABS)[number];

/**
 * Admin → Companies → one company. Everything the platform owner does for a company and its
 * people is on this page: Overview, Subscription (plan, trial, free time, modules, custom deal,
 * payments), Users, SMS and Activity (notes and every admin change).
 */
export default function AdminCompany() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") || "") ? (params.get("tab") as Tab) : "overview";
  const setTab = (t: Tab) => setParams((q) => { const n = new URLSearchParams(q); if (t === "overview") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });
  const { companies, subs, plans, loading, reload } = useCompanies();
  const company = companies.find((c) => c.id === id);
  const sub = subs[id] || null;
  const users = useCompanyUsers(id);
  const { data: sms } = useQuery({
    queryKey: ["admin-company-sms-balance", id],
    queryFn: async () => ((await (supabase as any).from("tenant_sms_settings").select("balance_units,total_sent").eq("tenant_id", id).maybeSingle()).data || null) as { balance_units: number; total_sent: number } | null,
  });
  const [opening, setOpening] = useState(false);
  const [suspending, setSuspending] = useState(false);
  useEffect(() => { setSuspending(false); }, [id]);

  if (!company && loading) return <PageLoader />;
  if (!company) return <Navigate to="/admin/companies" replace />;

  const refresh = () => { void reload(); void users.reload(); };
  const end = endOf(sub);
  const suspended = sub?.status === "suspended" || sub?.status === "paused";
  const active = users.data?.active ?? 0;
  const cap = users.data?.max_users ?? sub?.max_users ?? 0;

  const run = async (path: Parameters<typeof adminCall>[0], body: Record<string, unknown>, ok: string) => {
    try { await adminCall(path, { tenant_id: id, ...body }); toast.success(ok); refresh(); return true; }
    catch (e: any) { toast.error(e.message); return false; }
  };
  const open = async () => {
    setOpening(true);
    const err = await openCompany(id);
    setOpening(false);
    if (err) toast.error(err);
  };

  const rail = companies.filter((c) => !c.deleted_at || c.id === id).map((c) => ({
    id: c.id, title: companyName(c), sub: subs[c.id]?.plan_name || "No plan",
    right: <CompanyStatusPill company={c} sub={subs[c.id]} />, search: `${c.business_name} ${c.contact_name} ${c.contact_email}`,
  }));

  return (
    <RecordSplit title="Companies" listTo="/admin/companies" rows={rail} currentId={id} hrefOf={(x) => `/admin/companies/${x}${tab === "overview" ? "" : `?tab=${tab}`}`} loading={loading}>
      <div className="space-y-3">
        <PageHeader title={companyName(company)} icon={Building2} actions={<>
          <CompanyStatusPill company={company} sub={sub} />
          {!company.deleted_at && <Button size="sm" variant="outline" disabled={opening} onClick={() => void open()} title="Open the company's workspace as yourself (support)"><LogIn /> {opening ? "Opening…" : "Open workspace"}</Button>}
          <MoreMenu items={[
            { label: "Suspend company", icon: PauseCircle, onSelect: () => setSuspending(true), hidden: suspended || !!company.deleted_at || !sub },
            { label: "Reactivate company", icon: PlayCircle, onSelect: () => void run("companies/reactivate", {}, "Company reactivated"), hidden: !suspended },
            { label: "Restore company", icon: RotateCcw, onSelect: () => void run("companies/restore", {}, "Company restored"), hidden: !company.deleted_at, separator: true },
            { label: "Archive company", icon: Archive, danger: true, separator: true, hidden: !!company.deleted_at, onSelect: async () => {
              if (await confirmAction({ title: `Archive ${companyName(company)}?`, message: "Nobody can sign in to it. Every record is kept and you can restore it at any time.", confirmLabel: "Archive", danger: true })) void run("companies/archive", {}, "Company archived");
            } },
          ]} />
        </>} />

        {suspended && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <b className="text-destructive">Suspended{sub?.suspended_at ? ` on ${format(new Date(sub.suspended_at), "d MMM yyyy")}` : ""}.</b>{" "}
            <span className="text-muted-foreground">Its people cannot sign in. Reason shown to them: {sub?.suspended_reason || "—"}</span>
          </div>
        )}
        {company.deleted_at && (
          <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            Archived on {format(new Date(company.deleted_at), "d MMM yyyy")}. Nobody can sign in; every record is kept. Restore it from More.
          </div>
        )}

        <StatGrid>
          <StatTile label="Plan" value={sub?.plan_name || "None"} hint={sub ? `${ksh(sub.price)}/mo · ${sub.billing_cycle || "monthly"}` : undefined} icon={CreditCard} tone="primary" />
          <StatTile label={sub?.status === "trial" || sub?.status === "trialing" ? "Trial ends" : sub?.comped_until ? "Free until" : "Paid until"} value={end ? format(new Date(end), "d MMM yyyy") : "—"} icon={Calendar} tone={end && Date.parse(end) < Date.now() ? "danger" : "info"} />
          <StatTile label="Users" value={users.data ? `${active}${cap ? ` / ${cap}` : ""}` : "…"} hint={cap ? "active / plan limit" : "active"} icon={Users} tone="muted" />
          <StatTile label="SMS balance" value={(sms?.balance_units ?? 0).toLocaleString()} hint={sms ? `${(sms.total_sent || 0).toLocaleString()} sent` : undefined} icon={MessageSquare} tone="success" />
        </StatGrid>

        <LineTabs value={tab} onChange={setTab} options={[
          { value: "overview", label: "Overview" },
          { value: "subscription", label: "Subscription" },
          { value: "users", label: "Users", count: users.data?.users.length },
          { value: "sms", label: "SMS" },
          { value: "activity", label: "Notes & activity" },
        ]} />

        {tab === "overview" && <CompanyOverview company={company} sub={sub} companies={companies} subs={subs} plans={plans} users={users.data?.users || []} onChanged={refresh} />}
        {tab === "subscription" && <CompanySubscription company={company} sub={sub} plans={plans} activeUsers={active} onChanged={refresh} />}
        {tab === "users" && <CompanyUsers company={company} state={users} onChanged={refresh} />}
        {tab === "sms" && <CompanySms tenantId={id} archived={!!company.deleted_at} />}
        {tab === "activity" && <CompanyActivity tenantId={id} />}
      </div>

      <SuspendModal open={suspending} name={companyName(company)} onClose={() => setSuspending(false)}
        onSuspend={async (reason) => { if (await run("companies/suspend", { reason }, "Company suspended. Its people were signed out.")) setSuspending(false); }} />
    </RecordSplit>
  );
}

function SuspendModal({ open, name, onClose, onSuspend }: { open: boolean; name: string; onClose: () => void; onSuspend: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal center open={open} onClose={onClose} size="md" icon={PauseCircle} title={`Suspend ${name}?`}
      description="Everyone in the company is signed out and cannot sign in until you reactivate it. Records are kept."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); await onSuspend(reason.trim()); setBusy(false); }}>{busy ? "Suspending…" : "Suspend"}</Button>
      </>}>
      <Field label="Reason" required hint="They see it when they try to sign in.">
        <textarea className="fi min-h-[90px]" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter the reason" autoFocus />
      </Field>
    </Modal>
  );
}
