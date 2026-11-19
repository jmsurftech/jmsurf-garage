import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKES, currencyCode } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { X, DollarSign, ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from "lucide-react";

export default function CashRegisterDrawer({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;

  const { data: openRegister, isLoading } = useQuery({
    queryKey: ["cash-register-open", locationId, user?.id],
    queryFn: async () => {
      const sb: any = supabase;
      const { data } = await sb
        .from("cash_register")
        .select("*")
        .eq("location_id", locationId)
        .eq("opened_by", user?.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && !!locationId,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["cash-register-history", locationId],
    queryFn: async () => {
      const sb: any = supabase;
      const { data } = await sb
        .from("cash_register")
        .select("*")
        .eq("location_id", locationId)
        .order("opened_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !!locationId,
  });

  const [openingFloat, setOpeningFloat] = useState("");
  const [cashInOut, setCashInOut] = useState("");
  const [cashInOutType, setCashInOutType] = useState<"in" | "out">("in");
  const [actualCash, setActualCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleOpenRegister = async () => {
    if (!openingFloat || Number(openingFloat) < 0) {
      toast({ title: "Enter opening float", variant: "destructive" });
      return;
    }
    setSaving(true);
    const sb: any = supabase;
    const { error } = await sb.from("cash_register").insert({
      tenant_id: tenantId,
      location_id: locationId,
      opened_by: user?.id,
      opening_float: Number(openingFloat),
      expected_cash: Number(openingFloat),
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["cash-register-open"] });
    queryClient.invalidateQueries({ queryKey: ["cash-register-history"] });
    toast({ title: "Register opened", description: `Float: ${formatKES(Number(openingFloat))}` });
    setOpeningFloat("");
  };

  const handleCashInOut = async () => {
    if (!openRegister || !cashInOut || Number(cashInOut) <= 0) return;
    setSaving(true);
    const amount = Number(cashInOut);
    const sb: any = supabase;
    const updates: any = {};
    if (cashInOutType === "in") {
      updates.cash_in = (Number(openRegister.cash_in) || 0) + amount;
    } else {
      updates.cash_out = (Number(openRegister.cash_out) || 0) + amount;
    }
    // Recalculate expected
    const newCashIn = updates.cash_in ?? Number(openRegister.cash_in || 0);
    const newCashOut = updates.cash_out ?? Number(openRegister.cash_out || 0);
    updates.expected_cash = Number(openRegister.opening_float) + Number(openRegister.cash_sales || 0) + newCashIn - newCashOut;

    const { error } = await sb.from("cash_register").update(updates).eq("id", openRegister.id);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["cash-register-open"] });
    queryClient.invalidateQueries({ queryKey: ["cash-register-history"] });
    toast({ title: `Cash ${cashInOutType === "in" ? "added" : "removed"}`, description: formatKES(amount) });
    setCashInOut("");
  };

  const handleCloseRegister = async () => {
    if (!openRegister || !actualCash) {
      toast({ title: "Enter actual cash count", variant: "destructive" });
      return;
    }
    setSaving(true);
    const actual = Number(actualCash);
    const expected = Number(openRegister.expected_cash);
    const sb: any = supabase;
    const { error } = await sb.from("cash_register").update({
      status: "closed",
      closed_by: user?.id,
      closed_at: new Date().toISOString(),
      actual_cash: actual,
      difference: actual - expected,
      notes: closeNotes || null,
    }).eq("id", openRegister.id);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["cash-register-open"] });
    queryClient.invalidateQueries({ queryKey: ["cash-register-history"] });
    toast({ title: "Register closed", description: `Difference: ${formatKES(actual - expected)}` });
    setActualCash("");
    setCloseNotes("");
  };

  if (isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" /> Cash Register
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!openRegister ? (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium">Register is closed</p>
                <p className="text-xs text-muted-foreground">Open the register to start tracking cash</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Opening Float ({currencyCode()})</label>
                <input type="number" min="0" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)}
                  placeholder="0" className="fi" />
              </div>
              <button onClick={handleOpenRegister} disabled={saving}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2">
                <Unlock className="w-4 h-4" /> {saving ? "Opening..." : "Open Register"}
              </button>
            </div>
          ) : (
            <>
              {/* Current register summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">Opening Float</p>
                  <p className="text-sm font-semibold">{formatKES(Number(openRegister.opening_float))}</p>
                </div>
                <div className="p-3 rounded-lg bg-success/10">
                  <p className="text-xs text-muted-foreground">Cash Sales</p>
                  <p className="text-sm font-semibold text-success">{formatKES(Number(openRegister.cash_sales || 0))}</p>
                </div>
                <div className="p-3 rounded-lg bg-info/10">
                  <p className="text-xs text-muted-foreground">Cash In</p>
                  <p className="text-sm font-semibold text-info">{formatKES(Number(openRegister.cash_in || 0))}</p>
                </div>
                <div className="p-3 rounded-lg bg-warning/10">
                  <p className="text-xs text-muted-foreground">Cash Out</p>
                  <p className="text-sm font-semibold text-warning">{formatKES(Number(openRegister.cash_out || 0))}</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 text-center">
                <p className="text-xs text-muted-foreground">Expected Cash in Drawer</p>
                <p className="text-xl font-display font-bold text-primary">{formatKES(Number(openRegister.expected_cash || 0))}</p>
              </div>

              {/* Cash In/Out */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Cash In / Out</p>
                <div className="flex gap-2">
                  <button onClick={() => setCashInOutType("in")}
                    className={cn("flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1",
                      cashInOutType === "in" ? "bg-success text-success-foreground" : "bg-secondary text-secondary-foreground")}>
                    <ArrowDownCircle className="w-3 h-3" /> Cash In
                  </button>
                  <button onClick={() => setCashInOutType("out")}
                    className={cn("flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1",
                      cashInOutType === "out" ? "bg-warning text-warning-foreground" : "bg-secondary text-secondary-foreground")}>
                    <ArrowUpCircle className="w-3 h-3" /> Cash Out
                  </button>
                </div>
                <div className="flex gap-2">
                  <input type="number" min="0" value={cashInOut} onChange={e => setCashInOut(e.target.value)}
                    placeholder="Amount" className="fi flex-1" />
                  <button onClick={handleCashInOut} disabled={saving || !cashInOut}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
                    Add
                  </button>
                </div>
              </div>

              {/* Close register */}
              <div className="space-y-3 pt-3 border-t border-border">
                <p className="text-sm font-medium">Close Register</p>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Actual Cash Count ({currencyCode()})</label>
                  <input type="number" min="0" value={actualCash} onChange={e => setActualCash(e.target.value)}
                    placeholder="Count the cash..." className="fi" />
                </div>
                {actualCash && (
                  <div className={cn("p-3 rounded-lg text-center",
                    Number(actualCash) - Number(openRegister.expected_cash) >= 0 ? "bg-success/10" : "bg-destructive/10")}>
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className={cn("text-lg font-bold",
                      Number(actualCash) - Number(openRegister.expected_cash) >= 0 ? "text-success" : "text-destructive")}>
                      {formatKES(Number(actualCash) - Number(openRegister.expected_cash))}
                    </p>
                  </div>
                )}
                <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                  placeholder="Notes (optional)" className="fi" rows={2} />
                <button onClick={handleCloseRegister} disabled={saving || !actualCash}
                  className="w-full py-3 rounded-xl bg-destructive text-destructive-foreground font-medium text-sm hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" /> {saving ? "Closing..." : "Close Register"}
                </button>
              </div>
            </>
          )}

          {/* History (X/Z Report) */}
          {history.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-border">
              <p className="text-sm font-medium">Recent Sessions (Z-Report)</p>
              {history.filter((h: any) => h.status === "closed").slice(0, 5).map((h: any) => (
                <div key={h.id} className="p-3 rounded-lg border border-border text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{new Date(h.opened_at).toLocaleDateString()} {new Date(h.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={cn("font-medium px-1.5 py-0.5 rounded",
                      Number(h.difference) >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                      Diff: {formatKES(Number(h.difference || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Float: {formatKES(Number(h.opening_float))}</span>
                    <span>Sales: {formatKES(Number(h.cash_sales || 0))}</span>
                    <span>Expected: {formatKES(Number(h.expected_cash || 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
