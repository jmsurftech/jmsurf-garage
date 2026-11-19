import { useState } from "react";
import { useSelection, BulkBar, TickAllCell, TickCell } from "@/components/Bulk";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat, Plus, Pause, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Modal, Field, EmptyState, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Picker } from "@/apps/fields";
import { formatMoney } from "@/lib/format";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const UNITS = [["weeks", "Week(s)"], ["months", "Month(s)"], ["years", "Year(s)"], ["days", "Day(s)"]];
const every = (n: number, u: string) => `Every ${n > 1 ? `${n} ` : ""}${(UNITS.find(([k]) => k === u)?.[1] || u).replace("(s)", n > 1 ? "s" : "")}`;

export type RecurringKind = "invoice" | "bill" | "expense";
/** Each kind: its table, number and party columns, and where its page is. */
const CFG: Record<RecurringKind, { table: string; number: string; party: string; amount: string; title: string; single: string; link: (id: string) => string; desc: string; select: string }> = {
  invoice: { table: "invoices", number: "invoice_number", party: "customer_name", amount: "total", title: "Recurring Invoices", single: "invoice", link: (id) => `/sales/invoices/${id}`, desc: "Retainers, rent, subscriptions and service fees billed automatically on schedule.", select: "id, invoice_number, customer_name, total" },
  bill: { table: "bills", number: "bill_number", party: "name", amount: "amount", title: "Recurring Bills", single: "bill", link: (id) => `/purchases/bills/${id}`, desc: "Rent, utilities, subscriptions and other supplier bills created automatically on schedule.", select: "id, bill_number, name, amount" },
  expense: { table: "expenses", number: "expense_number", party: "category_name", amount: "amount", title: "Recurring Expenses", single: "expense", link: (id) => `/purchases/expenses/${id}`, desc: "Expenses recorded automatically on schedule, such as rent or internet.", select: "id, expense_number, category_name, vendor_name, description, amount" },
};
const nextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };
const label = (k: RecurringKind, r: any) => r[CFG[k].number] || r.description || r.vendor_name || CFG[k].single;

/** Saves a document as the template of a repeating schedule. */
export async function makeRecurring(kind: RecurringKind, id: string, interval: number, unit: string, next: string) {
  return sb.from(CFG[kind].table).update({ is_recurring: true, recurrence_interval: interval || 1, recurrence_unit: unit, next_due_date: next }).eq("id", id);
}

/** "Make Recurring" on an invoice, bill or expense: how often, and when the next one is created. */
export function MakeRecurringModal({ kind, id, onClose }: { kind: RecurringKind; id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ interval: "1", unit: "months", next: nextMonth() });
  const save = async () => {
    const { error } = await makeRecurring(kind, id, Number(f.interval), f.unit, f.next);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries();
    toast.success(`Recurring ${CFG[kind].single} saved`, { description: `The next one is created on ${f.next}. See ${CFG[kind].title}.` });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Make recurring" icon={Repeat} description={`A new ${CFG[kind].single} with the same details is created on schedule.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat every"><input type="number" min={1} className="fi" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value })} /></Field>
          <Field label="Period"><select className="fi" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label={`Next ${CFG[kind].single} date`}><input type="date" className="fi" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/**
 * Recurring Invoices / Bills / Expenses: a document used as the template creates a
 * new one on schedule (the server runs it every hour, with proper numbers).
 */
export default function RecurringInvoices({ kind = "invoice" }: { kind?: RecurringKind }) {
  const c = CFG[kind];
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: string | null; interval: string; unit: string; next: string } | null>(null);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["recurring", kind, tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from(c.table).select(`${c.select}, recurrence_interval, recurrence_unit, next_due_date, is_recurring`).eq("is_recurring", true).order("next_due_date")).data || [],
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["recurring-candidates", kind, tenantId], enabled: !!edit && !edit.id,
    queryFn: async () => {
      let q = sb.from(c.table).select(c.select).eq("is_recurring", false);
      if (kind !== "expense") q = q.neq("status", "void");
      return (await q.order("created_at", { ascending: false }).limit(500)).data || [];
    },
  });
  const { data: generated = {} } = useQuery({
    queryKey: ["recurring-generated", kind, tenantId], enabled: !!tenantId && kind !== "expense",
    queryFn: async () => {
      const { data } = kind === "invoice"
        ? await sb.from("invoices").select("reference").eq("source", "recurring").limit(10000)
        : await sb.from(c.table).select("reference").ilike("reference", "Recurring %").limit(10000);
      const m: Record<string, number> = {};
      (data || []).forEach((r: any) => { const k = String(r.reference || "").replace(/^Recurring /, ""); m[k] = (m[k] || 0) + 1; });
      return m;
    },
  });
  const rsel = useSelection((rows as any[]).map((r) => r.id));
  const stopMany = async () => {
    const { error } = await sb.from(c.table).update({ is_recurring: false, next_due_date: null }).in("id", rsel.ids);
    if (error) return toast.error(friendlyError(error));
    rsel.clear(); void qc.invalidateQueries({ queryKey: ["recurring", kind] }); toast.success("Stopped");
  };
  const save = async () => {
    if (!edit?.id) return toast.error(`Choose the ${c.single} to repeat`);
    const { error } = await makeRecurring(kind, edit.id, Number(edit.interval), edit.unit, edit.next);
    if (error) return toast.error(friendlyError(error));
    setEdit(null); void qc.invalidateQueries({ queryKey: ["recurring", kind] }); toast.success(`Recurring ${c.single} saved`, { description: `The next ${c.single} is created on ${edit.next}.` });
  };
  const stop = async (id: string) => {
    const { error } = await sb.from(c.table).update({ is_recurring: false, next_due_date: null }).eq("id", id);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["recurring", kind] }); toast.success("Stopped");
  };

  return (
    <div className="space-y-5">
      <PageHeader title={c.title} icon={Repeat} description={c.desc}
        actions={<button onClick={() => setEdit({ id: null, interval: "1", unit: "months", next: nextMonth() })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New recurring {c.single}</button>} />
      <Panel flush>
        {!isLoading && !(rows as any[]).length ? (
          <EmptyState icon={Repeat} title={`No recurring ${c.single}s yet`} description={`Pick any ${c.single} as the template and choose how often it repeats, or use Make Recurring on the ${c.single} itself.`} />
        ) : (
          <><BulkBar sel={rsel} noun={`recurring ${c.single}`}>
            <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold" onClick={() => void stopMany()}>Stop</button>
          </BulkBar>
          <table className="dt">
            <thead><tr><TickAllCell sel={rsel} /><th>Template</th><th>{kind === "invoice" ? "Customer" : kind === "bill" ? "Vendor" : "Category"}</th><th>Frequency</th><th>Next</th><th className="num">Amount</th>{kind !== "expense" && <th className="num">Created</th>}<th /></tr></thead>
            <tbody>
              <PagedRows rows={(rows as any[])} colSpan={7}>{(pageRows) => pageRows.map((r) => (
                <tr key={r.id} className={rsel.has(r.id) ? "bg-primary/5" : undefined}>
                  <TickCell sel={rsel} id={r.id} />
                  <td data-label="Template"><Link to={c.link(r.id)} className="font-medium text-primary">{label(kind, r)}</Link></td>
                  <td data-label={kind === "invoice" ? "Customer" : "Vendor"}>{kind === "bill" ? String(r.name || "").split(" · ")[0] : kind === "expense" ? (r.vendor_name || r.category_name) : r[c.party]}</td>
                  <td data-label="Frequency"><Pill tone="primary">{every(r.recurrence_interval || 1, r.recurrence_unit || "months")}</Pill></td>
                  <td data-label="Next">{r.next_due_date}</td>
                  <td data-label="Amount" className="num">{formatMoney(Number(r[c.amount]))}</td>
                  {kind !== "expense" && <td data-label="Created" className="num">{(generated as any)[r[c.number]] || 0}</td>}
                  <td className="whitespace-nowrap text-right">
                    <button className="icon-btn" title="Change" onClick={() => setEdit({ id: r.id, interval: String(r.recurrence_interval || 1), unit: r.recurrence_unit || "months", next: r.next_due_date || nextMonth() })}><Pencil className="h-4 w-4" /></button>
                    <button className="icon-btn" title="Stop" onClick={() => void stop(r.id)}><Pause className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}</PagedRows>
            </tbody>
          </table></>
        )}
      </Panel>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Recurring ${c.single}`} icon={Repeat}
          footer={<><button onClick={() => setEdit(null)} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button onClick={save} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Save</button></>}>
          <div className="space-y-4">
            {!(rows as any[]).some((r: any) => r.id === edit.id) && (
              <Field label={`${c.single[0].toUpperCase()}${c.single.slice(1)} to repeat`} hint={`Its details and lines are copied to each new ${c.single}.`}>
                <Picker value={edit.id} onChange={(v) => setEdit({ ...edit, id: v })} options={(candidates as any[]).map((x) => ({ id: x.id, label: label(kind, x), sub: `${kind === "bill" ? String(x.name || "").split(" · ")[0] : x[c.party] || x.vendor_name || ""} · ${formatMoney(Number(x[c.amount]))}` }))} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeat every"><input type="number" min={1} className="fi" value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value })} /></Field>
              <Field label="Period"><select className="fi" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <Field label={`Next ${c.single} date`}><input type="date" className="fi" value={edit.next} onChange={(e) => setEdit({ ...edit, next: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
