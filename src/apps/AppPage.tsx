import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, LayoutList, KanbanSquare, CalendarDays, Archive, Trash2, Send, MessageSquare, Factory, FileCheck, UserCheck,
  ChevronLeft, ChevronRight, Lock, Copy, Download, ArrowRight, History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal, PageLoader, Pill, SearchBox, Segmented, EmptyState } from "@/components/kit";
import { confirmAction } from "@/components/books/confirm";
import { useModules } from "@/hooks/useModules";
import { appName, moduleFor } from "@/lib/modules";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_BY_KEY } from "./registry";
import type { AppDef, FieldDef, KindDef, StageDef } from "./types";
import {
  addComment, archiveRecord, deleteRecord, fieldValue, recordsKey, saveRecord, setStage, useRecordEvents, useRecordOptions, useRecords,
  type AppRecord,
} from "./data";
import { FieldDisplay, FieldInput, useFieldLabels } from "./fields";
import { fmtMoney } from "./format";
import { RecordExtras } from "./extras";

import { PagedRows } from "@/components/Pager";
const TONES: Record<StageDef["tone"], { chip: string; bar: string }> = {
  slate: { chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300", bar: "bg-slate-400" },
  blue: { chip: "bg-blue-500/10 text-blue-600 dark:text-blue-300", bar: "bg-blue-500" },
  amber: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", bar: "bg-amber-500" },
  violet: { chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300", bar: "bg-violet-500" },
  green: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
  red: { chip: "bg-red-500/10 text-red-600 dark:text-red-300", bar: "bg-red-500" },
  cyan: { chip: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300", bar: "bg-cyan-500" },
  pink: { chip: "bg-pink-500/10 text-pink-600 dark:text-pink-300", bar: "bg-pink-500" },
};

export function StageChip({ kind, stage }: { kind: KindDef; stage: string | null }) {
  const s = kind.stages?.find((x) => x.key === stage);
  if (!s) return stage ? <Pill>{stage}</Pill> : null;
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", TONES[s.tone].chip)}>{s.label}</span>;
}

/** Studio apps live in app_definitions; built-in ones in the registry. */
function useAppDef(appKey: string) {
  const isStudio = appKey.startsWith("studio:");
  const { data, isLoading } = useQuery({
    queryKey: ["app-definition", appKey],
    enabled: isStudio,
    queryFn: async () => (await (supabase as any).from("app_definitions").select("*").eq("app_key", appKey.slice(7)).maybeSingle()).data,
  });
  if (!isStudio) return { def: APP_BY_KEY[appKey] as AppDef | undefined, name: appName(appKey), loading: false, studio: null };
  const def = data ? ({ key: appKey, kinds: (data.definition?.kinds || []) as KindDef[] } as AppDef) : undefined;
  return { def, name: data?.name as string | undefined, loading: isLoading, studio: data };
}

export default function AppPage() {
  const { app = "", kind: kindKey, id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { def, name, loading, studio } = useAppDef(app);
  const { has, ready } = useModules();
  const moduleKey = app.startsWith("studio:") ? "studio" : app;
  const mod = moduleFor(moduleKey);

  if (loading || !ready) return <PageLoader />;
  if (!def || !def.kinds.length) return <EmptyState title="App not found" description="This app does not exist or has no record types yet." action={<Link to="/modules" className="text-primary underline">Open Modules</Link>} />;
  const visible = def.kinds.filter((k) => !k.hidden);
  if (!kindKey) return <Navigate to={`/apps/${app}/${visible[0].key}${window.location.search}`} replace />;
  const kind = def.kinds.find((k) => k.key === kindKey);
  if (!kind) return <Navigate to={`/apps/${app}/${visible[0].key}`} replace />;

  if (!has(moduleKey)) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: mod?.color || "#a8121b" }}>
          {mod ? <mod.icon className="h-8 w-8" /> : <Lock className="h-8 w-8" />}
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold">{mod?.name || name} is switched off</h1>
        <p className="mt-2 text-muted-foreground">{mod?.tagline} Switch it on in Modules: the first 14 days are free and your existing records are kept.</p>
        <Link to={`/modules?app=${moduleKey}`} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Open in Modules <ArrowRight className="h-4 w-4" /></Link>
      </div>
    );
  }

  return (
    <KindScreen key={`${app}/${kind.key}`} app={app} appName={name || mod?.name || app} color={studio?.color || mod?.color || "#a8121b"}
      Icon={mod?.icon} def={def} kind={kind} openId={id || params.get("open")} createNew={params.get("new") === "1"}
      onClose={() => { if (id) navigate(`/apps/${app}/${kind.key}`); else if (params.get("open") || params.get("new")) { params.delete("open"); params.delete("new"); setParams(params, { replace: true }); } }} />
  );
}

function KindScreen({ app, appName, color, Icon, def, kind, openId, createNew, onClose }: {
  app: string; appName: string; color: string; Icon?: React.ComponentType<{ className?: string }>;
  def: AppDef; kind: KindDef; openId: string | null; createNew: boolean; onClose: () => void;
}) {
  const navigate = useNavigate();
  const views = kind.views?.length ? kind.views : ["list"];
  const [view, setView] = useState<string>(() => { try { return localStorage.getItem(`garage.view.${app}.${kind.key}`) || views[0]; } catch { return views[0]; } });
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("open");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<AppRecord | "new" | null>(createNew ? "new" : null);
  const [preset, setPreset] = useState<Record<string, any>>({});
  const { data: rows = [], isLoading } = useRecords(app, kind.key, { archived: showArchived });
  const labels = useFieldLabels(app, kind.fields);
  const refField = kind.fields.find((f) => f.type === "record" && f.column === "parent_id");
  const { data: parentOpts = [] } = useRecordOptions(app, refField?.ref || "", !!refField);
  const recordLabels = useMemo(() => new Map(parentOpts.map((o) => [o.id, o.label])), [parentOpts]);

  useEffect(() => { try { localStorage.setItem(`garage.view.${app}.${kind.key}`, view); } catch { /* per device */ } }, [app, kind.key, view]);
  useEffect(() => { if (createNew) setEditing("new"); }, [createNew]);
  useEffect(() => {
    if (!openId) return;
    const hit = rows.find((r) => r.id === openId);
    if (hit) setEditing(hit);
  }, [openId, rows]);

  const doneKeys = new Set((kind.stages || []).filter((s) => s.done).map((s) => s.key));
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind.stages && view === "list" && stageFilter === "open" && r.stage && doneKeys.has(r.stage)) return false;
      if (kind.stages && view === "list" && stageFilter !== "open" && stageFilter !== "all" && r.stage !== stageFilter) return false;
      if (!t) return true;
      return `${r.number || ""} ${r.title} ${JSON.stringify(r.data)}`.toLowerCase().includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, stageFilter, view]);

  const stats = (kind.stats || []).map((s) => {
    const set = rows.filter((r) => !s.where?.stage || s.where.stage.includes(String(r.stage)));
    const v = s.sum ? set.reduce((a, r) => a + Number((r as any)[s.sum!] ?? r.data?.[s.sum!] ?? 0), 0) : set.length;
    const isMoney = s.sum && kind.fields.find((f) => (f.column || f.key) === s.sum)?.type === "money";
    return { label: s.label, value: isMoney ? fmtMoney(v) : v.toLocaleString() };
  });

  const listFields = kind.fields.filter((f) => f.list && f.type !== "lines" && f.type !== "textarea").slice(0, 5);
  const close = () => { setEditing(null); setPreset({}); onClose(); };
  const openNew = (p: Record<string, any> = {}) => { setPreset(p); setEditing("new"); };
  const exportCsv = () => {
    const head = ["Number", kind.titleLabel || "Title", "Stage", ...kind.fields.filter((f) => f.type !== "lines" && f.type !== "signature").map((f) => f.label)];
    const lines = filtered.map((r) => [r.number || "", r.title, r.stage || "", ...kind.fields.filter((f) => f.type !== "lines" && f.type !== "signature").map((f) => {
      const v = fieldValue(r, f);
      if (["customer", "supplier", "employee", "product", "user"].includes(f.type)) return (labels as any)[f.type].get(v) || "";
      if (f.type === "record") return recordLabels.get(v) || "";
      return Array.isArray(v) ? v.join("; ") : v ?? "";
    })]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${kind.plural.toLowerCase().replace(/\s+/g, "-")}.csv`; a.click();
  };

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: color }}>
              {Icon ? <Icon className="h-5 w-5" /> : <span className="font-bold">{appName[0]}</span>}
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold sm:text-2xl">{kind.plural}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" /> Export</button>
            <button onClick={() => openNew()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90">
              <Plus className="h-4 w-4" /> New {kind.label.toLowerCase()}
            </button>
          </div>
        </div>
        {def.kinds.filter((k) => !k.hidden).length > 1 && (
          <nav className="flex gap-1 overflow-x-auto border-b border-border">
            {def.kinds.filter((k) => !k.hidden).map((k) => (
              <Link key={k.key} to={`/apps/${app}/${k.key}`}
                className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", k.key === kind.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {k.plural}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">{s.value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">All {kind.plural.toLowerCase()}</p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums">{rows.length}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${kind.plural.toLowerCase()}…`} />
        {kind.stages && view === "list" && (
          <select className="fi h-10 w-auto" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="open">Open</option>
            <option value="all">All stages</option>
            {kind.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived</label>
        {views.length > 1 && (
          <Segmented className="ml-auto" value={view} onChange={setView} options={views.map((v) => ({
            value: v, label: <span className="inline-flex items-center gap-1.5">{v === "list" ? <LayoutList className="h-4 w-4" /> : v === "kanban" ? <KanbanSquare className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}<span className="hidden sm:inline">{v[0].toUpperCase() + v.slice(1)}</span></span>,
          }))} />
        )}
      </div>

      {isLoading ? <PageLoader /> : view === "kanban" && kind.stages ? (
        <Kanban kind={kind} rows={filtered} labels={labels} onOpen={setEditing} onNew={(stage) => openNew({ stage })} />
      ) : view === "calendar" ? (
        <Calendar kind={kind} rows={filtered} onOpen={setEditing} onNew={(date) => openNew({ __date: date })} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {filtered.length === 0 ? (
            <EmptyState icon={Icon as any} title={`No ${kind.plural.toLowerCase()} yet`} description={kind.description || `Create your first ${kind.label.toLowerCase()} to get started.`}
              action={<button onClick={() => openNew()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">New {kind.label.toLowerCase()}</button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="dt">
                <thead><tr>
                  <th>{kind.titleLabel || "Name"}</th>
                  {listFields.map((f) => <th key={f.key} className={cn(["money", "number"].includes(f.type) && "num")}>{f.label}</th>)}
                  {kind.stages && <th>Stage</th>}
                </tr></thead>
                <tbody>
                  <PagedRows rows={filtered} colSpan={listFields.length + 2}>{(pageRows) => pageRows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}>
                      <td data-label={kind.titleLabel || "Name"}>
                        <span className="font-medium">{r.title || "Untitled"}</span>
                        {r.number && <span className="ml-2 text-xs text-muted-foreground">{r.number}</span>}
                      </td>
                      {listFields.map((f) => (
                        <td key={f.key} data-label={f.label} className={cn(["money", "number"].includes(f.type) && "num")}>
                          <FieldDisplay field={f} value={fieldValue(r, f)} labels={labels} recordLabels={recordLabels} />
                        </td>
                      ))}
                      {kind.stages && <td data-label="Stage"><StageChip kind={kind} stage={r.stage} /></td>}
                    </tr>
                  ))}</PagedRows>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && (
        <RecordSheet app={app} def={def} kind={kind} record={editing === "new" ? null : editing} preset={preset} onClose={close}
          onOpenOther={(path) => { close(); navigate(path); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- kanban */

function Kanban({ kind, rows, labels, onOpen, onNew }: {
  kind: KindDef; rows: AppRecord[]; labels: ReturnType<typeof useFieldLabels>;
  onOpen: (r: AppRecord) => void; onNew: (stage: string) => void;
}) {
  const qc = useQueryClient();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cardFields = kind.fields.filter((f) => f.list && ["customer", "employee", "user", "money", "date", "select", "product"].includes(f.type)).slice(0, 3);
  const move = async (id: string, stage: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r || r.stage === stage) return;
    qc.setQueriesData({ queryKey: recordsKey(r.app, r.kind) }, (old: any) => Array.isArray(old) ? old.map((x: AppRecord) => (x.id === id ? { ...x, stage } : x)) : old);
    try { await setStage(r, stage, kind.stages?.find((s) => s.key === stage)?.label); } catch (e) { toast.error(friendlyError(e)); }
    void qc.invalidateQueries({ queryKey: recordsKey(r.app, r.kind) });
  };
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {(kind.stages || []).map((s) => {
        const col = rows.filter((r) => (r.stage || kind.stages![0].key) === s.key);
        const total = col.reduce((a, r) => a + Number(r.amount || 0), 0);
        return (
          <div key={s.key} onDragOver={(e) => { e.preventDefault(); setOver(s.key); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (drag) void move(drag, s.key); setDrag(null); }}
            className={cn("flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/40 transition-colors", over === s.key ? "border-primary bg-primary/5" : "border-border")}>
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className={cn("h-2.5 w-2.5 rounded-full", TONES[s.tone].bar)} />
              <span className="flex-1 truncate text-sm font-semibold">{s.label}</span>
              <span className="rounded-full bg-background px-2 text-xs font-semibold tabular-nums">{col.length}</span>
              <button onClick={() => onNew(s.key)} className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`New in ${s.label}`}><Plus className="h-4 w-4" /></button>
            </div>
            {total > 0 && <p className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">{fmtMoney(total)}</p>}
            <div className="min-h-[60px] flex-1 space-y-2 px-2 pb-2">
              {col.map((r) => (
                <button key={r.id} draggable onDragStart={() => setDrag(r.id)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(r)}
                  className={cn("block w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md", drag === r.id && "opacity-50")}>
                  <p className="text-sm font-semibold leading-snug">{r.title || "Untitled"}</p>
                  {r.number && <p className="text-[11px] text-muted-foreground">{r.number}</p>}
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {cardFields.map((f) => { const v = fieldValue(r, f); return v ? <div key={f.key} className="truncate"><FieldDisplay field={f} value={v} labels={labels} /></div> : null; })}
                  </div>
                  {r.priority && ["High", "Urgent"].includes(r.priority) && <span className="mt-2 inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">{r.priority}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- calendar */

function Calendar({ kind, rows, onOpen, onNew }: { kind: KindDef; rows: AppRecord[]; onOpen: (r: AppRecord) => void; onNew: (date: string) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const start = new Date(month); start.setDate(1 - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dateOf = (r: AppRecord) => (r.starts_at ? key(new Date(r.starts_at)) : r.due_date ? String(r.due_date).slice(0, 10) : null);
  const byDay = new Map<string, AppRecord[]>();
  rows.forEach((r) => { const k = dateOf(r); if (k) byDay.set(k, [...(byDay.get(k) || []), r]); });
  const today = key(new Date());
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
        <p className="font-display font-semibold">{month.toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</p>
        <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = key(d);
          const items = byDay.get(k) || [];
          return (
            <div key={k} onDoubleClick={() => onNew(k)} className={cn("min-h-[92px] border-b border-r border-border p-1.5 text-xs", d.getMonth() !== month.getMonth() && "bg-muted/30 text-muted-foreground")}>
              <div className="flex items-center justify-between">
                <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full font-semibold", k === today && "bg-primary text-primary-foreground")}>{d.getDate()}</span>
                <button onClick={() => onNew(k)} className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:opacity-100 focus:opacity-100" aria-label="New on this day"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="mt-1 space-y-1">
                {items.slice(0, 3).map((r) => {
                  const st = kind.stages?.find((s) => s.key === r.stage);
                  return <button key={r.id} onClick={() => onOpen(r)} className={cn("block w-full truncate rounded-md px-1.5 py-0.5 text-left font-medium", st ? TONES[st.tone].chip : "bg-primary/10 text-primary")}>{r.title}</button>;
                })}
                {items.length > 3 && <p className="px-1 text-muted-foreground">+{items.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- record sheet */

function initialValues(kind: KindDef, rec: AppRecord | null, preset: Record<string, any>) {
  const v: Record<string, any> = { title: rec?.title || "", stage: rec?.stage || preset.stage || kind.stages?.[0]?.key || null };
  for (const f of kind.fields) {
    const cur = rec ? fieldValue(rec, f) : undefined;
    v[f.key] = cur !== undefined && cur !== null ? cur : (preset[f.key] ?? f.defaultValue ?? (f.type === "lines" ? [] : ""));
  }
  if (!rec && preset.__date) {
    const dateField = kind.fields.find((f) => f.column === "starts_at") || kind.fields.find((f) => f.column === "due_date");
    if (dateField) v[dateField.key] = dateField.type === "datetime" ? new Date(`${preset.__date}T09:00:00`).toISOString() : preset.__date;
  }
  return v;
}

function RecordSheet({ app, def, kind, record, preset, onClose, onOpenOther }: {
  app: string; def: AppDef; kind: KindDef; record: AppRecord | null; preset: Record<string, any>;
  onClose: () => void; onOpenOther: (path: string) => void;
}) {
  const qc = useQueryClient();
  const [rec, setRec] = useState<AppRecord | null>(record);
  const [values, setValues] = useState(() => initialValues(kind, record, preset));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(!record);
  const [tab, setTab] = useState<"details" | "related" | "activity">("details");
  const set = (k: string, v: any) => { setDirty(true); setValues((x) => ({ ...x, [k]: v })); };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["app-records", app] }); void qc.invalidateQueries({ queryKey: ["app-record-options", app] }); };

  // Expense claims total their lines.
  useEffect(() => {
    const lines = kind.fields.find((f) => f.type === "lines" && f.lineFields?.some((l) => l.key === "amount"));
    if (!lines || !kind.fields.some((f) => f.column === "amount")) return;
    const rows = values[lines.key];
    if (!Array.isArray(rows) || !rows.length) return;
    const total = rows.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
    const amountField = kind.fields.find((f) => f.column === "amount")!;
    if (Number(values[amountField.key] || 0) !== total) setValues((x) => ({ ...x, [amountField.key]: total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const save = async () => {
    const missing = kind.fields.find((f) => f.required && (values[f.key] === "" || values[f.key] === null || values[f.key] === undefined));
    if (!String(values.title || "").trim()) return toast.error(`Enter the ${(kind.titleLabel || "name").toLowerCase()}.`);
    if (missing) return toast.error(`${missing.label} is required.`);
    setSaving(true);
    try {
      const saved = await saveRecord(app, kind, values, rec);
      setRec(saved); setDirty(false); refresh();
      toast.success(rec ? "Saved" : `${kind.label} created${saved.number ? ` · ${saved.number}` : ""}`);
    } catch (e) { toast.error(friendlyError(e)); } finally { setSaving(false); }
  };

  const changeStage = async (s: StageDef) => {
    if (!rec) { set("stage", s.key); return; }
    try { await setStage(rec, s.key, s.label); setRec({ ...rec, stage: s.key }); setValues((x) => ({ ...x, stage: s.key })); refresh(); void qc.invalidateQueries({ queryKey: ["app-record-events", rec.id] }); }
    catch (e) { toast.error(friendlyError(e)); }
  };

  const remove = async () => {
    if (!rec || !(await confirmAction({ title: `Delete this ${kind.label.toLowerCase()}?`, message: "This cannot be undone. Archive it instead to keep the history.", confirmLabel: "Delete", danger: true }))) return;
    try { await deleteRecord(rec.id); refresh(); onClose(); toast.success("Deleted"); } catch (e) { toast.error(friendlyError(e)); }
  };
  const archive = async () => {
    if (!rec) return;
    try { await archiveRecord(rec.id, !rec.archived); refresh(); onClose(); toast.success(rec.archived ? "Restored" : "Archived"); } catch (e) { toast.error(friendlyError(e)); }
  };

  /* Special actions per app. */
  const special: { label: string; icon: any; run: () => Promise<void>; show: boolean }[] = [
    {
      label: "Produce now", icon: Factory, show: !!rec && app === "manufacturing" && kind.key === "mo" && rec.stage !== "done",
      run: async () => {
        if (dirty) await save();
        const { data, error } = await (supabase as any).rpc("mrp_produce", { p_mo: rec!.id });
        if (error) throw error;
        setRec(data); setValues(initialValues(kind, data, {})); refresh();
        toast.success("Produced", { description: `Stock updated. Cost ${fmtMoney(Number(data.amount || 0))}.` });
      },
    },
    {
      label: "Create invoice", icon: FileCheck, show: !!rec && app === "projects" && kind.key === "project",
      run: async () => {
        const { data, error } = await (supabase as any).rpc("project_invoice", { p_project: rec!.id });
        if (error) throw error;
        refresh();
        toast.success("Draft invoice created", { action: { label: "Open", onClick: () => onOpenOther(`/sales/invoices/${data}`) } });
      },
    },
    {
      label: "Hire as employee", icon: UserCheck, show: !!rec && app === "recruitment" && kind.key === "applicant" && rec.stage !== "hired",
      run: async () => {
        if (dirty) await save();
        const internal = !!rec!.employee_id;
        if (!(await confirmAction({ title: `Hire ${rec!.title}?`, message: internal ? "They are already on the staff list. They are marked hired; record the move under HRM → Promotions & Transfers." : "This creates the employee record, opens the onboarding checklist and copies their files (CV…) onto the employee.", confirmLabel: "Hire" }))) return;
        const { data, error } = await (supabase as any).rpc("hr_hire_applicant", { p_record: rec!.id });
        if (error) throw error;
        setRec({ ...rec!, stage: "hired", employee_id: data }); setValues((x) => ({ ...x, stage: "hired" })); refresh();
        void qc.invalidateQueries({ queryKey: ["app-record-events", rec!.id] });
        toast.success(internal ? "Marked hired" : "Employee created", { description: internal ? undefined : "The onboarding checklist is open under HRM → Onboarding & Exits.", action: { label: "Open", onClick: () => onOpenOther(`/hrm/employees/${data}`) } });
      },
    },
    {
      label: "Copy signing link", icon: Copy, show: !!rec && app === "sign" && kind.key === "request",
      run: async () => {
        const url = `${window.location.origin}/sign/${rec!.id}`;
        await navigator.clipboard.writeText(url);
        if (rec!.stage === "draft") { await setStage(rec!, "sent", "Sent"); setRec({ ...rec!, stage: "sent" }); refresh(); }
        toast.success("Signing link copied", { description: "Send it to the signer by SMS, WhatsApp or email." });
      },
    },
    {
      label: "Send for signature", icon: Send, show: !!rec && app === "contracts" && kind.key === "contract",
      run: async () => {
        const { data, error } = await (supabase as any).from("app_records").insert({ app: "sign", kind: "request", title: rec!.title, customer_id: rec!.customer_id, data: { _prefix: "SIGN-", body: rec!.data?.body || "", contract: rec!.id, signers: [] } }).select("id").single();
        if (error) throw error;
        await setStage(rec!, "signing", "Out for signature"); refresh();
        toast.success("Signature request created", { action: { label: "Open", onClick: () => onOpenOther(`/apps/sign/request?open=${data.id}`) } });
      },
    },
  ].filter((a) => a.show);

  const [running, setRunning] = useState<string | null>(null);
  const run = async (a: (typeof special)[number]) => {
    setRunning(a.label);
    try { await a.run(); } catch (e) { toast.error(friendlyError(e)); } finally { setRunning(null); }
  };

  const children = (kind.children || []).map((k) => def.kinds.find((x) => x.key === k)).filter(Boolean) as KindDef[];

  return (
    <Modal open onClose={() => { if (!dirty) return onClose(); void confirmAction({ title: "Close without saving?", message: "Your changes to this record will be lost.", confirmLabel: "Close", danger: true }).then((ok) => ok && onClose()); }} size="xl"
      title={rec ? (rec.title || kind.label) : `New ${kind.label.toLowerCase()}`}
      description={rec ? [rec.number, `Created ${new Date(rec.created_at).toLocaleDateString("en-KE")}`].filter(Boolean).join(" · ") : kind.description}
      footer={
        <>
          {rec && <button onClick={remove} className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /> Delete</button>}
          {rec && <button onClick={archive} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Archive className="h-4 w-4" /> {rec.archived ? "Restore" : "Archive"}</button>}
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Close</button>
          <button disabled={saving || (!dirty && !!rec)} onClick={save} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : rec ? "Save" : "Create"}</button>
        </>
      }>
      <div className="space-y-4">
        {kind.stages && (
          <div className="flex overflow-x-auto rounded-xl border border-border">
            {kind.stages.map((s, i) => {
              const curIdx = kind.stages!.findIndex((x) => x.key === values.stage);
              const on = s.key === values.stage;
              return (
                <button key={s.key} type="button" onClick={() => void changeStage(s)}
                  className={cn("relative flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold transition-colors",
                    i > 0 && "border-l border-border",
                    on ? "bg-primary text-primary-foreground" : i < curIdx && !s.done ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {special.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {special.map((a) => (
              <button key={a.label} disabled={!!running} onClick={() => void run(a)} className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50">
                <a.icon className="h-4 w-4" /> {running === a.label ? "Working…" : a.label}
              </button>
            ))}
          </div>
        )}

        {rec && (children.length > 0) && (
          <Segmented value={tab} onChange={setTab as any} options={[{ value: "details", label: "Details" }, { value: "related", label: "Related" }, { value: "activity", label: "Activity" }]} />
        )}
        {rec && !children.length && (
          <Segmented value={tab} onChange={setTab as any} options={[{ value: "details", label: "Details" }, { value: "activity", label: "Activity" }]} />
        )}

        {tab === "details" && rec && <RecordExtras app={app} kind={kind.key} rec={rec} onChange={() => { refresh(); void (async () => { const { data } = await (supabase as any).from("app_records").select("*").eq("id", rec.id).maybeSingle(); if (data) setRec(data); })(); }} />}
        {tab === "details" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium">{kind.titleLabel || "Name"}<span className="text-destructive">*</span></span>
              <input autoFocus={!rec} className="fi text-base font-semibold" value={values.title} onChange={(e) => set("title", e.target.value)} />
            </label>
            {kind.fields.map((f) => (
              <FieldRow key={f.key} app={app} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        )}
        {tab === "related" && rec && children.map((ck) => <Related key={ck.key} app={app} kind={ck} parent={rec} onOpenOther={onOpenOther} />)}
        {tab === "activity" && rec && <Timeline recordId={rec.id} />}
      </div>
    </Modal>
  );
}

function FieldRow({ app, field, value, onChange }: { app: string; field: FieldDef; value: any; onChange: (v: any) => void }) {
  const wide = !field.half || ["lines", "textarea", "signature", "multiselect"].includes(field.type);
  return (
    <label className={cn("block space-y-1.5", wide && "sm:col-span-2")} onClick={(e) => { if (["lines", "signature", "multiselect", "rating"].includes(field.type)) e.preventDefault(); }}>
      <span className="text-sm font-medium">{field.label}{field.required && <span className="text-destructive">*</span>}</span>
      <FieldInput app={app} field={field} value={value} onChange={onChange} />
      {field.help && <span className="block text-xs text-muted-foreground">{field.help}</span>}
    </label>
  );
}

function Related({ app, kind, parent, onOpenOther }: { app: string; kind: KindDef; parent: AppRecord; onOpenOther: (p: string) => void }) {
  const { data: rows = [] } = useRecords(app, kind.key, { parentId: parent.id });
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    try {
      const values: Record<string, any> = { title };
      const pf = kind.fields.find((f) => f.column === "parent_id");
      if (pf) values[pf.key] = parent.id;
      await saveRecord(app, kind, values);
      setTitle(""); void qc.invalidateQueries({ queryKey: ["app-records", app] });
    } catch (e) { toast.error(friendlyError(e)); }
  };
  const doneKeys = new Set((kind.stages || []).filter((s) => s.done).map((s) => s.key));
  const done = rows.filter((r) => r.stage && doneKeys.has(r.stage)).length;
  const hours = rows.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const money = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  return (
    <div className="rounded-2xl border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold">{kind.plural} <span className="text-muted-foreground">({rows.length})</span></p>
        <p className="text-xs text-muted-foreground">
          {kind.stages && rows.length > 0 && `${done}/${rows.length} done`}
          {kind.key === "timesheet" && ` · ${hours} h`}
          {money > 0 && ` · ${fmtMoney(money)}`}
        </p>
      </div>
      {kind.stages && rows.length > 0 && <div className="h-1 bg-muted"><div className="h-1 bg-primary" style={{ width: `${(done / rows.length) * 100}%` }} /></div>}
      <ul className="divide-y divide-border">
        {rows.slice(0, 50).map((r) => (
          <li key={r.id}>
            <button onClick={() => onOpenOther(`/apps/${app}/${kind.key}?open=${r.id}`)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/50">
              <span className="flex-1 truncate">{r.title}</span>
              {r.quantity != null && kind.key === "timesheet" && <span className="text-xs tabular-nums text-muted-foreground">{r.quantity} h</span>}
              {r.amount != null && Number(r.amount) > 0 && <span className="text-xs tabular-nums text-muted-foreground">{fmtMoney(Number(r.amount))}</span>}
              <StageChip kind={kind} stage={r.stage} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border p-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} placeholder={`Quick add ${kind.label.toLowerCase()}…`} className="fi h-9" />
        <button onClick={() => void add()} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Timeline({ recordId }: { recordId: string }) {
  const { data: events = [], refetch } = useRecordEvents(recordId);
  const [body, setBody] = useState("");
  const post = async () => {
    if (!body.trim()) return;
    try { await addComment(recordId, body.trim()); setBody(""); await refetch(); } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Write a note or update for the team…" className="fi min-h-[60px]" />
        <button onClick={() => void post()} className="self-end rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><MessageSquare className="h-4 w-4" /></button>
      </div>
      <ol className="relative space-y-3 border-l-2 border-border pl-4">
        {events.slice().reverse().map((e) => (
          <li key={e.id} className="relative">
            <span className={cn("absolute -left-[23px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-card", e.kind === "comment" ? "bg-primary" : "bg-muted-foreground")} />
            <p className="text-sm">{e.body}</p>
            <p className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</p>
          </li>
        ))}
        {!events.length && <li className="text-sm text-muted-foreground"><History className="mr-1 inline h-4 w-4" />No activity yet.</li>}
      </ol>
    </div>
  );
}
