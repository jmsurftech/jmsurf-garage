import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Building2, ExternalLink, Globe, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Panel, Pill } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { adminCall } from "@/lib/adminApi";
import { AddOwnerCompanyModal, GroupPaymentModal, OwnerCompaniesPanel } from "@/components/admin/AdminCompanyGroup";
import type { Company, Sub } from "./data";
import type { CompanyUser } from "./CompanyUsers";

const FIELDS = [
  ["business_name", "Business name"], ["industry", "Industry"],
  ["contact_name", "Owner name"], ["contact_email", "Owner email"], ["contact_phone", "Owner phone"],
  ["business_email", "Business email"], ["business_phone", "Business phone"], ["business_address", "Location"],
] as const;

/** Admin → company → Overview: the company's details, who owns it, when it was last used, its domain and the owner's other companies. */
export default function CompanyOverview({ company, sub, companies, subs, plans, users, onChanged }: {
  company: Company; sub: Sub | null; companies: Company[]; subs: Record<string, Sub>; plans: any[]; users: CompanyUser[]; onChanged: () => void;
}) {
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [addFor, setAddFor] = useState(false);
  const [payFor, setPayFor] = useState<string[] | null>(null);
  const { data: domains = [] } = useQuery({
    queryKey: ["admin-company-domains", company.id],
    queryFn: async () => ((await (supabase as any).from("tenant_domains").select("id,host,status").eq("tenant_id", company.id).eq("kind", "custom").order("created_at")).data || []) as { id: string; host: string; status: string }[],
  });
  const group = companies.filter((c) => c.owner_user_id === company.owner_user_id && !c.deleted_at);
  const owner = users.find((u) => u.is_owner);
  const lastActive = users.map((u) => u.last_used_at || u.last_sign_in_at).filter(Boolean).sort().pop() || null;

  const start = () => { setForm(Object.fromEntries(FIELDS.map(([k]) => [k, String((company as any)[k] || "")]))); setEditing(true); };
  const save = async () => {
    setBusy(true);
    try { await adminCall("companies/details", { tenant_id: company.id, ...form }); toast.success("Details saved"); setEditing(false); onChanged(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Panel className="lg:col-span-3" title="Details" icon={Building2} actions={editing ? <>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy}><Save /> {busy ? "Saving…" : "Save"}</Button>
      </> : !company.deleted_at && <Button size="sm" variant="outline" onClick={start}><Pencil /> Edit</Button>}>
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label} className={k === "business_address" ? "sm:col-span-2" : undefined}>
                <input className="fi" value={form[k] || ""} placeholder={`Enter ${label.toLowerCase()}`} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {FIELDS.map(([k, label]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium">{(company as any)[k] || "—"}</dd></div>
            ))}
          </dl>
        )}
      </Panel>

      <Panel className="lg:col-span-2" title="At a glance">
        <dl className="space-y-3 text-sm">
          <Row label="Owner login" value={owner ? <>{owner.name || owner.email}<span className="block text-xs font-normal text-muted-foreground">{owner.email}{owner.phone ? ` · ${owner.phone}` : ""}</span></> : "—"} />
          <Row label="Created" value={format(new Date(company.created_at), "d MMM yyyy")} />
          <Row label="Last activity" value={lastActive ? <span title={format(new Date(lastActive), "d MMM yyyy, HH:mm")}>{formatDistanceToNow(new Date(lastActive), { addSuffix: true })}</span> : "No sign-in yet"} />
          <Row label="Plan" value={sub ? `${sub.plan_name} · ${sub.billing_cycle || "monthly"}` : "None"} />
          <Row label="Own domain" value={domains.length ? (
            <span className="flex flex-col gap-1">{domains.map((d) => <span key={d.id} className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{d.host}</span><Pill tone={d.status === "approved" || d.status === "active" ? "success" : "warning"}>{d.status === "approved" || d.status === "active" ? "On" : d.status}</Pill></span>)}</span>
          ) : "None"} />
        </dl>
        <Link to="/admin/domains" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Manage domains <ExternalLink className="h-3 w-3" /></Link>
      </Panel>

      {group.length > 0 && (
        <div className="lg:col-span-5">
          <OwnerCompaniesPanel tenant={company} group={group} subs={subs}
            onSelect={(t) => nav(`/admin/companies/${t.id}`)}
            onAdd={() => setAddFor(true)} onPay={() => setPayFor(group.map((t) => t.id))} />
        </div>
      )}

      <AddOwnerCompanyModal open={addFor} onClose={() => setAddFor(false)} source={company} plans={plans} ownerEmail={owner?.email || company.contact_email || null}
        onDone={() => { setAddFor(false); onChanged(); }} />
      <GroupPaymentModal open={!!payFor} onClose={() => setPayFor(null)} group={group} subs={subs} initial={payFor || []} onDone={() => { setPayFor(null); onChanged(); }} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex justify-between gap-4"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 text-right font-medium">{value}</dd></div>;
}
