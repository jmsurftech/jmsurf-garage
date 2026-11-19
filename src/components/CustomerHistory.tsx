import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { X, ShoppingBag, Calendar, RotateCw } from "lucide-react";

interface CustomerHistoryProps {
  customerId: string;
  customerName: string;
  onReorder?: (items: any[]) => void;
  onClose: () => void;
}

export default function CustomerHistory({ customerId, customerName, onReorder, onClose }: CustomerHistoryProps) {
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["customer-history", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("customer_id", customerId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!customerId,
  });

  const totalSpend = transactions.reduce((s, t) => s + Math.max(0, Number(t.total)), 0);
  const avgTicket = transactions.length > 0 ? totalSpend / transactions.length : 0;

  // Most purchased products
  const productFreq: Record<string, { name: string; count: number; lastPrice: number }> = {};
  transactions.forEach(t => {
    const items = (t.items as any[]) || [];
    items.forEach(i => {
      if (!productFreq[i.id]) productFreq[i.id] = { name: i.name, count: 0, lastPrice: Number(i.price) };
      productFreq[i.id].count += Number(i.quantity || 1);
      productFreq[i.id].lastPrice = Number(i.price);
    });
  });
  const topProducts = Object.entries(productFreq)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-primary" /> Purchase History
            </h2>
            <p className="text-xs text-muted-foreground">{customerName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-sm font-bold">{formatKES(totalSpend)}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Purchases</p>
              <p className="text-sm font-bold">{transactions.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">Avg. Ticket</p>
              <p className="text-sm font-bold">{formatKES(avgTicket)}</p>
            </div>
          </div>

          {/* Top products */}
          {topProducts.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Most Purchased</p>
              <div className="space-y-1.5">
                {topProducts.map(([id, p]) => (
                  <div key={id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30 text-xs">
                    <span className="font-medium">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">×{p.count}</span>
                      <span className="font-semibold">{formatKES(p.lastPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {onReorder && topProducts.length > 0 && (
                <button
                  onClick={() => {
                    const items = topProducts.map(([id, p]) => ({ id, name: p.name, price: p.lastPrice, quantity: 1 }));
                    onReorder(items);
                    onClose();
                  }}
                  className="mt-2 w-full py-2 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 flex items-center justify-center gap-1"
                >
                  <RotateCw className="w-3 h-3" /> Quick Reorder Top Items
                </button>
              )}
            </div>
          )}

          {/* Transaction list */}
          <div>
            <p className="text-sm font-medium mb-2">Transactions</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
            ) : transactions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No purchase history</p>
            ) : (
              <div className="space-y-2">
                {transactions.map(tx => {
                  const items = (tx.items as any[]) || [];
                  const isExpanded = expandedTx === tx.id;
                  return (
                    <div key={tx.id} className="rounded-lg border border-border overflow-hidden">
                      <button onClick={() => setExpandedTx(isExpanded ? null : tx.id)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-medium">{new Date(tx.created_at).toLocaleDateString()}</p>
                            <p className="text-[10px] text-muted-foreground">{new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold">{formatKES(Number(tx.total))}</p>
                          <p className="text-[10px] text-muted-foreground">{items.length} item(s) · {tx.payment_method}</p>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-border p-3 space-y-1 bg-muted/20">
                          {items.map((item: any, i: number) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span>{item.name} × {item.quantity}</span>
                              <span className="font-medium">{formatKES(Number(item.price) * Number(item.quantity))}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
