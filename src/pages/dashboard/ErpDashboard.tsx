/**
 * The dashboard: three views under one greeting. Overview fits one screen; Sales and Money hold the detail,
 * so nothing is repeated and nothing has to be scrolled past.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import GetStarted from "@/components/GetStarted";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import MoneyView from "./MoneyView";
import Overview from "./Overview";
import SalesView from "./SalesView";
import { PRESETS, iso, type Books, type Line } from "./parts";
import type { DashHome } from "./dashHome";

const sb: any = supabase;
const VIEWS = [["overview", "Overview"], ["sales", "Sales"], ["money", "Money"]] as const;
type View = (typeof VIEWS)[number][0];

/** First day of the six months dash_home adds up. */
function cashFlowSince() {
  const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
  return since;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function ErpDashboard() {
  const tenantId = useTenantId();
  const { role, profile } = useAuth() as any;
  const firstName = String(profile?.display_name || "").trim().split(/s+/)[0] || "";
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some(([k]) => k === params.get("view")) ? (params.get("view") as View) : "overview";
  const setView = (v: View) => setParams(v === "overview" ? {} : { view: v }, { replace: true });
  const [preset, setPreset] = useState("30d");
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[2].range());
  const [year, setYear] = useState(new Date().getFullYear());
  const onPreset = (k: string) => { const x = PRESETS.find((y) => y.key === k); if (x) { setPreset(k); setRange(x.range()); } };

  const { data: lines = [], isLoading, isFetching } = useQuery({
    queryKey: ["sales-lines", tenantId, from, to],
    enabled: !!tenantId,
    placeholderData: (prev: any) => prev,
    queryFn: async () => {
      const { data, error } = await sb.rpc("sales_lines", { p_from: from, p_to: to });
      if (error) throw error;
      return (data || []).map((l: any) => ({ ...l, qty: Number(l.qty), revenue: Number(l.revenue), cost: Number(l.cost) })) as Line[];
    },
  });
  const span = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) + 1;
  const prevTo = iso(new Date(new Date(from).getTime() - 864e5));
  const prevFrom = iso(new Date(new Date(from).getTime() - span * 864e5));
  const since = useMemo(cashFlowSince, []);
  // Everything except the sales lines and the books overview, in one round trip.
  const { data: home } = useQuery({
    queryKey: ["dash-home", tenantId, from, to],
    enabled: !!tenantId,
    refetchInterval: 120_000,
    placeholderData: (prev: any) => prev,
    queryFn: async () => {
      const { data, error } = await sb.rpc("dash_home", {
        p_tenant: tenantId, p_from: from, p_to: to, p_prev_from: prevFrom, p_prev_to: prevTo,
        p_since: since.toISOString().slice(0, 10), p_today: iso(new Date()), p_week: iso(new Date(Date.now() + 7 * 864e5)),
        p_setup: role === "admin" || role === "super_admin",
      });
      if (error) throw error;
      return data as DashHome;
    },
  });
  const { data: booksData } = useQuery({
    queryKey: ["books-overview", tenantId, year], enabled: !!tenantId, staleTime: 60_000,
    placeholderData: (prev: any) => prev,
    queryFn: async () => ((await sb.rpc("dash_books_overview", { p_year: year })).data || null) as Books | null,
  });
  const books = booksData?.receivables ? booksData : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border/70">
        <div className="mr-auto min-w-0 pb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <h1 className="mt-1 truncate font-display text-2xl font-bold tracking-tight">{greeting()}{firstName && `, ${firstName}`}</h1>
        </div>
        <div className="-mb-px flex gap-1 text-sm font-medium" role="tablist" aria-label="Dashboard view">
          {VIEWS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={cn("border-b-2 px-3 pb-3 pt-1 transition-colors", view === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
      </div>

      {view === "overview" && (
        <>
          <GetStarted data={home?.get_started ?? undefined} />
          <Overview lines={lines} loading={isLoading} fetching={isFetching} from={from} to={to} preset={preset} onPreset={onPreset}
            prevRevenue={home ? Number(home.prev_revenue) : null} home={home} books={books} year={year} onSales={() => setView("sales")} onMoney={() => setView("money")} />
        </>
      )}
      {view === "sales" && (
        <SalesView lines={lines} loading={isLoading} fetching={isFetching} from={from} to={to} preset={preset} onPreset={onPreset}
          onDates={(a, b) => { setPreset("custom"); setRange([a, b]); }} />
      )}
      {view === "money" && <MoneyView books={books} year={year} onYear={setYear} stockValue={Number(home?.stock_value || 0)} />}
    </div>
  );
}
