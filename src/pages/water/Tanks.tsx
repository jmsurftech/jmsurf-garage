import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWaterTanks, type Tank } from "@/hooks/useWaterTanks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Plus, Truck, SlidersHorizontal, Tag, Pencil, History, AlertTriangle, PackagePlus, ArrowRight, MapPin, CalendarClock, TrendingDown, Gauge as GaugeIcon, StickyNote } from "lucide-react";
import { PageHeader, Modal, Field, StatTile, StatGrid, PageLoader, EmptyState, Pill, TableWrap } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import { WATER_SIZES, formatLitres } from "@/lib/businessType";
import { sizePrice, tankLevel, tankPercent, weightedCostPerLitre } from "@/lib/waterMath";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/books/confirm";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;

const num = (v: any) => Number(v) || 0;
const litres = (n: number) => `${num(n).toLocaleString(undefined, { maximumFractionDigits: 1 })} L`;

/** A tall water tank drawn to scale with its level, alert line and quarter marks. */
function TankVisual({ tank }: { tank: Tank }) {
  const pct = tankPercent(tank.current_l, tank.capacity_l);
  const alertPct = tankPercent(tank.alert_level_l, tank.capacity_l);
  const level = tankLevel(tank.current_l, tank.alert_level_l);
  const water = level === "ok" ? ["#38bdf8", "#0284c7"] : level === "low" ? ["#fbbf24", "#d97706"] : ["#f87171", "#dc2626"];
  const id = `w-${tank.id.slice(0, 8)}`;
  // Body of the tank inside the SVG: x 20..180, y 30..290 (260 high).
  const top = 30, h = 260, fillY = top + h * (1 - pct / 100), alertY = top + h * (1 - alertPct / 100);
  return (
    <div className="relative mx-auto w-full max-w-[220px] shrink-0">
      <svg viewBox="0 0 200 320" className="h-auto w-full drop-shadow-sm" role="img" aria-label={`${tank.name}: ${pct}% full`}>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={water[0]} stopOpacity="0.95" />
            <stop offset="100%" stopColor={water[1]} stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0.0" />
            <stop offset="20%" stopColor="white" stopOpacity="0.35" />
            <stop offset="35%" stopColor="white" stopOpacity="0.0" />
          </linearGradient>
          <clipPath id={`${id}-clip`}><rect x="20" y={top} width="160" height={h} rx="22" /></clipPath>
        </defs>
        {/* lid and outlet */}
        <rect x="70" y="8" width="60" height="16" rx="5" className="fill-muted-foreground/30" />
        <rect x="180" y="262" width="16" height="12" rx="3" className="fill-muted-foreground/40" />
        {/* body */}
        <rect x="20" y={top} width="160" height={h} rx="22" className="fill-muted/60 stroke-border" strokeWidth="3" />
        <g clipPath={`url(#${id}-clip)`}>
          <g style={{ transition: "transform 0.8s ease" }} transform={`translate(0 ${fillY - top})`}>
            <path d={`M0 ${top + 6} q 25 -10 50 0 t 50 0 t 50 0 t 50 0 t 50 0 V ${top + h + 10} H 0 Z`} fill={`url(#${id}-g)`}>
              <animateTransform attributeName="transform" type="translate" from="0 0" to="-100 0" dur="6s" repeatCount="indefinite" />
            </path>
          </g>
          <rect x="20" y={top} width="160" height={h} fill={`url(#${id}-shine)`} />
          {[25, 50, 75].map((m) => (
            <g key={m}>
              <line x1="20" x2="44" y1={top + h * (1 - m / 100)} y2={top + h * (1 - m / 100)} className="stroke-foreground/25" strokeWidth="2" />
              <text x="48" y={top + h * (1 - m / 100) + 4} className="fill-foreground/40" fontSize="11" fontWeight="600">{m}%</text>
            </g>
          ))}
          {tank.alert_level_l > 0 && (
            <g>
              <line x1="20" x2="180" y1={alertY} y2={alertY} stroke="#dc2626" strokeWidth="2" strokeDasharray="6 5" />
              <text x="174" y={alertY - 5} textAnchor="end" fill="#dc2626" fontSize="10" fontWeight="700">alert</text>
            </g>
          )}
        </g>
        {/* bands */}
        <rect x="16" y="95" width="168" height="6" rx="3" className="fill-muted-foreground/20" />
        <rect x="16" y="215" width="168" height="6" rx="3" className="fill-muted-foreground/20" />
        <text x="100" y="168" textAnchor="middle" fontSize="34" fontWeight="800" className="fill-foreground" style={{ paintOrder: "stroke" }} stroke="hsl(var(--background))" strokeWidth="5">{pct}%</text>
        <text x="100" y="190" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-foreground/70" style={{ paintOrder: "stroke" }} stroke="hsl(var(--background))" strokeWidth="4">{litres(tank.current_l)}</text>
        {/* legs */}
        <rect x="40" y="290" width="14" height="24" rx="3" className="fill-muted-foreground/40" />
        <rect x="146" y="290" width="14" height="24" rx="3" className="fill-muted-foreground/40" />
      </svg>
    </div>
  );
}

function Detail({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "success" | "warning" }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-display text-lg font-bold tabular-nums leading-tight",
        tone === "danger" && "text-destructive", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

type Dialog =
  | { kind: "tank"; tank?: Tank }
  | { kind: "buy"; tank: Tank }
  | { kind: "adjust"; tank: Tank }
  | { kind: "price"; tank: Tank }
  | { kind: "history"; tank: Tank }
  | null;

/** Water refill: tanks, bulk purchases and the price per litre. */
export default function Tanks() {
  const tenantId = useTenantId();
  const { role } = useAuth() as any;
  const canManage = ["admin", "manager", "super_admin"].includes(role);
  const qc = useQueryClient();
  const { toast } = useToast();
  const nav = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { data: locations = [] } = useLocations();
  const { data: tanks = [], isLoading } = useWaterTanks();
  const [dialog, setDialog] = useState<Dialog>(null);

  const { data: sizes = [] } = useQuery({
    queryKey: ["water-sizes", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("products").select("id,name,price,cost_price,litres,tank_id,price_auto,is_active")
        .eq("tenant_id", tenantId).not("litres", "is", null).eq("is_active", true).order("litres");
      if (error) throw error;
      return data || [];
    },
  });
  // Last 30 days of tank movements: last fill, litres sold today / this week.
  const since = useMemo(() => new Date(Date.now() - 30 * 86400_000).toISOString(), []);
  const { data: moves = [] } = useQuery({
    queryKey: ["water-moves", "summary", tenantId, since],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("water_tank_movements").select("tank_id,kind,litres,created_at,cost_per_litre,total_cost,supplier")
        .eq("tenant_id", tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return data || [];
    },
  });
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = Date.now() - 7 * 86400_000;
    const out: Record<string, { lastFill: any | null; today: number; week: number; wasted: number }> = {};
    for (const m of moves as any[]) {
      const s = (out[m.tank_id] ||= { lastFill: null, today: 0, week: 0, wasted: 0 });
      const t = new Date(m.created_at).getTime();
      if (m.kind === "purchase" && !s.lastFill) s.lastFill = m;
      if (m.kind === "sale" || m.kind === "return") {
        if (t >= today.getTime()) s.today -= num(m.litres);
        if (t >= week) s.week -= num(m.litres);
      }
      if (m.kind === "wastage" && t >= week) s.wasted -= num(m.litres);
    }
    return out;
  }, [moves]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["water-tanks"] });
    qc.invalidateQueries({ queryKey: ["water-sizes"] });
    qc.invalidateQueries({ queryKey: ["water-moves"] });
    qc.invalidateQueries({ queryKey: ["water-catalogue"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };
  const fail = (e: any) => toast({ title: "Could not save", description: e?.message, variant: "destructive" });

  const totalL = tanks.reduce((a, t) => a + t.current_l, 0);
  const capL = tanks.reduce((a, t) => a + t.capacity_l, 0);
  const stockValue = tanks.reduce((a, t) => a + t.current_l * t.cost_per_litre, 0);
  const salesValue = tanks.reduce((a, t) => a + t.current_l * t.price_per_litre, 0);
  const low = tanks.filter((t) => tankLevel(t.current_l, t.alert_level_l) !== "ok");

  if (isLoading) return <PageLoader label="Loading tanks…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Water tanks" icon={Droplets}
        description="Buy water in bulk into a tank, set the price per litre, and every refill sold comes off the tank."
        actions={canManage && <Button onClick={() => setDialog({ kind: "tank" })}><Plus /> Add tank</Button>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Water in tanks" value={litres(totalL)} hint={capL ? `${tankPercent(totalL, capL)}% of ${litres(capL)}` : undefined} icon={Droplets} tone="info" />
        <StatTile label="Stock value" value={formatKES(stockValue)} hint={`sells for ${formatKES(salesValue)}`} icon={Tag} tone="primary" />
        <StatTile label="Tanks low" value={low.length} hint={low.length ? low.map((t) => t.name).join(", ") : "all above the alert level"} icon={AlertTriangle} tone={low.length ? "danger" : "success"} />
        <StatTile label="Refill sizes" value={sizes.length} hint="on the till" icon={PackagePlus} tone="muted" />
      </StatGrid>

      {tanks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={Droplets} title="No tanks yet"
            description="Add your tank with its capacity, what is in it now, and the level at which you want a refill alert."
 />
        </div>
      ) : (
        <div className="grid gap-5 2xl:grid-cols-2">
          {tanks.map((t) => {
            const level = tankLevel(t.current_l, t.alert_level_l);
            const st = stats[t.id] || { lastFill: null, today: 0, week: 0, wasted: 0 };
            const perDay = st.week / 7;
            const daysLeft = perDay > 0 ? t.current_l / perDay : null;
            const margin = t.price_per_litre - t.cost_per_litre;
            const tankSizes = (sizes as any[]).filter((s) => s.tank_id === t.id);
            return (
              <div key={t.id} className="overflow-hidden rounded-3xl border border-border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-display text-xl font-bold">{t.name}{t.is_default && <Pill tone="primary">Default</Pill>}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />{(locations as any[]).find((l) => l.id === t.location_id)?.name || "All branches"}
                    </p>
                  </div>
                  {level === "ok" ? <Pill tone="success">Level OK</Pill> : level === "low" ? <Pill tone="warning">Running low</Pill> : <Pill tone="danger">Empty</Pill>}
                </div>
                <div className="grid gap-5 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  <TankVisual tank={t} />
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      <Detail label="In the tank" value={litres(t.current_l)} hint={`of ${litres(t.capacity_l)}`} tone={level === "ok" ? undefined : level === "low" ? "warning" : "danger"} />
                      <Detail label="Free space" value={litres(Math.max(0, t.capacity_l - t.current_l))} hint="you can still buy" />
                      <Detail label="Alert level" value={litres(t.alert_level_l)} hint={`${tankPercent(t.alert_level_l, t.capacity_l)}% of capacity`} />
                      <Detail label="Buying / L" value={formatKES(t.cost_per_litre)} hint="average cost" />
                      <Detail label="Selling / L" value={formatKES(t.price_per_litre)} hint={`margin ${formatKES(margin)}/L`} tone={margin < 0 ? "danger" : undefined} />
                      <Detail label="Water value" value={formatKES(t.current_l * t.cost_per_litre)} hint={`sells for ${formatKES(t.current_l * t.price_per_litre)}`} />
                      <Detail label="Sold today" value={litres(st.today)} hint={`${litres(st.week)} in 7 days`} />
                      <Detail label="Lasts about" value={daysLeft == null ? "—" : daysLeft < 1 ? "< 1 day" : `${Math.round(daysLeft)} days`} hint="at this week's sales" tone={daysLeft != null && daysLeft < 2 ? "warning" : undefined} />
                      <Detail label="Last filled" value={st.lastFill ? new Date(st.lastFill.created_at).toLocaleDateString() : "—"}
                        hint={st.lastFill ? `${litres(num(st.lastFill.litres))} @ ${formatKES(num(st.lastFill.cost_per_litre))}/L${st.lastFill.supplier ? ` · ${st.lastFill.supplier}` : ""}` : "no purchase in 30 days"} />
                    </div>
                    {tankSizes.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Refills left in this tank</p>
                        <div className="flex flex-wrap gap-1.5">
                          {tankSizes.map((s: any) => (
                            <span key={s.id} className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                              {formatLitres(num(s.litres))}: {Math.floor(t.current_l / num(s.litres) + 1e-9).toLocaleString()} · {formatKES(num(s.price))}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {st.wasted > 0 && <p className="flex items-center gap-1 text-xs text-warning"><TrendingDown className="h-3.5 w-3.5" /> {litres(st.wasted)} recorded as wastage this week</p>}
                    {t.notes && <p className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs"><StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.notes}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border bg-muted/30 px-5 py-3">
                  {canManage && <Button size="sm" onClick={() => setDialog({ kind: "buy", tank: t })}><Truck /> Fill / purchase</Button>}
                  {canManage && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "price", tank: t })}><Tag /> Price per litre</Button>}
                  {canManage && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "adjust", tank: t })}><SlidersHorizontal /> Adjust level</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "history", tank: t })}><History /> History</Button>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "tank", tank: t })}><Pencil /> Edit tank</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tanks.length > 0 && (
        <button type="button" onClick={() => nav(tenantPath(slug, "/water/products"))}
          className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/40">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><PackagePlus className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Refill sizes, bottles & jerricans</span>
            <span className="block text-sm text-muted-foreground">{sizes.length} refill size{sizes.length === 1 ? "" : "s"} draw from these tanks. Add, edit, price and picture them on the Refill sizes & items page.</span>
          </span>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      {dialog?.kind === "tank" && <TankDialog tank={dialog.tank} locations={locations} hasDefault={tanks.some((t) => t.is_default)}
        onClose={() => setDialog(null)} onSaved={refresh} onError={fail} />}
      {dialog?.kind === "buy" && <BuyDialog tank={dialog.tank} onClose={() => setDialog(null)} onSaved={refresh} onError={fail} />}
      {dialog?.kind === "adjust" && <AdjustDialog tank={dialog.tank} onClose={() => setDialog(null)} onSaved={refresh} onError={fail} />}
      {dialog?.kind === "price" && <PriceDialog tank={dialog.tank} onClose={() => setDialog(null)} onSaved={refresh} onError={fail} />}
      {dialog?.kind === "history" && <HistoryDialog tank={dialog.tank} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface DlgProps { tank: Tank; onClose: () => void; onSaved: () => void; onError: (e: any) => void }

function TankDialog({ tank, locations, hasDefault, onClose, onSaved, onError }:
  { tank?: Tank; locations: any[]; hasDefault: boolean; onClose: () => void; onSaved: () => void; onError: (e: any) => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const [name, setName] = useState(tank?.name || "Main tank");
  const [cap, setCap] = useState(String(tank?.capacity_l ?? 5000));
  const [alertL, setAlertL] = useState(String(tank?.alert_level_l ?? 500));
  const [loc, setLoc] = useState(tank?.location_id || "");
  const [isDefault, setIsDefault] = useState(tank ? tank.is_default : !hasDefault);
  const [notes, setNotes] = useState<string>(tank?.notes || "");
  // New tank only: what is in it today and what it cost / sells for.
  const [startL, setStartL] = useState("0");
  const [startCost, setStartCost] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: name.trim() || "Tank", capacity_l: num(cap), alert_level_l: num(alertL), location_id: loc || null, notes: notes.trim() || null };
      if (isDefault && !tank?.is_default) {
        await sb.from("water_tanks").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
      }
      if (tank) {
        const { error } = await sb.from("water_tanks").update({ ...row, is_default: isDefault }).eq("id", tank.id);
        if (error) throw error;
        return;
      }
      const { data: created, error } = await sb.from("water_tanks")
        .insert({ ...row, tenant_id: tenantId, is_default: isDefault, cost_per_litre: num(startCost), price_per_litre: num(sellPrice) })
        .select("id").single();
      if (error) throw error;
      if (num(startL) > 0) {
        const { error: aErr } = await sb.rpc("water_tank_adjust", { p_tank: created.id, p_litres: num(startL), p_kind: "adjust", p_note: "Opening level" });
        if (aErr) throw aErr;
      }
    },
    onSuccess: () => {
      onSaved(); onClose();
      toast({ title: tank ? "Tank updated" : "Tank added", description: tank ? undefined : num(startL) > 0 ? `Starts with ${litres(num(startL))}.` : "Record the water you put in it with Fill / purchase." });
    },
    onError,
  });
  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await sb.from("water_tanks").update({ is_active: false, is_default: false }).eq("id", tank!.id);
      if (error) throw error;
    },
    onSuccess: () => { onSaved(); onClose(); toast({ title: "Tank removed" }); },
    onError,
  });
  const bad = !name.trim() || num(cap) <= 0 || num(alertL) < 0 || num(alertL) >= num(cap) || (!tank && num(startL) > num(cap));
  const capPresets = [1000, 2000, 5000, 10000, 20000];
  return (
    <Modal open onClose={onClose} size="lg" icon={Droplets} title={tank ? `Edit ${tank.name}` : "Add a tank"}
      description={tank ? "Change the tank's details. Use Fill / purchase or Adjust level to change the water in it." : "Set up the tank, what is in it now and your prices."}
      footer={<>
        {tank && <Button variant="ghost" className="mr-auto text-destructive" disabled={archive.isPending}
          onClick={async () => { if (await confirmAction({ title: `Remove ${tank.name}?`, message: "Its history is kept.", danger: true, confirmLabel: "Remove" })) archive.mutate(); }}>Remove</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={bad || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : tank ? "Save" : "Add tank"}</Button>
      </>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><GaugeIcon className="h-4 w-4 text-primary" /> The tank</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className={locations.length > 1 ? undefined : "sm:col-span-2"}><input className="fi" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main tank, Borehole tank" /></Field>
            {locations.length > 1 && (
              <Field label="Branch">
                <select className="fi" value={loc} onChange={(e) => setLoc(e.target.value)}>
                  <option value="">All branches</option>
                  {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Capacity (litres)">
              <div className="space-y-2">
                <input className="fi" type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} />
                <div className="flex flex-wrap gap-1.5">
                  {capPresets.map((c) => (
                    <button key={c} type="button" onClick={() => setCap(String(c))}
                      className={cn("rounded-lg border px-2 py-0.5 text-xs tabular-nums", num(cap) === c ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>{c.toLocaleString()} L</button>
                  ))}
                </div>
              </div>
            </Field>
            <Field label="Alert me at (litres)" error={num(alertL) >= num(cap) ? "Must be below the capacity." : undefined}
              hint={num(cap) > 0 ? `${tankPercent(num(alertL), num(cap))}% of the tank. You get a notification at this level.` : undefined}>
              <input className="fi" type="number" min="0" value={alertL} onChange={(e) => setAlertL(e.target.value)} />
            </Field>
          </div>
        </section>

        {!tank && (
          <section className="space-y-3 rounded-2xl border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Droplets className="h-4 w-4 text-primary" /> Water and prices</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Litres in it now" error={num(startL) > num(cap) ? "More than the capacity." : undefined} hint="0 if empty">
                <input className="fi" type="number" min="0" value={startL} onChange={(e) => setStartL(e.target.value)} />
              </Field>
              <Field label="Buying price / litre" hint="What the water cost you"><input className="fi" type="number" min="0" step="0.01" value={startCost} onChange={(e) => setStartCost(e.target.value)} /></Field>
              <Field label="Selling price / litre" hint="Refill sizes are priced from this"><input className="fi" type="number" min="0" step="0.01" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></Field>
            </div>
            {num(sellPrice) > 0 && (
              <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                {WATER_SIZES.map((s) => (
                  <div key={s} className="rounded-lg bg-muted px-1 py-2"><div className="font-semibold">{formatLitres(s)}</div><div className="tabular-nums">{formatKES(sizePrice(s, num(sellPrice)))}</div></div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Later deliveries go through "Fill / purchase", which also records the supplier bill.</p>
          </section>
        )}

        <section className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default tank for new refill sizes</label>
          <Field label="Notes" hint="Optional: source, cleaning schedule, meter number…">
            <textarea className="fi min-h-[70px]" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>
      </div>
    </Modal>
  );
}

function BuyDialog({ tank, onClose, onSaved, onError }: DlgProps) {
  const { toast } = useToast();
  const [l, setL] = useState("");
  const [mode, setMode] = useState<"per" | "total">("per");
  const [price, setPrice] = useState("");
  const tenantId = useTenantId();
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("suppliers").select("id,name").eq("tenant_id", tenantId).eq("is_active", true).order("name")).data || [],
  });
  const qty = num(l);
  const perL = mode === "per" ? num(price) : qty > 0 ? num(price) / qty : 0;
  const newCost = weightedCostPerLitre(tank.current_l, tank.cost_per_litre, qty, perL);
  const over = tank.current_l + qty > tank.capacity_l;
  const save = useMutation({
    mutationFn: async () => {
      let sid = supplierId === "__new" ? "" : supplierId;
      if (supplierId === "__new" && newSupplier.trim()) {
        const { data: created, error: supErr } = await sb.from("suppliers").insert({ tenant_id: tenantId, name: newSupplier.trim() }).select("id").single();
        if (supErr) throw supErr;
        sid = created.id;
      }
      const { data, error } = await sb.rpc("water_tank_purchase", {
        p_tank: tank.id, p_litres: qty, p_cost_per_litre: Math.round(perL * 10000) / 10000,
        p_supplier: null, p_note: note || null, p_supplier_id: sid || null, p_paid: paid, p_method: method,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      onSaved(); onClose();
      toast({ title: `${litres(qty)} added to ${tank.name}`, description: paid ? "Recorded as a paid bill." : "Recorded as a bill owed to the supplier (see Bills)." });
    },
    onError,
  });
  return (
    <Modal open onClose={onClose} size="md" icon={Truck} title={`Fill ${tank.name}`}
      description={`Now ${litres(tank.current_l)} of ${litres(tank.capacity_l)}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={qty <= 0 || perL < 0 || price === "" || (supplierId === "__new" && !newSupplier.trim()) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Record purchase"}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Litres bought" error={over ? `That is more than the tank holds (${litres(tank.capacity_l)}). It will still be saved.` : undefined}>
          <input className="fi h-12 text-lg font-semibold" type="number" min="0" inputMode="decimal" autoFocus value={l} onChange={(e) => setL(e.target.value)} placeholder="e.g. 5000" />
        </Field>
        <div className="flex gap-2 text-sm">
          <button type="button" className={`rounded-lg px-3 py-1.5 ${mode === "per" ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setMode("per")}>Price per litre</button>
          <button type="button" className={`rounded-lg px-3 py-1.5 ${mode === "total" ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setMode("total")}>Total paid</button>
        </div>
        <Field label={mode === "per" ? "Buying price per litre" : "Total amount paid"}
          hint={qty > 0 && price !== "" ? `${formatKES(perL)} per litre · total ${formatKES(perL * qty)} · average after this ${formatKES(newCost)}/L` : undefined}>
          <input className="fi" type="number" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Supplier">
          <select className="fi" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier</option>
            {suppliers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value="__new">+ New supplier…</option>
          </select>
        </Field>
        {supplierId === "__new" && (
          <Field label="New supplier name"><input className="fi" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} autoFocus /></Field>
        )}
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-sm font-medium">Payment</p>
          <div className="flex gap-2 text-sm">
            <button type="button" className={`rounded-lg px-3 py-1.5 ${paid ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setPaid(true)}>Paid now</button>
            <button type="button" className={`rounded-lg px-3 py-1.5 ${!paid ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setPaid(false)}>Pay later (owe supplier)</button>
          </div>
          {paid && (
            <select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cheque">Cheque</option>
            </select>
          )}
          <p className="text-xs text-muted-foreground">Saved as a supplier bill{qty > 0 && price !== "" ? ` of ${formatKES(perL * qty)}` : ""}, so it shows under Bills and Reports.</p>
        </div>
        <Field label="Note" hint="Optional"><input className="fi" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AdjustDialog({ tank, onClose, onSaved, onError }: DlgProps) {
  const { toast } = useToast();
  const [kind, setKind] = useState<"wastage" | "reading">("wastage");
  const [l, setL] = useState("");
  const [note, setNote] = useState("");
  const change = kind === "wastage" ? -Math.abs(num(l)) : num(l) - tank.current_l;
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("water_tank_adjust", {
        p_tank: tank.id, p_litres: change, p_kind: kind === "wastage" ? "wastage" : "adjust", p_note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { onSaved(); onClose(); toast({ title: "Tank updated" }); },
    onError,
  });
  return (
    <Modal open onClose={onClose} size="sm" icon={SlidersHorizontal} title={`Adjust ${tank.name}`}
      description={`Now ${litres(tank.current_l)}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={l === "" || change === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex gap-2 text-sm">
          <button type="button" className={`rounded-lg px-3 py-1.5 ${kind === "wastage" ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setKind("wastage")}>Wastage / spill</button>
          <button type="button" className={`rounded-lg px-3 py-1.5 ${kind === "reading" ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setKind("reading")}>Actual reading</button>
        </div>
        <Field label={kind === "wastage" ? "Litres lost" : "Litres actually in the tank"}
          hint={l !== "" ? `Change: ${change > 0 ? "+" : ""}${litres(change)}` : undefined}>
          <input className="fi" type="number" min="0" inputMode="decimal" autoFocus value={l} onChange={(e) => setL(e.target.value)} />
        </Field>
        <Field label="Note" hint="Optional"><input className="fi" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PriceDialog({ tank, onClose, onSaved, onError }: DlgProps) {
  const { toast } = useToast();
  const [p, setP] = useState(String(tank.price_per_litre || ""));
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("water_set_price", { p_tank: tank.id, p_price_per_litre: num(p) });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { onSaved(); onClose(); toast({ title: "Price saved", description: n ? `${n} refill size${n === 1 ? "" : "s"} repriced.` : undefined }); },
    onError,
  });
  return (
    <Modal open onClose={onClose} size="sm" icon={Tag} title="Selling price per litre"
      description={`Buying price is ${formatKES(tank.cost_per_litre)} per litre.`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={p === "" || num(p) < 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save price"}</Button>
      </>}>
      <Field label="Price per litre">
        <input className="fi h-12 text-lg font-semibold" type="number" min="0" inputMode="decimal" autoFocus value={p} onChange={(e) => setP(e.target.value)} />
      </Field>
      {p !== "" && (
        <div className="mt-3 grid grid-cols-5 gap-1.5 text-center text-xs">
          {WATER_SIZES.map((s) => (
            <div key={s} className="rounded-lg bg-muted px-1 py-2"><div className="font-semibold">{formatLitres(s)}</div><div className="tabular-nums">{formatKES(sizePrice(s, num(p)))}</div></div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Refill sizes priced "per litre" are updated. Sizes with a custom price keep it.</p>
    </Modal>
  );
}

const KIND_LABEL: Record<string, string> = { purchase: "Purchase", sale: "Sold", return: "Returned", adjust: "Correction", wastage: "Wastage" };

function HistoryDialog({ tank, onClose }: { tank: Tank; onClose: () => void }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["water-moves", tank.id],
    queryFn: async () => {
      const { data, error } = await sb.from("water_tank_movements").select("*").eq("tank_id", tank.id)
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data || [];
    },
  });
  const bought = useMemo(() => rows.filter((r: any) => r.kind === "purchase"), [rows]);
  return (
    <Modal open onClose={onClose} size="xl" icon={History} title={`${tank.name} history`}
      description={bought.length ? `${bought.length} purchase${bought.length === 1 ? "" : "s"} in the last ${rows.length} entries` : undefined}>
      {isLoading ? <PageLoader /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
        <TableWrap>
          <table className="dt">
            <thead><tr><th>When</th><th>What</th><th className="text-right">Litres</th><th className="text-right">Level after</th><th>Details</th></tr></thead>
            <tbody>
              <PagedRows rows={rows} colSpan={5}>{(pageRows) => pageRows.map((r: any) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td>{KIND_LABEL[r.kind] || r.kind}</td>
                  <td className={`text-right tabular-nums ${num(r.litres) < 0 ? "text-destructive" : "text-success"}`}>{num(r.litres) > 0 ? "+" : ""}{litres(num(r.litres))}</td>
                  <td className="text-right tabular-nums">{litres(num(r.litres_after))}</td>
                  <td className="text-xs text-muted-foreground">
                    {r.kind === "purchase" && <>{formatKES(num(r.cost_per_litre))}/L · {formatKES(num(r.total_cost))}{r.supplier ? ` · ${r.supplier}` : ""}</>}
                    {r.note ? ` ${r.note}` : ""}
                  </td>
                </tr>
              ))}</PagedRows>
            </tbody>
          </table>
        </TableWrap>
      )}
    </Modal>
  );
}
