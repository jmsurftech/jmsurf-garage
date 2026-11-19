import { cn } from "@/lib/utils";

/** Status text: coloured capitals, no pill. */
const TONES: Record<string, string> = {
  draft: "text-muted-foreground",
  sent: "text-sky-600 dark:text-sky-400",
  viewed: "text-sky-600 dark:text-sky-400",
  open: "text-sky-600 dark:text-sky-400",
  pending: "text-amber-600 dark:text-amber-400",
  pending_approval: "text-amber-600 dark:text-amber-400",
  submitted: "text-amber-600 dark:text-amber-400",
  accepted: "text-emerald-600 dark:text-emerald-400",
  approved: "text-emerald-600 dark:text-emerald-400",
  invoiced: "text-emerald-600 dark:text-emerald-400",
  paid: "text-emerald-600 dark:text-emerald-400",
  received: "text-emerald-600 dark:text-emerald-400",
  completed: "text-emerald-600 dark:text-emerald-400",
  won: "text-emerald-600 dark:text-emerald-400",
  partially_paid: "text-amber-600 dark:text-amber-400",
  partial: "text-amber-600 dark:text-amber-400",
  overdue: "text-red-600 dark:text-red-400",
  declined: "text-red-600 dark:text-red-400",
  rejected: "text-red-600 dark:text-red-400",
  lost: "text-red-600 dark:text-red-400",
  expired: "text-muted-foreground",
  void: "text-muted-foreground line-through",
  cancelled: "text-muted-foreground",
};

export const statusLabel = (s?: string | null) => String(s || "draft").replace(/_/g, " ");

export function ZStatus({ status, className }: { status?: string | null; className?: string }) {
  const key = String(status || "draft").toLowerCase();
  return (
    <span className={cn("text-[11px] font-semibold uppercase tracking-wide", TONES[key] || "text-muted-foreground", className)}>
      {statusLabel(key)}
    </span>
  );
}

/** Invoice status as shown to people: unpaid invoices past their due date read OVERDUE. */
export function invoiceDisplayStatus(inv: { status?: string | null; due_date?: string | null; total?: number; amount_paid?: number }) {
  const s = String(inv.status || "draft");
  if (["draft", "void", "paid"].includes(s)) return s;
  const today = new Date().toISOString().slice(0, 10);
  if (inv.due_date && String(inv.due_date).slice(0, 10) < today) return "overdue";
  return s;
}

/** Quote status for display: open quotes past their expiry read EXPIRED. */
export function quoteDisplayStatus(q: { status?: string | null; valid_until?: string | null; invoice_id?: string | null }) {
  const s = String(q.status || "draft");
  if (q.invoice_id && !["declined", "void"].includes(s)) return "invoiced";
  if (["draft", "sent"].includes(s) && q.valid_until && String(q.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10)) return "expired";
  return s;
}
