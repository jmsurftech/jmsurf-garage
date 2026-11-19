/**
 * Reporting tags: a company's own dimensions (e.g. Region: Nairobi / Mombasa) set up in
 * System → Reporting tags and picked on invoices, bills, expenses, journals and credit notes.
 * Stored on each record as jsonb `tags`: { [tag id]: value }.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;

export type TagModule = "invoices" | "bills" | "expenses" | "journals" | "credit_notes";
export type TagMode = "optional" | "mandatory";
export type ReportingTag = { id: string; name: string; options: string[]; modules: Partial<Record<TagModule, TagMode>>; is_active: boolean; sort: number };
export type TagValues = Record<string, string>;

export const TAG_MODULES: { value: TagModule; label: string }[] = [
  { value: "invoices", label: "Invoices" }, { value: "credit_notes", label: "Credit notes" }, { value: "bills", label: "Bills" },
  { value: "expenses", label: "Expenses" }, { value: "journals", label: "Journals" },
];

/** Every tag of the company (active and inactive), in order. */
export function useReportingTags() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["reporting-tags", tenantId], enabled: !!tenantId, staleTime: 5 * 60_000,
    queryFn: async () => ((await sb.from("reporting_tags").select("*").eq("tenant_id", tenantId).order("sort").order("name")).data || []) as ReportingTag[],
  });
}

/** Active tags shown on one kind of record. */
export function useModuleTags(module: TagModule) {
  const { data = [] } = useReportingTags();
  return data.filter((t) => t.is_active && t.modules?.[module] && (t.options || []).length);
}

/** The first mandatory tag left empty, to stop a save. */
export function missingTag(tags: ReportingTag[], module: TagModule, values: TagValues | null | undefined) {
  return tags.find((t) => t.modules?.[module] === "mandatory" && !values?.[t.id])?.name ?? null;
}

/** Only the tags that are set (empty choices are dropped before saving). */
export const cleanTags = (values: TagValues | null | undefined): TagValues =>
  Object.fromEntries(Object.entries(values || {}).filter(([, v]) => typeof v === "string" && v.trim()));

/** One picker per tag. Renders nothing until the company has a tag for this kind of record. */
export function TagPickers({ module, values, onChange, className, compact }: { module: TagModule; values: TagValues | null | undefined; onChange: (next: TagValues) => void; className?: string; compact?: boolean }) {
  const tags = useModuleTags(module);
  if (!tags.length) return null;
  const v = values || {};
  return (
    <div className={className ?? "grid gap-3 sm:grid-cols-2"}>
      {tags.map((t) => {
        const required = t.modules?.[module] === "mandatory";
        return (
          <label key={t.id} className="block text-sm">
            <span className={cn("mb-1 block font-medium", compact && "text-xs")}>{t.name}{required && <span className="text-destructive"> *</span>}</span>
            <select className={cn("fi", compact && "h-9")} value={v[t.id] || ""} onChange={(e) => onChange({ ...v, [t.id]: e.target.value })}>
              <option value="">{required ? "Choose" : "None"}</option>
              {(t.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              {v[t.id] && !(t.options || []).includes(v[t.id]) && <option value={v[t.id]}>{v[t.id]}</option>}
            </select>
          </label>
        );
      })}
    </div>
  );
}

/** Small "Region: Nairobi" chips for a record. */
export function TagChips({ values, className }: { values: TagValues | null | undefined; className?: string }) {
  const { data: tags = [] } = useReportingTags();
  const list = tags.filter((t) => values?.[t.id]);
  if (!list.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {list.map((t) => <span key={t.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t.name}: {values![t.id]}</span>)}
    </span>
  );
}

/** Filter or group a list by a tag: tag id, value ("" = any, "__none" = not tagged), and whether to group. */
export type TagView = { tag: string; value: string; group: boolean };
export const NO_TAG_VIEW: TagView = { tag: "", value: "", group: false };
export const NOT_TAGGED = "__none";

export function matchesTagView(record: { tags?: TagValues | null }, view: TagView) {
  if (!view.tag || !view.value) return true;
  const v = record.tags?.[view.tag] || "";
  return view.value === NOT_TAGGED ? !v : v === view.value;
}

/** Tag filter controls for a list toolbar. Hidden while the company has no tag for this kind of record. */
export function TagFilter({ module, view, onChange }: { module: TagModule; view: TagView; onChange: (v: TagView) => void }) {
  const tags = useModuleTags(module);
  if (!tags.length) return null;
  const tag = tags.find((t) => t.id === view.tag);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select className="fi h-9 w-auto" value={view.tag} onChange={(e) => onChange({ tag: e.target.value, value: "", group: !!e.target.value && view.group })} aria-label="Reporting tag">
        <option value="">Any tag</option>
        {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {tag && (
        <select className="fi h-9 w-auto" value={view.value} onChange={(e) => onChange({ ...view, value: e.target.value })} aria-label={`${tag.name} value`}>
          <option value="">All values</option>
          {tag.options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={NOT_TAGGED}>Not tagged</option>
        </select>
      )}
      {tag && (
        <label className="inline-flex items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={view.group} onChange={(e) => onChange({ ...view, group: e.target.checked })} /> Group by {tag.name}
        </label>
      )}
    </span>
  );
}

/** Totals per value of the chosen tag, shown above a list when "Group by" is on. */
export function TagGroupSummary<T extends { tags?: TagValues | null }>({ rows, view, amount, label = "Total" }: { rows: T[]; view: TagView; amount: (r: T) => number; label?: string }) {
  const { data: tags = [] } = useReportingTags();
  const tag = tags.find((t) => t.id === view.tag);
  if (!tag || !view.group) return null;
  const groups = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const k = r.tags?.[tag.id] || "";
    const g = groups.get(k) || { count: 0, total: 0 };
    g.count += 1; g.total += Number(amount(r)) || 0;
    groups.set(k, g);
  }
  const list = [...groups.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].total - a[1].total));
  return (
    <div className="overflow-x-auto border-b border-border">
      <table className="dt dt-keep">
        <thead><tr><th>{tag.name}</th><th className="num">Records</th><th className="num">{label}</th></tr></thead>
        <tbody>
          {list.map(([k, g]) => (
            <tr key={k || "none"}><td className={cn(!k && "text-muted-foreground")}>{k || "Not tagged"}</td><td className="num">{g.count}</td><td className="num font-semibold">{formatKES(g.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
