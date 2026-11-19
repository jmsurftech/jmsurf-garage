import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { BadgePercent, CalendarClock, Droplets, Gift, Maximize2, MonitorPlay, Package, Plus, Settings2, Smartphone, Users } from "lucide-react";
import { Modal, PageHeader, Panel } from "@/components/kit";
import { fmtMoney } from "@/apps/format";
import { useLookup } from "@/apps/data";
import { useTenantId } from "@/hooks/useTenantId";
import { useModules } from "@/hooks/useModules";
import { supabase } from "@/integrations/supabase/client";
import { WASH_STAGES } from "../apps";
import { customerByPhone, insertRec, moveStage, num, patchRec, useInvoices, useModuleSettings, useRecs, useRefresh, type Rec } from "../shared/db";
import { createInvoice, invoicePayLink, smsPayLink } from "../shared/billing";
import { btn, btnPrimary, EmployeeSelect, Labeled, ModuleHome, NumIn, Gate, useAction } from "../shared/ui";
import { commission, daysBetween, loyaltyStatus, normalisePlate } from "../lib/calc";
import { cn } from "@/lib/utils";

interface WashSettings { loyaltyEvery: number }
const useWashSettings = () => useModuleSettings<WashSettings>("car_wash", { loyaltyEvery: 6 });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const monthOf = (iso: string) => iso.slice(0, 7);

export function WashHome() {
  const { data: washes = [] } = useRecs("car_wash", "wash");
  const { data: subs = [] } = useRecs("car_wash", "subscription");
  const { data: staff = [] } = useLookup("employee");
  const s = useWashSettings();
  const { busy, run } = useAction();
  const today = washes.filter((w) => isToday(w.created_at));
  const m = new Date().toISOString().slice(0, 7);
  const month = washes.filter((w) => monthOf(w.created_at) === m);
  const byWasher = useMemo(() => {
    const out = new Map<string, { n: number; value: number; commission: number }>();
    for (const w of month) {
      const k = w.employee_id || "";
      const r = out.get(k) || { n: 0, value: 0, commission: 0 };
      r.n++; r.value += num(w.amount); r.commission += num(w.data?.commission);
      out.set(k, r);
    }
    return Array.from(out.entries()).sort((a, b) => b[1].n - a[1].n);
  }, [month]);
  return (
    <ModuleHome module="car_wash" title="Car wash & detailing" icon={Droplets}
      actions={<><Link to="/garage/wash/board" className={btnPrimary}><MonitorPlay className="h-4 w-4" /> Open queue board</Link></>}
      stats={[
        { label: "Cars today", value: today.length, icon: Droplets },
        { label: "Takings today", value: fmtMoney(today.reduce((a, w) => a + num(w.amount), 0)), tone: "success" },
        { label: "In the bay now", value: washes.filter((w) => ["queued", "washing", "finishing", "ready"].includes(String(w.stage))).length, tone: "warning" },
        { label: "Active subscriptions", value: subs.filter((x) => x.stage === "active").length, icon: CalendarClock },
      ]}
      links={[
        { to: "/garage/wash/board", label: "Queue board", icon: MonitorPlay, hint: "TV or phone" },
        { to: "/apps/car_wash/wash", label: "All washes", icon: Droplets },
        { to: "/apps/car_wash/package", label: "Packages & add-ons", icon: Package },
        { to: "/apps/car_wash/subscription", label: "Subscriptions", icon: CalendarClock },
      ]}>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Washer commission this month" icon={BadgePercent} flush>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Washer</th><th className="num">Cars</th><th className="num">Value</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {byWasher.map(([k, r]) => <tr key={k}><td data-label="Washer">{staff.find((x) => x.id === k)?.label || "Not assigned"}</td><td data-label="Cars" className="num">{r.n}</td><td data-label="Value" className="num">{fmtMoney(r.value)}</td><td data-label="Commission" className="num font-semibold">{fmtMoney(r.commission)}</td></tr>)}
                {!byWasher.length && <tr><td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No washes this month.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Loyalty" icon={Gift}>
          <div className="flex flex-wrap items-end gap-2">
            <Labeled label="Every Nth wash is free (0 = off)"><NumIn value={s.value.loyaltyEvery} onChange={(v) => void run("l", () => s.save({ loyaltyEvery: v ?? 0 }), "Saved")} /></Labeled>
            {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Stamps count paid washes per customer (by phone). When a customer reaches the free one, the board shows it at check-in.</p>
        </Panel>
      </div>
      <Subscriptions subs={subs} washes={washes} />
    </ModuleHome>
  );
}

/** Monthly wash plans: washes used this month, and the month's invoice (paid-until moves on a month). */
function Subscriptions({ subs, washes }: { subs: Rec[]; washes: Rec[] }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const m = new Date().toISOString().slice(0, 7);
  const bill = (s: Rec) => run(s.id, async () => {
    if (!s.customer_id) throw new Error("Set the customer on the subscription first");
    if (!num(s.amount)) throw new Error("Set the monthly price first");
    const from = s.ends_at ? new Date(s.ends_at) : new Date();
    const until = new Date(from); until.setMonth(until.getMonth() + 1);
    const inv = await createInvoice(tenantId!, { customerId: s.customer_id, lines: [{ name: `Car wash subscription ${s.title}: ${num(s.quantity) || "unlimited"} washes, ${from.toISOString().slice(0, 10)} to ${until.toISOString().slice(0, 10)}`, quantity: 1, rate: num(s.amount) }], subject: `Wash subscription ${s.number || ""}`, reference: s.number, source: "garage_wash", status: "sent", dueDays: 0 });
    await patchRec(s.id, { ends_at: until.toISOString().slice(0, 10), data: { last_invoice_id: inv.id, invoices: [...(s.data?.invoices || []), inv.id] } } as any);
    refresh("car_wash");
  }, "Subscription invoice created");
  const active = subs.filter((s) => s.stage === "active");
  return (
    <Panel title="Subscriptions" icon={CalendarClock} flush>
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr><th>Plan</th><th className="num">Used this month</th><th>Paid until</th><th className="num">Monthly</th><th /></tr></thead>
          <tbody>
            {active.map((s) => {
              const used = washes.filter((w) => w.data?.subscription === s.id && monthOf(w.created_at) === m).length;
              const lapsed = !s.ends_at || daysBetween(new Date(), s.ends_at) < 0;
              return (
                <tr key={s.id}>
                  <td data-label="Plan"><Link className="text-primary" to={`/apps/car_wash/subscription?open=${s.id}`}>{s.number} {s.title}</Link></td>
                  <td data-label="Used" className="num">{used}{num(s.quantity) ? ` / ${num(s.quantity)}` : ""}</td>
                  <td data-label="Paid until" className={lapsed ? "font-semibold text-destructive" : ""}>{s.ends_at ? String(s.ends_at).slice(0, 10) : "Not paid"}</td>
                  <td data-label="Monthly" className="num">{fmtMoney(num(s.amount))}</td>
                  <td className="text-right"><button className={btn} disabled={!!busy} onClick={() => bill(s)}>Invoice next month</button></td>
                </tr>
              );
            })}
            {!active.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No active subscriptions.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Full-screen queue board (bare route): check-in, move through the bay, pay at the gate. */
export function WashBoard() {
  return <Gate module="car_wash"><Board /></Gate>;
}

function Board() {
  const tenantId = useTenantId();
  const { data: washes = [], refetch } = useRecs("car_wash", "wash");
  const refresh = useRefresh();
  const [checkIn, setCheckIn] = useState(false);
  const [pay, setPay] = useState<Rec | null>(null);
  const { run } = useAction();
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`wash-board-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_records", filter: `tenant_id=eq.${tenantId}` }, (p: any) => { if ((p.new || p.old)?.app === "car_wash") void refetch(); })
      .subscribe();
    const t = setInterval(() => void refetch(), 30000);
    return () => { void supabase.removeChannel(ch); clearInterval(t); };
  }, [tenantId, refetch]);
  const live = washes.filter((w) => !w.archived && (w.stage !== "collected" || isToday(w.updated_at)));
  const cols = WASH_STAGES;
  const next = (w: Rec) => cols[Math.min(cols.length - 1, cols.findIndex((s) => s.key === w.stage) + 1)];
  return (
    <div className="flex min-h-[100svh] flex-col bg-background p-2 sm:p-3">
      <div className="mb-2 flex items-center gap-2">
        <Droplets className="h-6 w-6 text-primary" />
        <h1 className="flex-1 font-display text-xl font-bold">Wash bay</h1>
        <span className="hidden text-sm text-muted-foreground sm:inline">{new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}</span>
        <button className={btn} onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)} aria-label="Full screen"><Maximize2 className="h-4 w-4" /></button>
        <Link to="/garage/wash" className={btn}>Back</Link>
        <button className={btnPrimary} onClick={() => setCheckIn(true)}><Plus className="h-4 w-4" /> Check in</button>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {cols.map((s) => {
          const items = live.filter((w) => (w.stage || "queued") === s.key);
          return (
            <div key={s.key} className="flex flex-col rounded-2xl border border-border bg-muted/40">
              <div className="flex items-center justify-between px-3 py-2"><span className="font-semibold">{s.label}</span><span className="rounded-full bg-background px-2 text-sm font-bold">{items.length}</span></div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {items.map((w) => (
                  <div key={w.id} className="rounded-xl border border-border bg-card p-2.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display text-2xl font-black tracking-wide">{w.title}</p>
                      {w.data?.free ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">FREE</span> : w.data?.paid ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">PAID</span> : <span className="text-sm font-bold tabular-nums">{fmtMoney(num(w.amount))}</span>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{[w.data?.package_name, ...(w.data?.addon_names || [])].filter(Boolean).join(" + ")}</p>
                    <p className="text-xs text-muted-foreground">{w.data?.washer_name || "No washer"} · {Math.max(0, Math.round((Date.now() - new Date(w.created_at).getTime()) / 60000))} min</p>
                    <div className="mt-2 flex gap-1.5">
                      {s.key !== "collected" && <button className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-sm font-semibold text-primary-foreground" onClick={() => void run("mv", async () => { const n = next(w); await moveStage(w, n.key, n.label); void refetch(); })}>{next(w).label} →</button>}
                      {!w.data?.paid && !w.data?.free && <button className="rounded-lg border border-border px-2 py-1.5 text-sm font-semibold" onClick={() => setPay(w)}>Pay</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {checkIn && <CheckIn onClose={() => { setCheckIn(false); void refetch(); refresh("car_wash"); }} />}
      {pay && <PayModal wash={pay} onClose={() => { setPay(null); void refetch(); }} />}
    </div>
  );
}

function CheckIn({ onClose }: { onClose: () => void }) {
  const tenantId = useTenantId();
  const { data: packages = [] } = useRecs("car_wash", "package");
  const { data: washes = [] } = useRecs("car_wash", "wash");
  const { data: subs = [] } = useRecs("car_wash", "subscription");
  const { data: staff = [] } = useLookup("employee");
  const { value: settings } = useWashSettings();
  const { busy, run } = useAction();
  const [f, setF] = useState({ plate: "", phone: "", name: "", pkg: "", addons: [] as string[], washer: null as string | null });
  const pk = packages.filter((p) => (p.data?.type || "Package") === "Package");
  const addons = packages.filter((p) => p.data?.type === "Add-on");
  const plate = normalisePlate(f.plate);
  const phoneTail = f.phone.replace(/\D/g, "").slice(-9);
  const history = washes.filter((w) => (plate && w.title === plate) || (phoneTail && String(w.data?.phone || "").replace(/\D/g, "").endsWith(phoneTail)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).map((w) => ({ free: !!w.data?.free || !!w.data?.subscription }));
  const loyal = loyaltyStatus(history, settings.loyaltyEvery);
  const sub = plate ? subs.find((s) => s.stage === "active" && (normalisePlate(s.data?.plate) === plate || normalisePlate(s.title).includes(plate)) && (!s.ends_at || daysBetween(new Date(), s.ends_at) >= 0)) : undefined;
  const usedThisMonth = sub ? washes.filter((w) => w.data?.subscription === sub.id && monthOf(w.created_at) === new Date().toISOString().slice(0, 7)).length : 0;
  const subLeft = sub ? Math.max(0, num(sub.quantity) - usedThisMonth) : 0;
  const chosen = pk.find((p) => p.id === f.pkg);
  const chosenAddons = addons.filter((a) => f.addons.includes(a.id));
  const price = num(chosen?.amount) + chosenAddons.reduce((a, x) => a + num(x.amount), 0);
  const free = loyal.freeNow;
  const covered = !!sub && subLeft > 0;
  const charge = free || covered ? chosenAddons.reduce((a, x) => a + num(x.amount), 0) * (covered ? 1 : 0) : price;
  const comm = [chosen, ...chosenAddons].filter(Boolean).reduce((a, p: any) => a + commission(num(p.amount), { percent: num(p.data?.commission_pct), fixed: num(p.data?.commission_fixed) }), 0);
  const save = () => run("in", async () => {
    if (!plate) throw new Error("Enter the number plate");
    if (!chosen) throw new Error("Choose the package");
    const customerId = f.phone ? await customerByPhone(tenantId!, f.phone, f.name || plate) : null;
    await insertRec("car_wash", "wash", {
      title: plate, stage: "queued", customer_id: customerId, employee_id: f.washer, amount: charge,
      data: { phone: f.phone || null, package: chosen.id, package_name: chosen.title, addons: f.addons, addon_names: chosenAddons.map((a) => a.title), free, subscription: covered ? sub!.id : null, list_price: price, commission: Math.round(comm * 100) / 100, washer_name: staff.find((x) => x.id === f.washer)?.label || null, paid: charge <= 0 },
    }, "W-");
    onClose();
  }, free ? "Checked in: this wash is free (loyalty)" : "Checked in");
  return (
    <Modal open onClose={onClose} title="Check in a car" size="lg" footer={<><button className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!!busy} onClick={save}>Check in · {fmtMoney(charge)}</button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Number plate"><input autoFocus className="fi text-lg font-bold uppercase" placeholder="Enter number plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Labeled>
          <Labeled label="Customer phone"><input className="fi" inputMode="tel" placeholder="07XXXXXXXX" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Labeled>
          <Labeled label="Customer name (new customers)" className="col-span-2"><input className="fi" placeholder="Enter name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled>
        </div>
        {(plate || phoneTail) && settings.loyaltyEvery > 1 && (
          <div className={cn("rounded-xl p-2 text-sm", free ? "bg-success/10 text-success" : "bg-muted/50")}>
            <Gift className="mr-1 inline h-4 w-4" />{free ? "This wash is free (loyalty reward)." : `${loyal.stamps} of ${loyal.needed} stamps · ${loyal.toGo} more paid wash(es) to a free one.`}
            <div className="mt-1 flex gap-1">{Array.from({ length: loyal.needed }, (_, i) => <span key={i} className={cn("h-3 w-3 rounded-full", i < loyal.stamps ? "bg-primary" : "bg-border")} />)}</div>
          </div>
        )}
        {sub && <p className={cn("rounded-xl p-2 text-sm", covered ? "bg-info/10 text-info" : "bg-warning/10")}>{covered ? `Subscription ${sub.number || ""}: ${subLeft} wash(es) left this month. Package is covered.` : "Subscription washes for this month are used up."}</p>}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Package</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pk.map((p) => <button key={p.id} onClick={() => setF({ ...f, pkg: p.id })} className={cn("rounded-xl border p-2 text-left", f.pkg === p.id ? "border-primary bg-primary/10" : "border-border")}><p className="font-semibold">{p.title}</p><p className="text-sm tabular-nums">{fmtMoney(num(p.amount))}</p></button>)}
            {!pk.length && <p className="col-span-full text-sm text-muted-foreground">Add packages first (Packages & add-ons).</p>}
          </div>
        </div>
        {addons.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Add-ons</p>
            <div className="flex flex-wrap gap-2">{addons.map((a) => <button key={a.id} onClick={() => setF({ ...f, addons: f.addons.includes(a.id) ? f.addons.filter((x) => x !== a.id) : [...f.addons, a.id] })} className={cn("rounded-xl border px-3 py-1.5 text-sm", f.addons.includes(a.id) ? "border-primary bg-primary/10" : "border-border")}>{a.title} · {fmtMoney(num(a.amount))}</button>)}</div>
          </div>
        )}
        <Labeled label="Washer"><EmployeeSelect value={f.washer} onChange={(v) => setF({ ...f, washer: v })} /></Labeled>
      </div>
    </Modal>
  );
}

function PayModal({ wash, onClose }: { wash: Rec; onClose: () => void }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState(wash.data?.phone || "");
  const invQ = useInvoices([wash.data?.invoice_id]);
  const inv = invQ.data?.get(wash.data?.invoice_id);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(null)); }, [link]);
  useEffect(() => {
    if (!wash.data?.invoice_id) return;
    const t = setInterval(() => void invQ.refetch(), 5000);
    return () => clearInterval(t);
  }, [wash.data?.invoice_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (inv?.status === "paid" && !wash.data?.paid) void patchRec(wash.id, { data: { paid: true } }).then(() => refresh("car_wash")); }, [inv?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const ensureInvoice = async () => {
    if (wash.data?.invoice_id) return wash.data.invoice_id as string;
    const customerId = wash.customer_id || (phone ? await customerByPhone(tenantId!, phone, wash.title) : null);
    if (!customerId) throw new Error("Enter the customer's phone first");
    const lines = [{ name: `${wash.data?.package_name || "Car wash"} · ${wash.title}`, quantity: 1, rate: num(wash.amount) }];
    const i = await createInvoice(tenantId!, { customerId, lines, subject: `Car wash ${wash.number || ""}`, reference: wash.number, source: "garage_wash", status: "sent", dueDays: 0 });
    await patchRec(wash.id, { customer_id: customerId, data: { invoice_id: i.id, phone } } as any);
    wash.data = { ...(wash.data || {}), invoice_id: i.id };
    void invQ.refetch();
    return i.id;
  };
  return (
    <Modal open onClose={onClose} title={`Pay for ${wash.title}`} description={fmtMoney(num(wash.amount))} size="md" center>
      <div className="space-y-3">
        {inv?.status === "paid" ? <p className="rounded-xl bg-success/10 p-3 text-center font-semibold text-success">Paid. Thank you.</p> : (
          <>
            <Labeled label="Customer phone (M-Pesa)"><input className="fi" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></Labeled>
            <div className="grid grid-cols-2 gap-2">
              <button className={btnPrimary} disabled={!!busy} onClick={() => void run("sms", async () => { const id = await ensureInvoice(); setLink(await smsPayLink(id, phone, `${wash.title} car wash ${fmtMoney(num(wash.amount))}. Pay by M-Pesa:`)); }, "Payment link sent by SMS")}><Smartphone className="h-4 w-4" /> SMS pay link</button>
              <button className={btn} disabled={!!busy} onClick={() => void run("qr", async () => { const id = await ensureInvoice(); setLink(await invoicePayLink(id)); })}>Show QR</button>
            </div>
            {qr && <div className="flex flex-col items-center gap-1"><img src={qr} alt="Scan to pay" className="h-56 w-56 rounded-xl bg-white p-2" /><p className="text-xs text-muted-foreground">Scan to pay by M-Pesa. This screen updates when paid.</p></div>}
            <button className={btn} disabled={!!busy} onClick={() => void run("cash", async () => { await ensureInvoice(); await patchRec(wash.id, { data: { paid: true, paid_cash: true } }); refresh("car_wash"); onClose(); }, "Marked paid. Record the cash on the invoice in Sales.")}>Paid in cash</button>
          </>
        )}
      </div>
    </Modal>
  );
}
