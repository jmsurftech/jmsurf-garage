import { useState, useMemo } from "react";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { X, Smartphone, Banknote, CreditCard, Wallet, Check, Phone } from "lucide-react";

interface SplitPaymentEntry {
  method: string;
  amount: number;
  phone?: string;
}

interface SplitPaymentModalProps {
  total: number;
  onConfirm: (payments: SplitPaymentEntry[]) => void;
  onClose: () => void;
}

const METHODS = [
  { key: "cash", label: "Cash", icon: Banknote, color: "bg-info text-info-foreground" },
  { key: "mpesa", label: "M-Pesa", icon: Smartphone, color: "bg-success text-success-foreground" },
  { key: "mobile_money", label: "Mobile Money", icon: Phone, color: "bg-warning text-warning-foreground" },
  { key: "card", label: "Card", icon: CreditCard, color: "bg-primary text-primary-foreground" },
  { key: "credit", label: "Credit", icon: Wallet, color: "bg-accent text-accent-foreground" },
];

export default function SplitPaymentModal({ total, onConfirm, onClose }: SplitPaymentModalProps) {
  const [payments, setPayments] = useState<SplitPaymentEntry[]>([]);
  const [activeMethod, setActiveMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");

  const totalAllocated = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const remaining = total - totalAllocated;

  const addPayment = () => {
    const val = Number(amount);
    if (!activeMethod || val <= 0 || val > remaining + 0.01) return;
    const entry: SplitPaymentEntry = { method: activeMethod, amount: val };
    if (activeMethod === "mpesa" && phone) entry.phone = phone;
    setPayments([...payments, entry]);
    setAmount("");
    setPhone("");
    setActiveMethod("");
  };

  const removePayment = (idx: number) => {
    setPayments(payments.filter((_, i) => i !== idx));
  };

  const canConfirm = Math.abs(remaining) < 1 && payments.length >= 2;

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg">Split Payment</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex justify-between items-center p-3 rounded-lg bg-primary/5 border border-primary/20">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-display font-bold text-primary">{formatKES(total)}</span>
          </div>

          {payments.length > 0 && (
            <div className="space-y-2">
              {payments.map((p, i) => {
                const m = METHODS.find(m => m.key === p.method);
                return (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                    <div className="flex items-center gap-2">
                      {m && <m.icon className="w-4 h-4" />}
                      <span className="text-sm font-medium">{m?.label || p.method}</span>
                      {p.phone && <span className="text-xs text-muted-foreground">({p.phone})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatKES(p.amount)}</span>
                      <button onClick={() => removePayment(i)} className="text-destructive hover:bg-destructive/10 rounded p-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {remaining > 0.5 && (
            <>
              <div className="p-3 rounded-lg bg-warning/10 text-center">
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="text-lg font-bold text-warning">{formatKES(remaining)}</p>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {METHODS.map(m => (
                  <button key={m.key} onClick={() => { setActiveMethod(m.key); setAmount(String(Math.round(remaining))); }}
                    className={cn("flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-medium transition-colors",
                      activeMethod === m.key ? m.color : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
                    <m.icon className="w-4 h-4" />
                    {m.label}
                  </button>
                ))}
              </div>

              {activeMethod && (
                <div className="space-y-2">
                  <input type="number" min="0" max={remaining} value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder="Amount" className="fi" />
                  {activeMethod === "mpesa" && (
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder="M-Pesa phone number" className="fi" />
                  )}
                  <button onClick={addPayment} disabled={!amount || Number(amount) <= 0}
                    className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
                    Add {METHODS.find(m => m.key === activeMethod)?.label} Payment
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-border">
          <button onClick={() => canConfirm && onConfirm(payments)} disabled={!canConfirm}
            className="w-full py-3 rounded-xl bg-success text-success-foreground font-medium text-sm hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> {canConfirm ? "Confirm Split Payment" : `Allocate remaining ${formatKES(remaining)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
