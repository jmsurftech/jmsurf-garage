import { PageHeader } from "@/components/kit";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Minus, Trash2, Search, Calendar as CalendarIcon, ReceiptText } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import {
  useBusinessSettings,
  useCustomers,
  useLocations,
  useProductStocks,
  useUserLocations,
} from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { logActivity } from "@/lib/auditLog";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tenantPath } from "@/lib/host";

export default function RecordPayment() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { slug } = useParams();

  const { data: customers = [] } = useCustomers();
  const { data: locations = [] } = useLocations();
  const { data: userLocs = [] } = useUserLocations(user?.id);
  useBusinessSettings();

  const primaryLoc =
    userLocs.find((u) => u.is_primary)?.location_id || locations[0]?.id || "";
  const [locationId, setLocationId] = useState(primaryLoc);
  const { data: products = [] } = useProductStocks(locationId);

  const [items, setItems] = useState<Array<{ product: any; quantity: number }>>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [customerId, setCustomerId] = useState("");
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  const [dateOpen, setDateOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const isPast = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(saleDate); d.setHours(0, 0, 0, 0);
    return d.getTime() < t.getTime();
  }, [saleDate]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 30);
    return products.filter((p: any) =>
      p.name.toLowerCase().includes(q) ||
      (p.barcode || "").toLowerCase().includes(q) ||
      (p.sku || "").toLowerCase().includes(q),
    );
  }, [products, productSearch]);

  const addItem = (product: any) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          toast({ title: "Insufficient stock", variant: "destructive" });
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setProductSearch("");
  };

  const subtotal = items.reduce(
    (s, i) => s + Number(i.product.price) * i.quantity,
    0,
  );
  const tax = items.reduce(
    (s, i) =>
      s +
      (Number(i.product.price) * i.quantity * Number(i.product.vat_rate)) /
        (100 + Number(i.product.vat_rate)),
    0,
  );
  const customer = customers.find((c: any) => c.id === customerId);

  const backToPayments = () => navigate(tenantPath(slug, "/payments"));

  const handleSave = async () => {
    if (items.length === 0) {
      toast({ title: "Add at least one product", variant: "destructive" });
      return;
    }
    setSaving(true);

    const saleItems = items.map((i) => ({
      id: i.product.id,
      name: i.product.name,
      sku: i.product.sku,
      price: Number(i.product.price),
      quantity: i.quantity,
      vat_rate: Number(i.product.vat_rate),
      cost_price: Number(i.product.cost_price),
    }));

    // For backdated sales, anchor the timestamp at noon LOCAL on the picked
    // calendar day so the saved date matches what the user selected regardless
    // of timezone. For today, preserve current time-of-day.
    let created: Date;
    if (isPast) {
      created = new Date(
        saleDate.getFullYear(),
        saleDate.getMonth(),
        saleDate.getDate(),
        12, 0, 0, 0,
      );
    } else {
      created = new Date();
    }

    const { data: txRow, error } = await (supabase as any)
      .from("transactions")
      .insert({
        items: saleItems,
        subtotal,
        tax,
        discount: 0,
        total: subtotal,
        payment_method: paymentMethod,
        customer_id: customerId || null,
        customer_name: customer?.name || "Walk-in",
        cashier_id: user?.id,
        cashier_name: profile?.display_name || "Unknown",
        status: "completed",
        location_id: locationId,
        tenant_id: profile?.tenant_id || null,
        created_at: created.toISOString(),
        stock_by_server: true,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Inventory for recorded sales (including backdated ones) is reduced by
    // the database when the completed sale is saved (trigger apply_sale_stock).

    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["product-stocks"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    logActivity({
      action: "payment_added",
      entity_type: "transaction",
      entity_id: txRow?.id,
      description: `Payment ${formatKES(subtotal)} (${paymentMethod})${
        customer?.name ? ` from ${customer.name}` : ""
      }${isPast ? ` — backdated ${format(saleDate, "PP")}` : ""}`,
      metadata: {
        amount: subtotal,
        method: paymentMethod,
        items: items.length,
        location_id: locationId,
        backdated: isPast,
        sale_date: created.toISOString(),
      },
    });
    toast({
      title: isPast ? "Past sale recorded" : "Payment recorded",
      description: `${formatKES(subtotal)} saved${
        isPast ? ` for ${format(saleDate, "PP")} — inventory updated` : " and inventory updated"
      }`,
    });

    setSaving(false);
    backToPayments();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <button
          onClick={backToPayments}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
          aria-label="Back to payments"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader icon={ReceiptText} title={"Record a past sale"} description={"Add a sale for today or backdate it to any past date."} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Details */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Sale date</label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg bg-muted border border-input text-sm",
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4" />
                        {format(saleDate, "PPP")}
                      </span>
                      {isPast && (
                        <span className="text-[10px] uppercase tracking-wide text-warning font-medium">
                          Backdated
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={saleDate}
                      onSelect={(d) => { if (d) { setSaleDate(d); setDateOpen(false); } }}
                      disabled={(d) => d > new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Location</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="fi"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="fi"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="card">Card</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Customer (optional)</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="fi"
              >
                <option value="">Walk-in</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Product search */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <label className="text-sm font-medium block">Search and select items sold</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search by name, SKU or barcode…"
                className="fi pl-10 pr-4"
              />
            </div>
            <div className="border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-border">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">
                  No matching products.
                </p>
              ) : (
                filteredProducts.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => addItem(p)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted text-left"
                  >
                    <span className="min-w-0 truncate">
                      {p.name}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({p.stock} in stock)
                      </span>
                    </span>
                    <span className="font-medium shrink-0 ml-3">
                      {formatKES(Number(p.price))}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Cart summary */}
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3 h-fit lg:sticky lg:top-4">
          <p className="text-sm font-display font-semibold">Items ({items.length})</p>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No items added yet.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.product.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatKES(Number(item.product.price))} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        setItems((prev) =>
                          prev.map((i) =>
                            i.product.id === item.product.id
                              ? { ...i, quantity: Math.max(1, i.quantity - 1) }
                              : i,
                          ),
                        )
                      }
                      className="w-7 h-7 rounded bg-secondary flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (isNaN(v) || v < 1) return;
                        if (v > item.product.stock) {
                          toast({ title: "Insufficient stock", variant: "destructive" });
                          return;
                        }
                        setItems((prev) =>
                          prev.map((i) =>
                            i.product.id === item.product.id ? { ...i, quantity: v } : i,
                          ),
                        );
                      }}
                      className="w-12 text-center text-sm font-medium bg-transparent border border-input rounded py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={() =>
                        setItems((prev) =>
                          prev.map((i) =>
                            i.product.id === item.product.id
                              ? {
                                  ...i,
                                  quantity: Math.min(i.quantity + 1, item.product.stock),
                                }
                              : i,
                          ),
                        )
                      }
                      className="w-7 h-7 rounded bg-secondary flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.filter((i) => i.product.id !== item.product.id),
                      )
                    }
                    className="text-destructive p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-border space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatKES(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT (incl.)</span>
              <span>{formatKES(tax)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border font-display font-bold text-base">
              <span>Total</span>
              <span className="text-primary">{formatKES(subtotal)}</span>
            </div>
          </div>

          {isPast && (
            <p className="text-[11px] text-warning bg-warning/10 border border-warning/20 rounded-md p-2">
              Backdated sale — recorded on {format(saleDate, "PP")}. Inventory will be deducted.
            </p>
          )}


          <button
            onClick={handleSave}
            disabled={saving || items.length === 0}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40"
          >
            {saving
              ? "Saving…"
              : `Record Payment — ${formatKES(subtotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
