import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Eye, Globe, Users, MousePointerClick, Smartphone, Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, EmptyState, StatGrid, StatTile, TableWrap, Pill } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { useTenantId } from "@/hooks/useTenantId";

import { PagedRows } from "@/components/Pager";
type Visit = { id: number; visitor_id: string; path: string; title: string | null; referrer: string | null; utm_source: string | null; utm_campaign: string | null; device: string | null; lead_id: string | null; created_at: string };
const host = (u?: string | null) => { if (!u) return ""; try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const sourceOf = (v: Visit) => v.utm_source || host(v.referrer) || "Direct";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** CRM → Visits: who is on the company's website, which pages, and where they came from. */
export default function Visits() {
  const tenantId = useTenantId();
  const [days, setDays] = useState(30);
  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["site-visits", tenantId, days], enabled: !!tenantId,
    queryFn: async () => ((await (supabase as any).from("site_visits").select("*").gte("created_at", new Date(Date.now() - days * 864e5).toISOString()).order("created_at", { ascending: false }).limit(5000)).data || []) as Visit[],
  });
  const visitors = useMemo(() => {
    const m = new Map<string, { id: string; first: Visit; last: Visit; pages: number; lead: string | null; paths: string[] }>();
    for (const v of [...visits].reverse()) {
      const cur = m.get(v.visitor_id);
      if (!cur) m.set(v.visitor_id, { id: v.visitor_id, first: v, last: v, pages: 1, lead: v.lead_id, paths: [v.path] });
      else { cur.last = v; cur.pages++; cur.lead = cur.lead || v.lead_id; if (cur.paths.length < 6 && !cur.paths.includes(v.path)) cur.paths.push(v.path); }
    }
    return [...m.values()].sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  }, [visits]);
  const count = (key: (v: Visit) => string, list: Visit[]) => {
    const m = new Map<string, number>();
    for (const v of list) m.set(key(v), (m.get(key(v)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  const daily = useMemo(() => {
    const out: { day: string; views: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      out.push({ day: d.slice(5), views: visits.filter((v) => v.created_at.slice(0, 10) === d).length });
    }
    return out;
  }, [visits, days]);
  if (isLoading) return <OrbLoader label="Loading visits…" />;
  const firsts = visitors.map((x) => x.first);
  return (
    <div className="space-y-5">
      <PageHeader title="Visits" icon={Eye} description="People on your website: the pages they open, where they came from, and the ones who became leads."
        actions={<select className="fi h-9 w-36" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{[[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>} />
      {visits.length === 0 ? (
        <Panel><EmptyState icon={Globe} title="No visits yet" description="Visits are counted on your company website (System → Customer portal & website). Share its address to start." /></Panel>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Page views" value={visits.length} icon={Eye} tone="primary" />
            <StatTile label="Visitors" value={visitors.length} icon={Users} tone="info" />
            <StatTile label="Became leads" value={visitors.filter((x) => x.lead).length} icon={MousePointerClick} tone="success" />
            <StatTile label="On mobile" value={`${visits.length ? Math.round((visits.filter((v) => v.device === "Mobile").length / visits.length) * 100) : 0}%`} icon={Smartphone} tone="muted" />
          </StatGrid>
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Page views per day" icon={Eye} className="xl:col-span-2">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={32} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                    <Bar dataKey="views" name="Page views" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Where visitors come from" icon={Globe}>
              <ul className="space-y-2 text-sm">{count(sourceOf, firsts).map(([k, n]) => <li key={k} className="flex justify-between"><span className="truncate">{k}</span><b className="tabular-nums">{n}</b></li>)}</ul>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top pages</p>
              <ul className="space-y-2 text-sm">{count((v) => v.path, visits).map(([k, n]) => <li key={k} className="flex justify-between gap-2"><span className="truncate font-mono text-xs">{k}</span><b className="tabular-nums">{n}</b></li>)}</ul>
            </Panel>
          </div>
          <Panel title="Visitors" icon={Users} flush>
            <TableWrap><table className="dt">
              <thead><tr><th>Last seen</th><th>Visitor</th><th>Source</th><th className="hidden md:table-cell">Pages</th><th className="num">Views</th><th>Device</th></tr></thead>
              <tbody><PagedRows rows={visitors.slice(0, 300)} colSpan={6}>{(pageRows) => pageRows.map((x) => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap">{when(x.last.created_at)}</td>
                  <td>{x.lead ? <Link to={`/crm/lead/${x.lead}`} className="font-semibold text-primary">Lead</Link> : <span className="text-muted-foreground">Visitor {x.id.slice(0, 6)}</span>}</td>
                  <td>{sourceOf(x.first)}{x.first.utm_campaign && <Pill tone="info" className="ml-1">{x.first.utm_campaign}</Pill>}</td>
                  <td className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground md:table-cell">{x.paths.join("  ·  ")}</td>
                  <td className="num">{x.pages}</td>
                  <td>{x.last.device === "Mobile" ? <Smartphone className="h-4 w-4 text-muted-foreground" /> : <Monitor className="h-4 w-4 text-muted-foreground" />}</td>
                </tr>
              ))}</PagedRows></tbody>
            </table></TableWrap>
          </Panel>
        </>
      )}
    </div>
  );
}
