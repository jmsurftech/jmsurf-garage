import { PageHeader, Toolbar, SearchBox, Segmented, Panel, TableWrap, EmptyState, StatTile, StatGrid, StatusPill, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { PagedRows } from "@/components/Pager";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Mail, CheckCircle, XCircle, Clock, Search, RefreshCw, Phone, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type ChannelFilter = "all" | "email" | "sms" | "whatsapp";

export default function MessageLogs() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterChannel, setFilterChannel] = useState<ChannelFilter>("all");

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["message-logs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("email_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30000,
  });

  const filtered = logs.filter((l: any) => {
    const matchSearch = !search ||
      l.recipient.toLowerCase().includes(search.toLowerCase()) ||
      l.subject.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || l.status === filterStatus;
    const matchChannel = filterChannel === "all" || (l.channel || "email") === filterChannel;
    return matchSearch && matchStatus && matchChannel;
  });

  const statusIcon = (s: string) => {
    switch (s) {
      case "sent": return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
      case "failed": return <XCircle className="w-3.5 h-3.5 text-destructive" />;
      default: return <Clock className="w-3.5 h-3.5 text-yellow-500" />;
    }
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "sent": return "bg-green-500/10 text-green-600 dark:text-green-400";
      case "failed": return "bg-destructive/10 text-destructive";
      default: return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    }
  };

  const channelIcon = (ch: string) => {
    switch (ch) {
      case "sms": return <Phone className="w-3.5 h-3.5" />;
      case "whatsapp": return <MessageSquare className="w-3.5 h-3.5" />;
      default: return <Mail className="w-3.5 h-3.5" />;
    }
  };

  const channelLabel = (ch: string) => {
    switch (ch) {
      case "sms": return "SMS";
      case "whatsapp": return "WhatsApp";
      default: return "Email";
    }
  };

  const totalSent = logs.filter((l: any) => l.status === "sent").length;
  const totalFailed = logs.filter((l: any) => l.status === "failed").length;

  const channels: { key: ChannelFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: null },
    { key: "email", label: "Email", icon: <Mail className="w-4 h-4" /> },
    { key: "sms", label: "SMS", icon: <Phone className="w-4 h-4" /> },
    { key: "whatsapp", label: "WhatsApp", icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const count = (ch: ChannelFilter) => (ch === "all" ? logs.length : logs.filter((l: any) => (l.channel || "email") === ch).length);

  return (
    <div className="space-y-5">
      <PageHeader title="Message logs" icon={MessageSquare} description="Every email, SMS and WhatsApp message the company sent, and whether it arrived."
        actions={<Button variant="outline" onClick={() => refetch()}><RefreshCw /> Refresh</Button>} />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Messages" value={logs.length} icon={Mail} tone="primary" />
        <StatTile label="Delivered" value={totalSent} icon={CheckCircle} tone="success" />
        <StatTile label="Failed" value={totalFailed} icon={XCircle} tone={totalFailed ? "danger" : "muted"} className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Recipient or subject…" />
        <Segmented value={filterChannel} onChange={(v) => setFilterChannel(v as ChannelFilter)} options={channels.map((c) => ({ value: c.key, label: c.label, count: count(c.key) }))} />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="fi w-auto" aria-label="Status">
          <option value="all">All statuses</option>
          <option value="sent">Delivered</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
      </Toolbar>

      <Panel flush>
        {isLoading ? <PageLoader /> : filtered.length === 0 ? <EmptyState icon={Mail} title={logs.length ? "No messages match" : "No messages sent yet"} /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>When</th><th>Channel</th><th>To</th><th className="hidden md:table-cell">Subject</th><th>Status</th><th className="hidden lg:table-cell">Details</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={6}>{(pageRows) => pageRows.map((l: any) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-muted-foreground">{format(new Date(l.created_at), "d MMM, HH:mm")}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-xs font-medium">{channelIcon(l.channel || "email")} {channelLabel(l.channel || "email")}</span></td>
                    <td className="max-w-[200px] truncate font-medium">{l.recipient}</td>
                    <td className="hidden max-w-[240px] truncate md:table-cell">{l.subject || "—"}</td>
                    <td><StatusPill status={l.status === "sent" ? "delivered" : l.status} /></td>
                    <td className="hidden max-w-[220px] truncate text-xs text-muted-foreground lg:table-cell" title={l.smtp_response || ""}>{l.smtp_response || "—"}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
