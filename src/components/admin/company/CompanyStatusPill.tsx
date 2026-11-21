import { Pill } from "@/components/kit";
import { companyStatus, type Company, type Sub } from "./data";

const LOOK: Record<string, { tone: "success" | "warning" | "danger" | "info" | "muted"; label: string }> = {
  active: { tone: "success", label: "Active" },
  trial: { tone: "info", label: "Trial" },
  expired: { tone: "warning", label: "Expired" },
  suspended: { tone: "danger", label: "Suspended" },
  archived: { tone: "muted", label: "Archived" },
  cancelled: { tone: "muted", label: "Cancelled" },
  none: { tone: "muted", label: "No plan" },
};

/** One status per company, the same on the list, the company page and Users. */
export function CompanyStatusPill({ company, sub, className }: { company: Company; sub?: Sub | null; className?: string }) {
  const s = companyStatus(company, sub);
  const look = LOOK[s] || { tone: "muted" as const, label: s };
  const free = sub?.comped_until && Date.parse(sub.comped_until) > Date.now() && s === "active";
  return <Pill tone={look.tone} className={className}>{free ? "Free" : look.label}</Pill>;
}
