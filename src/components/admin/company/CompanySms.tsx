import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { MessageSquare, Minus, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Panel, Segmented, TableWrap } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { supabase } from "@/integrations/supabase/client";
import { adminCall } from "@/lib/adminApi";

const sb = supabase as any;

/** Admin → company → SMS: the prepaid SMS balance, every top-up and change, and adding or taking off credit. */
export default function CompanySms({ tenantId, archived }: { tenantId: string; archived: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-company-sms", tenantId],
    queryFn: async () => {
      const [{ data: s }, { data: h }] = await Promise.all([
        sb.from("tenant_sms_settings").select("balance_units,total_sent,price_per_sms,is_active").eq("tenant_id", tenantId).maybeSingle(),
        sb.from("tenant_sms_topups").select("id,units_added,amount_paid,price_per_sms,reference,notes,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
      ]);
      return { settings: s as any, history: (h || []) as any[] };
    },
  });
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [f, setF] = useState({ units: "", amount: "", reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const s = data?.settings;

  const save = async () => {
    const n = Math.trunc(Number(f.units));
    if (!n || n < 0) return toast.error("Enter how many SMS");
    setBusy(true);
    try {
      const r = await adminCall<{ balance: number }>("companies/sms", { tenant_id: tenantId, units: dir === "add" ? n : -n, amount: dir === "add" ? Number(f.amount || 0) : 0, reference: f.reference.trim(), note: f.note.trim() });
      toast.success(`${dir === "add" ? "Added" : "Took off"} ${n.toLocaleString()} SMS · balance ${Number(r.balance || 0).toLocaleString()}`);
      setF({ units: "", amount: "", reference: "", note: "" });
      void qc.invalidateQueries({ queryKey: ["admin-company-sms", tenantId] });
      void qc.invalidateQueries({ queryKey: ["admin-company-sms-balance", tenantId] });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Panel className="lg:col-span-2" title="Change the balance" icon={MessageSquare}>
        <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Balance</dt><dd className="font-display text-lg font-bold tabular-nums">{(s?.balance_units ?? 0).toLocaleString()}</dd></div>
          <div className="rounded-xl bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Sent</dt><dd className="font-display text-lg font-bold tabular-nums">{(s?.total_sent ?? 0).toLocaleString()}</dd></div>
          <div className="rounded-xl bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Price</dt><dd className="font-display text-lg font-bold tabular-nums">{s?.price_per_sms != null ? Number(s.price_per_sms).toFixed(2) : "—"}</dd></div>
        </dl>
        {archived ? <p className="text-sm text-muted-foreground">Restore the company to change its SMS.</p> : (
          <div className="space-y-3">
            <Segmented value={dir} onChange={(v) => setDir(v as "add" | "remove")} options={[{ value: "add", label: <span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add</span> }, { value: "remove", label: <span className="inline-flex items-center gap-1"><Minus className="h-3.5 w-3.5" />Take off</span> }]} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SMS" required><input className="fi" inputMode="numeric" value={f.units} onChange={(e) => setF({ ...f, units: e.target.value.replace(/\D/g, "") })} placeholder="Enter number of SMS" /></Field>
              {dir === "add" && <Field label="Amount paid (KSh)" hint="Empty or 0 when free"><input className="fi" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="Enter amount" /></Field>}
              <Field label="Reference" className={dir === "add" ? "sm:col-span-2" : undefined}><input className="fi" maxLength={60} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Enter M-Pesa code or reference" /></Field>
              <Field label="Note" className="sm:col-span-2"><input className="fi" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Enter a note" /></Field>
            </div>
            <div className="flex justify-end"><Button onClick={save} disabled={busy || !f.units}><Save /> {busy ? "Saving…" : dir === "add" ? "Add SMS" : "Take off SMS"}</Button></div>
          </div>
        )}
      </Panel>

      <Panel flush className="lg:col-span-3" title="History">
        {!data?.history.length ? <EmptyState icon={MessageSquare} title="No SMS top-ups yet" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Date</th><th className="text-right">SMS</th><th className="text-right">Paid</th><th>Reference / note</th></tr></thead>
              <tbody>
                <PagedRows rows={data.history} colSpan={4} pageSize={10}>{(page) => page.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap text-xs">{format(new Date(h.created_at), "d MMM yyyy, HH:mm")}</td>
                    <td className={`text-right tabular-nums font-semibold ${h.units_added < 0 ? "text-destructive" : "text-success"}`}>{h.units_added > 0 ? "+" : ""}{Number(h.units_added).toLocaleString()}</td>
                    <td className="text-right tabular-nums">{Number(h.amount_paid) ? `KSh ${Number(h.amount_paid).toLocaleString()}` : "—"}</td>
                    <td className="max-w-[280px]"><p className="truncate font-mono text-xs">{h.reference || "—"}</p>{h.notes && <p className="truncate text-xs text-muted-foreground">{h.notes}</p>}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
