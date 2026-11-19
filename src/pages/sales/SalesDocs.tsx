import { useEffect, useMemo, useState } from "react";
import { useDocSignature, useSigningRule, type SignType } from "@/lib/signing";
import { useLocations } from "@/hooks/useData";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { SignBanner } from "@/components/books/SignBanner";
import { MakeRecurringModal } from "@/pages/sales/RecurringInvoices";
import { ViewJournalModal } from "@/components/books/ViewJournal";
import { EtimsPush } from "@/components/books/EtimsPush";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, MoreHorizontal, Pencil, Mail, MessageCircle, Send, FileCheck2, Copy, Trash2, X, CheckCircle2,
  XCircle, Wallet, Ban, Search, FileText, Receipt, Smartphone, CheckSquare, FileX2, FileClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Modal, Field, EmptyState } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import DocumentsPanel from "@/components/DocumentsPanel";
import { ZStatus, invoiceDisplayStatus, quoteDisplayStatus } from "@/components/books/ZStatus";
import { confirmAction } from "@/components/books/confirm";
import { RecordPaymentModal } from "@/components/books/RecordPayment";
import { emailDocument, shareOnWhatsApp, docSummary } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { currencyCode, formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApprovalRule, submitForApproval } from "@/lib/approvals";
import { erpApi } from "@/lib/erpApi";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { Download, BellRing, ClipboardCheck, Repeat, BookOpenCheck, Link2, Link2Off, CreditCard } from "lucide-react";
import { getPayLink, revokePayLink } from "@/lib/payLink";
import { ShareLinkModal } from "@/components/books/ShareLink";
import { useBranch, byBranch } from "@/pages/branches/Branches";
import { PhoneDocCards } from "@/components/books/PhoneDocCards";
import { TagFilter, TagGroupSummary, matchesTagView, NO_TAG_VIEW, type TagView } from "@/lib/reportingTags";

const sb: any = supabase;
export type SalesKind = "quote" | "sales_order" | "invoice";

const CFG = {
  quote: {
    table: "quotes", title: "Quotations", single: "Quotation", numberCol: "quote_number", base: "/sales/quotes", icon: FileText,
    views: [["all", "All Quotations"], ["draft", "Draft"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"], ["expired", "Expired"], ["invoiced", "Invoiced"]],
  },
  sales_order: {
    table: "sales_orders", title: "Sales Orders", single: "Sales Order", numberCol: "quote_number", base: "/sales/orders", icon: ClipboardCheck,
    views: [["all", "All Sales Orders"], ["draft", "Draft"], ["sent", "Open"], ["accepted", "Confirmed"], ["invoiced", "Invoiced"], ["declined", "Cancelled"]],
  },
  invoice: {
    table: "invoices", title: "Invoices", single: "Invoice", numberCol: "invoice_number", base: "/sales/invoices", icon: Receipt,
    views: [["all", "All Invoices"], ["draft", "Draft"], ["sent", "Unpaid"], ["partially_paid", "Partially Paid"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]],
  },
} as const;

const displayStatus = (kind: SalesKind, d: any) => (kind === "invoice" ? invoiceDisplayStatus(d) : quoteDisplayStatus(d));

export function useSalesDocs(kind: SalesKind) {
  const tenantId = useTenantId();
  const [branch] = useBranch();
  return useQuery({
    queryKey: ["zdocs", kind, tenantId, branch],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await byBranch(sb.from(CFG[kind].table).select("*").eq("tenant_id", tenantId), branch).order("issue_date", { ascending: false, nullsFirst: false }).order(CFG[kind].numberCol, { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as any[];
    },
  });
}

/** eTIMS mark next to an invoice number: reported (green), waiting or not yet reported (orange), failed (red). */
function EtimsMark({ d, live }: { d: any; live: boolean }) {
  if (d.etims_status === "signed") return <span title={`Reported to KRA eTIMS${d.etims_rcpt_no ? ` · receipt ${d.etims_rcpt_no}` : ""}`}><FileCheck2 className="h-4 w-4 text-success" /></span>;
  if (d.etims_status === "failed") return <span title={`KRA eTIMS did not accept it: ${d.etims_error || ""}`}><FileX2 className="h-4 w-4 text-destructive" /></span>;
  if (!live && d.etims_status !== "pending") return null;
  return <span title={d.etims_status === "pending" ? "Waiting for KRA" : "Not reported to KRA eTIMS yet"}><FileClock className="h-4 w-4 text-warning" /></span>;
}

const RES: Record<SalesKind, string> = { quote: "quotes", sales_order: "sales_orders", invoice: "invoices" };

export default function SalesDocs({ kind }: { kind: SalesKind }) {
  const cfg = CFG[kind];
  // Roles: what this person may do here, and whose documents they see.
  const { can, scope } = usePermissions();
  const { user: me } = useAuth() as any;
  const res = RES[kind];
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: docs = [], isLoading } = useSalesDocs(kind);
  // As in Zoho: an eTIMS mark beside each invoice number, and the location when there is more than one.
  const { settings: listErp } = useErpSettings();
  const etimsLive = kind === "invoice" && !!(listErp as any)?.etims?.initialised_at;
  const { data: locs = [] } = useLocations();
  const locName = (lid: string | null) => (locs as any[]).find((l) => l.id === lid)?.name || "";
  const showLoc = kind === "invoice" && (locs as any[]).length > 1;
  const [view, setView] = useState<string>("all");
  const [q, setQ] = useState("");
  // Reporting tags (invoices): filter by a value and/or show totals per value.
  const [tagView, setTagView] = useState<TagView>(NO_TAG_VIEW);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (scope !== "all" && me?.id && d.salesperson_id !== me.id && d.created_by !== me.id) return false;
      if (kind === "invoice" && !matchesTagView(d, tagView)) return false;
      const st = displayStatus(kind, d);
      if (view !== "all") {
        if (kind === "invoice" && view === "sent") { if (!["sent", "overdue", "partially_paid"].includes(st)) return false; }
        else if (st !== view) return false;
      }
      return !s || `${d[cfg.numberCol]} ${d.customer_name || ""} ${d.reference || ""}`.toLowerCase().includes(s);
    });
  }, [docs, view, q, kind, cfg.numberCol, scope, me?.id, tagView]);

  const selected = id ? docs.find((d) => d.id === id) : null;
  const paged = usePaged(rows, 50);
  const sel = useSelection(paged.rows.map((d: any) => d.id));
  const qc = useQueryClient();
  const { toast } = useToast();
  const picked = docs.filter((d) => sel.has(d.id));
  const signRule = useSigningRule(kind as SignType);
  const after = (msg: string) => { sel.clear(); qc.invalidateQueries({ queryKey: ["zdocs", kind] }); toast({ title: msg }); };
  const setStatusMany = async (from: string[], status: string, msg: string) => {
    const ids = picked.filter((d) => from.includes(d.status)).map((d) => d.id);
    if (!ids.length) return toast({ title: "None of the selected records can change to that", variant: "destructive" });
    const patch: Record<string, unknown> = { status };
    if (status === "sent") patch.sent_at = new Date().toISOString();
    const { error } = await sb.from(cfg.table).update(patch).in("id", ids);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    after(`${ids.length} ${msg}`);
  };
  const deleteDrafts = async () => {
    const ids = picked.filter((d) => d.status === "draft").map((d) => d.id);
    if (!ids.length) return toast({ title: "Only drafts can be deleted", description: kind === "invoice" ? "Void sent invoices instead." : undefined, variant: "destructive" });
    if (!(await confirmAction({ title: `Delete ${ids.length} draft${ids.length === 1 ? "" : "s"}?`, message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from(cfg.table).delete().in("id", ids);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    after(`${ids.length} deleted`);
  };
  const remind = async (channels: { sms: boolean; email: boolean }) => {
    const ids = picked.filter((d) => !["draft", "void", "paid"].includes(d.status) && Number(d.total) - Number(d.amount_paid || 0) > 0).map((d) => d.id);
    if (!ids.length) return toast({ title: "Pick unpaid invoices", variant: "destructive" });
    try {
      const r: any = await erpApi("remind-payment", { invoice_ids: ids, ...channels });
      after(`Reminders sent: ${r.sms || 0} SMS, ${r.email || 0} email${r.skipped ? ` (${r.skipped} without contact)` : ""}`);
    } catch (e: any) { toast({ title: "Reminders not sent", description: e.message, variant: "destructive" }); }
  };
  const exportPicked = () => downloadCsv(`${cfg.table}-selected.csv`, ["Number", "Date", "Customer", "Status", "Due", "Total", "Paid", "Balance"],
    picked.map((d) => [d[cfg.numberCol], d.issue_date, d.customer_name, displayStatus(kind, d), d.due_date, d.total, d.amount_paid || 0, Math.max(0, Number(d.total || 0) - Number(d.amount_paid || 0))]));
  const viewLabel = cfg.views.find(([v]) => v === view)?.[1] || cfg.title;
  const total = rows.reduce((a, d) => a + Number(d.total || 0), 0);
  const due = kind === "invoice" ? rows.reduce((a, d) => a + Math.max(0, Number(d.total || 0) - Number(d.amount_paid || 0)) * (["void", "draft"].includes(d.status) ? 0 : 1), 0) : 0;

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1.5 font-display text-lg font-bold">
            {viewLabel} <ChevronDown className="h-4 w-4 text-primary" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {cfg.views.map(([v, label]) => (
            <DropdownMenuItem key={v} onSelect={() => setView(v)} className={cn(view === v && "font-semibold text-primary")}>{label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="flex-1" />
      {!selected && kind === "invoice" && <TagFilter module="invoices" view={tagView} onChange={setTagView} />}
      {!selected && (
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cfg.title.toLowerCase()}…`} className="fi h-9 w-64 rounded-full pl-9" />
        </div>
      )}
      {can(res, "create") && <Button size="sm" onClick={() => navigate(`${cfg.base}/new`)}><Plus /> New</Button>}
    </div>
  );

  if (isLoading) return <OrbLoader label={`Loading ${cfg.title.toLowerCase()}…`} />;

  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      {header}
      <div className="flex min-h-0 flex-1">
        {/* List: full table, or a narrow column beside an open record (split view). */}
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 xl:block" : "w-full")}>
          {rows.length === 0 ? (
            <EmptyState icon={cfg.icon} title={`No ${cfg.title.toLowerCase()} yet`} description={kind !== "invoice" ? "Create a quotation and send it to your customer." : "Bill your customers and track what they owe."}
 className="m-6" />
          ) : selected ? (
            <ul>
              {(paged.rows as any[]).map((d) => (
                <li key={d.id}>
                  <Link to={`${cfg.base}/${d.id}`} className={cn("block border-b border-border px-4 py-3 transition-colors hover:bg-muted/50", d.id === id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{d.customer_name || "Customer"}</span>
                      <span className="text-sm font-semibold tabular-nums">{formatKES(Number(d.total || 0))}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{d[cfg.numberCol]} · {fmtDate(d.issue_date || d.created_at)}</span>
                      <ZStatus status={displayStatus(kind, d)} />
                    </div>
                  </Link>
                </li>
              ))}
              <li><Pager {...paged.pager} /></li>
            </ul>
          ) : (
            <>
              {kind === "invoice" && <TagGroupSummary rows={rows} view={tagView} amount={(d: any) => Number(d.total || 0)} />}
              <BulkBar sel={sel} noun={cfg.single.toLowerCase()}>
                {!signRule.enabled && <Button size="sm" variant="outline" onClick={() => setStatusMany(["draft"], "sent", "marked as sent")}><Send /> Mark as sent</Button>}
                {kind === "invoice" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><BellRing /> Payment reminder <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => remind({ sms: true, email: true })}><BellRing /> SMS and email</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => remind({ sms: true, email: false })}><Smartphone /> SMS only</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => remind({ sms: false, email: true })}><Mail /> Email only</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {kind !== "invoice" && <Button size="sm" variant="outline" onClick={() => setStatusMany(["draft", "sent"], "accepted", "marked accepted")}><CheckCircle2 /> Accepted</Button>}
                {kind !== "invoice" && <Button size="sm" variant="outline" onClick={() => setStatusMany(["draft", "sent"], "declined", "marked declined")}><XCircle /> Declined</Button>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline">More <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={exportPicked}><Download /> Export selected</DropdownMenuItem>
                    {kind === "invoice" && can("invoices", "void") && <DropdownMenuItem onSelect={async () => { if (await confirmAction({ title: "Void the selected invoices?", message: "Paid and part-paid invoices are skipped.", danger: true, confirmLabel: "Void" })) void setStatusMany(["draft", "sent", "overdue"], "void", "voided"); }}><Ban /> Void</DropdownMenuItem>}
                    <DropdownMenuItem danger onSelect={deleteDrafts}><Trash2 /> Delete drafts</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </BulkBar>
              <PhoneDocCards onOpen={(rid) => navigate(`${cfg.base}/${rid}`)} rows={(paged.rows as any[]).map((d) => ({
                id: d.id, number: d[cfg.numberCol], party: d.customer_name || "", date: fmtDate(d.issue_date || d.created_at),
                due: kind === "invoice" && d.due_date ? fmtDate(d.due_date) : null, amount: formatKES(Number(d.total || 0)),
                balance: kind === "invoice" && !["paid", "void"].includes(d.status) ? formatKES(Math.max(0, Number(d.total || 0) - Number(d.amount_paid || 0))) : null,
                status: <ZStatus status={displayStatus(kind, d)} />,
              }))} />
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[800px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-card">
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="w-10 px-3 py-2.5 text-left"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} label="Select all on this page" /></th>
                      <th className="px-4 py-2.5 text-left">Date</th>
                      <th className="px-4 py-2.5 text-left">{kind !== "invoice" ? "Quote#" : "Invoice#"}</th>
                      <th className="px-4 py-2.5 text-left">Reference Number</th>
                      <th className="px-4 py-2.5 text-left">Customer Name</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      {kind === "invoice" && <th className="px-4 py-2.5 text-left">Due Date</th>}
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      {kind === "invoice" && <th className="px-4 py-2.5 text-right">Balance Due</th>}
                      {showLoc && <th className="px-4 py-2.5 text-left">Location</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(paged.rows as any[]).map((d) => (
                      <tr key={d.id} onClick={() => navigate(`${cfg.base}/${d.id}`)} className={cn("cursor-pointer border-b border-border transition-colors hover:bg-muted/40", sel.has(d.id) && "bg-primary/5")}>
                        <td className="w-10 px-3 py-3"><Tick on={sel.has(d.id)} onChange={() => sel.toggle(d.id)} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(d.issue_date || d.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-primary"><span className="inline-flex items-center gap-1.5">{d[cfg.numberCol]}<EtimsMark d={d} live={etimsLive} /></span></td>
                        <td className="px-4 py-3 text-muted-foreground">{d.reference || ""}</td>
                        <td className="max-w-[16rem] px-4 py-3 font-medium"><span className="block truncate">{d.customer_name || "—"}</span></td>
                        <td className="px-4 py-3"><ZStatus status={displayStatus(kind, d)} /></td>
                        {kind === "invoice" && <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{d.due_date ? fmtDate(d.due_date) : "—"}</td>}
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKES(Number(d.total || 0))}</td>
                        {kind === "invoice" && <td className="px-4 py-3 text-right tabular-nums">{formatKES(Math.max(0, Number(d.total || 0) - Number(d.amount_paid || 0)))}</td>}
                        {showLoc && <td className="px-4 py-3 text-muted-foreground">{locName(d.location_id) || "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...paged.pager} summary={<>
                <span>Total <b className="text-foreground">{formatKES(total)}</b></span>
                {kind === "invoice" && <span>Balance due <b className="text-foreground">{formatKES(due)}</b></span>}
              </>} />
            </>
          )}
        </div>

        {selected && <DocDetail kind={kind} doc={selected} onClose={() => navigate(cfg.base)} />}
        {id && !selected && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">That record was not found.</div>}
      </div>
    </div>
  );
}

function DocDetail({ kind, doc, onClose }: { kind: SalesKind; doc: any; onClose: () => void }) {
  const cfg = CFG[kind];
  const { can } = usePermissions();
  const res = RES[kind];
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { data: biz } = useBusinessSettings();
  const [mail, setMail] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<"doc" | "packing_list" | "delivery_note">("doc");
  const [recurOpen, setRecurOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Arriving from "Save and Send" or "Make Recurring" on the form: open the email / the repeat settings.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("send") && !q.has("recur")) return;
    if (q.get("send") === "1") setMail(true);
    if (q.get("recur") === "1" && kind === "invoice") setRecurOpen(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [journalOpen, setJournalOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const approval = doc.approval_status as string | undefined;
  const blocked = approval === "pending" || approval === "rejected";
  // Sign & Stamp: a document that must be signed cannot be sent before it is.
  const sig = useDocSignature(kind as SignType, doc.id);
  const sendBlocked = blocked || sig.blocked;
  const approvalRule = useApprovalRule(kind);
  const number = doc[cfg.numberCol];
  const status = displayStatus(kind, doc);
  const shop = biz?.business_name || "JMSURF Garage";
  const ccy = currencyCode() || "KES";
  const balance = Math.max(0, Number(doc.total || 0) - Number(doc.amount_paid || 0));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["zdocs"] }); qc.invalidateQueries({ queryKey: ["doc-model"] }); qc.invalidateQueries({ queryKey: ["doc-payments"] }); };

  // "Pay now" link: every sent invoice with a balance has one (made the first time it is needed).
  const payable = kind === "invoice" && !["draft", "void"].includes(doc.status) && balance > 0;
  const { data: payLink = null } = useQuery({
    queryKey: ["pay-link", doc.id], enabled: payable && can("invoices", "view"), staleTime: Infinity, retry: false,
    queryFn: async () => { try { return await getPayLink(doc.id); } catch { return null; } },
  });
  const copyPayLink = async () => {
    try {
      const url = payLink || (await getPayLink(doc.id));
      qc.setQueryData(["pay-link", doc.id], url);
      await navigator.clipboard.writeText(url);
      toast({ title: "Payment link copied", description: url });
    } catch (e: any) { toast({ title: "Link not copied", description: e?.message || "Try again", variant: "destructive" }); }
  };
  const turnOffPayLink = async () => {
    if (!(await confirmAction({ title: "Turn off the payment link?", message: "The link already sent stops working. Copying the payment link again makes a new one.", confirmLabel: "Turn off", danger: true }))) return;
    try {
      const n = await revokePayLink(doc.id);
      qc.setQueryData(["pay-link", doc.id], null);
      toast({ title: n ? "Payment link turned off" : "This invoice had no payment link" });
    } catch (e: any) { toast({ title: "Not changed", description: e?.message, variant: "destructive" }); }
  };

  const update = async (patch: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    const { error } = await sb.from(cfg.table).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", doc.id);
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    refresh();
    toast({ title: okMsg });
  };

  const convertToInvoice = async () => {
    setBusy(true);
    try {
      const { data: num, error: nErr } = await sb.rpc("next_doc_number", { p_kind: "invoice" });
      if (nErr) throw nErr;
      // The customer's own credit terms first, then the company default.
      const { data: cust } = doc.customer_id ? await sb.from("customers").select("credit_days").eq("id", doc.customer_id).maybeSingle() : { data: null };
      const days = Number(cust?.credit_days || 0) > 0 ? Number(cust.credit_days) : Number(biz?.payment_terms_days || 0);
      const due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const { data: inv, error } = await sb.from("invoices").insert({
        tenant_id: tenantId, invoice_number: num, customer_id: doc.customer_id, customer_name: doc.customer_name,
        customer_email: doc.customer_email, customer_phone: doc.customer_phone, items: doc.items,
        subtotal: doc.subtotal, tax: doc.tax, discount: doc.discount, adjustment: doc.adjustment, shipping: doc.shipping, total: doc.total,
        status: "draft", issue_date: new Date().toISOString().slice(0, 10), due_date: due,
        payment_terms: days ? `Net ${days}` : "Due on Receipt", salesperson_id: doc.salesperson_id, salesperson_name: doc.salesperson_name,
        reference: doc[cfg.numberCol], subject: doc.subject, customer_notes: doc.customer_notes, terms: biz?.invoice_terms || doc.terms,
        quote_id: kind === "quote" ? doc.id : doc.quote_id || null, source: kind, deal_id: doc.deal_id || null,
      }).select("id").single();
      if (error) throw error;
      await sb.from(cfg.table).update({ status: "invoiced", invoice_id: inv.id, updated_at: new Date().toISOString() }).eq("id", doc.id);
      refresh();
      toast({ title: `Invoice ${num} created from ${number}` });
      navigate(`/sales/invoices/${inv.id}`);
    } catch (e: any) {
      toast({ title: "Could not convert", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const clone = () => navigate(`${cfg.base}/new?clone=${doc.id}`);

  /** Quote accepted, then a confirmed sales order. */
  const convertToOrder = async () => {
    setBusy(true);
    try {
      const { data: num, error: nErr } = await sb.rpc("next_doc_number", { p_kind: "sales_order" });
      if (nErr) throw nErr;
      const { id: _i, quote_number: _q, created_at: _c, updated_at: _u, invoice_id: _inv, lead_id: _l, sent_at: _s, accepted_at: _a, approval_status: _ap, valid_until: _v,
        customer_signed_name: _sn, customer_comment: _cc, customer_responded_at: _cr, declined_at: _da, decline_reason: _dr, ...copy } = doc;
      const { data: so, error } = await sb.from("sales_orders").insert({
        ...copy, tenant_id: tenantId, quote_number: num, status: "accepted", accepted_at: new Date().toISOString(),
        quote_id: doc.id, reference: doc.quote_number, issue_date: new Date().toISOString().slice(0, 10),
      }).select("id").single();
      if (error) throw error;
      await sb.from("quotes").update({ status: "accepted", accepted_at: doc.accepted_at || new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", doc.id);
      refresh();
      toast({ title: `Sales order ${num} created from ${number}` });
      navigate(`/sales/orders/${so.id}`);
    } catch (e: any) {
      toast({ title: "Could not convert", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };


  const remove = async () => {
    if (kind === "invoice" && Number(doc.amount_paid || 0) > 0) return toast({ title: "This invoice has payments", description: "Delete or void its payments first, or void the invoice.", variant: "destructive" });
    if (!(await confirmAction({ title: `Delete ${cfg.single.toLowerCase()} ${number}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from(cfg.table).delete().eq("id", doc.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    refresh();
    toast({ title: `${cfg.single} deleted` });
    onClose();
  };

  const whatsapp = () => {
    shareOnWhatsApp(doc.customer_phone, docSummary(`${shop}\n${cfg.single}`, number, Number(doc.total || 0), ccy,
      kind === "invoice" ? `${doc.due_date ? `Due ${fmtDate(doc.due_date)}\n` : ""}Balance due: ${ccy} ${balance.toFixed(2)}${payable && payLink ? `\nPay now: ${payLink}` : ""}` : doc.valid_until ? `Valid until ${fmtDate(doc.valid_until)}` : ""));
    if (doc.status === "draft") void update({ status: "sent", sent_at: new Date().toISOString() }, `${cfg.single} marked as sent`);
  };

  const nextStep = kind !== "invoice"
    ? status === "draft" ? "Send this quotation to your customer, or mark it as sent." : status === "sent" ? "When the customer agrees, mark it accepted and convert it to an invoice." : status === "accepted" ? "Convert this quotation to an invoice to bill the customer." : null
    : status === "draft" ? "Send this invoice to your customer, or mark it as sent." : ["sent", "overdue", "partially_paid"].includes(status) ? "Record a payment when the customer pays." : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30 max-sm:overflow-y-auto">
      {shareOpen && <ShareLinkModal kind={kind as any} id={doc.id} title={`${cfg.single} ${number}`} phone={doc.customer_phone} email={doc.customer_email} onClose={() => setShareOpen(false)} />}
      {recurOpen && <MakeRecurringModal kind="invoice" id={doc.id} onClose={() => { setRecurOpen(false); refresh(); }} />}
      {journalOpen && <ViewJournalModal sourceType="invoice" sourceId={doc.id} title={String(number)} onClose={() => setJournalOpen(false)} />}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <p className="text-xs text-muted-foreground">{doc.customer_name}</p>
          <h2 className="truncate font-display text-xl font-bold">{number}</h2>
        </div>
        {can(res, "edit") && <Button size="sm" variant="outline" onClick={() => navigate(`${cfg.base}/${doc.id}/edit`)} disabled={doc.status === "void"}><Pencil /> Edit</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={sendBlocked} title={sig.blocked ? "Sign it first" : undefined}><Send /> Send <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setMail(true)}><Mail /> Send email</DropdownMenuItem>
            <DropdownMenuItem onSelect={whatsapp}><MessageCircle /> Send on WhatsApp</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShareOpen(true)}><Link2 /> Share link</DropdownMenuItem>
            {payable && <DropdownMenuItem onSelect={copyPayLink}><CreditCard /> Copy payment link</DropdownMenuItem>}
            {doc.status === "draft" && <DropdownMenuItem onSelect={() => update({ status: "sent", sent_at: new Date().toISOString() }, `${cfg.single} marked as sent`)}><CheckCircle2 /> Mark as sent</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        {kind === "quote" && !["invoiced", "declined"].includes(doc.status) && (
          <Button size="sm" variant="outline" onClick={convertToOrder} disabled={busy}><ClipboardCheck /> Convert to Sales Order</Button>
        )}
        {kind !== "invoice" && !["invoiced", "declined"].includes(doc.status) && (
          <Button size="sm" onClick={convertToInvoice} disabled={busy}>{busy ? <OrbSpinner state="working" /> : <FileCheck2 />} Convert to Invoice</Button>
        )}
        {kind === "invoice" && !["draft", "void"].includes(doc.status) && (
          <Button size="sm" variant="outline" className="max-sm:hidden" onClick={() => navigate(`/sales/credit-notes/new?invoice=${doc.id}`)}><FileText /> Credit note</Button>
        )}
        {kind === "invoice" && !["draft", "void"].includes(doc.status) && <EtimsPush kind="invoice" doc={doc} onDone={refresh} />}
        {kind !== "invoice" && doc.invoice_id && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/sales/invoices/${doc.invoice_id}`)}><Receipt /> View invoice</Button>
        )}
        {kind === "invoice" && !["paid", "void", "draft"].includes(doc.status) && balance > 0 && !blocked && (
          <>
            <Button size="sm" variant="outline" className="max-sm:hidden" onClick={copyPayLink} title="A page where the customer sees this invoice and pays it"><CreditCard /> Copy payment link</Button>
            <Button size="sm" variant="outline" className="max-sm:hidden" onClick={() => setPrompt(true)}><Smartphone /> M-Pesa prompt</Button>
            <Button size="sm" onClick={() => setPaying(true)}><Wallet /> Record Payment</Button>
          </>
        )}
        {(approval === "rejected" || (approvalRule.needs(Number(doc.total)) && (!approval || approval === "not_required") && doc.status === "draft")) && (
          <Button size="sm" variant="outline" onClick={async () => { try { await submitForApproval(kind, doc.id, number, `${doc.customer_name}`, Number(doc.total)); refresh(); toast({ title: "Sent for approval" }); } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); } }}><CheckSquare /> Submit for approval</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 gap-1.5 px-3 font-semibold" aria-label="More actions"><MoreHorizontal className="!h-5 !w-5" /> More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>More</DropdownMenuLabel>
            {kind !== "invoice" && doc.status !== "accepted" && doc.status !== "invoiced" && <DropdownMenuItem onSelect={() => update({ status: "accepted", accepted_at: new Date().toISOString() }, "Marked as accepted")}><CheckCircle2 /> Mark as accepted</DropdownMenuItem>}
            {kind !== "invoice" && doc.status !== "declined" && doc.status !== "invoiced" && <DropdownMenuItem onSelect={() => update({ status: "declined" }, "Marked as declined")}><XCircle /> Mark as declined</DropdownMenuItem>}
            {kind === "invoice" && doc.status === "draft" && !sig.blocked && <DropdownMenuItem onSelect={() => update({ status: "sent", sent_at: new Date().toISOString() }, "Marked as sent")}><CheckCircle2 /> Mark as sent</DropdownMenuItem>}
            {kind === "invoice" && can("invoices", "void") && doc.status !== "void" && Number(doc.amount_paid || 0) === 0 && <DropdownMenuItem onSelect={async () => { if (await confirmAction({ title: `Void ${number}?`, message: "A void invoice stays on record but is no longer owed.", confirmLabel: "Void", danger: true })) void update({ status: "void" }, "Invoice voided"); }}><Ban /> Void</DropdownMenuItem>}
            {kind === "invoice" && !doc.is_recurring && doc.status !== "void" && <DropdownMenuItem onSelect={() => setRecurOpen(true)}><Repeat /> Make Recurring</DropdownMenuItem>}
            {kind === "invoice" && doc.status !== "void" && <DropdownMenuItem onSelect={() => navigate(`/sales/credit-notes/new?invoice=${doc.id}`)}><FileText /> Create Credit Note</DropdownMenuItem>}
            {kind === "invoice" && !["paid", "void", "draft"].includes(doc.status) && balance > 0 && !blocked && <DropdownMenuItem className="sm:hidden" onSelect={() => setPrompt(true)}><Smartphone /> M-Pesa prompt</DropdownMenuItem>}
            <DropdownMenuItem onSelect={clone}><Copy /> Clone</DropdownMenuItem>
            {kind === "invoice" && <DropdownMenuItem onSelect={() => setJournalOpen(true)}><BookOpenCheck /> View Journal</DropdownMenuItem>}
            {kind === "invoice" && doc.status !== "void" && doc.status !== "draft" && <DropdownMenuItem onSelect={turnOffPayLink}><Link2Off /> Turn off payment link</DropdownMenuItem>}
            <DropdownMenuSeparator />
            {can(res, "delete") && <DropdownMenuItem danger onSelect={remove}><Trash2 /> Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 max-sm:flex-none max-sm:overflow-visible sm:p-5">
        <SignBanner sig={sig} number={number || null} title={`${cfg.single} ${number || ""} · ${doc.customer_name || ""}`} amount={Number(doc.total || 0)} />
        {nextStep && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            <span className="font-semibold text-primary">What's next?</span>
            <span className="text-muted-foreground">{nextStep}</span>
          </div>
        )}
        {kind === "quote" && doc.customer_signed_name && <div className="mb-4 rounded-2xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm"><p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Accepted online by {doc.customer_signed_name}{doc.customer_responded_at ? ` on ${fmtDate(doc.customer_responded_at)}` : ""}</p>{doc.customer_comment && <p className="mt-1 text-muted-foreground">“{doc.customer_comment}”</p>}</div>}
        {kind === "quote" && doc.decline_reason && doc.status === "declined" && <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm"><p className="flex items-center gap-2 font-semibold text-destructive"><XCircle className="h-4 w-4" /> Declined online{doc.declined_at ? ` on ${fmtDate(doc.declined_at)}` : ""}</p><p className="mt-1 text-muted-foreground">Reason: {doc.decline_reason}</p></div>}
        {approval === "pending" && <div className="mb-4 flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"><CheckSquare className="h-4 w-4 text-warning" /> Waiting for approval. It can be sent once it is approved. <Link to="/approvals" className="ml-auto font-semibold text-primary">Approvals →</Link></div>}
        {approval === "rejected" && <div className="mb-4 flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"><XCircle className="h-4 w-4 text-destructive" /> Rejected. Edit it and submit for approval again.</div>}
        {approval === "approved" && <div className="mb-4 flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Approved</div>}
        {doc.etims_status === "signed" && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> {doc.etims_rcpt_no ? <>Signed with KRA eTIMS · receipt {doc.etims_rcpt_no}</> : doc.source === "import" ? <>Reported to KRA eTIMS in the previous system</> : <>Signed with KRA eTIMS</>}{doc.etims_signature && <span className="font-mono text-xs opacity-80">· {doc.etims_signature}</span>}{doc.etims_qr_url && <a href={doc.etims_qr_url} target="_blank" rel="noopener noreferrer" className="ml-auto font-semibold underline">Verify on KRA</a>}</div>}
        {doc.etims_status === "failed" && <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">KRA eTIMS did not sign this invoice: {doc.etims_error}</div>}
        {kind === "invoice" && <InvoicePayments invoiceId={doc.id} />}
        {kind === "invoice" && doc.status !== "void" && (
          <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-card p-1 shadow-sm sm:w-fit">
            {([["doc", "Invoice"], ["packing_list", "Packing list"], ["delivery_note", "Delivery note"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setPaper(v)} className={cn("shrink-0 rounded-lg px-4 py-1.5 text-sm", paper === v ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{l}</button>
            ))}
          </div>
        )}
        <DocumentPreview kind={(paper === "doc" ? kind : paper) as any} id={doc.id} version={doc.updated_at} />
        <div className="mt-4"><DocumentsPanel entityType={kind} entityId={doc.id} entityName={String(number || "")} /></div>
      </div>

      {mail && (
        <EmailDocModal
          kind={kind} doc={doc} number={number} shop={shop}
          onClose={() => setMail(false)}
          onSent={() => { setMail(false); if (doc.status === "draft") void update({ status: "sent", sent_at: new Date().toISOString() }, `${cfg.single} sent`); }}
        />
      )}
      {prompt && <MpesaPromptModal invoice={doc} balance={balance} onClose={() => setPrompt(false)} onDone={() => { setPrompt(false); refresh(); }} />}
      {paying && (
        <RecordPaymentModal
          customer={{ id: doc.customer_id, name: doc.customer_name }}
          invoice={{ id: doc.id, number, balance }}
          onClose={() => setPaying(false)}
          onSaved={() => { setPaying(false); refresh(); }}
        />
      )}
    </div>
  );
}

function InvoicePayments({ invoiceId }: { invoiceId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["doc-payments", invoiceId],
    queryFn: async () => (await sb.from("payment_allocations").select("id, amount, created_at, payments_received(id, payment_number, payment_date, method, reference)").eq("invoice_id", invoiceId).order("created_at")).data || [],
  });
  if (!data.length) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Payments Received <span className="ml-1 rounded-full bg-primary/10 px-2 text-xs text-primary">{data.length}</span></p>
      <table className="w-full text-sm">
        <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Payment#</th><th className="px-4 py-2 text-left">Mode</th><th className="px-4 py-2 text-left">Reference</th><th className="px-4 py-2 text-right">Amount</th></tr></thead>
        <tbody>
          <PagedRows rows={data} colSpan={5}>{(pageRows) => pageRows.map((a: any) => (
            <tr key={a.id} className="border-t border-border">
              <td className="px-4 py-2">{fmtDate(a.payments_received?.payment_date)}</td>
              <td className="px-4 py-2"><Link to={`/sales/payments/${a.payments_received?.id}`} className="font-medium text-primary">{a.payments_received?.payment_number}</Link></td>
              <td className="px-4 py-2 capitalize">{String(a.payments_received?.method || "").replace(/_/g, " ")}</td>
              <td className="px-4 py-2 text-muted-foreground">{a.payments_received?.reference || ""}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatKES(Number(a.amount))}</td>
            </tr>
          ))}</PagedRows>
        </tbody>
      </table>
    </div>
  );
}

function EmailDocModal({ kind, doc, number, shop, onClose, onSent }: { kind: SalesKind; doc: any; number: string; shop: string; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const single = CFG[kind].single;
  const ccy = currencyCode() || "KES";
  const [to, setTo] = useState(doc.customer_email || "");
  const [subject, setSubject] = useState(`${single} ${number} from ${shop}`);
  const [message, setMessage] = useState(
    kind !== "invoice"
      ? `Dear ${doc.customer_name || "Customer"},\n\nThank you for your interest. Please find attached quotation ${number} for ${ccy} ${Number(doc.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}${doc.valid_until ? `, valid until ${fmtDate(doc.valid_until)}` : ""}.\n\nWe look forward to doing business with you.\n\nRegards,\n${shop}`
      : `Dear ${doc.customer_name || "Customer"},\n\nPlease find attached invoice ${number} for ${ccy} ${Number(doc.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}${doc.due_date ? `, due on ${fmtDate(doc.due_date)}` : ""}.\n\nThank you for your business.\n\nRegards,\n${shop}`,
  );
  const [busy, setBusy] = useState(false);
  // Invoices with something to pay carry their "Pay now" link (a draft's link works once it is sent).
  useEffect(() => {
    if (kind !== "invoice" || doc.status === "void" || Number(doc.total || 0) - Number(doc.amount_paid || 0) <= 0) return;
    let live = true;
    void getPayLink(doc.id).then((url) => {
      if (!live) return;
      const line = `Pay online: ${url}`;
      const thanks = "\n\nThank you for your business.";
      setMessage((m) => (m.includes(url) ? m : m.includes(thanks) ? m.replace(thanks, `\n\n${line}${thanks}`) : `${m}\n\n${line}`));
    }, () => { /* no link: the email goes without it */ });
    return () => { live = false; };
  }, [kind, doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    const list = to.split(/[,;\s]+/).map((s: string) => s.trim()).filter(Boolean);
    if (!list.length) return toast({ title: "Enter the customer's email", variant: "destructive" });
    setBusy(true);
    try {
      await emailDocument({ kind, id: doc.id, to: list, subject, message });
      toast({ title: `${single} emailed to ${list.join(", ")}` });
      onSent();
    } catch (e: any) {
      toast({ title: "Email not sent", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Email ${single} ${number}`} icon={Mail} size="lg" locked={busy}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={send} disabled={busy}>{busy ? <OrbSpinner state="connecting" /> : <Send />} Send</Button></>}>
      <div className="space-y-3">
        <Field label="To" required hint="Separate several addresses with commas"><input className="fi" value={to} onChange={(e) => setTo(e.target.value)} type="text" /></Field>
        <Field label="Subject" required><input className="fi" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="fi min-h-[180px]" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><FileText className="h-4 w-4" /> {number}.pdf is attached.</p>
      </div>
    </Modal>
  );
}


/** Sends the customer an M-Pesa prompt for this invoice and waits for the answer. */
function MpesaPromptModal({ invoice, balance, onClose, onDone }: { invoice: any; balance: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(invoice.customer_phone || "");
  const [amount, setAmount] = useState(String(Math.floor(balance)));
  const [state, setState] = useState<"" | "sending" | "waiting" | "done" | "failed">("");
  const [msg, setMsg] = useState("");
  const send = async () => {
    setState("sending"); setMsg("");
    try {
      const r = await erpApi<any>("invoice/mpesa", { invoice_id: invoice.id, phone, amount: Number(amount) });
      setState("waiting");
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const st = await erpApi<any>("invoice/mpesa-status", { request_id: r.request_id });
        if (st.status === "completed") { setState("done"); setMsg(`Paid · ${st.mpesa_receipt}`); toast({ title: "Payment received", description: st.mpesa_receipt }); onDone(); return; }
        if (["failed", "cancelled"].includes(st.status)) { setState("failed"); setMsg(st.status === "cancelled" ? "The customer cancelled the prompt." : "The payment did not go through."); return; }
      }
      setState("failed"); setMsg("No answer yet. The payment is recorded automatically if the customer completes it.");
    } catch (e: any) { setState("failed"); setMsg(e.message); }
  };
  return (
    <Modal open onClose={onClose} title="M-Pesa prompt" description={`${invoice.invoice_number} · balance ${formatKES(balance)}`} icon={Smartphone}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={send} disabled={state === "sending" || state === "waiting"}>{(state === "sending" || state === "waiting") && <OrbSpinner state="working" />} {state === "waiting" ? "Waiting for the customer…" : "Send prompt"}</Button></>}>
      <div className="space-y-3">
        <Field label="Customer's M-Pesa number"><input className="fi" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" /></Field>
        <Field label="Amount (KES)"><input className="fi" type="number" min={1} max={Math.floor(balance)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">The customer gets a prompt on their phone. When they enter their PIN the payment is recorded against this invoice automatically.</p>
        {msg && <p className={cn("rounded-xl px-3 py-2 text-sm", state === "done" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{msg}</p>}
      </div>
    </Modal>
  );
}
