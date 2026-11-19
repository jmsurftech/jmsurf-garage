import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTenantId } from "@/hooks/useTenantId";
import { useStaff } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { sb, must } from "./api";
import { reminderSettings } from "./reminders";

export const JOB_SELECT = "*, vehicle:garage_vehicles(id,plate,make,model,year,colour,vehicle_type), customer:customers(id,name,phone,email)";

/** Invalidates every workshop query (after a save). */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] || "").startsWith("gw-") });
}

/** Live updates: refreshes workshop lists when jobs, lines or bookings change in the company. */
export function useLiveWorkshop() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  useEffect(() => {
    if (!tenantId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] || "").startsWith("gw-") }), 600); };
    const ch = (supabase as any).channel(`gw-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "garage_jobs", filter: `tenant_id=eq.${tenantId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "garage_job_lines", filter: `tenant_id=eq.${tenantId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "garage_bookings", filter: `tenant_id=eq.${tenantId}` }, bump)
      .subscribe();
    return () => { if (t) clearTimeout(t); (supabase as any).removeChannel(ch); };
  }, [tenantId, qc]);
}

export function useGarageSettings() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-settings", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const row = must(await sb.from("garage_settings").select("*").eq("tenant_id", tenantId).maybeSingle()) as any;
      return { tenant_id: tenantId, qc_checklist: [], booking_services: [], open_days: [1, 2, 3, 4, 5, 6], open_hour: 8, close_hour: 17, slot_minutes: 60, service_interval_months: 6, service_interval_km: 5000, estimate_valid_days: 14, labour_rate: 0, ...(row || {}), reminders: reminderSettings(row?.reminders), _saved: !!row };
    },
  });
}

export async function saveGarageSettings(tenantId: string, patch: Record<string, unknown>) {
  const { _saved, ...rest } = patch as any;
  void _saved;
  must(await sb.from("garage_settings").upsert({ ...rest, tenant_id: tenantId }, { onConflict: "tenant_id" }));
}

export function useBays() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-bays", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_bays").select("*").eq("tenant_id", tenantId).order("sort").order("name")) as any[],
  });
}

/** Staff who can be picked as mechanics (everyone on the company; names first). */
export function useMechanics() {
  const { data: staff = [] } = useStaff();
  const list = (staff as any[]).map((s) => ({ id: s.user_id as string, name: (s.display_name || s.email || "Staff") as string, role: s.role as string }));
  const nameOf = (id?: string | null) => list.find((m) => m.id === id)?.name || "";
  return { list, nameOf };
}

export function useJobs(filter: { status?: string[]; open?: boolean; vehicleId?: string; customerId?: string; limit?: number; since?: string } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-jobs", tenantId, filter], enabled: !!tenantId,
    queryFn: async () => {
      let q = sb.from("garage_jobs").select(JOB_SELECT).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(filter.limit || 500);
      if (filter.status?.length) q = q.in("status", filter.status);
      if (filter.open) q = q.not("status", "in", "(collected,cancelled)");
      if (filter.vehicleId) q = q.eq("vehicle_id", filter.vehicleId);
      if (filter.customerId) q = q.eq("customer_id", filter.customerId);
      if (filter.since) q = q.gte("created_at", filter.since);
      return must(await q) as any[];
    },
  });
}

export function useJob(id?: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-job", id], enabled: !!tenantId && !!id,
    queryFn: async () => {
      const [job, lines, events, media, parts, estimates, invoices, logs, inspections] = await Promise.all([
        sb.from("garage_jobs").select(JOB_SELECT).eq("id", id).maybeSingle(),
        sb.from("garage_job_lines").select("*").eq("job_id", id).order("sort").order("created_at"),
        sb.from("garage_job_events").select("*").eq("job_id", id).order("at"),
        sb.from("garage_job_media").select("*").eq("job_id", id).order("created_at"),
        sb.from("garage_part_requests").select("*").eq("job_id", id).order("requested_at"),
        sb.from("garage_estimates").select("*").eq("job_id", id).order("version", { ascending: false }),
        sb.from("garage_job_invoices").select("*, invoice:invoices(id,invoice_number,total,amount_paid,status,etims_status,customer_name)").eq("job_id", id),
        sb.from("garage_time_logs").select("*").eq("job_id", id).order("started_at"),
        sb.from("garage_inspections").select("*").eq("job_id", id).order("created_at"),
      ]);
      const j = must(job) as any;
      if (!j) return null;
      return {
        job: j, lines: must(lines) as any[], events: must(events) as any[], media: must(media) as any[], parts: must(parts) as any[],
        estimates: must(estimates) as any[], invoices: must(invoices) as any[], logs: must(logs) as any[], inspections: must(inspections) as any[],
      };
    },
  });
}

export function useVehicles(search = "") {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-vehicles", tenantId, search], enabled: !!tenantId,
    queryFn: async () => {
      let q = sb.from("garage_vehicles").select("*, customer:customers(id,name,phone)").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(300);
      const s = search.trim();
      if (s) {
        const plate = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        q = q.or(`plate.ilike.%${plate || s}%,make.ilike.%${s}%,model.ilike.%${s}%,vin.ilike.%${plate || s}%`);
      }
      return must(await q) as any[];
    },
  });
}

export function useVehicle(id?: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-vehicle", id], enabled: !!tenantId && !!id,
    queryFn: async () => {
      const [v, owners, miles, jobs, media] = await Promise.all([
        sb.from("garage_vehicles").select("*, customer:customers(id,name,phone,email,garage_reminders_ok,garage_offers_ok)").eq("id", id).maybeSingle(),
        sb.from("garage_vehicle_owners").select("*, customer:customers(id,name,phone)").eq("vehicle_id", id).order("from_date", { ascending: false }),
        sb.from("garage_mileage_log").select("*").eq("vehicle_id", id).order("recorded_at", { ascending: false }).limit(50),
        sb.from("garage_jobs").select("id,job_no,status,job_type,complaint,approved_total,created_at,mileage_in,comeback_of").eq("vehicle_id", id).order("created_at", { ascending: false }),
        sb.from("garage_job_media").select("*").eq("vehicle_id", id).order("created_at", { ascending: false }).limit(30),
      ]);
      return { vehicle: must(v) as any, owners: must(owners) as any[], miles: must(miles) as any[], jobs: must(jobs) as any[], media: must(media) as any[] };
    },
  });
}

export function useBookings(from: string, to: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-bookings", tenantId, from, to], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_bookings").select("*").eq("tenant_id", tenantId).gte("starts_at", from).lt("starts_at", to).order("starts_at")) as any[],
  });
}

export function useServiceMenus() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-menus", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_service_menus").select("*").eq("tenant_id", tenantId).eq("active", true).order("name")) as any[],
  });
}

export function useInspectionTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-insp-templates", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_inspection_templates").select("*").eq("tenant_id", tenantId).order("name")) as any[],
  });
}

export function useJobTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-job-templates", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_job_templates").select("*").eq("tenant_id", tenantId).order("name")) as any[],
  });
}

/** Adds one line to the job event history (notes, parts, messages). */
export async function logEvent(tenantId: string, jobId: string, kind: string, note: string) {
  await sb.from("garage_job_events").insert({ tenant_id: tenantId, job_id: jobId, kind, note });
}
