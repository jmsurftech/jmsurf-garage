import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, Mail, MessageSquare, MessageCircle, BellRing, CheckCircle2, XCircle, Settings, Download } from "lucide-react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, StatTile, StatGrid, TableWrap, EmptyState, StatusPill, PageLoader, Pill } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { Button } from "@/components/ui/button";

const sb: any = supabase;
type Tab = "messages" | "reminders";
type Channel = "all" | "email" | "sms" | "whatsapp";

const CHANNEL_ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageCircle };
const ok = (s: string) => ["sent", "delivered", "success", "ok"].includes(String(s || "").toLowerCase());

function ChannelPill({ channel }: { channel: string }) {
  const Icon = CHANNEL_ICON[channel] || Mail;
  const label = channel === "sms" ? "SMS" : channel === "whatsapp" ? "WhatsApp" : "Email";
  return <Pill tone={channel === "whatsapp" ? "success" : channel === "sms" ? "info" : "muted"}><Icon className="h-3 w-3" />{label}</Pill>;
}

/**
 * Everything the platform has sent: shops' SMS/WhatsApp/email messages and
 * the automatic renewal reminders, across every shop, for the last 90 days.
 */
export default function AdminMessages() {
  const [tab, setTab] = useState<Tab>("messages");
  const [channel, setChannel] = useState<Channel>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-messages"],
    queryFn: async () => {
      const since = subDays(new Date(), 90).toISOString();
      const [{ data: logs }, { data: reminders }, { data: tenants }] = await Promise.all([
        allRows(() => sb.from("email_logs").select("id, tenant_id, recipient, subject, status, smtp_response, channel, created_at").gte("created_at", since).order("created_at", { ascending: false })),
        allRows(() => sb.from("subscription_reminders").select("id, tenant_id, stage, channel, recipient, status, detail, period_end, created_at").gte("created_at", since).order("created_at", { ascending: false })),
        allRows(() => sb.from("tenants").select("id, business_name").order("created_at")),
      ]);
      const names: Record<string, string> = {};
      (tenants || []).forEach((t: any) => { names[t.id] = t.business_name; });
      return { logs: (logs || []) as any[], reminders: (reminders || []) as any[], names };
    },
  });

  const names = useMemo(() => data?.names || {}, [data]);
  const source = useMemo(() => (tab === "messages" ? data?.logs : data?.reminders) || [], [tab, data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return source.filter((r: any) => {
      if (channel !== "all" && (r.channel || "email") !== channel) return false;
      if (!q) return true;
      return [r.recipient, r.subject, r.detail, names[r.tenant_id]].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [source, channel, search, names]);

  if (isLoading) return <PageLoader label="Loading messages…" />;

  const all = data?.logs || [];
  const rem = data?.reminders || [];
  const stat = (rows: any[], c?: string) => rows.filter((r) => !c || (r.channel || "email") === c).length;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="Messages" icon={MessagesSquare} description="SMS, WhatsApp and email sent by companies and the platform, last 90 days."
        actions={<>
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => downloadCsv(`dash-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
            ["Sent", "Company", "Channel", "Recipient", tab === "messages" ? "Subject" : "Reminder", "Status", "Detail"],
            filtered.map((r: any) => [format(new Date(r.created_at), "yyyy-MM-dd HH:mm"), names[r.tenant_id] || "Platform", r.channel || "email", r.recipient, tab === "messages" ? r.subject : r.stage, r.status, r.smtp_response || r.detail]))}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button asChild variant="outline" size="sm"><Link to="/admin/settings"><Settings className="h-4 w-4" /> Messaging &amp; reminder settings</Link></Button>
        </>} />

      <StatGrid>
        <StatTile label="SMS" value={stat(all, "sms")} icon={MessageSquare} tone="info" />
        <StatTile label="WhatsApp" value={stat(all, "whatsapp")} icon={MessageCircle} tone="success" />
        <StatTile label="Email" value={stat(all, "email")} icon={Mail} tone="primary" />
        <StatTile label="Renewal reminders" value={rem.length} hint={`${rem.filter((r) => !ok(r.status)).length} not delivered`} icon={BellRing} tone="warning" />
      </StatGrid>

      <Toolbar>
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "messages", label: "Messages", count: all.length },
          { value: "reminders", label: "Renewal reminders", count: rem.length },
        ]} />
        <Segmented<Channel> value={channel} onChange={setChannel} options={[
          { value: "all", label: "All" }, { value: "sms", label: "SMS" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" },
        ]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search recipient, company or text…" />
      </Toolbar>

      <Panel flush>
        {filtered.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="Nothing here" description="No messages match these filters in the last 90 days." />
        ) : tab === "messages" ? (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>When</th><th>Company</th><th>Channel</th><th>To</th><th>Subject / text</th><th>Status</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={6}>
                  {(page) => page.map((r: any) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(r.created_at), "d MMM, HH:mm")}</td>
                      <td>{r.tenant_id ? names[r.tenant_id] || "—" : <span className="text-muted-foreground">Platform</span>}</td>
                      <td><ChannelPill channel={r.channel || "email"} /></td>
                      <td className="whitespace-nowrap">{r.recipient}</td>
                      <td className="max-w-[22rem] truncate" title={r.subject}>{r.subject}</td>
                      <td title={r.smtp_response || undefined}><StatusPill status={r.status} /></td>
                    </tr>
                  ))}
                </PagedRows>
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>When</th><th>Company</th><th>Channel</th><th>To</th><th>Stage</th><th>Result</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={6}>
                  {(page) => page.map((r: any) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(r.created_at), "d MMM, HH:mm")}</td>
                      <td>{names[r.tenant_id] || "—"}</td>
                      <td><ChannelPill channel={r.channel} /></td>
                      <td className="whitespace-nowrap">{r.recipient || "—"}</td>
                      <td className="whitespace-nowrap">{r.stage.startsWith("manual") ? "Sent by hand" : Number(r.stage) < 0 ? `${-Number(r.stage)} day(s) before` : Number(r.stage) === 0 ? "Expiry day" : `${r.stage} day(s) after`}</td>
                      <td title={r.detail || undefined}>
                        {ok(r.status)
                          ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" />Sent</Pill>
                          : <Pill tone="danger"><XCircle className="h-3 w-3" />{r.status}</Pill>}
                      </td>
                    </tr>
                  ))}
                </PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
