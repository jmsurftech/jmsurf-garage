import AuthShell from "@/components/auth/AuthShell";
import { SELLS_OPTIONS, type Sells } from "@/lib/sells";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { REGISTER_META } from "@/seo/meta";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Building2, Store, Lock, ArrowLeft, ArrowRight, Check, Shirt, Wine, Droplets, Eye, EyeOff } from "lucide-react";
import { friendlyError } from "@/lib/friendlyError";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/businessType";
import { ROOT_HOST, isReservedSubdomain, tenantUrl } from "@/lib/host";
import { MODULES } from "@/lib/modules";
import { track } from "@/lib/tracking";
import { goToCompany, listMyCompanies } from "@/lib/companySwitch";
import { HEARD_FROM, HEARD_NEEDS_DETAIL, COMPANY_SIZES, GOALS } from "@/lib/signupOptions";

const INDUSTRIES = [
  "Retail & wholesale", "Professional services", "Manufacturing", "Construction & real estate", "Hospitality & restaurants",
  "Healthcare & pharmacy", "Education", "Logistics & transport", "Agriculture & agribusiness", "NGO & non-profit",
  "Technology & telecoms", "Salon, spa & beauty", "Automotive", "Financial services & SACCO", "Energy & utilities", "Other",
];
/** Apps offered at sign-up (each starts a 14-day trial). */
const SIGNUP_APPS = ["inventory", "crm", "hrm", "projects", "expense", "commerce", "service", "marketing", "manufacturing", "contracts"];
/** Version of the Terms of Service and Privacy Policy accepted at sign-up (must match public.current_terms_version()). */
const TERMS_VERSION = "2026-11-14";
import { sendVerificationEmail, sendWelcomeEmail, sendSignupAlert, releaseOrphanLogin } from "@/lib/platformEmail";
import { COUNTRY_GROUPS, countryByCode } from "@/lib/countries";
import { CURRENCIES } from "@/lib/currencies";

/** Best guess of the visitor's country from the browser (falls back to Kenya). */
function guessCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const byZone: Record<string, string> = {
      "Africa/Nairobi": "KE", "Africa/Kampala": "UG", "Africa/Dar_es_Salaam": "TZ", "Africa/Kigali": "RW", "Africa/Addis_Ababa": "ET",
      "Africa/Mogadishu": "SO", "Africa/Lagos": "NG", "Africa/Accra": "GH", "Africa/Johannesburg": "ZA", "Africa/Lusaka": "ZM",
      "Africa/Blantyre": "MW", "Africa/Harare": "ZW", "Africa/Maputo": "MZ", "Africa/Kinshasa": "CD", "Africa/Lubumbashi": "CD",
      "Africa/Juba": "SS", "Africa/Khartoum": "SD", "Africa/Cairo": "EG", "Africa/Casablanca": "MA", "Africa/Abidjan": "CI",
      "Africa/Dakar": "SN", "Africa/Douala": "CM", "Africa/Bujumbura": "BI", "Africa/Djibouti": "DJ", "Africa/Gaborone": "BW",
      "Africa/Windhoek": "NA", "Africa/Luanda": "AO", "Indian/Antananarivo": "MG", "Indian/Mauritius": "MU",
    };
    const lang = (navigator.language || "").split("-")[1]?.toUpperCase();
    return byZone[tz] || (lang && countryByCode(lang) ? lang : "KE");
  } catch { return "KE"; }
}


const TYPE_ICONS: Record<BusinessType, typeof Store> = {
  general: Store,
  liquor: Wine,
  clothing: Shirt,
  water: Droplets,
};

const TYPE_INDUSTRY: Record<BusinessType, string> = {
  general: "Retail",
  liquor: "Liquor Store",
  clothing: "Fashion & Apparel",
  water: "Water Refill",
};

export default function Register() {
  const [step, setStep] = useState(1);
  const nav = useNavigate();
  // /register?app=crm: sign up for one app and use it on its own (no accounting menus until wanted).
  const [params] = useSearchParams();
  const soloApp = MODULES.find((m) => m.key === params.get("app") && !m.included) || null;
  const [solo, setSolo] = useState(!!soloApp);
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    businessName: "", businessEmail: "", businessPhone: "", businessAddress: "",
    contactName: "",
    industry: "Retail & wholesale",
    modules: (soloApp ? [soloApp.key] : ["inventory", "crm"]) as string[],
    businessType: "general" as BusinessType,
    sells: "both" as Sells,
    storeSlug: "",
    password: "", confirmPassword: "",
    country: guessCountry(),
    currency: countryByCode(guessCountry())?.currency || "KES",
    jobTitle: "", companySize: "", website: "", heardFrom: "", heardDetail: "", goals: [] as string[],
  });
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const set = (key: string, val: string | number) => setForm(f => ({ ...f, [key]: val }));

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const checkSlug = async (slug: string) => {
    if (!slug || slug.length < 3) { setSlugAvailable(null); return; }
    if (isReservedSubdomain(slug, true)) { setSlugAvailable(false); setCheckingSlug(false); return; }
    setCheckingSlug(true);
    const { data } = await supabase.from("tenants" as any).select("id").eq("slug", slug).maybeSingle();
    setSlugAvailable(!data);
    setCheckingSlug(false);
  };
  const canNext = () => {
    if (step === 1) return form.businessName && form.businessEmail && form.businessPhone && form.contactName && form.storeSlug.length >= 3 && slugAvailable === true;
    if (step === 2) return !!form.industry && !!form.companySize && !!form.heardFrom && (!HEARD_NEEDS_DETAIL.includes(form.heardFrom) || !!form.heardDetail.trim());
    if (step === 3) return form.businessEmail && form.password && form.password === form.confirmPassword && form.password.length >= 6 && agreed;
    return false;
  };

  const handleSubmit = async () => {
    if (!canNext()) return;
    setLoading(true);
    try {
      const signUp = () => supabase.auth.signUp({
        email: form.businessEmail,
        password: form.password,
        options: {
            data: {
            full_name: form.contactName,
            registration_type: "tenant",
            business_name: form.businessName,
            business_email: form.businessEmail,
            business_phone: form.businessPhone,
            business_address: form.businessAddress,
            industry: form.industry,
            business_type: form.businessType,
            contact_name: form.contactName,
            contact_email: form.businessEmail,
            contact_phone: form.businessPhone,
            plan_id: null,
            custom_users: 0,
            billing_cycle: "monthly",
            store_slug: form.storeSlug,
            country: form.country,
            currency: form.currency,
            start_apps: form.modules,
            sells: form.sells,
            job_title: form.jobTitle || null, company_size: form.companySize, website: form.website || null,
            heard_from: form.heardFrom, heard_detail: form.heardDetail || null, goals: form.goals,
            focus_app: solo && soloApp ? soloApp.key : null,
            // Checked again by the database: no company is created without these.
            terms_accepted: agreed,
            terms_version: TERMS_VERSION,
            terms_source: "signup",
            marketing_opt_in: marketing,
          },
          emailRedirectTo: tenantUrl(form.storeSlug, "/login"),
        },
      });
      const taken = (r: Awaited<ReturnType<typeof signUp>>) =>
        /already (been )?registered|already exists/i.test(r.error?.message || "")
        || (!r.error && !!r.data.user && (!r.data.user.identities || r.data.user.identities.length === 0));
      let result = await signUp();
      // A login left over from a removed shop blocks the email: free it and try once more.
      if (taken(result)) {
        const freed = await releaseOrphanLogin(form.businessEmail.trim().toLowerCase()).catch(() => null);
        if (freed?.released) result = await signUp();
      }
      if (taken(result)) {
        throw new Error("An account with this email already exists. Please use a different email or sign in.");
      }
      const { data, error: authError } = result;
      if (authError) throw authError;

      // Send the confirmation email through our own mail server so it always
      // arrives, even when the built-in mailer is not wired up.
      if (!data.user?.email_confirmed_at) {
        sendVerificationEmail(form.businessEmail, tenantUrl(form.storeSlug, "/dashboard")).catch(() => {});
      }

      sendWelcomeEmail({
        email: form.businessEmail,
        name: form.contactName || form.businessName,
        loginUrl: tenantUrl(form.storeSlug, "/login"),
      }).catch(() => {});

      // Notify the platform admin about the new signup
      sendSignupAlert({
        businessName: form.businessName,
        contactName: form.contactName,
        email: form.businessEmail,
        phone: form.businessPhone,
        industry: form.industry,
        storeSlug: form.storeSlug,
      }).catch(() => {});


      // Signed in straight away: start the chosen apps' trials and open the
      // new company's own address, already signed in.
      track("CompleteRegistration", { content_name: form.industry, status: true });
      if (data.session) {
        // The first visit switches the chosen apps on (and single-app use) from the sign-up details.
        const mine = await listMyCompanies().catch(() => []);
        await goToCompany(mine[0]?.slug || form.storeSlug, solo && soloApp ? soloApp.home : "/dashboard?welcome=1");
        return;
      }
      // Company addresses (<slug>.garage.jmsurf.co.ke) are served by the wildcard
      // route, so a new company is reachable immediately.
      const liveUrl = tenantUrl(form.storeSlug, "/login?new=1");
      toast({
        title: "Your company is ready",
        description: `Your address is ${liveUrl} — already active. Check ${form.businessEmail} to verify your email, then sign in.`,
        duration: 10000,
      });
      window.location.href = liveUrl;
    } catch (err: any) {
      toast({ title: "Could not create account", description: friendlyError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "fi h-11";
  const labelClass = "text-sm font-medium block mb-1.5";
  const stepTitles = ["Company", "Apps", "Password"];

  return (
    <>
      <Helmet>
        <title>{REGISTER_META.title}</title>
        <meta name="description" content={REGISTER_META.description} />
        <link rel="canonical" href="https://garage.jmsurf.co.ke/register" />
        <meta property="og:title" content={REGISTER_META.title} />
        <meta property="og:description" content={REGISTER_META.description} />
        <meta property="og:url" content="https://garage.jmsurf.co.ke/register" />
        <meta name="twitter:title" content={REGISTER_META.title} />
        <meta name="twitter:description" content={REGISTER_META.description} />
        <meta property="og:image" content="https://garage.jmsurf.co.ke/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="JMSURF Garage: all-in-one business management for businesses everywhere" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://garage.jmsurf.co.ke/og-image.png" />
      </Helmet>
    <AuthShell wide title="Start your free trial" subtitle="14 days free. No card required."
      points={["Your company is ready in about a minute", "Books, inventory, CRM, HR, projects and 50+ apps", "Bring your data from your old system or Excel"]}
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link></>}>

        <div className="mb-6 flex items-center justify-center gap-3 lg:justify-start">
          {[Building2, Store, Lock].map((Icon, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition ${
                  i + 1 <= step ? "bg-primary text-primary-foreground shadow-sm" : "bg-card text-muted-foreground border border-border"
                }`}>
                  {i + 1 < step ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={`text-[11px] font-medium ${i + 1 <= step ? "text-foreground" : "text-muted-foreground"}`}>{stepTitles[i]}</span>
              </div>
              {i < 2 && <div className={`w-10 h-0.5 mb-5 rounded ${i + 1 < step ? "bg-primary" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-7">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Business and contact details</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Business name *</label>
                  <input value={form.businessName} onChange={e => { set("businessName", e.target.value); if (!slugTouched) { const sug = slugify(e.target.value).slice(0, 30); set("storeSlug", sug); if (sug.length >= 3) checkSlug(sug); } }} className={inputClass} placeholder="Your business name" /></div>
                <div><label className={labelClass}>Your full name *</label>
                  <input value={form.contactName} onChange={e => set("contactName", e.target.value)} className={inputClass} placeholder="Enter full name" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Email *</label>
                  <input type="email" value={form.businessEmail} onChange={e => set("businessEmail", e.target.value)} className={inputClass} placeholder="Enter email address" /></div>
                <div><label className={labelClass}>Phone *</label>
                  <input value={form.businessPhone} onChange={e => set("businessPhone", e.target.value)} className={inputClass} placeholder="Enter phone number" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Country *</label>
                  <select value={form.country} className={inputClass}
                    onChange={(e) => { const c = countryByCode(e.target.value); setForm((f) => ({ ...f, country: e.target.value, currency: c?.currency || f.currency })); }}>
                    {COUNTRY_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </optgroup>
                    ))}
                  </select></div>
                <div><label className={labelClass}>Currency *</label>
                  <select value={form.currency} onChange={(e) => set("currency", e.target.value)} className={inputClass}>
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                  </select></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={labelClass}>Your job title</label>
                  <input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} className={inputClass} placeholder="e.g. Owner, Finance manager" /></div>
                <div><label className={labelClass}>Website</label>
                  <input value={form.website} onChange={e => set("website", e.target.value)} className={inputClass} placeholder="www.yourcompany.co.ke (optional)" /></div>
              </div>
              <div><label className={labelClass}>Business address</label>
                <input value={form.businessAddress} onChange={e => set("businessAddress", e.target.value)} className={inputClass} placeholder="Street, City, Country" /></div>
              <div>
                <label className={labelClass}>Your JMSURF Garage address *</label>
                <div className="flex items-stretch">
                  <input
                    value={form.storeSlug}
                    onChange={e => {
                      setSlugTouched(true);
                      const slug = slugify(e.target.value);
                      set("storeSlug", slug);
                      checkSlug(slug);
                    }}
                    className={`fi h-11 flex-1 rounded-r-none ${
                      slugAvailable === true ? "!border-success" : slugAvailable === false ? "!border-destructive" : ""
                    }`}
                    placeholder="yourcompany"
                  />
                  <span className="flex items-center rounded-r-xl border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">.{ROOT_HOST}</span>
                </div>
                {checkingSlug && <p className="text-muted-foreground text-xs mt-1.5">Checking...</p>}
                {slugAvailable === true && <p className="text-green-600 text-xs mt-1.5">Available</p>}
                {slugAvailable === false && <p className="text-red-600 text-xs mt-1.5">{isReservedSubdomain(form.storeSlug, true) ? "This name is reserved" : "Already taken"}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h2 className="text-lg font-semibold">Company size *</h2>
                  <select className={inputClass + " mt-2"} value={form.companySize} onChange={(e) => set("companySize", e.target.value)}>
                    <option value="">Choose…</option>{COMPANY_SIZES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">How did you hear about us? *</h2>
                  <select className={inputClass + " mt-2"} value={form.heardFrom} onChange={(e) => set("heardFrom", e.target.value)}>
                    <option value="">Choose…</option>{HEARD_FROM.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  {HEARD_NEEDS_DETAIL.includes(form.heardFrom) && <input className={inputClass + " mt-2"} value={form.heardDetail} onChange={(e) => set("heardDetail", e.target.value)} placeholder={form.heardFrom === "Other" ? "Tell us where" : "Who or which one?"} />}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold">What do you want to do with JMSURF Garage?</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GOALS.map((g) => { const on = form.goals.includes(g); return <button type="button" key={g} onClick={() => setForm((f) => ({ ...f, goals: on ? f.goals.filter((x) => x !== g) : [...f.goals, g] }))} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40"}`}>{g}</button>; })}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold">Your industry</h2>
                <select className={inputClass + " mt-2"} value={form.industry} onChange={(e) => set("industry", e.target.value)}>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              {soloApp && (
                <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: soloApp.color }}><soloApp.icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1"><p className="font-semibold">{soloApp.name}</p><p className="text-sm text-muted-foreground">{soloApp.tagline}</p></div>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={solo} onChange={(e) => setSolo(e.target.checked)} />
                    <span>Use {soloApp.name.replace("JMSURF ", "")} on its own. Only its screens show; add the accounting suite or other apps whenever you like.</span></label>
                </div>
              )}
              {!(soloApp && solo) && <div>
                <h2 className="text-lg font-semibold">What do you sell?</h2>
                <div className="mt-2 mb-5 grid gap-2 sm:grid-cols-3">
                  {SELLS_OPTIONS.map((o) => (
                    <button type="button" key={o.value} onClick={() => setForm((f) => ({ ...f, sells: o.value, modules: o.value === "services" ? f.modules.filter((x) => x !== "inventory") : f.modules }))}
                      className={`rounded-xl border-2 p-3 text-left transition ${form.sells === o.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <span className="block text-sm font-semibold">{o.label}</span><span className="block text-xs text-muted-foreground">{o.hint}</span>
                    </button>
                  ))}
                </div>
                <h2 className="text-lg font-semibold">Which apps do you want?</h2>
                <p className="text-sm text-muted-foreground">JMSURF BOOKS (accounting, sales, purchases, banking, reports) is always included. Each app below is free for 14 days; add or remove any time.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {SIGNUP_APPS.map((k) => MODULES.find((m) => m.key === k)!).map((m) => {
                    const on = form.modules.includes(m.key);
                    return (
                      <button type="button" key={m.key} onClick={() => setForm((f) => ({ ...f, modules: on ? f.modules.filter((x) => x !== m.key) : [...f.modules, m.key] }))}
                        className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><m.icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{m.name}</span><span className="block text-xs text-muted-foreground">{m.tagline}</span></span>
                        <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                      </button>
                    );
                  })}
                </div>
              </div>}
            </div>
          )}

          {false && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">What kind of company is this?</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {BUSINESS_TYPES.map(bt => {
                  const Icon = TYPE_ICONS[bt.key];
                  const active = form.businessType === bt.key;
                  return (
                    <button key={bt.key} onClick={() => {
                      set("businessType", bt.key);
                      set("industry", TYPE_INDUSTRY[bt.key]);
                    }}
                      className={`p-5 rounded-xl border-2 text-center transition ${
                        active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                      }`}>
                      <Icon className={`w-7 h-7 mx-auto mb-3 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`block text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{bt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Create a password</h2>
              <div className="rounded-xl border border-border bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">Login email: <span className="text-foreground font-medium">{form.businessEmail}</span></p>
              </div>
              <div><label className={labelClass}>Password * (min 6 characters)</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={form.password} onChange={e => set("password", e.target.value)} className={`${inputClass} pr-11`} placeholder="Enter a password" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div><label className={labelClass}>Confirm password *</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={form.confirmPassword} onChange={e => set("confirmPassword", e.target.value)} className={`${inputClass} pr-11`} placeholder="Repeat the password" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.confirmPassword && form.password !== form.confirmPassword && <p className="text-red-600 text-xs mt-1.5">Passwords do not match</p>}
              </div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
                You will go straight into your new company. We also email you a link to confirm your address.
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>I agree to the <a href="/terms" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Privacy Policy</a>. *</span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span className="text-muted-foreground">Send me JMSURF Garage product news and offers by email or SMS (optional). You can stop them at any time.</span>
              </label>
            </div>
          )}

          <div className="flex justify-between mt-8">
            {step > 1 ? (
              <Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
            ) : (
              <Link to="/"><Button variant="outline" className="rounded-xl"><ArrowLeft className="w-4 h-4 mr-2" /> Home</Button></Link>
            )}
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canNext()} className="rounded-xl">
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={!canNext() || loading} className="rounded-xl">
                {loading ? "Creating..." : "Create Account"}
              </Button>
            )}
          </div>
        </div>

    </AuthShell>
    </>
  );
}
