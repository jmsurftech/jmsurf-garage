import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tick boxes on any list: which rows are picked, pick all on the page, clear. */
export function useSelection(visibleIds: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = visibleIds.join(",");
  // Rows that left the list (filter, delete) drop out of the selection.
  useEffect(() => {
    setPicked((p) => { const keep = new Set([...p].filter((id) => visibleIds.includes(id))); return keep.size === p.size ? p : keep; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = useCallback((id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const someOn = !allOn && visibleIds.some((id) => picked.has(id));
  const toggleAll = useCallback(() => setPicked((p) => {
    const n = new Set(p);
    if (visibleIds.every((id) => n.has(id))) visibleIds.forEach((id) => n.delete(id)); else visibleIds.forEach((id) => n.add(id));
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [key]);
  const clear = useCallback(() => setPicked(new Set()), []);
  const ids = useMemo(() => [...picked], [picked]);
  return { picked, ids, count: picked.size, has: (id: string) => picked.has(id), toggle, toggleAll, allOn, someOn, clear };
}

export type Selection = ReturnType<typeof useSelection>;

/** A tick box that does not open the row when clicked. */
export function Tick({ on, mixed, onChange, label }: { on: boolean; mixed?: boolean; onChange: () => void; label?: string }) {
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <input type="checkbox" aria-label={label || "Select"} checked={on} ref={(el) => { if (el) el.indeterminate = !!mixed; }}
        onChange={onChange} className="h-4 w-4 cursor-pointer rounded border-input accent-[hsl(var(--primary))]" />
    </span>
  );
}

/** Header cell that picks every row on the page. */
export function TickAllCell({ sel, className }: { sel: Selection; className?: string }) {
  return <th className={cn("w-10 px-3", className)}><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} label="Select all" /></th>;
}
/** Row cell for one tick box. */
export function TickCell({ sel, id, className }: { sel: Selection; id: string; className?: string }) {
  return <td className={cn("w-10 px-3", className)} data-label=""><Tick on={sel.has(id)} onChange={() => sel.toggle(id)} /></td>;
}

/** Bar shown while rows are picked: count, the actions, clear. */
export function BulkBar({ sel, children, noun = "item", className }: { sel: Selection; children: ReactNode; noun?: string; className?: string }) {
  if (!sel.count) return null;
  return (
    <div className={cn("sticky top-0 z-[5] flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 backdrop-blur animate-in fade-in-0 slide-in-from-top-1", className)}>
      <span className="text-sm font-semibold">{sel.count} {noun}{sel.count === 1 ? "" : "s"} selected</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      <span className="flex-1" />
      <button onClick={sel.clear} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground"><X className="h-3.5 w-3.5" /> Clear</button>
    </div>
  );
}

/** Rows to CSV and download (for "Export selected"). */
export function downloadCsv(filename: string, header: string[], data: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + [header, ...data].map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
