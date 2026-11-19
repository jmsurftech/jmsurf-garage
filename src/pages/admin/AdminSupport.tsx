/** Super admin → Support calls: JMSURF's support line (calls from companies, call-back requests), taken with the phone in the corner. */
import { useQuery } from "@tanstack/react-query";
import { Headset, PhoneIncoming, PhoneOutgoing, Phone, Check, ExternalLink, PhoneMissed } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Pill, EmptyState, TableWrap, StatGrid, StatTile } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { callNumber } from "@/components/PhoneDock";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
import { AdminTickets } from "@/components/SupportTickets";
const sb = supabase as any;
const dur = (s?: number | null) => { const n = Math.round(Number(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function AdminSupport() {
  const { data, refetch } = useQuery({
    queryKey: ["support-activity"], refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("support_activity");
      if (error) throw error;
      const phones = [...new Set([...(data.calls || []).map((c: any) => (c.direction === "inbound" ? c.from_number : c.to_number)), ...(data.callbacks || []).map((b: any) => b.phone)].filter(Boolean))];
      const { data: who } = phones.length ? await sb.rpc("support_caller_lookup", { p_phones: phones }) : { data: [] };
      const map = new Map<string, any>(((who || []) as any[]).map((w) => [w.phone, w]));
      return { ...data, who: map } as { line: string | null; calls: any[]; callbacks: any[]; who: Map<string, any> };
    },
  });
  const label = (phone: string) => { const w = data?.who.get(phone); return w?.company ? `${w.company}${w.person ? ` · ${w.person}` : ""}` : w?.person || "Unknown caller"; };
  const open = (data?.callbacks || []).filter((b) => b.status === "open");
  const today = (data?.calls || []).filter((c) => c.started_at?.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const done = async (id: string) => { const { error } = await sb.rpc("support_callback_done", { p_id: id }); if (error) toast.error(error.message); else { toast.success("Marked done"); void refetch(); } };
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="Support" icon={Headset} description="Tickets companies raise from their Help centre, their calls and call-back requests. Take and make calls with the phone in the bottom corner."
        actions={<a href="https://app.jmsurfcallcentre.co.ke/" target="_blank" rel="noopener noreferrer"><Button variant="outline"><ExternalLink /> Open the full call centre</Button></a>} />
      {data && !data.line && <p className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">The support line is not connected yet. In the call centre (your company), go to Settings → Phone line and connect your Africa's Talking number, then add yourself as an agent. Until then companies are offered your support phone and WhatsApp instead.</p>}
      <StatGrid>
        <StatTile label="Support line" value={data?.line || "Not connected"} icon={Phone} />
        <StatTile label="Calls today" value={today.length} icon={PhoneIncoming} tone="info" />
        <StatTile label="Missed today" value={today.filter((c) => ["missed", "voicemail"].includes(c.status)).length} icon={PhoneMissed} tone="danger" />
        <StatTile label="Call backs waiting" value={open.length} icon={PhoneOutgoing} tone={open.length ? "warning" : "muted"} />
      </StatGrid>
      <AdminTickets />
      <Panel title="Call back requests" icon={PhoneOutgoing} flush>
        {!(data?.callbacks || []).length ? <EmptyState icon={PhoneOutgoing} title="No requests" description="When a company presses 'Request a call back' in its Help centre, it shows here." /> : (
          <TableWrap><table className="dt"><thead><tr><th>Who</th><th>Number</th><th className="hidden md:table-cell">Note</th><th>When</th><th /></tr></thead><tbody>
            <PagedRows rows={data!.callbacks} colSpan={5}>{(pageRows) => pageRows.map((b) => (
              <tr key={b.id}>
                <td><b className="text-sm">{b.customer_name || label(b.phone)}</b></td>
                <td className="whitespace-nowrap">{b.phone}</td>
                <td className="hidden max-w-xs truncate text-sm text-muted-foreground md:table-cell" title={b.notes}>{b.notes || "—"}</td>
                <td className="whitespace-nowrap text-xs text-muted-foreground">{when(b.created_at)}</td>
                <td className="whitespace-nowrap text-right">{b.status === "open" ? <><Button size="sm" onClick={() => callNumber(b.phone)}><Phone /> Call</Button><Button size="sm" variant="ghost" onClick={() => void done(b.id)}><Check /> Done</Button></> : <Pill tone="success">Done</Pill>}</td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      <Panel title="Recent calls" icon={Headset} flush>
        {!(data?.calls || []).length ? <EmptyState icon={Headset} title="No calls yet" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Caller</th><th>Number</th><th>Status</th><th className="num">Length</th><th>When</th><th /></tr></thead><tbody>
            <PagedRows rows={data!.calls} colSpan={6}>{(pageRows) => pageRows.map((c) => {
              const num = c.direction === "inbound" ? c.from_number : c.to_number;
              return (
                <tr key={c.id}>
                  <td><span className="flex items-center gap-2">{c.direction === "inbound" ? <PhoneIncoming className="h-4 w-4 text-info" /> : <PhoneOutgoing className="h-4 w-4 text-success" />}<b className="text-sm">{label(num)}</b></span></td>
                  <td className="whitespace-nowrap">{num}</td>
                  <td><Pill tone={c.status === "completed" ? "success" : ["missed", "voicemail"].includes(c.status) ? "danger" : "muted"}>{c.status}</Pill></td>
                  <td className="num">{dur(c.duration_seconds)}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{when(c.started_at)}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => callNumber(num)}><Phone /> Call</Button></td>
                </tr>
              );
            })}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}
