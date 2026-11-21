import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/kit";
import Pager from "@/components/Pager";
import { adminCall, actionLabel, roleLabel } from "@/lib/adminApi";
import { confirmAction } from "@/components/books/confirm";

type Data = {
  notes: { id: string; body: string; author_id: string | null; created_at: string }[];
  actions: { id: string; admin_id: string | null; action: string; target_type: string; target_id: string | null; detail: any; created_at: string }[];
  names: Record<string, string>;
};

/** A short line about what changed, from the action's details (never a password or a link). */
function detailText(a: Data["actions"][number], names: Record<string, string>): string {
  const d = a.detail || {};
  const who = a.target_type === "user" && a.target_id ? names[a.target_id] || d.email || "" : "";
  const bits: string[] = [];
  if (who) bits.push(who);
  if (d.role) bits.push(roleLabel(d.role));
  if (d.from !== undefined && d.to !== undefined && a.action === "user_role") bits.push(`${roleLabel(d.from)} → ${roleLabel(d.to)}`);
  if (d.after?.plan) bits.push(`${d.after.plan} · ${d.after.status}${d.after.ends ? ` to ${format(new Date(d.after.ends), "d MMM yyyy")}` : ""}`);
  if (d.until) bits.push(`to ${format(new Date(d.until), "d MMM yyyy")}`);
  if (d.to && a.action === "trial_set") bits.push(`to ${format(new Date(d.to), "d MMM yyyy")}`);
  if (d.name || d.module) bits.push(d.name || d.module);
  if (d.units) bits.push(`${d.units > 0 ? "+" : ""}${d.units} SMS`);
  if (d.reference) bits.push(d.reference);
  if (d.amount) bits.push(`KSh ${Number(d.amount).toLocaleString()}`);
  if (d.reason) bits.push(d.reason);
  if (d.note) bits.push(d.note);
  if (d.method) bits.push(d.method === "password" ? "one-time password" : "set-password link");
  if (d.changed && typeof d.changed === "object") bits.push(Object.keys(d.changed).map((k) => k.replace(/_/g, " ")).join(", "));
  return bits.filter(Boolean).join(" · ");
}

/** Admin → company → Notes & activity: private notes, and every change made from the admin console. */
export default function CompanyActivity({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const key = ["admin-company-activity", tenantId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => adminCall<Data>("companies/notes", { tenant_id: tenantId }) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const names = data?.names || {};
  const actions = data?.actions || [];

  const add = async () => {
    setBusy(true);
    try { await adminCall("companies/note-add", { tenant_id: tenantId, body: text.trim() }); setText(""); void qc.invalidateQueries({ queryKey: key }); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!(await confirmAction({ title: "Delete this note?", confirmLabel: "Delete", danger: true }))) return;
    try { await adminCall("companies/note-delete", { tenant_id: tenantId, id }); void qc.invalidateQueries({ queryKey: key }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Panel className="lg:col-span-2" title="Notes" icon={StickyNote} description="Private to the platform owners. The company never sees them.">
        <textarea className="fi min-h-[80px]" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter a note" />
        <div className="mt-2 flex justify-end"><Button size="sm" onClick={add} disabled={busy || !text.trim()}>{busy ? "Saving…" : "Add note"}</Button></div>
        <ul className="mt-3 space-y-2">
          {(data?.notes || []).map((n) => (
            <li key={n.id} className="group rounded-xl border border-border p-3">
              <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{n.author_id ? names[n.author_id] || "Platform owner" : "Platform owner"} · {format(new Date(n.created_at), "d MMM yyyy, HH:mm")}</span>
                <button className="ml-auto rounded p-1 opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" onClick={() => void remove(n.id)} aria-label="Delete note"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
          {data && !data.notes.length && <li className="py-4 text-center text-sm text-muted-foreground">No notes yet.</li>}
        </ul>
      </Panel>

      <Panel flush className="lg:col-span-3" title="Activity" icon={Activity} description="Every change made for this company from the admin console: who, what and when.">
        {error ? <EmptyState icon={Activity} title="Could not load the activity" description={(error as Error).message} />
          : !actions.length ? <EmptyState icon={Activity} title={isLoading ? "Loading…" : "Nothing yet"} />
          : (
            <>
              <ol className="divide-y divide-border">
                {actions.slice((page - 1) * size, page * size).map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/70" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{actionLabel(a.action)}</p>
                      {detailText(a, names) && <p className="truncate text-xs text-muted-foreground" title={detailText(a, names)}>{detailText(a, names)}</p>}
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      <p>{format(new Date(a.created_at), "d MMM yyyy, HH:mm")}</p>
                      <p className="max-w-[140px] truncate">{a.admin_id ? names[a.admin_id] || "Platform owner" : "System"}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Pager page={page} pageSize={size} total={actions.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} className="border-t border-border px-3 py-2" />
            </>
          )}
      </Panel>
    </div>
  );
}
