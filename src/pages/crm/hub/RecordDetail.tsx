import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, CalendarClock, Check, FileText, History, Mail, MessageSquareText, Pencil, Phone, Plus, Save, StickyNote, Trash2, Trophy, Users, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, PageLoader, Panel, Pill, StatusPill } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { confirmAction } from "@/components/books/confirm";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cleanForSave, FieldInput, FieldValue, StagePill, useCrmRefresh, useLookups } from "./fields";
import { isClosedStage, MODULES, ownerKey, sb, stageLabel, STAGES, type ModuleKey } from "./modules";
import { ActivityForm, ActivityRow, useActivities, type Kind } from "./activities";
import RecordForm from "./RecordForm";
import { BooksPanel, EmailComposer } from "./books";

/** One CRM record: its details (edit in place), stage path, activities, notes, files and related records. */
export default function RecordDetail() {
  const { module, id } = useParams<{ module: ModuleKey; id: string }>();
  const m = MODULES[(module || "leads") as ModuleKey];
  const nav = useNavigate();
  const tenantId = useTenantId();
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [activity, setActivity] = useState<{ kind?: Kind; row?: any } | null>(null);
  const [converting, setConverting] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const { data: r, isLoading, refetch } = useQuery({
    queryKey: ["crm-hub-record", m?.key, id], enabled: !!tenantId && !!id && !!m,
    queryFn: async () => (await sb.from(m.table).select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: acts = [], refetch: refetchActs } = useActivities(m?.related, id);
  const { data: rel, refetch: refetchRel } = useQuery({
    queryKey: ["crm-hub-related", m?.key, id], enabled: !!tenantId && !!id && !!m,
    queryFn: async () => {
      const notes = sb.from("crm_notes").select("*").eq("related_type", m.related).eq("related_id", id).order("created_at", { ascending: false });
      const contacts = m.key === "accounts" ? sb.from("crm_contacts").select("*").eq("account_id", id).order("last_name") : null;
      const deals = m.key === "accounts" ? sb.from("crm_deals").select("*").eq("customer_id", id).order("created_at", { ascending: false })
        : m.key === "contacts" ? sb.from("crm_deals").select("*").eq("contact_id", id).order("created_at", { ascending: false }) : null;
      const history = m.key === "deals" ? sb.from("crm_deal_history").select("*").eq("deal_id", id).order("changed_at", { ascending: false }) : null;
      const [n, c, d, h] = await Promise.all([notes, contacts, deals, history].map((p) => (p ? p : Promise.resolve({ data: null }))));
      return { notes: (n.data || []) as any[], contacts: c.data as any[] | null, deals: d.data as any[] | null, history: h.data as any[] | null };
    },
  });
  const reload = () => { void refetch(); void refetchActs(); void refetchRel(); refresh(); };

  const sections = useMemo(() => (m ? [...new Set(m.fields.map((f) => f.section))] : []), [m]);
  if (!m) return <EmptyState title="Unknown CRM module" />;
  if (isLoading) return <PageLoader />;
  if (!r) return <div className="p-6"><EmptyState icon={m.icon} title={`This ${m.singular.toLowerCase()} was not found`} action={<Button onClick={() => nav(`/crm/${m.key}`)}>Back to {m.plural.toLowerCase()}</Button>} /></div>;

  const rec = { ...r, _account_name: lk.accountName.get(r.account_id) };
  const open = acts.filter((a) => !a.done);
  const closed = acts.filter((a) => a.done);
  const startEdit = () => { setDraft({ ...r }); setEditing(true); };
  const save = async () => {
    const missing = m.fields.find((f) => f.required && !String(draft[f.key] ?? "").trim());
    if (missing) return toast.error(`${missing.label} is required`);
    const { error } = await sb.from(m.table).update({ ...cleanForSave(m, draft, lk), updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Saved"); setEditing(false); reload();
  };
  const setStage = async (stage: string) => {
    const { error } = await sb.from("crm_deals").update({ stage, probability: STAGES.find((s) => s.key === stage)?.p ?? r.probability, closed_at: isClosedStage(stage) ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    if (stage === "won") toast.success("Deal won"); reload();
  };
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete this ${m.singular.toLowerCase()}?`, message: "Its notes and activities are deleted too. This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from(m.table).delete().eq("id", r.id);
    if (error) return toast.error(m.key === "accounts" ? "This account has invoices, quotes or payments, so it cannot be deleted." : friendlyError(error));
    await sb.from("crm_notes").delete().eq("related_type", m.related).eq("related_id", r.id);
    await sb.from("crm_activities").delete().eq("related_type", m.related).eq("related_id", r.id);
    refresh(); toast.success("Deleted"); nav(`/crm/${m.key}`);
  };
  const email = r.email || r.secondary_email;
  const phone = r.phone || r.mobile;
  const converted = m.key === "leads" && !!r.converted_contact_id;

  return (
    <div className="crm-ui space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <button onClick={() => nav(`/crm/${m.key}`)} className="icon-btn mt-1" title={`Back to ${m.plural.toLowerCase()}`}><ArrowLeft className="h-4 w-4" /></button>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white" style={{ background: m.tone }}>{m.title(rec).charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{m.singular}</p>
          <h1 className="truncate font-display text-xl font-bold">{m.title(rec)}</h1>
          <p className="truncate text-sm text-muted-foreground">{[m.subtitle(rec), lk.userName.get(r[ownerKey(m)]) && `Owner: ${lk.userName.get(r[ownerKey(m)])}`].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {email && <Button variant="outline" size="sm" onClick={() => setEmailing(true)}><Mail /> Email</Button>}
          {phone && <Button variant="outline" size="sm" asChild><a href={`tel:${String(phone).replace(/\s+/g, "")}`}><Phone /> Call</a></Button>}
          {m.key === "leads" && !converted && <Button size="sm" onClick={() => setConverting(true)}><ArrowRightLeft /> Convert</Button>}
          {m.key === "accounts" && <Button variant="outline" size="sm" asChild><Link to={`/sales/quotes/new?customer=${r.id}`}><FileText /> New quote</Link></Button>}
          {m.key === "deals" && <Button variant="outline" size="sm" asChild><Link to={`/sales/quotes/new?${new URLSearchParams({ deal: r.id, ...(r.customer_id ? { customer: r.customer_id } : {}) })}`}><FileText /> Create quote</Link></Button>}
          {!editing ? <Button size="sm" variant="outline" onClick={startEdit}><Pencil /> Edit</Button> : <><Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X /> Cancel</Button><Button size="sm" onClick={save}><Save /> Save</Button></>}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={remove} title="Delete"><Trash2 /></Button>
        </div>
      </div>

      {converted && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <Check className="h-4 w-4 text-success" /> Converted{r.date_conversion ? ` on ${String(r.date_conversion).slice(0, 10)}` : ""}:
          {r.converted_account_id && <Link className="font-semibold text-primary hover:underline" to={`/crm/accounts/${r.converted_account_id}`}>account</Link>}
          {r.converted_contact_id && <Link className="font-semibold text-primary hover:underline" to={`/crm/contacts/${r.converted_contact_id}`}>contact</Link>}
          {r.converted_deal_id && <Link className="font-semibold text-primary hover:underline" to={`/crm/deals/${r.converted_deal_id}`}>deal</Link>}
        </div>
      )}

      {m.key === "deals" && (
        <div className="space-y-2">
          <div className="flex overflow-x-auto rounded-2xl border border-border bg-card p-1">
            {STAGES.filter((s) => s.key !== "lost").map((s, i, list) => {
              const at = list.findIndex((x) => x.key === r.stage);
              const done = r.stage !== "lost" && i <= at;
              return (
                <button key={s.key} onClick={() => setStage(s.key)} title={`Move to ${s.label}`}
                  className={cn("min-w-[110px] flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors", done ? (r.stage === "won" ? "bg-success text-white" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:bg-muted")}>
                  {s.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StagePill stage={r.stage} />
            <span className="text-muted-foreground">{formatKES(Number(r.amount || 0))} · {r.probability ?? 0}% · expected {formatKES(Number(r.amount || 0) * Number(r.probability || 0) / 100)}{r.closing_date ? ` · closes ${String(r.closing_date).slice(0, 10)}` : ""}</span>
            {!isClosedStage(r.stage) && <>
              <Button size="sm" variant="outline" className="text-success" onClick={() => setStage("won")}><Trophy /> Won</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setStage("lost")}><XCircle /> Lost</Button>
            </>}
            {isClosedStage(r.stage) && <Button size="sm" variant="ghost" onClick={() => setStage("negotiation")}>Reopen</Button>}
          </div>
        </div>
      )}

      <div className="inline-flex rounded-xl border border-border p-0.5">
        {(["overview", "timeline"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-4 py-1.5 text-sm font-medium capitalize", tab === t && "bg-primary text-primary-foreground")}>{t}</button>)}
      </div>

      {tab === "timeline" ? <Timeline r={r} m={m} acts={acts} notes={rel?.notes || []} history={rel?.history || []} lk={lk} /> : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            {sections.map((s) => (
              <Panel key={s} title={s}>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {m.fields.filter((f) => f.section === s).map((f) => (
                    <div key={f.key} className={cn("min-w-0", f.full && "sm:col-span-2")}>
                      <dt className="text-xs text-muted-foreground">{f.label}</dt>
                      <dd className="mt-0.5 break-words text-sm font-medium">
                        {editing && !f.readOnly ? <FieldInput f={f} value={draft[f.key]} onChange={(v) => setDraft((d: any) => ({ ...d, [f.key]: v, ...(f.key === "stage" ? { probability: STAGES.find((x) => x.key === v)?.p } : {}) }))} lk={lk} row={draft} /> : <FieldValue f={f} r={rec} lk={lk} />}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ))}

            {m.key === "accounts" && (
              <Panel flush title="Contacts" icon={Users} actions={<Button size="sm" variant="outline" onClick={() => setNewContact(true)}><Plus /> Contact</Button>}>
                {rel?.contacts?.length ? (
                  <ul className="divide-y divide-border">{rel.contacts.map((c) => (
                    <li key={c.id}><Link to={`/crm/contacts/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">{(c.first_name || c.last_name || "?").charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{MODULES.contacts.title(c)}</span><span className="block truncate text-xs text-muted-foreground">{[c.title, c.email, c.mobile || c.phone].filter(Boolean).join(" · ")}</span></span>
                    </Link></li>
                  ))}</ul>
                ) : <p className="px-4 py-4 text-sm text-muted-foreground">No contacts yet.</p>}
              </Panel>
            )}
            {(m.key === "accounts" || m.key === "contacts") && (
              <Panel flush title="Deals" icon={MODULES.deals.icon} actions={<Button size="sm" variant="outline" onClick={() => setNewDeal(true)}><Plus /> Deal</Button>}>
                {rel?.deals?.length ? (
                  <table className="dt"><thead><tr><th>Deal</th><th>Stage</th><th>Closing</th><th className="text-right">Amount</th></tr></thead><tbody>
                    {rel.deals.map((d) => <tr key={d.id} className="cursor-pointer" onClick={() => nav(`/crm/deals/${d.id}`)}><td className="font-medium text-primary">{d.name}</td><td><StagePill stage={d.stage} /></td><td className="text-xs">{d.closing_date || "—"}</td><td className="text-right tabular-nums">{formatKES(Number(d.amount || 0))}</td></tr>)}
                  </tbody></table>
                ) : <p className="px-4 py-4 text-sm text-muted-foreground">No deals yet.</p>}
              </Panel>
            )}
            {m.key === "accounts" && <BooksPanel customerId={r.id} />}
            {m.key === "deals" && <BooksPanel dealId={r.id} customerId={r.customer_id} />}
            {m.key === "contacts" && r.account_id && <BooksPanel customerId={r.account_id} compact />}
            {m.key === "deals" && (rel?.history?.length || 0) > 0 && (
              <Panel flush title="Stage history" icon={History}>
                <table className="dt"><thead><tr><th>When</th><th>Stage</th><th className="text-right">Amount</th><th className="text-right">Probability</th><th>Closing</th><th>By</th></tr></thead><tbody>
                  {rel!.history!.map((h) => <tr key={h.id}><td className="whitespace-nowrap text-xs">{new Date(h.changed_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</td><td>{stageLabel(h.stage)}</td><td className="text-right tabular-nums">{formatKES(Number(h.amount || 0))}</td><td className="text-right">{h.probability ?? 0}%</td><td className="text-xs">{h.closing_date || "—"}</td><td className="text-xs">{lk.userName.get(h.changed_by) || "—"}</td></tr>)}
                </tbody></table>
              </Panel>
            )}
            <DocumentsPanel entityType={`crm_${m.related}`} entityId={r.id} entityName={m.title(rec)} />
          </div>

          <div className="space-y-5">
            <Panel flush title="Open activities" icon={CalendarClock} actions={<div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setActivity({ kind: "task" })}>Task</Button>
              <Button size="sm" variant="outline" onClick={() => setActivity({ kind: "meeting" })}>Meeting</Button>
              <Button size="sm" variant="outline" onClick={() => setActivity({ kind: "call" })}>Call</Button>
            </div>}>
              {open.length ? <ul className="divide-y divide-border">{open.map((a) => <ActivityRow key={a.id} a={a} onChanged={reload} onOpen={(row) => setActivity({ row })} />)}</ul>
                : <p className="px-4 py-4 text-sm text-muted-foreground">Nothing planned. Add a task, meeting or call.</p>}
            </Panel>
            <Notes related={m.related} id={r.id} notes={rel?.notes || []} lk={lk} onChanged={reload} me={user?.id} />
            <Panel flush title="Closed activities" icon={Check}>
              {closed.length ? <ul className="divide-y divide-border">{closed.slice(0, 30).map((a) => <ActivityRow key={a.id} a={a} onChanged={reload} onOpen={(row) => setActivity({ row })} />)}</ul>
                : <p className="px-4 py-4 text-sm text-muted-foreground">None yet.</p>}
            </Panel>
          </div>
        </div>
      )}

      <ActivityForm open={!!activity} onClose={() => { setActivity(null); reload(); }} activity={activity?.row} kind={activity?.kind} relatedType={m.related} relatedId={r.id} />
      {m.key === "leads" && <ConvertLead open={converting} onClose={() => setConverting(false)} lead={r} onDone={(res) => { reload(); nav(res.deal_id ? `/crm/deals/${res.deal_id}` : `/crm/contacts/${res.contact_id}`); }} />}
      {email && <EmailComposer open={emailing} onClose={() => setEmailing(false)} to={email} name={m.title(rec)} related={m.related} relatedId={r.id} onSent={reload} />}
      <RecordForm m={MODULES.contacts} open={newContact} onClose={() => setNewContact(false)} preset={{ account_id: r.id }} onSaved={() => reload()} />
      <RecordForm m={MODULES.deals} open={newDeal} onClose={() => setNewDeal(false)} preset={m.key === "accounts" ? { customer_id: r.id } : { contact_id: r.id, customer_id: r.account_id }} onSaved={() => reload()} />
    </div>
  );
}

function Notes({ related, id, notes, lk, onChanged, me }: { related: string; id: string; notes: any[]; lk: ReturnType<typeof useLookups>; onChanged: () => void; me?: string }) {
  const tenantId = useTenantId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const [title, ...rest] = text.trim().split("\n");
    const { error } = await sb.from("crm_notes").insert({ tenant_id: tenantId, related_type: related, related_id: id, title: rest.length ? title : null, body: rest.length ? rest.join("\n") : title });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    setText(""); onChanged();
  };
  const remove = async (n: any) => {
    if (!(await confirmAction({ title: "Delete this note?", confirmLabel: "Delete", danger: true }))) return;
    await sb.from("crm_notes").delete().eq("id", n.id); onChanged();
  };
  return (
    <Panel title="Notes" icon={StickyNote}>
      <div className="space-y-2">
        <textarea className="fi min-h-[70px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note… (the first line becomes its title when there is more than one)" />
        <div className="flex justify-end"><Button size="sm" disabled={busy || !text.trim()} onClick={add}><Plus /> Add note</Button></div>
      </div>
      <ul className="mt-3 space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="group rounded-xl border border-border bg-muted/30 p-3">
            {n.title && <p className="text-sm font-semibold">{n.title}</p>}
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            <p className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{lk.userName.get(n.created_by) || (n.ext_id ? "From the previous system" : "")} · {new Date(n.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span>
              {(n.created_by === me || !n.created_by) && <button className="opacity-0 transition-opacity group-hover:opacity-100" onClick={() => remove(n)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
            </p>
          </li>
        ))}
        {!notes.length && <li className="text-sm text-muted-foreground">No notes yet.</li>}
      </ul>
    </Panel>
  );
}

/** Everything that happened on the record, newest first. */
function Timeline({ r, m, acts, notes, history, lk }: { r: any; m: any; acts: any[]; notes: any[]; history: any[]; lk: ReturnType<typeof useLookups> }) {
  const items = [
    { at: r.created_at, icon: Plus, text: `${m.singular} created`, who: r.created_by },
    ...notes.map((n) => ({ at: n.created_at, icon: MessageSquareText, text: `Note: ${n.title || String(n.body || "").slice(0, 120)}`, who: n.created_by })),
    ...acts.map((a) => ({ at: a.created_at, icon: CalendarClock, text: `${a.kind === "call" ? "Call" : a.kind === "meeting" ? "Meeting" : "Task"} planned: ${a.summary || ""}`, who: a.created_by })),
    ...acts.filter((a) => a.done && a.done_at).map((a) => ({ at: a.done_at, icon: Check, text: `${a.kind === "call" ? "Call made" : a.kind === "meeting" ? "Meeting held" : "Task completed"}: ${a.summary || ""}`, who: a.assigned_to })),
    ...history.map((h, i) => ({ at: h.changed_at, icon: History, text: i === history.length - 1 ? `Started at ${stageLabel(h.stage)} · ${formatKES(Number(h.amount || 0))}` : `Stage ${stageLabel(h.stage)} · ${formatKES(Number(h.amount || 0))} · ${h.probability ?? 0}%`, who: h.changed_by })),
    ...(r.date_conversion ? [{ at: r.date_conversion, icon: ArrowRightLeft, text: "Converted to an account and contact", who: null }] : []),
  ].filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return (
    <Panel>
      <ol className="relative space-y-4 border-l border-border pl-6">
        {items.map((x, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card"><x.icon className="h-3.5 w-3.5 text-primary" /></span>
            <p className="text-sm">{x.text}</p>
            <p className="text-xs text-muted-foreground">{new Date(x.at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}{x.who && lk.userName.get(x.who) ? ` · ${lk.userName.get(x.who)}` : ""}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** Lead → account + contact (+ deal). */
function ConvertLead({ open, onClose, lead, onDone }: { open: boolean; onClose: () => void; lead: any; onDone: (r: any) => void }) {
  const [withDeal, setWithDeal] = useState(true);
  const [deal, setDeal] = useState({ name: "", amount: "", closing: "", stage: "qualification" });
  const [busy, setBusy] = useState(false);
  const company = lead.partner_name || lead.name;
  const run = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("crm_convert_lead", { p_lead: lead.id, p_deal_name: withDeal ? (deal.name.trim() || company) : null, p_amount: withDeal && deal.amount ? Number(deal.amount) : null, p_closing: withDeal && deal.closing ? deal.closing : null, p_stage: deal.stage });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Lead converted"); onClose(); onDone(data);
  };
  return (
    <Modal open={open} onClose={onClose} size="md" icon={ArrowRightLeft} title="Convert this lead"
      description={`Creates (or finds) the account "${company}", adds ${MODULES.leads.title(lead)} as a contact there, and moves the lead's notes and activities to the contact.`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={run}><ArrowRightLeft /> {busy ? "Converting…" : "Convert"}</Button></>}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={withDeal} onChange={(e) => setWithDeal(e.target.checked)} /> Also create a deal</label>
        {withDeal && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deal name" className="sm:col-span-2"><input className="fi" value={deal.name} placeholder={company} onChange={(e) => setDeal({ ...deal, name: e.target.value })} /></Field>
            <Field label="Amount"><input className="fi" inputMode="decimal" value={deal.amount} placeholder={lead.expected_revenue ? String(lead.expected_revenue) : ""} onChange={(e) => setDeal({ ...deal, amount: e.target.value.replace(/[^0-9.]/g, "") })} /></Field>
            <Field label="Closing date"><input className="fi" type="date" value={deal.closing} onChange={(e) => setDeal({ ...deal, closing: e.target.value })} /></Field>
            <Field label="Stage"><select className="fi" value={deal.stage} onChange={(e) => setDeal({ ...deal, stage: e.target.value })}>{STAGES.filter((s) => !isClosedStage(s.key)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          </div>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Pill tone="info">Kept</Pill> The lead stays in Leads (Converted) with links to what it became.</p>
      </div>
    </Modal>
  );
}
