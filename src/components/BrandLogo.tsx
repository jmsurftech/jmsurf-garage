import { useState } from "react";
import { cn } from "@/lib/utils";

/** Official sites of the third parties we connect to; their icon is shown next to the name. */
export const BRAND_DOMAINS: Record<string, string> = {
  jmsurfsms: "jmsurfsms.co.ke", sendbulksms: "sendbulksms.co.ke", africastalking: "africastalking.com", twilio: "twilio.com",
  infobip: "infobip.com", advanta: "advantasms.com", celcom: "celcomafrica.com", apiwap: "apiwap.com", whatsapp: "whatsapp.com",
  mpesa: "safaricom.co.ke", daraja: "safaricom.co.ke", paystack: "paystack.com", flutterwave: "flutterwave.com", stripe: "stripe.com",
  paypal: "paypal.com", kopokopo: "kopokopo.co.ke", intasend: "intasend.com", pesapal: "pesapal.com", mtn_momo: "mtn.com",
  airtel: "airtel.africa", waafipay: "waafipay.com", chapa: "chapa.co", payhero: "payhero.co.ke", kcb: "kcbgroup.com",
  equity: "equitybank.co.ke", coop: "co-opbank.co.ke", ncba: "ncbagroup.com", r2: "cloudflare.com", aws: "aws.amazon.com",
  wasabi: "wasabi.com", b2: "backblaze.com", spaces: "digitalocean.com", google: "google.com", microsoft: "microsoft.com",
  ses: "aws.amazon.com", sendgrid: "sendgrid.com", mailgun: "mailgun.com", brevo: "brevo.com", postmark: "postmarkapp.com",
  mailjet: "mailjet.com", yahoo: "yahoo.com", odoo: "odoo.com", quickbooks: "quickbooks.intuit.com", kra: "kra.go.ke",
  zoho: "zoho.com", sage: "sage.com", xero: "xero.com", erpnext: "erpnext.com", tally: "tallysolutions.com", loyverse: "loyverse.com", excel: "microsoft365.com", cpanel: "cpanel.net", custom_s3: "aws.amazon.com", anthropic: "anthropic.com",
};

/** A provider's logo (its site icon) with a lettered fallback. */
export function BrandLogo({ id, name, className }: { id: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const domain = BRAND_DOMAINS[id];
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white", className)}>
      {domain && !failed
        ? <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" className="h-[72%] w-[72%] object-contain" loading="lazy" onError={() => setFailed(true)} />
        : <span className="font-display text-sm font-extrabold text-primary">{name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}
