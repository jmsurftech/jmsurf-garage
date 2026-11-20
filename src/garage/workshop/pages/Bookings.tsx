import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Link2, Send, Loader2, QrCode } from "lucide-react";
import { PageHeader, Panel, Segmented, Modal, Field, StatusPill, MoreMenu, btnPrimaryCls } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { useTenant } from "@/hooks/useTenant";
import { cn } from "@/lib/utils";
import { sb, must, wsApi } from "../lib/api";
import { useBays, useBookings, useGarageSettings, useMechanics, useRefresh, useLiveWorkshop } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { normalisePlate } from "../lib/plate";
import { publicUrl } from "../lib/nav";
import { PlateTag, when } from "../components/bits";

const SOURCES: [string, string][] = [["phone", "Phone call"], ["whatsapp", "WhatsApp"], ["walk_in", "Walk-in"], ["online", "Online"], ["staff", "Staff"]];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function BookingForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial: any; onSaved: () => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: bays = [] } = useBays();
  const { data: settings } = useGarageSettings();
  const mech = useMechanics();
  const [f, setF] = useState<any>(initial);
  const [confirm, setConfirm] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(initial); }, [initial]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  // Fill name and phone from a known plate.
  useEffect(() => {
    const p = normalisePlate(f?.plate);
    if (!tenantId || p.length < 5 || f?.id) return;
    const t = setTimeout(async () => {
      const { data: v } = await sb.from("garage_vehicles").select("id, customer:customers(id,name,phone)").eq("tenant_id", tenantId).eq("plate", p).maybeSingle();
      if (v) setF((x: any) => ({ ...x, vehicle_id: v.id, customer_id: v.customer?.id || x.customer_id, name: x.name || v.customer?.name || "", phone: x.phone || v.customer?.phone || "" }));
    }, 300);
    return () => clearTimeout(t);
  }, [f?.plate, tenantId, f?.id]);

  if (!f) return null;
  const save = async () => {
    if (!f.date || !f.time) return toast({ title: "Choose the date and time", variant: "destructive" });
    if (!normalisePlate(f.plate) && !f.name) return toast({ title: "Enter the number plate or the customer's name", variant: "destructive" });
    setSaving(true);
    try {
      const start = new Date(`${f.date}T${f.time}`);
      const mins = Number(f.minutes) || Number(settings?.slot_minutes) || 60;
      const row = {
        tenant_id: tenantId, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + mins * 60000).toISOString(), plate: f.plate || null, name: f.name || null, phone: f.phone || null,
        service: f.service || null, notes: f.notes || null, bay_id: f.bay_id || null, mechanic_id: f.mechanic_id || null, source: f.source || "phone", status: f.status || "confirmed",
        vehicle_id: f.vehicle_id || null, customer_id: f.customer_id || null,
      };
      const saved = must(f.id ? await sb.from("garage_bookings").update(row).eq("id", f.id).select("*").single() : await sb.from("garage_bookings").insert(row).select("*").single()) as any;
      if (confirm && saved.phone && saved.status === "confirmed") await wsApi("booking-confirm", { booking_id: saved.id }).catch((e) => toast({ title: "Confirmation not sent", description: e.message, variant: "destructive" }));
      toast({ title: f.id ? "Booking updated" : `Booked ${saved.booking_no}` });
      onSaved(); onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={f.id ? `Booking ${f.booking_no}` : "New booking"} icon={CalendarDays}
      footer={<><button type="button" onClick={onClose} className="h-9 rounded-xl border border-border px-3 text-sm">Close</button>
        <button type="button" disabled={saving} onClick={save} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className="fi" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Time"><input type="time" className="fi" value={f.time} onChange={(e) => set("time", e.target.value)} /></Field>
        <Field label="Number plate"><input className="fi font-mono uppercase" value={f.plate || ""} onChange={(e) => set("plate", e.target.value)} placeholder="Enter number plate" /></Field>
        <Field label="Minutes"><input className="fi" inputMode="numeric" value={f.minutes || ""} onChange={(e) => set("minutes", e.target.value)} placeholder={String(settings?.slot_minutes || 60)} /></Field>
        <Field label="Customer name"><input className="fi" value={f.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Enter customer name" /></Field>
        <Field label="Phone"><input className="fi" inputMode="tel" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="07XXXXXXXX" /></Field>
        <Field label="Service" className="col-span-2"><input className="fi" value={f.service || ""} onChange={(e) => set("service", e.target.value)} placeholder="Enter the service or problem" list="gw-services" />
          <datalist id="gw-services">{(settings?.booking_services || []).map((s: string) => <option key={s} value={s} />)}</datalist></Field>
        <Field label="Bay"><select className="fi" value={f.bay_id || ""} onChange={(e) => set("bay_id", e.target.value)}><option value="">Any</option>{(bays as any[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Mechanic"><select className="fi" value={f.mechanic_id || ""} onChange={(e) => set("mechanic_id", e.target.value)}><option value="">Any</option>{mech.list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Came by"><select className="fi" value={f.source || "phone"} onChange={(e) => set("source", e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Status"><select className="fi" value={f.status || "confirmed"} onChange={(e) => set("status", e.target.value)}><option value="pending">Waiting to confirm</option><option value="confirmed">Confirmed</option><option value="arrived">Arrived</option><option value="no_show">Did not come</option><option value="cancelled">Cancelled</option></select></Field>
        <Field label="Notes" className="col-span-2"><textarea className="fi" rows={2} value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Enter notes (optional)" /></Field>
      </div>
      <label className="mt-3 inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Send the customer an SMS confirmation (a reminder goes the day before when reminders are on)</label>
    </Modal>
  );
}

/** Booking calendar by bay or mechanic, with the online booking link and QR code. */
export default function Bookings() {
  useLiveWorkshop();
  const { toast } = useToast();
  const { go } = useWorkshopLinks();
  const refresh = useRefresh();
  const { tenant } = useTenant() as any;
  const { data: settings } = useGarageSettings();
  const { data: bays = [] } = useBays();
  const mech = useMechanics();
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [by, setBy] = useState<"bay" | "mechanic" | "list">("bay");
  const [edit, setEdit] = useState<any | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const from = day.toISOString();
  const to = new Date(day.getTime() + (by === "list" ? 7 : 1) * 86_400_000).toISOString();
  const { data: bookings = [] } = useBookings(from, to);
  const open = Number(settings?.open_hour ?? 8), close = Number(settings?.close_hour ?? 17);
  const hours = Array.from({ length: Math.max(1, close - open) }, (_, i) => open + i);
  const cols = by === "bay" ? [...(bays as any[]).filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })), { id: "", name: "No bay" }]
    : [...mech.list.map((m) => ({ id: m.id, name: m.name })), { id: "", name: "Anyone" }];
  const link = tenant?.slug ? publicUrl(`/book/${tenant.slug}`) : "";
  const shown = useMemo(() => (bookings as any[]).filter((b) => b.status !== "cancelled"), [bookings]);

  const newAt = (hour?: number, colId?: string) => setEdit({ date: ymd(day), time: `${String(hour ?? open).padStart(2, "0")}:00`, source: "phone", status: "confirmed", ...(by === "bay" ? { bay_id: colId || "" } : by === "mechanic" ? { mechanic_id: colId || "" } : {}) });
  const openEdit = (b: any) => { const d = new Date(b.starts_at); setEdit({ ...b, date: ymd(d), time: d.toTimeString().slice(0, 5), minutes: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000) }); };
  const showQr = async () => { if (!link) return; setQr(await QRCode.toDataURL(link, { margin: 1, width: 260 })); };

  return (
    <div className="space-y-3">
      <PageHeader title="Bookings" icon={CalendarDays} actions={<>
        <MoreMenu items={[
          { label: "Copy booking link", icon: Link2, hidden: !(settings?.booking_enabled && link), onSelect: () => { void navigator.clipboard?.writeText(link || ""); toast({ title: "Booking link copied" }); } },
          { label: "Booking QR code", icon: QrCode, hidden: !(settings?.booking_enabled && link), onSelect: () => void showQr() },
        ]} />
        <button type="button" onClick={() => newAt()} className={btnPrimaryCls}><Plus className="h-4 w-4" />New booking</button>
      </>} />
      {!settings?.booking_enabled && <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">Online booking is off. Switch it on in <button type="button" className="font-semibold text-primary" onClick={() => go("/garage/settings")}>Workshop settings</button> to get a booking link and QR code for your customers.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDay(new Date(day.getTime() - 86_400_000))} className="rounded-lg border border-border p-1.5" aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" className="fi w-auto" value={ymd(day)} onChange={(e) => { if (e.target.value) { const d = new Date(`${e.target.value}T00:00`); setDay(d); } }} />
        <button type="button" onClick={() => setDay(new Date(day.getTime() + 86_400_000))} className="rounded-lg border border-border p-1.5" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setDay(d); }} className="h-8 rounded-lg border border-border px-2 text-xs">Today</button>
        <Segmented value={by} onChange={(v) => setBy(v as typeof by)} options={[{ value: "bay", label: "By bay" }, { value: "mechanic", label: "By mechanic" }, { value: "list", label: "Next 7 days" }]} />
      </div>

      {by === "list" ? (
        <Panel flush>
          <div className="divide-y divide-border">
            {!shown.length && <p className="p-6 text-center text-sm text-muted-foreground">No bookings in the next 7 days.</p>}
            {shown.map((b) => (
              <button key={b.id} type="button" onClick={() => openEdit(b)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40">
                <span className="w-32 text-xs text-muted-foreground">{when(b.starts_at)}</span><PlateTag plate={b.plate} />
                <span className="flex-1 truncate">{b.name || ""}{b.service ? ` · ${b.service}` : ""}</span>
                <span className="text-xs text-muted-foreground">{SOURCES.find((s) => s[0] === b.source)?.[1]}</span><StatusPill status={b.status} />
              </button>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead><tr><th className="sticky left-0 w-14 bg-card p-1.5 text-left font-medium text-muted-foreground" />{cols.map((c) => <th key={c.id || "none"} className="border-l border-border p-1.5 text-left font-semibold">{c.name}</th>)}</tr></thead>
              <tbody>
                {hours.map((h) => (
                  <tr key={h} className="border-t border-border">
                    <td className="sticky left-0 bg-card p-1.5 align-top tabular-nums text-muted-foreground">{String(h).padStart(2, "0")}:00</td>
                    {cols.map((c) => {
                      const here = shown.filter((b) => new Date(b.starts_at).getHours() === h && ((by === "bay" ? b.bay_id : b.mechanic_id) || "") === c.id);
                      return (
                        <td key={c.id || "none"} className="h-14 border-l border-border p-1 align-top hover:bg-muted/30" onClick={() => !here.length && newAt(h, c.id)}>
                          {here.map((b) => (
                            <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); openEdit(b); }}
                              className={cn("mb-1 block w-full rounded-lg border px-1.5 py-1 text-left", b.status === "pending" ? "border-warning/50 bg-warning/10" : b.status === "arrived" ? "border-success/40 bg-success/10" : "border-primary/30 bg-primary/10")}>
                              <span className="font-mono font-semibold">{b.plate || "—"}</span> <span className="text-muted-foreground">{new Date(b.starts_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="block truncate">{b.name || ""}{b.service ? ` · ${b.service}` : ""}</span>
                            </button>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {edit && (
        <BookingForm open={!!edit} initial={edit} onClose={() => setEdit(null)} onSaved={refresh} />
      )}
      {edit?.id && ["pending", "confirmed"].includes(edit.status) && (
        <div className="fixed bottom-4 left-4 z-[95] flex gap-2">
          <button type="button" onClick={() => go(`/garage/jobs/new?booking=${edit.id}`)} className="inline-flex h-9 items-center gap-1 rounded-xl bg-success px-3 text-sm font-semibold text-white shadow-lg">Check in now</button>
          {edit.phone && <button type="button" onClick={async () => { try { await wsApi("booking-confirm", { booking_id: edit.id }); toast({ title: "Confirmation sent" }); } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); } }} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-sm shadow-lg"><Send className="h-4 w-4" />Send confirmation</button>}
        </div>
      )}
      <Modal open={!!qr} onClose={() => setQr(null)} title="Online booking QR code" center size="sm">
        {qr && <div className="space-y-2 text-center"><img src={qr} alt="Booking QR code" className="mx-auto rounded-xl bg-white p-2" /><p className="break-all text-xs text-muted-foreground">{link}</p><a href={qr} download="booking-qr.png" className="inline-flex h-9 items-center rounded-xl border border-border px-3 text-sm">Download</a></div>}
      </Modal>
    </div>
  );
}
