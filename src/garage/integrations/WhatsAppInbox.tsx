import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Car, CheckCheck, Check, Clock, FileText, Image as ImageIcon, Loader2, MessageCircle, PanelRight, Phone, Plus, Send, Smartphone, Wrench, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, EmptyState, SearchBox, Segmented, Pill, Modal, Field } from "@/components/kit";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { garageI, requestInvoiceMpesa, type ConnectionStatus } from "./api";

type Conversation = {
  id: string; phone: string; display_name: string | null; customer_id: string | null; status: "open" | "closed";
  unread: number; last_message_at: string | null; last_inbound_at: string | null; last_preview: string | null;
};
type Message = {
  id: string; direction: "in" | "out"; kind: string; body: string | null; media_id: string | null; media_mime: string | null;
  template_name: string | null; status: string; error: string | null; via: string | null; created_at: string;
};
type Context = {
  customer: { id: string; name: string; phone: string; email: string | null } | null;
  vehicles: Array<{ id?: string; registration?: string; reg_no?: string; make?: string; model?: string; year?: string | number; mileage?: number }>;
  jobs: Array<{ id?: string; number?: string; job_number?: string; status?: string; title?: string; vehicle?: string; tracking_url?: string; estimate_url?: string }>;
  invoices: Array<{ id: string; invoice_number: string; total: number; amount_paid: number; balance: number; due_date: string | null; status: string }>;
};

const sb = supabase as any;
const WINDOW_MS = 24 * 3600_000;
const time = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Date.now() - d.getTime() < 20 * 3600_000 ? d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
};
const pretty = (digits: string) => (digits?.startsWith("254") ? `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}` : `+${digits}`);
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** Two-way WhatsApp inbox: conversations, the chat, and the customer's vehicles, jobs and invoices beside it. */
export default function WhatsAppInbox() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"open" | "unread" | "closed">("open");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSide, setShowSide] = useState(true);
  const [newChat, setNewChat] = useState(false);

  const status = useQuery({ queryKey: ["garage-connections"], staleTime: 60_000, queryFn: () => garageI<ConnectionStatus>("status") });
  const cloud = status.data?.whatsapp?.cloud;
  const anyWhatsApp = !!cloud?.connected || (status.data?.whatsapp?.apiwap_mode || "off") !== "off";

  const list = useQuery({
    queryKey: ["wa-conversations"],
    refetchInterval: () => (visible() ? 8000 : false),
    queryFn: async () => {
      const { data, error } = await sb.from("garage_wa_conversations").select("id,phone,display_name,customer_id,status,unread,last_message_at,last_inbound_at,last_preview").order("last_message_at", { ascending: false, nullsFirst: false }).limit(300);
      if (error) throw error;
      return (data || []) as Conversation[];
    },
  });
  const conversations = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list.data || []).filter((c) =>
      (filter === "closed" ? c.status === "closed" : c.status !== "closed") && (filter !== "unread" || c.unread > 0) &&
      (!term || `${c.display_name || ""} ${c.phone} ${c.last_preview || ""}`.toLowerCase().includes(term)));
  }, [list.data, filter, q]);
  const active = (list.data || []).find((c) => c.id === activeId) || null;

  useEffect(() => {
    if (!active || active.unread === 0) return;
    void garageI("whatsapp/read", { conversation_id: active.id }).then(() => qc.invalidateQueries({ queryKey: ["wa-conversations"] }));
  }, [active?.id, active?.unread, qc]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="WhatsApp" icon={MessageCircle} actions={
        <button type="button" onClick={() => setNewChat(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New chat</button>
      } />
      {status.data && !anyWhatsApp && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-[hsl(32_90%_38%)]" /> WhatsApp is not connected yet.
          <Link to="/settings?tab=connections" className="font-semibold text-primary hover:underline">Connect your WhatsApp number</Link>
        </div>
      )}
      <div className={cn("grid gap-3", showSide ? "lg:grid-cols-[300px_minmax(0,1fr)_300px]" : "lg:grid-cols-[300px_minmax(0,1fr)]")}>
        {/* conversations */}
        <Panel flush className={cn(active && "hidden lg:block")} bodyClassName="flex h-[calc(100svh-210px)] min-h-[420px] flex-col">
          <div className="space-y-2 border-b border-border p-2">
            <SearchBox value={q} onChange={setQ} placeholder="Search name or number" className="sm:max-w-none" />
            <Segmented value={filter} onChange={setFilter} options={[
              { value: "open", label: "Open" },
              { value: "unread", label: "Unread", count: (list.data || []).filter((c) => c.unread > 0).length },
              { value: "closed", label: "Closed" },
            ]} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.isLoading ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              : conversations.length === 0 ? <EmptyState icon={MessageCircle} title="No conversations" description="Messages customers send to your WhatsApp number appear here." />
              : conversations.map((c) => (
                <button key={c.id} type="button" onClick={() => setActiveId(c.id)}
                  className={cn("flex w-full items-start gap-2 border-b border-border/50 px-3 py-2.5 text-left hover:bg-muted/60", c.id === activeId && "bg-primary/5")}>
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-sm font-bold text-success">{(c.display_name || "#").slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <b className="truncate text-sm">{c.display_name || pretty(c.phone)}</b>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{time(c.last_message_at)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{c.last_preview || "…"}</span>
                      {c.unread > 0 && <span className="rounded-full bg-success px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </Panel>

        {/* chat */}
        <Panel flush className={cn(!active && "hidden lg:block")} bodyClassName="flex h-[calc(100svh-210px)] min-h-[420px] flex-col">
          {active ? <Chat conv={active} cloud={!!cloud?.connected} hasTemplate={!!cloud?.default_template} onBack={() => setActiveId(null)} onToggleSide={() => setShowSide((v) => !v)} />
            : <EmptyState icon={MessageCircle} title="Choose a conversation" description="Pick a customer on the left to read and reply." />}
        </Panel>

        {/* customer, vehicles, jobs */}
        {showSide && active && <CustomerSide conv={active} />}
      </div>
      <NewChat open={newChat} onClose={() => setNewChat(false)} onStarted={() => { setNewChat(false); void qc.invalidateQueries({ queryKey: ["wa-conversations"] }); }} />
    </div>
  );
}

function Chat({ conv, cloud, hasTemplate, onBack, onToggleSide }: { conv: Conversation; cloud: boolean; hasTemplate: boolean; onBack: () => void; onToggleSide: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const msgs = useQuery({
    queryKey: ["wa-messages", conv.id],
    refetchInterval: () => (visible() ? 6000 : false),
    queryFn: async () => {
      const { data, error } = await sb.from("garage_wa_messages").select("id,direction,kind,body,media_id,media_mime,template_name,status,error,via,created_at").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return (data || []) as Message[];
    },
  });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.data?.length]);
  const windowOpen = !!conv.last_inbound_at && Date.now() - Date.parse(conv.last_inbound_at) < WINDOW_MS;

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const r = await garageI("whatsapp/send", { conversation_id: conv.id, text: t });
    setSending(false);
    if (r.ok === false || r.error) { toast.error(r.error || "Not sent"); return; }
    setText("");
    void qc.invalidateQueries({ queryKey: ["wa-messages", conv.id] });
    void qc.invalidateQueries({ queryKey: ["wa-conversations"] });
  };
  const close = async (status: "open" | "closed") => {
    await garageI("whatsapp/read", { conversation_id: conv.id, status });
    void qc.invalidateQueries({ queryKey: ["wa-conversations"] });
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" onClick={onBack} className="rounded-lg p-1 hover:bg-muted lg:hidden" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm">{conv.display_name || pretty(conv.phone)}</b>
          <span className="text-xs text-muted-foreground">{pretty(conv.phone)}</span>
        </div>
        <a href={`tel:+${conv.phone}`} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Call"><Phone className="h-4 w-4" /></a>
        <button type="button" onClick={() => close(conv.status === "closed" ? "open" : "closed")} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted">{conv.status === "closed" ? "Reopen" : "Close"}</button>
        <button type="button" onClick={onToggleSide} className="hidden rounded-lg p-1.5 hover:bg-muted lg:inline-flex" aria-label="Customer details"><PanelRight className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto bg-muted/30 p-3">
        {(msgs.data || []).map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-1.5 text-sm shadow-sm", m.direction === "out" ? "rounded-br-sm bg-success/15" : "rounded-bl-sm bg-card")}>
              {m.media_id && <MediaLink id={m.media_id} kind={m.kind} />}
              {m.template_name && <span className="mb-0.5 block text-[10px] font-semibold uppercase text-muted-foreground">Template {m.template_name}</span>}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                {time(m.created_at)}
                {m.direction === "out" && (m.status === "failed" ? <span className="text-destructive" title={m.error || ""}>not sent</span>
                  : m.status === "read" ? <CheckCheck className="h-3 w-3 text-info" /> : m.status === "delivered" ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
              </span>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {cloud && !windowOpen && (
        <p className="flex items-center gap-1.5 border-t border-border bg-warning/10 px-3 py-1.5 text-xs">
          <Clock className="h-3.5 w-3.5" /> More than 24 hours since the customer wrote: {hasTemplate ? "your message goes out in your approved template." : "WhatsApp needs an approved template."}
          <button type="button" onClick={() => setTplOpen(true)} className="font-semibold text-primary hover:underline">Send a template</button>
        </p>
      )}
      <div className="flex items-end gap-2 border-t border-border p-2">
        <textarea className="fi min-h-[42px] flex-1 resize-none" rows={1} maxLength={4096} value={text} placeholder="Type a message"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="button" onClick={() => void send()} disabled={!text.trim() || sending} aria-label="Send"
          className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-success text-white disabled:opacity-40">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <TemplateDialog open={tplOpen} conv={conv} onClose={() => setTplOpen(false)} onSent={() => { setTplOpen(false); void qc.invalidateQueries({ queryKey: ["wa-messages", conv.id] }); }} />
    </>
  );
}

function MediaLink({ id, kind }: { id: string; kind: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`/api/garage/i/whatsapp/media?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast.error("Could not open the file"); return; }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <button type="button" onClick={() => void open()} className="mb-1 inline-flex items-center gap-1 rounded-lg bg-background/70 px-2 py-1 text-xs font-medium">
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : kind === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />} Open {kind}
    </button>
  );
}

function TemplateDialog({ open, conv, onClose, onSent }: { open: boolean; conv: Conversation; onClose: () => void; onSent: () => void }) {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("en");
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await garageI("whatsapp/template", { conversation_id: conv.id, name, lang, params: params.split("\n").map((x) => x.trim()).filter(Boolean) });
    setBusy(false);
    if (r.ok === false || r.error) { toast.error(r.error || "Not sent"); return; }
    toast.success("Template sent");
    onSent();
  };
  return (
    <Modal open={open} onClose={onClose} title="Send a WhatsApp template" description="Templates must be approved in your Meta WhatsApp Manager first." size="md"
      footer={<button type="button" disabled={!name.trim() || busy} onClick={() => void send()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Sending…" : "Send"}</button>}>
      <div className="space-y-3">
        <Field label="Template name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter the template name exactly as approved" /></Field>
        <Field label="Language code"><input className="fi" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="Enter the language code, e.g. en" /></Field>
        <Field label="Values for {{1}}, {{2}} …" hint="One per line, in order."><textarea className="fi" rows={4} value={params} onChange={(e) => setParams(e.target.value)} placeholder="Enter each value on its own line" /></Field>
      </div>
    </Modal>
  );
}

function CustomerSide({ conv }: { conv: Conversation }) {
  const qc = useQueryClient();
  const ctx = useQuery({ queryKey: ["wa-context", conv.id], staleTime: 30_000, queryFn: () => garageI<Context>("whatsapp/context", { conversation_id: conv.id }) });
  const [busy, setBusy] = useState("");
  const sendLink = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    const r = await garageI("whatsapp/link", { conversation_id: conv.id, ...body });
    setBusy("");
    if (r.ok === false || r.error) { toast.error(r.error || "Not sent"); return; }
    toast.success("Link sent");
    void qc.invalidateQueries({ queryKey: ["wa-messages", conv.id] });
  };
  const prompt = async (invoiceId: string, balance: number) => {
    setBusy(`mpesa-${invoiceId}`);
    const r = await requestInvoiceMpesa(invoiceId, conv.phone, Math.floor(balance));
    setBusy("");
    if (r.error) toast.error(r.error); else toast.success("M-Pesa prompt sent to the customer's phone");
  };
  const d = ctx.data;
  return (
    <div className="hidden space-y-3 lg:block">
      <Panel title="Customer" icon={Smartphone}>
        {ctx.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : d?.customer ? (
          <div className="space-y-1 text-sm">
            <Link to={`/customers/${d.customer.id}`} className="font-semibold text-primary hover:underline">{d.customer.name}</Link>
            <p className="text-muted-foreground">{d.customer.phone}</p>
            {d.customer.email && <p className="text-muted-foreground">{d.customer.email}</p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">No customer has this number yet.</p>}
      </Panel>
      <Panel title="Vehicles" icon={Car}>
        {(d?.vehicles || []).length === 0 ? <p className="text-sm text-muted-foreground">No vehicles on record.</p> : (
          <ul className="space-y-1.5 text-sm">{d!.vehicles.map((v, i) => (
            <li key={v.id || i}><b>{v.registration || v.reg_no || "Vehicle"}</b> <span className="text-muted-foreground">{[v.make, v.model, v.year].filter(Boolean).join(" ")}</span></li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="Open jobs" icon={Wrench}>
        {(d?.jobs || []).length === 0 ? <p className="text-sm text-muted-foreground">No open jobs.</p> : (
          <ul className="space-y-2 text-sm">{d!.jobs.map((j, i) => (
            <li key={j.id || i} className="space-y-1">
              <div className="flex items-center justify-between gap-2"><b>{j.number || j.job_number || j.title || "Job"}</b>{j.status && <Pill tone="info">{j.status}</Pill>}</div>
              {j.vehicle && <p className="text-xs text-muted-foreground">{j.vehicle}</p>}
              <div className="flex flex-wrap gap-1.5">
                {j.estimate_url && <button type="button" disabled={!!busy} onClick={() => void sendLink({ kind: "estimate", url: j.estimate_url }, `e${i}`)} className="rounded-lg border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted">Send estimate</button>}
                {j.tracking_url && <button type="button" disabled={!!busy} onClick={() => void sendLink({ kind: "tracking", url: j.tracking_url }, `t${i}`)} className="rounded-lg border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted">Send tracking link</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="Unpaid invoices" icon={FileText}>
        {(d?.invoices || []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing owed.</p> : (
          <ul className="space-y-2 text-sm">{d!.invoices.map((inv) => (
            <li key={inv.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2"><Link to={`/sales/invoices/${inv.id}`} className="font-semibold text-primary hover:underline">{inv.invoice_number}</Link><span className="tabular-nums">KES {Number(inv.balance).toLocaleString("en-KE")}</span></div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => void sendLink({ kind: "invoice", id: inv.id }, `i${inv.id}`)} className="rounded-lg border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted">{busy === `i${inv.id}` ? "Sending…" : "Send pay link"}</button>
                <button type="button" disabled={!!busy} onClick={() => void prompt(inv.id, inv.balance)} className="rounded-lg border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted">{busy === `mpesa-${inv.id}` ? "Sending…" : "M-Pesa prompt"}</button>
              </div>
            </li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}

function NewChat({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const r = await garageI("whatsapp/send", { phone, text });
    setBusy(false);
    if (r.ok === false || r.error) { toast.error(r.error || "Not sent"); return; }
    setPhone(""); setText("");
    toast.success("Message sent");
    onStarted();
  };
  return (
    <Modal open={open} onClose={onClose} title="New WhatsApp chat" description="A customer who has not written in the last 24 hours gets your approved template." size="md"
      footer={<button type="button" disabled={!phone.trim() || !text.trim() || busy} onClick={() => void start()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Sending…" : "Send"}</button>}>
      <div className="space-y-3">
        <Field label="Phone number"><input className="fi" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter the customer's WhatsApp number" /></Field>
        <Field label="Message"><textarea className="fi" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter your message" /></Field>
      </div>
    </Modal>
  );
}

