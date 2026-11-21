/**
 * JMSURF support tickets. A company raises a written ticket from the Help
 * centre and follows the replies there; JMSURF answers from Admin → Support.
 * Data: platform_tickets / platform_ticket_messages (read through RLS),
 * writes through the platform_ticket_* functions.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ticket as TicketIcon, Send, CheckCircle2, RotateCcw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Field, Pill, EmptyState, Panel, Segmented, TableWrap } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sb = supabase as any;

export const TICKET_CATEGORIES = [
  { value: "question", label: "A question" },
  { value: "problem", label: "Something is not working" },
  { value: "billing", label: "Billing or my package" },
  { value: "data", label: "Moving in or my data" },
  { value: "feature", label: "A feature request" },
  { value: "other", label: "Something else" },
] as const;
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent: my business is stopped" },
] as const;

type Ticket = {
  id: string; number: number; tenant_id: string; subject: string; category: string; priority: string;
  status: "open" | "answered" | "closed"; last_reply_by: string; created_at: string; updated_at: string;
  opener_name?: string | null; opener_email?: string | null; company?: string | null; slug?: string | null; messages?: number;
};
type Message = { id: string; from_jmsurf: boolean; author_name: string | null; body: string; created_at: string };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const catLabel = (c: string) => TICKET_CATEGORIES.find((x) => x.value === c)?.label || c;

/** Status as the company sees it (answered = waiting for you) or as JMSURF sees it. */
function TicketStatus({ t, admin }: { t: Ticket; admin?: boolean }) {
  if (t.status === "closed") return <Pill tone="muted">Closed</Pill>;
  if (t.status === "answered") return admin ? <Pill tone="info">Answered</Pill> : <Pill tone="success">Reply from JMSURF</Pill>;
  return admin ? <Pill tone="warning">Needs a reply</Pill> : <Pill tone="primary">With JMSURF</Pill>;
}

/** Raise a new ticket. */
export function NewTicketModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ subject: "", category: "question", priority: "normal", body: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ subject: "", category: "question", priority: "normal", body: "" }); }, [open]);
  const send = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("platform_ticket_open", { p_subject: f.subject, p_body: f.body, p_category: f.category, p_priority: f.priority, p_page: window.location.pathname });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ticket sent. We will reply here and by email.");
    onCreated(data as string);
  };
  const ok = f.subject.trim().length >= 3 && f.body.trim().length >= 5;
  return (
    <Modal open={open} onClose={onClose} locked={busy} icon={TicketIcon} title="Raise a support ticket" description="Tell us what you need. A JMSURF person replies here and by email."
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void send()} disabled={!ok || busy}><Send /> {busy ? "Sending…" : "Send ticket"}</Button></>}>
      <div className="space-y-4">
        <Field label="Subject" required><input className="fi" maxLength={200} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Invoices are not sending by email" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="About"><select className="fi" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="How urgent"><select className="fi" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
        </div>
        <Field label="Details" required hint="What you did, what happened and what you expected. Screens and record numbers help."><textarea className="fi" rows={7} maxLength={8000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** One ticket: the conversation, a reply box and close / reopen. */
export function TicketThread({ id, admin, onClose }: { id: string | null; admin?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["platform-ticket", id], enabled: !!id, refetchInterval: 30_000,
    queryFn: async () => {
      const [{ data: t, error }, { data: m }] = await Promise.all([
        sb.from("platform_tickets").select("*").eq("id", id).maybeSingle(),
        sb.from("platform_ticket_messages").select("id, from_jmsurf, author_name, body, created_at").eq("ticket_id", id).order("created_at"),
      ]);
      if (error) throw error;
      return { t: t as Ticket | null, m: (m || []) as Message[] };
    },
  });
  useEffect(() => setReply(""), [id]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["platform-ticket", id] }); void qc.invalidateQueries({ queryKey: ["platform-tickets"] }); };
  const send = async () => {
    setBusy(true);
    const { error } = await sb.rpc("platform_ticket_reply", { p_ticket: id, p_body: reply });
    setBusy(false);
    if (error) return toast.error(error.message);
    setReply(""); refresh();
    toast.success(admin ? "Reply sent to the company" : "Reply sent");
  };
  const setStatus = async (status: string) => {
    const { error } = await sb.rpc("platform_ticket_set_status", { p_ticket: id, p_status: status });
    if (error) return toast.error(error.message);
    refresh(); toast.success(status === "closed" ? "Ticket closed" : "Ticket reopened");
  };
  const t = data?.t;
  return (
    <Modal open={!!id} onClose={onClose} size="lg" icon={TicketIcon}
      title={t ? `#${t.number} · ${t.subject}` : "Ticket"}
      description={t ? <span className="flex flex-wrap items-center gap-2"><TicketStatus t={t} admin={admin} /><span>{catLabel(t.category)}</span>{t.priority !== "normal" && <Pill tone={t.priority === "urgent" || t.priority === "high" ? "danger" : "muted"}>{t.priority}</Pill>}{admin && t.opener_email && <span>{t.opener_name} · {t.opener_email}</span>}</span> : undefined}
      footer={t && (t.status === "closed"
        ? <Button variant="outline" onClick={() => void setStatus("open")}><RotateCcw /> Reopen</Button>
        : <>
            <Button variant="outline" onClick={() => void setStatus("closed")}><CheckCircle2 /> {admin ? "Close ticket" : "Solved, close it"}</Button>
            <Button onClick={() => void send()} disabled={busy || !reply.trim()}><Send /> {busy ? "Sending…" : "Send reply"}</Button>
          </>)}>
      <div className="space-y-3">
        {(data?.m || []).map((m) => (
          <div key={m.id} className={cn("rounded-2xl border p-3 text-sm", m.from_jmsurf ? "border-primary/25 bg-primary/5" : "border-border bg-muted/30", m.from_jmsurf === !!admin ? "ml-6" : "mr-6")}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <b className={m.from_jmsurf ? "text-primary" : "text-foreground"}>{m.from_jmsurf ? "JMSURF support" : m.author_name || "Company"}</b>
              <span>{when(m.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </div>
        ))}
        {t && t.status !== "closed" && (
          <Field label={admin ? "Reply to the company" : "Add a reply"}>
            <textarea className="fi" rows={4} maxLength={8000} value={reply} onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && reply.trim()) { e.preventDefault(); void send(); } }} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Help centre: the company's own tickets and a button to raise one. */
export function MyTickets({ tenantId }: { tenantId?: string | null }) {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get("ticket");
  const setOpen = (v: string | null) => { const p = new URLSearchParams(params); if (v) p.set("ticket", v); else p.delete("ticket"); setParams(p, { replace: true }); };
  const { data: tickets = [] } = useQuery({
    queryKey: ["platform-tickets", "mine", tenantId], enabled: !!tenantId, refetchInterval: 60_000,
    queryFn: async () => ((await sb.from("platform_tickets").select("id, number, tenant_id, subject, category, priority, status, last_reply_by, created_at, updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(50)).data || []) as Ticket[],
  });
  const waiting = tickets.filter((t) => t.status === "answered").length;
  return (
    <>
      <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
        <TicketIcon className="h-4 w-4" /> Raise a support ticket
      </button>
      {tickets.length > 0 && (
        <div className="pt-2">
          <p className="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">Your tickets {waiting > 0 && <Pill tone="success">{waiting} new {waiting === 1 ? "reply" : "replies"}</Pill>}</p>
          <ul className="space-y-1">
            {tickets.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpen(t.id)} className="w-full rounded-xl px-2 py-2 text-left hover:bg-muted">
                  <span className="block truncate text-sm font-medium">#{t.number} · {t.subject}</span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"><TicketStatus t={t} /><span>{when(t.updated_at)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <NewTicketModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />
      <TicketThread id={openId} onClose={() => setOpen(null)} />
    </>
  );
}

/** Admin → Support: every company's tickets. */
export function AdminTickets() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"waiting" | "open" | "all">("waiting");
  const openId = params.get("ticket");
  const setOpen = (v: string | null) => { const p = new URLSearchParams(params); if (v) p.set("ticket", v); else p.delete("ticket"); setParams(p, { replace: true }); };
  const { data: tickets = [], error } = useQuery({
    queryKey: ["platform-tickets", "admin"], refetchInterval: 30_000,
    queryFn: async () => { const { data, error } = await sb.rpc("platform_tickets_admin"); if (error) throw error; return (data || []) as Ticket[]; },
  });
  const waiting = tickets.filter((t) => t.status === "open");
  const shown = view === "waiting" ? waiting : view === "open" ? tickets.filter((t) => t.status !== "closed") : tickets;
  return (
    <Panel title={<span className="flex items-center gap-2"><TicketIcon className="h-4 w-4 text-primary" /> Tickets {waiting.length > 0 && <Pill tone="warning">{waiting.length} need a reply</Pill>}</span>}
      actions={<Segmented<"waiting" | "open" | "all"> value={view} onChange={setView} options={[{ value: "waiting", label: "Need a reply" }, { value: "open", label: "Open" }, { value: "all", label: "All" }]} />} flush>
      {error ? <p className="p-5 text-sm text-destructive">{(error as Error).message}</p>
        : !shown.length ? <EmptyState icon={TicketIcon} title={view === "waiting" ? "Nothing waiting" : "No tickets"} description="Companies raise tickets from Help centre → Talk to us. New tickets and replies also reach you as alerts." />
        : (
          <TableWrap><table className="dt"><thead><tr><th>#</th><th>Subject</th><th>Company</th><th className="hidden md:table-cell">About</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>
            <PagedRows rows={shown} colSpan={7}>{(rows) => rows.map((t) => (
              <tr key={t.id} className="cursor-pointer" onClick={() => setOpen(t.id)}>
                <td className="whitespace-nowrap text-muted-foreground">#{t.number}</td>
                <td><b className="text-sm">{t.subject}</b>{(t.priority === "urgent" || t.priority === "high") && <Pill tone="danger" className="ml-2">{t.priority}</Pill>}</td>
                <td className="text-sm">{t.company || "—"}{t.slug && <a href={`https://app.jmsurfgarage.co.ke/${t.slug}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 inline-flex text-muted-foreground hover:text-primary" aria-label="Open the company's customer pages"><ExternalLink className="h-3 w-3" /></a>}</td>
                <td className="hidden text-sm text-muted-foreground md:table-cell">{catLabel(t.category)}</td>
                <td><TicketStatus t={t} admin /></td>
                <td className="whitespace-nowrap text-xs text-muted-foreground">{when(t.updated_at)}</td>
                <td className="text-right"><Button size="sm" variant="ghost">Open</Button></td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      <TicketThread id={openId} admin onClose={() => setOpen(null)} />
    </Panel>
  );
}

