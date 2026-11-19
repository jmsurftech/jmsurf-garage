import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2, ShoppingCart, ArrowRight, Smartphone, Truck, Store, CheckCircle2, XCircle, Shapes as BrandIcon, RotateCcw, Wallet, Landmark } from "lucide-react";
import ShopLayout from "../ShopLayout";
import { useCatalogue, useCart, useShopInfo, priceFor, kes, shopApi, getCustomerToken } from "../shopData";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { BrandOrb } from "@/components/Orb";
import PageHead from "@/components/PageHead";
import { cn } from "@/lib/utils";

function useCartRows() {
  const { lines } = useCart();
  const { data: items = [], isLoading } = useCatalogue();
  const { data: shop } = useShopInfo();
  const rows = useMemo(() => lines.map((l) => ({ line: l, item: items.find((i) => i.id === l.id) })).filter((r) => r.item) as { line: { id: string; qty: number }; item: any }[], [lines, items]);
  const subtotal = rows.reduce((a, r) => a + priceFor(r.item, r.line.qty) * r.line.qty, 0);
  const problems = rows.filter((r) => (r.item.kind === "product" && shop?.sell_out_of_stock === false && r.line.qty > (r.item.stock ?? 0)) || r.line.qty < (r.item.min_order_qty || 1));
  return { rows, subtotal, problems, isLoading, missing: lines.length - rows.length };
}

export function CartPage() {
  const { setQty, remove } = useCart();
  const { rows, subtotal, problems, isLoading } = useCartRows();
  const { data: shop } = useShopInfo();
  const navigate = useNavigate();
  if (isLoading) return <ShopLayout><OrbLoader label="Loading your cart…" /></ShopLayout>;
  return (
    <ShopLayout>
      <PageHead title="Your cart · JMSURF Garage" description="Items in your cart." path="/cart" noindex />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="font-display text-3xl font-bold">Your cart</h1>
        {rows.length === 0 ? (
          <div className="mt-12 flex flex-col items-center text-center"><BrandOrb state="breathing" size={140} /><p className="mt-4 font-display text-xl font-bold">Your cart is empty</p><Link to="/shop" className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">Start shopping <ArrowRight className="h-4 w-4" /></Link></div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="divide-y divide-border rounded-2xl border border-border bg-card">
              {rows.map(({ line, item }) => {
                const unit = priceFor(item, line.qty);
                const bad = (item.kind === "product" && shop?.sell_out_of_stock === false && line.qty > (item.stock ?? 0)) || line.qty < (item.min_order_qty || 1);
                return (
                  <div key={line.id} className="flex gap-4 p-4">
                    <Link to={`/shop/p/${item.id}`} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">{item.images[0] ? <img src={item.images[0]} alt="" className="h-full w-full object-cover" /> : <BrandIcon className="m-6 h-8 w-8 text-muted-foreground/40" />}</Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/shop/p/${item.id}`} className="line-clamp-2 font-medium hover:text-primary">{item.name}</Link>
                      <p className="text-sm text-muted-foreground">{kes(unit)} each{unit < item.price && <span className="ml-1 text-success">(volume price)</span>}</p>
                      {bad && <p className="text-xs font-semibold text-destructive">{line.qty < (item.min_order_qty || 1) ? `Minimum order is ${item.min_order_qty}` : `Only ${Math.max(0, item.stock ?? 0)} in stock`}</p>}
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex items-center rounded-full border border-input">
                          <button onClick={() => setQty(line.id, line.qty - 1)} className="p-1.5" aria-label="Less"><Minus className="h-4 w-4" /></button>
                          <span className="w-10 text-center text-sm font-semibold">{line.qty}</span>
                          <button onClick={() => setQty(line.id, line.qty + 1)} className="p-1.5" aria-label="More"><Plus className="h-4 w-4" /></button>
                        </div>
                        <button onClick={() => remove(line.id)} className="text-sm text-muted-foreground hover:text-destructive"><Trash2 className="mr-1 inline h-4 w-4" />Remove</button>
                      </div>
                    </div>
                    <p className="font-display font-bold">{kes(unit * line.qty)}</p>
                  </div>
                );
              })}
            </div>
            <aside className="h-fit rounded-2xl border border-border bg-card p-5">
              <p className="flex justify-between text-sm"><span>Subtotal</span><b>{kes(subtotal)}</b></p>
              <p className="mt-1 text-xs text-muted-foreground">{shop?.delivery ? `Delivery ${shop.delivery_fee ? kes(shop.delivery_fee) : "free"}${shop.free_delivery_over ? ` (free over ${kes(shop.free_delivery_over)})` : ""} if you choose it.` : "Pick up at the shop."}</p>
              {!!shop?.min_order && subtotal < shop.min_order && <p className="mt-2 text-xs font-semibold text-destructive">The minimum order is {kes(shop.min_order)}. Add {kes(shop.min_order - subtotal)} more.</p>}
              <button disabled={problems.length > 0 || (!!shop?.min_order && subtotal < shop.min_order)} onClick={() => navigate("/checkout")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-display font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">Checkout <ArrowRight className="h-4 w-4" /></button>
              {problems.length > 0 && <p className="mt-2 text-center text-xs text-destructive">Fix the quantities above to continue.</p>}
              <Link to="/shop" className="mt-3 block text-center text-sm text-primary">Continue shopping</Link>
            </aside>
          </div>
        )}
      </div>
    </ShopLayout>
  );
}

export function CheckoutPage() {
  const { lines, clear } = useCart();
  const { rows, subtotal, problems, isLoading } = useCartRows();
  const { data: shop } = useShopInfo();
  const navigate = useNavigate();
  const token = getCustomerToken();
  const { data: me } = useQuery({ queryKey: ["shop-me", token], enabled: !!token, retry: false, queryFn: () => shopApi<any>("c/me", {}, token) });
  const [f, setF] = useState({ name: "", phone: "", email: "", delivery_method: "pickup", address: "", notes: "", payment_method: "mpesa" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (me?.customer) setF((x) => ({ ...x, name: x.name || me.customer.name || "", phone: x.phone || me.customer.phone || "", email: x.email || me.customer.email || "", address: x.address || [me.customer.building, me.customer.address, me.customer.area].filter(Boolean).join(", ") }));
  }, [me]);
  useEffect(() => { if (shop && !shop.mpesa) setF((x) => ({ ...x, payment_method: shop.pay_on_delivery ? "pay_on_delivery" : "bank_transfer" })); if (shop && !shop.pickup) setF((x) => ({ ...x, delivery_method: "delivery" })); }, [shop]);
  const fee = f.delivery_method === "delivery" && shop && !(shop.free_delivery_over && subtotal >= shop.free_delivery_over) ? shop.delivery_fee : 0;
  const total = Math.round(subtotal) + Math.round(fee);

  const place = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await shopApi<any>("order", { items: lines.map((l) => ({ id: l.id, qty: l.qty })), ...f }, token);
      clear();
      navigate(`/order/${r.order.id}?t=${r.order.token}${r.prompt && !r.prompt.ok ? `&e=${encodeURIComponent(r.prompt.error || "")}` : ""}`);
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  if (isLoading) return <ShopLayout><OrbLoader label="Loading…" /></ShopLayout>;
  if (!rows.length) return <ShopLayout><div className="mx-auto max-w-xl px-4 py-24 text-center"><p className="font-display text-2xl font-bold">Your cart is empty</p><Link to="/shop" className="mt-4 inline-block font-semibold text-primary">Go to the shop</Link></div></ShopLayout>;
  const Opt = ({ on, onClick, icon: Icon, title, hint }: any) => (
    <button type="button" onClick={onClick} className={cn("flex w-full items-start gap-3 rounded-2xl border p-4 text-left", on ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
      <Icon className={cn("mt-0.5 h-5 w-5", on ? "text-primary" : "text-muted-foreground")} /><span><span className="block font-semibold">{title}</span><span className="text-sm text-muted-foreground">{hint}</span></span>
    </button>
  );
  return (
    <ShopLayout>
      <PageHead title="Checkout · JMSURF Garage" description="Complete your order." path="/checkout" noindex />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <h1 className="font-display text-3xl font-bold">Checkout</h1>
          {!token && <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm">Have an account? <Link to="/login?next=/checkout" className="font-semibold text-primary">Sign in</Link> to see this order with your purchases. Or just continue.</p>}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Your details</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="fi" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <input className="fi" placeholder="Enter M-Pesa phone number" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <input className="fi sm:col-span-2" placeholder="Email (optional, for your receipt)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">How do you want it?</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shop?.pickup && <Opt on={f.delivery_method === "pickup"} onClick={() => setF({ ...f, delivery_method: "pickup" })} icon={Store} title="Pick up at the shop" hint={shop.address || "Free"} />}
              {shop?.delivery && <Opt on={f.delivery_method === "delivery"} onClick={() => setF({ ...f, delivery_method: "delivery" })} icon={Truck} title="Deliver to me" hint={shop.delivery_fee ? `${kes(shop.delivery_fee)}${shop.free_delivery_over ? `, free over ${kes(shop.free_delivery_over)}` : ""}` : "Free"} />}
            </div>
            {f.delivery_method === "delivery" && <textarea className="fi mt-3" rows={2} placeholder="Delivery address: estate, building, house number, landmark" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}
            <textarea className="fi mt-3" rows={2} placeholder="Notes for the shop (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Payment</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shop?.mpesa && <Opt on={f.payment_method === "mpesa"} onClick={() => setF({ ...f, payment_method: "mpesa" })} icon={Smartphone} title="M-Pesa" hint="We'll send a prompt to your phone. Enter your PIN." />}
              {shop?.pay_on_delivery && <Opt on={f.payment_method === "pay_on_delivery"} onClick={() => setF({ ...f, payment_method: "pay_on_delivery" })} icon={Wallet} title={f.delivery_method === "delivery" ? "Pay on delivery" : "Pay when you collect"} hint="Cash, M-Pesa or card" />}
              {shop?.bank_details && <Opt on={f.payment_method === "bank_transfer"} onClick={() => setF({ ...f, payment_method: "bank_transfer" })} icon={Landmark} title="Bank transfer" hint="We'll show the account details" />}
            </div>
          </section>
          {error && <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
        </div>
        <aside className="h-fit rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="font-display text-lg font-bold">Order summary</h2>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">{rows.map(({ line, item }) => (
            <li key={line.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.name} × {line.qty}</span><span className="shrink-0">{kes(priceFor(item, line.qty) * line.qty)}</span></li>
          ))}</ul>
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <p className="flex justify-between"><span>Subtotal</span><span>{kes(subtotal)}</span></p>
            <p className="flex justify-between"><span>Delivery</span><span>{fee ? kes(fee) : "Free"}</span></p>
            <p className="flex justify-between pt-1 font-display text-lg font-bold"><span>Total</span><span className="text-primary">{kes(total)}</span></p>
          </div>
          <button onClick={place} disabled={busy || problems.length > 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-display font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-40">
            {busy ? <OrbSpinner className="h-5 w-5" state="connecting" /> : f.payment_method === "mpesa" ? <Smartphone className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
            {f.payment_method === "mpesa" ? `Pay ${kes(total)} with M-Pesa` : "Place order"}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">Prices and stock are checked again when you order.</p>
        </aside>
      </div>
    </ShopLayout>
  );
}

export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const token = params.get("t") || "";
  const [promptError, setPromptError] = useState(params.get("e") || "");
  const [retryPhone, setRetryPhone] = useState("");
  const [retrying, setRetrying] = useState(false);
  const { data: shop } = useShopInfo();
  const { data, refetch } = useQuery({
    queryKey: ["web-order", id, token],
    enabled: !!id && !!token,
    refetchInterval: (q) => ((q.state.data as any)?.order?.status === "pending_payment" && (q.state.data as any)?.order?.payment_method === "mpesa" ? 3000 : false),
    queryFn: () => shopApi<any>("order/status", { id, token }),
  });
  const o = data?.order;
  const pay = data?.payment;
  const paid = o && o.status !== "pending_payment" && o.status !== "cancelled";
  const failed = pay && (pay.sale === "failed" || pay.sale === "cancelled" || pay.prompt === "failed" || pay.prompt === "cancelled");
  const retry = async () => {
    setRetrying(true); setPromptError("");
    try { const r = await shopApi<any>("order/retry", { id, token, phone: retryPhone || undefined }); if (!r.ok) setPromptError(r.error || "M-Pesa did not answer"); await refetch(); }
    catch (e: any) { setPromptError(e.message); } finally { setRetrying(false); }
  };
  if (!o) return <ShopLayout><OrbLoader label="Loading your order…" /></ShopLayout>;
  return (
    <ShopLayout>
      <PageHead title={`Order ${o.order_no} · JMSURF Garage`} description="Your order." path="/order" noindex />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-3xl border border-border bg-card p-6 text-center sm:p-10">
          {paid ? <CheckCircle2 className="mx-auto h-16 w-16 text-success" /> : failed || promptError ? <XCircle className="mx-auto h-16 w-16 text-destructive" /> : o.payment_method === "mpesa" ? <BrandOrb state="connecting" size={90} className="mx-auto" /> : <CheckCircle2 className="mx-auto h-16 w-16 text-primary" />}
          <h1 className="mt-4 font-display text-2xl font-bold">
            {paid ? "Thank you! Payment received." : o.payment_method === "mpesa" ? (failed || promptError ? "Payment not completed" : "Check your phone") : "Order received"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Order <b className="text-foreground">{o.order_no}</b> · {kes(Number(o.total))} · {o.delivery_method === "delivery" ? "Delivery" : "Pickup"}
          </p>
          {!paid && o.payment_method === "mpesa" && !failed && !promptError && <p className="mt-3 text-sm">Enter your M-Pesa PIN on the prompt. This page updates by itself.</p>}
          {(failed || promptError) && !paid && (
            <div className="mx-auto mt-5 max-w-sm space-y-3">
              <p className="text-sm text-destructive">{promptError || pay?.reason || "The M-Pesa payment did not go through. No money was taken."}</p>
              <input className="fi" placeholder="M-Pesa number (leave empty to use the same)" inputMode="tel" value={retryPhone} onChange={(e) => setRetryPhone(e.target.value)} />
              <button onClick={retry} disabled={retrying} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-primary-foreground">{retrying ? <OrbSpinner className="h-5 w-5" /> : <RotateCcw className="h-4 w-4" />} Send the prompt again</button>
            </div>
          )}
          {o.payment_method === "pay_on_delivery" && <p className="mt-3 text-sm">Pay when you {o.delivery_method === "delivery" ? "receive it" : "collect it"}. We'll call you to confirm.</p>}
          {o.payment_method === "bank_transfer" && shop?.bank_details && <div className="mx-auto mt-4 max-w-sm whitespace-pre-wrap rounded-2xl bg-muted/60 p-4 text-left text-sm"><b>Pay to:</b>{"\n"}{shop.bank_details}{"\n"}<b>Reference:</b> {o.order_no}</div>}
          <ul className="mx-auto mt-6 max-w-sm divide-y divide-border text-left text-sm">{(o.items || []).map((i: any, k: number) => <li key={k} className="flex justify-between py-2"><span>{i.name} × {i.quantity}</span><span>{kes(i.price * i.quantity)}</span></li>)}</ul>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/shop" className="rounded-full border border-border px-5 py-2.5 font-semibold hover:border-primary">Keep shopping</Link>
            <Link to="/account" className="rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground">My purchases</Link>
          </div>
        </div>
      </div>
    </ShopLayout>
  );
}
