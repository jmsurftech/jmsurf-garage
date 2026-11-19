import { useMemo, useState } from "react";
import { Check, Eye, LayoutTemplate } from "lucide-react";
import { Panel, Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatKES } from "@/lib/format";
import { OrbSpinner } from "@/components/orbs";
import {
  RECEIPT_TEMPLATES, receiptDocumentHtml, receiptTemplateId, sampleReceipt,
  type ReceiptTemplateId,
} from "@/lib/receiptTemplates";

// Scrollbars hidden inside the small previews.
const PREVIEW_CSS = "html,body{overflow:hidden}";

interface Props {
  current: unknown;
  businessName: string;
  phone?: string;
  address?: string;
  footer?: string;
  terms?: string;
  logoUrl?: string | null;
  canManage: boolean;
  onApply: (id: ReceiptTemplateId) => Promise<boolean>;
}

/** Gallery of receipt layouts; "Apply" saves the shop's choice straight away. */
export default function ReceiptTemplatesPanel({ current, businessName, phone, address, footer, terms, logoUrl, canManage, onApply }: Props) {
  const active = receiptTemplateId(current);
  const [applying, setApplying] = useState<ReceiptTemplateId | "">("");
  const [preview, setPreview] = useState<ReceiptTemplateId | "">("");

  const data = useMemo(() => sampleReceipt({
    money: formatKES,
    businessName: businessName || "Your Company",
    phone: phone || undefined,
    address: address || undefined,
    footer: footer || "Thank you for shopping with us!",
    terms: terms || "",
    logoUrl: logoUrl || null,
  }), [businessName, phone, address, footer, terms, logoUrl]);

  const apply = async (id: ReceiptTemplateId) => {
    setApplying(id);
    const ok = await onApply(id);
    setApplying("");
    if (ok) setPreview("");
  };

  const previewTpl = RECEIPT_TEMPLATES.find((t) => t.id === preview);

  return (
    <Panel title="Receipt templates" description="Choose how your printed receipts look. Previews use your company details and a sample sale." icon={LayoutTemplate}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {RECEIPT_TEMPLATES.map((t) => {
          const isActive = t.id === active;
          return (
            <div key={t.id}
              className={cn("flex flex-col overflow-hidden rounded-xl border-2 bg-card transition-colors",
                isActive ? "border-primary shadow-sm" : "border-border hover:border-primary/40")}>
              <button type="button" onClick={() => setPreview(t.id)} title={`Preview ${t.name}`}
                className="relative h-[230px] overflow-hidden bg-muted/40">
                {/* 80 mm paper is ~300 px wide; shrink it to fit the card. */}
                <iframe title={`${t.name} receipt preview`} srcDoc={receiptDocumentHtml(data, t.id, PREVIEW_CSS)}
                  tabIndex={-1} aria-hidden="true" loading="lazy"
                  className="pointer-events-none absolute left-1/2 top-2 h-[640px] w-[300px] origin-top -translate-x-1/2 scale-[0.5] rounded bg-white shadow" />
                {isActive && (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    <Check className="h-3 w-3" /> In use
                  </span>
                )}
              </button>
              <div className="flex flex-1 flex-col gap-2 border-t border-border p-3">
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">{t.description}</p>
                </div>
                <div className="mt-auto flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-8 flex-1 px-2 text-xs" onClick={() => setPreview(t.id)}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  <Button type="button" size="sm" className="h-8 flex-1 px-2 text-xs"
                    disabled={!canManage || isActive || !!applying} onClick={() => apply(t.id)}>
                    {applying === t.id ? <OrbSpinner className="h-3.5 w-3.5" /> : isActive ? <Check className="h-3.5 w-3.5" /> : null}
                    {isActive ? "Applied" : "Apply"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {brandedHint(active, logoUrl)}

      <Modal open={!!previewTpl} onClose={() => setPreview("")} title={previewTpl ? `${previewTpl.name} receipt` : ""}
        description={previewTpl?.description} icon={LayoutTemplate} size="md"
        footer={previewTpl && (
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview("")}>Close</Button>
            <Button disabled={!canManage || previewTpl.id === active || !!applying} onClick={() => apply(previewTpl.id)}>
              {applying === previewTpl.id && <OrbSpinner className="h-4 w-4" />}
              {previewTpl.id === active ? "In use" : "Apply this template"}
            </Button>
          </div>
        )}>
        {previewTpl && (
          <div className="flex justify-center rounded-lg bg-muted/40 p-3">
            <iframe title={`${previewTpl.name} receipt`} srcDoc={receiptDocumentHtml(data, previewTpl.id)}
              className="h-[60vh] w-[320px] max-w-full rounded bg-white shadow" />
          </div>
        )}
      </Modal>
    </Panel>
  );
}

function brandedHint(active: ReceiptTemplateId, logoUrl?: string | null) {
  if (active !== "branded" || logoUrl) return null;
  return <p className="mt-3 text-xs text-muted-foreground">The Branded template prints your logo at the top. Upload one under Logo above.</p>;
}
