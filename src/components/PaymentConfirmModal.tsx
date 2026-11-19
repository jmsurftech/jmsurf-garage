import { useEffect, useState } from "react";
import { X, Check, Banknote, Smartphone, CreditCard, Phone, Wallet, Gift, Pencil } from "lucide-react";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  paymentMethod: string;
  total: number;
  customerName: string;
  onClose: () => void;
  /** `paid` is set only when the cashier recorded a different amount for the items. */
  onConfirm: (data: { paid?: number }) => void;
}

const labels: Record<string, { name: string; Icon: any; agreed: boolean }> = {
  cash: { name: "Cash", Icon: Banknote, agreed: true },
  mobile_money: { name: "Mobile Money", Icon: Phone, agreed: true },
  mpesa: { name: "M-Pesa", Icon: Smartphone, agreed: false },
  card: { name: "Card", Icon: CreditCard, agreed: false },
  pdq_card: { name: "Card (PDQ)", Icon: CreditCard, agreed: true },
  bank_transfer: { name: "Bank Transfer", Icon: Banknote, agreed: true },
  credit: { name: "Credit", Icon: Wallet, agreed: false },
  loyalty: { name: "Loyalty Points", Icon: Gift, agreed: false },
};

/**
 * Confirm a payment. For cash (and money received by hand) the cashier can
 * record what was actually paid for the items: less than the total becomes
 * the discount, more is added to the sale.
 */
export default function PaymentConfirmModal({ paymentMethod, total, customerName, onClose, onConfirm }: Props) {
  const meta = labels[paymentMethod] || { name: paymentMethod, Icon: Banknote, agreed: false };
  const [editing, setEditing] = useState(false);
  const [paid, setPaid] = useState(String(total));
  const paidNum = Number(paid);
  const valid = paid.trim() !== "" && Number.isFinite(paidNum) && paidNum >= 0;
  const diff = valid ? Math.round((paidNum - total) * 100) / 100 : 0;

  useEffect(() => {
    // Escape closes. Enter presses the focused Confirm button once (no second
    // shortcut here, so a sale can never be recorded twice).
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = () => onConfirm(editing && valid && diff !== 0 ? { paid: paidNum } : {});

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <meta.Icon className="w-5 h-5 text-primary" />
            <h2 className="font-display font-bold">{meta.name} payment</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-muted/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">{customerName} · amount due</p>
            <p className="mt-1 font-display text-3xl font-bold text-primary">{formatKES(total)}</p>
          </div>

          {meta.agreed && (
            editing ? (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Amount the customer paid for these items</label>
                <input type="number" inputMode="decimal" autoFocus value={paid} onChange={(e) => setPaid(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && valid) confirm(); }}
                  className="w-full px-4 py-3 rounded-lg bg-muted border border-input text-xl font-semibold text-right" />
                {valid && diff !== 0 && (
                  <div className={cn("flex justify-between rounded-lg p-3 text-sm font-medium", diff < 0 ? "bg-warning/10" : "bg-success/10 text-success")}>
                    <span>{diff < 0 ? "Discount given" : "Extra received (added to the sale)"}</span>
                    <span className="font-bold">{formatKES(Math.abs(diff))}</span>
                  </div>
                )}
                <button type="button" onClick={() => { setEditing(false); setPaid(String(total)); }} className="text-xs text-muted-foreground hover:text-foreground">Use the full amount</button>
              </div>
            ) : (
              <button type="button" onClick={() => setEditing(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                <Pencil className="h-4 w-4" /> Customer paid a different amount?
              </button>
            )
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80">Cancel</button>
            <button autoFocus={!editing} disabled={editing && !valid} onClick={confirm}
              className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
              <Check className="w-4 h-4" /> Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
