import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;
const nairobi = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
};
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };

/**
 * Staff linked to an employee record are asked to clock in after they sign in on a working
 * day, and to clock out once work ends. Leaving early asks for a reason (the server insists).
 */
export default function ClockPrompt() {
  const { user } = useAuth() as any;
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [now, setNow] = useState(nairobi());
  const [busy, setBusy] = useState(false);
  const [early, setEarly] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [hide, setHide] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(nairobi()), 60_000); return () => clearInterval(t); }, []);

  const { data } = useQuery({
    queryKey: ["hr-clock-today", user?.id, tenantId, now.date], enabled: !!user?.id && !!tenantId, staleTime: 60_000,
    queryFn: async () => {
      const { data: emp } = await sb.from("hr_employees").select("id,first_name,status").eq("user_id", user.id).maybeSingle();
      if (!emp || ["terminated", "resigned"].includes(emp.status)) return null;
      const [{ data: bs }, { data: att }] = await Promise.all([
        sb.from("business_settings").select("erp_settings").eq("tenant_id", tenantId).maybeSingle(),
        sb.from("hr_attendance").select("clock_in,clock_out,status").eq("employee_id", emp.id).eq("date", now.date).maybeSingle(),
      ]);
      const hr = { work_start: "08:00", work_end: "17:00", workdays: [1, 2, 3, 4, 5, 6], clock_prompt: true, ...(bs?.erp_settings?.hr || {}) };
      return { emp, hr, att };
    },
  });
  if (!data || !data.hr.clock_prompt || !data.hr.workdays.includes(now.dow)) return null;
  const { emp, hr, att } = data;
  if (att && ["leave", "off", "holiday", "absent"].includes(att.status) && !att.clock_in) return null;
  const opensAt = (() => { const [h, m] = hr.work_start.split(":").map(Number); const t = h * 60 + m - 120; return `${String(Math.floor(Math.max(0, t) / 60)).padStart(2, "0")}:${String(Math.max(0, t) % 60).padStart(2, "0")}`; })();
  const needIn = !att?.clock_in && now.time >= opensAt && now.time < hr.work_end;
  const needOut = !!att?.clock_in && !att?.clock_out && now.time >= hr.work_end;
  const kind = needIn ? "in" : needOut ? "out" : early ? "out" : null;
  const dismissKey = `clock.dismiss.${user?.id}.${now.date}.${kind}`;
  if (!kind || hide === kind || (!early && store.get(dismissKey))) return null;

  const run = async (action: "in" | "out", why?: string) => {
    setBusy(true);
    const { data: r, error } = await sb.rpc("hr_clock", { p_action: action, p_reason: why || null });
    setBusy(false);
    if (error && /^EARLY:/.test(error.message)) { setEarly(error.message.replace(/^EARLY:\s*/, "")); return; }
    if (error) return toast({ title: "Not recorded", description: error.message, variant: "destructive" });
    setEarly(null);
    toast({ title: action === "in" ? (Number(r?.late_minutes) > 0 ? `Clocked in · ${r.late_minutes} min late` : "Clocked in. Have a good day!") : "Clocked out. See you tomorrow!" });
    qc.invalidateQueries({ queryKey: ["hr-clock-today"] }); qc.invalidateQueries({ queryKey: ["hr-att-day"] }); qc.invalidateQueries({ queryKey: ["hr-att-month"] });
  };
  const dismiss = () => { store.set(dismissKey, "1"); setHide(kind); setEarly(null); };

  return (
    <div className="fixed bottom-24 right-4 z-[60] w-[min(92vw,360px)] animate-in fade-in-0 slide-in-from-bottom-4 rounded-2xl border border-border bg-card p-4 shadow-2xl md:bottom-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Clock className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{early ? "Leaving early?" : kind === "in" ? `Good ${now.time < "12:00" ? "morning" : "afternoon"}, ${emp.first_name || "there"}` : "Work has ended for today"}</p>
          <p className="text-sm text-muted-foreground">{early ? early : kind === "in" ? `Clock in to start your day (work starts at ${hr.work_start}).` : `Clock out before you leave (work ended at ${hr.work_end}).`}</p>
        </div>
        <button onClick={dismiss} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Not now"><X className="h-4 w-4" /></button>
      </div>
      {early && <textarea className="fi mt-3 min-h-[70px]" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for leaving early" />}
      <div className="mt-3 flex gap-2">
        {kind === "in" && !early && <Button className="flex-1" onClick={() => run("in")} disabled={busy}>{busy ? <OrbSpinner /> : <LogIn />} Clock in</Button>}
        {kind === "out" && !early && <Button className="flex-1" onClick={() => run("out")} disabled={busy}>{busy ? <OrbSpinner /> : <LogOut />} Clock out</Button>}
        {early && <Button className="flex-1" onClick={() => (reason.trim() ? run("out", reason.trim()) : toast({ title: "Give a reason", variant: "destructive" }))} disabled={busy}>{busy ? <OrbSpinner /> : <LogOut />} Clock out early</Button>}
        <Button variant="ghost" onClick={dismiss}>Later</Button>
      </div>
    </div>
  );
}
