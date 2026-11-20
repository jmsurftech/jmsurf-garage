import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Grid2x2, Gift, Save, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Modal, Field, PageHeader, MoreMenu, StatGrid, StatTile, Toolbar, SearchBox, Segmented, btnCls, btnPrimaryCls } from "@/components/kit";
import { MODULES, MODULE_BY_KEY } from "@/lib/modules";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

const sb = supabase as any;
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** Super admin: module prices, availability, adoption and free (comped) modules per company. */
export default function AdminModules() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { price?: string; active?: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [comp, setComp] = useState(false);
  const [cat, setCat] = useState("All");

  const { data: rows = [] } = useQuery({
    queryKey: ["admin-platform-modules"],
    queryFn: async () => (await sb.from("platform_modules").select("*").order("sort")).data || [],
  });
  const { data: usage = [] } = useQuery({
    queryKey: ["admin-tenant-modules"],
    queryFn: async () => (await sb.from("tenant_modules").select("module_key, status, price_monthly, tenant_id")).data || [],
  });

  const stats = useMemo(() => {
    const m = new Map<string, { trial: number; paying: number; mrr: number }>();
    for (const u of usage) {
      const x = m.get(u.module_key) || { trial: 0, paying: 0, mrr: 0 };
      if (u.status === "trial") x.trial++;
      if (u.status === "active" || u.status === "past_due") { x.paying++; x.mrr += Number(u.price_monthly || 0); }
      m.set(u.module_key, x);
    }
    return m;
  }, [usage]);
  const mrr = [...stats.values()].reduce((a, x) => a + x.mrr, 0);

  const list = rows.filter((r: any) => !q || `${r.name} ${r.category} ${r.key}`.toLowerCase().includes(q.toLowerCase()));
  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      for (const [key, e] of Object.entries(edits)) {
        const patch: any = { updated_at: new Date().toISOString() };
        if (e.price !== undefined) patch.price_monthly = Math.max(0, Number(e.price) || 0);
        if (e.active !== undefined) patch.is_active = e.active;
        const { error } = await sb.from("platform_modules").update(patch).eq("key", key);
        if (error) throw error;
      }
      setEdits({});
      await qc.invalidateQueries({ queryKey: ["admin-platform-modules"] });
      await qc.invalidateQueries({ queryKey: ["platform-modules"] });
      toast.success("Module prices saved", { description: "New prices apply to new activations and the next renewal." });
    } catch (e) { toast.error(friendlyError(e)); } finally { setSaving(false); }
  };

  const categories = useMemo(() => ["All", ...Array.from(new Set(rows.map((r: any) => r.category).filter(Boolean)))] as string[], [rows]);
  const shown = list.filter((r: any) => cat === "All" || r.category === cat);
  const top = [...stats.entries()].filter(([, x]) => x.mrr > 0).sort((a, b) => b[1].mrr - a[1].mrr).slice(0, 8);
  const topMax = Math.max(1, ...top.map(([, x]) => x.mrr));
  const paying = [...stats.values()].reduce((a, x) => a + x.paying, 0);
  const trials = [...stats.values()].reduce((a, x) => a + x.trial, 0);

  return (
    <div className="space-y-3">
      <PageHeader title="Modules & prices" icon={Grid2x2} actions={<>
        <button type="button" disabled={!dirty || saving} onClick={save} className={btnPrimaryCls}>
          <Save className="h-4 w-4" /> {saving ? "Saving…" : dirty ? `Save ${Object.keys(edits).length} change${Object.keys(edits).length > 1 ? "s" : ""}` : "Saved"}
        </button>
        <MoreMenu items={[{ label: "Give a module free", icon: Gift, onSelect: () => setComp(true) }]} />
      </>} />

      <StatGrid>
        <StatTile label="Suites offered" value={rows.filter((r: any) => r.is_active).length} icon={Grid2x2} tone="primary" />
        <StatTile label="Module MRR" value={kes(mrr)} icon={TrendingUp} tone="success" />
        <StatTile label="Paying activations" value={paying} icon={CheckCircle2} tone="info" />
        <StatTile label="On free trial" value={trials} icon={Gift} tone="warning" />
      </StatGrid>

      {top.length > 0 && (
        <Panel title="Module revenue" icon={TrendingUp}>
          <div className="space-y-2.5">
            {top.map(([key, x]) => { const def = MODULE_BY_KEY[key]; return (
              <div key={key} className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: def?.color || "#64748b" }}>{def ? <def.icon className="h-3.5 w-3.5" /> : null}</span>
                <span className="w-24 shrink-0 truncate font-medium sm:w-44">{def?.name || key}</span>
                <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(4, (x.mrr / topMax) * 100)}%`, background: def?.color || "#64748b" }} /></span>
                <span className="shrink-0 text-right text-xs font-semibold tabular-nums sm:w-32 sm:text-sm">{kes(x.mrr)}</span>
              </div>
            ); })}
          </div>
        </Panel>
      )}

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search suites…" />
        <Segmented value={cat} onChange={setCat} options={categories.map((c) => ({ value: c, label: c }))} />
      </Toolbar>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((r: any) => {
          const def = MODULE_BY_KEY[r.key];
          const e = edits[r.key] || {};
          const st = stats.get(r.key) || { trial: 0, paying: 0, mrr: 0 };
          const active = e.active ?? r.is_active;
          const total = st.trial + st.paying;
          const changed = r.key in edits;
          const color = def?.color || "#64748b";
          return (
            <article key={r.key} className={`group relative overflow-hidden rounded-3xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl ${changed ? "border-primary ring-2 ring-primary/30" : "border-border"} ${active ? "" : "opacity-70"}`}>
              <div className="relative h-20 overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc 55%, #111827)` }}>
                <span aria-hidden className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/15 blur-xl" />
                <span className="absolute bottom-0 left-5 flex h-12 w-12 translate-y-1/2 items-center justify-center rounded-2xl bg-card shadow-lg ring-4 ring-card" style={{ color }}>{def ? <def.icon className="h-6 w-6" /> : <Grid2x2 className="h-6 w-6" />}</span>
                <span className="absolute right-4 top-3 rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">{r.category}</span>
              </div>
              <div className="space-y-4 p-5 pt-9">
                <div>
                  <p className="font-display text-lg font-extrabold leading-tight">{r.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{def?.tagline || "—"}</p>
                  {def?.apps?.length ? <p className="mt-2 text-[11px] font-semibold text-muted-foreground">{def.apps.length} apps: {def.apps.slice(0, 4).map((a: any) => a.name).join(", ")}{def.apps.length > 4 ? "…" : ""}</p> : null}
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Price per month</p>
                    {r.included ? <p className="font-display text-xl font-extrabold text-success">Included</p> : (
                      <div className="mt-1 flex items-center gap-1.5"><span className="text-sm font-semibold text-muted-foreground">KES</span>
                        <input type="number" min={0} className="fi h-10 w-32 text-right font-display text-lg font-bold" value={e.price ?? String(Number(r.price_monthly))} onChange={(ev) => setEdits((x) => ({ ...x, [r.key]: { ...x[r.key], price: ev.target.value } }))} aria-label={`Price of ${r.name}`} />
                      </div>
                    )}
                  </div>
                  <button type="button" disabled={r.included} onClick={() => setEdits((x) => ({ ...x, [r.key]: { ...x[r.key], active: !active } }))} className="flex flex-col items-center gap-1 disabled:opacity-40" aria-pressed={active} aria-label={active ? "Offered: click to hide" : "Hidden: click to offer"}>
                    <span className={`relative h-6 w-11 rounded-full transition-colors ${active ? "bg-success" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${active ? "left-[22px]" : "left-0.5"}`} /></span>
                    <span className="text-[10px] font-semibold text-muted-foreground">{active ? "Offered" : "Hidden"}</span>
                  </button>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span><b className="text-foreground">{st.paying}</b> paying · <b className="text-foreground">{st.trial}</b> on trial</span><span className="font-semibold text-foreground">{kes(st.mrr)}/mo</span></div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">{total > 0 && <><span className="h-full bg-success" style={{ width: `${(st.paying / total) * 100}%` }} /><span className="h-full bg-warning" style={{ width: `${(st.trial / total) * 100}%` }} /></>}</div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <CompModule open={comp} onClose={() => setComp(false)} onDone={() => void qc.invalidateQueries({ queryKey: ["admin-tenant-modules"] })} />
    </div>
  );
}

function CompModule({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [tenant, setTenant] = useState("");
  const [key, setKey] = useState("crm");
  const [status, setStatus] = useState("comped");
  const [busy, setBusy] = useState(false);
  const { data: tenants = [] } = useQuery({
    queryKey: ["admin-tenants-min"], enabled: open,
    queryFn: async () => (await sb.from("tenants").select("id, business_name, slug").is("deleted_at", null).order("business_name")).data || [],
  });
  const go = async () => {
    if (!tenant) return toast.error("Choose a company");
    setBusy(true);
    try {
      const row: any = { tenant_id: tenant, module_key: key, status, price_monthly: status === "comped" ? 0 : (MODULE_BY_KEY[key]?.price || 0), updated_at: new Date().toISOString() };
      if (status === "trial") row.trial_ends_at = new Date(Date.now() + 14 * 86400000).toISOString();
      if (status === "active") row.current_period_end = new Date(Date.now() + 30 * 86400000).toISOString();
      if (status === "cancelled") row.cancelled_at = new Date().toISOString();
      const { error } = await sb.from("tenant_modules").upsert(row, { onConflict: "tenant_id,module_key" });
      if (error) throw error;
      toast.success("Module updated for the company"); onDone(); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Set a module for a company" icon={Gift}
      footer={<><button type="button" onClick={onClose} className={btnCls}>Cancel</button><button type="button" disabled={busy} onClick={go} className={btnPrimaryCls}>Apply</button></>}>
      <div className="space-y-4">
        <Field label="Company"><select className="fi" value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="">Choose…</option>{tenants.map((t: any) => <option key={t.id} value={t.id}>{t.business_name} ({t.slug})</option>)}</select></Field>
        <Field label="Module"><select className="fi" value={key} onChange={(e) => setKey(e.target.value)}>{MODULES.filter((m) => !m.included).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></Field>
        <Field label="Status"><select className="fi" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="comped">Free for this company</option><option value="trial">14-day trial</option><option value="active">Active (billed, 30 days)</option><option value="cancelled">Switched off</option>
        </select></Field>
      </div>
    </Modal>
  );
}
