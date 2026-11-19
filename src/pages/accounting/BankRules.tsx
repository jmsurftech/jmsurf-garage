import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field, Modal, Pill } from "@/components/kit";
import { Picker } from "@/apps/fields";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/books/confirm";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;

export type BankRule = {
  id: string; name: string; contains: string; direction: "any" | "in" | "out"; min_amount: number | null; max_amount: number | null;
  bank_account_id: string | null; action: "categorize" | "exclude"; account_id: string | null; auto_apply: boolean; is_active: boolean; times_used: number;
};
export type RuleDraft = Partial<BankRule>;
type Option = { id: string; label: string; sub?: string };

export const blankRule = (contains = ""): RuleDraft => ({ name: contains, contains, direction: "any", action: "categorize", auto_apply: false, is_active: true });

export function useBankRules() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["bank-rules", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("bank_rules").select("*").eq("tenant_id", tenantId).order("name")).data || []) as BankRule[],
  });
}

/** Add or change one rule. */
export function BankRuleForm({ rule, accountOptions, bankOptions, onClose, onSaved }: { rule: RuleDraft; accountOptions: Option[]; bankOptions: Option[]; onClose: () => void; onSaved: () => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [f, setF] = useState<RuleDraft>(rule);
  const set = (p: RuleDraft) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    const contains = (f.contains || "").trim();
    if (!contains) return toast.error("Say what text to look for");
    if (f.action === "categorize" && !f.account_id) return toast.error("Choose the account");
    const row = {
      name: (f.name || "").trim() || contains, contains, direction: f.direction || "any", min_amount: f.min_amount || null, max_amount: f.max_amount || null,
      bank_account_id: f.bank_account_id || null, action: f.action || "categorize", account_id: f.action === "exclude" ? null : f.account_id,
      auto_apply: !!f.auto_apply, is_active: f.is_active !== false,
    };
    const { error } = f.id ? await sb.from("bank_rules").update(row).eq("id", f.id) : await sb.from("bank_rules").insert({ ...row, tenant_id: tenantId });
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["bank-rules"] }); void qc.invalidateQueries({ queryKey: ["bank-rule-matches"] });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title={f.id ? "Edit rule" : "New rule"} icon={Wand2}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save rule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="When the statement line contains" required><input className="fi" autoFocus value={f.contains || ""} onChange={(e) => set({ contains: e.target.value })} placeholder="KPLC" /></Field></div>
        <Field label="Money">
          <select className="fi" value={f.direction} onChange={(e) => set({ direction: e.target.value as BankRule["direction"] })}>
            <option value="any">In or out</option><option value="in">Money in</option><option value="out">Money out</option>
          </select>
        </Field>
        <Field label="Bank account">
          <select className="fi" value={f.bank_account_id || ""} onChange={(e) => set({ bank_account_id: e.target.value || null })}>
            <option value="">All accounts</option>
            {bankOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Amount from"><input className="fi" type="number" min={0} value={f.min_amount ?? ""} onChange={(e) => set({ min_amount: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Amount to"><input className="fi" type="number" min={0} value={f.max_amount ?? ""} onChange={(e) => set({ max_amount: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Then">
          <select className="fi" value={f.action} onChange={(e) => set({ action: e.target.value as BankRule["action"] })}>
            <option value="categorize">Categorise as</option><option value="exclude">Exclude the line</option>
          </select>
        </Field>
        {f.action !== "exclude" && <Field label="Account" required><Picker value={f.account_id || null} onChange={(v) => set({ account_id: v })} options={accountOptions} placeholder="Choose account…" /></Field>}
        <div className="sm:col-span-2"><Field label="Rule name"><input className="fi" value={f.name || ""} onChange={(e) => set({ name: e.target.value })} placeholder={f.contains || ""} /></Field></div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.auto_apply} onChange={(e) => set({ auto_apply: e.target.checked })} /> Post by itself when a statement is imported</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} /> In use</label>
        </div>
      </div>
    </Modal>
  );
}

/** Every rule of the company. */
export function BankRulesModal({ accountOptions, bankOptions, onClose }: { accountOptions: Option[]; bankOptions: Option[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: rules = [] } = useBankRules();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const remove = async (r: BankRule) => {
    if (!(await confirmAction({ title: `Delete the rule "${r.name}"?`, message: "Lines it already posted stay as they are.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("bank_rules").delete().eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["bank-rules"] }); void qc.invalidateQueries({ queryKey: ["bank-rule-matches"] });
  };
  const label = (r: BankRule) => (r.action === "exclude" ? "Exclude" : accountOptions.find((o) => o.id === r.account_id)?.label || "Account");
  return (
    <>
      <Modal open onClose={onClose} size="xl" title="Bank rules" icon={Wand2}
        footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => setEditing(blankRule())}><Plus /> New rule</Button></>}>
        {rules.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No rules yet.</p> : (
          <table className="dt">
            <thead><tr><th>Rule</th><th>Contains</th><th>Then</th><th className="num">Used</th><th /></tr></thead>
            <tbody><PagedRows rows={rules} colSpan={5}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                <td className="font-medium">{r.name}{r.auto_apply && <Pill tone="info" className="ml-2">Automatic</Pill>}{!r.is_active && <Pill className="ml-2">Off</Pill>}</td>
                <td>{r.contains}</td>
                <td>{label(r)}</td>
                <td className="num">{r.times_used}</td>
                <td className="text-right"><span className="inline-flex gap-0.5">
                  <button className="icon-btn" title="Edit" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                  <button className="icon-btn" title="Delete" onClick={() => void remove(r)}><Trash2 className="h-4 w-4" /></button>
                </span></td>
              </tr>
            ))}</PagedRows></tbody>
          </table>
        )}
      </Modal>
      {editing && <BankRuleForm rule={editing} accountOptions={accountOptions} bankOptions={bankOptions} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </>
  );
}
