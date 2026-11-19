import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import { cn } from "@/lib/utils";

type Service = { service: string; ok: boolean; ms: number | null; checked_at: string; uptime_90d: number | null; days: { day: string; uptime: number }[] | null };

const DESCRIPTIONS: Record<string, string> = {
  Website: "The JMSURF Garage app and website",
  "Database API": "Sales, stock and records",
  "Sign-in": "Logging in to stores",
};

function DayBars({ days }: { days: Service["days"] }) {
  const map = new Map((days || []).map((d) => [d.day, d.uptime]));
  const cells = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(Date.now() - (89 - i) * 864e5);
    const key = d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
    return { key, v: map.get(key) };
  });
  return (
    <div className="flex h-8 gap-[2px]">
      {cells.map((c) => (
        <span key={c.key} title={c.v === undefined ? `${c.key}: no data` : `${c.key}: ${c.v}% up`}
          className={cn("flex-1 rounded-sm",
            c.v === undefined ? "bg-slate-200" : c.v >= 99.5 ? "bg-emerald-500" : c.v >= 95 ? "bg-amber-400" : "bg-red-500")} />
      ))}
    </div>
  );
}

export default function Status() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["public-status"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("public_status");
      if (error) throw error;
      return data as { generated_at: string; services: Service[] };
    },
    refetchInterval: 60_000,
  });
  const services = data?.services || [];
  const allUp = services.length > 0 && services.every((s) => s.ok);
  const anyDown = services.some((s) => !s.ok);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Helmet><title>JMSURF Garage | System status</title></Helmet>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-28 sm:px-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">System status</h1>

        <div className={cn("mt-6 flex items-center gap-4 rounded-3xl p-6 text-white shadow-lg",
          isLoading ? "bg-slate-400" : anyDown ? "bg-red-500" : allUp ? "bg-emerald-500" : "bg-slate-500")}>
          {anyDown ? <XCircle className="h-9 w-9 shrink-0" /> : <CheckCircle2 className="h-9 w-9 shrink-0" />}
          <div className="flex-1">
            <p className="font-display text-xl font-bold">
              {isLoading ? "Checking…" : anyDown ? "Some systems are having problems" : allUp ? "All systems working" : "Waiting for the first checks"}
            </p>
            {data?.generated_at && <p className="text-sm text-white/80">Updated {new Date(data.generated_at).toLocaleTimeString()}</p>}
          </div>
          <button onClick={() => refetch()} className="rounded-xl bg-white/15 p-2 hover:bg-white/25" aria-label="Refresh">
            <RefreshCw className={cn("h-5 w-5", isFetching && "animate-spin")} />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {services.map((s) => (
            <section key={s.service} className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{s.service}</h2>
                  <p className="text-sm text-slate-500">{DESCRIPTIONS[s.service] || ""}</p>
                </div>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                  s.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                  <span className={cn("h-2 w-2 rounded-full", s.ok ? "bg-emerald-500" : "bg-red-500")} />
                  {s.ok ? "Working" : "Down"}
                </span>
              </div>
              <div className="mt-4"><DayBars days={s.days} /></div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>90 days ago</span>
                <span>{s.uptime_90d != null ? `${s.uptime_90d}% uptime` : ""}</span>
                <span>Today</span>
              </div>
            </section>
          ))}
          {!isLoading && services.length === 0 && (
            <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-slate-600">
              <Clock className="h-5 w-5" /> Checks start within a few minutes of the monitor going live.
            </div>
          )}
        </div>
        <p className="mt-8 text-center text-sm text-slate-500">Having trouble? Call or WhatsApp our support team — details below.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
