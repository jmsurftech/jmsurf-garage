import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Power, Clock, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MODULES } from "@/lib/modules";
import { Pill } from "@/components/kit";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

const sb = supabase as any;
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** Super admin → company drawer → Suites: what this company has switched on, and changing it. */
export default function AdminCompanySuites({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["admin-tenant-modules", tenantId], queryFn: async () => ((await sb.from("tenant_modules").select("*").eq("tenant_id", tenantId)).data || []) as any[] });
  const { data: prices = [] } = useQuery({ queryKey: ["platform-modules"], queryFn: async () => ((await sb.from("platform_modules").select("key,price_monthly")).data || []) as any[] });
  const price = (k: string) => Number(prices.find((p: any) => p.key === k)?.price_monthly ?? MODULES.find((m) => m.key === k)?.price ?? 0);
  const setPrice = async (key: string, value: string) => {
    const n = Math.max(0, Number(value) || 0);
    const { error } = await sb.from("tenant_modules").update({ price_monthly: n, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("module_key", key);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["admin-tenant-modules", tenantId] });
    toast.success(`Price set to ${kes(n)} / month`);
  };
  const set = async (key: string, status: "comped" | "trial" | "active" | "cancelled") => {
    const now = new Date();
    const row: any = { tenant_id: tenantId, module_key: key, status, price_monthly: status === "comped" ? 0 : price(key), updated_at: now.toISOString(),
      trial_ends_at: status === "trial" ? new Date(now.getTime() + 14 * 86400_000).toISOString() : null,
      current_period_end: status === "active" ? new Date(now.getTime() + 30 * 86400_000).toISOString() : null,
      cancelled_at: status === "cancelled" ? now.toISOString() : null };
    const { error } = await sb.from("tenant_modules").upsert(row, { onConflict: "tenant_id,module_key" });
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["admin-tenant-modules", tenantId] });
    toast.success("Updated");
  };
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border">
      {MODULES.filter((m) => !m.included).map((m) => {
        const r = rows.find((x) => x.module_key === m.key);
        const live = r && (r.status === "comped" || r.status === "active" || r.status === "past_due" || (r.status === "trial" && Date.parse(r.trial_ends_at || "") > Date.now()));
        return (
          <li key={m.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><m.icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{m.name}</p>
              {r && (r.status === "active" || r.status === "past_due" || r.status === "trial") ? (
                <label className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">KES
                  <input key={`${r.module_key}-${r.price_monthly}`} type="number" min="0" defaultValue={Number(r.price_monthly ?? price(m.key))}
                    onBlur={(e) => { if (Number(e.target.value) !== Number(r.price_monthly)) void setPrice(m.key, e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="w-24 rounded-md border border-border bg-background px-2 py-0.5 text-xs tabular-nums text-foreground" aria-label={`${m.name} price per month`} />
                  / month{Number(r.price_monthly) !== price(m.key) && <span>(list {kes(price(m.key))})</span>}
                </label>
              ) : <p className="text-xs text-muted-foreground">{kes(price(m.key))} / month</p>}
            </div>
            {r ? (r.status === "comped" ? <Pill tone="success"><Gift className="h-3 w-3" /> Free</Pill> : r.status === "trial" ? <Pill tone="warning"><Clock className="h-3 w-3" /> Trial</Pill> : r.status === "cancelled" ? <Pill>Off</Pill> : <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> {r.status}</Pill>) : <Pill>Off</Pill>}
            <div className="flex gap-1">
              {r?.status !== "comped" && <button onClick={() => void set(m.key, "comped")} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted" title="Free of charge"><Gift className="h-3.5 w-3.5" /></button>}
              {!live && <button onClick={() => void set(m.key, "trial")} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted">Trial</button>}
              {r?.status !== "active" && <button onClick={() => void set(m.key, "active")} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted">Paid</button>}
              {live && <button onClick={() => void set(m.key, "cancelled")} className="rounded-lg px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10" title="Switch off"><Power className="h-3.5 w-3.5" /></button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
