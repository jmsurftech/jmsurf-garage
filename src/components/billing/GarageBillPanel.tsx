import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Grid2x2, MapPin, Minus, Plus, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useGarageCatalogue } from "@/hooks/useGarageCatalogue";
import { moduleName } from "@/lib/modules";
import { EXTRA_BRANCH_PRICE, kes } from "@/lib/garagePlans";
import { friendlyError } from "@/lib/friendlyError";
import { confirmAction } from "@/components/books/confirm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Sub { id: string; plan_id: string | null; plan_name: string; price: number; status: string; billing_cycle: string; current_period_end: string | null; trial_ends_at: string | null; max_locations: number; extra_branches?: number; next_plan_id?: string | null }
interface Row { module_key: string; status: string; price_monthly: number; prorata_due: number; trial_ends_at: string | null; current_period_end: string | null }

/**
 * The garage's monthly bill, line by line (same lines as the renewal invoice): base plan, each
 * module, extra branches and pro-rata charges; SMS bundles are bought separately. Owners and
 * people with billing rights change the number of branches and move the plan up or down here.
 */
export default function GarageBillPanel({ tenantId, onChoosePlan }: { tenantId: string | null; onChoosePlan?: () => void }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const { hasPermission } = usePermissions();
  const canBill = role === "admin" || role === "super_admin" || hasPermission("billing");
  const cat = useGarageCatalogue();
  const [busy, setBusy] = useState(false);

  const { data: sub } = useQuery({
    queryKey: ["garage-bill-sub", tenantId], enabled: !!tenantId,
    queryFn: async () => (await (supabase as any).from("subscriptions").select("id, plan_id, plan_name, price, status, billing_cycle, current_period_end, trial_ends_at, max_locations, extra_branches, next_plan_id")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as Sub | null,
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["garage-bill-rows", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await (supabase as any).from("tenant_modules").select("module_key, status, price_monthly, prorata_due, trial_ends_at, current_period_end")).data || []) as Row[],
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["garage-bill-sub", tenantId] });
    void qc.invalidateQueries({ queryKey: ["garage-bill-rows", tenantId] });
    void qc.invalidateQueries({ queryKey: ["subscription", tenantId] });
    void qc.invalidateQueries({ queryKey: ["billable-modules"] });
  };

  if (!sub) return null;
  const plan = cat.plans.find((p) => p.id === sub.plan_id) || cat.plans.find((p) => p.name === sub.plan_name);
  const included = new Set(plan?.includes || []);
  const now = Date.now();
  const live = (r: Row) => r.status === "active" || r.status === "past_due" || (r.status === "trial" && r.trial_ends_at && new Date(r.trial_ends_at).getTime() > now);
  const modules = rows.filter((r) => live(r) && !["extra_branch", "prorata"].includes(r.module_key) && !included.has(r.module_key));
  const branches = rows.find((r) => r.module_key === "extra_branch" && live(r));
  const prorata = rows.find((r) => r.module_key === "prorata" && r.status === "active" && Number(r.prorata_due) > 0);
  const extra = Number(sub.extra_branches || 0);
  const base = Number(sub.price) || plan?.price || 0;
  const lines = [
    { k: "plan", label: `${sub.plan_name || plan?.name || "Plan"} plan`, amount: base, note: "" },
    ...modules.map((r) => ({ k: r.module_key, label: moduleName(r.module_key), amount: Number(r.price_monthly) || 0, note: r.status === "trial" ? "free trial" : r.status === "past_due" ? "payment due" : "" })),
    ...(branches ? [{ k: "branches", label: `${extra} extra branch${extra === 1 ? "" : "es"}`, amount: Number(branches.price_monthly) || extra * EXTRA_BRANCH_PRICE, note: branches.status === "trial" ? "free trial" : "" }] : []),
  ];
  const monthly = lines.reduce((a, l) => a + l.amount, 0);
  const next = sub.next_plan_id ? cat.plans.find((p) => p.id === sub.next_plan_id) : null;
  const ends = sub.current_period_end || sub.trial_ends_at;

  const setBranches = async (n: number) => {
    if (!canBill || n < 0) return;
    if (n > extra && !(await confirmAction({ title: "Add a branch?", message: `Each extra branch is ${kes(EXTRA_BRANCH_PRICE)} a month. During a paid period, the days left are added to your next bill.`, confirmLabel: "Add branch" }))) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("garage_set_extra_branches", { p_count: n });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(n > extra ? "Branch added" : "Branch removed");
    refresh();
  };
  const changePlan = async (id: string, name: string) => {
    if (!canBill) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("garage_change_plan", { p_plan: id });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(data === "next_period" ? `${name} starts at your next renewal` : data === "upgraded" ? `You are on ${name}: the days left are added to your next bill` : `You are on ${name}`);
    refresh();
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /><h2 className="font-display text-lg font-bold">Your monthly bill</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">One invoice each period with KRA eTIMS, listing each line below. SMS bundles are bought separately.</p>
        <ul className="mt-4 divide-y divide-border text-sm">
          {lines.map((l) => (
            <li key={l.k} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{l.label}{l.note && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{l.note}</span>}</span>
              <b className="shrink-0 tabular-nums">{kes(l.amount)}</b>
            </li>
          ))}
          {prorata && (
            <li className="flex items-center justify-between gap-3 py-2 text-muted-foreground">
              <span>Pro-rata (switched on part-way through this period)</span><b className="shrink-0 tabular-nums text-foreground">{kes(Number(prorata.prorata_due))}</b>
            </li>
          )}
        </ul>
        <p className="mt-3 flex justify-between border-t border-border pt-3 font-display text-lg font-extrabold"><span>Per month</span><span>{kes(monthly)}</span></p>
        {ends && <p className="mt-1 text-xs text-muted-foreground">{sub.status === "active" ? "Next bill" : "Trial ends"} on {new Date(ends).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}. Yearly payment is 10 months' price.</p>}
        {next && <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs">Moving to <b>{next.name}</b> at your next renewal.</p>}
        <Link to="/modules" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><Grid2x2 className="h-4 w-4" />Turn modules on or off</Link>
      </div>

      <div className="space-y-4">
        <div className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /><h3 className="font-display font-bold">Branches</h3></div>
          <p className="mt-1 text-sm text-muted-foreground">{plan ? `${plan.name} includes ${plan.branches >= 999 ? "many branches" : `${plan.branches} branch${plan.branches === 1 ? "" : "es"}`}.` : ""} Extra branches are {kes(EXTRA_BRANCH_PRICE)} a month each.</p>
          <div className="mt-3 flex items-center gap-3">
            <button disabled={!canBill || busy || extra === 0} onClick={() => void setBranches(extra - 1)} aria-label="Remove a branch" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="min-w-[7rem] text-center text-sm"><b className="text-lg">{extra}</b> extra</span>
            <button disabled={!canBill || busy} onClick={() => void setBranches(extra + 1)} aria-label="Add a branch" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Total branches allowed: {sub.max_locations}</p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center gap-2"><ArrowUpRight className="h-5 w-5 text-primary" /><h3 className="font-display font-bold">Change plan</h3></div>
          <p className="mt-1 text-sm text-muted-foreground">Moving up works now; you pay only for the days left. Moving down starts at your next renewal.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {cat.plans.filter((p) => p.id && !p.quoteOnly).map((p) => {
              const current = p.id === sub.plan_id;
              return (
                <button key={p.code} disabled={!canBill || busy || current} onClick={() => void changePlan(p.id!, p.name)}
                  className={cn("rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default", current ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                  <b className="block">{p.name}</b><span className="text-xs text-muted-foreground">{current ? "Your plan" : `${kes(p.price)} / month`}</span>
                </button>
              );
            })}
          </div>
          {onChoosePlan && <button onClick={onChoosePlan} className="mt-3 text-sm font-semibold text-primary hover:underline">Pay or renew below</button>}
          {!canBill && <p className="mt-2 text-xs text-muted-foreground">Only the owner, or someone with billing rights, can change the plan or branches.</p>}
        </div>
      </div>
    </section>
  );
}
