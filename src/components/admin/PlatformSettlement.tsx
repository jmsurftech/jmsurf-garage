import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { OrbSpinner } from "@/components/orbs";

type Linked = { destination_type?: string; business_number?: string; account_number?: string; account_name?: string; linked?: boolean } | null;
type Info = { provider: string; jmsurf: Linked; payhero: Linked };

async function call(path: string, body?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: JSON.stringify(body || {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.error) throw new Error(payload?.error || `Server replied ${res.status}`);
  return payload;
}

/**
 * Where the platform's own fees (packages, domains, upgrades) settle when
 * JMSURF PAY or PayHero collects them. Saving links the account with
 * the provider and makes that gateway the active collector.
 */
export default function PlatformSettlement({ provider, onLinked }: { provider: "jmsurf" | "payhero"; onLinked?: () => void }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [type, setType] = useState<"till" | "paybill" | "bank">("paybill");
  const [businessNumber, setBusinessNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("JMSURF Technologies");
  const [saving, setSaving] = useState(false);

  const load = () => call("/api/payments/platform/billing").then((d) => setInfo(d)).catch(() => setInfo(null));
  useEffect(() => { void load(); }, []);

  const linked = info?.[provider] || null;
  useEffect(() => {
    if (!linked) return;
    setType((linked.destination_type as any) || "paybill");
    setBusinessNumber(linked.business_number || "");
    setAccountNumber(linked.account_number || "");
    setAccountName(linked.account_name || "JMSURF Technologies");
  }, [linked?.destination_type, linked?.business_number, linked?.account_number]);

  const save = async () => {
    setSaving(true);
    try {
      await call("/api/payments/platform/register", {
        provider, destination_type: type, business_number: businessNumber, account_number: accountNumber, account_name: accountName,
      });
      toast({ title: "Settlement account linked", description: `${provider === "jmsurf" ? "JMSURF Pay" : "PayHero"} now collects package fees.` });
      await load();
      onLinked?.();
    } catch (e: any) {
      toast({ title: "Could not link the account", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary";
  const isActive = info?.provider === provider && !!linked;

  return (
    <section className="bg-muted/30 border border-border rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h2 className="font-semibold text-foreground">{provider === "jmsurf" ? "JMSURF Pay settlement account" : "PayHero settlement account"}</h2>
          <p className="text-[11px] text-muted-foreground">Package, domain and upgrade fees paid by companies settle here automatically.</p>
        </div>
        {isActive && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-300">
            <Check className="w-3 h-3" /> In use
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Settle to</label>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="paybill">Paybill</option>
            <option value="till">Till (Buy Goods)</option>
            <option value="bank">Bank account (bank paybill)</option>
          </select>
        </div>
        {type !== "till" && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{type === "bank" ? "Bank paybill number" : "Paybill number"}</label>
            <input className={`${input} font-mono`} inputMode="numeric" maxLength={7} value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="e.g. 4022819" />
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">{type === "till" ? "Till number" : "Account number"}</label>
          <input className={`${input} font-mono`} maxLength={32} value={accountNumber}
            onChange={(e) => setAccountNumber(type === "till" ? e.target.value.replace(/\D/g, "").slice(0, 7) : e.target.value.replace(/\s/g, "").slice(0, 32))}
            placeholder={type === "till" ? "e.g. 4579120" : "e.g. JMSURF or 1280006242"} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Account name</label>
          <input className={input} maxLength={100} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
      </div>
      <button onClick={save} disabled={saving}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium disabled:opacity-60">
        {saving ? <OrbSpinner className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
        {linked ? "Update & link" : "Save & link"}
      </button>
    </section>
  );
}
