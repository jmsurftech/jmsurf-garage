import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StickyNote, Plus, Pin, PinOff, Bell, BellOff, Trash2, Check, Search, Tag, Palette, Mail, MessageSquare, Smartphone, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Modal, Field, Segmented, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbLoader } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";
import { COLORS, TAGS, useNoteActions, useNotes, whenLabel, type Note, type NoteColor } from "./notebookData";

type View = "all" | "pinned" | "reminders" | "done";

/** Notebook: sticky notes for the day's tasks and anything else, with colours, tags and reminders. */
export default function Notebook() {
  const { data = [], isLoading } = useNotes();
  const act = useNoteActions();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<NoteColor>("yellow");
  const [reminding, setReminding] = useState<Note | null>(null);
  const focusId = params.get("note");

  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => { document.getElementById(`note-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 300);
    return () => clearTimeout(t);
  }, [focusId, data.length]);

  const tags = useMemo(() => [...new Set(data.map((n) => n.tag).filter(Boolean) as string[])].sort(), [data]);
  const shown = data.filter((n) => (view === "all" ? !n.done : view === "pinned" ? n.pinned && !n.done : view === "reminders" ? !!n.remind_at && !n.done : n.done)
    && (!tag || n.tag === tag) && (!q.trim() || `${n.title || ""} ${n.body} ${n.tag || ""}`.toLowerCase().includes(q.trim().toLowerCase())));

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const [first, ...rest] = text.split("\n");
      await act.add(rest.length ? { title: first.slice(0, 120), body: rest.join("\n").trim(), color, tag: tag || null } : { body: text, color, tag: tag || null });
      setDraft("");
    } catch (e) { toast.error(friendlyError(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Notebook" icon={StickyNote} description="Your own notes: tasks of the day, follow-ups and ideas. Colour them, tag them, pin them, and set a reminder by alert, email or SMS. Only you see your notes." />
      <div className={cn("rounded-2xl border-2 p-3 shadow-sm", COLORS[color].paper)}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Write a note… (the first line becomes the title when there is more than one line)"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}
          className="w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-foreground/50" />
        <div className="flex flex-wrap items-center gap-2">
          <ColorDots value={color} onChange={setColor} />
          <span className="ml-auto text-xs text-foreground/60">Ctrl + Enter to save</span>
          <Button size="sm" disabled={!draft.trim()} onClick={() => void add()}><Plus /> Add note</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View> value={view} onChange={setView} options={[
          { value: "all", label: "Notes", count: data.filter((n) => !n.done).length }, { value: "pinned", label: "Pinned", count: data.filter((n) => n.pinned && !n.done).length },
          { value: "reminders", label: "Reminders", count: data.filter((n) => n.remind_at && !n.done).length }, { value: "done", label: "Done", count: data.filter((n) => n.done).length },
        ]} />
        {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((t) => <button key={t} onClick={() => setTag(tag === t ? null : t)} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}><Tag className="h-3 w-3" />{t}</button>)}</div>}
        <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {isLoading ? <OrbLoader /> : shown.length === 0 ? (
        <EmptyState icon={StickyNote} title={view === "done" ? "Nothing done yet" : "No notes here"} description="Write your first note above: a task for today, a call to make, an idea." />
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {shown.map((n) => <NoteCard key={n.id} n={n} focus={n.id === focusId} onRemind={() => setReminding(n)} onUnfocus={() => { if (focusId) { params.delete("note"); setParams(params, { replace: true }); } }} />)}
        </div>
      )}
      {reminding && <ReminderModal n={reminding} onClose={() => setReminding(null)} />}
    </div>
  );
}

function ColorDots({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
      <Palette className="h-4 w-4 text-foreground/60" />
      {(Object.keys(COLORS) as NoteColor[]).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLORS[c].label} title={COLORS[c].label} onClick={() => onChange(c)}
          className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-transparent transition-transform hover:scale-110", COLORS[c].dot, value === c && "ring-2 ring-foreground/70")} />
      ))}
    </div>
  );
}

function NoteCard({ n, focus, onRemind, onUnfocus }: { n: Note; focus: boolean; onRemind: () => void; onUnfocus: () => void }) {
  const act = useNoteActions();
  const [title, setTitle] = useState(n.title || "");
  const [body, setBody] = useState(n.body);
  const [colors, setColors] = useState(false);
  const [tagging, setTagging] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTitle(n.title || ""); setBody(n.body); }, [n.title, n.body]);
  // Grow the text box with its text.
  useEffect(() => { const el = bodyRef.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }, [body]);
  const save = (patch: Partial<Note>) => void act.update(n.id, patch).catch((e) => toast.error(friendlyError(e)));
  const blurSave = () => { if (title !== (n.title || "") || body !== n.body) save({ title: title.trim() || null, body }); };
  const overdue = n.remind_at && !n.reminded_at && new Date(n.remind_at) < new Date();
  return (
    <article id={`note-${n.id}`} onClick={onUnfocus}
      className={cn("group mb-4 break-inside-avoid rounded-2xl border-2 p-4 shadow-sm transition-shadow hover:shadow-md", COLORS[n.color]?.paper || COLORS.yellow.paper, n.done && "opacity-70", focus && "ring-4 ring-primary/40")}>
      <div className="flex items-start gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={blurSave} placeholder="Title"
          className={cn("min-w-0 flex-1 bg-transparent text-[15px] font-bold outline-none placeholder:font-normal placeholder:text-foreground/40", n.done && "line-through")} />
        <button onClick={() => save({ pinned: !n.pinned })} className={cn("rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/10", n.pinned ? "text-foreground" : "text-foreground/40 opacity-0 group-hover:opacity-100")} aria-label={n.pinned ? "Unpin" : "Pin"} title={n.pinned ? "Unpin" : "Pin to the top"}>
          {n.pinned ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
        </button>
      </div>
      <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} onBlur={blurSave} rows={2} placeholder="Write here…"
        className={cn("mt-1 w-full resize-none overflow-hidden bg-transparent text-sm leading-6 outline-none placeholder:text-foreground/40", n.done && "line-through decoration-1")} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {n.tag && <button onClick={() => setTagging(true)} className="inline-flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 font-medium dark:bg-white/15"><Tag className="h-3 w-3" />{n.tag}</button>}
        {n.remind_at && (
          <button onClick={onRemind} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", n.reminded_at ? "bg-black/10 dark:bg-white/15" : overdue ? "bg-destructive/20 text-destructive" : "bg-primary/15 text-primary")}>
            <Bell className="h-3 w-3" />{whenLabel(n.remind_at)}{n.reminded_at ? " · sent" : ""}
          </button>
        )}
        {n.remind_error && <span className="inline-flex items-center gap-1 text-destructive" title={n.remind_error}><AlertTriangle className="h-3 w-3" /> Not all sent</span>}
      </div>
      {tagging && (
        <div className="mt-2 flex flex-wrap gap-1">
          {TAGS.map((t) => <button key={t} onClick={() => { save({ tag: n.tag === t ? null : t }); setTagging(false); }} className={cn("rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20", n.tag === t && "bg-foreground text-background")}>{t}</button>)}
          <input className="w-28 rounded-full border border-black/15 bg-transparent px-2 py-0.5 text-xs outline-none dark:border-white/20" placeholder="Own tag + Enter"
            onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) { save({ tag: v.slice(0, 30) }); setTagging(false); } } }} />
        </div>
      )}
      {colors && <div className="mt-2"><ColorDots value={n.color} onChange={(c) => { save({ color: c }); setColors(false); }} /></div>}
      <div className="mt-3 flex items-center gap-0.5 border-t border-black/10 pt-2 text-foreground/70 dark:border-white/10">
        <IconBtn label={n.done ? "Not done" : "Mark done"} onClick={() => save({ done: !n.done })}><Check className={cn("h-4 w-4", n.done && "text-success")} /></IconBtn>
        <IconBtn label="Colour" onClick={() => setColors(!colors)}><Palette className="h-4 w-4" /></IconBtn>
        <IconBtn label="Tag" onClick={() => setTagging(!tagging)}><Tag className="h-4 w-4" /></IconBtn>
        <IconBtn label={n.remind_at ? "Change reminder" : "Remind me"} onClick={onRemind}><Bell className="h-4 w-4" /></IconBtn>
        <span className="ml-auto text-[11px] text-foreground/50">{new Date(n.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
        <IconBtn label="Delete" onClick={async () => { if (await confirmAction({ title: "Delete this note?", danger: true, confirmLabel: "Delete" })) void act.remove(n.id).catch((e) => toast.error(friendlyError(e))); }}><Trash2 className="h-4 w-4" /></IconBtn>
      </div>
    </article>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-lg p-1.5 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">{children}</button>;
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Reminder: date and time, how to be told (in-app alert, email, SMS), and a tag. */
export function ReminderModal({ n, onClose }: { n: Note; onClose: () => void }) {
  const act = useNoteActions();
  const [at, setAt] = useState(n.remind_at ? localInput(new Date(n.remind_at)) : localInput(new Date(Date.now() + 3600_000)));
  const [by, setBy] = useState<string[]>(n.remind_by?.length ? n.remind_by : ["app"]);
  const [tag, setTag] = useState(n.tag || "");
  const quick: [string, () => Date][] = [
    ["In 1 hour", () => new Date(Date.now() + 3600_000)],
    ["This evening", () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; }],
    ["Tomorrow 9:00", () => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); return d; }],
    ["Next week", () => { const d = new Date(Date.now() + 7 * 86400000); d.setHours(9, 0, 0, 0); return d; }],
  ];
  const toggle = (k: string) => setBy((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]));
  const save = async () => {
    const when = new Date(at);
    if (isNaN(when.getTime())) return toast.error("Choose the date and time");
    if (!by.length) return toast.error("Choose at least one way to be reminded");
    try {
      await act.update(n.id, { remind_at: when.toISOString(), remind_by: by, reminded_at: null, remind_error: null, tag: tag.trim() || null } as any);
      toast.success("Reminder set", { description: `${whenLabel(when.toISOString())} by ${by.map((x) => (x === "app" ? "alert" : x === "sms" ? "SMS" : "email")).join(", ")}` });
      onClose();
    } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Remind me" icon={Bell} size="md"
      footer={<>{n.remind_at && <Button variant="ghost" className="mr-auto" onClick={async () => { await act.update(n.id, { remind_at: null, reminded_at: null, remind_error: null } as any); onClose(); }}><BellOff /> Remove reminder</Button>}<Button onClick={() => void save()}><Bell /> Set reminder</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">{quick.map(([l, f]) => <button key={l} type="button" onClick={() => setAt(localInput(f()))} className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted">{l}</button>)}</div>
        <Field label="Date and time"><input type="datetime-local" className="fi" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">Tell me by</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {([["app", Smartphone, "In-app alert"], ["email", Mail, "Email"], ["sms", MessageSquare, "SMS"]] as const).map(([k, Icon, l]) => (
              <button key={k} type="button" onClick={() => toggle(k)} className={cn("flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-medium", by.includes(k) ? "border-primary bg-primary/5" : "border-border")}>
                <Icon className="h-4 w-4" /> {l}{by.includes(k) && <Check className="ml-auto h-4 w-4 text-primary" />}
              </button>
            ))}
          </div>
          {by.includes("sms") && <p className="mt-1.5 text-xs text-muted-foreground">Sent to the phone number in My profile, from the company's SMS balance.</p>}
        </div>
        <Field label="Tag"><input className="fi" list="note-tags" value={tag} placeholder="e.g. Today, Follow-up, Call" onChange={(e) => setTag(e.target.value)} /><datalist id="note-tags">{TAGS.map((t) => <option key={t} value={t} />)}</datalist></Field>
      </div>
    </Modal>
  );
}
