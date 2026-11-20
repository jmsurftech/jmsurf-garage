import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { OrbSpinner } from "@/components/orbs";
import { Panel, Pill, Field, btnPrimaryCls } from "@/components/kit";

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

  const isActive = info?.provider === provider && !!linked;

  return (
    <Panel
      title={provider === "jmsurf" ? "JMSURF Pay settlement" : "PayHero settlement"}
      description="Package, domain and upgrade fees settle here."
      icon={Link2}
      actions={isActive ? <Pill tone="success"><Check className="h-3 w-3" /> In use</Pill> : undefined}
    >
      <div className="space-y-4">
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Settle to">
            <select className="fi" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="paybill">Paybill</option>
              <option value="till">Till (Buy Goods)</option>
              <option value="bank">Bank account (bank paybill)</option>
            </select>
          </Field>
          {type !== "till" && (
            <Field label={type === "bank" ? "Bank paybill number" : "Paybill number"}>
              <input className="fi font-mono" inputMode="numeric" maxLength={7} value={businessNumber}
                onChange={(e) => setBusinessNumber(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="Enter paybill number" />
            </Field>
          )}
          <Field label={type === "till" ? "Till number" : "Account number"}>
            <input className="fi font-mono" maxLength={32} value={accountNumber}
              onChange={(e) => setAccountNumber(type === "till" ? e.target.value.replace(/\D/g, "").slice(0, 7) : e.target.value.replace(/\s/g, "").slice(0, 32))}
              placeholder={type === "till" ? "Enter till number" : "Enter account number"} />
          </Field>
          <Field label="Account name">
            <input className="fi" maxLength={100} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Enter account name" />
          </Field>
        </div>
        <button type="button" onClick={save} disabled={saving} className={btnPrimaryCls}>
          {saving ? <OrbSpinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          {linked ? "Update & link" : "Save & link"}
        </button>
      </div>
    </Panel>
  );
}
