import { useEffect, useState } from "react";
import { Save, Clock, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Field } from "@/components/kit";

const IDLE_OPTIONS = [
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 360, label: "6 hours" },
  { value: 480, label: "8 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "1 day" },
];

const DAILY_OPTIONS = [
  { value: "off", label: "Never (no daily sign-out)" },
  { value: "00:00", label: "12:00 AM (midnight)" },
  { value: "02:00", label: "2:00 AM" },
  { value: "03:00", label: "3:00 AM" },
  { value: "04:00", label: "4:00 AM" },
  { value: "05:00", label: "5:00 AM" },
  { value: "06:00", label: "6:00 AM" },
];

interface Props {
  /** "tenant" reads/writes business_settings; "admin" reads/writes platform_settings.session */
  scope: "tenant" | "admin";
  canManage: boolean;
}

export default function SessionSettingsTab({ scope, canManage }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [idle, setIdle] = useState(60);
  const [daily, setDaily] = useState("04:00");
  const [warn, setWarn] = useState(60);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (scope === "tenant" && profile?.tenant_id) {
        const { data } = await supabase
          .from("business_settings")
          .select("idle_timeout_minutes, daily_logout_time, session_warning_seconds")
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle();
        if (data) {
          setIdle((data as any).idle_timeout_minutes ?? 60);
          setDaily((data as any).daily_logout_time ?? "04:00");
          setWarn((data as any).session_warning_seconds ?? 60);
        }
      } else if (scope === "admin") {
        const { data } = await supabase
          .from("platform_settings")
          .select("value")
          .eq("key", "session")
          .maybeSingle();
        const v = (data?.value as any) || {};
        setIdle(v.idle_timeout_minutes ?? 60);
        setDaily(v.daily_logout_time ?? "04:00");
        setWarn(v.session_warning_seconds ?? 60);
      }
      setLoading(false);
    })();
  }, [scope, profile?.tenant_id]);

  const save = async () => {
    setSaving(true);
    try {
      if (scope === "tenant") {
        if (!profile?.tenant_id) throw new Error("No tenant");
        const { error } = await supabase
          .from("business_settings")
          .update({
            idle_timeout_minutes: idle,
            daily_logout_time: daily,
            session_warning_seconds: warn,
          } as any)
          .eq("tenant_id", profile.tenant_id);
        if (error) throw error;
      } else {
        const value = { idle_timeout_minutes: idle, daily_logout_time: daily, session_warning_seconds: warn };
        const { data: existing } = await supabase
          .from("platform_settings")
          .select("id")
          .eq("key", "session")
          .maybeSingle();
        const { error } = existing
          ? await supabase.from("platform_settings").update({ value, updated_at: new Date().toISOString() } as any).eq("key", "session")
          : await supabase.from("platform_settings").insert({ key: "session", value } as any);
        if (error) throw error;
      }
      toast({ title: "Session settings saved", description: "New rules apply on next page load." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isAdmin = scope === "admin";

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-muted/30 p-5">
          <div className="mb-2 flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Idle timeout</h4></div>
          <p className="mb-4 text-xs text-muted-foreground">
            {isAdmin ? "Sign the admin out after this long with no keyboard, mouse or touch activity." : "Sign users out after this long with no keyboard, mouse or touch activity."}
          </p>
          <div className="space-y-3">
            <Field label="Sign out after">
              <select value={idle} onChange={(e) => setIdle(Number(e.target.value))} disabled={!canManage} className="fi">
                {IDLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Warn before signing out">
              <select value={warn} onChange={(e) => setWarn(Number(e.target.value))} disabled={!canManage} className="fi">
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-5">
          <div className="mb-2 flex items-center gap-2"><Sunrise className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Daily reset</h4></div>
          <p className="mb-4 text-xs text-muted-foreground">Sign out at this local time every day, so a forgotten session doesn't stay open overnight.</p>
          <Field label="Daily sign-out time">
            <select value={daily} onChange={(e) => setDaily(e.target.value)} disabled={!canManage} className="fi">
              {DAILY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
      {canManage && (
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
