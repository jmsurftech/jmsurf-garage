import { Link } from "react-router-dom";
import {
  Plus, FileCheck, FileText, ClipboardCheck, Users, Box, DollarSign, Receipt, ShoppingBag, Wallet, Magnet, ListChecks, ShoppingCart, Truck,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModules } from "@/hooks/useModules";

interface Item { to: string; label: string; icon: LucideIcon; module?: string }

const SALES: Item[] = [
  { to: "/sales/invoices/new", label: "Invoice", icon: FileCheck },
  { to: "/sales/quotes/new", label: "Quote", icon: FileText },
  { to: "/sales/orders/new", label: "Sales order", icon: ClipboardCheck },
  { to: "/customers/new", label: "Customer", icon: Users },
  { to: "/sales/payments", label: "Payment received", icon: Wallet },
];
const PURCHASES: Item[] = [
  { to: "/purchases/expenses?new=1", label: "Expense", icon: DollarSign },
  { to: "/purchases/bills/new", label: "Bill", icon: Receipt },
  { to: "/purchases/orders/new", label: "Purchase order", icon: ShoppingBag },
  { to: "/purchases/suppliers/new", label: "Vendor", icon: Truck },
];
const OTHER: Item[] = [
  { to: "/inventory/products/new", label: "Item", icon: Box },
  { to: "/crm/leads?new=1", label: "Lead", icon: Magnet, module: "crm" },
  { to: "/apps/projects/task?new=1", label: "Task", icon: ListChecks, module: "projects" },
];

/** "+ New" menu in the header. */
export default function QuickCreate({ canPos }: { canPos?: boolean }) {
  const { has } = useModules();
  const row = (i: Item) => (has(i.module) ? (
    <DropdownMenuItem key={i.to} asChild>
      <Link to={i.to} className="gap-2"><i.icon className="h-4 w-4 text-muted-foreground" /> {i.label}</Link>
    </DropdownMenuItem>
  ) : null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 font-display text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90 sm:px-4" aria-label="Create new">
          <Plus className="h-4 w-4" /><span className="hidden sm:inline">New</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {canPos && (
          <>
            <DropdownMenuItem asChild><Link to="/pos" className="gap-2 font-semibold"><ShoppingCart className="h-4 w-4 text-primary" /> New POS sale</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Sales</DropdownMenuLabel>
        {SALES.map(row)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Purchases</DropdownMenuLabel>
        {PURCHASES.map(row)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">More</DropdownMenuLabel>
        {OTHER.map(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
