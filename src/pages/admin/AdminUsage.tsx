import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNowStrict, format } from "date-fns";
import { Activity, ArrowLeft, Building2, Download, LogIn, RefreshCw, Users, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { EmptyState, ExportMenu, PageHeader, Panel, PickMenu, Pill, SearchBox, Segmented, StatGrid, StatTile, TableWrap, Toolbar, btnCls } from "@/components/kit";
import { cn } from "@/lib/utils";
import { PagedRows } from "@/components/Pager";
import { ROOT_HOST } from "@/lib/host";

type Company = { tenant_id: string; business_name: string; slug: string | null; people: number; active_people: number; logins: number; last_login: string | null; last_seen: string | null; online_now: number; minutes: number; days_used: number };
type Person = { user_id: string; display_name: string | null; email: string | null; role: string; is_owner: boolean; logins: number; last_login: string | null; last_seen: string | null; online: boolean; here_now: boolean; path: string | null; user_agent: string | null; minutes: number; days_used: number };
type Online = { user_id: string; display_name: string | null; email: string | null; tenant_id: string | null; business_name: string | null; slug: string | null; path: string | null; user_agent: string | null; started_at: string; last_seen_at: string };

const ago = (d?: string | null) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "—");
const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return (data || []) as T[];
};

/** Who uses each company's system: sign-ins, time used, last seen and who is online now. */
export default function AdminUsage() {
  const [days, setDays] = useState("30");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [online, setOnline] = useState<Online[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"used" | "all">("used");
  const [open, setOpen] = useState<Company | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [c, o] = await Promise.all([rpc<Company>("admin_usage_companies", { p_days: Number(days) }), rpc<Online>("admin_online_now")]);
      setCompanies(c); setOnline(o);
      if (open) setPeople(await rpc<Person>("admin_usage_people", { p_tenant: open.tenant_id, p_days: Number(days) }));
    } catch (e: any) { setError(e.message || "Could not load usage"); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days, open?.tenant_id]);
  // Online now refreshes by itself every minute.
  useEffect(() => {
    const t = setInterval(() => { void rpc<Online>("admin_online_now").then(setOnline, () => undefined); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies
      .filter((c) => show === "all" || c.active_people > 0 || c.online_now > 0)
      .filter((c) => !q || c.business_name.toLowerCase().includes(q) || String(c.slug || "").includes(q))
      .sort((a, b) => b.online_now - a.online_now || b.active_people - a.active_people || b.logins - a.logins || b.minutes - a.minutes);
  }, [companies, search, show]);
  const totals = useMemo(() => ({
    active: companies.filter((c) => c.active_people > 0).length,
    people: companies.reduce((s, c) => s + c.active_people, 0),
    logins: companies.reduce((s, c) => s + c.logins, 0),
  }), [companies]);

  const period = days === "1" ? "today" : `last ${days} days`;
  const periodPick = <PickMenu ariaLabel="Period" value={days} onChange={setDays} options={[{ value: "1", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />;

  if (open) {
    const onlineHere = people.filter((p) => p.here_now).length;
    return (
      <div className="space-y-3">
        <PageHeader title={open.business_name} icon={Building2}
          actions={<>
            <button type="button" className={btnCls} onClick={() => { setOpen(null); setPeople([]); }}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">All companies</span></button>
            {periodPick}
            <ExportMenu items={[{ label: "People CSV", icon: Download, disabled: !people.length, onSelect: () => downloadCsv(`usage-${open.slug || "company"}-${days}d.csv`,
              ["Name", "Email", "Role", "Sign-ins", "Last sign-in", "Last seen", "Days used", "Minutes", "Online now"],
              people.map((p) => [p.display_name || "", p.email || "", p.role, p.logins, p.last_login || "", p.last_seen || "", p.days_used, p.minutes, p.here_now ? "yes" : ""])) }]} />
          </>} />
        <StatGrid className="lg:grid-cols-4">
          <StatTile label="People" value={people.length} icon={Users} tone="muted" />
          <StatTile label={`Used it (${period})`} value={people.filter((p) => p.logins > 0 || p.minutes > 0).length} icon={Activity} tone="primary" />
          <StatTile label="Sign-ins" value={people.reduce((s, p) => s + p.logins, 0)} icon={LogIn} tone="info" />
          <StatTile label="Online now" value={onlineHere} icon={Wifi} tone={onlineHere ? "success" : "muted"} />
        </StatGrid>
        <Panel flush>
          {people.length === 0 ? <EmptyState icon={Users} title={loading ? "Loading…" : "No people in this company"} /> : (
            <TableWrap>
              <table className="dt">
                <thead><tr><th>Person</th><th className="text-right">Sign-ins</th><th className="hidden md:table-cell">Last sign-in</th><th>Last seen</th><th className="hidden text-right lg:table-cell">Days used</th><th className="hidden text-right lg:table-cell">Time</th></tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user_id}>
                      <td>
                        <p className="flex items-center gap-1.5 font-medium">
                          {p.here_now && <span className="h-2 w-2 shrink-0 rounded-full bg-success" title="Online now" />}
                          <span className="truncate">{p.display_name || p.email || "Unnamed"}</span>
                          {p.is_owner && <Pill tone="primary">Owner</Pill>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{p.email} · {String(p.role).replace("_", " ")}{p.here_now && p.path ? ` · on ${p.path}` : ""}{p.here_now && p.user_agent ? ` · ${p.user_agent}` : ""}</p>
                      </td>
                      <td className="text-right tabular-nums">{p.logins}</td>
                      <td className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">{p.last_login ? format(new Date(p.last_login), "d MMM yyyy, HH:mm") : "—"}</td>
                      <td className="whitespace-nowrap text-xs">{p.here_now ? <span className="font-semibold text-success">Online now</span> : p.online ? "In another company now" : ago(p.last_seen)}</td>
                      <td className="hidden text-right tabular-nums lg:table-cell">{p.days_used || "—"}</td>
                      <td className="hidden text-right tabular-nums lg:table-cell">{p.minutes ? hrs(p.minutes) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
        <p className="text-xs text-muted-foreground">Sign-ins include the person's other companies. Days used and time count from 16 Nov 2026.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Usage" icon={Activity}
        actions={<>
          {periodPick}
          <button type="button" className={cn(btnCls, "w-9 px-0")} onClick={() => void load()} disabled={loading} aria-label="Refresh" title="Refresh">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
          <ExportMenu items={[{ label: "Companies CSV", icon: Download, disabled: !list.length, onSelect: () => downloadCsv(`usage-companies-${days}d.csv`,
            ["Company", "Address", "People", "Used it", "Sign-ins", "Last sign-in", "Last seen", "Online now", "Days used", "Minutes"],
            list.map((c) => [c.business_name, c.slug ? `${c.slug}.${ROOT_HOST}` : "", c.people, c.active_people, c.logins, c.last_login || "", c.last_seen || "", c.online_now, c.days_used, c.minutes])) }]} />
        </>} />

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Online now" value={online.length} hint={`${new Set(online.map((o) => o.tenant_id)).size} companies`} icon={Wifi} tone={online.length ? "success" : "muted"} />
        <StatTile label={`Companies used (${period})`} value={totals.active} hint={`of ${companies.length}`} icon={Building2} tone="primary" />
        <StatTile label={`People who used it`} value={totals.people} icon={Users} tone="info" />
        <StatTile label="Sign-ins" value={totals.logins} icon={LogIn} tone="muted" />
      </StatGrid>

      <Panel flush title="Online now" icon={Wifi} description="System open in the last 5 minutes. Refreshes every minute.">
        {online.length === 0 ? <EmptyState icon={Wifi} title="Nobody is online right now" /> : (
          <ul className="divide-y divide-border">
            {online.map((o) => (
              <li key={o.user_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{o.display_name || o.email} <span className="font-normal text-muted-foreground">· {o.business_name || "—"}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{o.path || ""}{o.user_agent ? ` · ${o.user_agent}` : ""} · on for {formatDistanceToNowStrict(new Date(o.started_at))}</p>
                </div>
                {o.tenant_id && <Button size="sm" variant="ghost" onClick={() => { const c = companies.find((x) => x.tenant_id === o.tenant_id); if (c) setOpen(c); }}>View</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search company…" />
        <Segmented value={show} onChange={(v) => setShow(v as "used" | "all")} options={[{ value: "used", label: "Used" }, { value: "all", label: "All companies" }]} />
      </Toolbar>

      <Panel flush>
        {list.length === 0 ? <EmptyState icon={Activity} title={loading ? "Loading…" : `No company was used ${period}`} /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Company</th><th className="text-right">Used it</th><th className="text-right">Sign-ins</th><th className="hidden md:table-cell">Last seen</th><th className="hidden text-right lg:table-cell">Days used</th><th className="hidden text-right lg:table-cell">Time</th><th className="text-right">Online</th></tr></thead>
              <tbody>
                <PagedRows rows={list} colSpan={7}>{(rows) => rows.map((c) => (
                  <tr key={c.tenant_id} className="cursor-pointer" onClick={() => setOpen(c)}>
                    <td>
                      <p className="max-w-[260px] truncate font-semibold">{c.business_name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{c.slug ? `${c.slug}.${ROOT_HOST}` : "No address"}</p>
                    </td>
                    <td className="text-right tabular-nums">{c.active_people} <span className="text-xs text-muted-foreground">/ {c.people}</span></td>
                    <td className="text-right tabular-nums">{c.logins}</td>
                    <td className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">{ago(c.last_seen || c.last_login)}</td>
                    <td className="hidden text-right tabular-nums lg:table-cell">{c.days_used || "—"}</td>
                    <td className="hidden text-right tabular-nums lg:table-cell">{c.minutes ? hrs(c.minutes) : "—"}</td>
                    <td className="text-right">{c.online_now ? <Pill tone="success">{c.online_now} online</Pill> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Your own visits are left out. Days used and time count from 16 Nov 2026. Full activity: <Link to="/admin/audit" className="text-primary underline">Audit log</Link>.
      </p>
    </div>
  );
}
