import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Ticket as TicketIcon, Plus, Send, ArrowLeft, User, Phone, Truck, Lock, CheckCircle2, Inbox, Clock, MessageSquare, UserCheck } from "lucide-react";
import { PageHeader, Modal, Field, StatTile, StatGrid, PageLoader, EmptyState, Pill, Segmented, SearchBox, Toolbar } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCustomers, useStaff } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { tenantPath } from "@/lib/host";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORIES, categoryLabel, isTicketHandler,
  useTickets, useTicketMessages, openTicket, replyTicket, updateTicket, markTicketRead,
  type Ticket, type TicketStatus, type TicketPriority,
} from "@/lib/tickets";

type View = "active" | "mine" | "resolved" | "all";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Support tickets: complaints and requests from customers and staff, answered by the shop. */
export default function Tickets() {
  const { role } = useAuth() as any;
  const handler = isTicketHandler(role);
  return handler ? <TicketDesk /> : <MyTickets />;
}

/** Shop side: every ticket, with replies, status and who handles it. */
function TicketDesk() {
  const { user } = useAuth() as any;
  const { data: tickets = [], isLoading } = useTickets();
  const [view, setView] = useState<View>("active");
  const [source, setSource] = useState<"all" | "customer" | "staff">("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => ({
    open: tickets.filter((t) => t.status === "open").length,
    progress: tickets.filter((t) => t.status === "in_progress" || t.status === "waiting").length,
    unread: tickets.filter((t) => t.unread_by_shop).length,
    resolvedWeek: tickets.filter((t) => t.resolved_at && Date.now() - new Date(t.resolved_at).getTime() < 7 * 86400_000).length,
  }), [tickets]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (view === "active" && ["resolved", "closed"].includes(t.status)) return false;
      if (view === "resolved" && !["resolved", "closed"].includes(t.status)) return false;
      if (view === "mine" && t.assigned_to !== user?.id) return false;
      if (source !== "all" && t.source !== source) return false;
      if (!s) return true;
      return [t.subject, t.customer_name, t.customer_phone, t.created_by_name, `#${t.ticket_no}`].some((x) => String(x || "").toLowerCase().includes(s));
    });
  }, [tickets, view, source, q, user?.id]);

  const open = tickets.find((t) => t.id === openId) || null;

  if (isLoading) return <PageLoader label="Loading tickets…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Tickets" icon={TicketIcon}
        description="Complaints and requests from your customers and staff. Pick one up, reply, and close it when it's sorted."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New ticket</Button>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Open" value={counts.open} icon={Inbox} tone={counts.open ? "danger" : "success"} />
        <StatTile label="Being handled" value={counts.progress} icon={Clock} tone="warning" />
        <StatTile label="Unread replies" value={counts.unread} icon={MessageSquare} tone={counts.unread ? "info" : "muted"} />
        <StatTile label="Resolved this week" value={counts.resolvedWeek} icon={CheckCircle2} tone="success" />
      </StatGrid>

      <div className={cn("grid gap-4", open && "xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]")}>
        <div className={cn("space-y-3", open && "hidden xl:block")}>
          <Toolbar className="flex-col items-stretch gap-2">
            <Segmented value={view} onChange={(v) => setView(v as View)} options={[
              { value: "active", label: "Active", count: tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length },
              { value: "mine", label: "Mine" },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All", count: tickets.length },
            ]} />
            <div className="flex flex-wrap gap-2">
              <Segmented value={source} onChange={(v) => setSource(v as any)} options={[
                { value: "all", label: "Everyone" }, { value: "customer", label: "Customers" }, { value: "staff", label: "Staff" },
              ]} />
              <SearchBox value={q} onChange={setQ} placeholder="Search tickets…" className="sm:max-w-none" />
            </div>
          </Toolbar>
          {list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50">
              <EmptyState icon={TicketIcon} title={tickets.length ? "Nothing here" : "No tickets yet"}
                description={tickets.length ? "Try another filter." : "When a customer or staff member raises a problem, it appears here."} />
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((t) => <TicketRow key={t.id} t={t} active={t.id === openId} unread={t.unread_by_shop} onClick={() => setOpenId(t.id)} />)}
            </ul>
          )}
        </div>
        {open && <TicketThread ticket={open} handler split onBack={() => setOpenId(null)} />}
      </div>

      {creating && <NewTicketDialog handler onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); setOpenId(t.id); }} />}
    </div>
  );
}

/** Staff who don't answer tickets (riders, stock staff…): their own tickets. */
export function MyTickets({ compact }: { compact?: boolean }) {
  const { data: tickets = [], isLoading } = useTickets({ mine: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = tickets.find((t) => t.id === openId) || null;
  if (isLoading) return <PageLoader label="Loading tickets…" />;
  if (open) return <TicketThread ticket={open} handler={false} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-4">
      {!compact ? (
        <PageHeader title="My tickets" icon={TicketIcon} description="Report a problem or ask the company for something. Replies come here."
          actions={<Button onClick={() => setCreating(true)}><Plus /> New ticket</Button>} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Report a problem with a delivery, a customer, your bike or payments.</p>
          <Button onClick={() => setCreating(true)}><Plus /> New ticket</Button>
        </div>
      )}
      {tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={TicketIcon} title="No tickets yet" description="Open one when something needs the company's attention." />
        </div>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => <TicketRow key={t.id} t={t} active={false} unread={t.unread_by_requester} onClick={() => setOpenId(t.id)} />)}
        </ul>
      )}
      {creating && <NewTicketDialog handler={false} onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); setOpenId(t.id); }} />}
    </div>
  );
}

function TicketRow({ t, active, unread, onClick }: { t: Ticket; active: boolean; unread: boolean; onClick: () => void }) {
  const who = t.source === "customer" ? t.customer_name || "Customer" : t.created_by_name || "Staff";
  return (
    <li>
      <button type="button" onClick={onClick}
        className={cn("block w-full rounded-2xl border bg-card p-3.5 text-left transition hover:border-primary/40",
          active ? "border-primary ring-1 ring-primary/30" : "border-border")}>
        <div className="flex items-start justify-between gap-2">
          <p className={cn("min-w-0 truncate text-sm", unread ? "font-bold" : "font-semibold")}>
            {unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle" />}
            #{t.ticket_no} · {t.subject}
          </p>
          <Pill tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Pill>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">{t.source === "customer" ? <User className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}{who}</span>
          <span>· {categoryLabel(t.category)}</span>
          {t.priority !== "normal" && <Pill tone={TICKET_PRIORITY[t.priority].tone}>{TICKET_PRIORITY[t.priority].label}</Pill>}
          <span className="ml-auto">{ago(t.last_message_at)}</span>
        </div>
        {t.assigned_name && <p className="mt-1 text-[11px] text-muted-foreground">Handled by {t.assigned_name}</p>}
      </button>
    </li>
  );
}

/** `split`: shown beside the list on wide screens, so the back arrow only shows when the list is hidden. */
function TicketThread({ ticket: t, handler, onBack, split }: { ticket: Ticket; handler: boolean; onBack: () => void; split?: boolean }) {
  const { data: messages = [], isLoading } = useTicketMessages(t.id);
  const { data: staff = [] } = useStaff();
  const qc = useQueryClient();
  const { toast } = useToast();
  const nav = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length, t.id]);
  useEffect(() => {
    if ((handler && t.unread_by_shop) || (!handler && t.unread_by_requester)) {
      markTicketRead(t.id).then(() => {
        qc.invalidateQueries({ queryKey: ["tickets"] });
        qc.invalidateQueries({ queryKey: ["tickets-count"] });
      });
    }
  }, [t.id, t.unread_by_shop, t.unread_by_requester, handler, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["ticket-messages", t.id] });
    qc.invalidateQueries({ queryKey: ["tickets-count"] });
  };
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); refresh(); if (done) toast({ title: done }); return true; }
    catch (e: any) { toast({ title: "Could not do that", description: e.message, variant: "destructive" }); return false; }
    finally { setBusy(null); }
  };
  const send = async (status: TicketStatus | null = null) => {
    if (await run(status ? "resolve" : "send", () => replyTicket(t.id, body.trim(), handler && internal, status), status ? "Replied and resolved" : internal ? "Note saved" : "Reply sent")) {
      setBody(""); setInternal(false);
    }
  };
  const closed = ["resolved", "closed"].includes(t.status);
  const requester = t.source === "customer" ? t.customer_name || "Customer" : t.created_by_name || "Staff";

  return (
    <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onBack} className={cn("-ml-1 rounded-lg p-1.5 hover:bg-muted", split && "xl:hidden")} aria-label="Back to tickets"><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight">#{t.ticket_no} · {t.subject}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{categoryLabel(t.category)} · opened {new Date(t.created_at).toLocaleString()}</p>
          </div>
          <Pill tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Pill>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            {t.source === "customer" ? <User className="h-4 w-4 text-muted-foreground" /> : <UserCheck className="h-4 w-4 text-muted-foreground" />}
            {t.customer_id && handler
              ? <button type="button" className="font-medium hover:text-primary hover:underline" onClick={() => nav(tenantPath(slug, `/customers/${t.customer_id}`))}>{requester}</button>
              : <span className="font-medium">{requester}</span>}
            <span className="text-xs text-muted-foreground">({t.source === "customer" ? "customer" : "staff"})</span>
          </span>
          {t.customer_phone && handler && <a href={`tel:${t.customer_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="h-3.5 w-3.5" />{t.customer_phone}</a>}
          {t.order_id && handler && (
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => nav(tenantPath(slug, "/water/orders"))}><Truck className="h-3.5 w-3.5" /> Linked order</button>
          )}
        </div>
        {handler && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <select className="fi h-9 text-sm" value={t.status} disabled={!!busy}
              onChange={(e) => run("status", () => updateTicket(t.id, { status: e.target.value as TicketStatus }), "Status updated")}>
              {(Object.keys(TICKET_STATUS) as TicketStatus[]).map((k) => <option key={k} value={k}>{TICKET_STATUS[k].label}</option>)}
            </select>
            <select className="fi h-9 text-sm" value={t.priority} disabled={!!busy}
              onChange={(e) => run("priority", () => updateTicket(t.id, { priority: e.target.value as TicketPriority }), "Priority updated")}>
              {(Object.keys(TICKET_PRIORITY) as TicketPriority[]).map((k) => <option key={k} value={k}>{TICKET_PRIORITY[k].label} priority</option>)}
            </select>
            <select className="fi h-9 text-sm" value={t.assigned_to || ""} disabled={!!busy}
              onChange={(e) => run("assign", () => updateTicket(t.id, e.target.value ? { assign: e.target.value } : { unassign: true }), "Ticket assigned")}>
              <option value="">Nobody handling it</option>
              {(staff as any[]).map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name || "Staff member"}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto bg-muted/20 p-4" style={{ maxHeight: "55vh" }}>
        {isLoading ? <PageLoader /> : messages.map((m) => {
          if (m.author_kind === "system") return <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.body} · {m.author_name} · {new Date(m.created_at).toLocaleString()}</p>;
          const fromRequester = t.source === "customer" ? m.author_kind === "customer" : m.author_id === t.created_by;
          return (
            <div key={m.id} className={cn("flex", fromRequester ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                m.internal ? "border border-dashed border-warning/60 bg-warning/10"
                  : fromRequester ? "rounded-bl-md border border-border bg-card" : "rounded-br-md bg-primary text-primary-foreground")}>
                <p className={cn("mb-0.5 text-[11px] font-semibold", !fromRequester && !m.internal ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {m.internal && <Lock className="mr-1 inline h-3 w-3" />}{m.author_name || (m.author_kind === "customer" ? "Customer" : "Staff")}{m.internal ? " · internal note" : ""}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={cn("mt-1 text-[10px]", !fromRequester && !m.internal ? "text-primary-foreground/70" : "text-muted-foreground")}>{new Date(m.created_at).toLocaleString()}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <textarea className="fi min-h-[80px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
          placeholder={internal ? "Internal note: only the company team sees this" : closed ? "Write to reopen this ticket" : handler ? `Reply to ${requester}` : "Write a reply"} />
        <div className="flex flex-wrap items-center gap-2">
          {handler && (
            <label className="mr-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
            </label>
          )}
          {handler && !internal && !closed && (
            <Button variant="outline" disabled={!body.trim() || !!busy} onClick={() => send("resolved")}><CheckCircle2 /> Reply & resolve</Button>
          )}
          <Button className={cn(!handler && "ml-auto")} disabled={!body.trim() || !!busy} onClick={() => send(null)}><Send /> {busy === "send" ? "Sending…" : internal ? "Save note" : "Send"}</Button>
        </div>
      </div>
    </div>
  );
}

export function NewTicketDialog({ handler, onClose, onCreated, defaults }: {
  handler: boolean; onClose: () => void; onCreated: (t: Ticket) => void;
  defaults?: { customerId?: string; orderId?: string; subject?: string; category?: string };
}) {
  const { data: customers = [] } = useCustomers();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState(defaults?.subject || "");
  const [category, setCategory] = useState(defaults?.category || (handler ? "customer" : "delivery"));
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [customerId, setCustomerId] = useState(defaults?.customerId || "");
  const [custQ, setCustQ] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return (customers as any[]).filter((c) => c.name.toLowerCase().includes(s) || String(c.phone || "").includes(s)).slice(0, 6);
  }, [customers, custQ]);
  const chosen = (customers as any[]).find((c) => c.id === customerId);
  const save = async () => {
    setBusy(true);
    try {
      const t = await openTicket({ subject: subject.trim(), body: body.trim(), category, priority, customerId: customerId || null, orderId: defaults?.orderId || null });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tickets-count"] });
      toast({ title: `Ticket #${t.ticket_no} opened`, description: handler ? undefined : "The company has been notified." });
      onCreated(t);
    } catch (e: any) {
      toast({ title: "Could not open the ticket", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} locked={busy} icon={TicketIcon} title="New ticket" size="md"
      description={handler ? "Log a complaint or request, for example one a customer phoned in." : "Tell the company what's wrong. You'll get a reply here."}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy || !subject.trim() || !body.trim()} onClick={save}><Send /> {busy ? "Sending…" : "Open ticket"}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Subject" required><input className="fi" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Customer says water tasted salty" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic">
            <select className="fi" value={category} onChange={(e) => setCategory(e.target.value)}>
              {TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="fi" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {(Object.keys(TICKET_PRIORITY) as TicketPriority[]).map((k) => <option key={k} value={k}>{TICKET_PRIORITY[k].label}</option>)}
            </select>
          </Field>
        </div>
        {handler && (
          <Field label="Customer" hint="Optional: link the customer this is about">
            {chosen ? (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                <span><span className="font-medium">{chosen.name}</span> <span className="text-muted-foreground">{chosen.phone}</span></span>
                <button type="button" className="text-xs text-destructive" onClick={() => setCustomerId("")}>Remove</button>
              </div>
            ) : (
              <div className="space-y-1">
                <input className="fi" value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Search by name or phone" />
                {matches.length > 0 && (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {matches.map((c: any) => (
                      <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { setCustomerId(c.id); setCustQ(""); }}>
                        <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.phone}</span></button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
        )}
        <Field label="Details" required><textarea className="fi min-h-[120px]" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="What happened, when, and what needs to be done" /></Field>
      </div>
    </Modal>
  );
}
