import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Contact } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useBusinessSettings } from "@/hooks/useData";
import { useTenantId } from "@/hooks/useTenantId";
import { COMPANY_FIELDS, docContactRows, type DocContactRow } from "@/lib/doc-settings";
import { friendlyError } from "@/lib/friendlyError";

/** Where each detail comes from when no document-only value is typed. */
const SOURCE: Record<string, string> = {
  address: "business_address", postal: "postal_address", phone: "business_phone", email: "business_email",
  website: "business_website", kraPin: "tax_pin", vatNumber: "vat_number",
};

/**
 * Business settings → Contact details for documents: the company details printed on
 * every document, which ones, their wording and their order.
 */
export default function DocContactPanel({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const [rows, setRows] = useState<DocContactRow[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(docContactRows((biz as any)?.doc_contact)); }, [(biz as any)?.doc_contact]);

  const set = (i: number, patch: Partial<DocContactRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const j = i + d; if (j < 0 || j >= r.length) return r;
    const next = [...r]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const save = async () => {
    if (!tenantId) return;
    setBusy(true);
    const { error } = await (supabase as any).from("business_settings")
      .update({ doc_contact: { fields: rows.map((r) => ({ key: r.key, show: r.show, value: r.value?.trim() || null })) } })
      .eq("tenant_id", tenantId);
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["business-settings", tenantId] });
    toast.success("Contact details for documents saved");
  };

  return (
    <Panel title="Contact details for documents" icon={Contact}
      description="The company details printed under your name on every document. Switch each on or off and set the order.">
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const def = COMPANY_FIELDS.find((d) => d.key === r.key);
          const fallback = SOURCE[r.key] ? String((biz as any)?.[SOURCE[r.key]] || "") : "";
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2">
              <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="w-36 shrink-0 text-sm font-medium">{def?.label ?? r.key}</span>
              <input className="fi h-9 min-w-[12rem] flex-1" disabled={!canManage} value={r.value || ""}
                placeholder={fallback || (r.key === "extra" ? "Any other line, e.g. Branch: Westlands" : "Not set")}
                onChange={(e) => set(i, { value: e.target.value })} aria-label={`${def?.label ?? r.key} on documents`} />
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Move up" disabled={!canManage || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Move down" disabled={!canManage || i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Switch checked={r.show} disabled={!canManage} onCheckedChange={(v) => set(i, { show: v })} aria-label={`Show ${def?.label ?? r.key}`} />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Leave a box empty to use the value from your business profile (shown greyed). Customer and vendor details are set per document in System → Documents.</p>
      {canManage && <div className="mt-3 flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save contact details"}</Button></div>}
    </Panel>
  );
}
