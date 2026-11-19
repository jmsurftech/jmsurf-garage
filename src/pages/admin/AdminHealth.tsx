import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse, Bug, CheckCircle2, XCircle, ExternalLink, RefreshCw } from "lucide-react";
import { formatDistanceToNowStrict, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, TableWrap, EmptyState, StatTile, StatGrid, Segmented, PageLoader, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
export default function AdminHealth() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [openFp, setOpenFp] = useState<string | null>(null);
  const since = new Date(Date.now() - (range === "24h" ? 1 : range === "7d" ? 7 : 30) * 864e5).toISOString();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-health", range],
    queryFn: async () => {
      const sb: any = supabase;
      const [{ data: errors }, { data: checks }] = await Promise.all([
        sb.from("app_errors").select("id, created_at, fingerprint, message, stack, path, tenant_slug, user_agent").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
        sb.from("uptime_checks").select("service, ok, ms, checked_at, detail").gte("checked_at", since).order("checked_at", { ascending: false }).limit(5000),
      ]);
      return { errors: (errors || []) as any[], checks: (checks || []) as any[] };
    },
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => {
    const m = new Map<string, { fp: string; message: string; count: number; last: string; shops: Set<string>; paths: Set<string>; sample: any }>();
    (data?.errors || []).forEach((e) => {
      const g = m.get(e.fingerprint) || { fp: e.fingerprint, message: e.message, count: 0, last: e.created_at, shops: new Set(), paths: new Set(), sample: e };
      g.count++; if (e.tenant_slug) g.shops.add(e.tenant_slug); if (e.path) g.paths.add(e.path);
      m.set(e.fingerprint, g);
    });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [data?.errors]);

  const services = useMemo(() => {
    const m = new Map<string, { service: string; total: number; up: number; latest: any; avgMs: number }>();
    (data?.checks || []).forEach((c) => {
      const s = m.get(c.service) || { service: c.service, total: 0, up: 0, latest: c, avgMs: 0 };
      s.total++; if (c.ok) s.up++; s.avgMs += c.ms || 0;
      m.set(c.service, s);
    });
    return [...m.values()].map((s) => ({ ...s, avgMs: Math.round(s.avgMs / Math.max(1, s.total)) }));
  }, [data?.checks]);

  if (isLoading) return <div className="p-4 sm:p-6"><PageLoader label="Loading system health…" /></div>;
  const failures = (data?.checks || []).filter((c) => !c.ok).slice(0, 20);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title="System health" icon={HeartPulse} description="Uptime checks every 5 minutes and error reports from companies' browsers. Alerts go to the support email in Settings."
        actions={<>
          <a href="/status" target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><ExternalLink /> Public status page</Button></a>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={isFetching ? "animate-spin" : ""} /> Refresh</Button>
        </>}>
        <Segmented value={range} onChange={(v) => setRange(v as any)} options={[{ value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]} />
      </PageHeader>

      <StatGrid className="lg:grid-cols-3">
        {services.length === 0 ? <StatTile label="Uptime checks" value="Starting…" icon={HeartPulse} tone="muted" /> : services.map((s) => (
          <StatTile key={s.service} label={s.service} value={`${((s.up / s.total) * 100).toFixed(2)}%`}
            icon={s.latest.ok ? CheckCircle2 : XCircle} tone={s.latest.ok ? "success" : "danger"}
            hint={`${s.latest.ok ? "Up" : "Down"} · avg ${s.avgMs} ms · ${s.total} checks`} />
        ))}
      </StatGrid>

      <Panel title="Errors" description={`${data?.errors.length || 0} reports, ${groups.length} different problems`} icon={Bug} flush>
        {groups.length === 0 ? <EmptyState icon={CheckCircle2} title="No errors reported" description="Nice — nothing crashed in this period." /> : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.fp}>
                <button type="button" onClick={() => setOpenFp(openFp === g.fp ? null : g.fp)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 sm:px-5">
                  <span className="mt-0.5 flex h-7 min-w-[2.25rem] items-center justify-center rounded-lg bg-destructive/10 px-1.5 text-xs font-bold text-destructive">{g.count}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{g.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Last {formatDistanceToNowStrict(new Date(g.last))} ago
                      {g.shops.size > 0 && <> · {[...g.shops].slice(0, 4).join(", ")}</>}
                      {g.paths.size > 0 && <> · {[...g.paths].slice(0, 2).join(", ")}</>}
                    </p>
                  </div>
                </button>
                {openFp === g.fp && (
                  <pre className="mx-4 mb-4 max-h-64 overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed sm:mx-5">{g.sample.stack || "No stack trace"}{"\n\n"}{g.sample.user_agent}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent failed checks" icon={XCircle} flush>
        {failures.length === 0 ? <EmptyState icon={CheckCircle2} title="No failed checks" className="py-10" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>When</th><th>Service</th><th>Problem</th><th className="num">Time</th></tr></thead>
              <tbody>
                <PagedRows rows={failures} colSpan={4}>{(pageRows) => pageRows.map((f, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-muted-foreground">{format(new Date(f.checked_at), "d MMM, HH:mm")}</td>
                    <td className="font-medium">{f.service}</td>
                    <td><Pill tone="danger">{f.detail || "No response"}</Pill></td>
                    <td className={cn("num text-muted-foreground")}>{f.ms} ms</td>
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
