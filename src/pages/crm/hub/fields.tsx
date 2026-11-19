import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadModule, optionLabel, sb, STAGES, type FieldDef, type ModuleDef } from "./modules";

/** People who can own CRM records, accounts and contacts for pickers and labels. */
export function useLookups() {
  const tenantId = useTenantId();
  const { data } = useQuery({
    queryKey: ["crm-hub-lookups", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [users, accounts, contacts] = await Promise.all([
        sb.from("profiles").select("user_id,display_name,status").eq("tenant_id", tenantId).order("display_name"),
        sb.from("customers").select("id,name").eq("tenant_id", tenantId).order("name").limit(5000),
        sb.from("crm_contacts").select("id,first_name,last_name,account_id,email").eq("tenant_id", tenantId).order("last_name").limit(5000),
      ]);
      const people = ((users.data || []) as any[]).filter((u) => u.status !== "inactive").map((u) => ({ id: u.user_id as string, name: (u.display_name || "Staff") as string }));
      return {
        users: people,
        accounts: (accounts.data || []) as { id: string; name: string }[],
        contacts: ((contacts.data || []) as any[]).map((c) => ({ ...c, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Contact" })),
      };
    },
  });
  return useMemo(() => {
    const d = data || { users: [], accounts: [], contacts: [] };
    const userName = new Map(d.users.map((u) => [u.id, u.name]));
    const accountName = new Map(d.accounts.map((a) => [a.id, a.name]));
    const contactName = new Map(d.contacts.map((c: any) => [c.id, c.name]));
    return { ...d, userName, accountName, contactName };
  }, [data]);
}
export type Lookups = ReturnType<typeof useLookups>;

export function useModuleRows(m: ModuleDef) {
  const tenantId = useTenantId();
  return useQuery({ queryKey: ["crm-hub", m.key, tenantId], enabled: !!tenantId, staleTime: 15_000, queryFn: () => loadModule(m, tenantId!) });
}

export function useCrmRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["crm-hub", "crm-hub-lookups", "crm-hub-record", "crm-hub-related", "crm-hub-activities", "crm-hub-home"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

/** A field's value as text (lists, exports, filters). */
export function fieldText(f: FieldDef, r: any, lk: Lookups): string {
  const v = r?.[f.key];
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "owner": return lk.userName.get(v) || "";
    case "account": return lk.accountName.get(v) || r.account_name || "";
    case "contact": return lk.contactName.get(v) || r.contact_name || "";
    case "money": return formatKES(Number(v || 0));
    case "percent": return `${Number(v || 0)}%`;
    case "date": return String(v).slice(0, 10);
    case "bool": return v ? "Yes" : "No";
    case "select": return optionLabel(f, String(v));
    default: return String(v);
  }
}

/** A field's value for reading (links for email, phone, website, account and contact). */
export function FieldValue({ f, r, lk, className }: { f: FieldDef; r: any; lk: Lookups; className?: string }) {
  const v = r?.[f.key];
  const text = fieldText(f, r, lk);
  if (!text) return <span className={cn("text-muted-foreground", className)}>—</span>;
  if (f.type === "email") return <a className={cn("text-primary hover:underline", className)} href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>{text}</a>;
  if (f.type === "phone") return <a className={cn("text-primary hover:underline", className)} href={`tel:${String(v).replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()}>{text}</a>;
  if (f.type === "url") return <a className={cn("text-primary hover:underline", className)} href={/^https?:/i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{text}</a>;
  if (f.type === "account" && v) return <Link className={cn("text-primary hover:underline", className)} to={`/crm/accounts/${v}`} onClick={(e) => e.stopPropagation()}>{text}</Link>;
  if (f.type === "contact" && v) return <Link className={cn("text-primary hover:underline", className)} to={`/crm/contacts/${v}`} onClick={(e) => e.stopPropagation()}>{text}</Link>;
  if (f.key === "stage") return <StagePill stage={String(v)} />;
  return <span className={cn(f.type === "money" && "tabular-nums", className)}>{text}</span>;
}

export function StagePill({ stage }: { stage: string }) {
  const tone = stage === "won" ? "bg-success/10 text-success ring-success/20" : stage === "lost" ? "bg-destructive/10 text-destructive ring-destructive/20" : "bg-primary/10 text-primary ring-primary/20";
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", tone)}>{STAGES.find((s) => s.key === stage)?.label || stage}</span>;
}

/** The control that edits one field. */
export function FieldInput({ f, value, onChange, lk, row }: { f: FieldDef; value: any; onChange: (v: any) => void; lk: Lookups; row?: any }) {
  const v = value ?? "";
  switch (f.type) {
    case "textarea": return <textarea className="fi min-h-[90px]" value={v} onChange={(e) => onChange(e.target.value)} />;
    case "bool": return <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Yes</label>;
    case "select": return (
      <select className="fi" value={v} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(f.options || []).map((o) => <option key={o} value={o}>{optionLabel(f, o)}</option>)}
      </select>
    );
    case "owner": return (
      <select className="fi" value={v} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— Nobody —</option>
        {lk.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
    case "account": return (
      <select className="fi" value={v} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {lk.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    );
    case "contact": {
      const acc = row?.customer_id || row?.account_id;
      const list = acc ? [...lk.contacts.filter((c: any) => c.account_id === acc), ...lk.contacts.filter((c: any) => c.account_id !== acc)] : lk.contacts;
      return (
        <select className="fi" value={v} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {list.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.account_id && lk.accountName.get(c.account_id) ? ` · ${lk.accountName.get(c.account_id)}` : ""}</option>)}
        </select>
      );
    }
    case "number": case "money": case "percent":
      return <input className="fi" inputMode="decimal" value={v} onChange={(e) => { const t = e.target.value.replace(/[^0-9.-]/g, ""); onChange(t === "" ? null : t); }} />;
    case "date": return <input className="fi" type="date" value={String(v).slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    case "email": return <input className="fi" type="email" value={v} onChange={(e) => onChange(e.target.value)} />;
    default: return <input className="fi" value={v} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Values ready to save: numbers as numbers, empty text as null, the module's derived values. */
export function cleanForSave(m: ModuleDef, draft: Record<string, any>, lk?: Lookups) {
  const out: Record<string, any> = {};
  for (const f of m.fields) {
    if (f.readOnly || !(f.key in draft)) continue;
    let v = draft[f.key];
    if (["number", "money", "percent"].includes(f.type)) v = v === null || v === "" || v === undefined ? null : Number(v);
    else if (typeof v === "string") v = v.trim() === "" ? null : v.trim();
    out[f.key] = v;
  }
  // A deal keeps its account's and contact's names too (older screens and exports read them).
  if (m.key === "deals" && lk) {
    if ("customer_id" in out) out.account_name = (out.customer_id && lk.accountName.get(out.customer_id)) || draft.account_name || null;
    if ("contact_id" in out) out.contact_name = (out.contact_id && lk.contactName.get(out.contact_id)) || draft.contact_name || null;
  }
  return { ...out, ...(m.derive ? m.derive({ ...draft, ...out }) : {}) };
}
