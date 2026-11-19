import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Save, Eye, Code, Plus, Trash2, FileText, ExternalLink } from "lucide-react";
import { PageHeader, Panel, Segmented } from "@/components/kit";

const SECTION_INFO: Record<string, { title: string; where: string }> = {
  hero: { title: "Hero", where: "Top of the home page. The subtitle and button text and link are shown." },
  features: { title: "Features", where: "The Features grid. Each item is a card, in this order." },
  cta: { title: "Call to action", where: "The orange banner above the contact form. The title and button link are shown." },
  contact: { title: "Contact details", where: "Top bar, contact section and footer. Phone, email and address." },
  whatsapp: { title: "WhatsApp button", where: "The floating green button and the WhatsApp contact card." },
  footer: { title: "Footer", where: "Bottom of every public page. Tagline and company name." },
};

type ViewMode = "visual" | "json";

export default function AdminCMS() {
  const [sections, setSections] = useState<any[]>([]);
  const [editing, setEditing] = useState<Record<string, any>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [jsonEditing, setJsonEditing] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("cms_content").select("*").order("section").then(({ data }) => {
      if (data) {
        setSections(data as any[]);
        const map: Record<string, any> = {};
        const jsonMap: Record<string, string> = {};
        (data as any[]).forEach(s => {
          map[s.section] = typeof s.content === "string" ? JSON.parse(s.content) : s.content;
          jsonMap[s.section] = JSON.stringify(s.content, null, 2);
        });
        setEditing(map);
        setJsonEditing(jsonMap);
      }
    });
  }, []);

  const save = async (section: string) => {
    try {
      let content: any;
      if (viewMode === "json") {
        content = JSON.parse(jsonEditing[section]);
      } else {
        content = editing[section];
      }
      const { error } = await supabase.from("cms_content").update({ content, updated_at: new Date().toISOString() } as any).eq("section", section);
      if (error) throw error;
      toast({ title: "Saved", description: `${section} section updated` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Invalid data", variant: "destructive" });
    }
  };

  const updateField = (section: string, key: string, value: any) => {
    setEditing(prev => {
      const updated = { ...prev };
      const obj = { ...(updated[section] || {}) };
      obj[key] = value;
      updated[section] = obj;
      return updated;
    });
  };

  const inputClass = "fi";
  // Keep the JSON text in step with visual edits when switching views.
  const switchMode = (mode: ViewMode) => {
    if (mode === "json") {
      const next: Record<string, string> = {};
      Object.entries(editing).forEach(([k, v]) => { next[k] = JSON.stringify(v, null, 2); });
      setJsonEditing(next);
    } else {
      try {
        const next: Record<string, any> = { ...editing };
        Object.entries(jsonEditing).forEach(([k, v]) => { next[k] = JSON.parse(v); });
        setEditing(next);
      } catch {
        toast({ title: "Fix the JSON first", description: "One section has invalid JSON.", variant: "destructive" });
        return;
      }
    }
    setViewMode(mode);
  };

  const renderVisualEditor = (section: string) => {
    const data = editing[section] || {};

    switch (section) {
      case "hero":
        return (
          <div className="space-y-3">
            <div><label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={data.title || ""} onChange={e => updateField(section, "title", e.target.value)} className={inputClass} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Subtitle</label>
              <textarea value={data.subtitle || ""} onChange={e => updateField(section, "subtitle", e.target.value)} className={inputClass + " h-20 resize-y"} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">CTA Text</label>
                <input value={data.cta_text || ""} onChange={e => updateField(section, "cta_text", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">CTA Link</label>
                <input value={data.cta_link || ""} onChange={e => updateField(section, "cta_link", e.target.value)} className={inputClass} /></div>
            </div>
          </div>
        );

      case "about":
        return (
          <div className="space-y-3">
            <div><label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={data.title || ""} onChange={e => updateField(section, "title", e.target.value)} className={inputClass} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea value={data.description || ""} onChange={e => updateField(section, "description", e.target.value)} className={inputClass + " h-24 resize-y"} /></div>
            <div>
              <label className="mb-2 block text-sm font-medium">Stats</label>
              <div className="grid grid-cols-2 gap-2">
                {(data.stats || []).map((stat: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <input value={stat.value} placeholder="Value" onChange={e => {
                      const stats = [...(data.stats || [])];
                      stats[i] = { ...stats[i], value: e.target.value };
                      updateField(section, "stats", stats);
                    }} className={inputClass + " w-1/3"} />
                    <input value={stat.label} placeholder="Label" onChange={e => {
                      const stats = [...(data.stats || [])];
                      stats[i] = { ...stats[i], label: e.target.value };
                      updateField(section, "stats", stats);
                    }} className={inputClass + " w-2/3"} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "features":
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Feature Items ({(data.items || []).length})</label>
              <Button size="sm" variant="ghost" className="h-7 text-primary" onClick={() => {
                const items = [...(data.items || []), { title: "", desc: "" }];
                updateField(section, "items", items);
              }}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {(data.items || []).map((item: any, i: number) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input value={item.title} placeholder="Title" onChange={e => {
                      const items = [...(data.items || [])];
                      items[i] = { ...items[i], title: e.target.value };
                      updateField(section, "items", items);
                    }} className={inputClass} />
                    <input value={item.desc} placeholder="Description" onChange={e => {
                      const items = [...(data.items || [])];
                      items[i] = { ...items[i], desc: e.target.value };
                      updateField(section, "items", items);
                    }} className={inputClass} />
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive" onClick={() => {
                    const items = (data.items || []).filter((_: any, j: number) => j !== i);
                    updateField(section, "items", items);
                  }}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        );

      case "cta":
        return (
          <div className="space-y-3">
            <div><label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={data.title || ""} onChange={e => updateField(section, "title", e.target.value)} className={inputClass} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Subtitle</label>
              <input value={data.subtitle || ""} onChange={e => updateField(section, "subtitle", e.target.value)} className={inputClass} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">CTA Text</label>
                <input value={data.cta_text || ""} onChange={e => updateField(section, "cta_text", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">CTA Link</label>
                <input value={data.cta_link || ""} onChange={e => updateField(section, "cta_link", e.target.value)} className={inputClass} /></div>
            </div>
          </div>
        );

      case "contact":
        return (
          <div className="space-y-3">
            <div><label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={data.title || ""} onChange={e => updateField(section, "title", e.target.value)} className={inputClass} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Email</label>
                <input value={data.email || ""} onChange={e => updateField(section, "email", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Phone</label>
                <input value={data.phone || ""} onChange={e => updateField(section, "phone", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Address</label>
                <input value={data.address || ""} onChange={e => updateField(section, "address", e.target.value)} className={inputClass} /></div>
            </div>
          </div>
        );

      case "whatsapp":
        return (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data.enabled !== false}
                onChange={e => updateField(section, "enabled", e.target.checked)}
              />
              Show floating WhatsApp button
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">WhatsApp Number (international, e.g. 254712504593)</label>
                <input value={data.number || ""} onChange={e => updateField(section, "number", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Button Label (accessibility)</label>
                <input value={data.label || ""} onChange={e => updateField(section, "label", e.target.value)} className={inputClass} /></div>
            </div>
            <div><label className="mb-1.5 block text-sm font-medium">Prefilled Message Template</label>
              <textarea value={data.message || ""} onChange={e => updateField(section, "message", e.target.value)} className={inputClass + " h-24 resize-y"} /></div>
          </div>
        );

      case "footer":

        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Company Name</label>
                <input value={data.company_name || ""} onChange={e => updateField(section, "company_name", e.target.value)} className={inputClass} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Tagline</label>
                <input value={data.tagline || ""} onChange={e => updateField(section, "tagline", e.target.value)} className={inputClass} /></div>
            </div>
          </div>
        );

      default:
        return (
          <textarea
            value={jsonEditing[section] || ""}
            onChange={e => setJsonEditing({ ...jsonEditing, [section]: e.target.value })}
            className="fi h-56 font-mono text-xs"
          />
        );
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="Website content" description="Edit the public home page. Saved changes show straight away." icon={FileText}
        actions={<>
          <a href="https://garage.jmsurf.co.ke" target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><ExternalLink /> View site</Button></a>
          <Segmented value={viewMode} onChange={(v) => switchMode(v as ViewMode)} options={[
            { value: "visual", label: <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />Form</span> },
            { value: "json", label: <span className="inline-flex items-center gap-1.5"><Code className="h-3.5 w-3.5" />JSON</span> },
          ]} />
        </>} />

      <div className="grid gap-5 xl:grid-cols-2">
        {sections
          .filter((s) => SECTION_INFO[s.section])
          .sort((a, b) => Object.keys(SECTION_INFO).indexOf(a.section) - Object.keys(SECTION_INFO).indexOf(b.section))
          .map((s) => (
          <Panel key={s.id} title={SECTION_INFO[s.section]?.title || s.section} description={SECTION_INFO[s.section]?.where}
            actions={<Button size="sm" onClick={() => save(s.section)}><Save /> Save</Button>}>
            {viewMode === "visual" ? renderVisualEditor(s.section) : (
              <textarea value={jsonEditing[s.section] || ""} onChange={(e) => setJsonEditing({ ...jsonEditing, [s.section]: e.target.value })} className="fi h-56 font-mono text-xs" />
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
