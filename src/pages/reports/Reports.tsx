import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Landmark, Users, Wallet, LayoutGrid } from "lucide-react";
import PageHead from "@/components/PageHead";
import { OrbLoader } from "@/components/orbs";
import { cn } from "@/lib/utils";

const ReportsCenter = lazy(() => import("./ReportsCenter"));
const FinanceReports = lazy(() => import("@/pages/finance/FinanceReports"));
const BusinessReports = lazy(() => import("./BusinessReports"));
const ReportCatalog = lazy(() => import("./ReportCatalog"));

const VIEWS = [
  { key: "all", label: "All reports", icon: LayoutGrid },
  { key: "sales", label: "Sales dashboard", icon: BarChart3 },
  { key: "finance", label: "Profit, cash & tax", icon: Landmark },
  { key: "receivables", label: "Customers, debts & credit", icon: Wallet },
  { key: "people", label: "Payroll & HR", icon: Users },
] as const;

/** One Reports page: sales analysis, the owner's finance report and the rest, one click apart. */
export default function Reports() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.key === params.get("view"))?.key || "all") as (typeof VIEWS)[number]["key"];
  return (
    <div className="space-y-5">
      <PageHead title="Reports · JMSURF Garage" description="Sales, profit, cash, tax, debts and payroll in one place." noindex />
      <div>
        <h1 className="font-display text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Everything about how the business is doing, in one place.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 print:hidden">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set("view", v.key); return n; }, { replace: true })}
            className={cn("inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              view === v.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <v.icon className="h-4 w-4" /> {v.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<OrbLoader label="Loading the report…" />}>
        {view === "all" && <ReportCatalog />}
        {view === "sales" && <ReportsCenter />}
        {view === "finance" && <FinanceReports />}
        {(view === "receivables" || view === "people") && <BusinessReports view={view} />}
      </Suspense>
    </div>
  );
}
