/**
 * The website's guide pages: garage types (/for/...), buyer guides (/guides/...), the
 * questions page (/faq) and town pages (/garage-software/...). The words come from
 * src/seo/content.ts, the same data the build-time snapshots use (src/seo/pages.ts),
 * so every visitor and every crawler reads the same page.
 */
import { useEffect } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { CONTENT_BY_PATH, CONTENT_LABELS, CONTENT_PUBLISHED, contentCrumbs, waLink, type Block, type Table } from "@/seo/content";
import { canonicalUrl } from "@/seo/meta";
import { MODULE_BY_KEY } from "@/lib/modules";
import { PHOTOS } from "@/lib/photos";
import GaragePhoto from "@/components/landing/GaragePhoto";
import { Orbs } from "@/components/brand/Orbs";
import { Nav, Footer, FinalCta, Reveal, Eyebrow, useSiteContact, WhatsAppButton } from "@/pages/Landing";
import { track } from "@/lib/tracking";

/** A plain data table (plans, prices, comparisons); scrolls sideways on a phone. */
export function TableView({ t }: { t: Table }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="px-4 pt-3 text-left text-xs text-muted-foreground">{t.caption}</caption>
        <thead>
          <tr>{t.head.map((h, i) => <th key={i} scope="col" className="border-b border-border px-4 py-3 font-display font-bold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.map((row, ri) => (
            <tr key={ri} className="even:bg-muted/30">
              {row.map((x, i) => i === 0
                ? <th key={i} scope="row" className="border-b border-border px-4 py-3 font-semibold">{x}</th>
                : <td key={i} className="border-b border-border px-4 py-3 text-muted-foreground">{x}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isExternal = (h: string) => /^https?:\/\//.test(h);
const SmartLink = ({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) =>
  isExternal(to) ? <a href={to} className={className}>{children}</a> : <Link to={to} className={className}>{children}</Link>;

function BlockView({ b }: { b: Block }) {
  return (
    <section className="py-8">
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{b.h}</h2>
      {(b.p || []).map((x, i) => <p key={i} className="mt-4 leading-relaxed text-muted-foreground">{x}</p>)}
      {b.list && (
        <ul className="mt-5 space-y-2.5">
          {b.list.map((x) => <li key={x} className="flex gap-2.5 leading-relaxed text-foreground/85"><Check className="mt-1 h-4 w-4 shrink-0 text-primary" />{x}</li>)}
        </ul>
      )}
      {b.table && <TableView t={b.table} />}
      {b.links && (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {b.links.map(([l, h, d]) => (
            <li key={h}>
              <SmartLink to={h} className="group block h-full rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <b className="flex items-center justify-between gap-2 font-display">{l}<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></b>
                <span className="mt-1 block text-sm text-muted-foreground">{d}</span>
              </SmartLink>
            </li>
          ))}
        </ul>
      )}
      {(b.after || []).map((x, i) => <p key={i} className="mt-4 leading-relaxed text-muted-foreground">{x}</p>)}
    </section>
  );
}

export default function ContentPage() {
  const { pathname } = useLocation();
  const key = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const c = CONTENT_BY_PATH[key];
  const contact = useSiteContact();
  useEffect(() => { window.scrollTo(0, 0); }, [key]);
  if (!c) return <Navigate to="/" replace />;
  const crumbs = contentCrumbs(c);
  const photo = c.photo ? PHOTOS[c.photo] : null;
  const wa = waLink(c.wa);
  const Ctas = () => (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link to="/register" onClick={() => track("Lead", { content_name: `guide_${key}` })}
        className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 font-display text-[15px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">
        {CONTENT_LABELS.start} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
      <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("Contact", { method: "whatsapp" })}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-card/70 px-6 py-3.5 font-display text-[15px] font-bold ring-1 ring-border backdrop-blur hover:bg-muted">
        <MessageCircle className="h-4 w-4 text-[#25d366]" />{CONTENT_LABELS.whatsapp}
      </a>
    </div>
  );
  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <title>{c.title}</title>
        <meta name="description" content={c.description} />
        <link rel="canonical" href={canonicalUrl(c.path)} />
        <meta property="og:title" content={c.h1} />
        <meta property="og:description" content={c.description} />
        <meta property="og:url" content={canonicalUrl(c.path)} />
      </Helmet>
      <Nav />
      <main>
        <section className="relative overflow-hidden pb-12 pt-28 sm:pt-36">
          <Orbs intensity="subtle" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <nav aria-label="Breadcrumb" className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {crumbs.map(([n, p], i) => i === crumbs.length - 1
                  ? <span key={p} className="text-foreground/70">{n}</span>
                  : <span key={p}><Link to={p} className="hover:text-foreground">{n}</Link> / </span>)}
              </nav>
              <div className="mt-6"><Eyebrow left>{c.eyebrow}</Eyebrow></div>
              <h1 className="mt-5 font-display text-[2.3rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl">{c.h1}</h1>
              <p className="mt-5 max-w-xl text-lg font-medium text-foreground/85">{c.lead}</p>
              {c.article && <p className="mt-3 text-xs text-muted-foreground">{CONTENT_LABELS.updated} {CONTENT_PUBLISHED} · JMSURF Technologies</p>}
              <Ctas />
            </div>
            {photo && (
              <div className="relative">
                <div aria-hidden className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-primary/25 to-transparent blur-2xl" />
                <GaragePhoto photo={photo} eager sizes="(min-width: 1024px) 45vw, 100vw" className="relative aspect-[4/3] rounded-[2rem] shadow-2xl ring-1 ring-border" />
              </div>
            )}
          </div>
        </section>

        <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
          {c.blocks.map((b) => <BlockView key={b.h} b={b} />)}

          {!!c.modules?.length && (
            <section className="py-8">
              <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{CONTENT_LABELS.modules}</h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {c.modules.map((k) => MODULE_BY_KEY[k]).filter(Boolean).map((m) => (
                  <li key={m.key}>
                    <Link to={`/solutions/${m.key}`} className="group flex h-full items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.color }}><m.icon className="h-5 w-5" /></span>
                      <span className="min-w-0"><b className="block">{m.name}</b><span className="block text-sm text-muted-foreground">{m.tagline}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!c.faqs?.length && (
            <section className="py-8">
              <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{CONTENT_LABELS.faqs}</h2>
              <div className="mt-5 divide-y divide-border rounded-3xl border border-border bg-card">
                {c.faqs.map(([q, a]) => (
                  <div key={q} className="px-5 py-4">
                    <h3 className="font-display font-bold">{q}</h3>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">{a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="py-8">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{CONTENT_LABELS.next}</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {c.related.map(([l, h]) => (
                <li key={h}>
                  <SmartLink to={h} className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg">
                    {l}<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </SmartLink>
                </li>
              ))}
            </ul>
          </section>

          <Reveal className="mt-8 rounded-3xl border border-border bg-card p-6 sm:p-8">
            <p className="font-display text-2xl font-extrabold tracking-tight">{CONTENT_LABELS.finalText}</p>
            <Ctas />
          </Reveal>
        </div>
        <FinalCta />
      </main>
      <Footer phone={contact.phone} email={contact.email} />
      <WhatsAppButton wa={contact.wa} text={c.wa} />
    </div>
  );
}
