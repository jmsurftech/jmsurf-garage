import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Clock, Gift, Power } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ADDON_MODULES } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Field, Modal, Pill } from "@/components/kit";
import { adminCall, plusDays, today } from "@/lib/adminApi";

const sb = supabase as any;
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const d = (s?: string | null) => (s ? format(new Date(s), "d MMM yyyy") : "");
type Pick = { key: string; name: string; status: "comped" | "trial" | "active" } | null;

/**
 * Admin → company → Subscription → Modules: what this company has on outside its plan.
 * Free (until a date, or for good), a trial, paid at its own price, or off. Saved and recorded by the server.
 */
export default function AdminCompanySuites({ tenantId, disabled }: { tenantId: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["admin-tenant-modules", tenantId], queryFn: async () => ((await sb.from("tenant_modules").select("*").eq("tenant_id", tenantId)).data || []) as any[] });
  const { data: prices = [] } = useQuery({ queryKey: ["platform-modules"], queryFn: async () => ((await sb.from("platform_modules").select("key,price_monthly")).data || []) as any[] });
  const [pick, setPick] = useState<Pick>(null);
  const price = (k: string) => Number(prices.find((p: any) => p.key === k)?.price_monthly ?? ADDON_MODULES.find((m) => m.key === k)?.price ?? 0);
  const call = async (body: Record<string, unknown>, ok: string) => {
    try { await adminCall("companies/module", { tenant_id: tenantId, ...body }); toast.success(ok); void qc.invalidateQueries({ queryKey: ["admin-tenant-modules", tenantId] }); return true; }
    catch (e: any) { toast.error(e.message); return false; }
  };

  return (
    <>
      <ul className="divide-y divide-border">
        {ADDON_MODULES.map((m) => {
          const r = rows.find((x) => x.module_key === m.key);
          const freeEnd = r?.status === "comped" ? r.current_period_end : null;
          const live = r && ((r.status === "comped" && (!freeEnd || Date.parse(freeEnd) > Date.now())) || r.status === "active" || r.status === "past_due" || (r.status === "trial" && Date.parse(r.trial_ends_at || "") > Date.now()));
          return (
            <li key={m.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><m.icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{m.name}</p>
                {r && (r.status === "active" || r.status === "past_due" || r.status === "trial") ? (
                  <label className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">KES
                    <input key={`${r.module_key}-${r.price_monthly}`} type="number" min="0" defaultValue={Number(r.price_monthly ?? price(m.key))} disabled={disabled}
                      onBlur={(e) => { if (Number(e.target.value) !== Number(r.price_monthly)) void call({ key: m.key, price: Number(e.target.value) || 0 }, `Price set to ${kes(Number(e.target.value) || 0)} / month`); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="w-24 rounded-md border border-border bg-background px-2 py-0.5 text-xs tabular-nums text-foreground" aria-label={`${m.name} price per month`} />
                    / month{Number(r.price_monthly) !== price(m.key) && <span>(list {kes(price(m.key))})</span>}
                  </label>
                ) : <p className="text-xs text-muted-foreground">{kes(price(m.key))} / month</p>}
              </div>
              {!r || !live ? <Pill>Off</Pill>
                : r.status === "comped" ? <Pill tone="success"><Gift className="h-3 w-3" /> Free{freeEnd ? ` to ${d(freeEnd)}` : ""}</Pill>
                : r.status === "trial" ? <Pill tone="info"><Clock className="h-3 w-3" /> Trial to {d(r.trial_ends_at)}</Pill>
                : <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Paid{r.current_period_end ? ` to ${d(r.current_period_end)}` : ""}</Pill>}
              {!disabled && (
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setPick({ key: m.key, name: m.name, status: "comped" })} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted" title="Free of charge"><Gift className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setPick({ key: m.key, name: m.name, status: "trial" })} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted">Trial</button>
                  <button onClick={() => setPick({ key: m.key, name: m.name, status: "active" })} className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted">Paid</button>
                  {live && <button onClick={() => void call({ key: m.key, status: "cancelled" }, `${m.name} switched off`)} className="rounded-lg px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10" title="Switch off" aria-label="Switch off"><Power className="h-3.5 w-3.5" /></button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <UntilModal pick={pick} onClose={() => setPick(null)} onSave={async (until) => {
        if (pick && await call({ key: pick.key, status: pick.status, until: until || undefined }, pick.status === "comped" ? `${pick.name} is free${until ? ` until ${d(until)}` : ""}` : pick.status === "trial" ? `${pick.name} on trial` : `${pick.name} switched on`)) setPick(null);
      }} />
    </>
  );
}

function UntilModal({ pick, onClose, onSave }: { pick: Pick; onClose: () => void; onSave: (until: string) => Promise<void> }) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const what = pick?.status === "comped" ? "Free until" : pick?.status === "trial" ? "Trial ends" : "Paid until";
  return (
    <Modal center open={!!pick} onClose={onClose} size="sm" icon={pick?.status === "comped" ? Gift : Clock}
      title={pick ? `${pick.name}: ${pick.status === "comped" ? "free" : pick.status === "trial" ? "trial" : "paid"}` : ""}
      description={pick?.status === "comped" ? "Leave the date empty to keep it free with no end." : pick?.status === "trial" ? "Empty: 14 days from today." : "Empty: 30 days from today."}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={async () => { setBusy(true); await onSave(until); setBusy(false); setUntil(""); }}>{busy ? "Saving…" : "Save"}</Button>
      </>}>
      <Field label={what}><input className="fi" type="date" min={today()} value={until} placeholder={plusDays(30)} onChange={(e) => setUntil(e.target.value)} /></Field>
    </Modal>
  );
}
