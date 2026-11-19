import { useMemo, useState } from "react";
import { LifeBuoy, ChevronDown, MessageCircle, Mail, Activity, ArrowRight, Phone, PhoneCall } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useModules } from "@/hooks/useModules";
import { useAuth } from "@/hooks/useAuth";
import { callNumber } from "@/components/PhoneDock";
import { toast } from "sonner";
import { Rocket, LayoutDashboard, Receipt, ShoppingCart, Truck, Package, Building2, Landmark, Handshake, UserRoundCog, FolderKanban, Headset, Bell, Sparkles, Globe, DatabaseBackup, Settings, CreditCard, ShieldCheck, Smartphone } from "lucide-react";
const Icons = { Rocket, LayoutDashboard, Receipt, ShoppingCart, Truck, Package, Building2, Landmark, Handshake, UserRoundCog, FolderKanban, Headset, Bell, Sparkles, Globe, DatabaseBackup, Settings, CreditCard, ShieldCheck, Smartphone };
import { Link } from "react-router-dom";
import { HELP_TOPICS, type HelpArticle } from "@/lib/helpContent";
import { PUBLIC_MODULES as MODULES } from "@/lib/modules";
import { PageHeader, SearchBox, Panel, EmptyState } from "@/components/kit";
import PageHead from "@/components/PageHead";
import { useTenant } from "@/hooks/useTenant";
import { useSupportContact, supportWhatsAppUrl } from "@/lib/support";
import { cn } from "@/lib/utils";
import { MyTickets } from "@/components/SupportTickets";

type Article = HelpArticle;
type Topic = { id: string; title: string; icon: any; articles: Article[] };

/** Every topic, plus one article per app of every suite (so nothing is missing). */
const TOPICS: Topic[] = [
  ...HELP_TOPICS.map((t) => ({ ...t, icon: (Icons as any)[t.icon] || LifeBuoy })),
  ...MODULES.map((m) => ({
    id: `suite-${m.key}`, title: m.name.replace(/^JMSURF /, ""), icon: m.icon,
    articles: [
      { q: `What is in ${m.name}?`, a: [m.description, ...(m.features?.length ? [m.features.join(" · ")] : [])], to: m.home || `/modules?app=${m.key}` },
      ...m.apps.map((x) => ({ q: x.name, a: [x.desc], to: x.home || `/modules?app=${m.key}` })),
    ],
  })),
];

/** Call JMSURF support (from the company's own call centre phone when it has one) or ask for a call back. */
function SupportCall({ phone }: { phone: string }) {
  const { has } = useModules();
  const { profile } = useAuth() as any;
  const { data: line } = useQuery({ queryKey: ["support-line"], staleTime: 600_000, queryFn: async () => ((await (supabase as any).rpc("support_line")).data as string | null) || null });
  const number = line || phone;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ phone: "", note: "" });
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("request_support_callback", { p_phone: f.phone || profile?.phone || "", p_note: f.note });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("We will call you back shortly"); setOpen(false); setF({ phone: "", note: "" });
  };
  return (
    <>
      {number && (has("callcentre")
        ? <button onClick={() => callNumber(number)} className="flex w-full items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Phone className="h-4 w-4" /> Call JMSURF support</button>
        : <a href={`tel:${number}`} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Phone className="h-4 w-4" /> Call support · {number}</a>)}
      {!open ? <button onClick={() => { setF({ phone: profile?.phone || "", note: "" }); setOpen(true); }} className="flex w-full items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted"><PhoneCall className="h-4 w-4" /> Request a call back</button> : (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <input className="fi" inputMode="tel" placeholder="Number to call" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <textarea className="fi" rows={2} placeholder="What do you need help with?" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <div className="flex gap-2"><button onClick={() => void ask()} disabled={busy} className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Sending…" : "Call me back"}</button><button onClick={() => setOpen(false)} className="rounded-lg px-3 text-sm hover:bg-muted">Cancel</button></div>
        </div>
      )}
    </>
  );
}

export default function Help() {
  const { tenant } = useTenant() as any;
  const support = useSupportContact();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOPICS;
    const words = q.split(/\s+/);
    return TOPICS.map((t) => ({
      ...t,
      articles: t.articles.filter((a) => {
        const hay = `${t.title} ${a.q} ${a.a.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    })).filter((t) => t.articles.length > 0);
  }, [query]);

  return (
    <div className="space-y-6">
      <PageHead title="Help centre" description="Answers to common questions." noindex />
      <PageHeader title="Help centre" icon={LifeBuoy} description="How every part of JMSURF Garage works, with a link to each screen. And a real person when you need one." />

      <SearchBox value={query} onChange={setQuery} placeholder="Search help, e.g. eTIMS, batches, payroll, backup…" />
      {!query.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.slice(0, HELP_TOPICS.length).map((t) => (
            <a key={t.id} href={`#help-${t.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary/40 hover:text-primary"><t.icon className="h-3.5 w-3.5" />{t.title}</a>
          ))}
          <a href="#help-suites" className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">Every app</a>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="space-y-5">
          {results.length === 0 && (
            <EmptyState icon={LifeBuoy} title="No answers found" description="Try other words, or ask our support team on WhatsApp." />
          )}
          {results.map((t) => (
            <div key={t.id} id={t.id.startsWith("suite-") && t.id === `suite-${MODULES[0]?.key}` ? "help-suites" : `help-${t.id}`} className="scroll-mt-4">
            {t.id === `suite-${MODULES[0]?.key}` && !query.trim() && <h2 className="mb-3 mt-8 font-display text-xl font-bold">Every app, suite by suite</h2>}
            <Panel title={<span className="flex items-center gap-2"><t.icon className="h-4 w-4 text-primary" /> {t.title}</span>} flush>
              <ul className="divide-y divide-border">
                {t.articles.map((a) => {
                  const id = `${t.id}:${a.q}`;
                  const isOpen = open === id || !!query.trim();
                  return (
                    <li key={id}>
                      <button onClick={() => setOpen(open === id ? null : id)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium hover:bg-muted/50" aria-expanded={isOpen}>
                        {a.q}
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                      </button>
                      {isOpen && (
                        <div className="space-y-2 px-5 pb-4 text-sm text-muted-foreground">
                          {a.a.map((p, i) => <p key={i}>{p}</p>)}
                          {a.to && <Link to={a.to} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></Link>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
            </div>
          ))}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <Panel title="Talk to us">
            <div className="space-y-2">
              {support.whatsappEnabled && (
                <a href={supportWhatsAppUrl(support.whatsapp, tenant?.name)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
                  <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
                </a>
              )}
              {support.email && (
                <a href={`mailto:${support.email}`} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
                  <Mail className="h-4 w-4" /> {support.email}
                </a>
              )}
              <MyTickets tenantId={tenant?.id} />
              <SupportCall phone={support.phone} />
              <a href="/status" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
                <Activity className="h-4 w-4" /> System status
              </a>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
