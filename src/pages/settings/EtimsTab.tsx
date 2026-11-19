import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Copy, FileCheck2, FlaskConical, ListChecks, Power, Radio, ShieldCheck, Zap } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useBusinessSettings } from "@/hooks/useData";
import { Panel, Field, Segmented, Pill, Modal } from "@/components/kit";
import { ClassPicker } from "@/components/books/KraClassPicker";
import { useErpSettings, Toggle } from "@/pages/settings/ErpSettingsTabs";
import { erpApi } from "@/lib/erpApi";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
type Mode = "sbx" | "prod";

/** Garage defaults (same as etims.js DEFAULT_*_CLASS): starting points, to be confirmed with KRA. */
const GARAGE_SERVICE_CLASS = "7818150000";
const GARAGE_GOODS_CLASS = "2517000000";

/**
 * System → KRA eTIMS. One page: the connection at the top, then (once connected) the KRA activity.
 * Test mode signs in KRA's sandbox and needs no approval; Live needs KRA to approve the device first.
 */
export default function EtimsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { settings, save } = useErpSettings();
  const e = settings.etims || {};
  const { data: biz } = useBusinessSettings();
  const bizPin = String((biz as any)?.tax_pin || "").toUpperCase().trim();
  const [f, setF] = useState<any>({ env: "sbx", tin: "", bhf_id: "00", device_serial: "", goods_cls_cd: "", service_cls_cd: "", auto_sign: true, vat_registered: true });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [defaults, setDefaults] = useState(false);
  const [ownSerial, setOwnSerial] = useState(false);
  const [issued, setIssued] = useState<{ branch: string; serial: string } | null>(null);
  const [tab, setTab] = useState<"activity" | "report" | "kra">("activity");
  useEffect(() => {
    setF({ bhf_id: "00", auto_sign: true, vat_registered: true, ...e, tin: e.tin || bizPin, env: e.env === "prod" ? "prod" : "sbx" });
    setOwnSerial(!!e.device_serial && !e.serial_auto);
  }, [settings.etims, bizPin]);

  const mode: Mode = f.env === "prod" ? "prod" : "sbx";
  const pin = String(f.tin || "").toUpperCase().trim();
  const bhf = (String(f.bhf_id || "00").replace(/\D/g, "") || "00").padStart(2, "0").slice(0, 2);
  const pinOk = /^[AP]\d{9}[A-Z]$/.test(pin);
  const ready = !!e.initialised_at && e.via === "hub";
  const enabled = e.enabled === true || !!e.initialised_at || !!e.device_serial;
  const [terms, setTerms] = useState(false);
  const [agree, setAgree] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const enable = async () => {
    setEnabling(true);
    try {
      const { data, error } = await (supabase as any).rpc("enable_etims", { p_branch: bhf, p_terms_version: "2026-11" });
      if (error) throw error;
      setIssued({ branch: bhf, serial: String(data) });
      await qc.invalidateQueries({ queryKey: ["erp-settings"] });
      setTerms(false);
      toast.success("KRA eTIMS enabled", { description: `Device serial ${data}. Now connect to KRA.` });
    } catch (err) { toast.error(friendlyError(err)); } finally { setEnabling(false); }
  };
  const liveReady = ready && e.env === "prod";
  // Device serial: issued by JMSURF TAX (one per branch, kept for good); a connected company keeps the one it used.
  useEffect(() => {
    if (!enabled || !canManage || ownSerial || !pinOk || (ready && e.device_serial) || issued?.branch === bhf) return;
    let on = true;
    void (supabase as any).rpc("issue_etims_serial", { p_branch: bhf }).then(({ data, error }: any) => { if (on && !error && data) setIssued({ branch: bhf, serial: String(data) }); });
    return () => { on = false; };
  }, [enabled, canManage, ownSerial, pinOk, bhf, ready, e.device_serial, issued?.branch]);
  const serial = ownSerial ? String(f.device_serial || "").trim() : ready && e.device_serial ? String(e.device_serial) : issued?.branch === bhf ? issued.serial : "";

  const persist = async (quiet = false) => {
    const { error } = await save("etims", { ...e, ...f, env: mode, tin: pin, bhf_id: bhf, device_serial: serial, serial_auto: !ownSerial });
    if (error) { toast.error(friendlyError(error)); return false; }
    if (!quiet) toast.success("Saved");
    return true;
  };
  const connect = async () => {
    if (!pinOk) return toast.error("Enter the company's KRA PIN, e.g. P051234567X");
    setBusy(true);
    try {
      if (!(await persist(true))) return;
      const r = await erpApi("etims/initialize", { force: editing });
      void qc.invalidateQueries({ queryKey: ["erp-settings"] });
      void qc.invalidateQueries({ queryKey: ["etims-status"] });
      setEditing(false);
      toast.success(mode === "prod" ? "Connected to KRA eTIMS" : "Connected to KRA eTIMS in test mode", { description: [r.taxpayer, r.sdc_id && `control unit ${r.sdc_id}`].filter(Boolean).join(" · ") || undefined });
    } catch (err) {
      toast.error(friendlyError(err), { description: mode === "prod" ? "KRA must approve your OSCU request first. Follow the steps on the right, then connect again." : undefined });
    } finally { setBusy(false); }
  };
  const copy = (v: string) => { void navigator.clipboard.writeText(v); toast.success("Copied"); };
  const { data: st } = useQuery({ queryKey: ["etims-status"], enabled: ready, queryFn: () => erpApi("etims/status") });
  const testDevice = !!(st as any)?.test_device;

  return (
    <div className="space-y-5">
      {/* status */}
      <section className="flex flex-wrap items-center gap-4 rounded-3xl border border-border bg-card p-5">
        <BrandLogo id="kra" name="KRA" className="h-12 w-12 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{ready ? (liveReady ? "Signing with KRA" : "Testing with KRA") : enabled ? "Not connected to KRA yet" : "KRA eTIMS is off"}</p>
          <p className="text-sm text-muted-foreground">Invoices, credit notes, items and customers go to KRA automatically.</p>
        </div>
        {ready
          ? <Pill tone={liveReady ? "success" : "info"} className="px-3 py-1 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> {liveReady ? "Connected · Live" : "Connected · Test"}</Pill>
          : enabled ? <Pill tone="muted" className="px-3 py-1 text-xs">Not connected</Pill>
          : canManage ? <button type="button" onClick={() => { setAgree(false); setTerms(true); }} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Power className="h-4 w-4" /> Enable</button>
          : <Pill tone="muted" className="px-3 py-1 text-xs">Off</Pill>}
        {!enabled && <p className="w-full border-t border-border pt-3 text-sm text-muted-foreground">{canManage ? "Press Enable when you are ready. You get a device serial number from JMSURF TAX, then connect." : "Ask an admin to enable it."}</p>}
        {ready && (
          <div className="flex w-full flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>Taxpayer <b className="text-foreground">{e.taxpayer_name || "—"}</b></span>
            <span>Control unit <b className="font-mono text-foreground">{e.sdc_id || "—"}</b></span>
            <span>Branch <b className="text-foreground">{e.branch_name || bhf}</b></span>
            <span>Since <b className="text-foreground">{new Date(e.initialised_at).toLocaleDateString("en-GB")}</b></span>
            {canManage && !editing && <button type="button" onClick={() => setEditing(true)} className="ml-auto font-semibold text-primary">Change connection</button>}
          </div>
        )}
        {ready && testDevice && (
          <p className="flex w-full items-start gap-2 rounded-2xl bg-info/10 px-3 py-2 text-xs text-info"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />Test mode signs on the JMSURF TAX test device in KRA's sandbox. Nothing is reported to KRA for real.</p>
        )}
      </section>

      {/* connect */}
      {enabled && (!ready || editing) && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title={ready ? "Change connection" : "Connect to KRA"} icon={Radio}>
            <div className="space-y-4">
              <Field label="Mode">
                <Segmented value={mode} onChange={(v) => setF({ ...f, env: v })} options={[{ value: "sbx", label: "Test (KRA sandbox)" }, { value: "prod", label: "Live" }]} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                <Field label="Company KRA PIN" required hint={bizPin && pin === bizPin ? "From Business settings" : undefined}><input className="fi uppercase" disabled={!canManage} value={f.tin || ""} onChange={(x) => setF({ ...f, tin: x.target.value })} placeholder="Enter KRA PIN" /></Field>
                <Field label="Branch" hint="00 = head office"><input className="fi" disabled={!canManage} value={f.bhf_id || ""} onChange={(x) => setF({ ...f, bhf_id: x.target.value })} /></Field>
              </div>
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Device serial number</p>
                {ownSerial ? (
                  <input className="fi mt-2 font-mono" disabled={!canManage} value={f.device_serial || ""} placeholder="Enter the serial you registered with KRA" onChange={(x) => setF({ ...f, device_serial: x.target.value })} />
                ) : serial ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xl font-bold tracking-wider">{serial}</span>
                    <button type="button" onClick={() => copy(serial)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  </div>
                ) : <p className="mt-1 text-sm text-muted-foreground">{pinOk ? "Issuing your serial number…" : "Appears once the KRA PIN is entered."}</p>}
                {canManage && <button type="button" className="mt-2 text-xs font-semibold text-primary" onClick={() => setOwnSerial(!ownSerial)}>{ownSerial ? "Use the serial JMSURF TAX issues" : "I already have a serial from KRA"}</button>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button disabled={!canManage || busy || !pinOk} onClick={() => void connect()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Zap className="h-4 w-4" /> {busy ? "Connecting…" : "Connect"}</button>
                {editing && <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>}
              </div>
            </div>
          </Panel>
          {mode === "prod"
            ? <LiveSteps pinOk={pinOk} serial={serial} ready={liveReady} pin={pin} branch={bhf} canManage={canManage} />
            : <Panel title="Test mode" icon={FlaskConical}><p className="text-sm text-muted-foreground">Try everything with KRA's sandbox first. No KRA approval is needed: press <b>Connect</b>, then send an invoice. Switch to <b>Live</b> when KRA has approved your OSCU device.</p></Panel>}
        </div>
      )}

      <Modal center open={terms} onClose={() => setTerms(false)} title="Enable KRA eTIMS" icon={FileCheck2}
        footer={<div className="flex justify-end gap-2">
          <button type="button" onClick={() => setTerms(false)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">Cancel</button>
          <button type="button" disabled={!agree || enabling} onClick={() => void enable()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{enabling ? "Enabling…" : "Accept and enable"}</button>
        </div>}>
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>JMSURF TAX issues this company a device serial number for KRA eTIMS (OSCU), one per branch, kept for good.</li>
            <li>Once connected Live, the invoices and credit notes you send are reported to KRA under your KRA PIN.</li>
            <li>You are responsible for your KRA PIN, branch details and what you report. JMSURF TAX passes them to KRA as entered.</li>
            <li>KRA must approve your OSCU request before Live works. Test mode uses KRA's sandbox and reports nothing for real.</li>
          </ul>
          <label className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <input type="checkbox" className="mt-0.5" checked={agree} onChange={(x) => setAgree(x.target.checked)} />
            <span>I accept these terms for <b>{(biz as any)?.business_name || "this company"}</b>.</span>
          </label>
        </div>
      </Modal>

      {/* everyday settings */}
      {ready && !editing && (
        <Panel title="Settings" icon={ShieldCheck}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Toggle label="Sign invoices automatically" hint={f.auto_sign ? "On: each invoice and credit note goes to KRA when it is sent. Drafts and void documents are left out." : "Off: push each invoice and credit note to eTIMS yourself."} checked={!!f.auto_sign} disabled={!canManage} onChange={(v) => setF({ ...f, auto_sign: v, ...(v && !f.auto_sign ? { auto_sign_since: new Date().toISOString() } : {}) })} />
            <Toggle label="VAT registered" hint={f.vat_registered !== false ? "On: items are reported with their VAT rate (16%, 8%, zero-rated or exempt)." : "Off: every item is reported as non-VAT (D)."} checked={f.vat_registered !== false} disabled={!canManage} onChange={(v) => setF({ ...f, vat_registered: v })} />
          </div>
          <button type="button" onClick={() => setDefaults(!defaults)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
            <ChevronDown className={`h-4 w-4 transition-transform ${defaults ? "rotate-180" : ""}`} /> Default item classifications
          </button>
          {defaults && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Parts and goods" hint={`Used for parts without a classification · ${f.goods_cls_cd || `${GARAGE_GOODS_CLASS} (vehicle components, confirm with KRA)`}`}>
                <ClassPicker value={f.goods_cls_cd || ""} env={mode} disabled={!canManage} placeholder={f.goods_cls_cd || GARAGE_GOODS_CLASS} onChange={(v) => setF({ ...f, goods_cls_cd: v })} />
              </Field>
              <Field label="Labour and services" hint={`Used for labour and services without a classification · ${f.service_cls_cd || `${GARAGE_SERVICE_CLASS} (vehicle repair and maintenance, confirm with KRA)`}`}>
                <ClassPicker value={f.service_cls_cd || ""} env={mode} disabled={!canManage} placeholder={f.service_cls_cd || GARAGE_SERVICE_CLASS} onChange={(v) => setF({ ...f, service_cls_cd: v })} />
              </Field>
              <p className="sm:col-span-2 text-xs text-muted-foreground">The suggested codes are a starting point: confirm the right classes with KRA (or your tax agent) before you sign live invoices, then set them here or on each item.</p>
            </div>
          )}
          {canManage && <div className="mt-4"><button onClick={() => void persist()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Save settings</button></div>}
        </Panel>
      )}

      {/* activity */}
      {ready && !editing && (
        <div className="space-y-4">
          <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "activity", label: "Sent to KRA" }, { value: "report", label: "Daily report" }, { value: "kra", label: "From KRA" }]} />
          {tab === "activity" && <Activity canManage={canManage} />}
          {tab === "report" && <DailyReport />}
          {tab === "kra" && <KraInbound canManage={canManage} />}
        </div>
      )}
    </div>
  );
}

/** Live mode: get the integration token, apply for OSCU on KRA's portal, connect. */
function LiveSteps({ pinOk, serial, ready, pin, branch, canManage }: { pinOk: boolean; serial: string; ready: boolean; pin: string; branch: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const { data: tokenReq } = useQuery({
    queryKey: ["etims-token-request", branch], refetchInterval: (q) => ((q.state.data as any)?.status === "requested" ? 60_000 : false),
    queryFn: async () => ((await (supabase as any).from("etims_token_requests").select("*").eq("branch_id", branch).order("requested_at", { ascending: false }).limit(1)).data || [])[0] || null,
  });
  const askToken = async () => {
    setAsking(true);
    try {
      const r = await erpApi("etims-token-request", { pin, serial, branch });
      toast.success(r.already ? "Already requested" : "Token requested", { description: "You get it here as soon as KRA issues it." });
      void qc.invalidateQueries({ queryKey: ["etims-token-request"] });
    } catch (e) { toast.error(friendlyError(e)); } finally { setAsking(false); }
  };
  const token = tokenReq?.status === "issued" ? String(tokenReq.token || "") : "";
  const steps: { t: string; d: React.ReactNode; done: boolean }[] = [
    { t: "Get your integration token", done: !!token || ready, d: token ? (
      <span className="flex flex-wrap items-center gap-2"><b className="break-all rounded-lg bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{token}</b>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(token); toast.success("Token copied"); }} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs font-semibold"><Copy className="h-3 w-3" /> Copy</button></span>
    ) : tokenReq?.status === "requested" ? "Requested. It appears here when KRA issues it."
      : canManage ? <button type="button" disabled={!pinOk || !serial || asking} onClick={() => void askToken()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{asking ? "Requesting…" : "Request token"}</button> : "Ask an admin to request it." },
    { t: "Apply for OSCU on KRA's portal", done: ready, d: <>At <a className="font-semibold text-primary underline" href="https://etims.kra.go.ke" target="_blank" rel="noreferrer">etims.kra.go.ke</a>: Service request → eTIMS → OSCU, with the token and serial{serial ? <> <b className="font-mono">{serial}</b></> : ""}.</> },
    { t: "Connect", done: ready, d: "When KRA approves (by SMS or email), press Connect." },
  ];
  return (
    <Panel title="Going live" icon={ListChecks}>
      <ol className="space-y-3">
        {steps.map((x, i) => (
          <li key={x.t} className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${x.done ? "bg-success text-white" : "bg-primary/10 text-primary"}`}>{x.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}</span>
            <div className="min-w-0 text-sm"><p className="font-semibold">{x.t}</p><div className="mt-0.5 text-muted-foreground">{x.d}</div></div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const money = (n: unknown) => `KES ${(Number(n) || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every invoice and credit note sent to KRA, with its KRA receipt or the reason it failed. */
function Activity({ canManage }: { canManage: boolean }) {
  const [filter, setFilter] = useState("");
  const { data: docs, refetch } = useQuery({ queryKey: ["etims-docs", filter], queryFn: () => erpApi("etims/documents", { status: filter }) });
  const retry = async (id: string) => { try { await erpApi("etims/retry", { id }); toast.success("Sent to KRA again"); void refetch(); } catch (e) { toast.error(friendlyError(e)); } };
  const rows: any[] = (docs as any)?.data || [];
  const tone = (s: string) => (s === "signed" ? "success" : s === "failed" ? "danger" : "warning") as "success" | "danger" | "warning";
  return (
    <Panel flush title="Sent to KRA" icon={Zap} actions={
      <div className="flex gap-1 rounded-xl bg-muted p-1 text-xs font-medium">
        {[["", "All"], ["signed", "Signed"], ["pending", "Waiting"], ["failed", "Failed"]].map(([v, l]) => <button key={v} onClick={() => setFilter(v)} className={`rounded-lg px-2.5 py-1 ${filter === v ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{l}</button>)}
      </div>}>
      <div className="max-h-[28rem] overflow-auto"><table className="dt">
        <thead><tr><th>Date</th><th>Document</th><th className="num">Amount</th><th>KRA receipt</th><th>Status</th><th /></tr></thead>
        <tbody><PagedRows rows={rows} colSpan={6}>{(pageRows) => pageRows.map((d) => (
          <tr key={d.id}>
            <td className="whitespace-nowrap">{new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
            <td className="font-semibold">{d.reference}<span className="block text-xs font-normal text-muted-foreground">{d.object === "credit_note" ? "Credit note" : "Invoice"}</span></td>
            <td className="num">{d.totals ? money(d.totals.amount) : "—"}</td>
            <td className="font-mono text-xs">{d.kra?.cu_invoice_number || "—"}</td>
            <td><Pill tone={tone(d.status)}>{d.status}</Pill>{d.error?.message && <span className="block max-w-xs truncate text-[11px] text-muted-foreground" title={d.error.message}>{d.error.message}</span>}</td>
            <td className="text-right">{canManage && d.status !== "signed" && <button onClick={() => void retry(d.id)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium">Retry</button>}</td>
          </tr>
        ))}</PagedRows></tbody>
      </table>{!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">Nothing sent to KRA yet.</p>}</div>
    </Panel>
  );
}

/** Sales and credit notes signed with KRA on a day (today so far = X report, a past day = Z report). */
function DailyReport() {
  const [day, setDay] = useState(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
  const { data: rep } = useQuery({ queryKey: ["etims-daily", day], queryFn: () => erpApi("etims/daily-report", { date: day }) });
  return (
    <Panel title="Daily report" icon={CheckCircle2} actions={<input type="date" className="fi h-9 w-40" value={day} onChange={(x) => setDay(x.target.value)} aria-label="Day" />}>
      {rep ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {([["Sales", (rep as any).sales], ["Credit notes", (rep as any).credit_notes]] as const).map(([l, r]: any) => (
            <div key={l} className="rounded-2xl border border-border p-4 text-sm">
              <p className="font-semibold">{l} · {r?.count || 0}</p>
              <p className="mt-1 font-display text-xl font-bold">{money(r?.total)}</p>
              <p className="text-xs text-muted-foreground">VAT {money(r?.tax)}{r?.first_receipt ? ` · receipts ${r.first_receipt}–${r.last_receipt}` : ""}</p>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Loading…</p>}
    </Panel>
  );
}

/** What KRA holds for the company: notices, purchases suppliers declared, customs imports. */
function KraInbound({ canManage }: { canManage: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const { data: notes } = useQuery({ queryKey: ["etims-notices"], queryFn: () => erpApi("etims/notices") });
  const { data: buys, refetch: refetchBuys, isFetching: fetchingBuys } = useQuery({ queryKey: ["etims-kra-purchases"], queryFn: () => erpApi("etims/kra-purchases") });
  const { data: imps, refetch: refetchImps } = useQuery({ queryKey: ["etims-imports"], queryFn: () => erpApi("etims/imports") });
  const { data: prods = [] } = useQuery({ queryKey: ["etims-registered-items"], queryFn: async () => ((await (supabase as any).from("products").select("id,name,etims_item_cd").not("etims_item_cd", "is", null).order("name").limit(2000)).data || []) as any[] });
  const [pick, setPick] = useState<Record<string, string>>({});
  const money = (n: unknown) => `KES ${(Number(n) || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const kdate = (d: string) => (/^\d{8}/.test(d || "") ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : d || "—");
  const run = async (k: string, fn: () => Promise<any>, ok: string) => { setBusy(k); try { const r = await fn(); toast.success(ok); return r; } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); } };
  return (
    <>
      <Panel title="KRA notices" icon={ShieldCheck} description="Messages KRA sends to every eTIMS taxpayer.">
        {!((notes as any)?.data || []).length ? <p className="text-sm text-muted-foreground">No notices from KRA.</p> : (
          <ul className="max-h-72 space-y-3 overflow-auto">{((notes as any).data as any[]).map((n) => (
            <li key={n.notice_no} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold">{n.title || `Notice ${n.notice_no}`}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-line text-muted-foreground">{n.content}</p>
              <p className="mt-1 text-xs text-muted-foreground">{kdate(String(n.registered_at || ""))}{n.detail_url && <> · <a href={n.detail_url} target="_blank" rel="noreferrer" className="text-primary underline">Read more</a></>}</p>
            </li>
          ))}</ul>
        )}
      </Panel>

      <Panel title="Purchases from KRA" icon={Zap} description="Sales your suppliers declared to KRA with your PIN. Turn each into a bill, or reject it if it is not yours."
        actions={<button onClick={() => void refetchBuys()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium">{fetchingBuys ? "Fetching…" : "Fetch from KRA"}</button>}>
        <div className="max-h-96 overflow-auto"><table className="dt">
          <thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
          <tbody><PagedRows rows={((buys as any)?.data || [])} colSpan={6}>{(pageRows) => pageRows.map((p: any) => (
            <tr key={p.id}>
              <td>{kdate(p.sale_date)}</td><td className="font-medium">{p.supplier_name || p.supplier_pin}<span className="block text-xs text-muted-foreground">{p.supplier_pin}</span></td>
              <td>{p.supplier_invoice_no}</td><td className="num">{money(p.total_amount)}</td>
              <td><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.status === "accepted" ? "bg-success/15 text-success" : p.status === "rejected" ? "bg-muted text-muted-foreground" : "bg-warning/15 text-warning"}`}>{p.status === "accepted" ? `Bill ${p.external_ref || ""}` : p.status}</span></td>
              <td className="whitespace-nowrap text-right">{canManage && p.status === "new" && <>
                <button disabled={!!busy} onClick={async () => { const r = await run(`b${p.id}`, () => erpApi("etims/kra-purchase-to-bill", { id: p.id }), "Draft bill created"); if (r?.bill_id) navigate(`/purchases/bills/${r.bill_id}`); }} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Create bill</button>
                <button disabled={!!busy} onClick={async () => { await run(`r${p.id}`, () => erpApi("etims/kra-purchase-reject", { id: p.id }), "Rejected"); void refetchBuys(); }} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium">Reject</button>
              </>}</td>
            </tr>
          ))}</PagedRows></tbody>
        </table>{!((buys as any)?.data || []).length && <p className="py-6 text-center text-sm text-muted-foreground">KRA has no purchases for your PIN yet.</p>}</div>
      </Panel>

      <Panel title="Customs imports" icon={Zap} description="Goods KRA customs cleared for you. Approve each against a registered item so the stock counts, or cancel it.">
        <div className="max-h-96 overflow-auto"><table className="dt">
          <thead><tr><th>Declaration</th><th>Item</th><th className="num">Quantity</th><th>Supplier</th><th>Status</th><th /></tr></thead>
          <tbody>{((imps as any)?.data || []).map((m: any) => (
            <tr key={m.id}>
              <td>{m.declaration_no || m.task_cd}<span className="block text-xs text-muted-foreground">{kdate(m.declaration_date)} · HS {m.hs_code}</span></td>
              <td>{m.item_name}</td><td className="num">{Number(m.quantity)} {m.quantity_unit}</td><td>{m.supplier_name}</td>
              <td><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{m.status}</span></td>
              <td className="whitespace-nowrap text-right">{canManage && m.status === "waiting" && <>
                <select className="fi h-8 w-44 text-xs" value={pick[m.id] || ""} onChange={(e) => setPick({ ...pick, [m.id]: e.target.value })} aria-label="Registered item"><option value="">Becomes item…</option>{(prods as any[]).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button disabled={!!busy || !pick[m.id]} onClick={async () => { await run(`a${m.id}`, () => erpApi("etims/import-decide", { id: m.id, approve: true, product_id: pick[m.id] }), "Import approved"); void refetchImps(); }} className="ml-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">Approve</button>
                <button disabled={!!busy} onClick={async () => { await run(`c${m.id}`, () => erpApi("etims/import-decide", { id: m.id, approve: false }), "Import cancelled"); void refetchImps(); }} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium">Cancel</button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>{!((imps as any)?.data || []).length && <p className="py-6 text-center text-sm text-muted-foreground">No customs imports.</p>}</div>
      </Panel>
    </>
  );
}
