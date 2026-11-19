import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Headset, ExternalLink, Loader2, PhoneMissed, PhoneCall, Check, Plus, RotateCcw, AlertTriangle, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, EmptyState, Segmented, Pill, Modal, Field, StatGrid, StatTile } from "@/components/kit";
import { toast } from "sonner";
import { garageI, openCallCentre, type ConnectionStatus } from "./api";

type Callback = { id: string; phone: string; customer_id: string | null; customer_name: string | null; source: string; status: "open" | "done"; note: string | null; sms_sent: boolean; called_at: string; done_at: string | null };
const sb = supabase as any;
const when = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pretty = (digits: string) => (digits?.startsWith("254") ? `0${digits.slice(3)}` : `+${digits}`);

/**
 * Garage → Call centre. Opens JMSURF CALL CENTRE (jmsurfcallcentre.co.ke) already signed in, and keeps the
 * missed calls to call back (from the Call Centre, or added by hand).
 */
export default function CallCentrePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [opening, setOpening] = useState(false);
  const [adding, setAdding] = useState(false);
  const status = useQuery({ queryKey: ["garage-connections"], staleTime: 60_000, queryFn: () => garageI<ConnectionStatus>("status") });
  const cc = status.data?.callcentre;
  const list = useQuery({
    queryKey: ["garage-callbacks", tab],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.from("garage_callbacks").select("*").eq("status", tab).order("called_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []) as Callback[];
    },
  });

  const open = async () => {
    setOpening(true);
    const r = await openCallCentre("/");
    setOpening(false);
    if (!r.url) toast.error(r.error || "Could not open the Call Centre");
    else void qc.invalidateQueries({ queryKey: ["garage-connections"] });
  };
  const done = async (id: string, isDone = true) => {
    const r = await garageI("callcentre/callback", { id, done: isDone });
    if (r.ok === false) { toast.error(r.error || "Not saved"); return; }
    void qc.invalidateQueries({ queryKey: ["garage-callbacks"] });
  };

  const rows = list.data || [];
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Call centre" icon={Headset} actions={<>
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Plus className="h-4 w-4" /> Add a callback</button>
        <button type="button" onClick={() => void open()} disabled={opening || !cc?.available} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Open JMSURF CALL CENTRE
        </button>
      </>} />
      {status.data && !cc?.available && (
        <p className="flex items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm"><AlertTriangle className="h-4 w-4" /> The Call Centre link is not switched on for JMSURF Garage yet. Contact JMSURF support.</p>
      )}
      <StatGrid>
        <StatTile label="To call back" value={cc?.open_callbacks ?? "…"} icon={PhoneMissed} tone="warning" />
        <StatTile label="Call Centre" value={cc?.linked ? "Linked" : "Not opened yet"} hint={cc?.linked_at ? `since ${new Date(cc.linked_at).toLocaleDateString("en-KE")}` : undefined} icon={Headset} tone={cc?.linked ? "success" : "muted"} />
        <StatTile label="Missed-call SMS" value={cc?.missed_sms === false ? "Off" : "On"} icon={MessageCircle} tone="info" />
      </StatGrid>
      <Panel title="Missed calls to call back" icon={PhoneMissed} flush actions={<Segmented value={tab} onChange={setTab} options={[{ value: "open", label: "To call" }, { value: "done", label: "Done" }]} />}>
        {list.isLoading ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : rows.length === 0 ? <EmptyState icon={PhoneCall} title={tab === "open" ? "Nobody is waiting for a call back" : "No callbacks done yet"} description="Missed calls from the Call Centre land here with the customer's name." />
          : (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.customer_id ? <Link to={`/customers/${c.customer_id}`} className="font-semibold text-primary hover:underline">{c.customer_name || pretty(c.phone)}</Link> : <b>{pretty(c.phone)}</b>}
                      <Pill tone="muted">{c.source === "callcentre" ? "Call Centre" : c.source === "whatsapp" ? "WhatsApp" : "Added by hand"}</Pill>
                      {c.sms_sent && <Pill tone="info">SMS sent</Pill>}
                    </div>
                    <p className="text-xs text-muted-foreground">{pretty(c.phone)} · {when(c.called_at)}{c.note ? ` · ${c.note}` : ""}</p>
                  </div>
                  <a href={`tel:+${c.phone}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm font-medium hover:bg-muted"><PhoneCall className="h-3.5 w-3.5" /> Call</a>
                  {c.status === "open"
                    ? <button type="button" onClick={() => void done(c.id)} className="inline-flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1 text-sm font-semibold text-success"><Check className="h-3.5 w-3.5" /> Done</button>
                    : <button type="button" onClick={() => void done(c.id, false)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm"><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>}
                </li>
              ))}
            </ul>
          )}
      </Panel>
      <p className="text-xs text-muted-foreground">Phone line, IVR, queues and agents are set up inside JMSURF CALL CENTRE. Missed-call SMS and the screen-pop key are in <Link to="/settings?tab=connections" className="font-medium text-primary hover:underline">System → Connections</Link>.</p>
      <AddCallback open={adding} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ["garage-callbacks"] }); }} />
    </div>
  );
}

function AddCallback({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const r = await garageI("callcentre/callback", { phone, note });
    setBusy(false);
    if (r.ok === false) { toast.error(r.error || "Not saved"); return; }
    setPhone(""); setNote("");
    onAdded();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a callback" size="md"
      footer={<button type="button" disabled={!phone.trim() || busy} onClick={() => void add()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : "Add"}</button>}>
      <div className="space-y-3">
        <Field label="Phone number"><input className="fi" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter the number to call back" /></Field>
        <Field label="Note"><input className="fi" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Enter what the call is about (optional)" /></Field>
      </div>
    </Modal>
  );
}
