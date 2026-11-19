import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Plus, Timer } from "lucide-react";
import { PageHeader, Panel, Toolbar, SearchBox, Segmented, Modal, Field, EmptyState } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { sb, must } from "../lib/api";
import { money } from "../components/bits";

const CATS: [string, string][] = [["torque", "Torque settings"], ["fluids", "Oils and fluids"], ["common_fault", "Common faults"], ["procedure", "How-to"], ["wiring", "Wiring"], ["other", "Other"]];

/** Technical notes the garage writes for itself (torque, fluids, common faults per model) and the labour time guide from its own jobs. */
export default function TechNotes() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const [tab, setTab] = useState<"notes" | "guide">("notes");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [gMake, setGMake] = useState("");
  const [gModel, setGModel] = useState("");
  const { data: notes = [], refetch } = useQuery({
    queryKey: ["gw-tech-notes", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_tech_notes").select("*").eq("tenant_id", tenantId).order("make").order("model").order("title")) as any[],
  });
  const { data: guide = [] } = useQuery({
    queryKey: ["gw-time-guide", tenantId, gMake, gModel, q], enabled: !!tenantId && tab === "guide",
    queryFn: async () => must(await sb.rpc("garage_time_guide", { p_make: gMake || null, p_model: gModel || null, p_q: q || null })) as any[],
  });
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return (notes as any[]).filter((n) => (!cat || n.category === cat) && (!s || `${n.make} ${n.model} ${n.engine} ${n.title} ${n.body}`.toLowerCase().includes(s))); }, [notes, q, cat]);
  const save = async () => {
    if (!edit.title) return toast({ title: "Enter a title", variant: "destructive" });
    const row = { make: edit.make || null, model: edit.model || null, engine: edit.engine || null, year_from: Number(edit.year_from) || null, year_to: Number(edit.year_to) || null, category: edit.category || "common_fault", title: edit.title, body: edit.body || null };
    const r = edit.id ? await sb.from("garage_tech_notes").update(row).eq("id", edit.id) : await sb.from("garage_tech_notes").insert({ tenant_id: tenantId, ...row });
    if (r.error) return toast({ title: "Not saved", description: r.error.message, variant: "destructive" });
    setEdit(null); void refetch();
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Technical notes" icon={BookOpenCheck} actions={tab === "notes" && <button type="button" onClick={() => setEdit({ category: "common_fault" })} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />New note</button>} />
      <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "notes", label: "Notes library" }, { value: "guide", label: "Labour time guide" }]} />
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder={tab === "notes" ? "Search make, model, fault…" : "Search the work (e.g. brake pads)"} />
        {tab === "notes" ? <select className="fi w-auto" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All kinds</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          : <><input className="fi w-36" value={gMake} onChange={(e) => setGMake(e.target.value)} placeholder="Make" /><input className="fi w-36" value={gModel} onChange={(e) => setGModel(e.target.value)} placeholder="Model" /></>}
      </Toolbar>
      {tab === "notes" ? (
        !shown.length ? <Panel><EmptyState icon={BookOpenCheck} title="No notes yet" description="Write down torque settings, oil capacities and the faults you see often, per make and model." /></Panel> : (
          <div className="grid gap-2 md:grid-cols-2">
            {shown.map((n) => (
              <button key={n.id} type="button" onClick={() => setEdit(n)} className="rounded-2xl border border-border bg-card p-3 text-left hover:border-primary/40">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">{CATS.find((c) => c[0] === n.category)?.[1]} · {[n.make, n.model, n.engine].filter(Boolean).join(" ") || "Any vehicle"}{n.year_from ? ` · ${n.year_from}–${n.year_to || ""}` : ""}</p>
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>}
              </button>
            ))}
          </div>
        )
      ) : (
        <Panel flush title="From your finished jobs" icon={Timer} description="Average clocked time and price for labour you have done, so you can quote with confidence.">
          {!(guide as any[]).length ? <p className="p-4 text-sm text-muted-foreground">No finished labour lines match yet. The guide grows as mechanics clock on and off.</p> : (
            <div className="overflow-x-auto"><table className="dt"><thead><tr><th>Work</th><th>Vehicle</th><th className="num">Jobs</th><th className="num">Average hours</th><th className="num">Average price</th></tr></thead>
              <tbody>{(guide as any[]).map((g, i) => <tr key={i}><td className="capitalize">{g.description}</td><td>{[g.make, g.model].filter(Boolean).join(" ") || "—"}</td><td className="num">{g.jobs}</td><td className="num">{g.avg_hours}</td><td className="num">{money(g.avg_price)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit note" : "New note"} icon={BookOpenCheck} footer={<>
        {edit?.id && <button type="button" onClick={async () => { await sb.from("garage_tech_notes").delete().eq("id", edit.id); setEdit(null); void refetch(); }} className="mr-auto h-9 rounded-xl px-3 text-sm text-destructive">Delete</button>}
        <button type="button" onClick={save} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Save</button></>}>
        {edit && <div className="grid grid-cols-2 gap-3">
          <Field label="Kind" className="col-span-2"><select className="fi" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Make"><input className="fi" value={edit.make || ""} onChange={(e) => setEdit({ ...edit, make: e.target.value })} placeholder="Enter make" /></Field>
          <Field label="Model"><input className="fi" value={edit.model || ""} onChange={(e) => setEdit({ ...edit, model: e.target.value })} placeholder="Enter model" /></Field>
          <Field label="Engine"><input className="fi" value={edit.engine || ""} onChange={(e) => setEdit({ ...edit, engine: e.target.value })} placeholder="Enter engine" /></Field>
          <Field label="Years"><div className="flex gap-1"><input className="fi" value={edit.year_from || ""} onChange={(e) => setEdit({ ...edit, year_from: e.target.value })} placeholder="From" /><input className="fi" value={edit.year_to || ""} onChange={(e) => setEdit({ ...edit, year_to: e.target.value })} placeholder="To" /></div></Field>
          <Field label="Title" className="col-span-2"><input className="fi" value={edit.title || ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Enter a short title" /></Field>
          <Field label="Details" className="col-span-2"><textarea className="fi" rows={6} value={edit.body || ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="Enter the values, steps or symptoms" /></Field>
        </div>}
      </Modal>
    </div>
  );
}
