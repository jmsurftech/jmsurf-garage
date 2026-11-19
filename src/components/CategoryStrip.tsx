import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CategoryStripItem {
  /** Unique value used for active comparison and onChange. */
  value: string;
  /** Visible label. */
  label: string;
  /** Optional count badge shown after the label. */
  count?: number;
}

interface CategoryStripProps {
  items: CategoryStripItem[];
  active: string;
  onChange: (value: string) => void;
  /** Extra buttons rendered before the category items (e.g. POS Wholesale/Products/Services toggles). */
  leading?: React.ReactNode;
  /** Placeholder text for the inline search box. */
  searchPlaceholder?: string;
  /** Hide the inline category search box. */
  hideSearch?: boolean;
  className?: string;
}

/**
 * Horizontal, single-line category selector with:
 * - inline search box that filters the rendered items
 * - left/right arrow buttons to scroll the strip
 * - sticky All / leading items kept in place; the rest scrolls horizontally
 */
export default function CategoryStrip({
  items,
  active,
  onChange,
  leading,
  searchPlaceholder = "Search categories…",
  hideSearch = false,
  className,
}: CategoryStripProps) {
  const [query, setQuery] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, query]);

  const updateScrollState = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [filtered.length]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className={cn("flex items-center gap-2 w-full", className)}>
      {/* Search */}
      <div className={cn("relative shrink-0 w-44 sm:w-56", hideSearch && "hidden")}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-8 pr-7 h-8 rounded-full bg-muted border border-input text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-background text-muted-foreground"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Left arrow */}
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        disabled={!canLeft}
        className="shrink-0 p-1 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Scroll left"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Scrollable strip */}
      <div
        ref={scrollerRef}
        className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex items-center gap-2 whitespace-nowrap">
          {leading}
          {leading && filtered.length > 0 && <span className="w-px h-5 bg-border mx-1 shrink-0" />}
          {filtered.map((it) => {
            const isActive = it.value === active;
            return (
              <button
                key={it.value}
                type="button"
                onClick={() => onChange(it.value)}
                className={cn(
                  "px-3 h-8 rounded-full text-xs font-medium border transition-colors shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:bg-accent"
                )}
              >
                {it.label}
                {typeof it.count === "number" && (
                  <span className={cn("ml-1.5 text-[10px] opacity-80", isActive ? "" : "text-muted-foreground")}>
                    ({it.count})
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <span className="text-xs text-muted-foreground px-2">No matches</span>
          )}
        </div>
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scrollBy(1)}
        disabled={!canRight}
        className="shrink-0 p-1 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Scroll right"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
