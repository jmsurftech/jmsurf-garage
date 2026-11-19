import CustomerStatement from "@/components/CustomerStatement";
import { PageHeader, PageLoader } from "@/components/kit";
import { useState, useMemo } from "react";
import { PagedRows } from "@/components/Pager";
import { useCustomers, useTransactions, useLocations } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Wallet, X, Banknote, TrendingDown, Users, Plus, Save, MapPin, CreditCard, FileText } from "lucide-react";

export default function CreditBalances() {
  const [statementFor, setStatementFor] = useState<any>(null);
  const { data: customers = [], isLoading } = useCustomers();
  const { data: transactions = [] } = useTransactions();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "owing" | "clear">("all");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const creditCustomers = useMemo(() => {
    return customers
      .filter(c => Number(c.credit_limit) > 0)
      .filter(c => {
        if (filter === "owing") return Number(c.balance) > 0;
        if (filter === "clear") return Number(c.balance) === 0;
        return true;
      })
      .filter(c =>
        !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
      )
      .sort((a, b) => Number(b.balance) - Number(a.balance));
  }, [customers, search, filter]);

  const totals = useMemo(() => {
    const withCredit = customers.filter(c => Number(c.credit_limit) > 0);
    return {
      totalCustomers: withCredit.length,
      totalOutstanding: withCredit.reduce((s, c) => s + Number(c.balance), 0),
      totalCreditLimit: withCredit.reduce((s, c) => s + Number(c.credit_limit), 0),
      customersOwing: withCredit.filter(c => Number(c.balance) > 0).length,
    };
  }, [customers]);

  // Credit transactions for selected customer
  const customerCreditTx = useMemo(() => {
    if (!selectedCustomer) return [];
    return transactions
      .filter((t: any) => t.customer_id === selectedCustomer.id && t.payment_method === "credit" && t.status === "completed")
      .slice(0, 20);
  }, [selectedCustomer, transactions]);

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader icon={CreditCard} title={"Customer credit"} description={"Manage customer credit accounts and record payments"} actions={<><button onClick={() => setShowAddForm(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]">
          <Plus className="w-4 h-4" /> Add Credit Customer
        </button></>} />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Users className="w-3 h-3" /> Credit Customers</p>
          <p className="text-xl font-display font-bold mt-1">{totals.totalCustomers}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><TrendingDown className="w-3 h-3" /> Currently Owing</p>
          <p className="text-xl font-display font-bold text-destructive mt-1">{totals.customersOwing}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Total Outstanding</p>
          <p className="text-xl font-display font-bold text-destructive mt-1">{formatKES(totals.totalOutstanding)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Total Credit Limits</p>
          <p className="text-xl font-display font-bold mt-1">{formatKES(totals.totalCreditLimit)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..."
            className="fi pl-10 pr-4" />
        </div>
        <div className="flex gap-1.5">
          {(["all", "owing", "clear"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-2 rounded-lg text-xs font-medium", filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {f === "all" ? "All" : f === "owing" ? "Owing" : "Cleared"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{creditCustomers.length} customer{creditCustomers.length !== 1 ? "s" : ""}</p>

      {/* Table */}
      {creditCustomers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No credit customers found</div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-right px-4 py-3 font-medium">Credit Limit</th>
                  <th className="text-right px-4 py-3 font-medium">Balance Owed</th>
                  <th className="text-right px-4 py-3 font-medium">Available</th>
                  <th className="text-center px-4 py-3 font-medium">Utilization</th>
                  <th className="text-center px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {<PagedRows rows={creditCustomers} colSpan={6}>{(pageRows) => pageRows.map((c) => {
                  const limit = Number(c.credit_limit);
                  const balance = Number(c.balance);
                  const available = Math.max(0, limit - balance);
                  const utilization = limit > 0 ? (balance / limit) * 100 : 0;
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-right">{formatKES(limit)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("font-medium", balance > 0 ? "text-destructive" : "text-success")}>
                          {formatKES(balance)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-success">{formatKES(available)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full", utilization > 80 ? "bg-destructive" : utilization > 50 ? "bg-warning" : "bg-success")}
                              style={{ width: `${Math.min(100, utilization)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{utilization.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => setSelectedCustomer(c)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                            <Banknote className="w-3.5 h-3.5" /> Payment
                          </button>
                          <button onClick={() => setStatementFor(c)} className="icon-btn border border-border" title="Statement"><FileText className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}</PagedRows>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {statementFor && <CustomerStatement customer={statementFor} onClose={() => setStatementFor(null)} />}

      {/* Record Payment Modal */}
      {selectedCustomer && (
        <RecordPaymentModal
          customer={selectedCustomer}
          creditTransactions={customerCreditTx}
          onClose={() => setSelectedCustomer(null)}
        />
      )}
      {showAddForm && (
        <AddCreditCustomerForm onClose={() => setShowAddForm(false)} />
      )}
    </div>
  );
}

function RecordPaymentModal({ customer, creditTransactions, onClose }: { customer: any; creditTransactions: any[]; onClose: () => void }) {
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const balance = Number(customer.balance);

  const handlePayment = async () => {
    if (amount <= 0) return;
    if (amount > balance) {
      toast({ title: "Amount exceeds balance", description: `Outstanding balance is ${formatKES(balance)}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    // Recorded in the customer's ledger; the balance moves in the same step.
    const { data: res, error } = await (supabase as any).rpc("record_customer_payment", { p_customer: customer.id, p_amount: amount, p_kind: "payment", p_method: "cash", p_note: null });
    setSaving(false);
    if (error) {
      toast({ title: "Payment not saved", description: error.message, variant: "destructive" });
      return;
    }
    const newBalance = Number(res?.balance ?? Math.max(0, balance - amount));
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["customer-ledger"] });
    toast({ title: "Payment recorded", description: `${formatKES(amount)} received from ${customer.name}. New balance: ${formatKES(newBalance)}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg">Record Credit Payment</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(85vh-4rem)]">
          <div>
            <p className="text-sm font-medium">{customer.name}</p>
            <p className="text-xs text-muted-foreground">{customer.phone}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Limit</p>
              <p className="text-sm font-bold">{formatKES(Number(customer.credit_limit))}</p>
            </div>
            <div className="bg-destructive/5 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Owing</p>
              <p className="text-sm font-bold text-destructive">{formatKES(balance)}</p>
            </div>
            <div className="bg-success/5 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Available</p>
              <p className="text-sm font-bold text-success">{formatKES(Math.max(0, Number(customer.credit_limit) - balance))}</p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Payment Amount ({currencyCode()})</label>
            <input type="number" min={1} max={balance} value={amount || ""} onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              placeholder="Enter amount received"
              className="fi" />
            {balance > 0 && (
              <button onClick={() => setAmount(balance)} className="text-xs text-primary mt-1.5 hover:underline">
                Pay full balance ({formatKES(balance)})
              </button>
            )}
          </div>

          <button onClick={handlePayment} disabled={amount <= 0 || saving}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2">
            <Banknote className="w-4 h-4" /> {saving ? "Processing..." : `Record ${formatKES(amount)} Payment`}
          </button>

          {/* Recent credit sales */}
          {creditTransactions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent Credit Sales</p>
              <div className="bg-muted/30 rounded-xl divide-y divide-border max-h-48 overflow-y-auto">
                {<PagedRows rows={creditTransactions} gridSpan>{(pageRows) => pageRows.map((tx: any) => (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">{formatDate(new Date(tx.created_at))}</p>
                    </div>
                    <span className="font-medium">{formatKES(tx.total)}</span>
                  </div>
                ))}</PagedRows>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddCreditCustomerForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { data: locations = [] } = useLocations();
  const { data: customers = [] } = useCustomers();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", location_id: "" });
  const [saving, setSaving] = useState(false);
  const [custSearch, setCustSearch] = useState("");

  const nonCreditCustomers = customers.filter(c => Number(c.credit_limit) === 0);
  const filteredExisting = nonCreditCustomers.filter(c =>
    !custSearch || c.name.toLowerCase().includes(custSearch.toLowerCase()) || c.phone.includes(custSearch)
  );

  const handleSubmit = async () => {
    const limit = parseFloat(creditLimit);
    if (!limit || limit <= 0) {
      toast({ title: "Enter a valid credit limit", variant: "destructive" });
      return;
    }
    setSaving(true);

    if (mode === "existing") {
      if (!selectedId) { toast({ title: "Select a customer", variant: "destructive" }); setSaving(false); return; }
      const { error } = await supabase.from("customers").update({ credit_limit: limit }).eq("id", selectedId);
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      if (!form.name || !form.phone) { toast({ title: "Name and phone required", variant: "destructive" }); setSaving(false); return; }
      const payload: any = {
        name: form.name, phone: form.phone, email: form.email || null,
        credit_limit: limit, tenant_id: profile?.tenant_id || null,
      };
      if (form.location_id) payload.location_id = form.location_id;
      const { error } = await supabase.from("customers").insert(payload);
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }

    queryClient.invalidateQueries({ queryKey: ["customers"] });
    toast({ title: mode === "existing" ? "Credit limit assigned" : "Credit customer added" });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg">Add Credit Customer</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(85vh-4rem)]">
          <div className="flex gap-2">
            <button onClick={() => setMode("existing")}
              className={cn("flex-1 py-2 rounded-lg text-sm font-medium", mode === "existing" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
              Existing Customer
            </button>
            <button onClick={() => setMode("new")}
              className={cn("flex-1 py-2 rounded-lg text-sm font-medium", mode === "new" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
              New Customer
            </button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-3">
              <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Search customers..."
                className="fi" />
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {filteredExisting.slice(0, 20).map(c => (
                  <button key={c.id} onClick={() => setSelectedId(c.id)}
                    className={cn("w-full text-left px-3 py-2 text-sm hover:bg-muted/50", selectedId === c.id && "bg-primary/10")}>
                    <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {c.phone}</span>
                  </button>
                ))}
                {filteredExisting.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">No customers without credit</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="text-sm font-medium mb-1 block">Name</label>
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="fi" /></div>
              <div><label className="text-sm font-medium mb-1 block">Phone</label>
                <input required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="fi" placeholder="Enter phone number" /></div>
              <div><label className="text-sm font-medium mb-1 block">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="fi" /></div>
              <div><label className="text-sm font-medium mb-1 block">Store</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <select value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                    className="fi pl-9 pr-3">
                    <option value="">Select store (optional)</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div><label className="text-sm font-medium mb-1 block">Credit Limit ({currencyCode()})</label>
            <input type="number" min="1" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="e.g. 5000"
              className="fi" /></div>

          <button onClick={handleSubmit} disabled={saving}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Assign Credit Limit"}
          </button>
        </div>
      </div>
    </div>
  );
}
