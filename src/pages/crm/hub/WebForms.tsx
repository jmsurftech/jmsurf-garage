import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2, Copy, FileInput, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, PageHeader, PageLoader, Panel, Pill } from "@/components/kit";
import { confirmAction } from "@/components/books/confirm";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";
import { useLookups } from "./fields";
import { LEAD_SOURCES, sb } from "./modules";

const FORM_FIELDS: [string, string, string][] = [
  ["first_name", "First name", "text"], ["last_name", "Last name", "text"], ["partner_name", "Company", "text"], ["title", "Job title", "text"],
  ["email", "Email", "email"], ["phone", "Phone", "tel"], ["mobile", "Mobile", "tel"], ["website", "Website", "url"], ["city", "City", "text"], ["country", "Country", "text"], ["description", "Message", "textarea"],
];

/** The HTML a company pastes into its website: a plain form that posts to its CRM (works without scripts too). */
function embedCode(form: any) {
  const action = `${window.location.origin}/api/public/web-lead/${form.form_key}`;
  const inputs = FORM_FIELDS.filter(([k]) => form.fields.includes(k)).map(([k, l, t]) =>
    t === "textarea" ? `  <label>${l}<br><textarea name="${k}" rows="4"></textarea></label>` : `  <label>${l}<br><input type="${t}" name="${k}"${k === "last_name" || k === "email" ? " required" : ""}></label>`).join("\n");
  return `<form class="dash-lead-form" method="post" action="${action}">
${inputs}
  <input type="text" name="website_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">Send</button>
  <p class="dash-lead-form-msg"></p>
</form>
<script>
document.querySelectorAll("form.dash-lead-form").forEach(function (f) {
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = f.querySelector(".dash-lead-form-msg"), data = {};
    new FormData(f).forEach(function (v, k) { data[k] = v; });
    fetch(f.action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok && j.redirect) { location.href = j.redirect; return; } msg.textContent = j.ok ? j.message : j.error; if (j.ok) f.reset(); })
      .catch(function () { msg.textContent = "Your message could not be sent. Please try again."; });
  });
});
</script>`;
}

/** CRM → Web forms: lead capture forms for any website. */
export default function WebForms() {
  const tenantId = useTenantId();
  const lk = useLookups();
  const [edit, setEdit] = useState<any | null>(null);
  const [code, setCode] = useState<any | null>(null);
  const { data: forms = [], isLoading, refetch } = useQuery({
    queryKey: ["crm-hub-webforms", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("crm_web_forms").select("*").eq("tenant_id", tenantId).order("created_at")).data || []) as any[],
  });
  const save = async () => {
    if (!String(edit.name || "").trim()) return toast.error("Name the form");
    if (!edit.fields?.length) return toast.error("Choose at least one field");
    const body = { name: edit.name.trim(), fields: edit.fields, lead_source: edit.lead_source || "Website", owner_ids: edit.owner_ids || [], thank_you: edit.thank_you || "Thank you. We will get back to you shortly.", redirect_url: edit.redirect_url?.trim() || null, active: edit.active !== false };
    const { error } = edit.id ? await sb.from("crm_web_forms").update(body).eq("id", edit.id) : await sb.from("crm_web_forms").insert({ ...body, tenant_id: tenantId });
    if (error) return toast.error(friendlyError(error));
    toast.success("Form saved"); setEdit(null); void refetch();
  };
  const remove = async (f: any) => {
    if (!(await confirmAction({ title: `Delete the form "${f.name}"?`, message: "Websites using it stop sending leads. Leads already received stay.", confirmLabel: "Delete", danger: true }))) return;
    await sb.from("crm_web_forms").delete().eq("id", f.id); void refetch();
  };

  return (
    <div className="crm-ui space-y-4 p-4 sm:p-6">
      <PageHeader title="Web forms" icon={FileInput} description="Put a form on any website: every message becomes a lead here, given to your people in turn."
        actions={<Button size="sm" onClick={() => setEdit({ fields: ["first_name", "last_name", "partner_name", "email", "phone", "description"], lead_source: "Website", owner_ids: [], active: true })}><Plus /> New form</Button>} />
      {isLoading ? <PageLoader /> : !forms.length ? <EmptyState icon={FileInput} title="No web forms yet" description="Create one, then paste its code into your website's contact page." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {forms.map((f) => (
            <Panel key={f.id} title={f.name} icon={FileInput} actions={<div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setCode(f)}><Code2 /> Code</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(f)}><Pencil /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(f)}><Trash2 /></Button>
            </div>}>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {f.active ? <Pill tone="success">On</Pill> : <Pill tone="muted">Off</Pill>}
                <span>{f.submissions} leads{f.last_submitted_at ? ` · last ${new Date(f.last_submitted_at).toLocaleDateString("en-KE", { dateStyle: "medium" })}` : ""}</span>
                <span className="text-muted-foreground">· source {f.lead_source}</span>
                <span className="text-muted-foreground">· {f.owner_ids?.length ? `to ${f.owner_ids.map((u: string) => lk.userName.get(u) || "?").join(", ")} in turn` : "unassigned (admins are told)"}</span>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} size="md" icon={FileInput} title={edit?.id ? "Edit web form" : "New web form"}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}><Save /> Save</Button></>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Form name" required><input className="fi" value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Website contact page" /></Field>
            <Field label="Fields on the form">
              <div className="flex flex-wrap gap-1.5">{FORM_FIELDS.map(([k, l]) => { const on = edit.fields.includes(k); return (
                <button key={k} type="button" onClick={() => setEdit({ ...edit, fields: on ? edit.fields.filter((x: string) => x !== k) : [...edit.fields, k] })} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{l}</button>); })}</div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Lead source"><select className="fi" value={edit.lead_source} onChange={(e) => setEdit({ ...edit, lead_source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Form on"><select className="fi" value={edit.active === false ? "off" : "on"} onChange={(e) => setEdit({ ...edit, active: e.target.value === "on" })}><option value="on">On</option><option value="off">Off</option></select></Field>
            </div>
            <Field label="Give leads to, in turn" hint="Nobody chosen: leads stay unassigned and admins get the bell.">
              <div className="flex flex-wrap gap-1.5">{lk.users.map((u) => { const on = (edit.owner_ids || []).includes(u.id); return (
                <button key={u.id} type="button" onClick={() => setEdit({ ...edit, owner_ids: on ? edit.owner_ids.filter((x: string) => x !== u.id) : [...(edit.owner_ids || []), u.id] })} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{u.name}</button>); })}</div>
            </Field>
            <Field label="Thank-you message"><input className="fi" value={edit.thank_you || ""} onChange={(e) => setEdit({ ...edit, thank_you: e.target.value })} placeholder="Thank you. We will get back to you shortly." /></Field>
            <Field label="Or open this page after sending" hint="Optional, e.g. https://yourcompany.com/thank-you"><input className="fi" value={edit.redirect_url || ""} onChange={(e) => setEdit({ ...edit, redirect_url: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!code} onClose={() => setCode(null)} size="lg" icon={Code2} title="Put this form on your website" description="Paste this into the page's HTML. Style it with your site's own CSS (class dash-lead-form)."
        footer={<Button onClick={() => { void navigator.clipboard?.writeText(embedCode(code)); toast.success("Code copied"); }}><Copy /> Copy code</Button>}>
        {code && <pre className="max-h-[60vh] overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed">{embedCode(code)}</pre>}
      </Modal>
    </div>
  );
}
