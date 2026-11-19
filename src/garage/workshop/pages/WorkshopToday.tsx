import { useMemo, useState } from "react";
import { LayoutGrid, Plus, Tv, CalendarDays, Car, Clock, CheckCircle2, PackageSearch, Hourglass, Smartphone } from "lucide-react";
import { PageHeader, Panel, StatGrid, StatTile, Segmented } from "@/components/kit";
import { useJobs, useBookings, useLiveWorkshop, useRefresh } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import Board, { type BoardMode } from "../components/Board";
import { PlateTag, when } from "../components/bits";

const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/** Today in the workshop: the numbers, today's bookings and the live board. */
export default function WorkshopToday() {
  useLiveWorkshop();
  const { go, href } = useWorkshopLinks();
  const refresh = useRefresh();
  const [mode, setMode] = useState<BoardMode>("stage");
  const { data: jobs = [] } = useJobs({ open: true });
  const from = useMemo(() => dayStart().toISOString(), []);
  const to = useMemo(() => new Date(dayStart().getTime() + 86_400_000).toISOString(), []);
  const { data: bookings = [] } = useBookings(from, to);
  const count = (s: string) => (jobs as any[]).filter((j) => j.status === s).length;
  const inToday = (jobs as any[]).filter((j) => j.checked_in_at && j.checked_in_at >= from).length;
  const waitingBookings = (bookings as any[]).filter((b) => ["pending", "confirmed"].includes(b.status));

  return (
    <div className="space-y-3">
      <PageHeader title="Workshop" icon={LayoutGrid} actions={<>
        <a href={href("/garage/board")} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Tv className="h-4 w-4" />TV board</a>
        <a href={href("/garage/mechanic")} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Smartphone className="h-4 w-4" />Mechanic view</a>
        <button type="button" onClick={() => go("/garage/jobs/new")} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Check in</button>
      </>} />

      <StatGrid className="lg:grid-cols-6">
        <StatTile label="Cars in the workshop" value={(jobs as any[]).length} icon={Car} />
        <StatTile label="Checked in today" value={inToday} icon={Clock} tone="info" />
        <StatTile label="Waiting approval" value={count("waiting_approval")} icon={Hourglass} tone="warning" />
        <StatTile label="Waiting parts" value={count("waiting_parts")} icon={PackageSearch} tone="warning" />
        <StatTile label="Ready" value={count("ready")} icon={CheckCircle2} tone="success" />
        <StatTile label="Bookings today" value={waitingBookings.length} icon={CalendarDays} tone="muted" />
      </StatGrid>

      {waitingBookings.length > 0 && (
        <Panel title="Expected today" icon={CalendarDays} flush actions={<a href={href("/garage/bookings")} className="text-xs font-medium text-primary">All bookings</a>}>
          <div className="divide-y divide-border">
            {waitingBookings.map((b: any) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="w-14 tabular-nums text-muted-foreground">{new Date(b.starts_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
                <PlateTag plate={b.plate} /><span className="flex-1 truncate">{b.name || ""}{b.service ? ` · ${b.service}` : ""}</span>
                <button type="button" onClick={() => go(`/garage/jobs/new?booking=${b.id}`)} className="h-8 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground">Check in</button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "stage", label: "By stage" }, { value: "bay", label: "By bay" }]} />
        <span className="text-[11px] text-muted-foreground">Drag a car to move it (desktop). Updated {when(new Date().toISOString())}.</span>
      </div>
      <Board jobs={jobs as any[]} mode={mode} onOpen={(id) => go(`/garage/jobs/${id}`)} onChanged={refresh} />
    </div>
  );
}
