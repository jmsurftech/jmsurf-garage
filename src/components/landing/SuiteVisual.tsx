/**
 * A drawn picture of each suite at work (no photos needed): a browser window in
 * the suite's colour showing what that suite actually does. Used by the website
 * showcase and the per-suite pages.
 */
import type { ReactNode } from "react";
import { Smartphone, Sparkles, Headset, Phone, CheckCircle2, AlertTriangle, Clock, TrendingUp, Package, Users, Mic, Send } from "lucide-react";
import type { ModuleDef } from "@/lib/modules";
import { cn } from "@/lib/utils";

function Frame({ m, children, className }: { m: ModuleDef; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[22px] border border-white/60 bg-white/80 shadow-[0_40px_90px_-30px_rgba(16,18,24,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-[#12151c]/85", className)}>
      <div className="flex items-center gap-2 border-b border-black/5 bg-white/70 px-4 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex min-w-0 flex-1 items-center gap-2 truncate rounded-md bg-black/[0.04] px-2.5 py-1 text-[10px] text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
          <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: m.color }} />yourcompany.garage.jmsurf.co.ke{m.home.split("?")[0]}
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
    case "books": {
      const steps = ["Quote sent", "Sales order", "Delivered", "Invoice + KRA eTIMS", "M-Pesa paid", "Books updated"];
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
              <p className="text-[10px] text-zinc-500">Profit this month</p>
              <p className="font-display text-xl font-extrabold">KES 1.84M</p>
              <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><TrendingUp className="h-3 w-3" />18.4% up</p>
              <div className="mt-3 flex h-20 items-end gap-1">{[40, 55, 48, 66, 60, 74, 70, 86].map((h, i) => <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(to top, ${c}, ${c}88)` }} />)}</div>
            </Card>
          </div>
        </Frame>
      );
    }
    case "crm": {
      const cols: [string, [string, string][]][] = [["New", [["Hotel client", "KES 340K"], ["School supplies", "KES 95K"]]], ["Proposal", [["Clinic group", "KES 1.2M"]]], ["Won", [["Construction Ltd", "KES 780K"]]]];
      return (
        <Frame m={m} className={className}>
          <div className="grid grid-cols-3 gap-2">
            {cols.map(([t, deals]) => (
              <div key={t} className="rounded-xl bg-black/[0.03] p-2 dark:bg-white/[0.04]">
                <p className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500">{t}<span>{deals.length}</span></p>
                {deals.map(([n, v]) => <Card key={n} className="mb-1.5"><p className="truncate text-[11px] font-semibold">{n}</p><p className="text-[10px]" style={{ color: c }}>{v}</p></Card>)}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><CheckCircle2 className="h-4 w-4" />Deal won → quote, order and invoice created</div>
        </Frame>
      );
    }
    case "commerce": {
      const items = [["Maize flour", "210"], ["Rice 5kg", "980"], ["Cooking oil", "1,450"], ["Sugar 2kg", "320"], ["Milk 500ml", "65"], ["Bread", "70"]];
      return (
        <Frame m={m} className={className}>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="grid grid-cols-3 gap-1.5">{items.map(([n, p]) => <Card key={n} className="p-2"><span className="mb-1 block h-8 rounded-lg" style={{ background: `${c}22` }} /><p className="truncate text-[10px] font-semibold">{n}</p><p className="text-[10px]" style={{ color: c }}>KES {p}</p></Card>)}</div>
            <Card className="flex flex-col">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Cart</p>
              {[["Rice 5kg × 1", "980"], ["Cooking oil × 1", "1,450"]].map(([n, p]) => <p key={n} className="mt-1.5 flex justify-between text-[11px]"><span>{n}</span><b>{p}</b></p>)}
              <p className="mt-auto flex justify-between border-t border-black/5 pt-2 text-xs font-extrabold dark:border-white/10"><span>Total</span><span>KES 2,430</span></p>
              <span className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-[10px] font-bold text-white"><Smartphone className="h-3 w-3" />M-Pesa prompt sent</span>
            </Card>
          </div>
        </Frame>
      );
    }
    case "inventory": {
      const rows: [string, number, number][] = [["Cement 50kg", 90, 120], ["Steel rods", 18, 60], ["Paint 4L", 44, 50], ["Roofing sheets", 7, 40]];
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
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["Warehouses", "3"], ["Stock value", "KES 6.3M"], ["Transfers", "12"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
        </Frame>
      );
    }
    case "hrm": {
      return (
        <Frame m={m} className={className}>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">{["#f59e0b", "#3b82f6", "#ec4899", "#10b981", "#8b5cf6"].map((x) => <span key={x} className="h-8 w-8 rounded-full ring-2 ring-white dark:ring-[#12151c]" style={{ background: x }} />)}</div>
            <span className="text-[11px] font-semibold">48 staff · payroll ready</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Gross pay", "3.12M"], ["PAYE", "512K"], ["NSSF + SHIF", "198K"], ["Housing levy", "47K"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">KES {v}</p></Card>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><CheckCircle2 className="h-4 w-4" />Payslips sent by SMS and email · bank file ready</div>
        </Frame>
      );
    }
    case "ai": {
      const chat: [boolean, string][] = [[true, "Who owes us more than 90 days?"], [false, "4 customers owe KES 1.32M. Shall I send each a statement and M-Pesa link?"], [true, "Yes, politely."], [false, "Done. 4 reminders ready for you to confirm."]];
      return (
        <Frame m={m} className={className}>
          <div className="space-y-2">{chat.map(([me, t], i) => <div key={i} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[11px]", me ? "ml-auto rounded-br-md text-white" : "rounded-bl-md bg-black/[0.05] dark:bg-white/10")} style={me ? { background: c } : undefined}>{t}</div>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/[0.04] p-1.5 dark:bg-white/5"><Sparkles className="ml-1 h-4 w-4" style={{ color: c }} /><span className="flex-1 text-[11px] text-zinc-500">Ask Garage AI anything…</span><span className="rounded-lg bg-white p-1.5 dark:bg-white/10"><Mic className="h-3 w-3" /></span><span className="rounded-lg p-1.5 text-white" style={{ background: c }}><Send className="h-3 w-3" /></span></div>
        </Frame>
      );
    }
    case "callcentre": {
      return (
        <Frame m={m} className={className}>
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold"><Headset className="h-4 w-4" style={{ color: c }} />Incoming call</span><T c="#10b981">Sales queue · 0:04</T></div>
          <Card className="mt-3"><p className="font-display text-base font-extrabold">Hotel client</p><p className="text-[10px] text-zinc-500">Customer since 2024</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">{[["Balance", "86,200"], ["Tickets", "1 open"], ["Deal", "340K"]].map(([l, v]) => <div key={l} className="rounded-lg bg-black/[0.03] p-1.5 dark:bg-white/5"><p className="text-[9px] text-zinc-500">{l}</p><p className="text-[11px] font-bold">{v}</p></div>)}</div></Card>
          <div className="mt-3 flex gap-2"><span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-[11px] font-bold text-white"><Phone className="h-3.5 w-3.5" />Answer</span><span className="flex-1 rounded-xl bg-black/[0.05] py-2 text-center text-[11px] font-bold dark:bg-white/10">Voicemail</span></div>
        </Frame>
      );
    }
    case "projects": {
      const bars: [string, number, number][] = [["Design", 0, 35], ["Build", 25, 50], ["Testing", 60, 25], ["Handover", 82, 18]];
      return (
        <Frame m={m} className={className}>
          <div className="space-y-2.5">{bars.map(([n, s, w]) => <div key={n} className="flex items-center gap-3 text-[11px]"><span className="w-16 shrink-0 font-medium">{n}</span><span className="relative h-5 flex-1 rounded-md bg-black/[0.04] dark:bg-white/5"><span className="absolute inset-y-0 rounded-md" style={{ left: `${s}%`, width: `${w}%`, background: `linear-gradient(90deg, ${c}, ${c}aa)` }} /></span></div>)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["Budget used", "62%"], ["Hours", "418"], ["Billable", "KES 1.1M"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
        </Frame>
      );
    }
    case "service": {
      const tickets: [string, string, string][] = [["Printer not working", "High", "#e11d48"], ["Invoice copy request", "Normal", "#3b82f6"], ["Delivery delayed", "Urgent", "#f59e0b"]];
      return (
        <Frame m={m} className={className}>
          <div className="space-y-1.5">{tickets.map(([t, p, col], i) => <Card key={t} className="flex items-center gap-2"><span className="text-[10px] font-bold text-zinc-400">#{1042 - i}</span><span className="flex-1 truncate text-[11px] font-semibold">{t}</span><T c={col}>{p}</T><span className="flex items-center gap-1 text-[10px] text-zinc-500"><Clock className="h-3 w-3" />{["2h", "1d", "35m"][i]}</span></Card>)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["Open", "14"], ["SLA met", "96%"], ["CSAT", "4.8★"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
        </Frame>
      );
    }
    case "manufacturing": {
      const steps: [string, number][] = [["Raw materials issued", 100], ["Mixing", 100], ["Packaging", 64], ["Quality check", 0]];
      return (
        <Frame m={m} className={className}>
          <p className="text-[11px] font-bold">Production order MO-0218 · 2,000 units</p>
          <div className="mt-2.5 space-y-2">{steps.map(([n, p]) => <div key={n}><p className="flex justify-between text-[10px]"><span>{n}</span><span className="font-semibold">{p}%</span></p><span className="mt-1 block h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"><span className="block h-full rounded-full" style={{ width: `${p}%`, background: c }} /></span></div>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" />Machine 3 maintenance due Friday</div>
        </Frame>
      );
    }
    case "marketing": {
      return (
        <Frame m={m} className={className}>
          <p className="text-[11px] font-bold">Back-to-school campaign · SMS + WhatsApp + email</p>
          <div className="mt-3 flex h-24 items-end gap-2">{[["Sent", 100], ["Delivered", 92], ["Opened", 58], ["Clicked", 24], ["Bought", 9]].map(([l, h]) => <div key={l as string} className="flex flex-1 flex-col items-center gap-1"><span className="w-full rounded-t-md" style={{ height: `${h}%`, background: `linear-gradient(to top, ${c}, ${c}77)` }} /><span className="text-[9px] text-zinc-500">{l}</span></div>)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["Reached", "12,480"], ["Revenue", "KES 412K"], ["ROI", "9.6×"]].map(([l, v]) => <Card key={l}><p className="text-[9px] text-zinc-500">{l}</p><p className="font-display text-sm font-extrabold">{v}</p></Card>)}</div>
        </Frame>
      );
    }
    default: {
      return (
        <Frame m={m} className={className}>
          <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: c }}><m.icon className="h-5 w-5" /></span><span><p className="text-xs font-bold">{m.name}</p><p className="text-[10px] text-zinc-500">{m.apps.length} apps working together</p></span></div>
          <div className="mt-3 grid grid-cols-2 gap-2">{m.apps.slice(0, 4).map((x) => <Card key={x.key} className="flex items-start gap-2"><x.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: c }} /><span className="min-w-0"><p className="truncate text-[11px] font-semibold">{x.name}</p><p className="line-clamp-2 text-[10px] text-zinc-500">{x.desc}</p></span></Card>)}</div>
          <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white" style={{ background: c }}><Users className="h-4 w-4" />Same customers, same books, one login</div>
        </Frame>
      );
    }
  }
}
