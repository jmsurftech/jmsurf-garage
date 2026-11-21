import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Copy, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/kit";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrbSpinner } from "@/components/orbs";
import { DocPaper } from "@/components/print/doc-paper";
import { useBusinessSettings } from "@/hooks/useData";
import { companyThemeHex } from "@/lib/companyTheme";
import { confirmAction } from "@/components/books/confirm";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { FileText } from "lucide-react";
import type { DocModel } from "@/lib/doc-pdf";
import {
  BRAND_ORANGE, BRAND_TEAL, COMPANY_FIELDS, DEFAULT_DOC_SETTINGS, DOC_KINDS, DOC_TEMPLATES, PARTY_FIELDS, resolveDocSettings, withCompanyColor,
  type FieldToggle,
  type DocKindKey, type DocSettings, type DocTemplateId,
} from "@/lib/doc-settings";
import { cn } from "@/lib/utils";
import { useModules } from "@/hooks/useModules";
import { Link, useSearchParams } from "react-router-dom";
import { BusinessTab } from "@/pages/Settings";
import { Segmented } from "@/components/kit";


type Row = { kind: DocKindKey; template: string; settings: unknown };

const COLOR_PRESETS: { name: string; accent: string; tableHeader: string; balanceBg: string }[] = [
  { name: "Charcoal (default)", accent: BRAND_TEAL, tableHeader: "#3C3D3A", balanceBg: "#F5F4F3" },
  { name: "Black", accent: BRAND_TEAL, tableHeader: BRAND_TEAL, balanceBg: "#F2F3F5" },
  { name: "Crimson", accent: BRAND_ORANGE, tableHeader: BRAND_ORANGE, balanceBg: "#FBEDE6" },
  { name: "JMSURF Red", accent: "#A8121B", tableHeader: "#A8121B", balanceBg: "#FBEDE6" },
  { name: "Ocean", accent: "#1F6FB2", tableHeader: "#1F6FB2", balanceBg: "#EAF2FB" },
  { name: "Forest", accent: "#2E7D4F", tableHeader: "#2E7D4F", balanceBg: "#EAF5EE" },
  { name: "Royal", accent: "#4338CA", tableHeader: "#4338CA", balanceBg: "#EEF0FD" },
  { name: "Amber", accent: "#B45309", tableHeader: "#B45309", balanceBg: "#FDF4E7" },
  { name: "Teal", accent: "#0F766E", tableHeader: "#0F766E", balanceBg: "#E8F6F5" },
  { name: "Plum", accent: "#7E22CE", tableHeader: "#7E22CE", balanceBg: "#F5EDFC" },
];

function DocumentTemplates() {
  const qc = useQueryClient();
  const { role } = useAuth() as any;
  const tenantId = useTenantId();
  const isAdmin = role === "admin" || role === "manager" || role === "super_admin";
  const [kind, setKind] = useState<DocKindKey>("quote");
  const [draft, setDraft] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: bizSettings } = useBusinessSettings();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["document-templates", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("document_templates" as never) as any).select("kind, template, settings").eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const saved = useMemo(() => {
    const r = rows?.find((x) => x.kind === kind);
    return withCompanyColor(resolveDocSettings(r?.settings, r?.template), companyThemeHex(bizSettings?.theme));
  }, [rows, kind, bizSettings?.theme]);

  useEffect(() => { setDraft(saved); setDirty(false); }, [saved]);

  const kindMeta = DOC_KINDS.find((d) => d.key === kind)!;
  const set = <S extends keyof DocSettings>(section: S, patch: Partial<DocSettings[S]> | DocSettings[S]) => {
    setDirty(true);
    setDraft((d) => (typeof d[section] === "object" ? { ...d, [section]: { ...(d[section] as object), ...(patch as object) } } : { ...d, [section]: patch }));
  };

  const pick = async (next: DocKindKey) => {
    if (next === kind) return;
    if (dirty && !(await confirmAction({ title: "Discard unsaved changes?", message: `Your changes to ${kindMeta.label} have not been saved.`, confirmLabel: "Discard" }))) return;
    setKind(next);
  };

  const persist = async (kinds: DocKindKey[]) => {
    setSaving(true);
    try {
      const payload = kinds.map((k) => ({ tenant_id: tenantId, kind: k, template: draft.template, settings: draft, updated_at: new Date().toISOString() }));
      const { error } = await (supabase.from("document_templates" as never) as any).upsert(payload, { onConflict: "tenant_id,kind" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["document-templates"] });
      await qc.invalidateQueries({ queryKey: ["doc-model"] });
      await qc.invalidateQueries({ queryKey: ["doc-settings"] });
      setDirty(false);
      toast.success(kinds.length > 1 ? "Applied to all documents" : `${kindMeta.label} settings saved`);
    } catch (e) {
      toast.error((e as Error).message || "Could not save the document settings");
    } finally { setSaving(false); }
  };

  const applyAll = async () => {
    if (await confirmAction({ title: "Apply to every document type?", message: "Quotations, invoices, receipts, payment receipts, credit notes, delivery notes, purchase orders, bills, requisitions and statements will all use this template and these settings.", confirmLabel: "Apply to all" })) {
      await persist(DOC_KINDS.map((d) => d.key));
    }
  };

  const sample = useMemo(() => sampleModel(kindMeta.title, kind, draft), [kindMeta.title, kind, draft]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document Settings"
        icon={FileText}
        description="Templates, colours and sections for every printed and emailed document (classic accounting style)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setDraft({ ...DEFAULT_DOC_SETTINGS }); setDirty(true); }} disabled={!isAdmin}>
              <RotateCcw className="h-4 w-4" /> Reset to default
            </Button>
            <Button variant="outline" onClick={applyAll} disabled={!isAdmin || saving}><Copy className="h-4 w-4" /> Apply to all documents</Button>
            <Button onClick={() => persist([kind])} disabled={!isAdmin || saving || !dirty}>
              {saving ? <OrbSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        }
      />
      {!isAdmin && <Card className="border-amber-300 bg-amber-50/70 p-3 text-sm dark:bg-amber-500/10">Only the owner or a manager can change document settings. You can preview them here.</Card>}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* document types */}
        <Card className="h-fit min-w-0 p-2 2xl:col-span-2">

          <nav className="flex gap-1 overflow-x-auto scrollbar-none" aria-label="Document types">
            {DOC_KINDS.map((d) => (
              <button key={d.key} type="button" onClick={() => void pick(d.key)}
                className={cn("shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  kind === d.key ? "bg-primary/10 font-semibold text-primary" : "text-foreground/80 hover:bg-accent")}>
                {d.label}
              </button>
            ))}
          </nav>
        </Card>

        {/* options */}
        <Card className="min-w-0 p-4">
          {isLoading ? <div className="flex h-40 items-center justify-center"><OrbSpinner className="h-5 w-5" /></div> : (
            <fieldset disabled={!isAdmin} className="min-w-0 space-y-5">
              <div>
                <Label className="mb-2 block">Template</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-2">
                  {DOC_TEMPLATES.map((t) => (
                    <button key={t.id} type="button" onClick={() => set("template", t.id as DocTemplateId)} title={t.description}
                      className={cn("relative min-w-0 rounded-lg border p-2 text-left transition-colors hover:border-primary/60",
                        draft.template === t.id ? "border-primary ring-2 ring-primary/30" : "border-border")}>
                      <TemplateThumb id={t.id} color={draft.colors.tableHeader} accent={draft.colors.accent} />
                      <span className="mt-1.5 block text-xs font-semibold">{t.name}</span>
                      {draft.template === t.id && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              <Tabs defaultValue="general">
                <TabsList className="h-auto w-full flex-wrap justify-start">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="header">Header</TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="total">Total</TabsTrigger>
                  <TabsTrigger value="other">Other</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 pt-4">
                  <Row label="Paper size">
                    <Select value={draft.paper} onValueChange={(v) => set("paper", v as DocSettings["paper"])}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="Letter">Letter</SelectItem></SelectContent>
                    </Select>
                  </Row>
                  <Row label="Font size">
                    <Select value={draft.fontSize} onValueChange={(v) => set("fontSize", v as DocSettings["fontSize"])}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="small">Small</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="large">Large</SelectItem></SelectContent>
                    </Select>
                  </Row>
                  <div>
                    <Label className="mb-2 block">Colour theme</Label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PRESETS.map((p) => (
                        <button key={p.name} type="button" title={p.name}
                          onClick={() => set("colors", { accent: p.accent, tableHeader: p.tableHeader, balanceBg: p.balanceBg, tableHeaderText: "#FFFFFF" })}
                          className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                            draft.colors.tableHeader.toLowerCase() === p.tableHeader.toLowerCase() && draft.colors.accent.toLowerCase() === p.accent.toLowerCase() ? "border-primary bg-primary/5" : "border-border")}>
                          <span className="h-3.5 w-3.5 rounded-full" style={{ background: p.tableHeader }} />
                          <span className="h-3.5 w-3.5 rounded-full" style={{ background: p.accent }} />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ColorRow label="Title & labels" value={draft.colors.accent} onChange={(v) => set("colors", { accent: v })} />
                  <ColorRow label="Table header" value={draft.colors.tableHeader} onChange={(v) => set("colors", [BRAND_TEAL.toLowerCase(), draft.colors.tableHeader.toLowerCase()].includes(draft.colors.accent.toLowerCase()) ? { tableHeader: v, accent: v } : { tableHeader: v })} />
                  <ColorRow label="Table header text" value={draft.colors.tableHeaderText} onChange={(v) => set("colors", { tableHeaderText: v })} />
                  <ColorRow label="Body text" value={draft.colors.text} onChange={(v) => set("colors", { text: v })} />
                  <ColorRow label="Secondary text" value={draft.colors.label} onChange={(v) => set("colors", { label: v })} />
                  <ColorRow label="Balance Due background" value={draft.colors.balanceBg} onChange={(v) => set("colors", { balanceBg: v })} />
                </TabsContent>

                <TabsContent value="header" className="space-y-3 pt-4">
                  <Toggle label="Show organization logo" checked={draft.header.showLogo} onChange={(v) => set("header", { showLogo: v })} />
                  <Row label="Logo size">
                    <Select value={draft.header.logoSize} onValueChange={(v) => set("header", { logoSize: v as DocSettings["header"]["logoSize"] })}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="small">Small</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="large">Large</SelectItem></SelectContent>
                    </Select>
                  </Row>
                  <Toggle label="Show organization name" checked={draft.header.showCompanyName} onChange={(v) => set("header", { showCompanyName: v })} />
                  <Toggle label="Show organization details" checked={draft.header.showCompanyAddress} onChange={(v) => set("header", { showCompanyAddress: v })} />
                  {draft.header.showCompanyAddress && (
                    <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Which company details print, their wording and their order are set once for every document in <Link className="font-medium text-primary underline" to="/settings?tab=business">System → Business settings → Contact details for documents</Link>.</p>
                  )}
                  <Toggle label="Show status ribbon (Paid, Draft, Overdue…)" checked={draft.header.showStatusRibbon} onChange={(v) => set("header", { showStatusRibbon: v })} />
                </TabsContent>

                <TabsContent value="details" className="space-y-3 pt-4">
                  <TextRow label="Document title" placeholder={`Automatic (${kindMeta.title.toUpperCase()})`} value={draft.details.title} onChange={(v) => set("details", { title: v })} />
                  <TextRow label="Customer label" value={draft.details.billToLabel} onChange={(v) => set("details", { billToLabel: v })} />
                  <FieldOrder title="Customer / vendor details — each on its own line, in this order" fields={draft.details.customerFields} defs={PARTY_FIELDS} onChange={(v) => set("details", { customerFields: v })} />
                  <Toggle label="Show payment terms" checked={draft.details.showPaymentTerms} onChange={(v) => set("details", { showPaymentTerms: v })} />
                  <Toggle label="Show due / expiry date" checked={draft.details.showDueDate} onChange={(v) => set("details", { showDueDate: v })} />
                  <Toggle label="Show reference number" checked={draft.details.showReference} onChange={(v) => set("details", { showReference: v })} />
                  <Toggle label="Show project" checked={draft.details.showProject} onChange={(v) => set("details", { showProject: v })} />
                </TabsContent>

                <TabsContent value="table" className="space-y-3 pt-4">
                  <Toggle label="Line item number" checked={draft.table.showLineNumber} onChange={(v) => set("table", { showLineNumber: v })} />
                  <Toggle label="Item description under the item name" checked={draft.table.showDescription} onChange={(v) => set("table", { showDescription: v })} />
                  <Toggle label="Quantity column" checked={draft.table.showQuantity} onChange={(v) => set("table", { showQuantity: v })} />
                  <Toggle label="Rate column" checked={draft.table.showRate} onChange={(v) => set("table", { showRate: v })} />
                  <Toggle label="VAT column" checked={draft.table.showTax} onChange={(v) => set("table", { showTax: v })} />
                  <Toggle label="Striped rows" checked={draft.table.stripedRows} onChange={(v) => set("table", { stripedRows: v })} />
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <TextRow stacked label="Item label" value={draft.table.itemLabel} onChange={(v) => set("table", { itemLabel: v })} />
                    <TextRow stacked label="Quantity label" value={draft.table.qtyLabel} onChange={(v) => set("table", { qtyLabel: v })} />
                    <TextRow stacked label="Rate label" value={draft.table.rateLabel} onChange={(v) => set("table", { rateLabel: v })} />
                    <TextRow stacked label="VAT label" value={draft.table.taxLabel} onChange={(v) => set("table", { taxLabel: v })} />
                    <TextRow stacked label="Amount label" value={draft.table.amountLabel} onChange={(v) => set("table", { amountLabel: v })} />
                  </div>
                </TabsContent>

                <TabsContent value="total" className="space-y-3 pt-4">
                  <Toggle label="Sub total" checked={draft.totals.showSubTotal} onChange={(v) => set("totals", { showSubTotal: v })} />
                  <Toggle label="VAT broken down by rate" checked={draft.totals.showTaxDetails} onChange={(v) => set("totals", { showTaxDetails: v })} />
                  <Toggle label="Payment made" checked={draft.totals.showPaymentMade} onChange={(v) => set("totals", { showPaymentMade: v })} />
                  <Toggle label="Balance due" checked={draft.totals.showBalanceDue} onChange={(v) => set("totals", { showBalanceDue: v })} />
                  <Toggle label="Amount in words" checked={draft.totals.showAmountInWords} onChange={(v) => set("totals", { showAmountInWords: v })} />
                </TabsContent>

                <TabsContent value="other" className="space-y-3 pt-4">
                  <Toggle label="Notes" checked={draft.other.showNotes} onChange={(v) => set("other", { showNotes: v })} />
                  <TextRow label="Notes label" value={draft.other.notesLabel} onChange={(v) => set("other", { notesLabel: v })} />
                  <Toggle label="Bank / payment details" checked={draft.other.showBankDetails} onChange={(v) => set("other", { showBankDetails: v })} />
                  <Toggle label="Terms & conditions" checked={draft.other.showTerms} onChange={(v) => set("other", { showTerms: v })} />
                  <TextRow label="Terms label" value={draft.other.termsLabel} onChange={(v) => set("other", { termsLabel: v })} />
                  <Toggle label="Authorised signature" hint="Off: no signature line on the document. A document signed through approvals always shows its signature." checked={draft.other.showSignature} onChange={(v) => set("other", { showSignature: v })} />
                  {draft.other.showSignature && <TextRow label="Signature label" value={draft.other.signatureLabel} onChange={(v) => set("other", { signatureLabel: v })} />}
                  <Toggle label="Page footer (company name and page numbers)" checked={draft.other.showPageNumbers} onChange={(v) => set("other", { showPageNumbers: v })} />
                  <TextRow label="Footer note" placeholder="e.g. Thank you for your business" value={draft.other.footerText} onChange={(v) => set("other", { footerText: v })} />
                </TabsContent>
              </Tabs>
            </fieldset>
          )}
        </Card>

        {/* live preview */}
        <Card className="min-w-0 self-start p-3 sm:p-4 2xl:sticky 2xl:top-24">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Preview · {kindMeta.label}</p>
            {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Unsaved changes</span>}
          </div>
          <div className="rounded-lg bg-muted/50 p-2 sm:p-4">
            <DocPaper model={sample} className="mx-auto max-w-[794px]" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><Label className="text-sm font-normal">{label}</Label>{children}</div>;
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md py-1 text-sm">
      <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
function TextRow({ label, value, onChange, placeholder, stacked }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; stacked?: boolean }) {
  return (
    <div className={stacked ? "space-y-1" : "flex items-center justify-between gap-3"}>
      <Label className="shrink-0 text-sm font-normal">{label}</Label>
      <Input className={stacked ? "h-9" : "h-9 max-w-[13rem]"} value={value} placeholder={placeholder} maxLength={60} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal">{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-10 cursor-pointer rounded-md border border-border bg-transparent p-0.5" />
        <Input className="h-9 w-28 font-mono text-xs uppercase" value={text}
          onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase()); }} />
      </div>
    </div>
  );
}

/** Small schematic of each template for the gallery. */
function TemplateThumb({ id, color, accent }: { id: DocTemplateId; color: string; accent: string }) {
  const head = id === "spreadsheet" ? `${color}33` : id === "minimalist" ? "transparent" : id === "professional" ? accent : color;
  return (
    <div className="relative h-24 overflow-hidden rounded border border-border bg-white p-2">
      {id === "professional" && <div className="absolute inset-x-0 top-0 h-4" style={{ background: color }} />}
      <div className={cn("flex justify-between", id === "professional" && "mt-3")}>
        <div className="space-y-0.5"><div className="h-1.5 w-8 rounded bg-slate-300" /><div className="h-1 w-10 rounded bg-slate-200" /></div>
        {id !== "professional" && <div className="h-2 w-8 rounded" style={{ background: accent }} />}
      </div>
      <div className="mt-2 h-2 w-full rounded-sm" style={{ background: head, borderBottom: id === "minimalist" ? `2px solid ${color}` : undefined, outline: id === "spreadsheet" ? "1px solid #ddd" : undefined }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-1 flex gap-1" style={{ outline: id === "spreadsheet" ? "1px solid #eee" : undefined }}>
          <div className="h-1 flex-1 rounded bg-slate-200" /><div className="h-1 w-4 rounded bg-slate-200" />
        </div>
      ))}
      <div className="mt-1.5 ml-auto h-1.5 w-12 rounded" style={{ background: id === "professional" ? color : "#f1f1f1" }} />
    </div>
  );
}

/** Sample document for the live preview. */
function sampleModel(title: string, kind: DocKindKey, settings: DocSettings): DocModel {
  const isInvoice = kind === "invoice" || kind === "bill";
  const vendor = kind === "po" || kind === "bill" || kind === "requisition";
  const numbers: Partial<Record<DocKindKey, string>> = {
    quote: "QT-000042", invoice: "INV-000016", receipt: "SR-000310", payment: "PR-000021", credit_note: "CN-000003",
    delivery_note: "DN-000012", po: "PO-000007", bill: "BILL-000004", requisition: "REQ-000009", statement: "ST-2026-10",
  };
  return {
    title,
    number: numbers[kind] || "DOC-0001",
    status: isInvoice ? "partial" : kind === "receipt" || kind === "payment" ? "paid" : "draft",
    company: {
      name: "JMSURF Garage",
      lines: [],
      fields: { address: "Devan Plaza, 5th Floor, Westlands", postal: "Nairobi, Kenya", phone: "+254 712 504 593", email: "info@jmsurf.co.ke", website: "jmsurfgarage.co.ke", kraPin: "KRA PIN", vatNumber: "VAT number" },
      kra_pin: "KRA PIN", vat_number: "VAT number",
    },
    party: {
      label: vendor ? "Vendor" : settings.details.billToLabel || "Bill To",
      name: vendor ? "Vendor name" : "Customer name",
      lines: [],
      fields: { address: "Address", kraPin: null, email: "Email address", phone: "Phone number" },
    },
    meta: [
      { label: kind === "quote" ? "Quote Date" : kind === "po" ? "Order Date" : "Date", value: "04 Oct 2026" },
      ...(isInvoice && settings.details.showPaymentTerms ? [{ label: "Terms", value: "Net 30" }] : []),
      ...(settings.details.showDueDate ? [{ label: kind === "quote" ? "Expiry Date" : "Due Date", value: "03 Nov 2026" }] : []),
      ...(settings.details.showReference ? [{ label: "Reference#", value: "QT-000041" }] : []),
      ...(settings.details.showProject ? [{ label: "Salesperson", value: "Salesperson name" }] : []),
    ],
    currency: "KES",
    items: [
      { name: "Consulting services", description: "Monthly retainer", qty: 2, unit_price: 3500, tax_rate: 16, amount: 7000 },
      { name: "Printer toner HP 85A", description: "Original cartridge", qty: 4, unit_price: 450, tax_rate: 16, amount: 1800 },
      { name: "Installation", description: "On-site setup and training", qty: 1, unit_price: 1500, tax_rate: 0, amount: 1500 },
    ],
    totals: { subtotal: 10300, tax: 1408, total: 11708, paid: isInvoice ? 5000 : null },
    highlight: isInvoice ? { label: "Balance Due", value: 6708 } : null,
    sections: [
      { title: "Notes", text: "Thanks for your business." },
      { title: "Terms & Conditions", text: "Goods once sold are not returnable unless faulty. Payment due within 30 days." },
    ],
    payment: [{ title: "Payment Details", lines: ["M-Pesa Paybill: 400200  Account: YOUR NAME", "Equity Bank, Ngong Road branch", "Account name: JMSURF Garage  Account no: 0123456789"] }],
    signatures: kind === "po" || kind === "requisition" ? ["Prepared by", "Approved by"] : undefined,
    settings,
  };
}

/** Show/hide and reorder detail lines (organization or customer). */
function FieldOrder<K extends string>({ title, fields, defs, onChange }: {
  title: string; fields: FieldToggle<K>[]; defs: { key: K; label: string }[]; onChange: (v: FieldToggle<K>[]) => void;
}) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {fields.map((f, i) => (
          <li key={f.key} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm">
            <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className={cn("flex-1", !f.show && "text-muted-foreground line-through")}>{defs.find((d) => d.key === f.key)?.label ?? f.key}</span>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Switch checked={f.show} aria-label={`Show ${f.key}`} onCheckedChange={(v) => onChange(fields.map((x) => (x.key === f.key ? { ...x, show: v } : x)))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** System → Documents: document templates, and (with Point of Sale) the till receipt. */
export default function DocumentSettingsPage() {
  const { has } = useModules();
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const pos = has("pos");
  const section = pos && params.get("section") === "receipts" ? "receipts" : "documents";
  const canManage = role === "admin" || role === "manager" || role === "super_admin";
  return (
    <div className="space-y-4">
      {pos && <Segmented value={section} onChange={(v) => setParams(v === "receipts" ? { section: "receipts" } : {})} options={[{ value: "documents", label: "Invoices & other documents" }, { value: "receipts", label: "Till receipts" }]} />}
      {section === "receipts" ? <BusinessTab canManage={canManage} mode="receipts" /> : <DocumentTemplates />}
    </div>
  );
}
