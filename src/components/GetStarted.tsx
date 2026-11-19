import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, UploadCloud, Grid2x2, Users, Smartphone, FileCheck, X } from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";

/** First-run checklist for a new company (administrators only). Each step ticks itself. */
export default function GetStarted({ data }: { data?: { company: boolean; data: boolean; modules: boolean; team: boolean; payments: boolean; invoice: boolean } | null }) {
  const tenantId = useTenantId();
  const { role } = useAuth();
  const key = `garage.getstarted.hidden.${tenantId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (hidden || !data || !(role === "admin" || role === "super_admin")) return null;
  const steps = [
    { done: data.company, icon: Building2, t: "Add your company details", d: "Logo, phone, KRA PIN and address for invoices.", to: "/settings" },
    { done: data.data, icon: UploadCloud, t: "Bring your data", d: "Connect your previous accounting system or upload its exports.", to: "/migrate" },
    { done: data.modules, icon: Grid2x2, t: "Switch on your modules", d: "Workshop Pro, parts, body & paint, car wash… 14 days free.", to: "/modules" },
    { done: data.team, icon: Users, t: "Invite your team", d: "Give each person a role and only what they need.", to: "/staff" },
    { done: data.payments, icon: Smartphone, t: "Get paid by M-Pesa", d: "Connect your Till or Paybill so invoices can be paid online.", to: "/settings?tab=payments" },
    { done: data.invoice, icon: FileCheck, t: "Send your first invoice", d: "Branded, by email, SMS or WhatsApp.", to: "/sales/invoices/new" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-card px-3 py-1.5 text-sm">
      <span className="whitespace-nowrap font-semibold">Set up {done} of {steps.length}</span>
      <div className="hidden h-1.5 w-20 rounded-full bg-muted sm:block"><div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      {steps.filter((s) => !s.done).map((s) => (
        <Link key={s.t} to={s.to} title={s.d} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><s.icon className="h-3.5 w-3.5" />{s.t}</Link>
      ))}
      <button onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch { /* per device */ } }} className="ml-auto rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Hide"><X className="h-4 w-4" /></button>
    </section>
  );
}
