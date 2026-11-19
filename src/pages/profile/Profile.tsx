import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, UserRound, ShieldCheck, ShieldAlert, KeyRound, Save, Smartphone, Monitor, IdCard, Wallet, Plane, Mail, Phone, Trash2, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PasswordInput } from "@/components/PasswordInput";
import { erpApi } from "@/lib/erpApi";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;

/** Other logins of mine (different emails): their companies appear in my company switcher. */
function LinkedLogins() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const { data: links = [], refetch } = useQuery({ queryKey: ["my-linked-logins"], queryFn: async () => ((await sb.rpc("my_linked_logins")).data || []) as { user_id: string; email: string; linked_at: string }[] });
  const link = async () => {
    setBusy(true);
    try {
      await erpApi("session/link-login", f);
      setF({ email: "", password: "" }); refetch(); qc.invalidateQueries({ queryKey: ["my-linked-companies"] });
      toast({ title: "Login linked", description: "Its companies are now in your company switcher." });
    } catch (e: any) { toast({ title: "Not linked", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const unlink = async (id: string, email: string) => {
    if (!(await confirmAction({ title: `Unlink ${email}?`, message: "Its companies leave your company switcher. Both logins keep working.", confirmLabel: "Unlink" }))) return;
    await sb.rpc("unlink_login", { p_other: id }); refetch(); qc.invalidateQueries({ queryKey: ["my-linked-companies"] });
  };
  return (
    <Panel title="Linked logins" icon={Link2} description="Use companies of another login (a different email) without signing out: link it here and switch from the company menu.">
      <div id="linked" className="space-y-3">
        {links.map((l) => (
          <div key={l.user_id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
            <Link2 className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate">{l.email}</span>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void unlink(l.user_id, l.email)}>Unlink</Button>
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="fi" type="email" autoComplete="off" placeholder="Other login email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <PasswordInput className="fi" autoComplete="off" placeholder="Its password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <Button onClick={() => void link()} disabled={busy || !f.email || !f.password}>{busy ? <OrbSpinner /> : <Link2 />} Link this login</Button>
        <p className="text-xs text-muted-foreground">The password only proves the other login is yours; it is not stored.</p>
      </div>
    </Panel>
  );
}
type Factor = { id: string; friendly_name?: string | null; status: string; created_at?: string };

/** My profile: details, password, two-step sign-in, devices and (when linked) my employee file and payslips. */
export default function Profile() {
  const { user, profile, role } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ display_name: "", phone: "" });
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState("");
  useEffect(() => setF({ display_name: profile?.display_name || "", phone: profile?.phone || "" }), [profile?.display_name, profile?.phone]);
  const { data: emp } = useQuery({ queryKey: ["hr-me", user?.id], enabled: !!user?.id, queryFn: async () => (await sb.from("hr_employees").select("*, hr_departments(name), hr_designations(name)").eq("user_id", user.id).maybeSingle()).data });
  const { data: slips = [] } = useQuery({ queryKey: ["my-payslips", emp?.id], enabled: !!emp?.id, queryFn: async () => (await sb.from("hr_payslips").select("*, hr_payroll_runs(period,status)").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(12)).data || [] });
  const { data: sessions = [], refetch: refetchSessions } = useQuery({ queryKey: ["my-sessions", user?.id], enabled: !!user?.id, queryFn: async () => ((await sb.rpc("team_active_sessions")).data || []).filter((s: any) => s.user_id === user.id) });

  const saveProfile = async () => {
    if (!f.display_name.trim()) return toast({ title: "Enter your name", variant: "destructive" });
    setBusy("profile");
    const { error } = await sb.from("profiles").update({ display_name: f.display_name.trim(), phone: f.phone.trim() || null }).eq("user_id", user.id);
    setBusy("");
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Profile saved" }); qc.invalidateQueries();
  };
  const changePw = async () => {
    if (pw.next.length < 8) return toast({ title: "Use at least 8 characters", variant: "destructive" });
    if (pw.next !== pw.confirm) return toast({ title: "The passwords do not match", variant: "destructive" });
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy("");
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    setPw({ next: "", confirm: "" }); toast({ title: "Password changed" });
  };
  return (
    <div className="space-y-5">
      <PageHeader title="My profile" icon={UserRound} description="Your details, password, two-step sign-in and devices." />
      <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,hsl(var(--primary)),hsl(var(--primary)/0.8)_60%,hsl(var(--accent)))] p-6 text-primary-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/20 font-display text-2xl font-bold">{(profile?.display_name || "U").charAt(0).toUpperCase()}</span>
          <div className="flex-1"><p className="font-display text-2xl font-bold">{profile?.display_name}</p><p className="text-sm opacity-85">{user?.email} · {String(role || "").replace("_", " ")}</p></div>
          {emp && <span className="rounded-full bg-white/20 px-3 py-1 text-sm">{emp.employee_no} · {emp.hr_designations?.name || "Employee"}</span>}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Details" icon={UserRound}>
          <div className="space-y-3">
            <Field label="Full name"><input className="fi" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
            <Field label="Phone"><input className="fi" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Sign-in email" hint="Ask the owner to change your sign-in email."><input className="fi" value={user?.email || ""} disabled /></Field>
            <Button onClick={saveProfile} disabled={busy === "profile"}>{busy === "profile" ? <OrbSpinner /> : <Save />} Save</Button>
          </div>
        </Panel>
        <Panel title="Password" icon={KeyRound}>
          <div className="space-y-3">
            <Field label="New password" hint="At least 8 characters; mix letters and numbers."><PasswordInput className="fi" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Repeat it"><PasswordInput className="fi" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button onClick={changePw} disabled={busy === "pw"}>{busy === "pw" ? <OrbSpinner /> : <KeyRound />} Change password</Button>
          </div>
        </Panel>
        <MfaPanel />
        <LinkedLogins />
        <Panel title="Signed-in devices" icon={Monitor} flush>
          <ul className="divide-y divide-border">{(sessions as any[]).length === 0 ? <li className="px-5 py-4 text-sm text-muted-foreground">Only this device.</li> : (sessions as any[]).map((s) => (
            <li key={s.session_id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {/Android|iPhone|Mobile/i.test(s.user_agent || "") ? <Smartphone className="h-5 w-5 text-muted-foreground" /> : <Monitor className="h-5 w-5 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="block truncate">{String(s.user_agent || "Device").slice(0, 60)}</span><span className="text-xs text-muted-foreground">{s.ip || ""} · active {new Date(s.refreshed_at).toLocaleString("en-GB")}</span></span>
              {s.is_current ? <span className="text-xs font-semibold text-primary">This device</span> : <Button size="sm" variant="outline" onClick={async () => { if (await confirmAction({ title: "Sign that device out?", confirmLabel: "Sign out" })) { await sb.rpc("team_end_session", { p_session: s.session_id }); refetchSessions(); toast({ title: "Signed out" }); } }}><LogOut /> Sign out</Button>}
            </li>
          ))}</ul>
        </Panel>
      </div>
      {emp && <>
        <StatGrid>
          <StatTile label="Department" value={emp.hr_departments?.name || "—"} icon={IdCard} tone="primary" />
          <StatTile label="Basic salary" value={formatKES(Number(emp.basic_salary))} icon={Wallet} tone="success" />
          <StatTile label="Joined" value={new Date(emp.hire_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} icon={IdCard} tone="info" />
          <StatTile label="Leave" value={<Link to="/hrm/leave" className="text-primary hover:underline">Request leave</Link>} icon={Plane} tone="warning" />
        </StatGrid>
        <Panel title="My payslips" icon={Wallet} flush>
          {(slips as any[]).length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No payslips yet.</p> :
            <TableWrap><table className="dt"><thead><tr><th>Month</th><th className="num">Gross</th><th className="num">PAYE</th><th className="num">Net pay</th></tr></thead>
              <tbody><PagedRows rows={(slips as any[]).filter((s) => s.hr_payroll_runs?.status !== "draft")} colSpan={4}>{(pageRows) => pageRows.map((s) => <tr key={s.id}><td>{s.hr_payroll_runs?.period}</td><td className="num">{formatKES(Number(s.gross))}</td><td className="num">{formatKES(Number(s.paye))}</td><td className="num font-semibold">{formatKES(Number(s.net_pay))}</td></tr>)}</PagedRows></tbody></table></TableWrap>}
        </Panel>
      </>}
      <p className="flex items-center gap-4 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {user?.email} <Phone className="h-3.5 w-3.5" /> {profile?.phone || "—"}</p>
    </div>
  );
}

/** Two-step sign-in with an authenticator app (Supabase MFA). */
export function MfaPanel() {
  const { toast } = useToast();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { const { data } = await supabase.auth.mfa.listFactors(); setFactors(((data?.totp || []) as Factor[]).filter((x) => x.status === "verified")); };
  useEffect(() => { void load(); }, []);
  const start = async () => {
    setBusy(true);
    // Clear half-finished set-ups first.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const x of ((data as any)?.all || []).filter((x: any) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: x.id }).catch(() => {});
    const { data: d, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: window.location.hostname, friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}` });
    setBusy(false);
    if (error) return toast({ title: "Could not start", description: error.message, variant: "destructive" });
    setEnrolling({ id: d.id, qr: (d as any).totp?.qr_code || "", secret: (d as any).totp?.secret || "" });
  };
  const confirm = async () => {
    if (!enrolling) return;
    setBusy(true);
    try {
      const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId: enrolling.id }); if (e1) throw e1;
      const { error } = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.id, code: code.trim() }); if (error) throw error;
      toast({ title: "Two-step sign-in is on", description: "You'll enter a code from your app when you sign in." });
      setEnrolling(null); setCode(""); await load();
    } catch (e: any) { toast({ title: "Wrong code", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!(await confirmAction({ title: "Turn off two-step sign-in?", message: "Your account will be protected by the password only.", danger: true, confirmLabel: "Turn off" }))) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    toast({ title: "Two-step sign-in turned off" }); await load();
  };
  return (
    <Panel title="Two-step sign-in" icon={factors.length ? ShieldCheck : ShieldAlert} actions={<span className={cn("text-xs font-semibold", factors.length ? "text-success" : "text-muted-foreground")}>{factors.length ? "On" : "Off"}</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">Adds a 6-digit code from Google Authenticator, Microsoft Authenticator or Authy on top of your password.</p>
        {enrolling ? <>
          {enrolling.qr && <img src={enrolling.qr} alt="Set-up code" className="h-44 w-44 rounded-xl border border-border bg-white p-2" />}
          <p className="break-all text-xs text-muted-foreground">Can't scan? Key: <span className="font-mono">{enrolling.secret}</span></p>
          <div className="flex gap-2"><input className="fi max-w-[160px] text-center font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" /><Button onClick={confirm} disabled={busy || code.length < 6}>{busy && <OrbSpinner />} Turn on</Button><Button variant="ghost" onClick={() => { void supabase.auth.mfa.unenroll({ factorId: enrolling.id }); setEnrolling(null); }}>Cancel</Button></div>
        </> : factors.length ? factors.map((x) => (
          <div key={x.id} className="flex items-center justify-between rounded-xl border border-border p-3"><span>{x.friendly_name || "Authenticator app"}</span><Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(x.id)}><Trash2 /> Turn off</Button></div>
        )) : <Button onClick={start} disabled={busy}>{busy ? <OrbSpinner /> : <ShieldCheck />} Set up</Button>}
      </div>
    </Panel>
  );
}

/** Shown after sign-in when the account has two-step sign-in and this session has not passed it yet. */
export function MfaGate({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const { signOut } = useAuth() as any;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const f = (data?.totp || []).find((x: any) => x.status === "verified");
      if (!f) return onDone();
      const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId: f.id }); if (e1) throw e1;
      const { error } = await supabase.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: code.trim() }); if (error) throw error;
      onDone();
    } catch (e: any) { toast({ title: "Wrong code", description: e.message, variant: "destructive" }); setCode(""); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><ShieldCheck className="h-7 w-7" /></span>
        <h1 className="mt-4 font-display text-2xl font-bold">Two-step sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        <input className="fi mt-5 h-12 text-center font-mono text-xl tracking-[0.4em]" inputMode="numeric" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()} placeholder="000000" />
        <Button className="mt-4 w-full" onClick={verify} disabled={busy || code.length < 6}>{busy && <OrbSpinner />} Verify</Button>
        <button className="mt-4 text-sm text-muted-foreground hover:underline" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}
