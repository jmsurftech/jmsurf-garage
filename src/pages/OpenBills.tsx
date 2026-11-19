import { PageHeader } from "@/components/kit";
import { useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Printer, Trash2, Minus, X, Receipt, Smartphone, ClipboardList } from "lucide-react";
import { useProducts, useLocations, useBusinessSettings } from "@/hooks/useData";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import ItemPicker, { type PickedItem } from "@/components/ItemPicker";
import ItemLineLabel from "@/components/ItemLineLabel";
import {
  useOpenBills,
  useCreateOpenBill,
  useUpdateBillItems,
  useVoidBill,
  useSettleBill,
  type OpenBill,
  type BillLine,
} from "@/hooks/useOpenBills";
import { confirmAction } from "@/components/books/confirm";

const METHODS = ["cash", "mpesa", "card"];

/** Liquor store tabs: open a bill, add rounds, print it, settle it. */
export default function OpenBills() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const { data: biz } = useBusinessSettings();
  const { businessType } = useBusinessType();

  const [filter, setFilter] = useState<"open" | "paid_today" | "all">("open");
  const { data: bills = [], isLoading } = useOpenBills(filter);
  const createBill = useCreateOpenBill();
  const updateItems = useUpdateBillItems();
  const voidBill = useVoidBill();
  const settleBill = useSettleBill();

  const locationId = locations[0]?.id ?? null;

  const [newLabel, setNewLabel] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const active = useMemo(
    () => bills.find((b) => b.id === activeId) || null,
    [bills, activeId],
  );

  const saveLines = (bill: OpenBill, items: BillLine[]) =>
    updateItems.mutate({ bill, items });

  const addItem = (bill: OpenBill, picked: PickedItem) => {
    const items = [...(bill.items || [])];
    const i = items.findIndex(
      (l) => l.product_id === picked.product_id && l.variant_id === picked.variant_id && l.unit_type === picked.unit_type,
    );
    if (i >= 0) items[i] = { ...items[i], quantity: items[i].quantity + 1 };
    else items.push({ ...picked, quantity: 1 });
    saveLines(bill, items);
  };

  const changeQty = (bill: OpenBill, index: number, delta: number) => {
    const items = [...(bill.items || [])];
    const q = items[index].quantity + delta;
    if (q <= 0) items.splice(index, 1);
    else items[index] = { ...items[index], quantity: q };
    saveLines(bill, items);
  };

  const handleSettle = async (bill: OpenBill) => {
    const due = Number(bill.total) - Number(bill.amount_paid);
    const amount = parseFloat(payAmount) || due;
    if (amount <= 0) return;
    try {
      const res = await settleBill.mutateAsync({
        bill,
        amount,
        method: payMethod,
        locationId,
      });
      setPayAmount("");
      toast({
        title: res.fullyPaid ? "Bill paid" : "Part payment recorded",
        description: res.fullyPaid
          ? `${bill.label} settled in full.`
          : `Balance left: ${formatKES(res.balance)}`,
      });
      if (res.fullyPaid) setActiveId(null);
    } catch (e: any) {
      toast({ title: "Could not settle bill", description: e.message, variant: "destructive" });
    }
  };

  const printBill = (bill: OpenBill) => {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) return;
    const rows = (bill.items || [])
      .map(
        (l) =>
          `<tr><td>${l.label || l.name}</td><td style="text-align:center">${l.quantity}</td><td style="text-align:right">${formatKES(
            Number(l.price) * Number(l.quantity),
          )}</td></tr>`,
      )
      .join("");
    w.document.write(`<html><head><title>${bill.label}</title>
      <style>body{font-family:monospace;padding:12px}h2{margin:0 0 2px;font-size:15px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
      td{padding:3px 0}tfoot td{border-top:1px dashed #000;font-weight:bold;padding-top:6px}</style>
      </head><body>
      <h2>${biz?.business_name || "Bill"}</h2>
      <div style="font-size:12px">${bill.label} · ${bill.bill_number || ""}</div>
      <div style="font-size:11px">${new Date(bill.created_at).toLocaleString("en-KE")}</div>
      <table><tbody>${rows}</tbody>
      <tfoot><tr><td>TOTAL</td><td></td><td style="text-align:right">${formatKES(Number(bill.total))}</td></tr></tfoot>
      </table>
      <p style="font-size:11px;margin-top:14px">Not a receipt — please pay at the counter.</p>
      </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={ClipboardList} title={"Open bills"} description={"Run a tab per table or customer, print the bill, then settle it."} actions={<><button
          onClick={() => setShowNew(true)}
          className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New tab
        </button></>} />

      <div className="flex gap-1.5">
        {([
          ["open", "Open"],
          ["paid_today", "Paid today"],
          ["all", "All"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
              filter === k ? "bg-primary text-primary-foreground border-primary" : "border-border"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading bills…</p>
      ) : bills.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-10 text-center">
          <Receipt className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No bills here yet. Tap "New tab" to start one.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {<PagedRows rows={bills} gridSpan>{(pageRows) => pageRows.map((b) => (
            <button
              key={b.id}
              onClick={() => setActiveId(b.id)}
              className="text-left bg-card border border-border rounded-xl p-4 hover:border-primary transition"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{b.label}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full ${
                    b.status === "open" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {b.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {(b.items || []).length} items · opened {new Date(b.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-lg font-bold mt-2">{formatKES(Number(b.total))}</p>
              {Number(b.amount_paid) > 0 && (
                <p className="text-xs text-muted-foreground">Paid {formatKES(Number(b.amount_paid))}</p>
              )}
            </button>
          ))}</PagedRows>}
        </div>
      )}

      {/* New tab dialog */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-3">New tab</h2>
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Enter table or customer name"
              className="fi"
            />
            <button
              disabled={!newLabel.trim() || createBill.isPending}
              onClick={async () => {
                const bill = await createBill.mutateAsync({ label: newLabel.trim(), locationId });
                setNewLabel("");
                setShowNew(false);
                setActiveId(bill.id);
              }}
              className="mt-4 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              Open tab
            </button>
          </div>
        </div>
      )}

      {/* Bill detail */}
      {active && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex justify-end" onClick={() => setActiveId(null)}>
          <div
            className="bg-card w-full sm:max-w-md h-full overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">{active.label}</h2>
                <p className="text-xs text-muted-foreground">{active.bill_number}</p>
              </div>
              <button onClick={() => setActiveId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <ItemPicker
              products={products}
              businessType={businessType}
              onPick={(p) => addItem(active, p)}
              placeholder="Add a drink or item…"
            />

            <div className="space-y-2">
              {(active.items || []).length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing on this tab yet.</p>
              )}
              {(active.items || []).map((l, i) => (
                <div key={i} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
                  <ItemLineLabel item={{ name: l.name, size: l.size, color: l.color, bottle_size: l.bottle_size, unit_type: l.unit_type }} className="flex-1 text-sm truncate" />
                  <button onClick={() => changeQty(active, i, -1)} className="p-1 rounded hover:bg-muted"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center text-sm">{l.quantity}</span>
                  <button onClick={() => changeQty(active, i, 1)} className="p-1 rounded hover:bg-muted"><Plus className="w-3.5 h-3.5" /></button>
                  <span className="w-20 text-right text-sm font-medium">{formatKES(Number(l.price) * l.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Total</span><span className="font-bold">{formatKES(Number(active.total))}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Paid</span><span>{formatKES(Number(active.amount_paid))}</span></div>
              <div className="flex justify-between"><span>Balance</span><span className="font-semibold">{formatKES(Number(active.total) - Number(active.amount_paid))}</span></div>
            </div>

            {active.status === "open" && (
              <>
                <div className="flex gap-1.5">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border capitalize ${
                        payMethod === m ? "bg-primary text-primary-foreground border-primary" : "border-border"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={`Amount (default ${formatKES(Number(active.total) - Number(active.amount_paid))})`}
                  className="fi"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => printBill(active)}
                    className="py-2.5 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Printer className="w-4 h-4" /> Print bill
                  </button>
                  <button
                    disabled={settleBill.isPending || (active.items || []).length === 0}
                    onClick={() => handleSettle(active)}
                    className="py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
                  >
                    Settle
                  </button>
                </div>
                <button
                  disabled={(active.items || []).length === 0}
                  onClick={() => {
                    sessionStorage.setItem("pos-load-bill", active.id);
                    navigate(tenantPath(slug, "/pos"));
                  }}
                  className="w-full py-2.5 rounded-xl border border-primary text-primary text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Smartphone className="w-4 h-4" /> Take payment in the till (M-Pesa prompt)
                </button>
                <button
                  onClick={async () => {
                    if (await confirmAction({ title: "Void this tab?", message: "It will not count as a sale.", danger: true, confirmLabel: "Void" })) {
                      voidBill.mutate(active.id);
                      setActiveId(null);
                    }
                  }}
                  className="w-full py-2 rounded-xl text-destructive text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Void tab
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
