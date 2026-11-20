import { getAuthUser } from "@/lib/authUser";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Save, Settings2, Users, MapPin, Copy, AlertCircle } from "lucide-react";
import { ALL_FEATURES, type FeatureKey } from "@/hooks/useTenantFeatures";
import { OrbSpinner } from "@/components/orbs";

const ALLOWED_KEYS = new Set(ALL_FEATURES.map((f) => f.key as string));
const DEFAULT_ON: Record<string, boolean> = ALL_FEATURES.reduce((acc, f) => {
  acc[f.key] = true;
  return acc;
}, {} as Record<string, boolean>);

/** Drop unknown keys / non-boolean values from a feature map. */
function sanitize(value: any): Record<string, boolean> {
  const clean: Record<string, boolean> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([k, v]) => {
      if (ALLOWED_KEYS.has(k) && typeof v === "boolean") clean[k] = v;
    });
  }
  return clean;
}

/** Compute effective flags using the same precedence as the runtime sidebar. */
function resolveEffective(planFeatures: any, overrideFeatures: any): Record<string, boolean> {
  const result: Record<string, boolean> = { ...DEFAULT_ON };
  // Plan: object → only explicit keys override; array/CSV → set unlisted to false
  if (Array.isArray(planFeatures)) {
    ALL_FEATURES.forEach((f) => { result[f.key] = false; });
    planFeatures.forEach((k: any) => {
      if (typeof k === "string" && ALLOWED_KEYS.has(k)) result[k] = true;
    });
  } else if (planFeatures && typeof planFeatures === "object") {
    Object.entries(planFeatures).forEach(([k, v]) => {
      if (ALLOWED_KEYS.has(k) && typeof v === "boolean") result[k] = v as boolean;
    });
  }
  // Override always wins, only explicit entries
  Object.entries(sanitize(overrideFeatures)).forEach(([k, v]) => { result[k] = v; });
  return result;
}

interface Props {
  tenantId: string;
  subscriptionId?: string;
  planId?: string | null;
  staffCount?: number;
  initialPrice?: number;
  initialMaxUsers?: number;
  initialMaxLocations?: number;
}

export default function AdminTenantFeaturesPanel({
  tenantId, subscriptionId, planId, staffCount, initialPrice, initialMaxUsers, initialMaxLocations,
}: Props) {
  const [planInfo, setPlanInfo] = useState<{ name: string; price_monthly: number; max_users: number; max_locations: number } | null>(null);
  useEffect(() => {
    if (!planId) { setPlanInfo(null); return; }
    void (supabase as any).from("plans").select("name, price_monthly, max_users, max_locations").eq("id", planId).maybeSingle()
      .then(({ data }: any) => setPlanInfo(data || null));
  }, [planId]);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [price, setPrice] = useState(String(initialPrice ?? 0));
  const [maxUsers, setMaxUsers] = useState(String(initialMaxUsers ?? 2));
  const [maxLocations, setMaxLocations] = useState(String(initialMaxLocations ?? 1));
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrice(String(initialPrice ?? 0));
    setMaxUsers(String(initialMaxUsers ?? 2));
    setMaxLocations(String(initialMaxLocations ?? 1));
  }, [tenantId, subscriptionId, initialPrice, initialMaxUsers, initialMaxLocations]);

  // Seed the toggles from the tenant's EFFECTIVE modules (package defaults +
  // existing overrides) so what the admin sees matches what the shop sees.
  useEffect(() => {
    let cancelled = false;
    const sb: any = supabase;
    (async () => {
      const { data: subRow } = await sb
        .from("subscriptions").select("plan_id").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const planId = subRow?.plan_id || null;
      const [planRes, ovRes] = await Promise.all([
        planId
          ? sb.from("plans").select("features").eq("id", planId).maybeSingle()
          : sb.from("plans").select("features").eq("is_active", true)
              .order("price_monthly", { ascending: true }).limit(1).maybeSingle(),
        sb.from("tenant_feature_overrides").select("features").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      if (cancelled) return;
      setOverrides(resolveEffective(planRes?.data?.features, ovRes?.data?.features));
    })();
    return () => { cancelled = true; };
  }, [tenantId, subscriptionId]);

  const toggle = (key: FeatureKey) => {
    setOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const save = async () => {
    setSaving(true);
    const sb: any = supabase;
    try {
      // The shop's current package (same lookup as the shop app uses).
      const { data: planRow } = await sb
        .from("subscriptions").select("plan_id").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const planId = planRow?.plan_id || null;
      const [{ data: planBefore }, { data: ovBefore }] = await Promise.all([
        planId
          ? sb.from("plans").select("features").eq("id", planId).maybeSingle()
          : sb.from("plans").select("features").eq("is_active", true).order("price_monthly", { ascending: true }).limit(1).maybeSingle(),
        sb.from("tenant_feature_overrides").select("id, features").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      const effectiveBefore = resolveEffective(planBefore?.features, ovBefore?.features);
      // Save only the switches that differ from the package, so a later
      // package change still brings its own modules.
      const planDefaults = resolveEffective(planBefore?.features, {});
      const cleanOverrides = Object.fromEntries(
        Object.entries(sanitize(overrides)).filter(([k, v]) => planDefaults[k] !== v),
      ) as Record<string, boolean>;

      if (subscriptionId) {
        const { error: subscriptionError } = await sb.from("subscriptions").update({
          price: Number(price) || 0,
          max_users: Number(maxUsers) || 1,
          max_locations: Number(maxLocations) || 1,
        }).eq("id", subscriptionId).eq("tenant_id", tenantId);
        if (subscriptionError) throw subscriptionError;
      }

      const { error: overrideError } = await sb
        .from("tenant_feature_overrides")
        .upsert({ tenant_id: tenantId, features: cleanOverrides }, { onConflict: "tenant_id" });
      if (overrideError) throw overrideError;

      // Compute diff and write audit entry
      const effectiveAfter = resolveEffective(planBefore?.features, cleanOverrides);
      const diff: Record<string, { before: boolean; after: boolean }> = {};
      Object.keys(effectiveAfter).forEach((k) => {
        if (effectiveBefore[k] !== effectiveAfter[k]) {
          diff[k] = { before: effectiveBefore[k], after: effectiveAfter[k] };
        }
      });
      try {
        const { data: { user } } = await getAuthUser();
        await sb.from("feature_audit_logs").insert({
          actor_user_id: user?.id,
          actor_email: user?.email,
          scope: "tenant_override",
          plan_id: planId,
          tenant_id: tenantId,
          before_features: ovBefore?.features ?? null,
          after_features: cleanOverrides,
          effective_before: effectiveBefore,
          effective_after: effectiveAfter,
          diff,
        });
      } catch { /* audit failure shouldn't block the save */ }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant-features", tenantId], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["subscription-limits", tenantId], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["subscription", tenantId], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["billing-feature-overrides", tenantId], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["admin-customers"], refetchType: "all" }),
      ]);
      toast({
        title: "Custom deal saved",
        description: Object.keys(diff).length
          ? `${Object.keys(diff).length} feature${Object.keys(diff).length === 1 ? "" : "s"} changed.`
          : "No effective changes.",
      });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" /> Custom deal
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          This company only. Package: {planInfo ? <b className="text-foreground">{planInfo.name}</b> : "unchanged"}.
        </p>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <label className="text-muted-foreground text-xs mb-1 block">Price (KES / month)</label>
          <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="fi" />
          {planInfo && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Package KES {Number(planInfo.price_monthly).toLocaleString()}.{" "}
              {Number(price) !== Number(planInfo.price_monthly) && <button type="button" className="font-medium text-primary underline" onClick={() => setPrice(String(planInfo.price_monthly))}>Use it</button>}
            </p>
          )}
        </div>
        <div>
          <label className="text-muted-foreground text-xs mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Users allowed</label>
          <input type="number" min="1" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} className="fi" />
          <p className="mt-1 text-[11px] text-muted-foreground">{staffCount != null ? `${staffCount} in use. ` : ""}{planInfo ? `Package: ${planInfo.max_users >= 999999 ? "unlimited" : planInfo.max_users}. ` : ""}999999 = unlimited.</p>
        </div>
        <div>
          <label className="text-muted-foreground text-xs mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Branches allowed</label>
          <input type="number" min="1" value={maxLocations} onChange={(e) => setMaxLocations(e.target.value)} className="fi" />
          {planInfo && <p className="mt-1 text-[11px] text-muted-foreground">Package: {planInfo.max_locations >= 999999 ? "unlimited" : planInfo.max_locations}.</p>}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2">Screens this company can use</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_FEATURES.map((f) => {
            const enabled = overrides[f.key] ?? true;
            return (
              <label key={f.key} className="flex min-w-0 items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted">
                <input type="checkbox" checked={enabled} onChange={() => toggle(f.key)}
                  className="rounded border-border" />
                <span className={enabled ? "text-foreground" : "text-muted-foreground line-through"}>{f.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <EffectiveFeaturesPreview tenantId={tenantId} pendingOverrides={overrides} />

      <Button onClick={save} disabled={saving} className="gap-1 rounded-lg">
        <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/**
 * Read-only chip list of EFFECTIVE features for the viewed tenant.
 * - Single debounced realtime subscription (plans + subscriptions + overrides)
 * - Loading / error states
 * - "Copy resolved feature JSON" button for support tickets
 * - Reflects currently-pending (unsaved) override toggles for instant feedback
 */
function EffectiveFeaturesPreview({
  tenantId,
  pendingOverrides,
}: {
  tenantId: string;
  pendingOverrides: Record<string, boolean>;
}) {
  const [savedFlags, setSavedFlags] = useState<Record<string, boolean> | null>(null);
  const [planFeatures, setPlanFeatures] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        const sb: any = supabase;
        const { data: subRow, error: subErr } = await sb
          .from("subscriptions").select("plan_id").eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (subErr) throw subErr;
        const planId = subRow?.plan_id || null;
        const [planRes, ovRes] = await Promise.all([
          planId ? sb.from("plans").select("features").eq("id", planId).maybeSingle() : Promise.resolve({ data: null, error: null }),
          sb.from("tenant_feature_overrides").select("features").eq("tenant_id", tenantId).maybeSingle(),
        ]);
        if (planRes?.error) throw planRes.error;
        if (ovRes?.error) throw ovRes.error;
        if (cancelled) return;
        setPlanFeatures(planRes?.data?.features ?? null);
        setSavedFlags(resolveEffective(planRes?.data?.features, ovRes?.data?.features));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load feature data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    // Single debounced channel handles all three tables
    const debouncedLoad = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 250);
    };
    const ch = supabase
      .channel(`eff-preview-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_feature_overrides", filter: `tenant_id=eq.${tenantId}` }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `tenant_id=eq.${tenantId}` }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, debouncedLoad)
      .subscribe();
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [tenantId]);

  // Live preview reflects unsaved override toggles
  const previewFlags = useMemo(() => {
    if (!savedFlags) return null;
    return resolveEffective(planFeatures, pendingOverrides);
  }, [savedFlags, planFeatures, pendingOverrides]);

  const copyJson = async () => {
    if (!previewFlags) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(previewFlags, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be unavailable */ }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <OrbSpinner className="w-3.5 h-3.5" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-center gap-2 text-xs text-destructive">
        <AlertCircle className="w-3.5 h-3.5" /> Could not load features: {error}
      </div>
    );
  }
  if (!previewFlags) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-muted-foreground">Result, with unsaved changes</p>
        <button
          type="button"
          onClick={copyJson}
          className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted"
        >
          <Copy className="w-3 h-3" /> {copied ? "Copied!" : "Copy JSON"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_FEATURES.map((f) => {
          const on = previewFlags[f.key];
          return (
            <span key={f.key}
              className={
                "px-2 py-0.5 rounded-full text-[11px] border " +
                (on
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-muted/40 text-muted-foreground border-border line-through")
              }>
              {f.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
