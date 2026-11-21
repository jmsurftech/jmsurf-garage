/** Super admin → Leads & CRM: the platform's own sales pipeline and campaigns. */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Target, Plus, Search, Mail, Phone, MessageSquare, Send, Megaphone, KanbanSquare, List, CalendarClock, Building2, Trash2, Users, TrendingUp, Trophy, Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader, Panel, Modal, Field, Pill, EmptyState, StatGrid, StatTile, TableWrap, Segmented, ExportMenu } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const STAGES = [
  { key: "new", label: "New", tone: "info" }, { key: "contacted", label: "Contacted", tone: "muted" }, { key: "demo", label: "Demo", tone: "warning" },
  { key: "trial", label: "Trial", tone: "warning" }, { key: "proposal", label: "Proposal", tone: "info" }, { key: "won", label: "Won", tone: "success" }, { key: "lost", label: "Lost", tone: "danger" },
] as const;
const SOURCES = ["manual", "signup", "website", "demo", "referral", "event", "social", "call"];
type Lead = { id: string; name: string; company: string | null; email: string | null; phone: string | null; country: string | null; source: string; stage: string; value: number; tags: string[]; notes: string | null; next_follow_up: string | null; tenant_id: string | null; lost_reason: string | null; created_at: string; product?: string; heard_from?: string | null; details?: Record<string, any> };
const PRODUCT_LABEL: Record<string, string> = { dash: "Garage", callcentre: "Call Centre", mail: "Mail", isp: "ISP", sms: "SMS", rms: "RMS", pay: "Pay", other: "Other" };
const kes = (n: number) => `KES ${Math.round(Number(n || 0)).toLocaleString("en-KE")}`;

async function adminApi<T = any>(path: string, body: any): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(`/api/admin/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}`, "x-dash-context": "platform" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export default function AdminCrm() {
  const [tab, setTab] = useState<"board" | "list" | "campaigns">("board");
  const qc = useQueryClient();
  const { data: leads = [], isLoading } = useQuery({ queryKey: ["platform-leads"], queryFn: async () => ((await allRows(() => sb.from("platform_leads").select("*").order("created_at", { ascending: false }))).data || []) as Lead[] });
  const [open, setOpen] = useState<Lead | "new" | null>(null);
  const [q, setQ] = useState("");
  const [product, setProduct] = useState("");
  const list = useMemo(() => leads.filter((l) => (!product || (l.product || "dash") === product) && (!q || `${l.name} ${l.company} ${l.email} ${l.phone} ${l.heard_from} ${l.tags?.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [leads, q, product]);
  // Where sign-ups hear about JMSURF: the marketing channels that work.
  const sources = useMemo(() => {
    const m = new Map<string, { n: number; won: number }>();
    for (const l of list) { const k = l.heard_from || "Not asked"; const v = m.get(k) || { n: 0, won: 0 }; v.n++; if (l.stage === "won") v.won++; m.set(k, v); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [list]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform-leads"] });
  const move = async (l: Lead, stage: string) => {
    await sb.from("platform_leads").update({ stage, updated_at: new Date().toISOString() }).eq("id", l.id);
    await sb.from("platform_lead_activities").insert({ lead_id: l.id, kind: "stage", body: `Moved to ${STAGES.find((s) => s.key === stage)?.label}` });
    refresh();
  };
  if (isLoading) return <div className="p-6"><OrbLoader label="Loading leads…" /></div>;
  const open$ = leads.filter((l) => !["won", "lost"].includes(l.stage));
  const due = leads.filter((l) => l.next_follow_up && l.next_follow_up <= new Date().toISOString().slice(0, 10) && !["won", "lost"].includes(l.stage));
  return (
    <div className="space-y-3">
      <PageHeader title="Leads & CRM" icon={Target}
        actions={<>
          <ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !list.length, onSelect: () => downloadCsv(`jmsurf-leads-${new Date().toISOString().slice(0, 10)}.csv`,
            ["Name", "Company", "Email", "Phone", "Country", "Product", "Source", "Heard from", "Stage", "Value (KES)", "Next follow-up", "Tags", "Notes", "Added"],
            list.map((l) => [l.name, l.company, l.email, l.phone, l.country, PRODUCT_LABEL[l.product || "dash"] || l.product, l.source, l.heard_from, l.stage, l.value, l.next_follow_up, (l.tags || []).join("; "), l.notes, l.created_at.slice(0, 10)])) }]} />
          <Button onClick={() => setOpen("new")}><Plus /> Add lead</Button>
        </>} />
      <StatGrid>
        <StatTile label="Open leads" value={open$.length} icon={Users} />
        <StatTile label="Pipeline value" value={kes(open$.reduce((a, l) => a + Number(l.value || 0), 0))} icon={TrendingUp} tone="info" />
        <StatTile label="Won" value={leads.filter((l) => l.stage === "won").length} icon={Trophy} tone="success" />
        <StatTile label="Follow-ups due" value={due.length} icon={CalendarClock} tone={due.length ? "danger" : "muted"} />
      </StatGrid>
      {sources.length > 0 && (
        <Panel title="Where leads come from" icon={TrendingUp} description="From 'How did you hear about us?' on sign-up.">
          <div className="space-y-2">
            {sources.slice(0, 12).map(([k, v]) => (
              <div key={k} className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
                <span className="w-24 shrink-0 truncate sm:w-48">{k}</span>
                <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-primary/80" style={{ width: `${Math.max(4, (v.n / sources[0][1].n) * 100)}%` }} /></span>
                <span className="w-20 shrink-0 text-right tabular-nums sm:w-24"><b>{v.n}</b>{v.won ? <span className="text-xs text-success"> · {v.won} won</span> : null}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi h-9 w-auto" value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product"><option value="">All products</option>{Object.entries(PRODUCT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <Segmented value={tab} onChange={(v) => setTab(v as any)} options={[
          { value: "board", label: <><KanbanSquare className="h-4 w-4" /> Pipeline</> }, { value: "list", label: <><List className="h-4 w-4" /> Leads</> }, { value: "campaigns", label: <><Megaphone className="h-4 w-4" /> Campaigns</> },
        ]} />
        {tab !== "campaigns" && <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search leads" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      </div>

      {tab === "board" && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((s) => {
            const col = list.filter((l) => l.stage === s.key);
            return (
              <div key={s.key} className="w-64 shrink-0 rounded-2xl sm:w-72 border border-border bg-muted/30 p-2"
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/lead"); const l = leads.find((x) => x.id === id); if (l && l.stage !== s.key) void move(l, s.key); }}>
                <div className="flex items-center justify-between px-2 py-1.5"><Pill tone={s.tone as any}>{s.label}</Pill><span className="text-xs text-muted-foreground">{col.length} · {kes(col.reduce((a, l) => a + Number(l.value || 0), 0))}</span></div>
                <div className="mt-1 max-h-[60vh] space-y-2 overflow-y-auto">
                  {col.map((l) => (
                    <button key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/lead", l.id)} onClick={() => setOpen(l)}
                      className="block w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                      <b className="block truncate text-sm">{l.company || l.name}</b>
                      <span className="block truncate text-xs text-muted-foreground">{l.company ? l.name : l.email || l.phone}</span>
                      <span className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{PRODUCT_LABEL[l.product || "dash"]}{l.heard_from ? ` · ${l.heard_from}` : ` · ${l.source}`}</span>{Number(l.value) > 0 && <b className="text-foreground">{kes(l.value)}</b>}</span>
                      {l.next_follow_up && <span className={cn("mt-1 block text-[11px]", l.next_follow_up <= new Date().toISOString().slice(0, 10) ? "font-semibold text-destructive" : "text-muted-foreground")}>Follow up {new Date(l.next_follow_up).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "list" && (
        <Panel flush>
          {!list.length ? <EmptyState icon={Target} title="No leads yet" /> : (
            <TableWrap><table className="dt">
              <thead><tr><th>Lead</th><th>Stage</th><th className="hidden md:table-cell">Product</th><th className="hidden md:table-cell">Heard from</th><th className="hidden md:table-cell">Contact</th><th className="num">Value</th><th className="hidden lg:table-cell">Added</th></tr></thead>
              <tbody><PagedRows rows={list} colSpan={7}>{(pageRows) => pageRows.map((l) => (
                <tr key={l.id} className="cursor-pointer" onClick={() => setOpen(l)}>
                  <td><b>{l.company || l.name}</b>{l.company && <span className="block text-xs text-muted-foreground">{l.name}</span>}</td>
                  <td><Pill tone={(STAGES.find((s) => s.key === l.stage)?.tone || "muted") as any}>{STAGES.find((s) => s.key === l.stage)?.label}</Pill></td>
                  <td className="hidden md:table-cell"><Pill tone="info">{PRODUCT_LABEL[l.product || "dash"] || l.product}</Pill></td>
                  <td className="hidden text-sm md:table-cell">{l.heard_from || <span className="text-muted-foreground capitalize">{l.source}</span>}{l.details?.heard_detail ? <span className="block text-xs text-muted-foreground">{l.details.heard_detail}</span> : null}</td>
                  <td className="hidden text-sm md:table-cell">{[l.email, l.phone].filter(Boolean).join(" · ")}</td>
                  <td className="num">{kes(l.value)}</td>
                  <td className="hidden text-muted-foreground lg:table-cell">{new Date(l.created_at).toLocaleDateString("en-GB")}</td>
                </tr>
              ))}</PagedRows></tbody>
            </table></TableWrap>
          )}
        </Panel>
      )}

      {tab === "campaigns" && <Campaigns />}
      {open && <LeadModal lead={open === "new" ? null : open} onClose={() => { setOpen(null); refresh(); }} />}
    </div>
  );
}

function LeadModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { profile } = useAuth() as any;
  const [f, setF] = useState<any>(lead || { name: "", company: "", email: "", phone: "", country: "KE", source: "manual", stage: "new", value: 0, tags: [], notes: "", next_follow_up: "" });
  const [note, setNote] = useState({ kind: "note", body: "" });
  const [busy, setBusy] = useState(false);
  const { data: acts = [], refetch } = useQuery({ queryKey: ["lead-acts", lead?.id], enabled: !!lead?.id, queryFn: async () => ((await sb.from("platform_lead_activities").select("*").eq("lead_id", lead!.id).order("created_at", { ascending: false })).data || []) as any[] });
  const save = async () => {
    if (!f.name?.trim()) return toast.error("Enter a name");
    setBusy(true);
    const row = { name: f.name.trim(), company: f.company || null, email: f.email || null, phone: f.phone || null, country: f.country || null, source: f.source, stage: f.stage, value: Number(f.value || 0), tags: (Array.isArray(f.tags) ? f.tags : String(f.tags || "").split(",")).map((t: string) => t.trim()).filter(Boolean), notes: f.notes || null, next_follow_up: f.next_follow_up || null, lost_reason: f.stage === "lost" ? f.lost_reason || null : null, updated_at: new Date().toISOString() };
    const { error } = lead ? await sb.from("platform_leads").update(row).eq("id", lead.id) : await sb.from("platform_leads").insert(row);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(lead ? "Lead saved" : "Lead added"); onClose();
  };
  const addNote = async () => {
    if (!note.body.trim() || !lead) return;
    await sb.from("platform_lead_activities").insert({ lead_id: lead.id, kind: note.kind, body: note.body.trim(), created_by_name: profile?.display_name || null });
    setNote({ kind: "note", body: "" }); refetch();
  };
  const remove = async () => {
    if (!lead || !(await confirmAction({ title: `Delete ${lead.name}?`, message: "The lead and its history are removed.", danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("platform_leads").delete().eq("id", lead.id); onClose();
  };
  return (
    <Modal open onClose={onClose} size="xl" title={lead ? lead.company || lead.name : "Add a lead"} icon={Target}
      footer={<>{lead && <Button variant="ghost" className="mr-auto text-destructive" onClick={remove}><Trash2 /> Delete</Button>}<Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={save} disabled={busy}>{busy && <OrbSpinner />} Save</Button></>}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name"><input className="fi" placeholder="Enter name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Company"><input className="fi" placeholder="Enter company" value={f.company || ""} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
          <Field label="Email"><input className="fi" type="email" placeholder="Enter email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><input className="fi" placeholder="Enter phone" value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Stage"><select className="fi" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          <Field label="Source"><select className="fi capitalize" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Expected value (KES / month)"><input className="fi" type="number" min={0} value={f.value || 0} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <Field label="Next follow-up"><input className="fi" type="date" value={f.next_follow_up || ""} onChange={(e) => setF({ ...f, next_follow_up: e.target.value })} /></Field>
          <Field label="Tags" hint="Comma separated" className="sm:col-span-2"><input className="fi" value={Array.isArray(f.tags) ? f.tags.join(", ") : f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          {f.stage === "lost" && <Field label="Why lost" className="sm:col-span-2"><input className="fi" value={f.lost_reason || ""} onChange={(e) => setF({ ...f, lost_reason: e.target.value })} /></Field>}
          <Field label="Notes" className="sm:col-span-2"><textarea className="fi" rows={3} value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {lead && (lead.heard_from || Object.keys(lead.details || {}).length > 0) && (
            <div className="rounded-xl bg-muted/50 p-3 text-xs sm:col-span-2">
              <p className="mb-1 font-semibold">From the sign-up ({PRODUCT_LABEL[lead.product || "dash"]})</p>
              {lead.heard_from && <p>Heard via: <b>{lead.heard_from}</b>{lead.details?.heard_detail ? ` (${lead.details.heard_detail})` : ""}</p>}
              {Object.entries(lead.details || {}).filter(([k]) => k !== "heard_detail").map(([k, v]) => <p key={k} className="capitalize">{k.replace(/_/g, " ")}: <b className="normal-case">{Array.isArray(v) ? v.join(", ") : String(v)}</b></p>)}
            </div>
          )}
          {lead && <div className="flex flex-wrap gap-2 sm:col-span-2">
            {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"><Mail className="h-3.5 w-3.5" /> Email</a>}
            {lead.phone && <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"><Phone className="h-3.5 w-3.5" /> Call</a>}
            {lead.phone && <a href={`https://wa.me/${lead.phone.replace(/\D/g, "").replace(/^0/, "254")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"><MessageSquare className="h-3.5 w-3.5" /> WhatsApp</a>}
            {lead.tenant_id && <Link to={`/admin/companies/${lead.tenant_id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"><Building2 className="h-3.5 w-3.5" /> Company account</Link>}
          </div>}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Activity</p>
          {lead ? <>
            <div className="flex min-w-0 gap-2">
              <select className="fi h-9 w-24 shrink-0 text-xs" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })}>{["note", "call", "email", "sms", "meeting"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <input className="fi h-9 min-w-0" placeholder="Enter what happened" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }} />
              <Button size="sm" onClick={addNote}>Add</Button>
            </div>
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {acts.map((a) => <li key={a.id} className="rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="text-[11px] font-semibold uppercase text-muted-foreground">{a.kind} · {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{a.created_by_name ? ` · ${a.created_by_name}` : ""}</span><span className="block">{a.body}</span></li>)}
              {!acts.length && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            </ul>
          </> : <p className="text-sm text-muted-foreground">Save the lead to log calls, emails and meetings.</p>}
        </div>
      </div>
    </Modal>
  );
}

function Campaigns() {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ["platform-campaigns"], queryFn: async () => ((await sb.from("platform_campaigns").select("*").order("created_at", { ascending: false })).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const [count, setCount] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform-campaigns"] });
  const blank = { name: "", channel: "email", audience: { type: "leads", stages: [] as string[], statuses: [] as string[] }, subject: "", body: "Hello {{name}},\n\n" };
  const save = async () => {
    if (!edit.name?.trim() || !edit.body?.trim()) return toast.error("Give it a name and a message");
    const row = { name: edit.name.trim(), channel: edit.channel, audience: edit.audience, subject: edit.channel === "email" ? edit.subject || edit.name : null, body: edit.body };
    const { error } = edit.id ? await sb.from("platform_campaigns").update(row).eq("id", edit.id) : await sb.from("platform_campaigns").insert(row);
    if (error) return toast.error(error.message);
    toast.success("Campaign saved"); setEdit(null); refresh();
  };
  const preview = async (a: any) => { try { setCount(await adminApi("crm/audience", { audience: a })); } catch (e: any) { toast.error(e.message); } };
  const send = async (c: any) => {
    if (!(await confirmAction({ title: `Send "${c.name}" now?`, message: `It goes out by ${c.channel} to everyone in its audience.`, confirmLabel: "Send now" }))) return;
    setBusy(c.id);
    try { const r = await adminApi("crm/send", { id: c.id }); toast.success(`Sent to ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(""); refresh(); }
  };
  const aud = (a: any) => (a?.type === "companies" ? `Companies${a.statuses?.length ? ` (${a.statuses.join(", ")})` : ""}` : `Leads${a?.stages?.length ? ` (${a.stages.join(", ")})` : ""}`);
  return (
    <Panel title="Campaigns" icon={Megaphone} flush actions={<Button size="sm" onClick={() => { setEdit(blank); setCount(null); }}><Plus /> New campaign</Button>}>
      {!list.length ? <EmptyState icon={Megaphone} title="No campaigns yet" /> : (
        <TableWrap><table className="dt">
          <thead><tr><th>Campaign</th><th>Channel</th><th className="hidden md:table-cell">Audience</th><th>Status</th><th /></tr></thead>
          <tbody><PagedRows rows={list} colSpan={5}>{(pageRows) => pageRows.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b>{c.sent_at && <span className="block text-xs text-muted-foreground">Sent {new Date(c.sent_at).toLocaleString("en-GB")} · {c.sent_count} delivered{c.failed_count ? `, ${c.failed_count} failed` : ""}</span>}</td>
              <td className="capitalize">{c.channel}</td>
              <td className="hidden text-sm md:table-cell">{aud(c.audience)}</td>
              <td><Pill tone={c.status === "sent" ? "success" : c.status === "failed" ? "danger" : c.status === "sending" ? "warning" : "muted"}>{c.status}</Pill></td>
              <td className="whitespace-nowrap text-right">
                {c.status === "draft" && <><Button size="sm" variant="ghost" onClick={() => { setEdit(c); setCount(null); }}>Edit</Button><Button size="sm" onClick={() => void send(c)} disabled={!!busy}>{busy === c.id ? <OrbSpinner /> : <Send />} Send</Button></>}
              </td>
            </tr>
          ))}</PagedRows></tbody>
        </table></TableWrap>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="lg" title={edit.id ? "Edit campaign" : "New campaign"} icon={Megaphone} footer={<Button onClick={save}>Save as draft</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="fi" placeholder="Enter campaign name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Channel"><select className="fi" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></Field>
            <Field label="Send to" className="sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {[["leads", "Leads"], ["companies", "Companies"]].map(([v, l]) => <button key={v} type="button" onClick={() => setEdit({ ...edit, audience: { ...edit.audience, type: v } })} className={cn("rounded-full border px-3 py-1.5 text-sm", edit.audience.type === v ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{l}</button>)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(edit.audience.type === "companies" ? [["trialing", "On trial"], ["active", "Paying"], ["past_due", "Payment due"], ["expired", "Expired"], ["cancelled", "Cancelled"]] : STAGES.map((s) => [s.key, s.label])).map(([v, l]) => {
                  const key = edit.audience.type === "companies" ? "statuses" : "stages";
                  const cur: string[] = edit.audience[key] || [];
                  const on = cur.includes(v as string);
                  return <button key={v} type="button" onClick={() => setEdit({ ...edit, audience: { ...edit.audience, [key]: on ? cur.filter((x) => x !== v) : [...cur, v] } })} className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10 text-primary" : "border-border")}>{l}</button>;
                })}
                <button type="button" onClick={() => void preview(edit.audience)} className="ml-auto text-xs font-semibold text-primary">How many?</button>
              </div>
              {count && <p className="mt-1 text-xs text-muted-foreground">{count.total} people · {count.with_email} with email · {count.with_phone} with a phone. Nothing ticked = everyone.</p>}
            </Field>
            {edit.channel === "email" && <Field label="Subject" className="sm:col-span-2"><input className="fi" placeholder="Enter subject" value={edit.subject || ""} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>}
            <Field label="Message" hint="{{name}} and {{company}} are filled in for each person" className="sm:col-span-2"><textarea className="fi" rows={7} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
