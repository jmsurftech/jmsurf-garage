import { useState } from "react";
import { Link } from "react-router-dom";
import { StickyNote, Plus, Bell, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";
import { COLORS, useNoteActions, useNotes, useNotesDue, whenLabel } from "./notebookData";

/** Top-bar notebook: jot a note in one go, see the latest and what is due. */
export function NotebookLauncher() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { data = [], isFetched } = useNotes(open);
  const { data: due = 0 } = useNotesDue();
  const act = useNoteActions();
  const live = data.filter((n) => !n.done);
  const add = async () => {
    const t = text.trim(); if (!t) return;
    try { await act.add({ body: t, color: "yellow" }); setText(""); toast.success("Note saved"); } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Notebook" title="Notebook">
          <StickyNote className="h-5 w-5" />
          {due > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{due}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className={cn("rounded-xl border-2 p-2", COLORS.yellow.paper)}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Quick note…" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-foreground/50" />
          <div className="flex justify-end"><button disabled={!text.trim()} onClick={() => void add()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Save</button></div>
        </div>
        <ul className="mt-3 max-h-72 space-y-1.5 overflow-auto">
          {live.slice(0, 6).map((n) => (
            <li key={n.id}>
              <Link to={`/notebook?note=${n.id}`} onClick={() => setOpen(false)} className={cn("block rounded-lg border px-2.5 py-1.5 text-xs hover:shadow-sm", COLORS[n.color]?.paper)}>
                <span className="line-clamp-2 font-medium">{n.title || n.body || "Note"}</span>
                {n.remind_at && !n.reminded_at && <span className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground/70"><Bell className="h-3 w-3" /> {whenLabel(n.remind_at)}</span>}
              </Link>
            </li>
          ))}
          {!live.length && isFetched && <li className="py-2 text-center text-xs text-muted-foreground">No notes yet.</li>}
        </ul>
        <Link to="/notebook" onClick={() => setOpen(false)} className="mt-2 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold text-primary hover:bg-primary/5">Open Notebook <ArrowRight className="h-3.5 w-3.5" /></Link>
      </PopoverContent>
    </Popover>
  );
}
