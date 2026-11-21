import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import { CONTACT } from "@/lib/siteFacts";

import { UPDATED, termsSections, privacySections } from "./legalText";
import { PRIVACY_META, TERMS_META, canonicalUrl } from "@/seo/meta";

export default function Legal() {
  const { pathname } = useLocation();
  const isPrivacy = pathname.includes("privacy");
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const email = CONTACT.email;
  const sections = isPrivacy ? privacySections(email) : termsSections(email);
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service";
  const meta = isPrivacy ? PRIVACY_META : TERMS_META;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Helmet>
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <link rel="canonical" href={canonicalUrl(meta.path)} />
      </Helmet>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-32 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-orange-600">Legal</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>
        <div className="mt-6 flex gap-2 text-sm">
          <Link to="/terms" className={`rounded-full px-4 py-1.5 font-medium ${!isPrivacy ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>Terms</Link>
          <Link to="/privacy" className={`rounded-full px-4 py-1.5 font-medium ${isPrivacy ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>Privacy</Link>
        </div>
        <div className="mt-10 space-y-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="font-display text-xl font-bold">{s.h}</h2>
              <div className="mt-3 space-y-3 leading-relaxed text-slate-700">
                {s.p.map((para, i) => Array.isArray(para) ? (
                  <ul key={i} className="list-disc space-y-1.5 pl-5">{para.map((li) => <li key={li}>{li}</li>)}</ul>
                ) : <p key={i}>{para}</p>)}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
