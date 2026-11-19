import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import type { FieldDef, KindDef, RecordColumn } from "./types";

const sb = supabase as any;

export interface AppRecord {
  id: string;
  tenant_id: string;
  app: string;
  kind: string;
  number: string | null;
  title: string;
  stage: string | null;
  priority: string | null;
  data: Record<string, any>;
  customer_id: string | null;
  supplier_id: string | null;
  employee_id: string | null;
  product_id: string | null;
  parent_id: string | null;
  assigned_to: string | null;
  amount: number | null;
  quantity: number | null;
  starts_at: string | null;
  ends_at: string | null;
  due_date: string | null;
  tags: string[];
  sort: number;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordEvent {
  id: string;
  record_id: string;
  kind: string;
  body: string | null;
  data: Record<string, any>;
  created_by: string | null;
  created_at: string;
}

export const recordsKey = (app: string, kind: string) => ["app-records", app, kind];

export function useRecords(app: string, kind: string, opts: { parentId?: string | null; archived?: boolean; enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: [...recordsKey(app, kind), tenantId, opts.parentId || null, !!opts.archived],
    enabled: !!tenantId && opts.enabled !== false,
    queryFn: async (): Promise<AppRecord[]> => {
      let q = sb.from("app_records").select("*").eq("app", app).eq("kind", kind).eq("archived", !!opts.archived)
        .order("sort", { ascending: true }).order("created_at", { ascending: false }).limit(2000);
      if (opts.parentId) q = q.eq("parent_id", opts.parentId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useRecordEvents(recordId: string | null) {
  return useQuery({
    queryKey: ["app-record-events", recordId],
    enabled: !!recordId,
    queryFn: async (): Promise<RecordEvent[]> => {
      const { data, error } = await sb.from("app_record_events").select("*").eq("record_id", recordId).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

const NATIVE: RecordColumn[] = ["title", "stage", "priority", "customer_id", "supplier_id", "employee_id", "product_id", "assigned_to", "parent_id", "amount", "quantity", "starts_at", "ends_at", "due_date"];

/** Reads a field's value from a record (native column or data). */
export function fieldValue(rec: Partial<AppRecord> | null | undefined, field: FieldDef): any {
  if (!rec) return undefined;
  if (field.column) return (rec as any)[field.column];
  return rec.data?.[field.key];
}

/** Builds the row to save from form values. */
export function toRow(kind: KindDef, values: Record<string, any>, base: Partial<AppRecord> = {}) {
  const row: Record<string, any> = { title: String(values.title ?? base.title ?? "").trim(), data: { ...(base.data || {}) } };
  if (values.stage !== undefined) row.stage = values.stage;
  for (const f of kind.fields) {
    let v = values[f.key];
    if (v === "") v = null;
    if (["number", "money", "percent", "rating"].includes(f.type) && v !== null && v !== undefined) v = Number(v);
    if (f.column && NATIVE.includes(f.column)) row[f.column] = v ?? null;
    else row.data[f.key] = v ?? null;
  }
  return row;
}

export async function saveRecord(app: string, kind: KindDef, values: Record<string, any>, existing?: AppRecord | null) {
  const row = toRow(kind, values, existing || {});
  if (!row.title) row.title = kind.label;
  if (existing) {
    const { data, error } = await sb.from("app_records").update(row).eq("id", existing.id).select("*").single();
    if (error) throw error;
    return data as AppRecord;
  }
  const insert = { ...row, app, kind: kind.key, stage: row.stage ?? kind.stages?.[0]?.key ?? null, data: { ...row.data, ...(kind.prefix ? { _prefix: kind.prefix } : {}) } };
  const { data, error } = await sb.from("app_records").insert(insert).select("*").single();
  if (error) throw error;
  return data as AppRecord;
}

export async function setStage(rec: AppRecord, stage: string, label?: string) {
  const { error } = await sb.from("app_records").update({ stage }).eq("id", rec.id);
  if (error) throw error;
  await sb.from("app_record_events").insert({ record_id: rec.id, kind: "stage", body: `Moved to ${label || stage}`, data: { from: rec.stage, to: stage } });
}

export async function addComment(recordId: string, body: string) {
  const { error } = await sb.from("app_record_events").insert({ record_id: recordId, kind: "comment", body });
  if (error) throw error;
}

export async function archiveRecord(id: string, archived = true) {
  const { error } = await sb.from("app_records").update({ archived }).eq("id", id);
  if (error) throw error;
}

export async function deleteRecord(id: string) {
  const { error } = await sb.from("app_records").delete().eq("id", id);
  if (error) throw error;
}

/* --------------------------------------------------------------- lookups */

export interface Option { id: string; label: string; sub?: string }

export function useLookup(type: "customer" | "supplier" | "employee" | "product" | "user", enabled = true) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["app-lookup", type, tenantId],
    enabled: enabled && !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<Option[]> => {
      if (type === "customer") {
        const { data } = await sb.from("customers").select("id, name, phone, company_name").order("name").limit(5000);
        return (data || []).map((r: any) => ({ id: r.id, label: r.name || r.company_name || "Customer", sub: r.phone || r.company_name || "" }));
      }
      if (type === "supplier") {
        const { data } = await sb.from("suppliers").select("id, name, phone").order("name").limit(5000);
        return (data || []).map((r: any) => ({ id: r.id, label: r.name, sub: r.phone || "" }));
      }
      if (type === "employee") {
        const { data } = await sb.from("hr_employees").select("id, first_name, last_name, employee_no").order("first_name").limit(5000);
        return (data || []).map((r: any) => ({ id: r.id, label: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Employee", sub: r.employee_no || "" }));
      }
      if (type === "product") {
        const { data } = await sb.from("products").select("id, name, sku, stock").eq("is_active", true).order("name").limit(5000);
        return (data || []).map((r: any) => ({ id: r.id, label: r.name, sub: [r.sku, r.stock != null ? `${r.stock} in stock` : ""].filter(Boolean).join(" · ") }));
      }
      const { data } = await sb.from("profiles").select("user_id, display_name").eq("tenant_id", tenantId).order("display_name");
      return (data || []).map((r: any) => ({ id: r.user_id, label: r.display_name || "User" }));
    },
  });
}

export function useRecordOptions(app: string, kind: string, enabled = true) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["app-record-options", app, kind, tenantId],
    enabled: enabled && !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<Option[]> => {
      const { data } = await sb.from("app_records").select("id, number, title").eq("app", app).eq("kind", kind).eq("archived", false).order("created_at", { ascending: false }).limit(2000);
      return (data || []).map((r: any) => ({ id: r.id, label: r.title || r.number || "Record", sub: r.number || "" }));
    },
  });
}
