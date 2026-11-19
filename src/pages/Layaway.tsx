import { PageHeader, Toolbar, SearchBox, Segmented, EmptyState, Field, Modal, StatTile, StatGrid, PageLoader, StatusPill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { PagedRows } from "@/components/Pager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, PiggyBank, Minus, Trash2, Wallet, CalendarDays, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useProducts, useLocations } from "@/hooks/useData";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import ItemPicker, { type PickedItem } from "@/components/ItemPicker";
import ItemLineLabel from "@/components/ItemLineLabel";

const sb: any = supabase;

interface LayLine extends PickedItem {
  quantity: number;
}

/** Clothe Line: hold items for a customer paying by deposits. */
export default function Layaway() {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const { businessType } = useBusinessType();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [school, setSchool] = useState("");
  const [due, setDue] = useState("");
  const [deposit, setDeposit] = useState("");
  const [lines, setLines] = useState<LayLine[]>([]);
  const [payFor, setPayFor] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const total = lines.reduce((s, l) => s + Number(l.price) * l.quantity, 0);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["layaways", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("layaways")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const dep = parseFloat(deposit) || 0;
      const { error } = await sb.from("layaways").insert({
        tenant_id: tenantId,
        location_id: locations[0]?.id ?? null,
        customer_name: name || null,
        customer_phone: phone || null,
        school: school || null,
        items: lines,
        total,
        deposit_paid: dep,
        balance: total - dep,
        status: total - dep <= 0.5 ? "collected" : "open",
        due_date: due || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layaways"] });
      setOpen(false);
      setName(""); setPhone(""); setSchool(""); setDue(""); setDeposit(""); setLines([]);
      toast({ title: "Layaway created" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const addPayment = useMutation({
    mutationFn: async ({ row, amount }: { row: any; amount: number }) => {
      const paid = Number(row.deposit_paid) + amount;
      const balance = Math.max(0, Number(row.total) - paid);
      const { error } = await sb
        .from("layaways")
        .update({
          deposit_paid: paid,
          balance,
          status: balance <= 0.5 ? "collected" : "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["layaways"] });
      setPayFor(null);
      setPayAmount("");
      toast({ title: "Payment recorded" });
    },
  });

  const addLine = (p: PickedItem) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product_id === p.product_id && l.variant_id === p.variant_id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + 1 };
        return copy;
      }
      return [...prev, { ...p, quantity: 1 }];
    });
  };

  const setQty = (i: number, q: number) => setLines((prev) => q <= 0 ? prev.filter((_, j) => j !== i) : prev.map((l, j) => (j === i ? { ...l, quantity: q } : l)));
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [search, setSearch] = useState("");
  const dep = parseFloat(deposit) || 0;
  const depositTooHigh = dep > total && total > 0;
  const openRows = rows.filter((r: any) => r.status === "open");
  const shown = rows.filter((r: any) => (filter === "all" || (filter === "open" ? r.status === "open" : r.status !== "open"))
    && (!search.trim() || `${r.customer_name || ""} ${r.customer_phone || ""} ${r.school || ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const owed = openRows.reduce((a: number, r: any) => a + Number(r.balance || 0), 0);
  const held = openRows.reduce((a: number, r: any) => a + Number(r.deposit_paid || 0), 0);
  const pay = parseFloat(payAmount) || 0;
  const payTooHigh = payFor ? pay > Number(payFor.balance) + 0.5 : false;

  if (isLoading) return <PageLoader label="Loading layaways…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Layaway" icon={PiggyBank} description="Hold items for a customer who pays in instalments."
        actions={<Button onClick={() => setOpen(true)}><Plus /> New layaway</Button>} />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Open layaways" value={openRows.length} icon={PiggyBank} tone="primary" />
        <StatTile label="Still to collect" value={formatKES(owed)} icon={Wallet} tone="warning" />
        <StatTile label="Deposits held" value={formatKES(held)} icon={Wallet} tone="success" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Customer, phone or school…" />
        <Segmented value={filter} onChange={(v) => setFilter(v as "open" | "done" | "all")} options={[
          { value: "open", label: "Open", count: openRows.length },
          { value: "done", label: "Paid", count: rows.length - openRows.length },
          { value: "all", label: "All", count: rows.length },
        ]} />
      </Toolbar>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={PiggyBank} title={rows.length ? "Nothing here" : "No layaways yet"}
            description={rows.length ? undefined : "Put items aside for a customer and record each payment until it is paid off."}
 />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <PagedRows rows={shown} gridSpan>{(pageRows) => pageRows.map((r: any) => {
            const pct = Math.min(100, (Number(r.deposit_paid) / Math.max(1, Number(r.total))) * 100);
            const overdue = r.status === "open" && r.due_date && new Date(r.due_date) < new Date();
            return (
              <div key={r.id} className="flex flex-col rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.customer_name || "Customer"}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {r.customer_phone && <><Phone className="h-3 w-3" /> {r.customer_phone}</>}
                      {r.school && <> · {r.school}</>}
                    </p>
                  </div>
                  <StatusPill status={overdue ? "overdue" : r.status === "open" ? "open" : "paid"} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {(r.items || []).length} item{(r.items || []).length === 1 ? "" : "s"}
                  {r.due_date && <> · <CalendarDays className="inline h-3 w-3" /> collect by {new Date(r.due_date).toLocaleDateString()}</>}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
                <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Paid {formatKES(Number(r.deposit_paid))}</span><span>of {formatKES(Number(r.total))}</span></div>
                <p className="mt-3 font-display text-xl font-bold">{Number(r.balance) > 0.5 ? <>Balance {formatKES(Number(r.balance))}</> : <span className="text-success">Fully paid</span>}</p>
                {r.status === "open" && <Button className="mt-4" onClick={() => { setPayFor(r); setPayAmount(""); }}><Wallet /> Add payment</Button>}
              </div>
            );
          })}</PagedRows>
        </div>
      )}

      <Modal open={!!payFor} onClose={() => setPayFor(null)} size="sm" icon={Wallet} title="Add a payment"
        description={payFor ? `${payFor.customer_name || "Customer"} · balance ${formatKES(Number(payFor.balance))}` : ""}
        footer={<>
          <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
          <Button disabled={pay <= 0 || payTooHigh || addPayment.isPending} onClick={() => addPayment.mutate({ row: payFor, amount: pay })}>{addPayment.isPending ? "Saving…" : "Record payment"}</Button>
        </>}>
        <Field label="Amount" error={payTooHigh ? "That is more than the balance." : undefined}>
          <input type="number" min="0" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="fi h-12 text-lg font-semibold" autoFocus />
        </Field>
        {payFor && <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setPayAmount(String(Number(payFor.balance)))}>Pay the full balance</button>}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} size="lg" icon={PiggyBank} title="New layaway"
        footer={<>
          <div className="mr-auto hidden text-sm sm:block">Total <span className="font-display text-lg font-bold">{formatKES(total)}</span>{dep > 0 && !depositTooHigh && <span className="text-muted-foreground"> · balance {formatKES(total - dep)}</span>}</div>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={lines.length === 0 || depositTooHigh || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save layaway"}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Customer name"><input value={name} onChange={(e) => setName(e.target.value)} className="fi" /></Field>
            <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="fi" inputMode="tel" /></Field>
            <Field label="School / note" hint="Optional"><input value={school} onChange={(e) => setSchool(e.target.value)} className="fi" /></Field>
          </div>
          <Field label="Items"><ItemPicker products={products} businessType={businessType} onPick={addLine} placeholder="Search and add an item…" /></Field>
          {lines.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <ItemLineLabel item={{ name: l.name, size: l.size, color: l.color, unit_type: l.unit_type }} className="min-w-0 flex-1 truncate" />
                  <button type="button" className="icon-btn h-7 w-7" onClick={() => setQty(i, l.quantity - 1)} aria-label="Less"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                  <button type="button" className="icon-btn h-7 w-7" onClick={() => setQty(i, l.quantity + 1)} aria-label="More"><Plus className="h-3.5 w-3.5" /></button>
                  <span className="w-24 text-right font-medium tabular-nums">{formatKES(Number(l.price) * l.quantity)}</span>
                  <button type="button" className="icon-btn-danger h-7 w-7" onClick={() => setQty(i, 0)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Collect by" hint="Optional"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="fi" /></Field>
            <Field label="Deposit paid now" error={depositTooHigh ? "The deposit cannot be more than the total." : undefined}><input type="number" min="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} className="fi" /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
