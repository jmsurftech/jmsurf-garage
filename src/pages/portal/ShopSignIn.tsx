import { useEffect, useRef, useState } from "react";
import { belongsToShop, WRONG_SHOP_MESSAGE } from "@/lib/shopAccess";
import { resolveTenantBySlug } from "@/hooks/useTenant";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { Droplets, Eye, EyeOff, Lock, User, ArrowLeft } from "lucide-react";
import { ThinkingOrb } from "@/components/orbs/lib";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getHostSlug } from "@/lib/host";
import { resolveLoginEmail } from "@/lib/platformEmail";
import { ACCENTS, mergeSite } from "@/lib/shopSite";
import { portal, setToken, PortalError, type PortalShop } from "@/lib/portalApi";
import { OrbSpinner } from "@/components/orbs";

/** Where a signed-in staff account starts work. The route guard moves anyone
 *  without the dashboard permission on to their first allowed page. */
export const staffHome = (role: string | null) => (role === "rider" ? "/rider" : "/dashboard");

/**
 * One sign-in for everybody on a shop's address. Email → staff account.
 * Phone → the shop's delivery customer first, then a staff account with that
 * phone. Each person then lands on their own screen: customers on /order,
 * riders on /rider, owners, managers and cashiers on their work pages.
 */
export default function ShopSignIn({ slug: hostSlug }: { slug?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = (hostSlug || params.slug || getHostSlug() || "").toLowerCase();
  const base = hostSlug ? "" : `/${slug}`;
  const nav = useNavigate();
  const { user, loading: authLoading, role, profileReady } = useAuth();
  const [shop, setShop] = useState<PortalShop | null>(null);
  const [site, setSite] = useState<any>(null);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [staffPending, setStaffPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Holds the redirect while a fresh staff sign-in is checked against this shop.
  const checkingShop = useRef(false);
  const [confirmed, setConfirmed] = useState(0);

  useEffect(() => {
    portal(slug, "shop").then((d) => { setShop(d.shop); setSite(d.site); }).catch(() => { /* not a water shop: plain page */ });
  }, [slug]);

  // Already signed in (or just signed in as staff): go straight to the right screen
  // once the account's role is known.
  useEffect(() => {
    if (authLoading) return;
    if (!user || !profileReady || checkingShop.current) return;
    const go = () => nav(`${base}${staffHome(role)}`, { replace: true });
    if (role) { go(); return; }
    // The role arrives a moment after sign-in; the dashboard's own guard
    // still sorts anyone out if it never does.
    const t = setTimeout(go, 6000);
    return () => clearTimeout(t);
  }, [user, authLoading, role, profileReady, base, nav, confirmed]);

  const signInStaff = async (login: string) => {
    let email = login;
    if (!/@/.test(email)) {
      const r = await resolveLoginEmail(email, password);
      if (/too many/i.test(r.error || "")) throw new Error(r.error);
      if (!r.email) return false;
      email = r.email;
    }
    const tenant = await resolveTenantBySlug(slug).catch(() => null);
    if (!tenant) throw new Error("Could not open this company. Check your internet and try again.");
    checkingShop.current = true;
    try {
      const { data: signed, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (/confirm|verif/i.test(error.message)) throw new Error("Your email is not verified yet. Open the link we emailed you, then sign in.");
        return false;
      }
      // A valid login from another shop is still refused here.
      if (!signed.user || !(await belongsToShop(signed.user.id, tenant.id).catch(() => false))) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(WRONG_SHOP_MESSAGE);
      }
    } finally {
      checkingShop.current = false;
    }
    setConfirmed((c) => c + 1);
    try { localStorage.setItem(`jmsurf_verified_${slug}`, "1"); } catch { /* storage blocked */ }
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!navigator.onLine) { setErr("You need internet to sign in."); return; }
    const login = id.trim();
    setBusy(true); setErr(null);
    try {
      if (!/@/.test(login)) {
        // Delivery customers sign in with their phone number.
        try {
          const r = await portal<{ token: string }>(slug, "login", { phone: login, password });
          setToken(slug, r.token);
          nav(`${base}/order`, { replace: true });
          return;
        } catch (ex) {
          if (ex instanceof PortalError && ex.status === 0) throw ex;
          // Not a customer of this shop (or wrong password): try staff next.
        }
      }
      setStaffPending(true);
      if (await signInStaff(login)) return; // the effect above moves on when the role loads
      setStaffPending(false);
      setErr(/@/.test(login) ? "Wrong email or password." : "Wrong phone number or password.");
    } catch (ex: any) {
      setStaffPending(false);
      setErr(ex?.message || "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const a = site ? (ACCENTS[mergeSite(shop?.name || "", shop?.phone || null, site).accent] || ACCENTS.sky) : ACCENTS.sky;
  const grad = `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`;
  const redirecting = !!user || (busy && staffPending);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10" style={{ background: grad }}>
      <Helmet><title>Sign in{shop ? ` · ${shop.name}` : ""}</title></Helmet>
      <div aria-hidden className="pointer-events-none absolute -left-10 top-10 opacity-60" style={{ transform: "scale(2.6)", transformOrigin: "top left" }}>
        <ThinkingOrb state="weaving" size={64} tint="#ffffff" />
      </div>
      <div aria-hidden className="pointer-events-none absolute -bottom-6 right-6 opacity-50" style={{ transform: "scale(3.2)", transformOrigin: "bottom right" }}>
        <ThinkingOrb state="breathing" size={64} tint="#ffffff" />
      </div>

      <div className="relative w-full max-w-sm rounded-[2rem] bg-white p-6 text-slate-800 shadow-2xl sm:p-8">
        <div className="flex flex-col items-center text-center">
          {shop?.logo_url
            ? <img src={shop.logo_url} alt="" className="h-14 w-14 rounded-2xl object-cover shadow" />
            : <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow" style={{ background: grad }}><Droplets className="h-7 w-7" /></span>}
          <h1 className="mt-4 font-display text-2xl font-bold">{shop?.name || "Sign in"}</h1>
          <p className="mt-1 text-sm text-slate-500">Customers, riders and staff all sign in here.</p>
        </div>

        {redirecting ? (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-slate-500" role="status">
            <ThinkingOrb state="connecting" size={64} tint={a.solid} />
            Opening your account…
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={id} onChange={(e) => setId(e.target.value)} required autoComplete="username" placeholder="Phone number or email"
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-base outline-none focus:border-transparent focus:ring-2" style={{ ["--tw-ring-color" as any]: a.solid }} />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Password"
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 text-base outline-none focus:border-transparent focus:ring-2" style={{ ["--tw-ring-color" as any]: a.solid }} />
              <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white shadow-lg transition hover:opacity-95 disabled:opacity-60" style={{ background: grad }}>
              {busy && <OrbSpinner className="h-4 w-4" />}{busy ? "Signing in…" : "Sign in"}
            </button>
            <div className="pt-2 text-center text-sm text-slate-500">
              New customer? <a href={`${base}/order`} className="font-semibold hover:underline" style={{ color: a.solid }}>Create an account</a>
            </div>
            <div className="text-center text-xs text-slate-500">
              Forgot password? <a href={`${base}/order`} className="font-medium hover:underline" style={{ color: a.solid }}>Customers</a>
              {" · "}<a href={`${base}/login`} className="font-medium hover:underline" style={{ color: a.solid }}>Staff</a>
            </div>
          </form>
        )}
        <a href={`${base}/`} className="mt-6 flex items-center justify-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Back to home</a>
      </div>
    </div>
  );
}
