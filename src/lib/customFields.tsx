import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { fmtDate } from "@/lib/doc-pdf";

const sb: any = supabase;

export type CustomEntity = "customer" | "supplier" | "item" | "quote" | "sales_order" | "invoice" | "purchase_order" | "bill";
export type CustomField = {
  id: string; entity: CustomEntity; label: string; field_type: "text" | "number" | "date" | "dropdown" | "checkbox";
  options: string[]; required: boolean; show_on_pdf: boolean; is_active: boolean; sort: number;
};
export type CustomValues = Record<string, unknown>;

export const CUSTOM_ENTITIES: { value: CustomEntity; label: string }[] = [
  { value: "customer", label: "Customers" }, { value: "supplier", label: "Suppliers" }, { value: "item", label: "Items" },
  { value: "quote", label: "Quotations" }, { value: "sales_order", label: "Sales orders" }, { value: "invoice", label: "Invoices" },
  { value: "purchase_order", label: "Purchase orders" }, { value: "bill", label: "Bills" },
];

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || v === false;

/** All of a company's fields for one kind of record, in order. */
export function useCustomFields(entity: CustomEntity) {
  const tenantId = useTenantId();
  const { data = [] } = useQuery({
    queryKey: ["custom-fields", tenantId], enabled: !!tenantId, staleTime: 10 * 60_000,
    queryFn: async () => ((await sb.from("custom_fields").select("*").eq("tenant_id", tenantId).order("sort").order("created_at")).data || []) as CustomField[],
    select: (rows: CustomField[]) => rows,
  });
  return data.filter((f) => f.entity === entity && f.is_active);
}

/** The first required field left empty, to stop a save. */
export function missingCustomField(fields: CustomField[], values: CustomValues | null | undefined) {
  return fields.find((f) => f.required && isBlank(values?.[f.id]))?.label ?? null;
}

export function customFieldText(f: Pick<CustomField, "field_type">, v: unknown): string {
  if (isBlank(v)) return "";
  if (f.field_type === "checkbox") return "Yes";
  if (f.field_type === "date") return fmtDate(String(v));
  if (f.field_type === "number") return Number(v).toLocaleString("en-KE");
  return String(v);
}

/** The company's fields as inputs. Renders nothing until the company has added one. */
export function CustomFieldInputs({ entity, values, onChange, className }: { entity: CustomEntity; values: CustomValues | null | undefined; onChange: (next: CustomValues) => void; className?: string }) {
  const fields = useCustomFields(entity);
  if (!fields.length) return null;
  const v = values || {};
  const set = (id: string, x: unknown) => onChange({ ...v, [id]: x });
  return (
    <div className={className ?? "grid gap-3 sm:grid-cols-2"}>
      {fields.map((f) => (
        <label key={f.id} className="block text-sm">
          {f.field_type !== "checkbox" && <span className="mb-1 block font-medium">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>}
          {f.field_type === "checkbox" ? (
            <span className="flex h-10 items-center gap-2 font-medium"><input type="checkbox" checked={!!v[f.id]} onChange={(e) => set(f.id, e.target.checked)} />{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
          ) : f.field_type === "dropdown" ? (
            <select className="fi" value={String(v[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)}>
              <option value="">Select</option>
              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className="fi" type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"} value={String(v[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

/** The filled-in fields on a record's page. */
export function CustomFieldsView({ entity, values, className }: { entity: CustomEntity; values: CustomValues | null | undefined; className?: string }) {
  const fields = useCustomFields(entity).filter((f) => !isBlank(values?.[f.id]));
  if (!fields.length) return null;
  return (
    <dl className={className ?? "grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2"}>
      {fields.map((f) => (
        <div key={f.id} className="flex justify-between gap-3 py-0.5">
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className="text-right font-medium">{customFieldText(f, values?.[f.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lines for a printed document: only fields the company chose to print, and only when filled in. */
export async function customPdfMeta(tenantId: string | null | undefined, entity: CustomEntity, values: CustomValues | null | undefined, db: any = sb) {
  if (!tenantId || !values || !Object.keys(values).length) return [];
  const { data } = await db.from("custom_fields").select("id,label,field_type").eq("tenant_id", tenantId).eq("entity", entity).eq("is_active", true).eq("show_on_pdf", true).order("sort").order("created_at");
  return ((data || []) as Pick<CustomField, "id" | "label" | "field_type">[])
    .filter((f) => !isBlank(values[f.id]))
    .map((f) => ({ label: f.label, value: customFieldText(f, values[f.id]) }));
}
