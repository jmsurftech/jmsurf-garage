import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Users, Wallet, Tag, Bell, UserCheck, Clock, ClipboardPaste, MessageSquare, KeyRound, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Field, EmptyState, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { JmsurfSmsWallet, useJmsurfSmsBalance } from "@/components/JmsurfSmsWallet";
import { useSmsUses } from "@/components/SmsHub";
import { DEFAULT_LOW_BALANCE } from "@/lib/smsUses";
import { confirmAction } from "@/components/books/confirm";
import { messagingApi, smsParts } from "@/lib/messaging";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
type Recipient = { phone: string; name: string };
type Audience = "all" | "debtors" | "category" | "restock" | "rep" | "inactive" | "paste" | "picked";

const AUDIENCES: { key: Audience; label: string; hint: string; icon: any }[] = [
  { key: "all", label: "All customers", hint: "Everyone with a phone number", icon: Users },
  { key: "category", label: "Bought from a category", hint: "e.g. everyone who bought printer ink in 90 days", icon: Tag },
  { key: "debtors", label: "Customers who owe", hint: "Unpaid invoices", icon: Wallet },
  { key: "restock", label: "Restock due soon", hint: "Repurchase reminders due", icon: Bell },
  { key: "rep", label: "A sales rep's customers", hint: "Customers assigned to a rep", icon: UserCheck },
  { key: "inactive", label: "Haven't bought lately", hint: "Win back quiet customers", icon: Clock },
  { key: "paste", label: "Paste numbers", hint: "One number per line", icon: ClipboardPaste },
  { key: "picked", label: "Customers you picked", hint: "Ticked on the Customers list", icon: UserCheck },
];
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";

const TEMPLATES = [
  ["Restock", "Hi {name}, it's time to restock. Reply or order online and we'll have it ready. Thank you!"],
  ["Offer", "Hi {name}, this week only: 10% off selected items. Come by or order online!"],
  ["Payment", "Hi {name}, a friendly reminder that you have a balance with JMSURF Garage. Thank you for paying on time."],
  ["New stock", "Hi {name}, new arrivals are in. Come and see what's new!"],
];

export default function BulkSms() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const pickedIds = (params.get("customers") || "").split(",").filter(Boolean);
  const [aud, setAud] = useState<Audience>(pickedIds.length ? "picked" : "all");
  const [category, setCategory] = useState("");
  const [days, setDays] = useState(90);
  const [rep, setRep] = useState("");
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("Hi {name}, ");
  const [sendAt, setSendAt] = useState("");
  const [sending, setSending] = useState(false);
  const balance = useJmsurfSmsBalance();
  const { uses: smsUses } = useSmsUses();

  const { data: categories = [] } = useQuery({ queryKey: ["bulk-cats", tenantId], enabled: !!tenantId, queryFn: async () => ((await sb.from("product_categories").select("name").eq("tenant_id", tenantId).order("name")).data || []).map((c: any) => c.name as string) });
  const { data: reps = [] } = useQuery({ queryKey: ["bulk-reps", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("sales_reps").select("user_id,display_name").eq("tenant_id", tenantId).eq("is_active", true).order("display_name")).data || [] });

  const { data: recipients = [], isFetching } = useQuery({
    queryKey: ["bulk-audience", tenantId, aud, category, days, rep, aud === "paste" ? pasted : "", aud === "picked" ? pickedIds.join(",") : ""],
    enabled: !!tenantId && (aud !== "category" || !!category) && (aud !== "rep" || !!rep),
    queryFn: async (): Promise<Recipient[]> => {
      const customers = async (ids?: string[]) => {
        if (ids && !ids.length) return [];
        let q = sb.from("customers").select("id,name,phone").eq("tenant_id", tenantId).not("phone", "is", null).limit(20000);
        if (ids) q = q.in("id", ids.slice(0, 5000));
        return ((await q).data || []).map((c: any) => ({ phone: c.phone, name: c.name || "" }));
      };
      if (aud === "all") return customers();
      if (aud === "picked") return customers(pickedIds);
      if (aud === "rep") return ((await sb.from("customers").select("name,phone").eq("tenant_id", tenantId).eq("salesperson_id", rep).not("phone", "is", null)).data || []).map((c: any) => ({ phone: c.phone, name: c.name || "" }));
      if (aud === "debtors") return ((await sb.from("debts_view").select("customer_id,customer_name,customer_phone").eq("tenant_id", tenantId)).data || []).filter((d: any) => d.customer_phone).map((d: any) => ({ phone: d.customer_phone, name: d.customer_name || "" }));
      if (aud === "restock") {
        const r = (await sb.from("customer_reminders").select("customer_id").eq("tenant_id", tenantId).eq("status", "scheduled").lte("due_date", iso(new Date(Date.now() + days * 86400000)))).data || [];
        return customers([...new Set<string>(r.map((x: any) => x.customer_id as string))]);
      }
      if (aud === "inactive") {
        const r = (await sb.from("customer_summary").select("customer_id,last_purchase_at").eq("tenant_id", tenantId).gt("purchase_count", 0).lt("last_purchase_at", new Date(Date.now() - days * 86400000).toISOString())).data || [];
        return customers(r.map((x: any) => x.customer_id));
      }
      if (aud === "category") {
        const lines = (await sb.rpc("sales_lines", { p_from: daysAgo(days), p_to: iso(new Date()) })).data || [];
        return customers([...new Set<string>(lines.filter((l: any) => l.category === category && l.customer_id).map((l: any) => l.customer_id as string))]);
      }
      return pasted.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(.*?)[\s\t]*([+\d][\d\s-]{8,})$/);
        return m ? { name: m[1].replace(/[,;\t]+$/, "").trim(), phone: m[2].replace(/[\s-]/g, "") } : { name: "", phone: l.replace(/[\s-]/g, "") };
      });
    },
  });

  // One message per phone number.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return recipients.filter((r) => {
      const k = String(r.phone).replace(/\D/g, "").replace(/^0/, "254").slice(-9);
      if (k.length < 9 || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [recipients]);
  const sample = unique[0]?.name ? message.replace(/\{name\}/g, firstName(unique[0].name)) : message.replace(/\{name\}/g, "Customer");
  const parts = smsParts(sample);
  const needed = parts * unique.length;
  const remaining = balance.data?.ok ? Number(balance.data.sms_remaining ?? 0) : null;

  const { data: history = [] } = useQuery({
    queryKey: ["bulk-history", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("email_logs").select("id,recipient,subject,status,smtp_response,created_at").eq("tenant_id", tenantId).eq("channel", "sms").like("recipient", "% recipients").order("created_at", { ascending: false }).limit(20)).data || [],
  });

  const send = async () => {
    if (!(await confirmAction({ title: `Send to ${unique.length.toLocaleString()} people?`, message: `About ${needed.toLocaleString()} SMS will be used${sendAt ? `, sent on ${new Date(sendAt).toLocaleString("en-GB")}` : ""}.`, confirmLabel: "Send" }))) return;
    setSending(true);
    const recipientsOut = unique.map((r) => ({ phone: r.phone, name: firstName(r.name) }));
    const r: any = await messagingApi("jmsurf/bulk", { name: name || `${AUDIENCES.find((a) => a.key === aud)?.label} · ${new Date().toLocaleDateString("en-GB")}`, message, recipients: recipientsOut, send_at: sendAt ? new Date(sendAt).toISOString() : undefined });
    setSending(false);
    if (!r.ok) return toast({ title: "Not sent", description: r.error, variant: "destructive" });
    toast({ title: sendAt ? "Campaign scheduled" : "Campaign sent", description: `${Number(r.recipients ?? recipientsOut.length).toLocaleString()} recipients${r.skipped ? `, ${r.skipped} skipped` : ""}.` });
    qc.invalidateQueries({ queryKey: ["bulk-history"] });
    qc.invalidateQueries({ queryKey: ["jmsurf-sms-balance"] });
  };

  if (balance.isLoading) return <OrbLoader label="Connecting to JMSURF SMS…" />;
  if (balance.data?.needsKey) return (
    <div className="space-y-5">
      <PageHeader title="Communication" icon={MessageSquare} description="Send offers, reminders and news to your customers by SMS." />
      <EmptyState icon={KeyRound} title="Connect JMSURF SMS first" description="Save your JMSURF SMS API key once. Then send campaigns, see your balance and top up by M-Pesa right here."
        action={<Button asChild><Link to="/settings?tab=sms"><KeyRound /> System → SMS & WhatsApp</Link></Button>} />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Communication" icon={MessageSquare} description="Send offers, reminders and news to your customers by SMS (JMSURF SMS)." />
      <JmsurfSmsWallet lowAt={Number(smsUses.low_balance ?? DEFAULT_LOW_BALANCE)} />
      {smsUses.events?.bulk?.sms === false && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">Bulk SMS is switched off. Turn it on in <Link to="/settings?tab=sms" className="font-medium text-primary hover:underline">System → SMS & WhatsApp → What uses SMS</Link>.</p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="1. Who gets it" icon={Users}>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{AUDIENCES.filter((a) => a.key !== "picked" || pickedIds.length).map((a) => (
              <button key={a.key} type="button" onClick={() => setAud(a.key)} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", aud === a.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
                <a.icon className={cn("mt-0.5 h-4 w-4 shrink-0", aud === a.key ? "text-primary" : "text-muted-foreground")} />
                <span><span className="block text-sm font-semibold">{a.label}</span><span className="block text-xs text-muted-foreground">{a.hint}</span></span>
              </button>
            ))}</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {aud === "category" && <Field label="Category"><select className="fi" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>}
              {aud === "rep" && <Field label="Sales rep"><select className="fi" value={rep} onChange={(e) => setRep(e.target.value)}><option value="">Choose…</option>{reps.map((r: any) => <option key={r.user_id} value={r.user_id}>{r.display_name}</option>)}</select></Field>}
              {["category", "inactive", "restock"].includes(aud) && <Field label={aud === "category" ? "Bought in the last" : aud === "inactive" ? "No purchase for" : "Due within"}>
                <select className="fi" value={days} onChange={(e) => setDays(Number(e.target.value))}>{(aud === "restock" ? [3, 7, 14, 30] : [30, 60, 90, 180, 365]).map((d) => <option key={d} value={d}>{d} days</option>)}</select></Field>}
              {aud === "paste" && <Field label="Numbers" className="sm:col-span-2" hint="One per line. You can put a name before each number."><textarea className="fi min-h-32 font-mono text-sm" value={pasted} onChange={(e) => setPasted(e.target.value)} /></Field>}
            </div>
          </Panel>
          <Panel title="2. The message" icon={MessageSquare}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">{TEMPLATES.map(([t, m]) => <button key={t} type="button" onClick={() => setMessage(m)} className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:bg-muted">{t}</button>)}</div>
              <Field label="Message" hint={<>Write <code className="rounded bg-muted px-1">{"{name}"}</code> for the customer's first name. {message.length} characters · {parts} SMS each.</>}>
                <textarea className="fi min-h-36" maxLength={918} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campaign name (optional)"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} placeholder="October food offer" /></Field>
                <Field label="Send later (optional)"><input className="fi" type="datetime-local" value={sendAt} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setSendAt(e.target.value)} /></Field>
              </div>
            </div>
          </Panel>
        </div>
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Panel title="3. Review & send" icon={Send}>
            <div className="space-y-4">
              <div className="rounded-2xl bg-muted p-4"><p className="text-xs font-semibold text-muted-foreground">Preview</p><p className="mt-1 whitespace-pre-wrap text-sm">{sample}</p></div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">Recipients</dt><dd className="font-display text-xl font-bold">{isFetching ? <OrbSpinner className="size-5" /> : unique.length.toLocaleString()}</dd></div>
                <div><dt className="text-muted-foreground">SMS needed</dt><dd className="font-display text-xl font-bold">{needed.toLocaleString()}</dd></div>
              </dl>
              {remaining !== null && needed > remaining && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">You have {remaining.toLocaleString()} SMS. Top up to send to everyone.</p>}
              <Button className="w-full" size="lg" onClick={send} disabled={sending || !unique.length || message.trim().length < 5 || (remaining !== null && needed > remaining)}>{sending ? <OrbSpinner className="size-4" tint="#fff" /> : <Send />} {sendAt ? "Schedule" : "Send now"}</Button>
              {unique.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">See recipients</summary><ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">{unique.slice(0, 300).map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.name || "—"}</span><span className="font-mono text-xs text-muted-foreground">{r.phone}</span></li>)}</ul>{unique.length > 300 && <p className="mt-1 text-xs text-muted-foreground">and {unique.length - 300} more</p>}</details>}
            </div>
          </Panel>
        </aside>
      </div>
      <Panel flush title="Recent campaigns" icon={History}>
        {history.length === 0 ? <EmptyState icon={History} title="No campaigns yet" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Sent</th><th>Message</th><th>Audience</th><th>Status</th></tr></thead><tbody>
            <PagedRows rows={history} colSpan={4}>{(pageRows) => pageRows.map((h: any) => <tr key={h.id}><td className="whitespace-nowrap">{new Date(h.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="max-w-md truncate">{h.subject}</td><td>{h.recipient}</td><td><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", h.status === "sent" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{h.status === "sent" ? "Sent" : "Failed"}</span>{h.status !== "sent" && <span className="ml-2 text-xs text-muted-foreground">{h.smtp_response}</span>}</td></tr>)}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}
