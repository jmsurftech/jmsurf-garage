/**
 * Data helpers shared by the specialist modules. Records live in the record
 * engine (app_records, app = module key); vehicles and job cards are the
 * workshop's garage_vehicles / garage_jobs; bills go through sales invoices.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import type { AppRecord } from "@/apps/data";
import { normalisePlate } from "../lib/calc";

export const sb = supabase as any;
export type Rec = AppRecord;

export const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const today = () => new Date().toISOString().slice(0, 10);

/** Records of one kind (optionally children of a parent). */
export function useRecs(app: string, kind: string, opts: { parentId?: string | null; enabled?: boolean; archived?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["app-records", app, kind, tenantId, opts.parentId || null, !!opts.archived, "sp"],
    enabled: !!tenantId && opts.enabled !== false && (opts.parentId === undefined || !!opts.parentId),
    queryFn: async (): Promise<Rec[]> => {
      let q = sb.from("app_records").select("*").eq("app", app).eq("kind", kind).eq("archived", !!opts.archived).order("created_at", { ascending: false }).limit(3000);
      if (opts.parentId) q = q.eq("parent_id", opts.parentId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

/** One record by id. */
export function useRec(id: string | null | undefined) {
  return useQuery({
    queryKey: ["app-record", id],
    enabled: !!id,
    queryFn: async (): Promise<Rec | null> => {
      const { data, error } = await sb.from("app_records").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Refreshes every record list of an app and the open record. */
export function useRefresh() {
  const qc = useQueryClient();
  return (app?: string, id?: string | null) => {
    void qc.invalidateQueries({ queryKey: app ? ["app-records", app] : ["app-records"] });
    if (id) void qc.invalidateQueries({ queryKey: ["app-record", id] });
  };
}

/** Creates a record. `prefix` numbers it (CLM-00001…). */
export async function insertRec(app: string, kind: string, row: Partial<Rec> & { title: string }, prefix?: string): Promise<Rec> {
  const insert = { ...row, app, kind, data: { ...(row.data || {}), ...(prefix ? { _prefix: prefix } : {}) } };
  const { data, error } = await sb.from("app_records").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

/** Updates native columns and merges `data` (reads the latest data first so parallel edits are kept). */
export async function patchRec(id: string, patch: { data?: Record<string, any> } & Partial<Omit<Rec, "data">>): Promise<Rec> {
  const { data: cur } = await sb.from("app_records").select("data").eq("id", id).maybeSingle();
  const { data: dataPatch, ...cols } = patch;
  const row: Record<string, any> = { ...cols };
  if (dataPatch) row.data = { ...(cur?.data || {}), ...dataPatch };
  const { data, error } = await sb.from("app_records").update(row).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

/** A line on the record's activity timeline. */
export async function logEvent(recordId: string, body: string, kind: "system" | "comment" | "stage" = "system", data: Record<string, any> = {}) {
  await sb.from("app_record_events").insert({ record_id: recordId, kind, body, data }).then(() => undefined, () => undefined);
}

export async function moveStage(rec: Rec, stage: string, label?: string) {
  if (rec.stage === stage) return;
  const { error } = await sb.from("app_records").update({ stage }).eq("id", rec.id);
  if (error) throw error;
  await logEvent(rec.id, `Moved to ${label || stage}`, "stage", { from: rec.stage, to: stage });
}

/** Random token for no-login links (fleet portal, driver check, pre-order status). */
export function newToken(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------ settings */

/** One settings record per module (app_records kind "settings"). */
export function useModuleSettings<T extends Record<string, any>>(app: string, defaults: T) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sp-settings", app, tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await sb.from("app_records").select("id, data").eq("app", app).eq("kind", "settings").order("created_at").limit(1);
      return (data || [])[0] || null;
    },
  });
  const saved = (q.data?.data || {}) as Partial<T>;
  const value = { ...defaults, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== null && v !== undefined)) } as T;
  const save = async (next: Partial<T>) => {
    if (q.data?.id) await patchRec(q.data.id, { data: next });
    else await insertRec(app, "settings", { title: "Settings", data: next as any });
    await qc.invalidateQueries({ queryKey: ["sp-settings", app] });
  };
  return { value, saved, loading: q.isLoading, save };
}

/* ------------------------------------------------------------ customers */

export function useCustomers() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["sp-customers", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => ((await sb.from("customers").select("id, name, phone, email, company_name").order("name").limit(5000)).data || []) as { id: string; name: string; phone: string | null; email: string | null; company_name: string | null }[],
  });
}

/** Finds a customer by phone or creates one (wash bay, towing call-outs). */
export async function customerByPhone(tenantId: string, phone: string, name?: string): Promise<string | null> {
  const p = String(phone || "").replace(/\s+/g, "");
  if (!p) return null;
  const tail = p.replace(/\D/g, "").slice(-9);
  const { data } = await sb.from("customers").select("id, phone").ilike("phone", `%${tail}`).limit(1);
  if (data?.[0]?.id) return data[0].id;
  const { data: made, error } = await sb.from("customers").insert({ tenant_id: tenantId, name: name?.trim() || p, phone: p }).select("id").single();
  if (error) throw error;
  return made.id;
}

/* ------------------------------------------------------------ vehicles (workshop) */

export interface Vehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  customer_id: string | null;
  mileage: number | null;
  insurance_expiry: string | null;
  inspection_expiry: string | null;
}

export const vehicleLabel = (v?: Partial<Vehicle> | null) => (v ? [v.plate, [v.make, v.model].filter(Boolean).join(" "), v.year].filter(Boolean).join(" · ") : "");

export function useVehicles(enabled = true) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["sp-vehicles", tenantId],
    enabled: enabled && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<Vehicle[]> => {
      const { data, error } = await sb.from("garage_vehicles").select("id, plate, make, model, year, vin, customer_id, mileage, insurance_expiry, inspection_expiry").order("plate").limit(5000);
      if (error) return [];
      return data || [];
    },
  });
}

/** Finds the vehicle by plate or adds it to the workshop's vehicle list. */
export async function ensureVehicle(tenantId: string, v: { plate: string; make?: string | null; model?: string | null; year?: number | null; vin?: string | null; customer_id?: string | null; mileage?: number | null }): Promise<string> {
  const plate = normalisePlate(v.plate);
  if (!plate) throw new Error("Enter the number plate");
  const { data: hit } = await sb.from("garage_vehicles").select("id").eq("plate", plate).limit(1);
  if (hit?.[0]?.id) return hit[0].id;
  const row: Record<string, any> = { tenant_id: tenantId, plate };
  for (const k of ["make", "model", "year", "vin", "customer_id", "mileage"] as const) if (v[k] !== undefined && v[k] !== null && v[k] !== "") row[k] = v[k];
  const { data, error } = await sb.from("garage_vehicles").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/* ------------------------------------------------------------ workshop job cards */

export type JobType = "mechanical" | "body_paint" | "tyres" | "wash" | "towing" | "inspection" | "prep" | "warranty";

/**
 * Sends work to the workshop: a job card in garage_jobs (status "booked") that remembers where it
 * came from in `source`, e.g. { module: "insurance", claim_id }.
 */
export async function sendToWorkshop(tenantId: string, input: {
  vehicle_id: string; customer_id?: string | null; job_type: JobType; source: Record<string, any>; complaint?: string; payer_split?: Record<string, any> | null;
}): Promise<{ id: string; job_no: string | null }> {
  const row: Record<string, any> = {
    tenant_id: tenantId, vehicle_id: input.vehicle_id, customer_id: input.customer_id || null, status: "booked",
    job_type: input.job_type, source: input.source, complaint: input.complaint || null,
  };
  if (input.payer_split) row.payer_split = input.payer_split;
  const { data, error } = await sb.from("garage_jobs").insert(row).select("id, job_no").single();
  if (error) throw error;
  return data;
}

export interface JobRow { id: string; job_no: string | null; status: string; job_type: string; vehicle_id: string | null; customer_id: string | null; invoice_id: string | null; created_at: string; source: any; complaint: string | null }

/** Job cards that came from a record (source->>key = id). */
export function useJobsFrom(key: string, id: string | null | undefined) {
  return useQuery({
    queryKey: ["sp-jobs", key, id],
    enabled: !!id,
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await sb.from("garage_jobs").select("id, job_no, status, job_type, vehicle_id, customer_id, invoice_id, created_at, source, complaint").eq(`source->>${key}`, id).order("created_at", { ascending: false });
      if (error) return [];
      return data || [];
    },
  });
}

/** Cost of job cards (sum of their lines) — prep costs on a yard car, fleet spend. */
export async function jobsCost(jobIds: string[]): Promise<Record<string, number>> {
  if (!jobIds.length) return {};
  const { data } = await sb.from("garage_job_lines").select("job_id, qty, rate").in("job_id", jobIds);
  const out: Record<string, number> = {};
  for (const l of data || []) out[l.job_id] = (out[l.job_id] || 0) + num(l.qty) * num(l.rate);
  return out;
}

/** Invoices by id (status and balance for claims, fleets, sales). */
export function useInvoices(ids: (string | null | undefined)[]) {
  const list = Array.from(new Set(ids.filter(Boolean))) as string[];
  return useQuery({
    queryKey: ["sp-invoices", list.sort().join(",")],
    enabled: list.length > 0,
    queryFn: async () => {
      const { data } = await sb.from("invoices").select("id, invoice_number, status, total, amount_paid, issue_date, due_date, customer_id, customer_name").in("id", list);
      return new Map<string, any>((data || []).map((r: any) => [r.id, r]));
    },
  });
}
