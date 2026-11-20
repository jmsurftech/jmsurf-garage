import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileSearch, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { downloadDocumentPdf, loadDocModel, type DocumentKind } from "@/lib/docModels";
import { OrbSpinner } from "@/components/orbs";
import { DocPaper } from "@/components/print/doc-paper";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { SideDialogContent as DialogContent } from "@/components/kit";

export function useDocModel(kind: DocumentKind, id: string | null | undefined, version = "") {
  return useQuery({
    queryKey: ["doc-model", kind, id, version],
    queryFn: () => loadDocModel(kind, id!),
    enabled: !!id,
    staleTime: 15_000,
  });
}

function usePdfDownload(kind: DocumentKind, id: string) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await downloadDocumentPdf(kind, id); }
    catch (e) { toast.error((e as Error).message || "Could not build the PDF"); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

/** Prints only the document sheet (everything else on the page is hidden). */
export function printDocSheet() {
  document.body.classList.add("zd-printing");
  const done = () => { document.body.classList.remove("zd-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
}

export const PRINT_CSS = `
@media print {
  body.zd-printing * { visibility: hidden !important; }
  body.zd-printing .zd-print-root, body.zd-printing .zd-print-root * { visibility: visible !important; }
  body.zd-printing .zd-print-root { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; background: #fff !important; }
  @page { size: A4; margin: 12mm; }
}`;

/** Inline document preview: toolbar + paper. */
export function DocumentPreview({ kind, id, actions, className, version }: { kind: DocumentKind; id: string; actions?: ReactNode; className?: string; version?: string }) {
  const { data, error, isLoading } = useDocModel(kind, id, version);
  const pdf = usePdfDownload(kind, id);
  return (
    <div className={className}>
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><Eye className="size-4" />Preview</span>
        <span className="flex-1" />
        {actions}
        <Button size="sm" variant="outline" onClick={printDocSheet} disabled={!data}><Printer className="size-4" />Print</Button>
        <Button size="sm" variant="outline" onClick={pdf.run} disabled={pdf.busy}>
          {pdf.busy ? <OrbSpinner className="size-4" state="weaving" /> : <Download className="size-4" />}PDF
        </Button>
      </div>
      <div className="zd-print-root rounded-lg bg-muted/50 p-2 sm:p-6">
        {error ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{(error as Error).message || "This document could not be loaded"}</p>
        ) : isLoading || !data ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><OrbSpinner className="size-4" state="weaving" />Preparing preview…</div>
        ) : (
          <DocPaper model={data.model} className="mx-auto max-w-[794px]" />
        )}
      </div>
    </div>
  );
}

/** Eye-button friendly dialog that previews a document without leaving the list. */
export function DocumentPreviewDialog({ kind, id, open, onOpenChange, title }: {
  kind: DocumentKind; id: string | null; open: boolean; onOpenChange: (o: boolean) => void; title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-3 sm:w-[min(920px,100vw)] sm:p-5">
        <DialogTitle className="pr-8 text-base">{title ?? "Document preview"}</DialogTitle>
        {id && <DocumentPreview kind={kind} id={id} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Full-page viewer (the /print/* routes). Renders the HTML preview — readable
 * on phones where PDFs would only download — with Print and PDF buttons.
 * Supports ?autoprint=1.
 */
export function DocumentPdfView({ kind, id }: { kind: DocumentKind; id: string }) {
  const { data, error } = useDocModel(kind, id);
  const pdf = usePdfDownload(kind, id);

  useEffect(() => {
    if (!data) return;
    document.title = data.filename.replace(/\.pdf$/, "");
    if (new URLSearchParams(window.location.search).get("autoprint") === "1") {
      const t = setTimeout(printDocSheet, 600);
      return () => clearTimeout(t);
    }
  }, [data]);

  const close = () => { if (window.history.length > 1) window.history.back(); else window.close(); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-muted">
      <style>{PRINT_CSS}</style>
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <span className="min-w-0 truncate text-sm font-medium">{data ? data.filename.replace(/\.pdf$/, "").replace(/-/g, " ") : "Document"}</span>
        <span className="flex-1" />
        <Button size="sm" onClick={printDocSheet} disabled={!data}><Printer className="size-4" /><span className="hidden sm:inline">Print</span></Button>
        <Button size="sm" variant="outline" onClick={pdf.run} disabled={pdf.busy}>
          {pdf.busy ? <OrbSpinner className="size-4" state="weaving" /> : <Download className="size-4" />}<span className="hidden sm:inline">Download PDF</span>
        </Button>
        <Button size="icon" variant="outline" className="size-8" onClick={close} aria-label="Close"><X className="size-4" /></Button>
      </div>
      <div className="flex-1 overflow-auto p-2 sm:p-8">
        {error ? (
          <div className="m-auto mt-10 max-w-md rounded-lg border bg-background p-6 text-center text-sm">
            <p className="font-medium">This document could not be opened</p>
            <p className="mt-1 text-muted-foreground">{(error as Error).message}</p>
          </div>
        ) : data ? (
          <div className="zd-print-root mx-auto max-w-[794px]"><DocPaper model={data.model} /></div>
        ) : (
          <div className="mt-24 flex items-center justify-center gap-2 text-sm text-muted-foreground"><OrbSpinner className="size-4" state="weaving" />Preparing document…</div>
        )}
      </div>
    </div>
  );
}

/** Row action: opens the document preview in a dialog. */
export function DocPreviewButton({ kind, id, title }: { kind: DocumentKind; id: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="icon" variant="ghost" aria-label="Preview document" title="Preview" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <FileSearch className="h-4 w-4" />
      </Button>
      {open && <DocumentPreviewDialog kind={kind} id={id} open={open} onOpenChange={setOpen} title={title} />}
    </>
  );
}
