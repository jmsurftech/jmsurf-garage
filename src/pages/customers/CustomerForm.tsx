import { useEffect, useState, type ReactNode } from "react";
import { erpApi } from "@/lib/erpApi";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { useTaxSettings } from "@/lib/tax";
import { useNavigate, useParams } from "react-router-dom";
import { CustomFieldInputs, missingCustomField, useCustomFields, type CustomValues } from "@/lib/customFields";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Users, CheckCircle2, CircleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useStaff } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { cn } from "@/lib/utils";

const sb: any = supabase;

function Row({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-start sm:gap-4">
      <label className={cn("pt-2 text-sm", required ? "font-medium text-destructive" : "text-foreground")}>{label}{required && "*"}</label>
      <div className="max-w-xl">{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
    </div>
  );
}

const empty = {
  customer_type: "individual", name: "", company_name: "", email: "", phone: "", alt_phone: "", kra_pin: "", tax_treatment: "", withholding_vat: false,
  credit_days: "0", credit_limit: "0", price_list_id: "", salesperson_id: "", address: "", building: "", area: "", landmark: "", notes: "", tags: "",
};

/** "New Customer". */
export default function CustomerForm() {
  const taxSet = useTaxSettings();
  const customFields = useCustomFields("customer");
  const [custom, setCustom] = useState<CustomValues>({});
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: priceLists = [] } = useQuery({ queryKey: ["price-lists"], queryFn: async () => ((await (supabase as any).from("price_lists").select("id,name").eq("is_active", true).order("name")).data || []) as any[] });
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { data: staff = [] } = useStaff();
  const [f, setF] = useState({ ...empty });
  // Clone: a new customer that starts from another one's details.
  const cloneId = id ? null : new URLSearchParams(window.location.search).get("clone");
  const loadId = id || cloneId;
  const [loading, setLoading] = useState(!!loadId);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"other" | "address" | "remarks">("other");
  const set = (p: Partial<typeof empty>) => setF((x) => ({ ...x, ...p }));
  // Connected to KRA eTIMS: a customer with a KRA PIN is sent to KRA when saved.
  const { settings: erpSet } = useErpSettings();
  const etimsOn = !!(erpSet as any)?.etims?.initialised_at;
  const [kra, setKra] = useState<{ no: string | null; error: string | null }>({ no: null, error: null });
  const pinOk = /^[AP]d{9}[A-Z]$/i.test(f.kra_pin.trim());

  useEffect(() => {
    if (!loadId) return;
    (async () => {
      const { data } = await sb.from("customers").select("*").eq("id", loadId).maybeSingle();
      setLoading(false);
      if (!data) return navigate("/customers");
      setF({
        customer_type: data.customer_type || "individual", name: cloneId ? `${data.name || ""} (Copy)` : data.name || "", company_name: data.company_name || "", email: data.email || "",
        phone: data.phone || "", alt_phone: data.alt_phone || "", kra_pin: data.kra_pin || "", tax_treatment: data.tax_treatment || "", withholding_vat: !!data.withholding_vat, credit_days: String(data.credit_days ?? 0),
        credit_limit: String(data.credit_limit ?? 0), price_list_id: data.price_list_id || "", salesperson_id: data.salesperson_id || "", address: data.address || "", building: data.building || "",
        area: data.area || "", landmark: data.landmark || "", notes: data.notes || "", tags: (data.tags || []).join(", "),
      });
      setCustom(data.custom || {});
      if (!cloneId) setKra({ no: data.etims_cust_no || null, error: data.etims_error || null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId]);

  const save = async () => {
    if (!f.name.trim()) return toast({ title: "Enter the customer's name", variant: "destructive" });
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast({ title: "Check the email address", variant: "destructive" });
    const missing = missingCustomField(customFields, custom);
    if (missing) return toast({ title: `Fill in ${missing}`, variant: "destructive" });
    setSaving(true);
    const row = {
      custom,
      customer_type: f.customer_type, name: f.name.trim(), company_name: f.company_name.trim() || null, email: f.email.trim() || null,
      phone: f.phone.trim(), alt_phone: f.alt_phone.trim() || null, kra_pin: f.kra_pin.trim().toUpperCase() || null, tax_treatment: f.tax_treatment || (/^P\d{9}[A-Z]$/i.test(f.kra_pin.trim()) ? "vat_registered" : f.kra_pin.trim() ? "vat_not_registered" : null), withholding_vat: !!f.withholding_vat,
      credit_days: Math.max(0, parseInt(f.credit_days) || 0), credit_limit: Math.max(0, Number(f.credit_limit) || 0), price_list_id: f.price_list_id || null,
      salesperson_id: f.salesperson_id || null, address: f.address.trim() || null, building: f.building.trim() || null,
      area: f.area.trim() || null, landmark: f.landmark.trim() || null, notes: f.notes.trim() || null,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const { data, error } = id
      ? await sb.from("customers").update(row).eq("id", id).select("id").single()
      : await sb.from("customers").insert({ ...row, tenant_id: tenantId, source: "manual" }).select("id").single();
    setSaving(false);
    if (error) {
      const dup = /duplicate|unique|phone/i.test(error.message);
      return toast({ title: "Customer not saved", description: dup ? "Another customer already uses this phone number." : error.message, variant: "destructive" });
    }
    qc.invalidateQueries({ queryKey: ["zcustomers"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    toast({ title: `${row.name} ${id ? "updated" : "added"}` });
    if (etimsOn && row.kra_pin && /^[AP]d{9}[A-Z]$/.test(row.kra_pin)) {
      try {
        const r: any = await erpApi("etims/register-customer", { id: data.id });
        if (r?.customer_number) toast({ title: "Registered with KRA", description: `KRA customer number ${r.customer_number}` });
      } catch (e: any) { toast({ title: "Saved, but KRA did not accept the customer", description: e.message, variant: "destructive" }); }
    }
    navigate(`/customers/${data.id}`);
  };

  if (loading) return <OrbLoader label="Loading customer…" />;
  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="flex-1 font-display text-xl font-bold">{id ? "Edit Customer" : "New Customer"}</h1>
        <Button size="icon" variant="ghost" onClick={() => navigate(id ? `/customers/${id}` : "/customers")} aria-label="Close"><X /></Button>
      </div>
      <div className="flex-1 space-y-4 bg-card px-4 py-6 sm:px-6">
        <Row label="Customer Type">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Customer type">
            {([["business", "Company"], ["individual", "Individual"]] as const).map(([t, l]) => (
              <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold ${f.customer_type === t ? "border-primary bg-primary/5" : "border-border"}`}><input type="radio" checked={f.customer_type === t} onChange={() => set({ customer_type: t })} className="accent-[hsl(var(--primary))]" />{l}</label>
            ))}
          </div>
        </Row>
        <Row label="Display Name" required><input className="fi" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!id} /></Row>
        {f.customer_type === "business" && <Row label="Company Name"><input className="fi" value={f.company_name} onChange={(e) => set({ company_name: e.target.value })} /></Row>}
        <Row label="Email Address"><input className="fi" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Row>
        <Row label="Phone" hint="Used for M-Pesa, SMS reminders and the customer portal sign-in">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="fi" inputMode="tel" placeholder="Mobile" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            <input className="fi" inputMode="tel" placeholder="Other phone" value={f.alt_phone} onChange={(e) => set({ alt_phone: e.target.value })} />
          </div>
        </Row>

        <Row label="KRA PIN" hint={!etimsOn ? undefined : kra.no ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Registered with KRA · customer no. {kra.no}</span>
          : kra.error ? <span className="inline-flex items-center gap-1 text-destructive"><CircleAlert className="h-3.5 w-3.5" /> {kra.error}</span>
          : pinOk ? "Sent to KRA when you save" : "Customers with a KRA PIN are registered with KRA"}>
          <div className="flex gap-2"><input className="fi uppercase" value={f.kra_pin} onChange={(e) => set({ kra_pin: e.target.value })} placeholder="Enter KRA PIN" />
            {etimsOn && <button type="button" disabled={!pinOk} className="shrink-0 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50" onClick={async () => {
              try {
                const t: any = await erpApi("etims/taxpayer", { pin: f.kra_pin });
                toast({ title: t?.name ? `KRA: ${t.name}` : "PIN found at KRA", description: [t?.status && `Status ${t.status}`, t?.county, t?.location].filter(Boolean).join(" · ") || undefined });
                if (t?.name && !f.name.trim()) set({ name: t.name });
              } catch (e: any) { toast({ title: "Not checked", description: e.message, variant: "destructive" }); }
            }}>Check with KRA</button>}</div>
        </Row>

        <div className="flex gap-1 border-b border-border pt-4">
          {([["other", "Other Details"], ["address", "Address"], ["remarks", "Remarks"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{l}</button>
          ))}
        </div>
        {tab === "other" && (
          <div className="space-y-4">
            <Row label="Payment Terms">
              <select className="fi" value={f.credit_days} onChange={(e) => set({ credit_days: e.target.value })}>
                {[0, 7, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? `Net ${d}` : "Due on Receipt"}</option>)}
                {![0, 7, 15, 30, 45, 60].includes(Number(f.credit_days)) && <option value={f.credit_days}>Net {f.credit_days}</option>}
              </select>
            </Row>
            <Row label="Credit Limit" hint="How much this customer may owe at the till. 0 means no credit."><input className="fi" type="number" min={0} value={f.credit_limit} onChange={(e) => set({ credit_limit: e.target.value })} /></Row>
            <Row label="Price List" hint="Their quotes and invoices use these rates."><select className="fi" value={f.price_list_id} onChange={(e) => set({ price_list_id: e.target.value })}><option value="">Standard prices</option>{priceLists.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Row>
            <Row label="Sales Rep">
              <select className="fi" value={f.salesperson_id} onChange={(e) => set({ salesperson_id: e.target.value })}>
                <option value="">None</option>
                {(staff as any[]).map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}
              </select>
            </Row>
            <Row label="VAT treatment"><select className="fi" value={f.tax_treatment} onChange={(e) => set({ tax_treatment: e.target.value })}>
              <option value="">Work it out from the PIN</option>
              <option value="vat_registered">VAT registered (PIN on the KRA receipt)</option>
              <option value="vat_not_registered">Not VAT registered</option>
              <option value="non_kenya">Outside Kenya (export)</option>
            </select></Row>
            {taxSet.withholding.enabled && taxSet.withholding.appliesTo !== "vendors" && (
              <Row label="Withholding VAT"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.withholding_vat} onChange={(e) => set({ withholding_vat: e.target.checked } as any)} /> This customer withholds VAT ({taxSet.withholding.rate}%)</label></Row>
            )}
            <Row label="Tags" hint="Comma separated, e.g. VIP, wholesale, government"><input className="fi" value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Row>
          </div>
        )}
        {tab === "address" && (
          <div className="space-y-4">
            <Row label="Building / House"><input className="fi" value={f.building} onChange={(e) => set({ building: e.target.value })} /></Row>
            <Row label="Street / Road"><input className="fi" value={f.address} onChange={(e) => set({ address: e.target.value })} /></Row>
            <Row label="Area / Estate"><input className="fi" value={f.area} onChange={(e) => set({ area: e.target.value })} /></Row>
            <Row label="Landmark"><input className="fi" value={f.landmark} onChange={(e) => set({ landmark: e.target.value })} /></Row>
          </div>
        )}
        <CustomFieldInputs entity="customer" values={custom} onChange={setCustom} className="mb-4 mt-4 grid gap-3 sm:grid-cols-2" />
        {tab === "remarks" && <Row label="Remarks"><textarea className="fi min-h-[120px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="For internal use" /></Row>}
      </div>
      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Button onClick={save} disabled={saving}>{saving && <OrbSpinner state="working" />} Save</Button>
        <Button variant="outline" onClick={() => navigate(id ? `/customers/${id}` : "/customers")} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
