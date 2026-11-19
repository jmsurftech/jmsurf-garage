import { useMemo } from "react";
import Pager from "@/components/Pager";

interface PaginationProps {
  total: number;
  page: number;            // 1-indexed
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
  /** Optional label for the items being paginated (e.g. "products"). */
  itemLabel?: string;
}

/** The shared slim bar, for lists that keep their own page state. */
export default function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange, className }: PaginationProps) {
  return <Pager total={total} page={page} pageSize={pageSize} onPage={onPageChange} onPageSize={onPageSizeChange} className={className} />;
}

/** Small hook to derive the paginated slice + reset page on dep change. */
export function usePaginated<T>(items: T[], pageSize: number, page: number): T[] {
  return useMemo(() => {
    if (!Number.isFinite(pageSize)) return items;
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);
}
