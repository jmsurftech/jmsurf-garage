import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, XCircle, MessageCircle, Plus, CalendarClock, Clock, Repeat, Shapes as BrandIcon, Pencil, Search, Trash2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatGrid, StatTile, EmptyState, Modal, Field, Pill } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick } from "@/components/Bulk";
import { confirmAction } from "@/components/books/confirm";
import { shareOnWhatsApp } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const VIEWS = [["due", "Due now"], ["week", "Next 7 days"], ["upcoming", "Upcoming"], ["sent", "Reminded"], ["done", "Done"], ["all", "All"]] as const;
export const REMINDER_KINDS = [["repurchase", "Restock / repurchase"], ["visit", "Return visit / service"], ["custom", "Other reminder"]] as const;
const kindLabel = (k: string) => REMINDER_KINDS.find(([v]) => v === k)?.[1] || k;
const UNITS = [["day", "day(s)"], ["week", "week(s)"], ["month", "month(s)"], ["year", "year(s)"]] as const;
const repeatText = (r: any) => (r.repeat_every ? `Every ${r.repeat_every} ${UNITS.find(([u]) => u === r.repeat_unit)?.[1].replace("(s)", Number(r.repeat_every) === 1 ? "" : "s") || r.repeat_unit}${r.repeat_until ? ` until ${fmtDate(r.repeat_until)}` : ""}` : "");

export default function Reminders() {
  const tenantId = useTenantId();
  const { data: biz } = useBusinessSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<string>("due");
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null | undefined>(undefined);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["reminders", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("customer_reminders").select("*, customers(id, name, phone), customer_pets(id, name, species)")
      .eq("tenant_id", tenantId).order("due_date").limit(5000)).data || [],
  });
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const list = useMemo(() => (rows as any[]).filter((r) => {
    if (kind !== "all" && r.kind !== kind) return false;
    const s = q.trim().toLowerCase();
    if (s && !`${r.customers?.name || ""} ${r.customers?.phone || ""} ${r.product_name || ""} ${r.title || ""} ${r.customer_pets?.name || ""}`.toLowerCase().includes(s)) return false;
    if (view === "all") return true;
    if (view === "done") return r.status === "done" || r.status === "dismissed";
    if (view === "sent") return r.status === "sent";
    if (r.status !== "scheduled") return false;
    if (view === "due") return r.due_date <= today;
    if (view === "week") return r.due_date > today && r.due_date <= in7;
    return r.due_date > in7;
  }), [rows, view, kind, q, today, in7]);
  const paged = usePaged(list, 25);
  const sel = useSelection(paged.rows.map((r: any) => r.id));

  const refresh = () => qc.invalidateQueries({ queryKey: ["reminders"] });
  const setStatus = async (ids: string[], status: string) => {
    const { error } = await sb.from("customer_reminders").update({ status, updated_at: new Date().toISOString() }).in("id", ids);
    if (error) return toast({ title: "Not updated", description: error.message, variant: "destructive" });
    sel.clear(); refresh();
  };
  const removeMany = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} reminder${sel.count === 1 ? "" : "s"}?`, danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("customer_reminders").delete().in("id", sel.ids); sel.clear(); refresh();
  };
  const whatsapp = (r: any) => {
    const shop = biz?.business_name || "JMSURF Garage";
    const pet = r.customer_pets?.name;
    const what = r.kind === "visit" ? `${pet ? `${pet}: ` : "your "}${r.title || "next visit"} on ${fmtDate(r.due_date)}` : r.kind === "custom" ? (r.title || "your reminder") : `it's time for ${r.product_name || "your next purchase"}${pet ? ` for ${pet}` : ""}`;
    shareOnWhatsApp(r.customers?.phone, `Hello ${r.customers?.name || ""}, a friendly reminder from ${shop}: ${what}. Reply or visit us. Thank you!`);
    void sb.from("customer_reminders").update({ status: "sent", notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", r.id).then(refresh);
  };

  if (isLoading) return <OrbLoader label="Loading reminders…" />;
  const count = (v: string) => (rows as any[]).filter((r) => r.status === "scheduled" && (v === "due" ? r.due_date <= today : r.due_date > today && r.due_date <= in7)).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Reminders" icon={Bell}
        description="Restock, return-visit and other reminders. Customers get an SMS and email automatically."
        actions={<Button onClick={() => setEditing(null)}><Plus /> New reminder</Button>} />
      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Due now" value={String(count("due"))} icon={Bell} tone={count("due") ? "danger" : "muted"} hint="Today or earlier" />
        <StatTile label="Next 7 days" value={String(count("week"))} icon={CalendarClock} tone="info" />
        <StatTile label="Visits booked" value={String((rows as any[]).filter((r) => r.status === "scheduled" && r.kind === "visit").length)} icon={BrandIcon} tone="success" />
        <StatTile label="Recurring" value={String((rows as any[]).filter((r) => r.status === "scheduled" && r.repeat_every).length)} icon={Repeat} tone="muted" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
        <span className="flex-1" />
        <select className="fi w-48" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option>{REMINDER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="fi pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, item…" />
        </div>
      </div>
      {list.length === 0 ? <EmptyState icon={Bell} title="Nothing here" description="Give an item a repurchase interval (Products › Online Shop) or add a reminder here." /> : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <BulkBar sel={sel} noun="reminder">
            <Button size="sm" variant="outline" onClick={() => setStatus(sel.ids, "done")}><CheckCircle2 /> Done</Button>
            <Button size="sm" variant="outline" onClick={() => setStatus(sel.ids, "scheduled")}><Clock /> Re-schedule</Button>
            <Button size="sm" variant="outline" onClick={() => setStatus(sel.ids, "dismissed")}><XCircle /> Dismiss</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={removeMany}><Trash2 /> Delete</Button>
          </BulkBar>
          <div className="overflow-x-auto">
            <table className="dt min-w-[860px]">
              <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Due</th><th>Customer</th><th>Type</th><th>For</th><th>For</th><th>Status</th><th /></tr></thead>
              <tbody>{(paged.rows as any[]).map((r: any) => (
                <tr key={r.id} className={cn(sel.has(r.id) && "bg-primary/5")}>
                  <td data-label=""><Tick on={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></td>
                  <td data-label="Due" className={cn(r.status === "scheduled" && r.due_date <= today && "font-semibold text-destructive")}>{fmtDate(r.due_date)}{r.repeat_every ? <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground"><Repeat className="h-3 w-3" />{repeatText(r)}</span> : null}</td>
                  <td data-label="Customer">{r.customers ? <Link to={`/customers/${r.customers.id}`} className="font-semibold text-primary">{r.customers.name}</Link> : "—"}<p className="text-xs text-muted-foreground">{r.customers?.phone}</p></td>
                  <td data-label="Type"><Pill tone={r.kind === "visit" ? "success" : r.kind === "custom" ? "info" : "warning"}>{kindLabel(r.kind)}</Pill></td>
                  <td data-label="For">{r.title || r.product_name}{r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}</td>
                  <td data-label="For">{r.customer_pets ? `${r.customer_pets.name}${r.customer_pets.species ? ` (${r.customer_pets.species})` : ""}` : "—"}</td>
                  <td data-label="Status" className="capitalize">{r.status}{r.notified_at ? <span className="block text-xs text-muted-foreground">reminded {fmtDate(r.notified_at)}</span> : null}</td>
                  <td><div className="flex justify-end gap-1">
                    <button className="icon-btn" title="Edit" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                    <button className="icon-btn" title="Send on WhatsApp" onClick={() => whatsapp(r)}><MessageCircle className="h-4 w-4" /></button>
                    {r.status !== "done" && <button className="icon-btn" title="Done" onClick={() => setStatus([r.id], "done")}><CheckCircle2 className="h-4 w-4" /></button>}
                    {r.status !== "dismissed" && <button className="icon-btn-danger" title="Dismiss" onClick={() => setStatus([r.id], "dismissed")}><XCircle className="h-4 w-4" /></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pager {...paged.pager} />
        </div>
      )}
      {editing !== undefined && <ReminderForm reminder={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); refresh(); }} />}
    </div>
  );
}

/** Create or edit a reminder. Pass `preset` to book e.g. a pet's return visit from the customer page. */
export function ReminderForm({ reminder, preset, onClose, onSaved }: { reminder?: any; preset?: { customer?: PickedCustomer; pet_id?: string; kind?: string; title?: string }; onClose: () => void; onSaved: () => void }) {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const r = reminder || {};
  const [cust, setCust] = useState<PickedCustomer | null>(r.customers ? { id: r.customers.id, name: r.customers.name, phone: r.customers.phone } as any : preset?.customer || null);
  const [f, setF] = useState({
    kind: r.kind || preset?.kind || "visit", pet_id: r.pet_id || preset?.pet_id || "", title: r.title || r.product_name || preset?.title || "",
    due_date: r.due_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), note: r.note || "",
    repeat: !!r.repeat_every, repeat_every: String(r.repeat_every || 1), repeat_unit: r.repeat_unit || "month", repeat_until: r.repeat_until || "",
    sms: r.channels?.sms !== false, email: r.channels?.email !== false,
  });
  const { data: pets = [] } = useQuery({
    queryKey: ["cust-pets", cust?.id], enabled: !!cust?.id,
    queryFn: async () => (await sb.from("customer_pets").select("id,name,species").eq("customer_id", cust!.id).order("name")).data || [],
  });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const quick = (days: number) => set("due_date", new Date(Date.now() + days * 86400000).toISOString().slice(0, 10));
  const save = async () => {
    if (!cust || !f.title.trim()) return toast({ title: "Choose the customer and what the reminder is for", variant: "destructive" });
    const body: Record<string, unknown> = {
      tenant_id: tenantId, customer_id: cust.id, pet_id: f.pet_id || null, kind: f.kind, title: f.title.trim(), product_name: f.kind === "repurchase" ? f.title.trim() : r.product_name || null,
      due_date: f.due_date, note: f.note.trim() || null, channels: { sms: f.sms, email: f.email },
      repeat_every: f.repeat ? Math.max(1, Number(f.repeat_every) || 1) : null, repeat_unit: f.repeat ? f.repeat_unit : null, repeat_until: f.repeat && f.repeat_until ? f.repeat_until : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = r.id ? await sb.from("customer_reminders").update(body).eq("id", r.id)
      : await sb.from("customer_reminders").insert({ ...body, status: "scheduled", created_by: user?.id });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    if (f.kind === "visit" && f.pet_id) await sb.from("customer_pets").update({ next_visit: f.due_date }).eq("id", f.pet_id);
    toast({ title: r.id ? "Reminder updated" : f.kind === "visit" ? `Return visit booked for ${fmtDate(f.due_date)}` : "Reminder saved" });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title={r.id ? "Edit reminder" : f.kind === "visit" ? "Book a return visit" : "New reminder"} icon={f.kind === "visit" ? BrandIcon : Bell}
      description="The customer is reminded by SMS and email (as chosen) before it's due; staff see it in their bell."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}><Save /> Save</Button></>}>
      <div className="space-y-3">
        <Field label="Type">
          <div className="grid grid-cols-3 gap-2">{REMINDER_KINDS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => set("kind", v)} className={cn("rounded-xl border px-2 py-2 text-xs font-semibold", f.kind === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}>{l}</button>
          ))}</div>
        </Field>
        <Field label="Customer" required><CustomerPicker value={cust} onChange={(c) => { setCust(c); set("pet_id", ""); }} /></Field>
        {cust && (pets as any[]).length > 0 && (
          <Field label="For" hint={(pets as any[]).length ? undefined : "Nothing to link yet."}>
            <select className="fi" value={f.pet_id} onChange={(e) => set("pet_id", e.target.value)}><option value="">{(pets as any[]).length ? "Not for a particular pet" : "No pets on record"}</option>{(pets as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}{p.species ? ` (${p.species})` : ""}</option>)}</select>
          </Field>
        )}
        <Field label={f.kind === "visit" ? "Visit for" : f.kind === "repurchase" ? "Item to restock" : "Remind about"} required>
          <input className="fi" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={f.kind === "visit" ? "e.g. Service, follow-up, check-up" : f.kind === "repurchase" ? "e.g. Printer toner" : "e.g. Renew contract"} />
        </Field>
        <Field label={f.kind === "visit" ? "Come back on" : "Due date"} required>
          <input className="fi" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5">{[[7, "1 week"], [14, "2 weeks"], [30, "1 month"], [90, "3 months"], [180, "6 months"], [365, "1 year"]].map(([d, l]) => (
            <button key={d} type="button" onClick={() => quick(Number(d))} className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">{l}</button>
          ))}</div>
        </Field>
        <div className="rounded-xl border border-border p-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium"><span className="flex items-center gap-2"><Repeat className="h-4 w-4 text-primary" /> Repeat this reminder</span><Switch checked={f.repeat} onCheckedChange={(v) => set("repeat", v)} /></label>
          {f.repeat && (
            <div className="mt-3 grid grid-cols-[auto_90px_1fr] items-center gap-2 text-sm">
              <span>Every</span>
              <input className="fi" type="number" min={1} value={f.repeat_every} onChange={(e) => set("repeat_every", e.target.value)} />
              <select className="fi" value={f.repeat_unit} onChange={(e) => set("repeat_unit", e.target.value)}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
              <span>Until</span>
              <input className="fi col-span-2" type="date" value={f.repeat_until} onChange={(e) => set("repeat_until", e.target.value)} />
              <span className="col-span-3 text-xs text-muted-foreground">Leave "until" empty to keep repeating. After each reminder goes out, the next one is booked automatically.</span>
            </div>
          )}
        </div>
        <Field label="Send to the customer by">
          <div className="flex gap-5 pt-1 text-sm">
            <label className="flex items-center gap-2"><Switch checked={f.sms} onCheckedChange={(v) => set("sms", v)} /> SMS</label>
            <label className="flex items-center gap-2"><Switch checked={f.email} onCheckedChange={(v) => set("email", v)} /> Email</label>
          </div>
        </Field>
        <Field label="Note"><textarea className="fi min-h-[70px]" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Shown to staff and added to the message" /></Field>
      </div>
    </Modal>
  );
}
