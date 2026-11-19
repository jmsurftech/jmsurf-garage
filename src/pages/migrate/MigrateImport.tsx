import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { confirmAction } from "@/components/books/confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Trash2, Info, Download, PlugZap, Copy, RefreshCw, PauseCircle, XCircle, Unplug, KeyRound, DatabaseZap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logoColor } from "@/lib/companyTheme";
import { PageHeader, Panel, Pill, Segmented, Field } from "@/components/kit";
import { useTenantId } from "@/hooks/useTenantId";
import { erpApi } from "@/lib/erpApi";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KINDS, ORDER, readFile, runImport, type Kind, type Row, type Log, readRetry } from "./importEngine";
import { SOURCES, sourceOf, detectFor, adapt, type Source, type SourceKey, type ApiSource } from "./sources";
import { moveRun, useMoveRun, isActive, trackImport, fetchState } from "./progress";
import { MoveProgress, MoveProgressBar } from "./MoveProgress";

const sb = supabase as any;

/** After a move-in: a company still on the default colours takes its logo's colour (app and documents). */
async function themeFromLogo(tenantId: string) {
  const [{ data: t }, { data: s }] = await Promise.all([
    sb.from("tenants").select("logo_url").eq("id", tenantId).maybeSingle(),
    sb.from("business_settings").select("id,theme").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const th = s?.theme || {};
  if (!t?.logo_url || !s?.id || th.custom || (th.preset && th.preset !== "JMSURF Garage")) return;
  const res = await fetch(t.logo_url).catch(() => null);
  if (!res?.ok) return;
  const color = await logoColor(await res.blob());
  if (color) await sb.from("business_settings").update({ theme: { ...th, preset: null, custom: color } }).eq("id", s.id);
}
const label = (k: string) => KINDS.find((x) => x.kind === k)?.label || k;

interface Loaded { file: string; kind: Kind | null; rows: Row[] }

/** Results of an import run. */
function Results({ log }: { log: Log[] }) {
  if (!log.length) return null;
  return (
    <Panel title="Results" icon={CheckCircle2}>
      <ul className="space-y-2">
        {log.map((l) => (
          <li key={l.kind} className={cn("rounded-xl border p-3 text-sm", l.errors.length ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5")}>
            <div className="flex items-center gap-2">
              {l.errors.length ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
              <b className="min-w-0 truncate" title={label(l.kind)}>{label(l.kind)}</b>
              <span className="min-w-0 text-muted-foreground">· {l.ok} imported{l.skipped ? ` · ${l.skipped} already here` : ""}</span>
            </div>
            {l.errors.map((e, i) => <p key={i} className="mt-1 break-words text-xs text-muted-foreground">{e}</p>)}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link to="/accounting/statements" className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">Check the trial balance</Link>
        <Link to="/accounting/opening-balances" className="rounded-xl border border-border px-4 py-2 font-medium">Opening balances</Link>
        <Link to="/sales/invoices" className="rounded-xl border border-border px-4 py-2 font-medium">Invoices</Link>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- API connection */

function ApiMove({ onLog, source }: { onLog: (l: Log[]) => void; source: ApiSource }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dc, setDc] = useState("com");
  // What the company has: the whole suite (Books, CRM, People, Projects) or Books alone.
  const [zplan, setZplan] = useState<"one" | "books">("one");
  const [self, setSelf] = useState({ client_id: "", client_secret: "", code: "" });
  const [kinds, setKinds] = useState<string[] | null>(null);
  const [withLines, setWithLines] = useState(true);
  const [synth, setSynth] = useState(true);
  const [busy, setBusy] = useState("");
  const [odoo, setOdoo] = useState({ url: "", db: "", username: "", api_key: "" });
  useEffect(() => setKinds(null), [source]);
  const navigate = useNavigate();
  const { data: st, refetch } = useQuery({
    queryKey: ["migrate-status", tenantId], enabled: !!tenantId,
    // A status call that never answers (a stalled sign-in check in a background tab) would stop every later
    // poll, leaving the pop-up on an old step: give up after 20s so the next poll goes ahead.
    queryFn: () => Promise.race([
      erpApi("migrate/status"),
      new Promise((_, no) => window.setTimeout(() => no(new Error("The status check took too long; trying again.")), 20_000)),
    ]),
    refetchInterval: (q) => ((q.state.data as any)?.jobs?.some((j: any) => j.status === "fetching") ? 4000 : false),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (params.get("connected")) { toast.success("Connected. Choose the organisation and what to bring over."); params.delete("connected"); setParams(params, { replace: true }); }
    if (params.get("error")) { toast.error(`Not connected: ${params.get("error")}`); params.delete("error"); setParams(params, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const allKinds: string[] = (source === "books_api" ? st?.kinds : st?.source_kinds?.[source]) || [];
  const chosen = (kinds ?? allKinds).filter((k) => allKinds.includes(k));
  const job = st?.jobs?.find((j: any) => (j.source || "books_api") === source);
  const other = source !== "books_api" ? (source === "odoo" ? st?.odoo : source === "quickbooks" ? st?.quickbooks : st?.sources?.[source]) : null;
  const [erp, setErp] = useState({ url: "", api_key: "", api_secret: "" });
  const [loyToken, setLoyToken] = useState("");
  // The progress pop-up's run, when it belongs to this connection.
  const anyRun = useMoveRun(tenantId);
  const run = anyRun?.source === source ? anyRun : null;
  // Re-migrate: one press fetches again and imports what is new as soon as the fetch ends.
  const autoImport = !!run && run.autoImport && isActive(run);

  const act = async (name: string, fn: () => Promise<any>) => {
    setBusy(name);
    try { await fn(); await refetch(); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };

  const importStaged = (j: any) => act("import", async () => {
    // Carries on the re-migrate run (fetch then import), or opens a new one.
    const cur = moveRun.get();
    const carry = !!cur && cur.tenantId === tenantId && cur.source === source && cur.phase === "fetching";
    if (carry) moveRun.patch(() => ({ phase: "importing", line: "Reading the fetched records…" }));
    else moveRun.start({ tenantId: tenantId!, source, phase: "importing", line: "Reading the fetched records…" });
    try {
      const byKind = new Map<Kind, Row[]>();
      let read = 0;
      // Page by "after the last id" (index migration_rows_job_order_idx): an offset made every page sort
      // the whole job, and deep pages of a big move-in (20k rows) ran past the database's 8s limit.
      // Half-size pages, each tried again if the connection drops mid-download.
      for (let last = 0; ; ) {
        const { data, error } = await readRetry(() => sb.from("migration_rows").select("id,kind,row").eq("job_id", j.id).gt("id", last).order("id").limit(500));
        if (error) throw error;
        (data || []).forEach((r: any) => { const list = byKind.get(r.kind); if (list) list.push(r.row); else byKind.set(r.kind, [r.row]); });
        if (data?.length) last = Number((data[data.length - 1] as any).id);
        read += data?.length || 0;
        moveRun.patch((r) => ({ line: `Reading the fetched records: ${read.toLocaleString()} so far…`, pct: Math.min(r.pct + 1, carry ? 44 : 8) }));
        if (!data || data.length < 500) break;
      }
      const t = trackImport(byKind, carry ? 45 : 8);
      const log = await runImport(byKind, { tenantId: tenantId!, synthPayments: synth, onStep: (s) => setBusy(`import:${s}`), onKind: t.onKind, onLog: (l) => { t.onLog(l); onLog(l); } });
      // Invoices reported to KRA in the old system: read the SCU details from KRA (QR link).
      moveRun.step("kra", { state: "running", note: "Invoices the old system reported to KRA" });
      moveRun.patch(() => ({ line: "Reading KRA receipt details for invoices reported in the old system…", pct: 96 }));
      await erpApi("etims/fill-from-kra").catch(() => null);
      // The logo and profile came with the fetch; the colours follow the logo.
      await themeFromLogo(tenantId!).catch(() => undefined);
      moveRun.step("kra", { state: "done", note: undefined });
      moveRun.step("finish", { state: "running" });
      moveRun.patch(() => ({ line: "Saving the move-in record and refreshing your books…", pct: 98 }));
      await erpApi("migrate/imported", { id: j.id, log: log.map((l) => ({ kind: l.kind, ok: l.ok, skipped: l.skipped, errors: l.errors.length })) });
      await qc.invalidateQueries();
      const ok = log.reduce((a, l) => a + l.ok, 0), skipped = log.reduce((a, l) => a + l.skipped, 0);
      moveRun.finish(`${ok.toLocaleString()} records imported${skipped ? `, ${skipped.toLocaleString()} already here` : ""}. Compare the trial balance with your old system's.`);
      toast.success("Move-in finished", { description: "Every document was posted to your books. Compare the trial balance with your old system's." });
    } catch (e) { moveRun.fail(friendlyError(e)); throw e; }
  });

  /** Fetch from the old system with the progress pop-up open; `auto` imports when it ends (Re-migrate). */
  const startFetch = (body: any, auto: boolean) => {
    const ks: string[] = body.kinds || [];
    moveRun.start({ tenantId: tenantId!, source, phase: "fetching", autoImport: auto, prevJobId: job?.id ?? null,
      line: "Asking your previous system for the records…", steps: ks.map((k) => ({ key: k, label: label(k), state: "waiting" as const })) });
    return act("start", async () => {
      try { await erpApi("migrate/start", body); } catch (e) { moveRun.fail(friendlyError(e)); throw e; }
      if (auto) toast.success("Re-migrating", { description: "Fetching what changed in the old system; it is imported automatically when the fetch ends." });
    });
  };

  // Server-side fetch → the pop-up: steps per kind, live counts, then import (Re-migrate) or stop.
  useEffect(() => {
    if (!job || !tenantId) return;
    const r = moveRun.get();
    const mine = !!r && r.tenantId === tenantId && r.source === source;
    if (r && mine && r.phase === "fetching") {
      const running = job.status === "fetching" || job.status === "paused";
      const seen = r.seenFetching || running || (job.id !== r.prevJobId && job.status !== "imported");
      if (!seen) return; // still the old job's status: the new fetch has not shown up yet
      const f = fetchState(job, r.autoImport);
      const base = { seenFetching: true, steps: f.steps, pct: Math.max(r.pct, f.pct), done: f.found, total: 0 };
      if (job.status === "fetching") moveRun.patch(() => ({ ...base, line: `Fetching${f.current ? ` ${f.current.toLowerCase()}` : ""}: ${f.found.toLocaleString()} records so far…` }));
      else if (job.status === "paused") moveRun.patch(() => ({ ...base, line: job.error || "Paused: the old system's daily API allowance is used up. It carries on by itself." }));
      else if (job.status === "fetched" || job.status === "imported") {
        if (r.autoImport) { moveRun.patch(() => ({ ...base, line: `Fetched ${f.found.toLocaleString()} records. Importing…` })); if (!busy) importStaged(job); }
        else moveRun.patch(() => ({ ...base, phase: "fetched", pct: 100, endedAt: Date.now(), line: `Fetched ${f.found.toLocaleString()} records. Press Import to post them to your books.` }));
      } else if (job.status === "failed" || job.status === "cancelled") {
        moveRun.patch(() => base);
        moveRun.fail(job.status === "cancelled" ? "The fetch was stopped." : job.error || "The fetch failed.");
      }
    } else if (job.status === "fetching" && !isActive(r)) {
      // A fetch is running on the server (started earlier or elsewhere): show it again.
      const f = fetchState(job, false);
      moveRun.start({ tenantId, source, phase: "fetching", seenFetching: true, prevJobId: job.id, steps: f.steps, pct: f.pct, done: f.found,
        line: `Fetching${f.current ? ` ${f.current.toLowerCase()}` : ""}: ${f.found.toLocaleString()} records so far…` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, tenantId, source, busy]);

  if (!st) return <Panel><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking the connection…</p></Panel>;

  const total = (p: any) => Object.values(p || {}).reduce((a: number, x: any) => a + Number(x?.fetched || 0), 0);

  return (
    <div className="space-y-5">
      {job?.status === "imported" && source === "books_api" && (
        <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-card to-card shadow-sm dark:border-emerald-900 dark:from-emerald-950/60">
          <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow"><CheckCircle2 className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-bold">Move-in complete</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {job.org_name ? `${job.org_name} is in JMSURF Garage. ` : ""}Imported {job.imported_at ? new Date(job.imported_at).toLocaleString() : "successfully"}. Compare the trial balance, receivables and payables with your old system, then carry on working here.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => navigate("/dashboard")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Done</button>
                <button disabled={!!busy || autoImport} onClick={() => void startFetch({ kinds: job.kinds || chosen, with_lines: withLines }, true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw className={cn("h-4 w-4", autoImport && "animate-spin")} /> {autoImport ? "Re-migrating…" : "Re-migrate (bring new changes)"}</button>
                {st?.connected && <button disabled={!!busy} onClick={async () => { if (await confirmAction({ title: "Disconnect from the old system?", message: "Your imported records stay. You can connect again any time to re-migrate.", confirmLabel: "Disconnect", danger: true })) void act("disc", () => erpApi("migrate/disconnect")); }}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/10"><Unplug className="h-4 w-4" /> Disconnect</button>}
              </div>
            </div>
          </div>
        </section>
      )}
      {source !== "books_api" ? (
        !other ? (
          source === "odoo" ? (
            <Panel title="Connect Odoo" icon={PlugZap} description="Read-only: nothing is changed in Odoo. In Odoo open your user (Preferences → Account Security → New API Key) and create a key.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Odoo address"><input className="fi" placeholder="https://mycompany.odoo.com" value={odoo.url} onChange={(e) => setOdoo({ ...odoo, url: e.target.value })} /></Field>
                <Field label="Database" hint="Usually the first part of the address"><input className="fi" placeholder="mycompany" value={odoo.db} onChange={(e) => setOdoo({ ...odoo, db: e.target.value })} /></Field>
                <Field label="Login email"><input className="fi" autoComplete="off" value={odoo.username} onChange={(e) => setOdoo({ ...odoo, username: e.target.value })} /></Field>
                <Field label="API key"><input className="fi" type="password" autoComplete="new-password" value={odoo.api_key} onChange={(e) => setOdoo({ ...odoo, api_key: e.target.value })} /></Field>
              </div>
              <button disabled={!!busy || !odoo.url || !odoo.username || !odoo.api_key} onClick={() => act("odoo", async () => { const r = await erpApi("migrate/odoo-connect", odoo); setOdoo({ url: "", db: "", username: "", api_key: "" }); toast.success(`Connected to ${r.name}`); })}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {busy === "odoo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect Odoo
              </button>
            </Panel>
          ) : source === "quickbooks" ? (
            <Panel title="Connect QuickBooks Online" icon={PlugZap} description="You sign in on Intuit's own page and allow read access to your accounting data. Nothing is changed in QuickBooks.">
              {st.qbo_available ? (
                <button disabled={!!busy} onClick={() => act("qbo", async () => { const r = await erpApi("migrate/qbo-start"); window.location.href = r.url; })}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                  {busy === "qbo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect QuickBooks
                </button>
              ) : <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">QuickBooks connect is being switched on for this platform. Meanwhile, export your lists from QuickBooks and use <b>Upload export files</b>.</p>}
            </Panel>
          ) : source === "sage" || source === "xero" ? (
            <Panel title={`Connect ${source === "sage" ? "Sage" : "Xero"}`} icon={PlugZap} description={`You sign in on ${source === "sage" ? "Sage" : "Xero"}'s own page and allow read access. Nothing is changed there.`}>
              {st.oauth_sources?.[source] ? (
                <button disabled={!!busy} onClick={() => act(source, async () => { const r = await erpApi("migrate/oauth-source-start", { source }); window.location.href = r.url; })}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                  {busy === source ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect {source === "sage" ? "Sage" : "Xero"}
                </button>
              ) : <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">{source === "sage" ? "Sage" : "Xero"} connect is being switched on for this platform. Meanwhile, use <b>Upload export files</b>.</p>}
              {source === "sage" && <p className="mt-3 text-xs text-muted-foreground">For Sage Business Cloud Accounting. Sage 50 and Sage Pastel run on your own computer: use Upload export files.</p>}
            </Panel>
          ) : source === "erpnext" ? (
            <Panel title="Connect ERPNext" icon={PlugZap} description="Read-only use: nothing is changed in ERPNext. In ERPNext open your user (Settings → My Settings → API Access → Generate Keys) and copy the API key and secret.">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="ERPNext address"><input className="fi" placeholder="https://mycompany.erpnext.com" value={erp.url} onChange={(e) => setErp({ ...erp, url: e.target.value })} /></Field>
                <Field label="API key"><input className="fi" autoComplete="off" value={erp.api_key} onChange={(e) => setErp({ ...erp, api_key: e.target.value })} /></Field>
                <Field label="API secret"><input className="fi" type="password" autoComplete="new-password" value={erp.api_secret} onChange={(e) => setErp({ ...erp, api_secret: e.target.value })} /></Field>
              </div>
              <button disabled={!!busy || !erp.url || !erp.api_key || !erp.api_secret} onClick={() => act("erpnext", async () => { const r = await erpApi("migrate/erpnext-connect", erp); setErp({ url: "", api_key: "", api_secret: "" }); toast.success(`Connected to ${r.name}`); })}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {busy === "erpnext" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect ERPNext
              </button>
            </Panel>
          ) : (
            <Panel title="Connect Loyverse" icon={PlugZap} description="In the Loyverse Back office open Integrations → Access tokens → Add access token, then paste it here. Nothing is changed in Loyverse.">
              <Field label="Access token"><input className="fi" type="password" autoComplete="new-password" value={loyToken} onChange={(e) => setLoyToken(e.target.value)} /></Field>
              <button disabled={!!busy || !loyToken.trim()} onClick={() => act("loyverse", async () => { const r = await erpApi("migrate/loyverse-connect", { token: loyToken.trim() }); setLoyToken(""); toast.success(`Connected to ${r.name}`); })}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {busy === "loyverse" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect Loyverse
              </button>
            </Panel>
          )
        ) : (
          <Panel title={<span title={`Connected · ${other.name}`}>Connected · {other.name}</span>} icon={CheckCircle2} description={other.url ? `${other.url} · ${other.username}` : undefined}
            actions={<button disabled={!!busy} onClick={() => act("disc", () => erpApi("migrate/source-disconnect", { source }))} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"><Unplug className="h-3.5 w-3.5" /> Disconnect</button>}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-3">
                {(source === "sage" || source === "xero") && (other.orgs?.length || 0) > 1 && (
                  <Field label="Organisation to bring over">
                    <select className="fi" value={other.org || ""} onChange={(e) => act("org", () => erpApi("migrate/source-org", { source, org_id: e.target.value }))}>
                      {(other.orgs || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </Field>
                )}
                {(source === "odoo" || source === "erpnext") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={withLines} onChange={(e) => setWithLines(e.target.checked)} /><span>Bring every document's line items</span></label>}
                <button disabled={!!busy || !chosen.length || job?.status === "fetching" || job?.status === "paused"} onClick={() => void startFetch({ source, kinds: chosen, with_lines: withLines }, false)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                  {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />} Fetch {chosen.length} kinds of records
                </button>
              </div>
              <div className="grid content-start gap-1.5 sm:grid-cols-2">
                {allKinds.map((k) => (
                  <label key={k} title={label(k)} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium">
                    <input type="checkbox" className="shrink-0" checked={chosen.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...chosen, k] : chosen.filter((x) => x !== k))} /> <span className="min-w-0 truncate">{label(k)}</span>
                  </label>
                ))}
              </div>
            </div>
          </Panel>
        )
      ) : !st.connected ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Connect Zoho" icon={PlugZap} description="Read-only access. Nothing is changed in Zoho.">
            <Field label="What the company uses" className="mb-3">
              <select className="fi" value={zplan} onChange={(e) => setZplan(e.target.value as "one" | "books")}>
                <option value="one">Zoho One (Books, CRM, Projects, People)</option>
                <option value="books">Zoho Books only</option>
              </select>
            </Field>
            <Field label="Where your Zoho account is hosted (data centre)">
              <select className="fi" value={dc} onChange={(e) => setDc(e.target.value)}>
                {Object.entries(st.data_centres || {}).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}
              </select>
            </Field>
            {st.oauth_available ? (
              <button disabled={!!busy} onClick={() => act("oauth", async () => { const r = await erpApi("migrate/oauth-start", { dc, plan: zplan }); window.location.href = r.url; })}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {busy === "oauth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect and sign in
              </button>
            ) : (
              <p className="mt-4 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">One-click connect is not switched on for this platform yet: use the developer key option alongside. It takes about two minutes.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{zplan === "one" ? "You sign in on Zoho's own page and approve read access to Books, CRM (accounts, contacts, products, deals, leads, notes), Projects and People." : "You sign in on Zoho's own page and approve read access to Books."} Connected with fewer apps before? Connect again to include them.</p>
          </Panel>
          <Panel title="Or connect with a developer key" icon={KeyRound} description="For admins of the Zoho account">
            <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>Open the <b className="text-foreground">Zoho API console</b> (api-console.zoho.com, or your data centre's), choose <b className="text-foreground">Self Client</b> and create it.</li>
              <li>Copy the <b className="text-foreground">Client ID</b> and <b className="text-foreground">Client Secret</b> into the boxes here.</li>
              <li>On <b className="text-foreground">Generate Code</b>, paste the scopes below, choose 10 minutes, pick the organisation, then create and copy the code.</li>
            </ol>
            {(["one", "books"] as const).map((p) => {
              const scopes = p === "one" ? st.scopes : st.scopes_books || st.scopes;
              return (
                <div key={p} className={`mb-2 rounded-xl border p-2 ${zplan === p ? "border-primary bg-primary/5" : "border-border bg-muted/40"}`}>
                  <p className="mb-1 text-[11px] font-semibold">{p === "one" ? "Zoho One (Books, CRM, Projects, People)" : "Zoho Books only"}</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-[11px]">{scopes}</code>
                    <button onClick={() => { void navigator.clipboard.writeText(scopes); setZplan(p); toast.success(p === "one" ? "Zoho One scopes copied" : "Books scopes copied"); }} className="icon-btn" aria-label={p === "one" ? "Copy Zoho One scopes" : "Copy Books scopes"}><Copy className="h-4 w-4" /></button>
                  </div>
                </div>
              );
            })}
            <div className="grid gap-3">
              <Field label="Client ID"><input className="fi" value={self.client_id} onChange={(e) => setSelf({ ...self, client_id: e.target.value })} autoComplete="off" /></Field>
              <Field label="Client secret"><input className="fi" type="password" value={self.client_secret} onChange={(e) => setSelf({ ...self, client_secret: e.target.value })} autoComplete="off" /></Field>
              <Field label="Generated code"><input className="fi" value={self.code} onChange={(e) => setSelf({ ...self, code: e.target.value })} autoComplete="off" /></Field>
            </div>
            <button disabled={!!busy || !self.client_id || !self.client_secret || !self.code} onClick={() => act("self", async () => { await erpApi("migrate/self-client", { dc, ...self }); setSelf({ client_id: "", client_secret: "", code: "" }); toast.success("Connected"); })}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
              {busy === "self" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Connect
            </button>
          </Panel>
        </div>
      ) : (
        <Panel title="Connected" icon={CheckCircle2} actions={<button disabled={!!busy} onClick={() => act("disc", () => erpApi("migrate/disconnect"))} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"><Unplug className="h-3.5 w-3.5" /> Disconnect</button>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-3">
              <Field label="Organisation to bring over">
                <select className="fi" value={st.org_id || ""} onChange={(e) => act("org", () => erpApi("migrate/select-org", { org_id: e.target.value }))}>
                  {!st.orgs?.length && <option value="">No organisations found</option>}
                  {(st.orgs || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}{o.currency ? ` (${o.currency})` : ""}</option>)}
                </select>
              </Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={withLines} onChange={(e) => setWithLines(e.target.checked)} />
                <span>Bring every document's line items <span className="block text-xs text-muted-foreground">One API call per quote, invoice, credit note and bill. Untick for totals only when the old plan's daily API allowance is small.</span></span></label>
              <button disabled={!!busy || !st.org_id || !chosen.length || job?.status === "fetching" || job?.status === "paused"} onClick={() => void startFetch({ kinds: chosen, with_lines: withLines }, false)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />} Fetch {chosen.length} kinds of records
              </button>
            </div>
            <div className="grid content-start gap-1.5 sm:grid-cols-2">
              {allKinds.map((k) => (
                <label key={k} title={label(k)} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium">
                  <input type="checkbox" className="shrink-0" checked={chosen.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...chosen, k] : chosen.filter((x) => x !== k))} /> <span className="min-w-0 truncate">{label(k)}</span>
                </label>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {job && (
        <Panel title={<span title={job.org_name || undefined}>Latest fetch · {job.org_name || "organisation"}</span>} icon={RefreshCw}
          description={`Started ${new Date(job.created_at).toLocaleString()} · ${job.api_calls} API calls`}
          actions={<Pill tone={job.status === "fetched" || job.status === "imported" ? "success" : job.status === "failed" || job.status === "cancelled" ? "danger" : job.status === "paused" ? "warning" : "info"}>{job.status}</Pill>}>
          {job.error && <p className="mb-3 rounded-xl bg-warning/10 p-3 text-sm">{job.error}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1.5">
            {(job.kinds || []).map((k: string) => (
              <div key={k} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs" title={`${label(k)}: ${job.progress?.[k]?.note || `${Number(job.progress?.[k]?.fetched || 0).toLocaleString()} fetched`}`}>
                <span className="min-w-0 truncate font-medium">{label(k)}</span>
                <span className="min-w-0 shrink truncate text-right tabular-nums text-muted-foreground">{job.progress?.[k]?.note || `${Number(job.progress?.[k]?.fetched || 0).toLocaleString()} fetched`}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {job.status === "fetching" && <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Fetching {total(job.progress).toLocaleString()} records so far. You can leave this page; it carries on.</span>}
            {(job.status === "fetching" || job.status === "paused") && <button disabled={!!busy} onClick={() => act("cancel", () => erpApi("migrate/cancel", { id: job.id }))} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm"><XCircle className="h-4 w-4" /> Stop</button>}
            {(job.status === "paused" || job.status === "failed") && <button disabled={!!busy} onClick={() => act("resume", () => erpApi("migrate/resume", { id: job.id }))} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm"><PauseCircle className="h-4 w-4" /> Resume now</button>}
            {(job.status === "fetched" || job.status === "imported") && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={synth} onChange={(e) => setSynth(e.target.checked)} /> Record amounts already paid when payments are not included</label>
                <button disabled={!!busy} onClick={() => importStaged(job)} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">
                  {busy.startsWith("import") ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing {busy.slice(7)}…</> : <>{job.status === "imported" ? "Import again (skips what's here)" : `Import ${total(job.progress).toLocaleString()} records`} <ArrowRight className="h-4 w-4" /></>}
                </button>
              </>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- file upload */

function FileMove({ onLog, src }: { onLog: (l: Log[]) => void; src: Source }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [synthPayments, setSynthPayments] = useState(true);

  const add = async (list: FileList | null) => {
    if (!list) return;
    const out: Loaded[] = [];
    for (const f of Array.from(list)) {
      try { const rows = await readFile(f); out.push({ file: f.name, kind: detectFor(src, f.name, rows), rows }); }
      catch (e) { toast.error(`${f.name}: ${friendlyError(e)}`); }
    }
    setFiles((x) => [...x, ...out]);
  };
  const byKind = useMemo(() => { const m = new Map<Kind, Row[]>(); files.forEach((f) => { if (f.kind) m.set(f.kind, [...(m.get(f.kind) || []), ...adapt(src, f.kind, f.rows)]); }); return m; }, [files, src]);
  const run = async () => {
    if (!tenantId) return;
    setBusy(true); onLog([]);
    moveRun.start({ tenantId, source: `files:${src.key}`, phase: "importing", line: "Getting ready…" });
    try {
      const t = trackImport(byKind, 3);
      const log = await runImport(byKind, { tenantId, synthPayments, onStep: setStep, onKind: t.onKind, onLog: (l) => { t.onLog(l); onLog(l); } });
      moveRun.step("kra", { state: "running", note: "Invoices the old system reported to KRA" });
      moveRun.patch(() => ({ line: "Reading KRA receipt details for invoices reported in the old system…", pct: 96 }));
      await erpApi("etims/fill-from-kra").catch(() => null);
      moveRun.step("kra", { state: "done", note: undefined });
      moveRun.step("finish", { state: "running" });
      moveRun.patch(() => ({ line: "Refreshing your books…", pct: 98 }));
      await qc.invalidateQueries();
      const ok = log.reduce((a, l) => a + l.ok, 0), skipped = log.reduce((a, l) => a + l.skipped, 0);
      moveRun.finish(`${ok.toLocaleString()} records imported${skipped ? `, ${skipped.toLocaleString()} already here` : ""}. Check Financial Statements and the trial balance.`);
      toast.success("Import finished", { description: "Every document was posted to your books. Check Financial Statements and the trial balance." });
    } catch (e) { moveRun.fail(friendlyError(e)); toast.error(friendlyError(e)); } finally { setBusy(false); setStep(""); }
  };
  const total = files.reduce((a, f) => a + f.rows.length, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title={`1. Export from ${src.name}`} icon={Download}>
        <ol className="space-y-2 text-sm text-muted-foreground">
          {src.tips.map((t) => <li key={t}>{t}</li>)}
          <li>Keep the column headings as exported: JMSURF Garage reads {src.key === "other" ? "common" : src.name} column names.</li>
          <li>Tip: import into a fresh company, then compare the trial balance before you go live.</li>
        </ol>
        <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {KINDS.filter((k) => k.kind !== "attachments" && (src.key === "other" || src.where[k.kind])).map((k) => (
            <div key={k.kind} className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              {byKind.get(k.kind)?.length ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 break-words"><b className="block truncate text-foreground" title={k.label}>{k.label}</b>{src.where[k.kind] || "Any CSV or Excel list"}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="2. Upload the files" icon={UploadCloud}>
        <input ref={input} type="file" multiple accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <button onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border px-4 py-10 text-center hover:border-primary/50 hover:bg-primary/5">
          <UploadCloud className="h-8 w-8 text-primary" />
          <span className="font-semibold">Drop export files here</span>
          <span className="text-xs text-muted-foreground">CSV or Excel · several files at once</span>
        </button>
        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{f.file}</span>
                <select className="fi h-8 w-auto text-xs" value={f.kind || ""} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, kind: (e.target.value || null) as Kind | null } : x)))}>
                  <option value="">Not recognised: choose…</option>
                  {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
                <Pill>{f.rows.length} rows</Pill>
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={synthPayments} onChange={(e) => setSynthPayments(e.target.checked)} />
          <span>When payment files are not included, record what the old system shows as already paid so balances match.</span>
        </label>
        <button disabled={!files.some((f) => f.kind) || busy} onClick={() => void run()}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing {step}…</> : <>Import {total.toLocaleString()} rows <ArrowRight className="h-4 w-4" /></>}
        </button>
      </Panel>
    </div>
  );
}

/** Move in: choose the system you are leaving, then connect it by API or upload its export files. */
export default function MigrateImport() {
  const [params, setParams] = useSearchParams();
  const key = (SOURCES.some((x) => x.key === params.get("from")) ? params.get("from") : "zoho") as SourceKey;
  const src = sourceOf(key);
  const [mode, setMode] = useState<"api" | "files">(src.api ? "api" : "files");
  const [log, setLog] = useState<Log[]>([]);
  const tenantId = useTenantId();
  const run = useMoveRun(tenantId);
  // Back on the page while a move-in is still going: show its progress again.
  useEffect(() => { if (isActive(moveRun.get()) && moveRun.get()?.tenantId === tenantId) moveRun.show(); }, [tenantId]);
  const pickSource = (k: SourceKey) => {
    const next = new URLSearchParams(params); next.set("from", k); setParams(next, { replace: true });
    setMode(sourceOf(k).api ? "api" : "files"); setLog([]);
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Move in" icon={UploadCloud}
        description="Bring a company's history into JMSURF Garage: chart of accounts, bank accounts and transactions, opening balances, customers, vendors, items with stock, quotes, sales orders, invoices, credit notes, payments, purchase orders, bills, vendor credits, expenses, journals, recurring documents, CRM accounts, contacts, products, deals, leads and notes, and employees." />
      <MoveProgressBar run={run} />
      <MoveProgress run={run} />
      {/* Cards size themselves (about 9.5rem each), so names never squeeze: 2 on a phone, up to 9 on a wide screen. */}
      <div role="tablist" aria-label="Moving from" className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
        {SOURCES.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === key} type="button" onClick={() => pickSource(x.key)} title={x.name}
            className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border-2 p-2.5 text-left transition-all sm:p-3", x.key === key ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40")}>
            <BrandLogo id={x.logo} name={x.name} className="h-9 w-9 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{x.name}</span><span className="block truncate text-[11px] text-muted-foreground">{x.api ? "API or files" : "Export files"}</span></span>
          </button>
        ))}
      </div>
      <section className="min-w-0 space-y-5 rounded-3xl border border-border bg-card/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <BrandLogo id={src.logo} name={src.name} className="h-12 w-12 shrink-0 rounded-2xl" />
          <div className="min-w-[12rem] flex-1">
            <h2 className="break-words font-display text-lg font-bold">Move in from {src.name}</h2>
            <p className="break-words text-sm text-muted-foreground">{src.tagline}</p>
          </div>
          {src.api && <Segmented<"api" | "files"> value={mode} onChange={setMode} options={[{ value: "api", label: <><PlugZap className="h-4 w-4" /> Connect by API</> }, { value: "files", label: <><FileSpreadsheet className="h-4 w-4" /> Upload export files</> }]} />}
        </div>
        {src.api && mode === "api" ? <ApiMove key={src.api} source={src.api} onLog={setLog} /> : <FileMove key={src.key} src={src} onLog={setLog} />}
      </section>
      <Results log={log} />
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />{`Imports are safe to repeat: records whose number or name already exists are skipped. Order: ${ORDER.map(label).join(" → ")}.`}</p>
    </div>
  );
}
