import { useState } from "react";
import { useSelection, BulkBar, TickAllCell, TickCell } from "@/components/Bulk";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowUp, ArrowDown, Settings2, Clock, CheckCircle2 } from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { sb, useCrmConfig, useOpenActivities, useLeads, useCrmInvalidate, activityState, STATE_COLOR, TAG_COLORS, COLOR_NAMES } from "./crmData";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const TABS = [["stages", "Stages"], ["tags", "Tags"], ["lost", "Lost Reasons"], ["types", "Activity Types"], ["teams", "Sales Teams"]] as const;

export default function CrmConfig() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cfg, isLoading } = useCrmConfig();
  const [tab, setTab] = useState<string>("stages");
  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-config"] });
  const run = async (p: Promise<any>) => { const { error } = await p; if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); refresh(); };
  if (isLoading || !cfg) return <OrbLoader label="Loading configuration…" />;
  const add = (table: string, row: Record<string, unknown>) => run(sb.from(table).insert({ tenant_id: tenantId, ...row }));
  const upd = (table: string, id: string, row: Record<string, unknown>) => run(sb.from(table).update(row).eq("id", id));
  const del = async (table: string, id: string, what: string) => { if (await confirmAction({ title: `Delete ${what}?`, danger: true, confirmLabel: "Delete" })) await run(sb.from(table).delete().eq("id", id)); };

  return (
    <div className="space-y-5">
      <PageHeader title="CRM Configuration" icon={Settings2} description="Stages, tags, lost reasons, activity types and sales teams." />
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cn("border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{l}</button>)}
      </div>

      {tab === "stages" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="dt dt-keep"><thead><tr><th>Sequence</th><th>Stage Name</th><th>Is Won Stage?</th><th>Folded in Pipeline</th><th>Requirements</th><th /></tr></thead>
            <tbody>{cfg.stages.map((s, i) => (
              <tr key={s.id}>
                <td><div className="flex gap-1">
                  <button className="icon-btn" disabled={i === 0} onClick={async () => { const p = cfg.stages[i - 1]; await upd("crm_stages", s.id, { sequence: p.sequence }); await upd("crm_stages", p.id, { sequence: s.sequence === p.sequence ? s.sequence + 1 : s.sequence }); }} aria-label="Up"><ArrowUp className="h-4 w-4" /></button>
                  <button className="icon-btn" disabled={i === cfg.stages.length - 1} onClick={async () => { const n = cfg.stages[i + 1]; await upd("crm_stages", s.id, { sequence: n.sequence }); await upd("crm_stages", n.id, { sequence: s.sequence === n.sequence ? s.sequence - 1 : s.sequence }); }} aria-label="Down"><ArrowDown className="h-4 w-4" /></button>
                </div></td>
                <td><input className="fi h-8" defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && upd("crm_stages", s.id, { name: e.target.value.trim() })} /></td>
                <td><Switch checked={s.is_won} onCheckedChange={(v) => upd("crm_stages", s.id, { is_won: v })} /></td>
                <td><Switch checked={s.fold} onCheckedChange={(v) => upd("crm_stages", s.id, { fold: v })} /></td>
                <td><input className="fi h-8" defaultValue={s.requirements || ""} placeholder="Shown as a tip on the stage" onBlur={(e) => upd("crm_stages", s.id, { requirements: e.target.value || null })} /></td>
                <td><button className="icon-btn-danger" onClick={() => del("crm_stages", s.id, s.name)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody></table>
          <div className="p-3"><Button size="sm" variant="outline" onClick={() => add("crm_stages", { name: "New stage", sequence: (cfg.stages.at(-1)?.sequence || 0) + 1 })}><Plus /> Add a line</Button></div>
        </div>
      )}

      {tab === "tags" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="dt dt-keep"><thead><tr><th>Tag Name</th><th>Color</th><th /></tr></thead>
            <tbody>{cfg.tags.map((t) => (
              <tr key={t.id}>
                <td><input className="fi h-8" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && upd("crm_tags", t.id, { name: e.target.value.trim() })} /></td>
                <td><div className="flex flex-wrap gap-1">{TAG_COLORS.map((c, i) => <button key={i} title={COLOR_NAMES[i]} onClick={() => upd("crm_tags", t.id, { color: i })} className={cn("h-5 w-5 rounded-full border", t.color === i ? "ring-2 ring-primary ring-offset-1" : "border-border")} style={{ background: i ? c : "transparent" }} />)}</div></td>
                <td><button className="icon-btn-danger" onClick={() => del("crm_tags", t.id, t.name)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody></table>
          <div className="p-3"><Button size="sm" variant="outline" onClick={() => add("crm_tags", { name: `Tag ${cfg.tags.length + 1}`, color: (cfg.tags.length % 11) + 1 })}><Plus /> Add a line</Button></div>
        </div>
      )}

      {tab === "lost" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="dt dt-keep"><thead><tr><th>Description</th><th>Active</th><th /></tr></thead>
            <tbody>{cfg.lostReasons.map((r) => (
              <tr key={r.id}>
                <td><input className="fi h-8" defaultValue={r.name} onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && upd("crm_lost_reasons", r.id, { name: e.target.value.trim() })} /></td>
                <td><Switch checked={r.active} onCheckedChange={(v) => upd("crm_lost_reasons", r.id, { active: v })} /></td>
                <td><button className="icon-btn-danger" onClick={() => del("crm_lost_reasons", r.id, r.name)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody></table>
          <div className="p-3"><Button size="sm" variant="outline" onClick={() => add("crm_lost_reasons", { name: "New reason" })}><Plus /> Add a line</Button></div>
        </div>
      )}

      {tab === "types" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="dt dt-keep"><thead><tr><th>Name</th><th>Schedule after (days)</th><th>Active</th><th /></tr></thead>
            <tbody>{cfg.activityTypes.map((t) => (
              <tr key={t.id}>
                <td><input className="fi h-8" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && upd("crm_activity_types", t.id, { name: e.target.value.trim() })} /></td>
                <td><input className="fi h-8 w-24" type="number" min={0} defaultValue={t.default_days} onBlur={(e) => upd("crm_activity_types", t.id, { default_days: Number(e.target.value) || 0 })} /></td>
                <td><Switch checked={t.active} onCheckedChange={(v) => upd("crm_activity_types", t.id, { active: v })} /></td>
                <td><button className="icon-btn-danger" onClick={() => del("crm_activity_types", t.id, t.name)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody></table>
          <div className="p-3"><Button size="sm" variant="outline" onClick={() => add("crm_activity_types", { name: "New activity", sequence: cfg.activityTypes.length + 1 })}><Plus /> Add a line</Button></div>
        </div>
      )}

      {tab === "teams" && (
        <div className="space-y-3">
          {cfg.teams.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input className="fi max-w-xs font-semibold" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && upd("crm_teams", t.id, { name: e.target.value.trim() })} />
                <label className="text-sm">Team Leader <select className="fi ml-2 inline-block w-48" value={t.leader_id || ""} onChange={(e) => upd("crm_teams", t.id, { leader_id: e.target.value || null })}><option value="">—</option>{cfg.users.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select></label>
                <label className="text-sm">Invoicing target <input className="fi ml-2 inline-block w-36" type="number" defaultValue={t.invoiced_target} onBlur={(e) => upd("crm_teams", t.id, { invoiced_target: Number(e.target.value) || 0 })} /></label>
                <span className="flex-1" />
                <button className="icon-btn-danger" onClick={() => del("crm_teams", t.id, t.name)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
              <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Members</p>
              <div className="flex flex-wrap gap-2">{cfg.users.map((u) => {
                const on = t.member_ids?.includes(u.user_id);
                return <button key={u.user_id} onClick={() => upd("crm_teams", t.id, { member_ids: on ? t.member_ids.filter((x) => x !== u.user_id) : [...(t.member_ids || []), u.user_id] })}
                  className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>{u.display_name}</button>;
              })}</div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => add("crm_teams", { name: "New team", member_ids: [] })}><Plus /> New team</Button>
        </div>
      )}
    </div>
  );
}

/** My Activities: every open CRM activity assigned to me. */
const ACT_TABS = [["all", "All"], ["To-Do", "Tasks"], ["Meeting", "Meetings"], ["Call", "Calls"], ["Email", "Emails"], ["Site visit", "Visits"]] as const;
export function MyActivities({ preset = "all" }: { preset?: string }) {
  const { user } = useAuth() as any;
  const navigate = useNavigate();
  const { data: cfg } = useCrmConfig();
  const { data: acts = [], isLoading } = useOpenActivities();
  const { data: leads = [] } = useLeads("all", true);
  const invalidate = useCrmInvalidate();
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<string>(preset);
  const typeName = (a: any) => cfg?.activityTypes.find((t) => t.id === a.type_id)?.name || "";
  const mine = (acts as any[]).filter((a) => (all || a.assigned_to === user?.id) && (kind === "all" || typeName(a).toLowerCase() === kind.toLowerCase()));
  const sel = useSelection(mine.map((a) => a.id));
  const doneMany = async () => { await sb.from("crm_activities").update({ done: true, done_at: new Date().toISOString() }).in("id", sel.ids); sel.clear(); invalidate(); };
  const reassign = async (uid: string) => { await sb.from("crm_activities").update({ assigned_to: uid }).in("id", sel.ids); sel.clear(); invalidate(); };
  const done = async (id: string) => { await sb.from("crm_activities").update({ done: true, done_at: new Date().toISOString() }).eq("id", id); invalidate(); };
  if (isLoading) return <OrbLoader label="Loading activities…" />;
  const groups = (["overdue", "today", "planned"] as const).map((st) => ({ st, items: mine.filter((a) => activityState([a]) === st) }));
  return (
    <div className="space-y-5">
      <PageHeader title={ACT_TABS.find(([k]) => k === kind)?.[1] === "All" ? "Activities & Tasks" : ACT_TABS.find(([k]) => k === kind)?.[1] || "Activities"} icon={Clock} description="Tasks, meetings, calls, emails and visits on your leads and opportunities."
        actions={<label className="flex items-center gap-2 text-sm"><Switch checked={all} onCheckedChange={setAll} /> Everyone's</label>} />
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {ACT_TABS.map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${kind === k ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{l}</button>)}
      </div>
      {sel.count > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border"><BulkBar sel={sel} noun="activity">
          <Button size="sm" variant="outline" onClick={() => void doneMany()}><CheckCircle2 /> Mark done</Button>
          <select className="fi h-8 w-44 text-xs" value="" onChange={(e) => e.target.value && void reassign(e.target.value)} aria-label="Reassign"><option value="">Reassign to…</option>{(cfg?.users || []).map((u: any) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select>
        </BulkBar></div>
      )}
      {mine.length === 0 ? <EmptyState icon={CheckCircle2} title="You're all caught up" description="Schedule activities from an opportunity's chatter." /> : groups.map((g) => g.items.length > 0 && (
        <section key={g.st} className="overflow-hidden rounded-2xl border border-border bg-card">
          <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOR[g.st] }} />{g.st === "overdue" ? "Overdue" : g.st === "today" ? "Today" : "Future"} <span className="rounded-full bg-muted px-2 text-xs">{g.items.length}</span></p>
          <table className="dt"><thead><tr><TickAllCell sel={sel} /><th>Due</th><th>Type</th><th>Summary</th><th>Opportunity</th><th>Assigned to</th><th /></tr></thead>
            <tbody><PagedRows rows={g.items} colSpan={6}>{(pageRows) => pageRows.map((a: any) => {
              const l = (leads as any[]).find((x) => x.id === a.lead_id);
              return (
                <tr key={a.id} className={sel.has(a.id) ? "bg-primary/5" : undefined}><TickCell sel={sel} id={a.id} /><td>{new Date(a.due_date).toLocaleDateString("en-GB")}</td><td>{cfg?.activityTypes.find((t) => t.id === a.type_id)?.name}</td><td>{a.summary || ""}</td>
                  <td><button className="font-semibold text-primary" onClick={() => navigate(`/crm/lead/${a.lead_id}`)}>{l?.name || "Open"}</button></td>
                  <td>{cfg?.users.find((u) => u.user_id === a.assigned_to)?.display_name}</td>
                  <td><Button size="sm" variant="outline" onClick={() => done(a.id)}><CheckCircle2 /> Done</Button></td></tr>
              );
            })}</PagedRows></tbody></table>
        </section>
      ))}
    </div>
  );
}
