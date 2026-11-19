import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Phone, Lock, User, Mail, KeyRound, ShieldCheck, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { shopApi, setCustomerToken, useSite } from "../shopData";
import PageHead from "@/components/PageHead";
import AuthShell from "@/components/auth/AuthShell";
import { OrbSpinner } from "@/components/orbs";
import { cn } from "@/lib/utils";

type Mode = "in" | "up" | "forgot" | "reset" | "mfa";

/** Customer sign-in on the website (/login): phone or email + password, sign-up, reset by code, authenticator. */
export default function CustomerLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const site = useSite();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "up" ? "up" : "in");
  const [f, setF] = useState({ name: "", login: "", phone: "", email: "", password: "", code: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const name = site.shop?.name || "JMSURF Garage";
  const done = (token: string, mustChange?: boolean) => {
    setCustomerToken(token);
    const next = params.get("next");
    navigate(next && next.startsWith("/") ? next : mustChange ? "/account/security?first=1" : "/account", { replace: true });
  };
  const go = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "forgot") {
        const r = await shopApi<any>("c/forgot", { login: f.login });
        if (r.ok === false) setMsg({ text: r.error });
        else { setMsg({ ok: true, text: "If that phone or email has an account, a 6-digit code is on its way by SMS and email." }); setMode("reset"); }
        return;
      }
      if (mode === "up") {
        const r = await shopApi<any>("c/register", { name: f.name, phone: f.phone, email: f.email, password: f.password });
        return done(r.token);
      }
      if (mode === "reset") {
        const r = await shopApi<any>("c/reset", { login: f.login, code: f.code, password: f.password });
        return done(r.token);
      }
      const r = await shopApi<any>("c/login", { login: f.login, password: f.password, code: mode === "mfa" ? f.code : undefined });
      if (r.mfa_required) { setMode("mfa"); setMsg({ ok: true, text: "Enter the 6-digit code from your authenticator app." }); return; }
      done(r.token, r.must_change_password);
    } catch (err: any) { setMsg({ text: err.message }); }
    finally { setBusy(false); }
  };
  const titles: Record<Mode, [string, string]> = {
    in: ["Welcome back", "Sign in with your phone number or email."],
    up: ["Create your account", "Use the phone number you buy with at the shop: your past purchases appear automatically."],
    forgot: ["Forgot your password?", "We'll send a code to your phone and email."],
    reset: ["Set a new password", "Enter the code we sent you and a new password."],
    mfa: ["Two-step sign-in", "Open your authenticator app."],
  };
  const pw = (placeholder: string) => (
    <div className="relative"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input className="fi h-12 pl-10 pr-11 text-base" type={show ? "text" : "password"} required minLength={6} placeholder={placeholder} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === "in" ? "current-password" : "new-password"} />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
  );
  return (
    <AuthShell title={titles[mode][0]} subtitle={titles[mode][1]} brandName={name} logoUrl={site.shop?.logo_url || null}
      badge={<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ring-1 ring-border">Customer portal</span>}
      footer={<Link to="/" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><ArrowLeft className="h-4 w-4" /> Back to the website</Link>}>
      <PageHead title={`${titles[mode][0]} · ${name}`} description="Sign in to see your orders, invoices, statement and offers." path="/login" noindex />
      {(mode === "in" || mode === "up") && (
        <div className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-semibold">
          <button type="button" onClick={() => { setMode("in"); setMsg(null); }} className={cn("rounded-lg py-2", mode === "in" ? "bg-card shadow-sm" : "text-muted-foreground")}>Sign in</button>
          <button type="button" onClick={() => { setMode("up"); setMsg(null); }} className={cn("rounded-lg py-2", mode === "up" ? "bg-card shadow-sm" : "text-muted-foreground")}>Sign up</button>
        </div>
      )}
      <form onSubmit={go} className="mt-6 space-y-3">
        {mode === "up" ? <>
          <div className="relative"><User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-base" required placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="relative"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-base" required inputMode="tel" placeholder="Phone number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="relative"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-base" type="email" placeholder="Email (for statements)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          {pw("Create a password (6+ characters)")}
        </> : mode === "mfa" ? (
          <div className="relative"><ShieldCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-center font-mono text-lg tracking-[0.4em]" required inputMode="numeric" maxLength={6} autoFocus placeholder="000000" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} /></div>
        ) : <>
          <div className="relative"><User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-base" required placeholder="Phone number or email" autoComplete="username" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} /></div>
          {mode === "reset" && <div className="relative"><KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-12 pl-10 text-base" required inputMode="numeric" placeholder="6-digit code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>}
          {mode !== "forgot" && pw(mode === "reset" ? "New password" : "Password")}
        </>}
        {msg && <p className={cn("rounded-xl px-3 py-2 text-sm", msg.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")} role="alert">{msg.text}</p>}
        <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50">
          {busy && <OrbSpinner className="size-4" tint="#ffffff" />}
          {mode === "up" ? "Create account" : mode === "forgot" ? "Send code" : mode === "reset" ? "Save new password" : mode === "mfa" ? "Verify" : "Sign in"}
        </button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        {mode === "in" && <button onClick={() => { setMode("forgot"); setMsg(null); }} className="font-semibold text-primary hover:underline">Forgot password?</button>}
        {mode !== "in" && mode !== "up" && <button onClick={() => { setMode("in"); setMsg(null); }} className="font-semibold text-primary hover:underline">Back to sign in</button>}
        {mode === "forgot" && <button onClick={() => setMode("reset")} className="text-muted-foreground hover:underline">I have a code</button>}
      </div>
    </AuthShell>
  );
}
