import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Gift, Plus, Printer, Send, Undo2, Receipt } from "lucide-react";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, TableWrap, StatGrid, StatTile } from "@/components/kit";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { openStockDocument } from "@/lib/docModels";
import { toast } from "sonner";
import { sb, fmtD, n, useLocs, useProds, LinesEditor, blankLine, STATUS_TONE, type Line } from "@/pages/warehouse/common";

import { PagedRows } from "@/components/Pager";
const money = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;

/** Samples given to customers, prospects and doctors at zero value; their cost goes to Samples & promotions. */
export default function Samples() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: rows = [] } = useQuery({ queryKey: ["samples"], queryFn: async () => ((await sb.from("sample_issues").select("*").order("created_at", { ascending: false }).limit(500)).data || []) as any[] });
  const [edit, setEdit] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["samples"] });
  const run = async (fn: string, id: string, ok: string) => { const { error } = await sb.rpc(fn, { p_id: id }); if (error) toast.error(friendlyError(error)); else { toast.success(ok); refresh(); } };
  const toInvoice = (s: any) => {
    const items = (s.lines || []).map((l: any) => ({ item_id: l.product_id, name: l.name, quantity: l.quantity }));
    sessionStorage.setItem("dash-invoice-prefill", JSON.stringify({ customer_id: s.customer_id, items, sample_id: s.id }));
    navigate(`/sales/invoices/new${s.customer_id ? `?customer=${s.customer_id}` : ""}`);
  };
  const month = rows.filter((r) => r.status === "issued" && r.issue_date >= new Date().toISOString().slice(0, 8) + "01");
  return (
    <div className="space-y-6">
      <PageHeader title="Samples" icon={Gift} description="Free samples to customers and prospects, costed to Samples & promotions. Follow up or turn them into a sale."
        actions={<button onClick={() => setEdit(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Issue samples</button>} />
      <StatGrid>
        <StatTile label="Issued this month" value={month.length} icon={Gift} />
        <StatTile label="Cost this month" value={money(month.reduce((a, r) => a + n(r.total_cost), 0))} icon={Receipt} tone="warning" />
        <StatTile label="Follow-ups due" value={rows.filter((r) => r.status === "issued" && r.follow_up_on && r.follow_up_on <= new Date().toISOString().slice(0, 10)).length} icon={Send} tone="info" />
        <StatTile label="Turned into sales" value={rows.filter((r) => r.status === "converted").length} icon={Receipt} tone="success" />
      </StatGrid>
      <Panel flush>
        {!rows.length ? <EmptyState icon={Gift} title="No samples yet" /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Number</th><th>To</th><th>Salesperson</th><th>Items</th><th className="text-right">Cost</th><th>Follow up</th><th>Status</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={8}>{(pageRows) => pageRows.map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.number || "Draft"}</td><td>{s.customer_name}</td><td>{s.salesperson_name || "—"}</td>
                <td className="text-sm">{(s.lines || []).map((l: any) => `${n(l.quantity)} × ${l.name}`).join(", ")}</td>
                <td className="text-right tabular-nums">{money(n(s.total_cost))}</td><td>{fmtD(s.follow_up_on)}</td>
                <td><Pill tone={STATUS_TONE[s.status]}>{s.status}</Pill></td>
                <td className="whitespace-nowrap text-right">
                  {s.status === "draft" && <button onClick={() => void run("sample_issue", s.id, "Samples issued")} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground">Issue</button>}
                  {s.status === "issued" && <>
                    <button onClick={() => toInvoice(s)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium">Invoice</button>
                    <button onClick={() => void run("sample_return", s.id, "Returned to stock")} className="ml-1 rounded-lg p-1.5 hover:bg-muted" aria-label="Returned"><Undo2 className="h-4 w-4" /></button>
                  </>}
                  <button onClick={() => void openStockDocument("sample", s.id).catch((e) => toast.error(friendlyError(e)))} className="ml-1 rounded-lg p-1.5 hover:bg-muted" aria-label="Print"><Printer className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {edit && <SampleForm onClose={() => { setEdit(false); refresh(); }} />}
    </div>
  );
}

function SampleForm({ onClose }: { onClose: () => void }) {
  const { profile, user } = useAuth() as any;
  const { data: products = [] } = useProds();
  const { data: locs = [] } = useLocs();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [f, setF] = useState<any>({ location_id: "", purpose: "Trial", follow_up_on: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const save = async (issue: boolean) => {
    try {
      const ok = lines.filter((l) => l.product_id && l.quantity > 0);
      if (!customer) throw new Error("Choose who gets the samples");
      if (!ok.length) throw new Error("Add the sample items");
      const { data, error } = await sb.from("sample_issues").insert({ customer_id: customer.id, customer_name: customer.name, location_id: f.location_id || locs[0]?.id, purpose: f.purpose || null, follow_up_on: f.follow_up_on || null, notes: f.notes || null, lines: ok, salesperson_id: user?.id, salesperson_name: profile?.display_name || null }).select("id").single();
      if (error) throw error;
      if (issue) { const { error: e2 } = await sb.rpc("sample_issue", { p_id: data.id }); if (e2) throw e2; }
      toast.success(issue ? "Samples issued" : "Saved as draft"); onClose();
    } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title="Issue samples" icon={Gift}
      footer={<><button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button onClick={() => void save(false)} className="rounded-xl border border-border px-4 py-2 text-sm">Save draft</button><button onClick={() => void save(true)} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Issue now</button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="To"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
          <Field label="From"><select className="fi" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Purpose"><select className="fi" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>{["Trial", "Promotion", "Doctor / professional sample", "Event", "Replacement", "Other"].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Follow up on"><input className="fi" type="date" value={f.follow_up_on} onChange={(e) => setF({ ...f, follow_up_on: e.target.value })} /></Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} products={products} showLots />
        <Field label="Notes"><textarea className="fi" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-xs text-muted-foreground">Value on the note: zero. The stock's cost is booked to Samples & promotions when issued.</p>
      </div>
    </Modal>
  );
}
