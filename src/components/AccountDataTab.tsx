import { useState } from "react";
import * as XLSX from "@e965/xlsx";
import { Download, DoorClosed, ShieldCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { Panel, Field, Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;

/** Every table a shop owns, one sheet each. Rows are read under the shop's own access rules. */
// viaRls: the table has no tenant column; its access rules already limit it to this shop.
const SHEETS: { table: string; sheet: string; viaRls?: boolean }[] = [
  { table: "products", sheet: "Products" },
  { table: "product_variants", sheet: "Variants" },
  { table: "product_stocks", sheet: "Stock levels", viaRls: true },
  { table: "product_batches", sheet: "Batches" },
  { table: "services", sheet: "Services" },
  { table: "customers", sheet: "Customers" },
  { table: "customer_payments", sheet: "Customer payments" },
  { table: "suppliers", sheet: "Suppliers" },
  { table: "transactions", sheet: "Sales" },
  { table: "sale_returns", sheet: "Returns" },
  { table: "quotes", sheet: "Quotes" },
  { table: "invoices", sheet: "Invoices" },
  { table: "layaways", sheet: "Layaways" },
  { table: "purchases", sheet: "Purchases" },
  { table: "purchase_items", sheet: "Purchase items", viaRls: true },
  { table: "expenses", sheet: "Expenses" },
  { table: "bills", sheet: "Bills" },
  { table: "bill_payments", sheet: "Bill payments" },
  { table: "stock_adjustments", sheet: "Stock changes", viaRls: true },
  { table: "stock_counts", sheet: "Stock-takes" },
  { table: "shifts", sheet: "Shifts" },
  { table: "locations", sheet: "Branches" },
  { table: "profiles_safe", sheet: "Staff" },
];

const PAGE = 1000;

async function fetchAll(table: string, tenantId: string, viaRls?: boolean) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select("*");
    if (!viaRls) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Spreadsheet cells can't hold objects; lists and details are written as text.
const flat = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]));

export default function AccountDataTab() {
  const { role, signOut } = useAuth() as any;
  const { tenant } = useTenant() as any;
  const { toast } = useToast();
  const [exporting, setExporting] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [slugTyped, setSlugTyped] = useState("");
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState(false);
  const isOwner = role === "admin";
  const slug = tenant?.slug || "";
  const companyName = (tenant?.business_name || "").trim();

  const exportAll = async () => {
    if (!tenant?.id) return;
    const wb = XLSX.utils.book_new();
    const skipped: string[] = [];
    let total = 0;
    try {
      for (const s of SHEETS) {
        setExporting(s.sheet);
        try {
          const rows = (await fetchAll(s.table, tenant.id, s.viaRls)).map(flat);
          total += rows.length;
          XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["No records"]]), s.sheet.slice(0, 31));
        } catch {
          skipped.push(s.sheet);
        }
      }
      XLSX.writeFile(wb, `${slug || "shop"}-all-data-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast({ title: "Export ready", description: `${total.toLocaleString()} records downloaded.${skipped.length ? ` Not included: ${skipped.join(", ")}.` : ""}` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting("");
    }
  };

  const closeShop = async () => {
    setClosing(true);
    const { error } = await sb.rpc("close_my_shop_by_name", { p_confirm_name: slugTyped, p_reason: reason });
    setClosing(false);
    if (error) { toast({ title: "Company not closed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Your company is closed", description: "Your records are kept. Contact support any time to reopen it." });
    setCloseOpen(false);
    try { await signOut?.(); } catch { /* signed out below anyway */ }
    await supabase.auth.signOut().catch(() => undefined);
    window.location.href = "/";
  };

  if (!isOwner) {
    return (
      <Panel title="Your data">
        <p className="text-sm text-muted-foreground">Only the company owner can download all the company's data or close the company.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <Panel title="Download all your data" description="One spreadsheet with a sheet for each part of your company.">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={exportAll} disabled={!!exporting}>
            {exporting ? <OrbSpinner /> : <Download />}
            {exporting ? `Reading ${exporting}…` : "Download everything (Excel)"}
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Your data is yours. Download it as often as you like.</p>
        </div>
      </Panel>

      <Panel title="Close your company" description="Stops sign-in and cancels your plan. Records are archived, not deleted.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="max-w-lg text-sm">We suggest downloading your data first. Any remaining plan time is not refunded.</p>
          <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => { setSlugTyped(""); setReason(""); setCloseOpen(true); }}>
            <DoorClosed /> Close my shop
          </Button>
        </div>
      </Panel>

      <Modal open={closeOpen} onClose={() => !closing && setCloseOpen(false)} icon={AlertTriangle} title="Close your company?"
        description="You and all your staff will be signed out and won't be able to sign in."
        footer={<>
          <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={closing}>Keep my company</Button>
          <Button variant="destructive" onClick={closeShop} disabled={closing || !companyName || slugTyped.trim().toLowerCase() !== companyName.toLowerCase()}>
            {closing && <OrbSpinner />} Close shop
          </Button>
        </>}>
        <div className="space-y-4">
          <Field label="Why are you leaving? (optional)" hint="It helps us improve">
            <textarea className="fi min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <Field label={`Type your company name "${companyName}" to confirm`}>
            <input className="fi" value={slugTyped} onChange={(e) => setSlugTyped(e.target.value)} placeholder="Enter your company name" autoComplete="off" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
