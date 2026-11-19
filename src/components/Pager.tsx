import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [10, 20, 25, 50, 100] as const;

/**
 * Client-side paging for lists that are already in memory. Jumps back to the
 * first page whenever the list itself changes size (new filter or search).
 */
export function usePaged<T>(rows: T[], initialSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialSize);
  const [printing, setPrinting] = useState(false);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => { setPage(1); }, [rows.length, pageSize]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  // Paper gets the whole list, not the page on screen.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const pageRows = useMemo(() => (printing ? rows : rows.slice((page - 1) * pageSize, page * pageSize)), [rows, page, pageSize, printing]);
  return { pageRows, rows: pageRows, page, setPage, pageSize, setPageSize, total: rows.length, pager: { page, pageSize, total: rows.length, onPage: setPage, onPageSize: setPageSize } };
}

/**
 * Drop-in paging for an existing list: renders one page of `rows` through
 * `children`, followed by the page control. Inside a <tbody> pass `colSpan`
 * so the control sits in its own table row; elsewhere it renders as a block
 * that spans a grid (`gridSpan`) or simply follows the items. `after` is what
 * stays under the rows on every page, such as an empty-list row.
 */
export function PagedRows<T>({ rows, children, colSpan, gridSpan, pageSize = 25, after, list }: {
  rows: T[];
  children: (pageRows: T[]) => React.ReactNode;
  colSpan?: number;
  gridSpan?: boolean;
  pageSize?: number;
  after?: React.ReactNode;
  /** The rows are <li>s: the control goes in one too. */
  list?: boolean;
}) {
  const paged = usePaged(rows, pageSize);
  const control = rows.length > 0
    ? <Pager page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} className={cn(colSpan && "border-t-0", gridSpan && "col-span-full")} />
    : null;
  return (
    <>
      {children(paged.pageRows)}
      {after}
      {control && (colSpan
        ? <tr><td colSpan={colSpan} className="p-0 border-t border-border">{control}</td></tr>
        : list ? <li>{control}</li> : control)}
    </>
  );
}

type PagerProps = {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  className?: string;
  loading?: boolean;
  /** Totals for the list, shown in the bar. */
  summary?: React.ReactNode;
};

/** Footer control shared by every list: range, rows per page and page numbers. Slim, and pinned to the foot of the list (index.css). */
export default function Pager({ page, pageSize, total, onPage, onPageSize, className, loading, summary }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers: number[] = [];
  for (let p = first; p <= Math.min(pages, first + 4); p++) numbers.push(p);
  const btn = "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className={cn("pager-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-border px-3 py-0.5 text-xs text-muted-foreground", className)}>
      <span className={cn("tabular-nums", loading && "opacity-60")}>
        <strong className="font-medium text-foreground">{from.toLocaleString()}-{to.toLocaleString()}</strong> of <strong className="font-medium text-foreground">{total.toLocaleString()}</strong>
      </span>
      {summary && <span className="hidden flex-wrap items-center gap-x-4 sm:ml-auto sm:flex">{summary}</span>}
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-1">
            <span className="hidden sm:inline">Rows</span>
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page"
              className="h-6 rounded-md border border-border bg-card px-1 text-xs text-foreground">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <div className="flex items-center gap-0.5">
          <button className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
          {numbers.map((p) => (
            <button key={p} className={cn(btn, Math.abs(p - page) > 1 && "hidden sm:inline-flex", p === page && "bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground")}
              onClick={() => onPage(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}>{p}</button>
          ))}
          <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}
