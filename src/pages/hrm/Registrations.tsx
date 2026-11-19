import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Link2, Copy, Plus, Check, X, Inbox, CheckCircle2, XCircle, Power, Paperclip, ExternalLink, AlertTriangle } from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Pill, Segmented } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { PagedRows } from "@/components/Pager";
import DocumentsPanel, { EMPLOYEE_DOCS } from "@/components/DocumentsPanel";
import { fmtDate } from "@/lib/doc-pdf";
import { sb, useHrLookups, ymd, EMPLOYMENT_TYPES } from "./hrData";

type Reg = {
  id: string; link_id: string | null; department_id: string | null; status: "submitted" | "approved" | "rejected";
  first_name: string; last_name: string; other_names: string | null; gender: string | null; date_of_birth: string | null; marital_status: string | null;
  national_id: string | null; kra_pin: string | null; nssf_no: string | null; shif_no: string | null; phone: string | null; email: string | null; address: string | null;
  next_of_kin: { name?: string; relationship?: string; phone?: string } | null; payment_method: string; bank_name: string | null; bank_branch: string | null; bank_account: string | null; mpesa_phone: string | null;
  note: string | null; file_count: number; review_note: string | null; reviewed_at: string | null; employee_id: string | null; created_at: string;
};
type RegLink = { id: string; token: string; label: string | null; department_id: string | null; expires_at: string | null; max_uses: number; uses: number; active: boolean; created_at: string };

const regName = (r: Pick<Reg, "first_name" | "other_names" | "last_name">) => [r.first_name, r.other_names, r.last_name].filter(Boolean).join(" ");
const joinUrl = (token: string) => `${window.location.origin}/join/${token}`;
const linkState = (l: RegLink): [string, "success" | "muted" | "warning"] =>
  !l.active ? ["Off", "muted"] : l.expires_at && Date.parse(l.expires_at) <= Date.now() ? ["Expired", "muted"] : l.uses >= l.max_uses ? ["Used up", "warning"] : ["Open", "success"];

/** HRM → Registrations: invite links for new hires and the details they send, to approve into employees. */
export default function Registrations() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: lk } = useHrLookups();
  const [view, setView] = useState<"submitted" | "approved" | "rejected" | "links">("submitted");
  const [open, setOpen] = useState<Reg | null>(null);
  const [newLink, setNewLink] = useState<{ label: string; department_id: string; expires: string; max_uses: string } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["hr-registrations", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const [r, l] = await Promise.all([
        sb.from("hr_registrations").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000),
        sb.from("hr_registration_links").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      ]);
      if (r.error) throw r.error;
      return { regs: (r.data || []) as Reg[], links: (l.data || []) as RegLink[] };
    },
  });
  const regs = data?.regs || [], links = data?.links || [];
  const dept = new Map((lk?.departments || []).map((d) => [d.id, d.name]));
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-registrations"] });
  const copy = async (l: RegLink) => { await navigator.clipboard.writeText(joinUrl(l.token)); toast({ title: "Link copied", description: "Send it to the new hire by SMS, WhatsApp or email." }); };

  const createLink = async () => {
    if (!newLink) return;
    const max = Math.max(1, Math.min(1000, Number(newLink.max_uses) || 1));
    const { data: row, error } = await sb.from("hr_registration_links").insert({
      tenant_id: tenantId, label: newLink.label.trim() || null, department_id: newLink.department_id || null, max_uses: max,
      expires_at: newLink.expires ? new Date(`${newLink.expires}T23:59:59`).toISOString() : null,
    }).select("*").single();
    if (error) return toast({ title: "Not created", description: error.message, variant: "destructive" });
    setNewLink(null); refresh(); setView("links");
    await copy(row as RegLink).catch(() => toast({ title: "Link created" }));
  };
  const toggle = async (l: RegLink) => {
    const { error } = await sb.from("hr_registration_links").update({ active: !l.active }).eq("id", l.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    refresh();
  };

  if (isLoading) return <OrbLoader label="Loading registrations…" />;
  const count = (s: Reg["status"]) => regs.filter((r) => r.status === s).length;
  const rows = view === "links" ? [] : regs.filter((r) => r.status === view);
  const openLinks = links.filter((l) => linkState(l)[0] === "Open").length;
  return (
    <div className="space-y-5">
      <PageHeader title="Staff registrations" icon={UserPlus}
        actions={<Button onClick={() => setNewLink({ label: "", department_id: "", expires: ymd(new Date(Date.now() + 14 * 86400000)), max_uses: "10" })}><Link2 /> New invite link</Button>} />
      <StatGrid>
        <StatTile label="Waiting for review" value={count("submitted")} icon={Inbox} tone={count("submitted") ? "warning" : "muted"} />
        <StatTile label="Approved" value={count("approved")} icon={CheckCircle2} tone="success" />
        <StatTile label="Rejected" value={count("rejected")} icon={XCircle} tone="muted" />
        <StatTile label="Open invite links" value={openLinks} icon={Link2} tone="primary" />
      </StatGrid>
      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[
        { value: "submitted", label: "Waiting", count: count("submitted") }, { value: "approved", label: "Approved", count: count("approved") },
        { value: "rejected", label: "Rejected", count: count("rejected") }, { value: "links", label: "Invite links", count: links.length },
      ]} />
      {view === "links" ? (
        <Panel flush description="A new hire opens the link on their phone, fills in their details and uploads their documents. No login needed.">
          {links.length === 0 ? <EmptyState icon={Link2} title="No invite links yet" description="Create one and send it to the people joining." /> : (
            <TableWrap><table className="dt"><thead><tr><th>Link</th><th className="hidden sm:table-cell">Department</th><th>Expires</th><th className="num">Used</th><th>State</th><th /></tr></thead>
              <tbody><PagedRows rows={links} colSpan={6}>{(page) => page.map((l) => { const [state, tone] = linkState(l); return (
                <tr key={l.id}>
                  <td className="font-medium">{l.label || "Invite link"}<span className="block font-mono text-[11px] font-normal text-muted-foreground">/join/{l.token.slice(0, 8)}…</span></td>
                  <td className="hidden sm:table-cell">{dept.get(l.department_id || "") || "Any"}</td>
                  <td className="whitespace-nowrap">{l.expires_at ? fmtDate(l.expires_at) : "Never"}</td>
                  <td className="num">{l.uses}/{l.max_uses}</td>
                  <td><Pill tone={tone}>{state}</Pill></td>
                  <td><span className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => void copy(l)}><Copy /> Copy</Button>
                    <button className="icon-btn" aria-label={l.active ? "Switch off" : "Switch on"} title={l.active ? "Switch off" : "Switch on"} onClick={() => void toggle(l)}><Power className="h-4 w-4" /></button>
                  </span></td>
                </tr>); })}</PagedRows></tbody></table></TableWrap>
          )}
        </Panel>
      ) : (
        <Panel flush>
          {rows.length === 0 ? <EmptyState icon={Inbox} title={view === "submitted" ? "Nothing waiting" : `Nothing ${view}`} description={view === "submitted" ? "Details sent from an invite link land here for you to check." : undefined} /> : (
            <TableWrap><table className="dt"><thead><tr><th>Name</th><th>ID no.</th><th className="hidden md:table-cell">Phone</th><th className="hidden sm:table-cell">Department</th><th className="num">Files</th><th>Sent</th><th /></tr></thead>
              <tbody><PagedRows rows={rows} colSpan={7}>{(page) => page.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="font-medium">{regName(r)}{!r.kra_pin && <span className="block text-xs font-normal text-[hsl(32_90%_38%)]">No KRA PIN</span>}</td>
                  <td>{r.national_id}</td><td className="hidden md:table-cell">{r.phone}</td><td className="hidden sm:table-cell">{dept.get(r.department_id || "") || "-"}</td>
                  <td className="num">{r.file_count}</td><td className="whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td><Button size="sm" variant="outline">{r.status === "submitted" ? "Review" : "Open"}</Button></td>
                </tr>))}</PagedRows></tbody></table></TableWrap>
          )}
        </Panel>
      )}
      {open && <ReviewModal reg={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); qc.invalidateQueries({ queryKey: ["hr-employees"] }); }} />}
      <Modal open={!!newLink} onClose={() => setNewLink(null)} title="New invite link" icon={Link2} description="Anyone with the link can send their details until it expires or is used up."
        footer={<><Button variant="outline" onClick={() => setNewLink(null)}>Cancel</Button><Button onClick={() => void createLink()}><Plus /> Create and copy</Button></>}>
        {newLink && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="Only you see it" className="sm:col-span-2"><input className="fi" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} placeholder="e.g. November intake" /></Field>
          <Field label="Department" className="sm:col-span-2"><select className="fi" value={newLink.department_id} onChange={(e) => setNewLink({ ...newLink, department_id: e.target.value })}><option value="">Any (set on approval)</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Expires on" hint="Empty for never"><input className="fi" type="date" value={newLink.expires} min={ymd()} onChange={(e) => setNewLink({ ...newLink, expires: e.target.value })} /></Field>
          <Field label="How many people" hint="The link stops after this many"><input className="fi" type="number" min={1} max={1000} value={newLink.max_uses} onChange={(e) => setNewLink({ ...newLink, max_uses: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

function ReviewModal({ reg, onClose, onDone }: { reg: Reg; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const seePay = can("employees", "salary");
  const { data: lk } = useHrLookups();
  const [f, setF] = useState({ employee_no: "", department_id: reg.department_id || "", designation_id: "", employment_type: "permanent", hire_date: ymd(), note: "" });
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const kin = reg.next_of_kin || {};
  const pending = reg.status === "submitted";
  const approve = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("hr_registration_approve", { p_id: reg.id, p: f });
    setBusy(false);
    if (error) return toast({ title: "Not approved", description: error.message, variant: "destructive" });
    toast({ title: "Employee created", description: `${regName(reg)} is on the staff list with their documents.` });
    onDone();
    void data;
  };
  const reject = async () => {
    if (!f.note.trim()) return toast({ title: "Say why it is rejected", variant: "destructive" });
    setBusy(true);
    const { error } = await sb.rpc("hr_registration_reject", { p_id: reg.id, p_note: f.note });
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Rejected" }); onDone();
  };
  const row = (l: string, v: string | null | undefined) => <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-muted-foreground">{l}</span><span className="text-right font-medium">{v || "-"}</span></div>;
  return (
    <Modal open onClose={onClose} locked={busy} size="xl" icon={UserPlus} title={regName(reg)} description={`Sent ${fmtDate(reg.created_at)}${reg.status !== "submitted" ? ` · ${reg.status}` : ""}`}
      footer={pending ? (rejecting
        ? <><Button variant="outline" onClick={() => setRejecting(false)}>Back</Button><Button variant="destructive" disabled={busy} onClick={() => void reject()}><X /> Reject</Button></>
        : <><Button variant="outline" onClick={() => setRejecting(true)}><X /> Reject…</Button><Button disabled={busy} onClick={() => void approve()}><Check /> {busy ? "Working…" : "Approve and create employee"}</Button></>)
        : reg.employee_id ? <Button asChild><Link to={`/hrm/employees/${reg.employee_id}`}><ExternalLink /> Open employee</Link></Button> : <Button variant="outline" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        {reg.review_note && <p className="rounded-xl bg-muted px-3 py-2 text-sm">{reg.review_note}</p>}
        {(!reg.kra_pin || !reg.nssf_no || !reg.shif_no) && <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-[hsl(32_90%_38%)]"><AlertTriangle className="h-4 w-4" /> Missing {[!reg.kra_pin && "KRA PIN", !reg.nssf_no && "NSSF no.", !reg.shif_no && "SHA no."].filter(Boolean).join(", ")}. You can add it on the employee later.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel title="Personal">{row("ID / passport", reg.national_id)}{row("Date of birth", reg.date_of_birth ? fmtDate(reg.date_of_birth) : null)}{row("Gender", reg.gender)}{row("Marital status", reg.marital_status)}{row("Phone", reg.phone)}{row("Email", reg.email)}{row("Address", reg.address)}</Panel>
          <Panel title="Statutory">{row("KRA PIN", reg.kra_pin)}{row("NSSF no.", reg.nssf_no)}{row("SHA (SHIF) no.", reg.shif_no)}</Panel>
          <Panel title="Next of kin">{row("Name", kin.name)}{row("Relationship", kin.relationship)}{row("Phone", kin.phone)}</Panel>
          <Panel title="Pay to">{seePay ? <>{row("Paid by", reg.payment_method === "mpesa" ? "M-Pesa" : "Bank")}{reg.payment_method === "mpesa" ? row("M-Pesa number", reg.mpesa_phone) : <>{row("Bank", reg.bank_name)}{row("Branch", reg.bank_branch)}{row("Account", reg.bank_account)}</>}</> : <p className="text-sm text-muted-foreground">Hidden. You need "See salaries and bank details".</p>}</Panel>
        </div>
        {reg.note && <Panel title="Their note"><p className="whitespace-pre-wrap text-sm">{reg.note}</p></Panel>}
        <Panel title="Documents" icon={Paperclip}>
          {reg.employee_id ? <DocumentsPanel entityType="employee" entityId={reg.employee_id} entityName={regName(reg)} checklist={EMPLOYEE_DOCS} />
            : <DocumentsPanel entityType="hr_registration" entityId={reg.id} entityName={regName(reg)} checklist={["ID copy", "KRA PIN certificate", "NSSF card", "SHA card", "Academic certificates", "Bank details"]} noDelete={!pending} />}
        </Panel>
        {pending && (rejecting
          ? <Field label="Why is it rejected?" required hint="Kept with the registration."><textarea className="fi min-h-[80px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Wrong ID number, please resend" /></Field>
          : <Panel title="Job details for the new employee">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee no." hint="Optional"><input className="fi" value={f.employee_no} onChange={(e) => setF({ ...f, employee_no: e.target.value })} /></Field>
              <Field label="Starts on"><input className="fi" type="date" value={f.hire_date} onChange={(e) => setF({ ...f, hire_date: e.target.value })} /></Field>
              <Field label="Department"><select className="fi" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">-</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Job title"><select className="fi" value={f.designation_id} onChange={(e) => setF({ ...f, designation_id: e.target.value })}><option value="">-</option>{(lk?.designations || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Employment type"><select className="fi" value={f.employment_type} onChange={(e) => setF({ ...f, employment_type: e.target.value })}>{EMPLOYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Note" hint="Optional"><input className="fi" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Set pay on the employee after approval.</p>
          </Panel>)}
      </div>
    </Modal>
  );
}
