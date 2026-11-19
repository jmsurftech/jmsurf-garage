import { NavLink } from "react-router-dom";
import { Boxes, Package } from "lucide-react";
import { cn } from "@/lib/utils";

/** Products & Services: the item list and stock levels as two views of one page. */
export default function ProductsTabs({ className }: { className?: string }) {
  const tab = ({ isActive }: { isActive: boolean }) => cn("inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors", isActive ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground");
  return (
    <div className={cn("flex gap-1 rounded-xl bg-muted/70 p-1", className)}>
      <NavLink to="/inventory/products" className={tab}><Package className="h-4 w-4" /> Products & Services</NavLink>
      <NavLink to="/inventory/stock" className={tab}><Boxes className="h-4 w-4" /> Stock levels</NavLink>
    </div>
  );
}
