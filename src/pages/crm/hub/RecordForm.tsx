import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/kit";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { confirmAction } from "@/components/books/confirm";
import { cn } from "@/lib/utils";
import { cleanForSave, FieldInput, useCrmRefresh, useLookups } from "./fields";
import { ownerKey, sb, STAGES, type ModuleDef } from "./modules";

/** Create or edit one record, in the module's own sections. */
export default function RecordForm({ m, open, onClose, record, preset, onSaved }: {
  m: ModuleDef; open: boolean; onClose: () => void; record?: any; preset?: Record<string, any>; onSaved?: (row: any) => void;
}) {
  const tenantId = useTenantId();
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const start: Record<string, any> = record ? { ...record } : { [ownerKey(m)]: user?.id || null, ...(m.key === "deals" ? { stage: "qualification" } : {}), ...(m.key === "leads" ? { lead_status: "New" } : {}), ...(preset || {}) };
    setDraft(start);
  }, [open, record?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => [...new Set(m.fields.filter((f) => !f.readOnly).map((f) => f.section))], [m]);
  const set = (k: string, v: any) => setDraft((d) => {
    const n = { ...d, [k]: v };
    // A new stage brings its usual probability.
    if (m.key === "deals" && k === "stage") n.probability = STAGES.find((s) => s.key === v)?.p ?? n.probability;
    // Picking a contact on a deal fills its account when empty.
    if (m.key === "deals" && k === "contact_id" && v && !n.customer_id) n.customer_id = (lk.contacts.find((c: any) => c.id === v) as any)?.account_id || null;
    return n;
  });

  const save = async () => {
    const missing = m.fields.find((f) => f.required && !String(draft[f.key] ?? "").trim());
    if (missing) return toast.error(`${missing.label} is required`);
    // A new lead, contact or account with the email or phone of one already here: say so first.
    if (!record?.id && m.key !== "deals") {
      const email = String(draft.email || "").trim(), phone = String(draft.phone || draft.mobile || "").replace(/\s+/g, "");
      const ors = [email && `email.ilike.${email.replace(/[,()*]/g, "")}`, phone.length >= 7 && `phone.ilike.*${phone.slice(-9).replace(/[,()*]/g, "")}`].filter(Boolean).join(",");
      if (ors) {
        let q = sb.from(m.table).select("*").eq("tenant_id", tenantId).or(ors).limit(1);
        if (m.scope) q = m.scope(q);
        const { data: same } = await q;
        if (same?.[0] && !(await confirmAction({ title: `This ${m.singular.toLowerCase()} may already be here`, message: `${m.title(same[0])} has the same ${email && String(same[0].email || "").toLowerCase() === email.toLowerCase() ? "email" : "phone number"}. Add it anyway?`, confirmLabel: "Add anyway" }))) return;
      }
    }
    setBusy(true);
    try {
      const body = cleanForSave(m, draft, lk);
      const q = record?.id
        ? sb.from(m.table).update({ ...body, updated_at: new Date().toISOString() }).eq("id", record.id)
        : sb.from(m.table).insert({ ...body, tenant_id: tenantId });
      const { data, error } = await q.select("*").single();
      if (error) throw error;
      toast.success(record?.id ? `${m.singular} saved` : `${m.singular} created`);
      refresh();
      onSaved?.(data);
      onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={m.icon} title={record?.id ? `Edit ${m.singular.toLowerCase()}` : `New ${m.singular.toLowerCase()}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}><Save /> {busy ? "Saving…" : "Save"}</Button></>}>
      <div className="space-y-6">
        {sections.map((s) => (
          <section key={s} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{s}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {m.fields.filter((f) => f.section === s && !f.readOnly).map((f) => (
                <Field key={f.key} label={f.label} required={f.required} className={cn(f.full && "sm:col-span-2")}>
                  <FieldInput f={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} lk={lk} row={draft} />
                </Field>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
