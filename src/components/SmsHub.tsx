/**
 * System → SMS: what uses SMS (per event: SMS / WhatsApp), the low-balance
 * warning, top-up history and the usage log with cost per message.
 * The server (messaging.js) applies the choices to every message it sends.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Smartphone, MessageCircle, Save, History, Receipt, BellRing, Lock, ScrollText, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, Pill, TableWrap, EmptyState, Segmented, StatTile, StatGrid } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { PagedRows } from "@/components/Pager";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { messagingApi, useMessagingSettings, smsReady, whatsappReady } from "@/lib/messaging";
import { SMS_USE_EVENTS, SMS_USE_LABELS, DEFAULT_LOW_BALANCE, channelsFor, type SmsUses, type MsgChannel } from "@/lib/smsUses";
import { useJmsurfSmsBalance } from "@/components/JmsurfSmsWallet";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const sb = supabase as any;

type LogRow = { id: string; created_at: string; channel: string; recipient: string; subject: string; status: string; smtp_host?: string; smtp_response?: string; cost_kes?: number | null; parts?: number | null; event?: string | null };
type TopupRow = { topup_id: string; amount_kes: number; phone?: string; status: string; sms_estimate?: number | null; created_at: string };
type Overview = { ok: boolean; error?: string; log: LogRow[]; topups: TopupRow[]; month: { messages: number; parts: number; cost_kes: number } };

export function useSmsOverview(enabled = true) {
  return useQuery({
    queryKey: ["sms-overview"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => (await messagingApi("sms-overview", {})) as Overview,
  });
}

export function useSmsUses() {
  const { settings, save, isLoading } = useErpSettings();
  return { uses: (settings.sms_uses || {}) as SmsUses, save: (v: SmsUses) => save("sms_uses", v), isLoading };
}

const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ───────────────────────────── This month ───────────────────────────── */

export function SmsMonthTiles({ hasJmsurf }: { hasJmsurf: boolean }) {
  const { data } = useSmsOverview();
  const { data: bal } = useJmsurfSmsBalance(hasJmsurf);
  const m = data?.month;
  return (
    <StatGrid>
      <StatTile label="SMS sent this month" value={m ? m.messages.toLocaleString() : "…"} hint={m ? `${m.parts.toLocaleString()} SMS parts` : undefined} icon={Smartphone} />
      <StatTile label="Spent this month" value={m ? formatKES(m.cost_kes) : "…"} icon={Receipt} tone="info" />
      <StatTile label="Cost per SMS" value={bal?.ok && bal.rate_kes_per_sms ? `KES ${Number(bal.rate_kes_per_sms).toFixed(2)}` : "—"} hint="Per 160-character part" icon={ListChecks} tone="muted" />
      <StatTile label="Top-ups" value={data ? data.topups.filter((t) => t.status === "completed").length.toLocaleString() : "…"} hint="From JMSURF Garage" icon={History} tone="success" />
    </StatGrid>
  );
}

/* ───────────────────────────── What uses SMS ───────────────────────────── */

function ChannelBox({ on, onClick, label, icon: Icon, disabled, canManage }: { on: boolean; onClick: () => void; label: string; icon: any; disabled?: boolean; canManage: boolean }) {
  return (
    <button type="button" disabled={disabled || !canManage} onClick={onClick} aria-pressed={on} aria-label={label}
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground/50 hover:border-primary/50")}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function SmsUsesPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { uses, save, isLoading } = useSmsUses();
  const { data: m } = useMessagingSettings();
  const [u, setU] = useState<SmsUses>({});
  const [receipt, setReceipt] = useState({ sms: false, whatsapp: false });
  const [sender, setSender] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setU(uses); setDirty(false); }, [uses]);
  useEffect(() => {
    if (!m) return;
    setReceipt({ sms: !!m.auto_receipt_sms, whatsapp: !!m.auto_receipt_whatsapp });
    setSender(m.sms_sender_id || "");
  }, [m]);
  const groups = useMemo(() => ["Customers", "Staff", "Other"] as const, []);
  const waOk = whatsappReady(m);
  const smsOk = smsReady(m);

  const flip = (key: string, c: MsgChannel) => {
    const e = SMS_USE_EVENTS.find((x) => x.key === key)!;
    const cur = channelsFor(u, e);
    setU({ ...u, events: { ...(u.events || {}), [key]: { ...cur, [c]: !cur[c] } } });
    setDirty(true);
  };
  const column = (c: MsgChannel, v: boolean) => {
    const events = { ...(u.events || {}) };
    SMS_USE_EVENTS.filter((e) => !e.locked).forEach((e) => { events[e.key] = { ...channelsFor(u, e), [c]: v }; });
    setU({ ...u, events });
    setReceipt((r) => ({ ...r, [c]: v }));
    setDirty(true);
  };

  const submit = async () => {
    setBusy(true);
    const [a, b] = await Promise.all([
      save(u),
      sb.rpc("save_sms_hub", { p_sender_id: sender, p_auto_receipt_sms: receipt.sms, p_auto_receipt_whatsapp: receipt.whatsapp }),
    ]);
    setBusy(false);
    const err = a?.error || b?.error;
    if (err) return toast.error(err.message);
    ["messaging-settings", "messaging-settings-mode"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setDirty(false);
    toast.success("Saved. New messages follow these choices within a minute.");
  };

  if (isLoading) return null;
  const header = (c: MsgChannel, label: string, Icon: any, ready: boolean) => (
    <th className="w-20 text-center sm:w-24">
      <span className="inline-flex flex-col items-center gap-1"><Icon className="h-4 w-4 text-primary" />{label}
        {!ready && <span className="text-[10px] font-normal normal-case text-warning">not set up</span>}
        {canManage && <span className="flex gap-1 text-[10px] font-normal normal-case"><button type="button" className="hover:underline" onClick={() => column(c, true)}>all</button>·<button type="button" className="hover:underline" onClick={() => column(c, false)}>none</button></span>}
      </span>
    </th>
  );

  return (
    <div className="space-y-5">
      <Panel title="What uses SMS" icon={ListChecks} flush
        description="Tick how each message may go out. With both, SMS goes first.">
        <TableWrap>
          <table className="dt w-full">
            <thead>
              <tr>
                <th>Message</th>
                {header("sms", "SMS", Smartphone, smsOk)}
                {header("whatsapp", "WhatsApp", MessageCircle, waOk)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="bg-muted/40"><td colSpan={3} className="py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g}</td></tr>
                  {g === "Customers" && (
                    <tr>
                      <td><span className="block text-sm font-medium">Sale receipts</span><span className="block text-xs text-muted-foreground">Automatic after each sale, when the customer has a phone number</span></td>
                      <td className="text-center"><ChannelBox canManage={canManage}on={receipt.sms} label="SMS: Sale receipts" icon={Smartphone} onClick={() => { setReceipt({ ...receipt, sms: !receipt.sms }); setDirty(true); }} /></td>
                      <td className="text-center"><ChannelBox canManage={canManage}on={receipt.whatsapp} label="WhatsApp: Sale receipts" icon={MessageCircle} onClick={() => { setReceipt({ ...receipt, whatsapp: !receipt.whatsapp }); setDirty(true); }} /></td>
                    </tr>
                  )}
                  {SMS_USE_EVENTS.filter((e) => e.group === g).map((e) => {
                    const ch = channelsFor(u, e);
                    return (
                      <tr key={e.key}>
                        <td><span className="flex items-center gap-1.5 text-sm font-medium">{e.label}{e.locked && <Lock className="h-3 w-3 text-muted-foreground" />}</span><span className="block text-xs text-muted-foreground">{e.when}</span></td>
                        <td className="text-center"><ChannelBox canManage={canManage}on={ch.sms} disabled={e.locked} label={`SMS: ${e.label}`} icon={Smartphone} onClick={() => flip(e.key, "sms")} /></td>
                        <td className="text-center">{e.key === "bulk" ? <span className="text-xs text-muted-foreground">SMS only</span> : <ChannelBox canManage={canManage}on={ch.whatsapp} disabled={e.locked} label={`WhatsApp: ${e.label}`} icon={MessageCircle} onClick={() => flip(e.key, "whatsapp")} />}</td>
                      </tr>
                    );
                  })}
                  {g === "Staff" && (
                    <tr>
                      <td colSpan={3}>
                        <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span><span className="block font-medium">Approvals, CRM, tasks, meetings and leave</span><span className="block text-xs text-muted-foreground">Bell, email, SMS and WhatsApp for each alert</span></span>
                          <Link to="/settings?tab=notifications" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><BellRing className="h-3.5 w-3.5" /> Set in Notifications</Link>
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Low balance warning" icon={AlertTriangle} description="You get a bell alert (once a day) when the JMSURF SMS balance drops below this.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Warn below (SMS)" hint="0 turns the warning off">
              <input className="fi" type="number" min={0} max={100000} disabled={!canManage} value={u.low_balance ?? DEFAULT_LOW_BALANCE}
                onChange={(e) => { setU({ ...u, low_balance: Math.max(0, Math.round(Number(e.target.value) || 0)) }); setDirty(true); }} />
            </Field>
            <Field label="Also text this number (optional)" hint="Uses one SMS each time">
              <input className="fi" inputMode="tel" placeholder="07XX XXX XXX" disabled={!canManage} value={u.low_balance_phone || ""}
                onChange={(e) => { setU({ ...u, low_balance_phone: e.target.value }); setDirty(true); }} />
            </Field>
          </div>
        </Panel>
        <Panel title="Sender name" icon={Smartphone} description="The name customers see. It must be approved on JMSURF SMS first.">
          <Field label="Sender ID" hint="Up to 11 letters. Leave empty to use the default sender.">
            <input className="fi" maxLength={11} placeholder="MYSHOP" disabled={!canManage} value={sender} onChange={(e) => { setSender(e.target.value.replace(/\s+/g, "").toUpperCase()); setDirty(true); }} />
          </Field>
        </Panel>
      </div>

      {canManage && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <Button onClick={() => void submit()} disabled={!dirty || busy} className="shadow-lg"><Save /> Save</Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Top-up history ───────────────────────────── */

export function SmsTopupHistory() {
  const { data, isLoading } = useSmsOverview();
  const rows = data?.topups || [];
  return (
    <Panel title="Top-up history" icon={History} flush>
      {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : data && !data.ok ? <p className="p-4 text-sm text-destructive">{data.error}</p> : !rows.length ? (
        <EmptyState icon={History} title="No top-ups yet" description="Top-ups you make here with M-Pesa show up in this list." />
      ) : (
        <TableWrap><table className="dt w-full"><thead><tr><th>When</th><th className="text-right">Amount</th><th className="hidden sm:table-cell">Paid from</th><th className="hidden sm:table-cell text-right">About</th><th>Status</th></tr></thead><tbody>
          <PagedRows rows={rows} colSpan={5}>{(page) => page.map((t) => (
            <tr key={t.topup_id}>
              <td className="whitespace-nowrap text-xs text-muted-foreground">{when(t.created_at)}</td>
              <td className="text-right font-medium tabular-nums">{formatKES(Number(t.amount_kes))}</td>
              <td className="hidden text-sm sm:table-cell">{t.phone || "—"}</td>
              <td className="hidden text-right text-sm tabular-nums sm:table-cell">{t.sms_estimate ? `${Number(t.sms_estimate).toLocaleString()} SMS` : "—"}</td>
              <td><Pill tone={t.status === "completed" ? "success" : t.status === "pending" ? "info" : "danger"}>{t.status === "completed" ? "Paid" : t.status === "pending" ? "Waiting" : "Not paid"}</Pill></td>
            </tr>
          ))}</PagedRows>
        </tbody></table></TableWrap>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Usage log ───────────────────────────── */

export function SmsUsageLog() {
  const { data, isLoading } = useSmsOverview();
  const [filter, setFilter] = useState<"all" | "sms" | "whatsapp" | "failed">("all");
  const all = data?.log || [];
  const rows = all.filter((r) => filter === "all" || (filter === "failed" ? r.status !== "sent" : r.channel === filter));
  return (
    <Panel title="Usage log" icon={ScrollText} flush description="The last 200 SMS and WhatsApp messages: what was sent, to whom and what it cost."
      actions={<Segmented value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
        { value: "all", label: "All", count: all.length },
        { value: "sms", label: "SMS" },
        { value: "whatsapp", label: "WhatsApp" },
        { value: "failed", label: "Failed", count: all.filter((r) => r.status !== "sent").length },
      ]} />}>
      {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : data && !data.ok ? <p className="p-4 text-sm text-destructive">{data.error}</p> : !rows.length ? (
        <EmptyState icon={ScrollText} title="Nothing here yet" description="Messages appear here as they go out." />
      ) : (
        <TableWrap><table className="dt w-full"><thead><tr><th>When</th><th>What</th><th>To</th><th className="hidden md:table-cell">Message</th><th className="text-right">Cost</th><th>Status</th></tr></thead><tbody>
          <PagedRows rows={rows} colSpan={6}>{(page) => page.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted-foreground">{when(r.created_at)}</td>
              <td className="text-sm">
                <span className="flex items-center gap-1.5">{r.channel === "whatsapp" ? <MessageCircle className="h-3.5 w-3.5 text-success" /> : <Smartphone className="h-3.5 w-3.5 text-primary" />}{SMS_USE_LABELS[r.event || ""] || (r.event ? r.event : "Message")}</span>
              </td>
              <td className="whitespace-nowrap text-sm tabular-nums">{r.recipient}</td>
              <td className="hidden max-w-[320px] truncate text-xs text-muted-foreground md:table-cell" title={r.subject}>{r.subject}</td>
              <td className="whitespace-nowrap text-right text-sm tabular-nums">{r.cost_kes != null ? formatKES(Number(r.cost_kes)) : "—"}{r.parts && r.parts > 1 ? <span className="block text-[10px] text-muted-foreground">{r.parts} parts</span> : null}</td>
              <td>
                <Pill tone={r.status === "sent" ? "success" : "danger"}>{r.status === "sent" ? "Sent" : "Failed"}</Pill>
                {r.status !== "sent" && r.smtp_response && <span className="mt-0.5 block max-w-[220px] text-[11px] text-muted-foreground">{r.smtp_response}</span>}
              </td>
            </tr>
          ))}</PagedRows>
        </tbody></table></TableWrap>
      )}
    </Panel>
  );
}
