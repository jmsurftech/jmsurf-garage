import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { PageHeader, Panel, Pill, Segmented } from "@/components/kit";
import { WHATS_NEW, markWhatsNewSeen, lastSeenWhatsNew, type WhatsNewTag } from "@/lib/whatsNew";

const TAG: Record<WhatsNewTag, { label: string; tone: "success" | "info" | "warning" | "muted" }> = {
  new: { label: "New", tone: "success" }, improved: { label: "Improved", tone: "info" }, fixed: { label: "Fixed", tone: "muted" }, notice: { label: "Notice", tone: "warning" },
};
const month = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Body({ text }: { text: string }) {
  const lines = text.split("\n");
  const items = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const prose = lines.filter((l) => !l.startsWith("- ")).join(" ").trim();
  return (
    <div className="space-y-1.5 text-sm text-muted-foreground">
      {prose && <p>{prose}</p>}
      {items.length > 0 && <ul className="list-disc space-y-1 pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}

/** Every change to JMSURF Garage, newest first (entries in lib/whatsNew.ts). */
export default function WhatsNew() {
  const [seenBefore] = useState(lastSeenWhatsNew);
  const [tag, setTag] = useState<"all" | WhatsNewTag>("all");
  useEffect(() => { markWhatsNewSeen(); }, []);
  const groups = useMemo(() => {
    const out = new Map<string, typeof WHATS_NEW>();
    for (const e of WHATS_NEW.filter((x) => tag === "all" || x.tag === tag)) { const k = month(e.date); out.set(k, [...(out.get(k) || []), e]); }
    return [...out.entries()];
  }, [tag]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="What's new" icon={Sparkles} description="Every change to JMSURF Garage, newest first." />
      <Segmented value={tag} onChange={(v) => setTag(v as typeof tag)} options={[{ value: "all", label: "All" }, { value: "new", label: "New" }, { value: "improved", label: "Improved" }, { value: "fixed", label: "Fixed" }]} />
      {groups.map(([m, list]) => (
        <section key={m} className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{m}</h2>
          {list.map((e) => (
            <Panel key={e.slug}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={TAG[e.tag].tone}>{TAG[e.tag].label}</Pill>
                <span className="text-xs text-muted-foreground">{day(e.date)}</span>
                {(!seenBefore || e.date > seenBefore) && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Unread</span>}
              </div>
              <h3 className="mt-2 font-display text-base font-semibold">{e.title}</h3>
              <div className="mt-1.5"><Body text={e.body} /></div>
            </Panel>
          ))}
        </section>
      ))}
    </div>
  );
}
