/**
 * A drawn picture of each module at work (no photos needed): a browser window in
 * the module's colour showing what it does. Used by the website (home and module
 * pages). Labels only, never invented people or companies.
 */
import type { ReactNode } from "react";
import { Smartphone, Sparkles, CheckCircle2, TrendingUp, Package, Users, Mic, Send, FileCheck, MessageSquare } from "lucide-react";
import type { ModuleDef } from "@/lib/modules";
import { cn } from "@/lib/utils";

function Frame({ m, children, className }: { m: ModuleDef; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[22px] border border-white/60 bg-white/80 shadow-[0_40px_90px_-30px_rgba(16,18,24,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-[#12151c]/85", className)}>
      <div className="flex items-center gap-2 border-b border-black/5 bg-white/70 px-4 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex min-w-0 flex-1 items-center gap-2 truncate rounded-md bg-black/[0.04] px-2.5 py-1 text-[10px] text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
          <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: m.color }} />app.jmsurfgarage.co.ke{(m.home || "/dashboard").split("?")[0]}
        </span>
      </div>
      <div className="p-4 text-left text-zinc-800 dark:text-zinc-100 sm:p-5">{children}</div>
    </div>
  );
}
const T = ({ c, children }: { c: string; children: ReactNode }) => <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${c}1f`, color: c }}>{children}</span>;
const Card = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("rounded-xl border border-black/5 bg-white p-2.5 shadow-sm dark:border-white/5 dark:bg-white/[0.04]", className)}>{children}</div>;

export default function SuiteVisual({ m, className }: { m: ModuleDef; className?: string }) {
  const c = m.color;
  switch (m.key) {
    case "garage_core": {
      const steps = ["Car booked in", "Inspection done", "Estimate approved online", "Job finished", "eTIMS invoice", "M-Pesa paid"];
      return (
        <Frame m={m} className={className}>
          <div className="grid gap-3 sm:grid-cols-[1.1fr_1fr]">
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-2.5 rounded-xl bg-black/[0.03] px-2.5 py-2 text-[11px] font-medium dark:bg-white/[0.04]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: i < 5 ? c : "#10b981" }}>{i < 5 ? i + 1 : "✓"}</span>{s}
                </div>
              ))}
            </div>
            <Card>
              <p className="text-[10px] text-zinc-500">Jobs this week</p>
              <p className="font-display text-xl font-extrabold">42</p>
              <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><TrendingUp className="h-3 w-3" />more than last week</p>
              <div className="mt-3 flex h-20 items-end gap-1">{[40, 55, 48, 66, 60, 74, 70].map((h, i) => <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(to top, ${c}, ${c}88)` }} />)}</div>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500"><MessageSquare className="h-3 w-3" />SMS: your car is ready</p>
            </Card>
          </div>
        </Frame>
      );
    }
    case "inventory": {
      const rows: [string, number, number][] = [["Brake pads", 30, 40], ["Oil filters", 9, 50], ["Engine oil 5L", 26, 40], ["Spark plugs", 6, 60]];
      return (
        <Frame m={m} className={className}>
          <div className="space-y-2">
            {rows.map(([n, q, max]) => (
              <div key={n} className="flex items-center gap-3 text-[11px]">
                <Package className="h-4 w-4 shrink-0" style={{ color: c }} />
                <span className="w-24 shrink-0 truncate font-medium">{n}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(q / max) * 100}%`, background: q / max < 0.35 ? "#e11d48" : c }} /></span>
                <span className="w-10 text-right font-semibold tabular-nums">{q}</span>
                {q / max < 0.35 ? <T c="#e11d48">Reorder</T> : <T c="#10b981">OK</T>}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["Stores", "2"], ["Parts on jobs", "118"], ["Transfers", "4"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
        </Frame>
      );
    }
    case "commerce": {
      const items = [["Brake pads", "2,800"], ["Oil filter", "650"], ["Wiper blades", "900"], ["Battery 60Ah", "9,500"], ["Bulb H4", "350"], ["Coolant 1L", "700"]];
      return (
        <Frame m={m} className={className}>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="grid grid-cols-3 gap-1.5">{items.map(([n, p]) => <Card key={n} className="p-2"><span className="mb-1 block h-8 rounded-lg" style={{ background: `${c}22` }} /><p className="truncate text-[10px] font-semibold">{n}</p><p className="text-[10px]" style={{ color: c }}>KES {p}</p></Card>)}</div>
            <Card className="flex flex-col">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Counter sale</p>
              {[["Brake pads × 1", "2,800"], ["Oil filter × 2", "1,300"]].map(([n, p]) => <p key={n} className="mt-1.5 flex justify-between text-[11px]"><span>{n}</span><b>{p}</b></p>)}
              <p className="mt-auto flex justify-between border-t border-black/5 pt-2 text-xs font-extrabold dark:border-white/10"><span>Total</span><span>KES 4,100</span></p>
              <span className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-[10px] font-bold text-white"><Smartphone className="h-3 w-3" />M-Pesa prompt sent</span>
            </Card>
          </div>
        </Frame>
      );
    }
    case "hrm": {
      return (
        <Frame m={m} className={className}>
          <div className="flex items-center gap-2"><Users className="h-5 w-5" style={{ color: c }} /><span className="text-[11px] font-semibold">12 staff · payroll ready</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Gross pay", "640K"], ["PAYE", "71K"], ["NSSF + SHIF", "38K"], ["Housing levy", "9.6K"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">KES {v}</p></Card>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><CheckCircle2 className="h-4 w-4" />Payslips sent by SMS · M-Pesa and bank files ready</div>
        </Frame>
      );
    }
    case "ai": {
      const chat: [boolean, string][] = [[true, "Which jobs made the most money this month?"], [false, "Service and brakes, then suspension. 6 invoices are unpaid. Shall I send M-Pesa reminders?"], [true, "Yes, politely."], [false, "6 reminders ready for you to confirm."]];
      return (
        <Frame m={m} className={className}>
          <div className="space-y-2">{chat.map(([me, t], i) => <div key={i} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[11px]", me ? "ml-auto rounded-br-md text-white" : "rounded-bl-md bg-black/[0.05] dark:bg-white/10")} style={me ? { background: c } : undefined}>{t}</div>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/[0.04] p-1.5 dark:bg-white/5"><Sparkles className="ml-1 h-4 w-4" style={{ color: c }} /><span className="flex-1 text-[11px] text-zinc-500">Ask Garage AI anything…</span><span className="rounded-lg bg-white p-1.5 dark:bg-white/10"><Mic className="h-3 w-3" /></span><span className="rounded-lg p-1.5 text-white" style={{ background: c }}><Send className="h-3 w-3" /></span></div>
        </Frame>
      );
    }
    case "accounting": {
      return (
        <Frame m={m} className={className}>
          <div className="grid grid-cols-2 gap-2">{[["Income this month", "KES 1.2M"], ["Expenses", "KES 740K"], ["VAT due", "KES 64K"], ["M-Pesa matched", "98%"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><FileCheck className="h-4 w-4" />Profit and loss, balance sheet and VAT return ready</div>
        </Frame>
      );
    }
    default: {
      return (
        <Frame m={m} className={className}>
          <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: c }}><m.icon className="h-5 w-5" /></span><span><p className="text-xs font-bold">{m.name}</p><p className="text-[10px] text-zinc-500">Part of your garage workspace</p></span></div>
          <div className="mt-3 grid grid-cols-2 gap-2">{m.apps.slice(0, 4).map((x) => <Card key={x.key} className="flex items-start gap-2"><x.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: c }} /><span className="min-w-0"><p className="truncate text-[11px] font-semibold">{x.name}</p><p className="line-clamp-2 text-[10px] text-zinc-500">{x.desc}</p></span></Card>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><Users className="h-4 w-4" />Same customers, same vehicles, one login</div>
        </Frame>
      );
    }
  }
}
