import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Send, Mic, MicOff, Volume2, VolumeX, X, Check, Loader2, Maximize2, Trash2, Paperclip, AudioLines } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useModules } from "@/hooks/useModules";
import { useTenantId } from "@/hooks/useTenantId";
import { saveRecord } from "@/apps/data";
import { findKind } from "@/apps/registry";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HELP_TOPICS, type HelpArticle } from "@/lib/helpContent";

const sb = supabase as any;

interface Action { id: string; type: string; input: any; summary: string; state?: "pending" | "done" | "cancelled" | "running" }
interface Msg { role: "user" | "assistant"; content: string; actions?: Action[]; error?: boolean; help?: HelpArticle[]; free?: boolean }

const STOP = new Set("a an and are as at be by can do does for from how i in is it me my of on or our please show tell the this to we what when where which who why with you your dash ai".split(" "));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, ""));
/** Help centre articles that best match a question (free mode, for "how do I…" questions). */
function helpFor(question: string): HelpArticle[] {
  const want = new Set(words(question));
  if (!want.size) return [];
  return HELP_TOPICS.flatMap((t) => t.articles)
    .map((a) => {
      const inQ = new Set(words(a.q)), inA = new Set(words(a.a.join(" ")));
      let score = 0;
      want.forEach((w) => { if (inQ.has(w)) score += 3; else if (inA.has(w)) score += 1; });
      return { a, score };
    })
    .filter((x) => x.score >= 3)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.a);
}

const KEY = (t: string | null) => `dashai.chat.${t || "x"}`;
const SUGGESTIONS = [
  "How is the business doing this month?",
  "Create a purchase order for 20 cartons of gloves from Medisel at 1,200 each and receive them",
  "Which customers owe us the most?",
  "What is running low in stock?",
  "Show my best-selling items this year",
  "Draft reminders for overdue invoices",
];

type Attachment = { name: string; type: string; data: string };
const readFile = (f: File) => new Promise<Attachment>((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok({ name: f.name, type: f.type, data: String(r.result).split(",")[1] || "" });
  r.onerror = bad; r.readAsDataURL(f);
});

async function api(messages: Msg[], attachments: Attachment[] = [], voice = false) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ messages: messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })), attachments, voice }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || (res.status === 429 ? "Garage AI is busy right now. Try again in a moment." : "Garage AI could not answer just now. Please try again in a moment."));
  return j as { reply: string; actions: Action[]; used: string[]; mode?: "free"; matched?: boolean };
}

/* ---------------------------------------------------- actions (user-confirmed) */

async function findCustomer(name: string) {
  const { data } = await sb.from("customers").select("id,name,phone,email").ilike("name", `%${name}%`).limit(1);
  return data?.[0] || null;
}

async function runAction(a: Action, tenantId: string, nav: (p: string) => void): Promise<string> {
  const i = a.input || {};
  switch (a.type) {
    case "create_customer": {
      const { data, error } = await sb.from("customers").insert({ tenant_id: tenantId, name: i.name, phone: i.phone || "", email: i.email || null, company_name: i.company_name || null }).select("id").single();
      if (error) throw error;
      return `Customer ${i.name} added`;
    }
    case "create_invoice": {
      let c = await findCustomer(i.customer_name);
      if (!c) { const r = await sb.from("customers").insert({ tenant_id: tenantId, name: i.customer_name, phone: "" }).select("id,name,phone,email").single(); if (r.error) throw r.error; c = r.data; }
      const items = [];
      let subtotal = 0, tax = 0;
      for (const it of i.items || []) {
        const { data: p } = await sb.from("products").select("id,name").ilike("name", it.name).limit(1);
        const amount = Number(it.quantity) * Number(it.rate);
        const t = amount * (Number(it.tax_rate || 0) / 100);
        subtotal += amount; tax += t;
        items.push({ name: p?.[0]?.name || it.name, item_id: p?.[0]?.id || null, quantity: Number(it.quantity), rate: Number(it.rate), price: Number(it.rate), amount, discount: 0, tax_rate: Number(it.tax_rate || 0) });
      }
      const { data: no } = await sb.rpc("next_doc_number", { p_kind: "invoice" });
      const due = new Date(Date.now() + (Number(i.due_in_days) || 14) * 86400000).toISOString().slice(0, 10);
      const { data, error } = await sb.from("invoices").insert({ tenant_id: tenantId, invoice_number: no, customer_id: c.id, customer_name: c.name, customer_phone: c.phone || null, customer_email: c.email || null, items, subtotal, tax, discount: 0, total: subtotal + tax, status: "draft", issue_date: new Date().toISOString().slice(0, 10), due_date: due, notes: i.notes || null, source: "dash_ai" }).select("id").single();
      if (error) throw error;
      nav(`/sales/invoices/${data.id}`);
      return `Draft invoice ${no} created`;
    }
    case "payment_reminders": {
      const ids: string[] = [];
      for (const n of i.customer_names || []) { const c = await findCustomer(n); if (c) ids.push(c.id); }
      if (!ids.length) throw new Error("None of those customers were found");
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/erp/remind-payment", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ customer_ids: ids, message: i.message || undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Reminders not sent");
      return `Reminders sent: ${j.sms || 0} SMS, ${j.email || 0} email${j.failed?.length ? ` (${j.failed.length} failed)` : ""}`;
    }
    case "task": {
      const kind = findKind("projects", "task")!;
      let parent: string | null = null;
      if (i.project) { const { data } = await sb.from("app_records").select("id").eq("app", "projects").eq("kind", "project").ilike("title", `%${i.project}%`).limit(1); parent = data?.[0]?.id || null; }
      const r = await saveRecord("projects", kind, { title: i.title, parent_id: parent, due_date: i.due_date || null, description: i.description || "" });
      return `Task ${r.number || ""} created`;
    }
    case "lead": {
      const { error } = await sb.from("crm_leads").insert({ tenant_id: tenantId, type: "lead", name: i.name, contact_name: i.contact_name || null, phone: i.phone || null, email: i.email || null, expected_revenue: i.expected_revenue || null, description: i.notes || null, source: "Garage AI", active: true });
      if (error) throw error;
      return `Lead ${i.name} added`;
    }
    case "expense": {
      const { data: cat } = await sb.from("expense_categories").select("id,name").ilike("name", i.category || "").limit(1);
      const { error } = await sb.from("expenses").insert({ tenant_id: tenantId, category_id: cat?.[0]?.id || null, category_name: cat?.[0]?.name || i.category, amount: Number(i.amount), expense_date: i.date || new Date().toISOString().slice(0, 10), vendor_name: i.vendor || null, description: i.description || null, paid_through: i.paid_through || "Cash", payment_method: /mpesa|m-pesa/i.test(i.paid_through || "") ? "mpesa" : /bank/i.test(i.paid_through || "") ? "bank" : "cash", approval_status: "approved" });
      if (error) throw error;
      return `Expense of ${Number(i.amount).toLocaleString()} recorded`;
    }
    case "purchase_order": {
      let { data: sup } = await sb.from("suppliers").select("id,name").ilike("name", `%${i.supplier_name}%`).limit(1);
      let supplier = sup?.[0];
      if (!supplier) { const r = await sb.from("suppliers").insert({ tenant_id: tenantId, name: i.supplier_name, is_active: true, onboarding_status: "active" }).select("id,name").single(); if (r.error) throw r.error; supplier = r.data; }
      const lines: { product_id: string; quantity: number; unit_cost: number; total: number }[] = [];
      for (const it of i.items || []) {
        let { data: p } = await sb.from("products").select("id").ilike("name", it.name).limit(1);
        let pid = p?.[0]?.id;
        if (!pid) { const r = await sb.from("products").insert({ tenant_id: tenantId, name: it.name, sku: `AI-${Date.now().toString(36).toUpperCase()}${lines.length}`, category: "General", price: 0, cost_price: Number(it.unit_cost) || 0 }).select("id").single(); if (r.error) throw r.error; pid = r.data.id; }
        const qty = Math.max(1, Math.round(Number(it.quantity) || 1)), cost = Number(it.unit_cost) || 0;
        lines.push({ product_id: pid, quantity: qty, unit_cost: cost, total: Math.round(qty * cost * 100) / 100 });
      }
      const total = lines.reduce((a, l) => a + l.total, 0);
      const { data: no } = await sb.rpc("next_doc_number", { p_kind: "po" });
      const po = await sb.from("purchases").insert({ tenant_id: tenantId, po_number: no, supplier_id: supplier.id, supplier_name: supplier.name, order_date: new Date().toISOString().slice(0, 10), expected_date: i.expected_date || null, reference: i.reference || null, subtotal: total, tax: 0, total, status: "pending", notes: "Created by Garage AI" }).select("id").single();
      if (po.error) throw po.error;
      const ins = await sb.from("purchase_items").insert(lines.map((l) => ({ ...l, purchase_id: po.data.id })));
      if (ins.error) throw ins.error;
      if (i.receive_now) {
        const { data: items } = await sb.from("purchase_items").select("id,quantity").eq("purchase_id", po.data.id);
        const r = await sb.rpc("receive_purchase", { p_purchase: po.data.id, p_lines: (items || []).map((x: any) => ({ item_id: x.id, quantity: x.quantity })), p_update_cost: true });
        if (r.error) throw r.error;
      }
      nav(`/purchases/orders/${po.data.id}`);
      return `Purchase order ${no} created${i.receive_now ? " and the goods received into stock" : ""}`;
    }
    case "receive_purchase_order": {
      const { data: po } = await sb.from("purchases").select("id,po_number,purchase_items(id,quantity,received_quantity,cancelled_quantity)").eq("po_number", i.po_number).limit(1).maybeSingle();
      if (!po) throw new Error(`Purchase order ${i.po_number} was not found`);
      const lines = (po.purchase_items || []).map((x: any) => ({ item_id: x.id, quantity: Math.max(0, Number(x.quantity) - Number(x.received_quantity) - Number(x.cancelled_quantity || 0)) })).filter((x: any) => x.quantity > 0);
      if (!lines.length) throw new Error(`Everything on ${po.po_number} has already been received`);
      const r = await sb.rpc("receive_purchase", { p_purchase: po.id, p_lines: lines, p_update_cost: true });
      if (r.error) throw r.error;
      nav(`/purchases/orders/${po.id}`);
      return `Goods on ${po.po_number} received into stock`;
    }
    case "bill": {
      let { data: sup } = await sb.from("suppliers").select("id,name").ilike("name", `%${i.supplier_name}%`).limit(1);
      let supplier = sup?.[0];
      if (!supplier) { const r = await sb.from("suppliers").insert({ tenant_id: tenantId, name: i.supplier_name, kra_pin: i.supplier_pin || null, is_active: true, onboarding_status: "active" }).select("id,name").single(); if (r.error) throw r.error; supplier = r.data; }
      const items = (i.items || []).map((it: any) => { const q = Number(it.quantity) || 1, rt = Number(it.rate) || 0; return { item_id: null, type: "product", name: it.name, description: "", quantity: q, rate: rt, price: rt, discount: 0, tax_rate: Number(it.tax_rate || 0), amount: Math.round(q * rt * 100) / 100 }; });
      const subtotal = items.reduce((a: number, x: any) => a + x.amount, 0);
      const tax = items.reduce((a: number, x: any) => a + x.amount * x.tax_rate / 100, 0);
      const { data: no } = await sb.rpc("next_doc_number", { p_kind: "bill" });
      const today = new Date().toISOString().slice(0, 10);
      const b = await sb.from("bills").insert({ tenant_id: tenantId, name: `${supplier.name} · ${no}`, bill_number: no, category: "Purchases", supplier_id: supplier.id, bill_date: i.bill_date || today, due_date: i.due_date || i.bill_date || today, reference: i.reference || null, items, subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, amount: Math.round((subtotal + tax) * 100) / 100, status: "draft", notes: "Created by Garage AI" }).select("id").single();
      if (b.error) throw b.error;
      nav(`/purchases/bills/${b.data.id}`);
      return `Draft bill ${no} created`;
    }
    default: throw new Error("Unknown action");
  }
}

/* ---------------------------------------------------- voice */

function useSpeech(onText: (t: string) => void) {
  const rec = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const Ctor = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const start = () => {
    if (!Ctor) return toast.error("Voice input is not supported in this browser. Try Chrome.");
    const r = new Ctor();
    r.lang = navigator.language || "en-KE"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => onText(String(e.results?.[0]?.[0]?.transcript || ""));
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  };
  const stop = () => { rec.current?.stop(); setListening(false); };
  return { supported: !!Ctor, listening, start, stop };
}
/** Reads text aloud; resolves when it has finished (or straight away if speech is not available). */
const speak = (text: string) => new Promise<void>((done) => {
  try {
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`|>-]/g, " ").slice(0, 900));
    u.lang = navigator.language || "en-KE";
    const voices = window.speechSynthesis.getVoices();
    const pick = voices.find((v) => v.lang === u.lang && /natural|neural|google|samantha|daniel/i.test(v.name)) || voices.find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
    if (pick) u.voice = pick;
    u.onend = () => done(); u.onerror = () => done();
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  } catch { done(); }
});

/** One spoken question: listens until the person stops talking, resolves with what they said ("" if nothing). */
function listenOnce(): Promise<string> {
  return new Promise((done) => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return done("");
    const r = new Ctor();
    let said = "";
    r.lang = navigator.language || "en-KE"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => { said = String(e.results?.[0]?.[0]?.transcript || ""); };
    r.onend = () => done(said); r.onerror = () => done(said);
    try { r.start(); } catch { done(""); }
    (listenOnce as any).current = r;
  });
}

/** Light markdown: bold, line breaks, bullet lists and simple tables. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: JSX.Element[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())));
    out.push(<div key={`t${out.length}`} className="my-2 overflow-x-auto"><table className="w-full text-xs"><tbody>{rows.map((r, i) => <tr key={i} className={i === 0 ? "font-semibold" : "border-t border-border/60"}>{r.map((c, j) => <td key={j} className="px-2 py-1">{c.trim()}</td>)}</tr>)}</tbody></table></div>);
    table = [];
  };
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));
  lines.forEach((l, i) => {
    if (/^\s*\|.*\|\s*$/.test(l)) { table.push(l.trim().slice(1, -1).split("|")); return; }
    flush();
    if (/^\s*[-*•]\s+/.test(l)) out.push(<li key={i} className="ml-4 list-disc">{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>);
    else if (/^#+\s/.test(l)) out.push(<p key={i} className="mt-1 font-semibold">{inline(l.replace(/^#+\s/, ""))}</p>);
    else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>);
  });
  flush();
  return <div className="space-y-1">{out}</div>;
}

/* ---------------------------------------------------- chat panel */

export function DashAIChat({ full, onClose }: { full?: boolean; onClose?: () => void }) {
  const tenantId = useTenantId();
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY(tenantId)) || "[]"); } catch { return []; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const voice = useSpeech((t) => { if (t) void send(t); });
  useEffect(() => { try { sessionStorage.setItem(KEY(tenantId), JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, tenantId]);

  // Documents to send with the next question (photos or PDFs: invoices, receipts, delivery notes…).
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  const send = async (q?: string, opts: { voice?: boolean } = {}) => {
    const typed = (q ?? text).trim();
    const content = typed || (files.length ? "Please look at the attached document." : "");
    if (!content || busy) return "";
    let attachments: Attachment[] = [];
    try { attachments = await Promise.all(files.map(readFile)); } catch { toast.error("Could not read the file"); return ""; }
    const shown = files.length ? `${content}\n📎 ${files.map((f) => f.name).join(", ")}` : content;
    const next = [...msgsRef.current, { role: "user" as const, content: shown }];
    setMsgs(next); setText(""); setFiles([]); setBusy(true);
    try {
      const r = await api(next, attachments, !!opts.voice);
      // Free mode did not know the question: answer "how do I…" questions from the Help centre.
      const help = r.mode === "free" && r.matched === false ? helpFor(content) : [];
      const reply = help.length ? `Here is how, from the Help centre:` : r.reply;
      setMsgs([...next, { role: "assistant", content: reply, help, free: r.mode === "free", actions: (r.actions || []).map((a) => ({ ...a, state: "pending" })) }]);
      const spoken = help.length ? `${help[0].q} ${help[0].a[0]}` : r.reply;
      if (voiceOut && !opts.voice) void speak(spoken);
      return spoken;
    } catch (e: any) {
      setMsgs([...next, { role: "assistant", content: e.message || "Garage AI could not answer.", error: true }]);
      return e.message || "";
    } finally { setBusy(false); }
  };

  // Talk mode: hands-free conversation. Listen → answer aloud → listen again, until stopped.
  const [talk, setTalk] = useState<"off" | "listening" | "thinking" | "speaking">("off");
  const talkOn = useRef(false);
  const startTalk = async () => {
    if (!voice.supported) return toast.error("Voice needs Chrome, Edge or Safari with microphone access.");
    talkOn.current = true;
    while (talkOn.current) {
      setTalk("listening");
      const said = (await listenOnce()).trim();
      if (!talkOn.current) break;
      if (!said) continue;
      if (/^(stop|bye|goodbye|thank you|thanks|asante)\b/i.test(said)) break;
      // A spoken "yes" carries out what Garage AI just proposed (the same as pressing Confirm).
      const lastIdx = msgsRef.current.length - 1;
      const pending = (msgsRef.current[lastIdx]?.actions || []).filter((a) => a.state === "pending");
      if (pending.length && /^(yes|yeah|yep|confirm|go ahead|do it|okay|ok|sure|ndio|sawa)\b/i.test(said)) {
        setTalk("thinking");
        const done: string[] = [];
        for (const a of pending) { try { await act(lastIdx, a, true); done.push(a.summary); } catch { /* shown as a toast */ } }
        setTalk("speaking");
        await speak(done.length ? "Done." : "That did not go through. Check the screen.");
        continue;
      }
      if (pending.length && /^(no|cancel|don't|nope|hapana)\b/i.test(said)) {
        for (const a of pending) await act(lastIdx, a, false);
        setTalk("speaking"); await speak("Okay, cancelled."); continue;
      }
      setTalk("thinking");
      const reply = await send(said, { voice: true });
      if (!talkOn.current) break;
      setTalk("speaking");
      await speak(reply || "Sorry, I did not get that.");
    }
    talkOn.current = false; setTalk("off");
  };
  const stopTalk = () => { talkOn.current = false; try { (listenOnce as any).current?.stop(); window.speechSynthesis.cancel(); } catch { /* ignore */ } setTalk("off"); };
  const act = async (mi: number, a: Action, confirm: boolean) => {
    const upd = (state: Action["state"]) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, actions: x.actions?.map((y) => (y.id === a.id ? { ...y, state } : y)) } : x)));
    if (!confirm) return upd("cancelled");
    upd("running");
    try { const done = await runAction(a, tenantId!, nav); upd("done"); toast.success(done); }
    catch (e) { upd("pending"); toast.error(friendlyError(e)); }
  };

  return (
    <div className={cn("flex h-full flex-col bg-card", !full && "rounded-3xl border border-border shadow-2xl")}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#e11d2e] to-[#a8121b] text-white"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="font-display font-bold leading-tight">Garage AI</p><p className="text-[11px] text-muted-foreground">Answers from your live data · asks before acting</p></div>
        <button onClick={() => setVoiceOut((v) => !v)} className="icon-btn" title={voiceOut ? "Stop reading answers aloud" : "Read answers aloud"}>{voiceOut ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
        {msgs.length > 0 && <button onClick={() => setMsgs([])} className="icon-btn" title="New conversation"><Trash2 className="h-4 w-4" /></button>}
        {!full && <Link to="/ai" onClick={onClose} className="icon-btn" title="Open full screen"><Maximize2 className="h-4 w-4" /></Link>}
        {onClose && <button onClick={onClose} className="icon-btn" aria-label="Close"><X className="h-4 w-4" /></button>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-2 font-display text-lg font-bold">Hi, I'm Garage AI.</p>
            <p className="text-sm text-muted-foreground">Ask about sales, cash, customers, stock, staff or projects. Type, tap Talk to speak hands-free, or attach an invoice or delivery note and say what to do.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => void send(s)} className="rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary/40 hover:bg-primary/5">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : m.error ? "rounded-bl-md bg-destructive/10 text-destructive" : "rounded-bl-md bg-muted")}>
              {m.role === "assistant" ? <Rich text={m.content} /> : m.content}
              {m.help?.map((h) => (
                <div key={h.q} className="mt-2 rounded-xl border border-border bg-card p-2.5 text-foreground">
                  {h.to ? <Link to={h.to} className="text-xs font-semibold text-primary hover:underline">{h.q}</Link> : <p className="text-xs font-semibold">{h.q}</p>}
                  {h.a.map((p, k) => <p key={k} className="mt-1 text-xs text-muted-foreground">{p}</p>)}
                </div>
              ))}
              {m.help && m.help.length > 0 && <Link to="/help" className="mt-2 inline-block text-xs text-primary hover:underline">More in the Help centre</Link>}
              {m.actions?.map((a) => (
                <div key={a.id} className="mt-2 rounded-xl border border-border bg-card p-2.5 text-foreground">
                  <p className="text-xs font-semibold">{a.summary}</p>
                  {a.state === "pending" && <div className="mt-2 flex gap-2"><button onClick={() => void act(i, a, true)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><Check className="h-3.5 w-3.5" /> Confirm</button><button onClick={() => void act(i, a, false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">Cancel</button></div>}
                  {a.state === "running" && <p className="mt-1 text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Working…</p>}
                  {a.state === "done" && <p className="mt-1 text-xs text-success"><Check className="mr-1 inline h-3 w-3" />Done</p>}
                  {a.state === "cancelled" && <p className="mt-1 text-xs text-muted-foreground">Cancelled</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Garage AI is looking at your data…</div></div>}
        <div ref={end} />
      </div>
      {talk !== "off" && (
        <div className="flex flex-col items-center gap-3 border-t border-border bg-gradient-to-b from-primary/5 to-transparent px-4 py-5 text-center">
          <span className={cn("flex h-20 w-20 items-center justify-center rounded-full text-white shadow-xl", talk === "listening" ? "animate-pulse bg-gradient-to-br from-sky-500 to-violet-600" : talk === "thinking" ? "animate-spin [animation-duration:2.5s] bg-gradient-to-br from-amber-400 to-pink-500" : "bg-gradient-to-br from-emerald-400 to-teal-600")}>
            {talk === "listening" ? <Mic className="h-8 w-8" /> : talk === "thinking" ? <Sparkles className="h-8 w-8" /> : <Volume2 className="h-8 w-8" />}
          </span>
          <p className="text-sm font-semibold">{talk === "listening" ? "Listening… speak now" : talk === "thinking" ? "Thinking…" : "Speaking…"}</p>
          <p className="text-xs text-muted-foreground">Ask anything, or say "create an invoice for…". Say "stop" to end.</p>
          <button onClick={stopTalk} className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold">End conversation</button>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pt-2">
          {files.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">📎 {f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><X className="h-3 w-3" /></button></span>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2 border-t border-border p-3">
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { const add = [...(e.target.files || [])].filter((f) => f.size <= 15 * 1024 * 1024).slice(0, 3); setFiles((x) => [...x, ...add].slice(0, 3)); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border" aria-label="Attach a document" title="Attach an invoice, receipt or delivery note"><Paperclip className="h-4 w-4" /></button>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          rows={1} placeholder={files.length ? "What should I do with it? e.g. record this expense" : "Ask Garage AI anything…"} className="fi min-h-[44px] flex-1 resize-none py-2.5" />
        {voice.supported && talk === "off" && (
          <button type="button" onClick={() => void startTalk()} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 px-3 text-xs font-semibold text-white" title="Talk to Garage AI hands-free"><AudioLines className="h-4 w-4" /> Talk</button>
        )}
        {voice.supported && (
          <button type="button" onClick={voice.listening ? voice.stop : voice.start} className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border", voice.listening ? "animate-pulse border-primary bg-primary/10 text-primary" : "border-border")} aria-label="Speak">
            {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <button disabled={busy || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50" aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}

/** /ai: Garage AI full screen (or the switch-on page when the module is off). */
export default function DashAIPage() {
  const { has, ready } = useModules();
  if (!ready) return null;
  if (!has("ai")) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e11d2e] to-[#a8121b] text-white shadow-lg"><Sparkles className="h-8 w-8" /></span>
        <h1 className="mt-4 font-display text-2xl font-bold">Meet Garage AI, your AI business assistant</h1>
        <p className="mt-2 text-muted-foreground">Ask about your business by typing or speaking, and let Garage AI draft invoices, chase payments and create tasks, with your confirmation every time.</p>
        <Link to="/modules?app=ai" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Try Garage AI free for 14 days</Link>
      </div>
    );
  }
  return <div className="h-[calc(100svh-9rem)] overflow-hidden rounded-3xl border border-border"><DashAIChat full /></div>;
}
