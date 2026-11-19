import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export const sb: any = supabase;

/** The 12 tag / record colours (index 0 = none). */
export const TAG_COLORS = ["transparent", "#F06050", "#F4A460", "#F7CD1F", "#6CC1ED", "#814968", "#EB7E7F", "#2C8397", "#475577", "#D6145F", "#30C381", "#9365B8"];
export const COLOR_NAMES = ["No color", "Red", "Orange", "Yellow", "Cyan", "Purple", "Almond", "Teal", "Blue", "Raspberry", "Green", "Violet"];

export type Stage = { id: string; name: string; sequence: number; is_won: boolean; fold: boolean; requirements?: string | null };
export type Tag = { id: string; name: string; color: number };
export type Lead = {
  id: string; tenant_id: string; type: "lead" | "opportunity"; name: string; partner_name: string | null; contact_name: string | null;
  customer_id: string | null; email: string | null; phone: string | null; mobile: string | null; website: string | null; street: string | null; city: string | null;
  country: string | null; salesperson_id: string | null; team_id: string | null; stage_id: string | null; probability: number; expected_revenue: number;
  date_deadline: string | null; priority: number; tag_ids: string[]; color: number; description: string | null; source: string | null; medium: string | null;
  campaign: string | null; referred: string | null; active: boolean; won_status: "pending" | "won" | "lost"; lost_reason_id: string | null; lost_feedback: string | null;
  date_closed: string | null; date_conversion: string | null; date_last_stage_update: string; sequence: number; created_at: string; updated_at: string;
};
export type Activity = { id: string; lead_id: string; type_id: string | null; summary: string | null; note: string | null; due_date: string; assigned_to: string | null; done: boolean; created_at: string };

export function useCrmConfig() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["crm-config", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [stages, tags, lost, types, teams, staff] = await Promise.all([
        sb.from("crm_stages").select("*").eq("tenant_id", tenantId).order("sequence"),
        sb.from("crm_tags").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("crm_lost_reasons").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("crm_activity_types").select("*").eq("tenant_id", tenantId).order("sequence"),
        sb.from("crm_teams").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("profiles").select("user_id, display_name").eq("tenant_id", tenantId).order("display_name"),
      ]);
      return {
        stages: (stages.data || []) as Stage[],
        tags: (tags.data || []) as Tag[],
        lostReasons: (lost.data || []) as { id: string; name: string; active: boolean }[],
        activityTypes: (types.data || []) as { id: string; name: string; icon: string; default_days: number; sequence: number; active: boolean }[],
        teams: (teams.data || []) as { id: string; name: string; leader_id: string | null; member_ids: string[]; invoiced_target: number; active: boolean }[],
        users: (staff.data || []) as { user_id: string; display_name: string }[],
      };
    },
  });
}

export function useLeads(type: "lead" | "opportunity" | "all" = "opportunity", includeArchived = false) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["crm-leads", tenantId, type, includeArchived],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = sb.from("crm_leads").select("*").eq("tenant_id", tenantId).order("sequence").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(2000);
      if (type !== "all") q = q.eq("type", type);
      if (!includeArchived) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Lead[];
    },
  });
}

export function useOpenActivities() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["crm-activities", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("crm_activities").select("*").eq("tenant_id", tenantId).eq("done", false).order("due_date")).data || []) as Activity[],
  });
}

export function useCrmInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["crm-leads"] });
    qc.invalidateQueries({ queryKey: ["crm-activities"] });
    qc.invalidateQueries({ queryKey: ["crm-lead"] });
    qc.invalidateQueries({ queryKey: ["crm-chatter"] });
  };
}

const today = () => new Date().toISOString().slice(0, 10);
export type ActState = "overdue" | "today" | "planned" | "none";
/** Activity state of a record: its most urgent open activity. */
export function activityState(acts: Activity[] | undefined): ActState {
  if (!acts?.length) return "none";
  const t = today();
  if (acts.some((a) => a.due_date < t)) return "overdue";
  if (acts.some((a) => a.due_date === t)) return "today";
  return "planned";
}
export const STATE_COLOR: Record<ActState, string> = { overdue: "#D9534F", today: "#F0AD4E", planned: "#28A745", none: "hsl(var(--muted-foreground) / 0.35)" };

export const money0 = (n: number) => `KES ${Math.round(n).toLocaleString("en-US")}`;
export const initials = (name?: string | null) => String(name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
