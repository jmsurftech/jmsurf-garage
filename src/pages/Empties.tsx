import { PageHeader, Panel, Field, Modal, EmptyState, StatTile, StatGrid, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { Trash2, Plus, Package2, Wallet, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useProducts, useLocations } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { formatKES, currencyCode } from "@/lib/format";
import {
  useEmpties,
  useRecordEmpty,
  useDeleteEmpty,
  type ContainerKind,
  type EmptyDirection,
} from "@/hooks/useEmpties";

/**
 * Liquor stores: empty bottles and crates going out with a sale and coming
 * back from customers, with the deposit charged or refunded on each move.
 */
export default function Empties() {
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const { data: entries = [], isLoading } = useEmpties();
  const record = useRecordEmpty();
  const remove = useDeleteEmpty();

  const [productId, setProductId] = useState<string>("");
  const [kind, setKind] = useState<ContainerKind>("bottle");
  const [direction, setDirection] = useState<EmptyDirection>("in");
  const [quantity, setQuantity] = useState("1");
  const [deposit, setDeposit] = useState("0");
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => products.find((p: any) => p.id === productId),
    [products, productId],
  );

  const pickProduct = (id: string) => {
    setProductId(id);
    const p: any = products.find((x: any) => x.id === id);
    if (p && kind === "crate" && p.crate_deposit != null) setDeposit(String(p.crate_deposit));
  };

  const totals = useMemo(() => {
    let bottles = 0;
    let crates = 0;
    let depositHeld = 0;
    for (const e of entries) {
      const sign = e.direction === "in" ? 1 : -1;
      if (e.container_kind === "crate") crates += sign * Number(e.quantity);
      else bottles += sign * Number(e.quantity);
      depositHeld += (e.direction === "out" ? 1 : -1) * Number(e.deposit_total);
    }
    return { bottles, crates, depositHeld };
  }, [entries]);

  const submit = async () => {
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      toast({ title: "Enter how many", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        product_id: productId || null,
        item_label: selected?.name || (kind === "crate" ? "Crate" : "Empty bottle"),
        container_kind: kind,
        direction,
        quantity: qty,
        deposit_per_unit: parseFloat(deposit) || 0,
        customer_name: customer.trim() || null,
        note: note.trim() || null,
        location_id: locations[0]?.id ?? null,
      });
      toast({ title: direction === "in" ? "Returns recorded" : "Issue recorded" });
      setQuantity("1");
      setCustomer("");
      setNote("");
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    }
  };

  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const lineTotal = (parseFloat(quantity) || 0) * (parseFloat(deposit) || 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Empties & crates" icon={Package2}
        description="Bottles and crates that leave with customers and come back, with the deposit charged or refunded." />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Empty bottles on hand" value={totals.bottles} icon={Package2} tone="info" />
        <StatTile label="Crates on hand" value={totals.crates} icon={Package2} tone="primary" />
        <StatTile label="Deposits held for customers" value={formatKES(Math.max(totals.depositHeld, 0))} icon={Wallet} tone="warning" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Panel title="Record a movement" icon={Plus}>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { v: "in", t: "Returned by customer", d: "Refund their deposit", icon: ArrowDownLeft },
            { v: "out", t: "Went out with customer", d: "Charge a deposit", icon: ArrowUpRight },
          ] as const).map((o) => (
            <button key={o.v} type="button" onClick={() => setDirection(o.v as EmptyDirection)}
              className={cn("flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors",
                direction === o.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", direction === o.v ? "bg-primary text-primary-foreground" : "bg-muted")}><o.icon className="h-5 w-5" /></span>
              <span><span className="block font-semibold">{o.t}</span><span className="block text-xs text-muted-foreground">{o.d}</span></span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Item">
            <select value={productId} onChange={(e) => pickProduct(e.target.value)} className="fi">
              <option value="">Not tied to a product</option>
              {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Container">
            <select value={kind} onChange={(e) => setKind(e.target.value as ContainerKind)} className="fi">
              <option value="bottle">Empty bottle</option>
              <option value="crate">Crate</option>
            </select>
          </Field>
          <Field label="How many"><input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="fi" /></Field>
          <Field label={`Deposit each (${currencyCode()})`}><input type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} className="fi" /></Field>
          <Field label="Customer" hint="Optional"><input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or phone" className="fi" /></Field>
          <Field label="Note" hint="Optional"><input value={note} onChange={(e) => setNote(e.target.value)} className="fi" /></Field>
        </div>
        <div className="mt-4 flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            {direction === "in" ? "Refund" : "Charge"} <strong className="text-foreground">{formatKES(lineTotal)}</strong> deposit
          </p>
          <Button onClick={submit} disabled={record.isPending}><Plus /> {record.isPending ? "Saving…" : "Record"}</Button>
        </div>
      </Panel>

      <Panel title="Recent movements" flush>
        {isLoading ? <PageLoader /> : entries.length === 0 ? <EmptyState icon={Package2} title="Nothing recorded yet" className="py-10" /> : (
          <ul className="divide-y divide-border">
            <PagedRows rows={entries} list>{(pageRows) => pageRows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", e.direction === "in" ? "bg-success/10 text-success" : "bg-warning/15 text-[hsl(32_90%_38%)]")}>
                  {e.direction === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.quantity} × {e.container_kind === "crate" ? "crate" : "empty bottle"} · {e.item_label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()} · {e.direction === "in" ? "Returned" : "Went out"}
                    {e.customer_name ? ` · ${e.customer_name}` : ""}{e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatKES(Number(e.deposit_total))}</span>
                <button onClick={() => setConfirmDelete(e)} className="icon-btn-danger" aria-label="Delete entry"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}</PagedRows>
          </ul>
        )}
      </Panel>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} size="sm" icon={Trash2} title="Delete this entry?"
        description="The on-hand counts and deposits held will be recalculated without it."
        footer={<>
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { remove.mutate(confirmDelete.id); setConfirmDelete(null); }}>Delete</Button>
        </>} />
    </div>
  );
}
