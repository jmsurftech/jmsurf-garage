import { useMemo, useState } from "react";
import { CalendarClock, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageLoader, SearchBox, Segmented, Toolbar } from "@/components/kit";
import Pager, { usePaged } from "@/components/Pager";
import { downloadCsv } from "@/components/Bulk";
import { useAuth } from "@/hooks/useAuth";
import { useCrmRefresh, useLookups } from "./fields";
import { ActivityForm, ActivityRow, activityWhen, isOverdue, KIND_LABEL, useActivities, useRelatedNames, type Kind } from "./activities";

/** Tasks, meetings and calls across the CRM. */
export default function ActivitiesPage({ kind }: { kind?: Kind }) {
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const { data: all = [], isLoading, refetch } = useActivities();
  const [when, setWhen] = useState("open");
  const [whose, setWhose] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ row?: any } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  const rows = useMemo(() => all.filter((a) => {
    if (kind && a.kind !== kind) return false;
    if (whose === "mine" && a.assigned_to && a.assigned_to !== user?.id) return false;
    const d = String(activityWhen(a) || "").slice(0, 10);
    if (when === "open" && a.done) return false;
    if (when === "today" && (a.done || d !== today)) return false;
    if (when === "overdue" && !isOverdue(a)) return false;
    if (when === "week" && (a.done || d < today || d > week)) return false;
    if (when === "done" && !a.done) return false;
    return !search.trim() || String(a.summary || "").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => (when === "done" ? String(b.done_at).localeCompare(String(a.done_at)) : String(activityWhen(a)).localeCompare(String(activityWhen(b))))), [all, kind, whose, when, search, user?.id, today, week]);
  const names = useRelatedNames(rows.slice(0, 300));
  const paged = usePaged(rows, 50);
  const counts = useMemo(() => ({ overdue: all.filter((a) => (!kind || a.kind === kind) && isOverdue(a) && (whose === "all" || !a.assigned_to || a.assigned_to === user?.id)).length }), [all, kind, whose, user?.id]);
  const title = kind ? `${KIND_LABEL[kind]}s` : "Activities";

  return (
    <div className="crm-ui space-y-4 p-4 sm:p-6">
      <PageHeader title={title} icon={CalendarClock} description={`${rows.length} shown${counts.overdue ? ` · ${counts.overdue} overdue` : ""}`}
        actions={<>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadCsv(`${title.toLowerCase()}.csv`, ["Type", "Subject", "When", "Status", "Assigned to", "Related to", "Result"], rows.map((a) => [KIND_LABEL[a.kind as Kind], a.summary, String(activityWhen(a) || "").slice(0, 16), a.done ? "Done" : "Open", lk.userName.get(a.assigned_to) || "", names.get(`${a.related_type}:${a.related_id}`) || "", a.call_result || ""]))}><Download /> Export</Button>
          <Button size="sm" onClick={() => setForm({})}><Plus /> New {kind ? KIND_LABEL[kind].toLowerCase() : "activity"}</Button>
        </>} />
      <Toolbar>
        <Segmented value={when} onChange={setWhen} options={[{ value: "open", label: "Open" }, { value: "today", label: "Today" }, { value: "week", label: "Next 7 days" }, { value: "overdue", label: "Overdue", count: counts.overdue }, { value: "done", label: "Done" }]} />
        <Segmented value={whose} onChange={(v) => setWhose(v as "mine" | "all")} options={[{ value: "mine", label: "Mine" }, { value: "all", label: "Everyone's" }]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search subjects…" />
      </Toolbar>
      {isLoading ? <PageLoader /> : !rows.length ? <EmptyState icon={CalendarClock} title="Nothing here" action={<Button onClick={() => setForm({})}><Plus /> New {kind ? KIND_LABEL[kind].toLowerCase() : "activity"}</Button>} /> : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {paged.pageRows.map((a) => <ActivityRow key={a.id} a={a} related={names.get(`${a.related_type}:${a.related_id}`)} onChanged={() => { void refetch(); refresh(); }} onOpen={(row) => setForm({ row })} />)}
          </ul>
          <Pager {...paged.pager} />
        </>
      )}
      <ActivityForm open={!!form} onClose={() => { setForm(null); void refetch(); }} activity={form?.row} kind={kind || "task"} />
    </div>
  );
}
