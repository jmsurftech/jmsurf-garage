import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer, MessageCircle, MessageSquare } from "lucide-react";
import { useMessagingSettings, smsReady, whatsappReady, sendShopMessage } from "@/lib/messaging";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessSettings } from "@/hooks/useData";
import { formatKES } from "@/lib/format";
import { openWhatsApp, openSms, looksLikePhone } from "@/lib/shareMessage";
import { Modal, Field, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openDocument, businessFrom } from "@/lib/documents";
import { useTenant } from "@/hooks/useTenant";
import { OrbSpinner } from "@/components/orbs";

type Row = { at: string; label: string; ref?: string; change: number };
const sb: any = supabase;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Account statement: credit purchases, refunds to account, payments and credit given, with a running balance. */
export default function CustomerStatement({ customer, onClose }: { customer: any; onClose: () => void }) {
  const { data: biz } = useBusinessSettings();
  const [from, setFrom] = useState(format(subDays(new Date(), 89), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data, isLoading } = useQuery({
    queryKey: ["customer-ledger", customer.id, from],
    queryFn: async () => {
      const since = startOfDay(new Date(from)).toISOString();
      const [{ data: sales }, { data: pays }] = await Promise.all([
        sb.from("transactions").select("id, created_at, total, refund_of").eq("customer_id", customer.id).eq("status", "completed").eq("payment_method", "credit").gte("created_at", since).order("created_at"),
        sb.from("customer_payments").select("id, created_at, kind, amount, method, note").eq("customer_id", customer.id).gte("created_at", since).order("created_at"),
      ]);
      const rows: Row[] = [
        ...(sales || []).map((t: any) => ({
          at: t.created_at,
          label: t.refund_of ? "Refund to account" : "Purchase on account",
          ref: String(t.refund_of || t.id).slice(0, 8).toUpperCase(),
          change: Number(t.total || 0),
        })),
        ...(pays || []).map((p: any) => ({
          at: p.created_at,
          label: p.kind === "payment" ? `Payment received${p.method ? ` (${p.method})` : ""}` : "Credit given",
          ref: p.note || undefined,
          change: p.kind === "payment" ? -Number(p.amount) : Number(p.amount),
        })),
      ].sort((a, b) => +new Date(a.at) - +new Date(b.at));
      return rows;
    },
  });

  const view = useMemo(() => {
    const rows = data || [];
    const end = endOfDay(new Date(to)).getTime();
    const sinceTotal = rows.reduce((a, r) => a + r.change, 0);
    const opening = Number(customer.balance || 0) - sinceTotal;
    let running = opening;
    const inRange = rows.filter((r) => +new Date(r.at) <= end).map((r) => ({ ...r, balance: (running += r.change) }));
    const charges = inRange.filter((r) => r.change > 0).reduce((a, r) => a + r.change, 0);
    const credits = inRange.filter((r) => r.change < 0).reduce((a, r) => a - r.change, 0);
    return { opening, rows: inRange, closing: running, charges, credits };
  }, [data, to, customer.balance]);

  const shop = (biz as any)?.business_name || "Our company";
  const period = `${format(new Date(from), "d MMM yyyy")} – ${format(new Date(to), "d MMM yyyy")}`;

  const text = () => [
    `*${shop}* — account statement`,
    `${customer.name}`,
    period,
    "",
    `Opening balance: ${formatKES(view.opening)}`,
    ...view.rows.slice(-15).map((r) => `${format(new Date(r.at), "d MMM")} ${r.label}: ${r.change > 0 ? "+" : "−"}${formatKES(Math.abs(r.change))}`),
    view.rows.length > 15 ? `(${view.rows.length - 15} earlier entries not shown)` : "",
    "",
    `*Balance due: ${formatKES(view.closing)}*`,
    (biz as any)?.business_phone ? `Questions? Call ${(biz as any).business_phone}` : "",
  ].filter((l) => l !== "").join("\n");

  const { tenant } = useTenant();
  const print = () => openDocument({
    title: "Statement", number: String(customer.id).slice(0, 8).toUpperCase(), business: businessFrom(biz, tenant),
    meta: [["Period", period], ["Opening balance", formatKES(view.opening)], ["Charges", formatKES(view.charges)], ["Payments & credits", formatKES(view.credits)]],
    parties: [{ label: "Account", lines: [customer.name, customer.phone, customer.email] }],
    columns: [{ label: "Date", width: 16 }, { label: "Details", width: 36 }, { label: "Charge", align: "right", width: 16 }, { label: "Payment", align: "right", width: 16 }, { label: "Balance", align: "right", width: 16 }],
    rows: view.rows.map((r) => [format(new Date(r.at), "d MMM yyyy"), r.ref ? `${r.label} (${r.ref})` : r.label, r.change > 0 ? formatKES(r.change) : "", r.change < 0 ? formatKES(-r.change) : "", formatKES(r.balance)]),
    totals: [["Opening balance", formatKES(view.opening)], ["Charges", formatKES(view.charges)], ["Payments & credits", `− ${formatKES(view.credits)}`], ["Balance due", formatKES(view.closing), true]],
    amountInWords: Math.max(0, view.closing),
  });
  const phone = customer.phone || "";
  const { data: messaging } = useMessagingSettings();
  const { toast } = useToast();
  const [sending, setSending] = useState<"" | "sms" | "whatsapp">("");
  const send = async (channel: "sms" | "whatsapp") => {
    const ready = channel === "sms" ? smsReady(messaging) : whatsappReady(messaging);
    if (!ready) {
      if (channel === "sms") openSms(phone, text().replace(/\*/g, ""));
      else openWhatsApp(phone, text());
      return;
    }
    setSending(channel);
    // SMS gets the short version: balance and period, not every line.
    const bizPhone = (biz as any)?.business_phone;
    const smsText = `${shop}: statement for ${customer.name}, ${period}. Balance due ${formatKES(view.closing)}.${bizPhone ? ` Call ${bizPhone}` : ""}`;
    const r = await sendShopMessage(channel, phone, channel === "sms" ? smsText : text());
    setSending("");
    if (r?.ok) toast({ title: "Statement sent", description: `To ${r.to}` });
    else toast({ title: "Not sent", description: r?.error || "Try again", variant: "destructive" });
  };

  return (
    <Modal open onClose={onClose} size="xl" icon={FileText} title={`Statement — ${customer.name}`} description="Purchases on account, refunds, payments and credit given."
      footer={<>
        <Button variant="outline" disabled={!looksLikePhone(phone) || !!sending} onClick={() => send("sms")}>{sending === "sms" ? <OrbSpinner /> : <MessageSquare />} SMS</Button>
        <Button variant="outline" disabled={!looksLikePhone(phone) || !!sending} className="text-[#128C7E]" onClick={() => send("whatsapp")}>{sending === "whatsapp" ? <OrbSpinner /> : <MessageCircle />} WhatsApp</Button>
        <Button onClick={print}><Printer /> Print / PDF</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="fi" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="fi" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { l: "Opening", v: view.opening },
            { l: "Charges", v: view.charges },
            { l: "Payments & credits", v: view.credits },
            { l: "Balance due", v: view.closing, strong: true },
          ].map((b) => (
            <div key={b.l} className={cn("rounded-xl p-3", b.strong ? "bg-primary/10" : "bg-muted/60")}>
              <p className="text-[11px] text-muted-foreground">{b.l}</p>
              <p className={cn("font-display font-bold tabular-nums", b.strong ? "text-lg text-primary" : "")}>{formatKES(b.v)}</p>
            </div>
          ))}
        </div>
        {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : view.rows.length === 0 ? (
          <EmptyState icon={FileText} title="No account activity in this period" className="py-8" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="dt">
              <thead><tr><th>Date</th><th>Details</th><th className="num">Charge</th><th className="num">Payment</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {view.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-muted-foreground">{format(new Date(r.at), "d MMM yyyy")}</td>
                    <td>{r.label}{r.ref && <span className="block font-mono text-[11px] text-muted-foreground">{r.ref}</span>}</td>
                    <td className="num">{r.change > 0 ? formatKES(r.change) : ""}</td>
                    <td className="num text-success">{r.change < 0 ? formatKES(-r.change) : ""}</td>
                    <td className="num font-semibold">{formatKES(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!looksLikePhone(phone) && <p className="text-xs text-muted-foreground">Add a phone number to this customer to send the statement by WhatsApp or SMS.</p>}
      </div>
    </Modal>
  );
}
