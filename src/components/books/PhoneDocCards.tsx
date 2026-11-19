import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PhoneDocRow = {
  id: string;
  number: ReactNode;
  party: string;
  date: string;
  due?: string | null;
  amount: string;
  balance?: string | null;
  status: ReactNode;
  selected?: boolean;
};

/** Phone view of a document list (invoices, quotes, bills…): one card per document instead of a wide table. */
export function PhoneDocCards({ rows, onOpen, empty = "Nothing here yet." }: { rows: PhoneDocRow[]; onOpen: (id: string) => void; empty?: string }) {
  if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border sm:hidden">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60", r.selected && "bg-primary/5")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{r.party || "—"}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{r.number}</span>
                <span>· {r.date}</span>
              </span>
              {r.due && <span className="mt-0.5 block text-xs text-muted-foreground">Due {r.due}</span>}
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{r.amount}</span>
              {r.balance && <span className="block text-xs tabular-nums text-muted-foreground">Due {r.balance}</span>}
              <span className="mt-1 block">{r.status}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
