import { useEffect, useMemo, useState } from "react";
import { X, Printer, Mail, MessageCircle, MessageSquare } from "lucide-react";
import { openWhatsApp, openSms, looksLikePhone } from "@/lib/shareMessage";
import { useMessagingSettings, smsReady, whatsappReady, sendShopMessage } from "@/lib/messaging";
import { formatKES, formatDate, formatTime } from "@/lib/format";
import { useBusinessSettings, useCustomers } from "@/hooks/useData";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";
import { sendReceiptEmail } from "@/lib/platformEmail";
import { receiptDocumentHtml, receiptTemplateId } from "@/lib/receiptTemplates";
import { OrbSpinner } from "@/components/orbs";


interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  vat_rate: number;
}

interface ReceiptData {
  customer_id?: string | null;
  id: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  customer_name: string;
  cashier_name: string;
  created_at: string;
  mpesa_ref?: string | null;
  loyalty_points_earned?: number;
  customer_phone?: string;
  customer_email?: string;
  cash_tendered?: number;
  change_given?: number;
}

interface Props {
  receipt: ReceiptData;
  onClose: () => void;
}

export default function ReceiptModal({ receipt, onClose }: Props) {
  const date = new Date(receipt.created_at);
  const { data: bizSettings } = useBusinessSettings();
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { vatEnabled } = useVatEnabled();
  const { has } = useTenantFeatures();
  // Channel availability — hide buttons when the feature is disabled OR
  // the tenant has no credentials configured.
  // Channel availability — only Email + Print are exposed in the receipt UI.
  const emailEnabled = has("smtp_email") && has("communication");

  const [showEmail, setShowEmail] = useState(false);
  const [emailAddr, setEmailAddr] = useState(receipt.customer_email || "");
  const [emailSending, setEmailSending] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [phoneTo, setPhoneTo] = useState<string>(() => String(receipt.customer_phone || ""));
  const { data: customers } = useCustomers();
  const customerPhone = useMemo(() => {
    const list = (customers as any[] | undefined) || [];
    const c = list.find((x: any) => x.id === receipt.customer_id);
    return c?.phone || receipt.customer_phone || "";
  }, [customers, receipt.customer_id, receipt.customer_phone]);
  const recentEmails = useMemo(() => {
    const list = (customers as any[] | undefined) || [];
    return list
      .filter((c) => c.email && String(c.email).includes("@"))
      .slice(0, 8)
      .map((c) => ({ name: c.name as string, email: String(c.email) }));
  }, [customers]);

  const businessName =
    (bizSettings as any)?.business_name ||
    (tenant as any)?.business_name ||
    (tenant as any)?.name ||
    "JMSURF Garage";
  const receiptHeader = (bizSettings as any)?.receipt_header || "Point of Sale System";
  const receiptFooter = (bizSettings as any)?.receipt_footer || "Thank you for shopping with us!";
  // Optional terms and conditions printed under the footer; empty = not printed.
  const receiptTerms = String((bizSettings as any)?.receipt_terms || "").trim();
  const receiptTemplate = receiptTemplateId((bizSettings as any)?.receipt_template);
  // Header lines that are only a short bare number (e.g. a stray "17959") are noise on
  // the printed receipt, so they are dropped. Phone numbers like "0712 345 678"
  // are longer and must be kept.
  const cleanMeta = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const digitsOnly = s.replace(/[\s\-_.#()+]/g, "");
    if (/^[0-9]+$/.test(digitsOnly) && digitsOnly.length < 9) return "";
    return s;
  };
  const businessPhone = cleanMeta((bizSettings as any)?.business_phone);
  const businessAddress = cleanMeta((bizSettings as any)?.business_address);
  const isAfterHours = `${businessName} ${(tenant as any)?.slug || ""}`
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .includes("afterhours");
  // Pay-to line printed right under the shop name (e.g. "Paybill: 400200, Acc: 1205565").
  const payShortcode = (bizSettings as any)?.mpesa_shortcode || "";
  const payAccount = (bizSettings as any)?.mpesa_account_reference || "";
  const payLine = payShortcode
    ? `Paybill: ${payShortcode}${payAccount ? `, Acc: ${payAccount}` : ""}`
    : isAfterHours
      ? "Paybill: 400200, Acc: 1205565"
      : "";

  const buildPrintHtml = () => receiptDocumentHtml({
    businessName,
    payLine,
    address: businessAddress,
    phone: businessPhone,
    logoUrl: (tenant as any)?.logo_url || null,
    date: formatDate(date),
    time: formatTime(date),
    cashier: receipt.cashier_name,
    customer: receipt.customer_name,
    receiptNo: receipt.id.slice(0, 8).toUpperCase(),
    items: receipt.items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price, wholesale: i.price_mode === "wholesale" })),
    subtotal: formatKES(receipt.subtotal),
    vat: vatEnabled && receipt.tax > 0 ? formatKES(receipt.tax) : null,
    discount: receipt.discount > 0 ? formatKES(receipt.discount) : null,
    total: formatKES(receipt.total),
    payment: receipt.payment_method,
    mpesaRef: receipt.mpesa_ref || null,
    tendered: receipt.cash_tendered != null && receipt.cash_tendered > 0 ? formatKES(receipt.cash_tendered) : null,
    change: formatKES(receipt.change_given || 0),
    footer: receiptFooter,
    terms: receiptTerms,
    money: formatKES,
  }, receiptTemplate);

  // Printing happens through a hidden iframe: it is never blocked by pop-up
  // blockers and hands the receipt straight to whichever printer (including a
  // thermal 80mm printer) the machine has connected.
  const handlePrint = () => {
    const html = buildPrintHtml();

    try {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      frame.style.visibility = "hidden";
      document.body.appendChild(frame);

      const cleanup = () => {
        setTimeout(() => {
          try { document.body.removeChild(frame); } catch { /* noop */ }
        }, 1000);
      };

      // Once the receipt has gone to the printer the window closes by itself.
      let closed = false;
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        setTimeout(() => onClose(), 300);
      };

      frame.onload = () => {
        const fw = frame.contentWindow;
        if (!fw) { cleanup(); return; }
        const fire = () => {
          try {
            fw.addEventListener("afterprint", closeOnce);
            fw.focus();
            fw.print();
            closeOnce();
          } catch {
            toast({
              title: "Printer error",
              description: "Could not start the printer. Use your browser print menu (Ctrl+P).",
              variant: "destructive",
            });
          }
          cleanup();
        };
        // Give the logo image a moment to load so it is not missing on paper.
        const imgs = Array.from(fw.document.images || []);
        const pending = imgs.filter((i) => !i.complete);
        if (pending.length === 0) {
          setTimeout(fire, 100);
        } else {
          let left = pending.length;
          const done = () => { if (--left <= 0) setTimeout(fire, 100); };
          pending.forEach((i) => { i.addEventListener("load", done); i.addEventListener("error", done); });
          setTimeout(fire, 2500);
        }
      };

      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc) throw new Error("Print frame unavailable");
      doc.open();
      doc.write(html);
      doc.close();
    } catch (err: any) {
      toast({
        title: "Printer error",
        description: err?.message || "Failed to send the receipt to the printer.",
        variant: "destructive",
      });
    }
  };

  const buildReceiptText = () => {
    const lines: string[] = [];
    lines.push(`*${businessName}*`);
    if (payLine) lines.push(payLine);
    if (businessPhone) lines.push(`Tel: ${businessPhone}`);
    lines.push("─".repeat(28));
    lines.push(`Date: ${formatDate(date)}`);
    lines.push(`Time: ${formatTime(date)}`);
    lines.push(`Cashier: ${receipt.cashier_name}`);
    lines.push(`Customer: ${receipt.customer_name}`);
    lines.push(`Receipt #: ${receipt.id.slice(0, 8).toUpperCase()}`);
    lines.push("─".repeat(28));
    const hasWholesale = receipt.items.some((i: any) => i.price_mode === "wholesale");
    receipt.items.forEach((item: any) => {
      const tag = item.price_mode === "wholesale" ? " [W]" : "";
      lines.push(`${item.name}${tag}`);
      lines.push(`  ${item.quantity} × ${formatKES(item.price)} = ${formatKES(item.price * item.quantity)}`);
      const minQ = Number(item.wholesale_min_quantity || 0);
      if (item.price_mode === "wholesale" && minQ > 0) {
        lines.push(`  Wholesale min: ${minQ} units`);
        lines.push(`  Unlocked at ${minQ}+ units (this line: ${item.quantity}/${minQ})`);
      } else if (item.price_mode !== "wholesale" && minQ > 0 && Number(item.wholesale_price || 0) > 0) {
        lines.push(`  Unlock wholesale at ${minQ} units (this line: ${item.quantity}/${minQ})`);
      }
    });
    if (hasWholesale) {
      lines.push("[W] = Wholesale price (min qty applies)");
    }
    lines.push("─".repeat(28));
    lines.push(`Subtotal: ${formatKES(receipt.subtotal)}`);
    if (vatEnabled && receipt.tax > 0) lines.push(`VAT (incl.): ${formatKES(receipt.tax)}`);
    if (receipt.discount > 0) lines.push(`Discount: -${formatKES(receipt.discount)}`);
    lines.push("─".repeat(28));
    lines.push(`*TOTAL: ${formatKES(receipt.total)}*`);
    lines.push(`Payment: ${receipt.payment_method.toUpperCase()}`);
    if (receipt.mpesa_ref) lines.push(`M-Pesa Ref: ${receipt.mpesa_ref}`);
    if (receipt.cash_tendered && receipt.cash_tendered > 0) {
      lines.push(`Cash Tendered: ${formatKES(receipt.cash_tendered)}`);
      lines.push(`Change: ${formatKES(receipt.change_given || 0)}`);
    }
    if (receipt.loyalty_points_earned && receipt.loyalty_points_earned > 0) {
      lines.push(`⭐ You earned ${receipt.loyalty_points_earned} loyalty points!`);
    }
    lines.push("─".repeat(28));
    lines.push(receiptFooter);
    if (receiptTerms) {
      lines.push("");
      lines.push("Terms & Conditions:");
      lines.push(receiptTerms);
    }

    return lines.join("\n");
  };

  // Short version for SMS so a receipt costs one or two SMS parts, not ten.
  const buildSmsText = () => {
    const count = receipt.items.reduce((n, i) => n + Number(i.quantity || 0), 0);
    return [
      `${businessName}: receipt ${receipt.id.slice(0, 8).toUpperCase()}`,
      `${count} item${count === 1 ? "" : "s"}, total ${formatKES(receipt.total)} (${String(receipt.payment_method).toUpperCase()}${receipt.mpesa_ref ? " " + receipt.mpesa_ref : ""})`,
      `${formatDate(date)} ${formatTime(date)}. Thank you!`,
    ].join("\n");
  };

  const { data: messaging } = useMessagingSettings();
  const [sendingVia, setSendingVia] = useState<"" | "sms" | "whatsapp">("");
  const sendPhone = async (channel: "sms" | "whatsapp", to = phoneTo, quiet = false) => {
    const ready = channel === "sms" ? smsReady(messaging) : whatsappReady(messaging);
    if (!ready) {
      if (channel === "sms") openSms(to, buildReceiptText().replace(/\*/g, ""));
      else openWhatsApp(to, buildReceiptText());
      return;
    }
    setSendingVia(channel);
    const r = await sendShopMessage(channel, to, channel === "sms" ? buildSmsText() : buildReceiptText(), receipt.id);
    setSendingVia("");
    if (r?.ok) toast({ title: channel === "sms" ? "Receipt sent by SMS" : "Receipt sent on WhatsApp", description: `To ${r.to}` });
    else if (!quiet || r?.error) toast({ title: channel === "sms" ? "SMS not sent" : "WhatsApp not sent", description: r?.error || "Try again", variant: "destructive" });
  };

  // Automatic receipts: once per new sale, when the shop has switched it on.
  useEffect(() => {
    if (!messaging || !customerPhone || !looksLikePhone(customerPhone)) return;
    if (Date.now() - new Date(receipt.created_at).getTime() > 3 * 60_000) return;
    const wantWa = messaging.auto_receipt_whatsapp && whatsappReady(messaging);
    const wantSms = messaging.auto_receipt_sms && smsReady(messaging);
    if (!wantWa && !wantSms) return;
    const key = `auto-receipt:${receipt.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* still send once for this window */ }
    void sendPhone(wantWa ? "whatsapp" : "sms", customerPhone, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messaging, customerPhone, receipt.id]);

  const handleEmail = async () => {
    if (!emailAddr.trim() || !emailAddr.includes("@")) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setEmailSending(true);
    try {
      const receiptBody = {
        ...receipt,
        business_name: businessName,
        business_phone: businessPhone,
        receipt_footer: receiptFooter,
        vat_enabled: vatEnabled,
      };

      // Sent by the mail service inside the app, using the saved mail server.
      let payload: any = await sendReceiptEmail({
        email: emailAddr,
        shopName: businessName,
        receipt: receiptBody,
      });

      if (payload?.unavailable) {
        const { data, error } = await supabase.functions.invoke("send-receipt-email", {
          body: { email: emailAddr, tenant_id: tenant?.id || null, receipt: receiptBody },
        });
        payload = error ? { ok: false, error: error.message } : { ok: data?.success !== false, error: data?.error };
      }

      if (!payload?.ok) {
        toast({
          title: "Email failed",
          description: payload?.error || "Check the mail settings in the admin portal.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Receipt sent!", description: `Emailed to ${emailAddr}` });
        setShowEmail(false);
      }

    } catch (e: any) {
      toast({ title: "Email failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display font-bold">Receipt</h2>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="p-2 rounded-lg hover:bg-muted" title="Print receipt"><Printer className="w-4 h-4" /></button>
            <button onClick={() => { setShowPhone((v) => !v); setShowEmail(false); if (!phoneTo && customerPhone) setPhoneTo(customerPhone); }} className="p-2 rounded-lg hover:bg-muted text-success" title="Send by WhatsApp or SMS"><MessageCircle className="w-4 h-4" /></button>
            {emailEnabled && (
              <button onClick={() => { setShowEmail((v) => !v); setShowPhone(false); }} className="p-2 rounded-lg hover:bg-muted text-primary" title="Send via Email"><Mail className="w-4 h-4" /></button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* WhatsApp / SMS bar */}
        {showPhone && (
          <div className="space-y-2 border-b border-success/20 bg-success/5 px-4 py-3">
            <p className="text-xs font-medium text-success">Send the receipt to the customer's phone</p>
            <div className="flex flex-wrap gap-2">
              <input value={phoneTo} onChange={(e) => setPhoneTo(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX or +234…"
                className="fi h-9 min-w-[160px] flex-1" />
              <button disabled={!looksLikePhone(phoneTo)} onClick={() => sendPhone("whatsapp")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 text-xs font-semibold text-white disabled:opacity-40">
                {sendingVia === "whatsapp" ? <OrbSpinner className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />} WhatsApp
              </button>
              <button disabled={!looksLikePhone(phoneTo)} onClick={() => sendPhone("sms")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold disabled:opacity-40">
                {sendingVia === "sms" ? <OrbSpinner className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />} SMS
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {smsReady(messaging) || whatsappReady(messaging)
                ? "Sent straight to the customer from your company's messaging account."
                : "Opens WhatsApp or your messages app with the receipt written — just press send."}
            </p>
          </div>
        )}

        {/* Email send bar */}
        {showEmail && (
          <div className="px-4 py-3 bg-primary/5 border-b border-primary/20 space-y-2">
            <p className="text-xs font-medium text-primary">Send receipt via Email</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailAddr}
                onChange={(e) => setEmailAddr(e.target.value)}
                placeholder="Enter email address"
                className="flex-1 px-3 py-2 rounded-lg bg-card border border-input text-sm"
              />
              <button
                onClick={handleEmail}
                disabled={emailSending || !emailAddr.trim()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
              >
                {emailSending ? <OrbSpinner className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                Send
              </button>
            </div>
            {recentEmails.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                <span className="text-[10px] text-muted-foreground self-center">Recent:</span>
                {recentEmails.map((c) => (
                  <button key={c.email} onClick={() => setEmailAddr(c.email)} title={c.name}
                    className="px-2 py-1 rounded-md bg-card border border-border text-[10px] hover:bg-muted">
                    {c.name.split(" ")[0]} · {c.email}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Receipt content */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {/* Two-column on-screen preview */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            {/* LEFT: Items */}
            <div className="sm:col-span-3 space-y-3">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-display font-bold text-base leading-tight">{businessName}</div>
                  {payLine && <div className="text-[11px] font-semibold">{payLine}</div>}
                  {businessAddress && <div className="text-[11px] text-muted-foreground">{businessAddress}</div>}
                  {businessPhone && <div className="text-[11px] text-muted-foreground">Tel: {businessPhone}</div>}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-2">
                <span>Receipt #</span><span className="text-right font-mono text-foreground">{receipt.id.slice(0,8).toUpperCase()}</span>
                <span>Date</span><span className="text-right text-foreground">{formatDate(date)} {formatTime(date)}</span>
                <span>Cashier</span><span className="text-right text-foreground truncate">{receipt.cashier_name}</span>
                <span>Customer</span><span className="text-right text-foreground truncate">{receipt.customer_name}</span>
              </div>
              <div className="border-t border-dashed" />
              <div className="space-y-1.5">
                {receipt.items.map((item: any, i: number) => (
                  <div key={i} className="text-xs">
                    <div className="flex justify-between font-normal gap-2">
                      <span className="truncate">{item.name}{item.price_mode === "wholesale" && <span className="ml-1 text-[9px] text-muted-foreground">[W]</span>}</span>
                      <span className="tabular-nums">{formatKES(item.price * item.quantity)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{item.quantity} × {formatKES(item.price)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT: Totals + payment + refund */}
            <div className="sm:col-span-2 space-y-3">
              <div className="rounded-xl bg-muted/50 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatKES(receipt.subtotal)}</span></div>
                {vatEnabled && receipt.tax > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">VAT (incl.)</span><span className="tabular-nums">{formatKES(receipt.tax)}</span></div>
                )}
                {receipt.discount > 0 && (
                  <div className="flex justify-between text-success"><span>Discount</span><span className="tabular-nums">-{formatKES(receipt.discount)}</span></div>
                )}
                <div className="flex justify-between pt-2 border-t font-display font-bold text-base">
                  <span>TOTAL</span><span className="tabular-nums">{formatKES(receipt.total)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-border p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="uppercase font-medium">{receipt.payment_method}</span></div>
                {receipt.mpesa_ref && (
                  <div className="flex justify-between"><span className="text-muted-foreground">M-Pesa Ref</span><span className="font-mono">{receipt.mpesa_ref}</span></div>
                )}
                {receipt.cash_tendered != null && receipt.cash_tendered > 0 && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tendered</span><span className="tabular-nums">{formatKES(receipt.cash_tendered)}</span></div>
                    <div className="flex justify-between text-success font-bold"><span>Change</span><span className="tabular-nums">{formatKES(receipt.change_given || 0)}</span></div>
                  </>
                )}
              </div>

              {receipt.loyalty_points_earned != null && receipt.loyalty_points_earned > 0 && (
                <div className="rounded-xl bg-success/10 text-success text-center text-xs py-2 font-medium">
                  ⭐ +{receipt.loyalty_points_earned} loyalty points
                </div>
              )}
            </div>
          </div>

          {receiptTerms && (
            <div className="mt-4 rounded-xl border border-border p-3 text-[11px] text-muted-foreground">
              <div className="mb-1 font-semibold text-foreground">Terms &amp; conditions</div>
              <p className="whitespace-pre-line">{receiptTerms}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-4">
            <button
              onClick={() => { setShowPhone(true); setShowEmail(false); if (!phoneTo && customerPhone) setPhoneTo(customerPhone); }}
              className="py-3 rounded-xl bg-[#25D366] text-white font-medium text-xs hover:opacity-90 flex items-center justify-center gap-1"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </button>
            <button
              onClick={handlePrint}
              className="py-3 rounded-xl bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 flex items-center justify-center gap-1"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
            {emailEnabled && (
              <button
                onClick={() => setShowEmail(true)}
                className="py-3 rounded-xl bg-secondary text-secondary-foreground font-medium text-xs hover:opacity-90 flex items-center justify-center gap-1 border border-border"
              >
                <Mail className="w-4 h-4" /> Email
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
