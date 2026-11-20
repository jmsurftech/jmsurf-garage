import { getAuthUser } from "@/lib/authUser";
import { useEffect, useState } from "react";
import { useSessionState } from "@/lib/sessionState";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Edit3, Save, Users, MapPin, Check, Package } from "lucide-react";
import { PageHeader, Panel, EmptyState, Field, Modal, Pill } from "@/components/kit";
import { normalizePlanFeatures } from "@/lib/planFeatures";
import { ALL_FEATURES, type FeatureKey } from "@/hooks/useTenantFeatures";

type FeatureState = Record<FeatureKey, boolean>;

const DEFAULT_FEATURES: FeatureState = ALL_FEATURES.reduce((acc, feature) => {
  acc[feature.key] = true;
  return acc;
}, {} as FeatureState);

const emptyFeatureState = (): FeatureState => ({ ...DEFAULT_FEATURES });

const normalizeFeatureToken = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const resolveFeatureKey = (value: string): FeatureKey | null => {
  const normalized = normalizeFeatureToken(value);
  const match = ALL_FEATURES.find((feature) => {
    return normalizeFeatureToken(feature.key) === normalized || normalizeFeatureToken(feature.label) === normalized;
  });
  return match?.key ?? null;
};

const featureStateFromValue = (value: unknown): FeatureState => {
  const next = ALL_FEATURES.reduce((acc, feature) => {
    acc[feature.key] = false;
    return acc;
  }, {} as FeatureState);

  if (Array.isArray(value)) {
    value.forEach((item) => {
      const key = resolveFeatureKey(String(item));
      if (key) next[key] = true;
    });
    return next;
  }

  if (typeof value === "string") {
    value.split(",").forEach((item) => {
      const key = resolveFeatureKey(item);
      if (key) next[key] = true;
    });
    return next;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
      const key = resolveFeatureKey(rawKey);
      if (key && typeof rawValue === "boolean") next[key] = rawValue;
    });
  }

  return next;
};

export default function AdminSubscriptions() {
  const [plans, setPlans] = useSessionState<any[]>("AdminSubscriptions.tsx:plans", []);
  const [subs, setSubs] = useSessionState<any[]>("AdminSubscriptions.tsx:subs", []);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [newPlan, setNewPlan] = useState({
    name: "", max_users: 5, max_locations: 1, price_monthly: 0, price_quarterly: 0, price_annually: 0, features: emptyFeatureState(),
    quarterly_discount: 10, annual_discount: 20, trial_days: 14,
  });
  const { toast } = useToast();

  const load = async () => {
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from("plans").select("*").order("price_monthly"),
      allRows(() => supabase.from("subscriptions").select("*").order("created_at")),
    ]);
    if (p) setPlans(p as any[]);
    if (s) setSubs(s as any[]);
  };

  useEffect(() => { load(); }, []);

  const calcDiscountedPrices = (monthly: number, qDiscount: number, aDiscount: number) => ({
    price_quarterly: Math.round(monthly * 3 * (1 - qDiscount / 100)),
    price_annually: Math.round(monthly * 12 * (1 - aDiscount / 100)),
  });

  const addPlan = async () => {
    const discounted = calcDiscountedPrices(newPlan.price_monthly, newPlan.quarterly_discount, newPlan.annual_discount);
    const { error } = await supabase.from("plans").insert({
      name: newPlan.name, max_users: newPlan.max_users, max_locations: newPlan.max_locations,
      price_monthly: newPlan.price_monthly,
      price_quarterly: discounted.price_quarterly,
      price_annually: discounted.price_annually,
      features: newPlan.features, trial_days: newPlan.trial_days,
    } as any);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Plan added" });
      setShowAdd(false);
      setNewPlan({ name: "", max_users: 5, max_locations: 1, price_monthly: 0, price_quarterly: 0, price_annually: 0, features: emptyFeatureState(), quarterly_discount: 10, annual_discount: 20, trial_days: 14 });
      load();
    }
  };

  const startEdit = (plan: any) => {
    const monthly = Number(plan.price_monthly);
    const quarterly = Number(plan.price_quarterly);
    const annually = Number(plan.price_annually);
    const qDiscount = monthly > 0 ? Math.round((1 - quarterly / (monthly * 3)) * 100) : 10;
    const aDiscount = monthly > 0 ? Math.round((1 - annually / (monthly * 12)) * 100) : 20;
    setEditingId(plan.id);
    setEditData({
      name: plan.name,
      max_users: plan.max_users,
      max_locations: plan.max_locations ?? 1,
      price_monthly: monthly,
      price_quarterly: quarterly,
      price_annually: annually,
      features: featureStateFromValue(plan.features),
      quarterly_discount: qDiscount,
      annual_discount: aDiscount,
      is_active: plan.is_active,
      trial_days: plan.trial_days ?? 14,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const discounted = calcDiscountedPrices(editData.price_monthly, editData.quarterly_discount, editData.annual_discount);
    // Snapshot BEFORE features for audit diff
    const { data: beforeRow } = await supabase.from("plans").select("features").eq("id", editingId).maybeSingle();
    const { error } = await supabase.from("plans").update({
      name: editData.name, max_users: editData.max_users, max_locations: editData.max_locations,
      price_monthly: editData.price_monthly,
      price_quarterly: discounted.price_quarterly,
      price_annually: discounted.price_annually,
      features: editData.features, is_active: editData.is_active,
      trial_days: editData.trial_days,
    } as any).eq("id", editingId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      const { data: syncedCount, error: syncError } = await (supabase as any).rpc("sync_plan_subscriptions", { _plan_id: editingId });
      if (syncError) {
        toast({ title: "Plan updated but sync failed", description: syncError.message, variant: "destructive" });
      } else {
        toast({ title: "Plan updated", description: `Synced ${syncedCount ?? 0} existing subscription(s).` });
      }
      // Audit log entry — best-effort
      try {
        const { data: { user } } = await getAuthUser();
        const before = (beforeRow as any)?.features ?? null;
        const after = editData.features;
        const diff: Record<string, { before: any; after: any }> = {};
        const keys = new Set([
          ...Object.keys((before && typeof before === "object" && !Array.isArray(before)) ? before : {}),
          ...Object.keys(after || {}),
        ]);
        keys.forEach((k) => {
          const b = (before && typeof before === "object" && !Array.isArray(before)) ? (before as any)[k] : undefined;
          const a = (after as any)[k];
          if (b !== a) diff[k] = { before: b ?? null, after: a ?? null };
        });
        await (supabase as any).from("feature_audit_logs").insert({
          actor_user_id: user?.id, actor_email: user?.email,
          scope: "plan", plan_id: editingId,
          before_features: before, after_features: after,
          effective_before: null, effective_after: null,
          diff,
        });
      } catch { /* non-fatal */ }
      setEditingId(null);
      load();
    }
  };

  const deletePlan = async (id: string) => {
    const { error } = await supabase.from("plans").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Plan deleted" }); load(); }
  };

  const planStats = (planId: string) => {
    const planSubs = subs.filter(s => s.plan_id === planId);
    return {
      total: planSubs.length,
      active: planSubs.filter(s => s.status === "active").length,
      trial: planSubs.filter(s => s.status === "trial" || s.status === "trialing").length,
      revenue: planSubs.filter(s => s.status === "active").reduce((sum, s) => sum + Number(s.price), 0),
    };
  };

  const [confirmDelete, setConfirmDelete] = useState<any>(null);

  const renderFeaturePicker = (features: FeatureState, onToggle: (key: FeatureKey) => void) => (
    <div>
      <p className="mb-2 text-sm font-medium">Features included</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ALL_FEATURES.map((feature) => {
          const enabled = features[feature.key] ?? false;
          return (
            <button key={feature.key} type="button" onClick={() => onToggle(feature.key)}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${enabled ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted"}`}>
              <span>{feature.label}</span>
              {enabled ? <Check className="h-4 w-4 text-primary" /> : <span className="h-4 w-4 rounded-full border border-border" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderPlanForm = (data: any, set: (d: any) => void, withActive: boolean) => {
    const prices = calcDiscountedPrices(Number(data.price_monthly) || 0, Number(data.quarterly_discount) || 0, Number(data.annual_discount) || 0);
    const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set({ ...data, [k]: Number(e.target.value) });
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Package name" required className="sm:col-span-3"><input className="fi" value={data.name} onChange={(e) => set({ ...data, name: e.target.value })} placeholder="Enter package name" /></Field>
          <Field label="Monthly price (KSh)" required><input className="fi" type="number" min={0} value={data.price_monthly || ""} onChange={num("price_monthly")} /></Field>
          <Field label="Quarterly discount %"><input className="fi" type="number" min={0} max={90} value={data.quarterly_discount} onChange={num("quarterly_discount")} /></Field>
          <Field label="Yearly discount %"><input className="fi" type="number" min={0} max={90} value={data.annual_discount} onChange={num("annual_discount")} /></Field>
          <Field label="Users" hint="999999 = unlimited"><input className="fi" type="number" min={1} value={data.max_users} onChange={num("max_users")} /></Field>
          <Field label="Branches" hint="999999 = unlimited"><input className="fi" type="number" min={1} value={data.max_locations} onChange={num("max_locations")} /></Field>
          <Field label="Trial days"><input className="fi" type="number" min={0} value={data.trial_days} onChange={num("trial_days")} /></Field>
        </div>
        {Number(data.price_monthly) > 0 && (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center text-sm">
            <div><p className="text-xs text-muted-foreground">Monthly</p><p className="font-semibold">KSh {Number(data.price_monthly).toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">Quarterly</p><p className="font-semibold">KSh {prices.price_quarterly.toLocaleString()}</p></div>
            <div><p className="text-xs text-muted-foreground">Yearly</p><p className="font-semibold">KSh {prices.price_annually.toLocaleString()}</p></div>
          </div>
        )}
        {renderFeaturePicker(data.features || emptyFeatureState(), (key) => set({ ...data, features: { ...(data.features || emptyFeatureState()), [key]: !(data.features || emptyFeatureState())[key] } }))}
        {withActive && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
            <span><span className="font-medium">Show on the website and sign-up</span><span className="block text-xs text-muted-foreground">Hidden packages keep working for companies already on them.</span></span>
            <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={!!data.is_active} onChange={(e) => set({ ...data, is_active: e.target.checked })} />
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Packages" icon={Package}
        actions={<Button size="sm" onClick={() => setShowAdd(true)}><Plus /> Add package</Button>} />

      {plans.length === 0 ? <Panel><EmptyState icon={Package} title="No packages yet" /></Panel> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const stats = planStats(plan.id);
            const monthly = Number(plan.price_monthly);
            const features = normalizePlanFeatures(plan.features);
            const unlimited = (n: number) => (n >= 999999 ? "Unlimited" : n);
            return (
              <div key={plan.id} className={`flex flex-col rounded-2xl border bg-card p-5 ${plan.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                    {!plan.is_active && <Pill tone="muted" className="mt-1">Hidden</Pill>}
                  </div>
                  <div className="flex gap-0.5">
                    <button className="icon-btn" title="Edit" onClick={() => startEdit(plan)}><Edit3 className="h-4 w-4" /></button>
                    <button className="icon-btn-danger" title="Delete" onClick={() => setConfirmDelete(plan)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="text-sm text-muted-foreground">KSh</span>
                  <span className="font-display text-3xl font-bold text-primary">{monthly.toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  KSh {Number(plan.price_quarterly).toLocaleString()} quarterly · KSh {Number(plan.price_annually).toLocaleString()} yearly
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {unlimited(plan.max_users)} users</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {unlimited(plan.max_locations ?? 1)} branches</span>
                  <span>{plan.trial_days ?? 14}-day trial</span>
                </div>
                <div className="mt-4 flex flex-1 flex-wrap content-start gap-1.5">
                  {features.map((f, i) => <Pill key={i} tone="primary">{f}</Pill>)}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                  <div><p className="font-bold text-success">{stats.active}</p><p className="text-[11px] text-muted-foreground">Paying</p></div>
                  <div><p className="font-bold text-warning">{stats.trial}</p><p className="text-[11px] text-muted-foreground">Trial</p></div>
                  <div><p className="truncate font-bold">{stats.revenue.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">KSh / cycle</p></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="xl" icon={Package} title="Add a package"
        footer={<>
          <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button onClick={addPlan} disabled={!newPlan.name.trim()}><Save /> Save package</Button>
        </>}>
        {renderPlanForm(newPlan, setNewPlan, false)}
      </Modal>

      <Modal open={!!editingId} onClose={() => setEditingId(null)} size="xl" icon={Edit3} title="Edit package"
        description="Price and feature changes apply to every company on this package."
        footer={<>
          <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
          <Button onClick={saveEdit} disabled={!String(editData.name || "").trim()}><Save /> Save changes</Button>
        </>}>
        {editingId && renderPlanForm(editData, setEditData, true)}
      </Modal>

      <Modal center open={!!confirmDelete} onClose={() => setConfirmDelete(null)} size="sm" icon={Trash2}
        title={confirmDelete && planStats(confirmDelete.id).total > 0 ? "This package is in use" : "Delete this package?"}
        description={confirmDelete && planStats(confirmDelete.id).total > 0
          ? `${planStats(confirmDelete.id).total} company(ies) are on ${confirmDelete.name}. Hide it instead so new companies can't pick it.`
          : "It will no longer appear anywhere. This can't be undone."}
        footer={confirmDelete && planStats(confirmDelete.id).total > 0 ? <>
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>Close</Button>
          <Button onClick={() => { const p = confirmDelete; setConfirmDelete(null); startEdit(p); }}><Edit3 /> Edit and hide</Button>
        </> : <>
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { deletePlan(confirmDelete.id); setConfirmDelete(null); }}>Delete package</Button>
        </>}
      />
    </div>
  );
}
