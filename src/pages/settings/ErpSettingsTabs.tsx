import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MessageSquare, CreditCard, Bell, Store, ShieldCheck, LogOut, Monitor, Smartphone, FileText, Kanban, BadgePercent, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, Field, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { JmsurfSmsWallet } from "@/components/JmsurfSmsWallet";
import { confirmAction } from "@/components/books/confirm";
import { messagingApi } from "@/lib/messaging";
import { cn } from "@/lib/utils";

const sb: any = supabase;

/** business_settings.erp_settings: ERP-wide options (alerts, online shop, …). */
export function useErpSettings() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["erp-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("business_settings").select("id,erp_settings").eq("tenant_id", tenantId).maybeSingle()).data as { id: string; erp_settings: any } | null,
  });
  /** Saves one top-level section (e.g. "alerts"), keeping every other section. */
  const save = async (section: string, value: any) => {
    const fresh = (await sb.from("business_settings").select("id,erp_settings").eq("tenant_id", tenantId).maybeSingle()).data;
    if (!fresh?.id) return { error: { message: "Save the business details first (System → Business settings)" } };
    const r = await sb.from("business_settings").update({ erp_settings: { ...(fresh.erp_settings || {}), [section]: value } }).eq("id", fresh.id);
    qc.invalidateQueries({ queryKey: ["erp-settings"] });
    return r;
  };
  return { ...q, settings: (q.data?.erp_settings || {}) as Record<string, any>, save };
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

/* ─────────────────────────────── Alerts ─────────────────────────────── */

const DEFAULT_ALERTS = {
  send_hour: 9, pay_text: "",
  debt: { enabled: true, stages: [-3, 0, 3, 7, 14, 30], customer_sms: true, customer_email: true, rep_sms: true, staff_inapp: true },
  restock: { enabled: true, days_before: 3, customer_sms: true, staff_inapp: true },
};
const STAGE_CHOICES = [-7, -3, -1, 0, 1, 3, 7, 14, 30, 60];
const stageName = (s: number) => (s < 0 ? `${-s} day${s === -1 ? "" : "s"} before` : s === 0 ? "On the due date" : `${s} day${s === 1 ? "" : "s"} late`);

export function AlertsTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { settings, save, isLoading } = useErpSettings();
  const [a, setA] = useState<any>(DEFAULT_ALERTS);
  useEffect(() => {
    const s = settings.alerts || {};
    setA({ ...DEFAULT_ALERTS, ...s, debt: { ...DEFAULT_ALERTS.debt, ...(s.debt || {}) }, restock: { ...DEFAULT_ALERTS.restock, ...(s.restock || {}) } });
  }, [settings.alerts]);
  if (isLoading) return <OrbLoader label="Loading alerts…" />;
  const setDebt = (p: any) => setA({ ...a, debt: { ...a.debt, ...p } });
  const setRestock = (p: any) => setA({ ...a, restock: { ...a.restock, ...p } });
  const submit = async () => {
    const { error } = await save("alerts", a);
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Alert rules saved" });
  };
  return (
    <div className="space-y-5">
      <Panel title="Debt alerts" icon={Bell} description="When an invoice has a due date (set on the calendar at the till or on the invoice)."
        actions={<Switch checked={a.debt.enabled} onCheckedChange={(v) => setDebt({ enabled: v })} disabled={!canManage} />}>
        <div className={cn("space-y-4", !a.debt.enabled && "pointer-events-none opacity-50")}>
          <Field label="Send an alert">
            <div className="flex flex-wrap gap-2">{STAGE_CHOICES.map((s) => {
              const on = a.debt.stages.includes(s);
              return <button key={s} type="button" disabled={!canManage} onClick={() => setDebt({ stages: on ? a.debt.stages.filter((x: number) => x !== s) : [...a.debt.stages, s].sort((x: number, y: number) => x - y) })}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{stageName(s)}</button>;
            })}</div>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="SMS the customer" checked={a.debt.customer_sms} onChange={(v) => setDebt({ customer_sms: v })} disabled={!canManage} />
            <Toggle label="Email the customer" hint="Needs email set up (SMTP / Email)" checked={a.debt.customer_email} onChange={(v) => setDebt({ customer_email: v })} disabled={!canManage} />
            <Toggle label="Bell alert to owner, managers and attendants" checked={a.debt.staff_inapp} onChange={(v) => setDebt({ staff_inapp: v })} disabled={!canManage} />
            <Toggle label="SMS the customer's sales rep" checked={a.debt.rep_sms} onChange={(v) => setDebt({ rep_sms: v })} disabled={!canManage} />
          </div>
          <Field label="How to pay (added to the SMS)" hint="e.g. Pay via M-Pesa Till 123456. Keep it short.">
            <input className="fi" maxLength={120} value={a.pay_text} onChange={(e) => setA({ ...a, pay_text: e.target.value })} disabled={!canManage} />
          </Field>
        </div>
      </Panel>
      <Panel title="Restock reminders" icon={Bell} description="Products with a repurchase interval (e.g. dewormer every 90 days) remind the customer to buy again."
        actions={<Switch checked={a.restock.enabled} onCheckedChange={(v) => setRestock({ enabled: v })} disabled={!canManage} />}>
        <div className={cn("space-y-4", !a.restock.enabled && "pointer-events-none opacity-50")}>
          <Field label="Remind this many days before it runs out"><input className="fi w-28" type="number" min={0} max={30} value={a.restock.days_before} onChange={(e) => setRestock({ days_before: Number(e.target.value) })} disabled={!canManage} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="SMS the customer" checked={a.restock.customer_sms} onChange={(v) => setRestock({ customer_sms: v })} disabled={!canManage} />
            <Toggle label="Bell alert to attendants and the rep" checked={a.restock.staff_inapp} onChange={(v) => setRestock({ staff_inapp: v })} disabled={!canManage} />
          </div>
          <p className="text-xs text-muted-foreground">Set each product's interval on the item (Items → edit → Repurchase every … days).</p>
        </div>
      </Panel>
      <Panel title="Sending time" icon={Bell}>
        <Field label="Send from (hour, Nairobi time)" hint="Alerts go out between this hour and 8 pm, never at night.">
          <select className="fi w-40" value={a.send_hour} onChange={(e) => setA({ ...a, send_hour: Number(e.target.value) })} disabled={!canManage}>
            {[7, 8, 9, 10, 11, 12, 14, 16].map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </Field>
      </Panel>
      {canManage && <div className="flex justify-end"><Button onClick={submit}>Save alert rules</Button></div>}
    </div>
  );
}

/* ─────────────────────────── Active sessions ─────────────────────────── */

function device(ua?: string | null) {
  const u = String(ua || "");
  const os = /Android/i.test(u) ? "Android" : /iPhone|iPad/i.test(u) ? "iPhone / iPad" : /Windows/i.test(u) ? "Windows" : /Mac OS/i.test(u) ? "Mac" : /Linux/i.test(u) ? "Linux" : "Unknown device";
  const br = /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "";
  return { label: br ? `${br} on ${os}` : os, mobile: /Android|iPhone|iPad|Mobile/i.test(u) };
}
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Who is signed in to the business right now, with remote sign-out (owner only). */
export function SessionsTab() {
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["team-sessions"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("team_active_sessions");
      if (error) throw error;
      return data as any[];
    },
  });
  if (isLoading) return <OrbLoader label="Loading sign-ins…" />;
  if (error) return <EmptyState icon={ShieldCheck} title="Owner only" description={(error as any).message} />;
  const end = async (s: any) => {
    if (!(await confirmAction({ title: `Sign ${s.display_name || "this person"} out?`, message: "They are signed out on that device within a minute and must sign in again.", danger: true, confirmLabel: "Sign out" }))) return;
    const { error } = await sb.rpc("team_end_session", { p_session: s.session_id });
    if (error) return toast({ title: "Not signed out", description: error.message, variant: "destructive" });
    toast({ title: "Signed out" });
    refetch();
  };
  const activeNow = data.filter((s) => Date.now() - Date.parse(s.refreshed_at) < 75 * 60000);
  return (
    <Panel flush title="Active sessions" icon={ShieldCheck} description={`${activeNow.length} active in the last hour · ${data.length} signed-in devices`}>
      {data.length === 0 ? <EmptyState icon={Monitor} title="Nobody is signed in" /> : (
        <ul className="divide-y divide-border">{data.map((s) => {
          const d = device(s.user_agent);
          const live = Date.now() - Date.parse(s.refreshed_at) < 75 * 60000;
          return (
            <li key={s.session_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-muted">{d.mobile ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
                <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card", live ? "bg-success" : "bg-muted-foreground/40")} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.display_name || "Team member"} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{String(s.role || "").replace("_", " ")}</span>{(s.is_current || s.user_id === user?.id) && s.is_current ? <span className="ml-1 text-xs font-semibold text-primary">This device</span> : null}</p>
                <p className="text-xs text-muted-foreground">{d.label}{s.ip ? ` · ${s.ip}` : ""} · signed in {new Date(s.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · active {ago(s.refreshed_at)}</p>
              </div>
              {!s.is_current && <Button size="sm" variant="outline" onClick={() => end(s)}><LogOut /> Sign out</Button>}
            </li>
          );
        })}</ul>
      )}
    </Panel>
  );
}

