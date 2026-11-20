import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Loader2, Send, Eye } from "lucide-react";
import { PageHeader, Panel, Field, StatusPill, btnCls, btnPrimaryCls } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { sb, must, wsApi } from "../lib/api";
import { saveGarageSettings, useGarageSettings, useRefresh } from "../lib/data";
import { KIND_LABEL, DEFAULT_REMINDERS, type ReminderKind, type ReminderSettings } from "../lib/reminders";
import { SmsTextBox, PlateTag, when } from "../components/bits";

const KINDS = Object.keys(DEFAULT_REMINDERS.kinds) as ReminderKind[];

/** Service, expiry, win-back and booking reminders: settings, what is due, and what was sent. */
export default function Reminders() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const refresh = useRefresh();
  const { data: settings } = useGarageSettings();
  const [cfg, setCfg] = useState<ReminderSettings | null>(null);
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [busy, setBusy] = useState<string | null>(null);
  const [due, setDue] = useState<any[] | null>(null);
  const [testPhone, setTestPhone] = useState("");
  useEffect(() => { if (settings && !cfg) setCfg(settings.reminders); }, [settings, cfg]);
  const { data: log = [] } = useQuery({
    queryKey: ["gw-reminder-log", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_reminder_log").select("*, vehicle:garage_vehicles(plate)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100)) as any[],
  });
  if (!cfg) return null;
  const setKind = (k: ReminderKind, p: Record<string, unknown>) => setCfg({ ...cfg, kinds: { ...cfg.kinds, [k]: { ...cfg.kinds[k], ...p } } });

  const save = async () => {
    setBusy("save");
    try { await saveGarageSettings(tenantId!, { reminders: cfg }); toast({ title: "Reminder settings saved" }); refresh(); }
    catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const preview = async () => {
    setBusy("preview");
    try { await saveGarageSettings(tenantId!, { reminders: cfg }); const r: any = await wsApi("reminders/preview"); setDue(r.due); }
    catch (e: any) { toast({ title: "Could not check", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const run = async () => {
    setBusy("run");
    try { await saveGarageSettings(tenantId!, { reminders: cfg }); const r: any = await wsApi("reminders/run"); toast({ title: `${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}` }); setDue(null); refresh(); }
    catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const test = async (kind: ReminderKind) => {
    if (!testPhone) return toast({ title: "Enter your phone number to test", variant: "destructive" });
    setBusy(`test-${kind}`);
    try { await saveGarageSettings(tenantId!, { reminders: cfg }); await wsApi("reminders/test", { kind, phone: testPhone, lang }); toast({ title: "Test sent" }); }
    catch (e: any) { toast({ title: "Test not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Service reminders" icon={BellRing} actions={<>
        <button type="button" disabled={!!busy} onClick={preview} className={btnCls}>{busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}<span className="hidden sm:inline">Due today</span></button>
        <button type="button" disabled={!!busy} onClick={save} className={btnPrimaryCls}>{busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
      </>} />

      <Panel title="Sending">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />Send reminders automatically</label>
          <Field label="Send by"><select className="fi" value={cfg.channel} onChange={(e) => setCfg({ ...cfg, channel: e.target.value as any })}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></Field>
          <Field label="Language"><select className="fi" value={cfg.lang} onChange={(e) => setCfg({ ...cfg, lang: e.target.value as any })}><option value="en">English</option><option value="sw">Swahili</option></select></Field>
          <Field label="Not before (hour)"><input className="fi" inputMode="numeric" value={cfg.send_hour} onChange={(e) => setCfg({ ...cfg, send_hour: Math.min(20, Math.max(6, Number(e.target.value) || 9)) })} /></Field>
          <Field label="Service by km: remind this many km before"><input className="fi" inputMode="numeric" value={cfg.lead_km} onChange={(e) => setCfg({ ...cfg, lead_km: Number(e.target.value) || 0 })} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">One message per due item, checked every 15 minutes. Customers who said no to reminders at check-in get none; "we miss you" messages go only to customers who agreed to offers. The SMS events (Booking reminders, Restock and visit reminders, Marketing journeys) in System → SMS must be on.</p>
      </Panel>

      <Panel title="Messages" actions={<div className="flex items-center gap-2"><select className="fi h-8 w-auto py-0 text-xs" value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="en">English text</option><option value="sw">Swahili text</option></select><input className="fi h-8 w-36 py-0 text-xs" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="07XXXXXXXX (test)" /></div>}>
        <div className="space-y-3">
          {KINDS.map((k) => (
            <div key={k} className="rounded-xl border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={cfg.kinds[k].on} onCheckedChange={(v) => setKind(k, { on: v })} />{KIND_LABEL[k]}</label>
                {k !== "winback" && <label className="flex items-center gap-1 text-xs">{k === "booking" ? "Days before" : "Days before due"}<input className="fi h-8 w-16 py-0" inputMode="numeric" value={cfg.kinds[k].lead_days} onChange={(e) => setKind(k, { lead_days: Number(e.target.value) || 0 })} /></label>}
                {k === "winback" && <label className="flex items-center gap-1 text-xs">Months after the last visit<input className="fi h-8 w-24 py-0" value={cfg.winback_months.join(",")} onChange={(e) => setCfg({ ...cfg, winback_months: e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => n > 0) })} /></label>}
                <button type="button" disabled={!!busy} onClick={() => test(k)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs">{busy === `test-${k}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}Test</button>
              </div>
              <div className="mt-2">
                <SmsTextBox rows={2} value={lang === "sw" ? cfg.kinds[k].text_sw : cfg.kinds[k].text_en} onChange={(v) => setKind(k, lang === "sw" ? { text_sw: v } : { text_en: v })} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {due && (
        <Panel title={`Due now: ${due.length}`} actions={due.length > 0 && <button type="button" disabled={!!busy || !cfg.enabled} onClick={run} className="inline-flex h-8 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy === "run" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Send now</button>} flush>
          {!due.length ? <p className="p-4 text-sm text-muted-foreground">Nothing is due today.</p> : (
            <div className="divide-y divide-border">{due.map((d) => <div key={d.key} className="px-3 py-2 text-sm"><span className="font-medium">{KIND_LABEL[d.kind as ReminderKind]}</span> · <span className="text-muted-foreground">{d.to}</span><p className="text-xs text-muted-foreground">{d.text}</p></div>)}</div>
          )}
          {!cfg.enabled && <p className="px-3 pb-3 text-xs text-warning">Switch "Send reminders automatically" on and save to send.</p>}
        </Panel>
      )}

      <Panel title="Sent lately" flush>
        {!(log as any[]).length ? <p className="p-4 text-sm text-muted-foreground">No reminders sent yet.</p> : (
          <div className="divide-y divide-border">
            {(log as any[]).map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-28 text-xs text-muted-foreground">{when(l.created_at)}</span><span className="font-medium">{KIND_LABEL[l.kind as ReminderKind] || l.kind}</span>
                {l.vehicle?.plate && <PlateTag plate={l.vehicle.plate} />}<span className="text-xs text-muted-foreground">{l.recipient || ""}</span>
                <span className="ml-auto"><StatusPill status={l.status === "sent" ? "completed" : l.status} /></span>
                {l.detail && <span className="w-full text-[11px] text-destructive">{l.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
