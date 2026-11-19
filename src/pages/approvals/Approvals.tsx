import { useMemo, useState , useEffect } from "react";
import SignInbox from "./SignInbox";
import { SIGN_TYPES, type SigningRule } from "@/lib/signing";
import { PenLine } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Check, X, ExternalLink, Search, Clock, ShieldCheck, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useStaff } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import { Switch } from "@/components/ui/switch";
import { formatKES } from "@/lib/format";
import { APPROVAL_TYPES, ruleSteps, type ApprovalRule, type ApprovalStep } from "@/lib/approvals";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const typeLabel = (k: string) => APPROVAL_TYPES.find((t) => t.key === k)?.label.replace(/s$/, "") || k;
const linkFor = (k: string, id: string) => APPROVAL_TYPES.find((t) => t.key === k)?.link(id) || "/";

/** Approvals inbox: everything waiting for a decision, and the history. */
export default function Approvals() {
  const tenantId = useTenantId();
  const { user, role } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"mine" | "pending" | "requested" | "decided">("mine");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [decide, setDecide] = useState<{ r: any; approve: boolean } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["approvals", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => (await sb.from("approval_requests").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000)).data || [],
  });
  // Requisitions are approved on their own page (the manager can change quantities), but they wait here too so nothing is missed.
  const { data: reqs = [] } = useQuery({
    queryKey: ["approvals-reqs", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => (await sb.from("requisitions").select("id,number,status,requested_by,requested_by_name,total_estimate,supplier_name,created_at,approved_at,approved_by_name,rejection_reason,manager_notes").eq("tenant_id", tenantId).in("status", ["pending_approval", "approved", "rejected"]).order("created_at", { ascending: false }).limit(500)).data || [],
  });
  const isAdmin = role === "admin" || role === "super_admin";
  const isManager = isAdmin || role === "manager";
  const reqRows = (reqs as any[]).filter((q) => q.status === "pending_approval" || q.approved_at).map((q) => ({
    id: `req-${q.id}`, _req: true, doc_type: "requisition", doc_id: q.id, doc_number: q.number || "Draft", title: q.supplier_name ? `For ${q.supplier_name}` : "Stock requisition",
    requested_by: q.requested_by, requested_by_name: q.requested_by_name, amount: q.total_estimate, status: q.status === "pending_approval" ? "pending" : q.status === "rejected" ? "rejected" : "approved",
    approvers: [], created_at: q.created_at, decided_at: q.status === "pending_approval" ? null : q.approved_at, decided_by_name: q.approved_by_name, comment: q.status === "rejected" ? q.rejection_reason : q.manager_notes,
  }));
  const all = [...(data as any[]).filter((r) => r.doc_type !== "requisition"), ...reqRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const mine = all.filter((r) => r.status === "pending" && ((r.approvers || []).includes(user?.id) || (r._req && isManager)));
  const rows = useMemo(() => {
    const list = view === "mine" ? mine : view === "pending" ? all.filter((r) => r.status === "pending") : view === "requested" ? all.filter((r) => r.requested_by === user?.id) : all.filter((r) => ["approved", "rejected"].includes(r.status));
    const s = q.trim().toLowerCase();
    return list.filter((r) => (!type || r.doc_type === type) && (!s || `${r.doc_number} ${r.title} ${r.requested_by_name}`.toLowerCase().includes(s)));
  }, [all, view, q, type, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const paged = usePaged(rows, 20);

  const submit = async () => {
    if (!decide) return;
    setBusy(true);
    const { error } = await sb.rpc("decide_approval", { p_request: decide.r.id, p_approve: decide.approve, p_comment: comment });
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: decide.approve ? "Approved" : "Rejected", description: `${typeLabel(decide.r.doc_type)} ${decide.r.doc_number || ""}` });
    setDecide(null); setComment("");
    ["approvals", "approvals-badge", "zdocs", "credit-notes", "purchase-orders-z", "bills-z", "hr-runs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  if (isLoading) return <OrbLoader label="Loading approvals…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" icon={CheckSquare} description="Quotations, invoices, purchase orders, bills, expenses and more that need a decision."
        actions={isAdmin ? <Button variant="outline" asChild><Link to="/settings?tab=approvals"><Settings2 /> Approval settings</Link></Button> : undefined} />
      <SignInbox />
      <StatGrid>
        <StatTile label="Waiting for me" value={mine.length} icon={Clock} tone="warning" />
        <StatTile label="All pending" value={all.filter((r) => r.status === "pending").length} icon={CheckSquare} tone="primary" />
        <StatTile label="Approved (30 days)" value={all.filter((r) => r.status === "approved" && Date.now() - Date.parse(r.decided_at) < 30 * 86400000).length} icon={ShieldCheck} tone="success" />
        <StatTile label="Rejected (30 days)" value={all.filter((r) => r.status === "rejected" && Date.now() - Date.parse(r.decided_at) < 30 * 86400000).length} icon={X} tone="danger" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {([["mine", "Waiting for me"], ["pending", "All pending"], ["requested", "My requests"], ["decided", "Decided"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        <select className="fi w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">All documents</option>{APPROVAL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={CheckSquare} title="Nothing here" description={view === "mine" ? "You have nothing waiting for your approval." : undefined} /> : (
          <>
            <TableWrap><table className="dt">
              <thead><tr><th>Document</th><th className="hidden md:table-cell">Requested by</th><th className="num">Amount</th><th>Status</th><th className="hidden lg:table-cell">When</th><th /></tr></thead>
              <tbody>{paged.rows.map((r: any) => {
                const canDecide = r.status === "pending" && !r._req && ((r.approvers || []).includes(user?.id) || isAdmin);
                const canReview = r.status === "pending" && r._req && isManager;
                return (
                  <tr key={r.id}>
                    <td><Link to={linkFor(r.doc_type, r.doc_id)} className="font-semibold text-primary hover:underline">{typeLabel(r.doc_type)} {r.doc_number}</Link><span className="block max-w-[260px] truncate text-xs text-muted-foreground">{r.title}</span></td>
                    <td className="hidden md:table-cell">{r.requested_by_name || "—"}</td>
                    <td className="num">{r.amount != null ? formatKES(Number(r.amount)) : "—"}</td>
                    <td>{r.status === "pending" ? <Pill tone="warning">Pending</Pill> : r.status === "approved" ? <Pill tone="success">Approved</Pill> : r.status === "rejected" ? <Pill tone="danger">Rejected</Pill> : <Pill>Cancelled</Pill>}
                      {Array.isArray(r.steps) && r.steps.length > 1 && <span className="block text-xs text-muted-foreground">Stage {Math.min(r.stage + 1, r.steps.length)} of {r.steps.length}{r.status === "pending" && r.steps[r.stage]?.label ? ` · ${r.steps[r.stage].label}` : ""}</span>}
                      {Array.isArray(r.history) && r.history.length > 0 && <span className="block max-w-[240px] truncate text-[11px] text-muted-foreground" title={r.history.map((h: any) => `${h.label}: ${h.decision} by ${h.by_name}${h.comment ? ` (${h.comment})` : ""}`).join("\n")}>{r.history.map((h: any) => `${h.decision === "approved" ? "✓" : "✗"} ${h.by_name}`).join(" → ")}</span>}
                      {r.comment &&<span className="block max-w-[200px] truncate text-xs text-muted-foreground" title={r.comment}>“{r.comment}”</span>}</td>
                    <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{new Date(r.decided_at || r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{r.decided_by_name ? ` · ${r.decided_by_name}` : ""}</td>
                    <td><span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" asChild><Link to={linkFor(r.doc_type, r.doc_id)} aria-label="Open"><ExternalLink /></Link></Button>
                      {canReview && <Button size="sm" asChild><Link to={linkFor(r.doc_type, r.doc_id)}><Check /> Review & approve</Link></Button>}
                      {canDecide && <><Button size="sm" onClick={() => { setDecide({ r, approve: true }); setComment(""); }}><Check /> Approve</Button><Button size="sm" variant="outline" onClick={() => { setDecide({ r, approve: false }); setComment(""); }}><X /> Reject</Button></>}
                    </span></td>
                  </tr>
                );
              })}</tbody>
            </table></TableWrap>
            <Pager {...paged.pager} />
          </>
        )}
      </Panel>
      <Modal open={!!decide} onClose={() => setDecide(null)} center size="md" title={decide?.approve ? "Approve" : "Reject"} description={decide ? `${typeLabel(decide.r.doc_type)} ${decide.r.doc_number || ""}` : ""}
        footer={<><Button variant="ghost" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? "default" : "destructive"} onClick={submit} disabled={busy}>{busy && <OrbSpinner />} {decide?.approve ? "Approve" : "Reject"}</Button></>}>
        <Field label={decide?.approve ? "Comment (optional)" : "Reason (required)"}><textarea className="fi" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  );
}

/** Ordered approval stages: who approves first, then who; any one or all of them per stage. */
function StepsEditor({ steps, people, onChange }: { steps: ApprovalStep[]; people: any[]; onChange: (s: ApprovalStep[]) => void }) {
  const upd = (i: number, p: Partial<ApprovalStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Approval stages, in order</p>
      {steps.map((s, i) => (
        <div key={i} className="rounded-2xl border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
            <input className="fi h-8 w-44" value={s.label} placeholder={`Stage ${i + 1}`} onChange={(e) => upd(i, { label: e.target.value })} aria-label="Stage name" />
            <select className="fi h-8 w-auto text-xs" value={s.mode} onChange={(e) => upd(i, { mode: e.target.value as "any" | "all" })} aria-label="Who must approve">
              <option value="any">Any one of them approves</option><option value="all">All of them must approve</option>
            </select>
            <span className="ml-auto flex gap-1">
              {i > 0 && <button type="button" onClick={() => move(i, -1)} className="rounded-lg px-2 py-1 text-xs hover:bg-muted" aria-label="Move up">↑</button>}
              {i < steps.length - 1 && <button type="button" onClick={() => move(i, 1)} className="rounded-lg px-2 py-1 text-xs hover:bg-muted" aria-label="Move down">↓</button>}
              {steps.length > 1 && <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))} className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10">Remove</button>}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">{people.map((p) => {
            const on = s.approvers.includes(p.user_id);
            return <button key={p.user_id} type="button" onClick={() => upd(i, { approvers: on ? s.approvers.filter((x) => x !== p.user_id) : [...s.approvers, p.user_id] })}
              className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}>{p.display_name} <span className="opacity-70">· {String(p.role).replace("_", " ")}</span></button>;
          })}</div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, { label: `Stage ${steps.length + 1}`, approvers: [], mode: "any" }])} className="rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary">+ Add a stage</button>
      <p className="text-xs text-muted-foreground">The sender is told at every stage. Set the channels under Notifications.</p>
    </div>
  );
}

/** System → Approvals: per document type, on/off, stages of approvers and a minimum amount. */
export function ApprovalSettingsTab() {
  const { toast } = useToast();
  const { settings, save } = useErpSettings();
  const { data: staff = [] } = useStaff();
  const [rules, setRules] = useState<Record<string, ApprovalRule>>(() => ({ ...(settings.approvals || {}) }));
  const managers = (staff as any[]).filter((s) => ["admin", "manager"].includes(s.role));
  const set = (k: string, p: Partial<ApprovalRule>) => setRules((r) => ({ ...r, [k]: { enabled: false, approvers: [], min_amount: 0, ...(r[k] || {}), ...p } }));
  const submit = async () => {
    const { error } = await save("approvals", rules);
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Approval rules saved" });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">A new document waits here until approved, and cannot be sent, received or paid before then. With no approvers chosen, the owners approve.</p>
      {APPROVAL_TYPES.map((t) => {
        const r = { enabled: false, approvers: [] as string[], min_amount: 0, ...(rules[t.key] || {}) };
        return (
          <Panel key={t.key} title={t.label} icon={CheckSquare} actions={<Switch checked={r.enabled} onCheckedChange={(v) => set(t.key, { enabled: v })} />}>
            <div className={cn("grid gap-4 md:grid-cols-[1fr_200px]", !r.enabled && "pointer-events-none opacity-50")}>
              <StepsEditor steps={ruleSteps(r)} people={managers.length ? managers : (staff as any[])} onChange={(steps) => set(t.key, { steps, approvers: steps[0]?.approvers || [] })} />
              <Field label="Only when the amount is at least" hint="0 = every document"><input className="fi" type="number" min={0} value={r.min_amount || 0} onChange={(e) => set(t.key, { min_amount: Number(e.target.value) })} /></Field>
            </div>
          </Panel>
        );
      })}
      <div className="flex justify-end"><Button onClick={submit}>Save approval rules</Button></div>
      <SigningRules />
    </div>
  );
}

/** Documents that must be signed (and stamped) before they can be sent, and who signs them. */
function SigningRules() {
  const { toast } = useToast();
  const { settings, save } = useErpSettings();
  const { data: staff = [] } = useStaff();
  const [rules, setRules] = useState<Record<string, SigningRule>>(() => ({ ...(settings.signing || {}) }));
  useEffect(() => { setRules({ ...(settings.signing || {}) }); }, [settings.signing]);
  const set = (k: string, p: Partial<SigningRule>) => setRules((r) => ({ ...r, [k]: { enabled: false, signers: [], with_approval: false, ...(r[k] || {}), ...p } }));
  const submit = async () => {
    const bad = Object.entries(rules).find(([, r]) => r.enabled && !(r.signers || []).length);
    if (bad) return toast({ title: "Choose who signs", description: SIGN_TYPES.find((t) => t.key === bad[0])?.label, variant: "destructive" });
    const { error } = await save("signing", rules);
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Signing rules saved" });
  };
  return (
    <div className="space-y-4 pt-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><PenLine className="h-5 w-5 text-primary" /> Signatures & stamps</h2>
        <p className="text-sm text-muted-foreground">It cannot be sent until signed. The signature, company stamp and date are placed on it. With review on, the signer can also reject it with a reason.</p>
      </div>
      {SIGN_TYPES.map((t) => {
        const r = { enabled: false, signers: [] as string[], with_approval: false, ...(rules[t.key] || {}) };
        return (
          <Panel key={t.key} title={t.label} icon={PenLine} actions={<Switch checked={r.enabled} onCheckedChange={(v) => set(t.key, { enabled: v })} />}>
            <div className={cn("space-y-3", !r.enabled && "pointer-events-none opacity-50")}>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Who signs (any one of them)</p>
                <div className="flex flex-wrap gap-1.5">
                  {(staff as any[]).map((p) => { const on = r.signers.includes(p.user_id); return (
                    <button key={p.user_id} type="button" onClick={() => set(t.key, { signers: on ? r.signers.filter((x) => x !== p.user_id) : [...r.signers, p.user_id] })}
                      className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40")}>{p.display_name}</button>
                  ); })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={r.with_approval} onCheckedChange={(v) => set(t.key, { with_approval: v })} /> The signer reviews it: <b>Approve and sign</b>, or reject with a reason</label>
            </div>
          </Panel>
        );
      })}
      <div className="flex justify-end"><Button onClick={submit}>Save signing rules</Button></div>
    </div>
  );
}
