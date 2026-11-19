import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A document's page beside its list (Zoho's split view): title, actions bar, then the document. */
export function DocPane({ title, subtitle, onClose, actions, children }: { title: string; subtitle?: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30 max-sm:overflow-y-auto">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-xs text-muted-foreground">{subtitle}</p><h2 className="truncate font-display text-xl font-bold">{title}</h2></div>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X /></Button></div>
        {actions && <div className="mt-2 flex flex-wrap items-center gap-2 [&_button]:h-9">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 max-sm:flex-none max-sm:overflow-visible sm:p-5">{children}</div>
    </div>
  );
}

export type SplitRow = { id: string; href: string; title: string; amount?: string; sub: string; status?: string; tone?: "danger" | "success" | "muted" };

/** The list on the left of an open document (Zoho's split view), with the open one marked. */
export function SplitView({ heading, newHref, rows, activeId, children }: { heading: string; newHref?: string; rows: SplitRow[]; activeId: string; children: ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-8.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="hidden w-[300px] shrink-0 flex-col border-r border-border xl:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5"><p className="flex-1 font-display font-bold">{heading}</p>{newHref && <Button size="sm" asChild><Link to={newHref} aria-label="New"><Plus /></Link></Button>}</div>
        <ul className="min-h-0 flex-1 overflow-y-auto">{rows.map((r) => (
          <li key={r.id}><Link to={r.href} className={cn("block border-b border-border px-3 py-2.5 hover:bg-muted/50", r.id === activeId && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
            <div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{r.title}</span>{r.amount && <span className="text-sm tabular-nums">{r.amount}</span>}</div>
            <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{r.sub}</span>{r.status && <span className={cn("shrink-0 font-semibold uppercase", r.tone === "danger" && "text-destructive", r.tone === "success" && "text-success")}>{r.status}</span>}</div>
          </Link></li>
        ))}</ul>
      </div>
      {children}
    </div>
  );
}
