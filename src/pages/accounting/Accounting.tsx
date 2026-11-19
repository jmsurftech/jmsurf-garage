import { useEffect, useMemo, useRef, useState } from "react";
import { useSelection, BulkBar, TickAllCell, TickCell, downloadCsv } from "@/components/Bulk";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Landmark, BookText, Plus, Trash2, Scale, PieChart, Lock, Upload, Ban, Check, ArrowLeft, Download, RefreshCw, Wallet, FileSpreadsheet, Printer, Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Modal, Field, Pill, Segmented, EmptyState, StatTile, StatGrid, PageLoader } from "@/components/kit";
import { Picker } from "@/apps/fields";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney } from "@/lib/format";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BankRuleForm, BankRulesModal, blankRule, type RuleDraft } from "./BankRules";
import { TagPickers, cleanTags, missingTag, useModuleTags, useReportingTags, type TagValues } from "@/lib/reportingTags";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const money = (n: number) => formatMoney(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export const TYPE_LABEL: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const SUB_TYPES: Record<string, [string, string][]> = {
  asset: [["cash", "Cash"], ["bank", "Bank"], ["accounts_receivable", "Accounts receivable"], ["inventory", "Stock"], ["other_current_asset", "Other current asset"], ["fixed_asset", "Fixed asset"], ["other_asset", "Other asset"]],
  liability: [["accounts_payable", "Accounts payable"], ["credit_card", "Credit card"], ["other_current_liability", "Other current liability"], ["long_term_liability", "Long-term liability"]],
  equity: [["equity", "Equity"]],
  income: [["income", "Income"], ["other_income", "Other income"]],
  expense: [["expense", "Expense"], ["cost_of_goods_sold", "Cost of goods sold"], ["other_expense", "Other expense"]],
};
const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice", payment_received: "Payment received", credit_note: "Credit note", bill: "Bill", payment_made: "Payment made",
  vendor_credit: "Vendor credit", expense: "Expense", sale: "POS sale", manual: "Manual journal", opening: "Opening balance", bank_line: "Bank",
};

export interface Account { id: string; code: string | null; name: string; type: string; sub_type: string; system_key: string | null; is_active: boolean; description: string | null; bank_name: string | null; account_number: string | null }
interface Balance { account_id: string; code: string | null; name: string; type: string; sub_type: string; opening: number; debit: number; credit: number; closing: number }

export function useAccounts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["coa", tenantId], enabled: !!tenantId,
    queryFn: async (): Promise<Account[]> => (await sb.from("chart_of_accounts").select("*").order("code", { nullsFirst: false }).order("name")).data || [],
  });
}
function useBalances(from: string, to: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["acc-balances", tenantId, from, to], enabled: !!tenantId,
    queryFn: async (): Promise<Balance[]> => {
      const { data, error } = await sb.rpc("acc_balances", { p_from: from, p_to: to });
      if (error) throw error;
      return (data || []).map((r: any) => ({ ...r, opening: Number(r.opening), debit: Number(r.debit), credit: Number(r.credit), closing: Number(r.closing) }));
    },
  });
}
/** Natural sign: assets/expenses debit-positive, the rest credit-positive. */
const natural = (type: string, v: number) => (type === "asset" || type === "expense" ? v : -v);
const accountOptions = (list: Account[]) => list.filter((a) => a.is_active).map((a) => ({ id: a.id, label: `${a.code ? a.code + " · " : ""}${a.name}`, sub: TYPE_LABEL[a.type] }));

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const presets: [string, () => [string, string]][] = [
    ["This month", () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10), today()]; }],
    ["This year", () => [yearStart(), today()]],
    ["Last year", () => { const y = new Date().getFullYear() - 1; return [`${y}-01-01`, `${y}-12-31`]; }],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="fi h-9 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
      <span className="text-muted-foreground">to</span>
      <input type="date" className="fi h-9 w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
      {presets.map(([l, f]) => <button key={l} onClick={() => { const [a, b] = f(); setFrom(a); setTo(b); }} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{l}</button>)}
    </div>
  );
}

/* ================================================================ chart of accounts */

export function ChartOfAccounts() {
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: bal = [] } = useBalances(yearStart(), today());
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [filter, setFilter] = useState("all");
  const nav = useNavigate();
  const byId = useMemo(() => new Map(bal.map((b) => [b.account_id, b])), [bal]);
  const list = accounts.filter((a) => filter === "all" || a.type === filter);
  return (
    <div className="space-y-5">
      <PageHeader title="Chart of Accounts" icon={Landmark} description="Every account in your books. Documents post to them automatically."
        actions={<button onClick={() => setEdit({ type: "expense", sub_type: "expense", is_active: true })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New account</button>} />
      <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l, count: accounts.filter((a) => a.type === v).length }))]} />
      {isLoading ? <PageLoader /> : (
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>
                <PagedRows rows={list} colSpan={5}>{(pageRows) => pageRows.map((a) => {
                  const b = byId.get(a.id);
                  return (
                    <tr key={a.id} className="cursor-pointer" onClick={() => nav(`/accounting/chart-of-accounts/${a.id}`)}>
                      <td data-label="Code" className="tabular-nums text-muted-foreground">{a.code || "—"}</td>
                      <td data-label="Account"><span className="font-medium">{a.name}</span>{a.system_key && <Pill className="ml-2">System</Pill>}{!a.is_active && <Pill tone="warning" className="ml-2">Inactive</Pill>}</td>
                      <td data-label="Type">{SUB_TYPES[a.type]?.find(([k]) => k === a.sub_type)?.[1] || TYPE_LABEL[a.type]}</td>
                      <td data-label="Balance" className="num font-medium">{money(natural(a.type, b?.closing || 0))}</td>
                      <td className="text-right"><button className="text-xs font-semibold text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setEdit(a); }}>Edit</button></td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {edit && <AccountForm account={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AccountForm({ account, onClose }: { account: Partial<Account>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Partial<Account>>(account);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name?.trim()) return toast.error("Enter the account name");
    setBusy(true);
    try {
      const row = { code: f.code || null, name: f.name.trim(), type: f.type, sub_type: f.sub_type, description: f.description || null, is_active: f.is_active !== false, bank_name: f.bank_name || null, account_number: f.account_number || null, updated_at: new Date().toISOString() };
      const { error } = f.id ? await sb.from("chart_of_accounts").update(row).eq("id", f.id) : await sb.from("chart_of_accounts").insert(row);
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["coa"] }); toast.success("Account saved"); onClose();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!(await confirmAction({ title: `Delete ${f.name}?`, message: "Only accounts with no transactions can be deleted. Mark it inactive instead to hide it.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("chart_of_accounts").delete().eq("id", f.id);
    if (error) return toast.error("This account has transactions. Mark it inactive instead.");
    void qc.invalidateQueries({ queryKey: ["coa"] }); onClose();
  };
  return (
    <Modal open onClose={onClose} title={f.id ? "Edit account" : "New account"} icon={Landmark}
      footer={<>{f.id && !f.system_key && <button onClick={del} className="mr-auto text-sm font-medium text-destructive">Delete</button>}<button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button disabled={busy} onClick={save} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Save</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account type">
          <select className="fi" value={f.type} disabled={!!f.system_key} onChange={(e) => setF({ ...f, type: e.target.value, sub_type: SUB_TYPES[e.target.value][0][0] })}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Detail type">
          <select className="fi" value={f.sub_type} disabled={!!f.system_key} onChange={(e) => setF({ ...f, sub_type: e.target.value })}>
            {(SUB_TYPES[f.type || "expense"] || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Account name" required className="sm:col-span-2"><input className="fi" value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><input className="fi" value={f.code || ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Status"><select className="fi" value={f.is_active === false ? "0" : "1"} onChange={(e) => setF({ ...f, is_active: e.target.value === "1" })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
        {(f.sub_type === "bank" || f.sub_type === "credit_card") && <>
          <Field label="Bank name"><input className="fi" value={f.bank_name || ""} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></Field>
          <Field label="Account number"><input className="fi" value={f.account_number || ""} onChange={(e) => setF({ ...f, account_number: e.target.value })} /></Field>
        </>}
        <Field label="Description" className="sm:col-span-2"><textarea className="fi" rows={2} value={f.description || ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** One account's transactions (general ledger). */
export function AccountLedger() {
  const { id = "" } = useParams();
  const { data: accounts = [] } = useAccounts();
  const acc = accounts.find((a) => a.id === id);
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["acc-ledger", id, from, to], enabled: !!id,
    queryFn: async () => (await sb.rpc("acc_ledger", { p_account: id, p_from: from, p_to: to })).data || [],
  });
  const { data: bal = [] } = useBalances(from, to);
  const b = bal.find((x) => x.account_id === id);
  const withBalance = useMemo(() => { let running = b?.opening || 0; return (rows as any[]).map((r) => { running += Number(r.debit) - Number(r.credit); return { ...r, running }; }); }, [rows, b?.opening]);
  return (
    <div className="space-y-5">
      <Link to="/accounting/chart-of-accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Chart of accounts</Link>
      <PageHeader title={acc ? `${acc.code ? acc.code + " · " : ""}${acc.name}` : "Account"} icon={Landmark} description={acc ? TYPE_LABEL[acc.type] : ""} />
      <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <StatGrid>
        <StatTile label="Opening" value={money(natural(acc?.type || "asset", b?.opening || 0))} tone="muted" />
        <StatTile label="Debits" value={money(b?.debit || 0)} tone="info" />
        <StatTile label="Credits" value={money(b?.credit || 0)} tone="warning" />
        <StatTile label="Closing" value={money(natural(acc?.type || "asset", b?.closing || 0))} tone="primary" />
      </StatGrid>
      {isLoading ? <PageLoader /> : (
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Date</th><th>Transaction</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <PagedRows rows={withBalance} colSpan={6} after={<>{!withBalance.length && <tr><td colSpan={6} className="text-center text-muted-foreground">No transactions in this period</td></tr>}</>}>{(pageRows) => pageRows.map((r, i) => {
                  return (
                    <tr key={i}>
                      <td data-label="Date">{r.line_date}</td>
                      <td data-label="Transaction">{SOURCE_LABEL[r.source_type] || r.source_type}{r.reference && <span className="ml-1 text-muted-foreground">{r.reference}</span>}</td>
                      <td data-label="Details" className="max-w-xs truncate">{r.description}</td>
                      <td data-label="Debit" className="num">{Number(r.debit) ? money(r.debit) : ""}</td>
                      <td data-label="Credit" className="num">{Number(r.credit) ? money(r.credit) : ""}</td>
                      <td data-label="Balance" className="num font-medium">{money(natural(acc?.type || "asset", r.running))}</td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ================================================================ manual journals */

interface JLine { account_id: string | null; description: string; debit: string; credit: string }

export function ManualJournals() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const journalTags = useModuleTags("journals");
  const [open, setOpen] = useState<{ id?: string; date: string; reference: string; notes: string; lines: JLine[]; tags: TagValues } | null>(null);
  const { data: journals = [], isLoading } = useQuery({
    queryKey: ["manual-journals", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("journals").select("*, journal_lines(*)").in("source_type", ["manual", "opening"]).order("journal_date", { ascending: false }).limit(500)).data || [],
  });
  const opts = accountOptions(accounts);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name || "Account";
  const blank = (): JLine => ({ account_id: null, description: "", debit: "", credit: "" });
  const dr = (open?.lines || []).reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const cr = (open?.lines || []).reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const save = async () => {
    if (!open) return;
    if (Math.abs(dr - cr) > 0.004 || dr === 0) return toast.error("Debits and credits must be equal and not zero.");
    const missingT = missingTag(journalTags, "journals", open.tags);
    if (missingT) return toast.error(`Choose ${missingT}`);
    const lines = open.lines.filter((l) => l.account_id && (Number(l.debit) || Number(l.credit))).map((l) => ({ account_id: l.account_id, description: l.description, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    const { data: jid, error } = await sb.rpc("acc_manual_journal", { p_id: open.id || null, p_date: open.date, p_reference: open.reference || null, p_notes: open.notes || null, p_lines: lines });
    if (error) return toast.error(friendlyError(error));
    // Posting rewrites the journal, so its tags are set again afterwards.
    if (jid && (journalTags.length || Object.keys(open.tags || {}).length)) {
      const { error: tErr } = await sb.rpc("acc_set_journal_tags", { p_source_id: jid, p_tags: cleanTags(open.tags) });
      if (tErr) toast.error(`Posted, but the tags were not saved: ${friendlyError(tErr)}`);
    }
    void qc.invalidateQueries({ queryKey: ["manual-journals"] }); void qc.invalidateQueries({ queryKey: ["acc-balances"] });
    toast.success("Journal posted"); setOpen(null);
  };
  const remove = async (j: any) => {
    if (!(await confirmAction({ title: "Delete this journal?", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.rpc("acc_delete_manual_journal", { p_id: j.source_id });
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["manual-journals"] });
  };
  const jsel = useSelection((journals as any[]).map((j) => j.id));
  const pickedJ = (journals as any[]).filter((j) => jsel.has(j.id));
  const deleteMany = async () => {
    const manual = pickedJ.filter((j) => j.source_type === "manual");
    if (!manual.length) return toast.error("Only manual journals can be deleted; the others belong to their documents.");
    if (!(await confirmAction({ title: `Delete ${manual.length} journal${manual.length === 1 ? "" : "s"}?`, danger: true, confirmLabel: "Delete" }))) return;
    for (const j of manual) await sb.rpc("acc_delete_manual_journal", { p_id: j.source_id });
    jsel.clear(); void qc.invalidateQueries({ queryKey: ["manual-journals"] }); toast.success("Journals deleted");
  };
  // "New Transaction → Journal" from a customer or vendor opens a blank journal.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("new") === "1") setOpen({ date: today(), reference: "", notes: "", lines: [blank(), blank()], tags: {} }); }, []);
  return (
    <div className="space-y-5">
      <PageHeader title="Manual Journals" icon={BookText} description="Adjustments, accruals, depreciation, payroll postings and corrections."
        actions={<button onClick={() => setOpen({ date: today(), reference: "", notes: "", lines: [blank(), blank()], tags: {} })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New journal</button>} />
      {isLoading ? <PageLoader /> : (journals as any[]).length === 0 ? <Panel><EmptyState icon={BookText} title="No manual journals yet" /></Panel> : (
        <Panel flush>
          <BulkBar sel={jsel} noun="journal">
            <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold" onClick={() => downloadCsv("journals.csv", ["Date", "Number", "Reference", "Notes", "Amount"], pickedJ.map((j) => [j.journal_date, j.journal_number, j.reference, j.notes, j.total]))}>Export</button>
            <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-destructive" onClick={() => void deleteMany()}>Delete</button>
          </BulkBar>
          <table className="dt">
            <thead><tr><TickAllCell sel={jsel} /><th>Date</th><th>Number</th><th>Reference</th><th>Notes</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              <PagedRows rows={(journals as any[])} colSpan={6}>{(pageRows) => pageRows.map((j) => (
                <tr key={j.id} className="cursor-pointer" onClick={() => j.source_type === "manual" && setOpen({ id: j.source_id, date: j.journal_date, reference: j.reference || "", notes: j.notes || "", tags: j.tags || {}, lines: (j.journal_lines || []).map((l: any) => ({ account_id: l.account_id, description: l.description || "", debit: Number(l.debit) ? String(l.debit) : "", credit: Number(l.credit) ? String(l.credit) : "" })) })}>
                  <TickCell sel={jsel} id={j.id} />
                  <td data-label="Date">{j.journal_date}</td>
                  <td data-label="Number">{j.journal_number || (j.source_type === "opening" ? "Opening balances" : "—")}</td>
                  <td data-label="Reference">{j.reference}</td>
                  <td data-label="Notes" className="max-w-xs truncate text-muted-foreground">{j.notes || (j.journal_lines || []).map((l: any) => name(l.account_id)).slice(0, 3).join(", ")}</td>
                  <td data-label="Amount" className="num font-medium">{money(j.total)}</td>
                  <td className="text-right">{j.source_type === "manual" && <button onClick={(e) => { e.stopPropagation(); void remove(j); }} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}</PagedRows>
            </tbody>
          </table>
        </Panel>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} size="2xl" title={open.id ? "Edit journal" : "New journal"} icon={BookText}
          footer={<><span className={cn("mr-auto text-sm font-semibold", Math.abs(dr - cr) < 0.005 && dr > 0 ? "text-success" : "text-destructive")}>Debits {money(dr)} · Credits {money(cr)}</span><button onClick={() => setOpen(null)} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button onClick={save} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Post journal</button></>}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date"><input type="date" className="fi" value={open.date} onChange={(e) => setOpen({ ...open, date: e.target.value })} /></Field>
              <Field label="Reference"><input className="fi" value={open.reference} onChange={(e) => setOpen({ ...open, reference: e.target.value })} /></Field>
              <Field label="Notes"><input className="fi" value={open.notes} onChange={(e) => setOpen({ ...open, notes: e.target.value })} /></Field>
            </div>
            <TagPickers module="journals" values={open.tags} onChange={(t) => setOpen({ ...open, tags: t })} className="grid gap-4 sm:grid-cols-3" />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="dt dt-keep min-w-[640px]">
                <thead><tr><th className="w-[38%]">Account</th><th>Description</th><th className="num w-32">Debit</th><th className="num w-32">Credit</th><th className="w-10" /></tr></thead>
                <tbody>
                  {open.lines.map((l, i) => {
                    const set = (k: keyof JLine, v: any) => setOpen({ ...open, lines: open.lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
                    return (
                      <tr key={i}>
                        <td className="!px-2 !py-1.5"><Picker value={l.account_id} onChange={(v) => set("account_id", v)} options={opts} placeholder="Choose account" /></td>
                        <td className="!px-2 !py-1.5"><input className="fi h-9" value={l.description} onChange={(e) => set("description", e.target.value)} /></td>
                        <td className="!px-2 !py-1.5"><input className="fi h-9 text-right" type="number" placeholder="0" value={l.debit} onChange={(e) => setOpen({ ...open, lines: open.lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x)) })} /></td>
                        <td className="!px-2 !py-1.5"><input className="fi h-9 text-right" type="number" placeholder="0" value={l.credit} onChange={(e) => setOpen({ ...open, lines: open.lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x)) })} /></td>
                        <td><button onClick={() => setOpen({ ...open, lines: open.lines.filter((_, j) => j !== i) })} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={() => setOpen({ ...open, lines: [...open.lines, blank()] })} className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary hover:bg-primary/5"><Plus className="h-4 w-4" /> Add line</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================ banking */

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function toDate(v: string) {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
const num = (v: string) => Number(String(v || "").replace(/[^0-9.-]/g, "")) || 0;

export function Banking() {
  const { id } = useParams();
  const { data: accounts = [] } = useAccounts();
  const { data: bal = [] } = useBalances(yearStart(), today());
  const nav = useNavigate();
  const banks = accounts.filter((a) => ["bank", "cash", "credit_card"].includes(a.sub_type) || a.system_key === "undeposited");
  const [rulesOpen, setRulesOpen] = useState(false);
  if (id) return <BankAccount account={accounts.find((a) => a.id === id)} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Banking" icon={Wallet} actions={<button onClick={() => setRulesOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Wand2 className="h-4 w-4" /> Rules</button>} />
      {rulesOpen && <BankRulesModal accountOptions={accountOptions(accounts)} bankOptions={accountOptions(banks)} onClose={() => setRulesOpen(false)} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {banks.map((a) => {
          const b = bal.find((x) => x.account_id === a.id);
          return (
            <button key={a.id} onClick={() => nav(`/accounting/banking/${a.id}`)} className="rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="truncate font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{a.bank_name || SUB_TYPES.asset.find(([k]) => k === a.sub_type)?.[1]}{a.account_number ? ` · ${a.account_number}` : ""}</p></div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Balance in books</p>
              <p className="font-display text-2xl font-bold tabular-nums">{money(b?.closing || 0)}</p>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Add another bank or card under <Link to="/accounting/chart-of-accounts" className="font-semibold text-primary">Chart of Accounts</Link> (type Assets → Bank).</p>
    </div>
  );
}

function BankAccount({ account }: { account?: Account }) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { data: accounts = [] } = useAccounts();
  const [tab, setTab] = useState("uncategorized");
  const [importing, setImporting] = useState<string[][] | null>(null);
  const [map, setMap] = useState({ date: 0, description: 1, amount: 2, debit: -1, credit: -1 });
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: lines = [] } = useQuery({
    queryKey: ["bank-lines", account?.id, tab], enabled: !!account,
    queryFn: async () => (await sb.from("bank_transactions").select("*").eq("account_id", account!.id).eq("status", tab).order("txn_date", { ascending: false }).limit(1000)).data || [],
  });
  const { data: matches = [] } = useQuery({
    queryKey: ["bank-rule-matches", account?.id, tab], enabled: !!account && tab === "uncategorized",
    queryFn: async () => ((await sb.rpc("bank_rule_matches", { p_bank: account!.id })).data || []) as { line_id: string; rule_id: string; rule_name: string; action: string; account_id: string | null }[],
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const opts = accountOptions(accounts.filter((a) => a.id !== account?.id));
  const bankOpts = accountOptions(accounts.filter((a) => ["bank", "cash", "credit_card"].includes(a.sub_type) || a.system_key === "undeposited"));
  const matchFor = useMemo(() => new Map(matches.map((m) => [m.line_id, m])), [matches]);
  if (!account) return <PageLoader />;
  const refreshLines = () => { void qc.invalidateQueries({ queryKey: ["bank-lines"] }); void qc.invalidateQueries({ queryKey: ["bank-rule-matches"] }); void qc.invalidateQueries({ queryKey: ["bank-rules"] }); void qc.invalidateQueries({ queryKey: ["acc-balances"] }); };
  /** Posts what the rules fit: one line, every line, or (after an import) only rules set to post by themselves. */
  const applyRules = async (opts: { line?: string; autoOnly?: boolean } = {}) => {
    const { data, error } = await sb.rpc("bank_rules_apply", { p_bank: account.id, p_auto_only: !!opts.autoOnly, p_line: opts.line ?? null });
    if (error) { toast.error(friendlyError(error)); return null; }
    refreshLines();
    return data as { applied: number; skipped: number };
  };
  const applyAll = async () => {
    const r = await applyRules();
    if (!r) return;
    if (r.skipped) toast.warning(`${r.applied} posted. ${r.skipped} could not post and stay to categorise by hand.`);
    else toast.success(`${r.applied} lines posted`);
  };
  const onFile = async (f: File) => { const rows = parseCsv(await f.text()); if (rows.length < 2) return toast.error("The file has no rows"); setImporting(rows); };
  const doImport = async () => {
    if (!importing) return;
    const body = importing.slice(1).map((r) => {
      const amount = map.amount >= 0 ? num(r[map.amount]) : num(r[map.credit] || "0") - num(r[map.debit] || "0");
      return { tenant_id: tenantId, account_id: account.id, txn_date: toDate(r[map.date] || ""), description: (r[map.description] || "").slice(0, 300), amount, import_batch: new Date().toISOString() };
    }).filter((x) => x.txn_date && x.amount);
    if (!body.length) return toast.error("No rows with a date and amount");
    const { error } = await sb.from("bank_transactions").insert(body);
    if (error) return toast.error(friendlyError(error));
    setImporting(null);
    const auto = await applyRules({ autoOnly: true });
    toast.success(`${body.length} statement lines imported${auto?.applied ? `, ${auto.applied} posted by your rules` : ""}`);
    refreshLines();
  };
  const categorize = async (lineId: string, acc: string | null, exclude = false) => {
    const { error } = await sb.rpc("acc_categorize_bank_line", { p_line: lineId, p_account: acc, p_exclude: exclude });
    if (error) return toast.error(friendlyError(error));
    refreshLines();
  };
  return (
    <div className="space-y-5">
      <Link to="/accounting/banking" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Banking</Link>
      <PageHeader title={account.name} icon={Landmark}
        actions={<>
          {matches.length > 0 && <button onClick={() => void applyAll()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Wand2 className="h-4 w-4" /> Apply rules ({matches.length})</button>}
          <button onClick={() => setRulesOpen(true)} className="rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Rules</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Upload className="h-4 w-4" /> Import statement</button>
          <Link to={`/accounting/chart-of-accounts/${account.id}`} className="rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Account ledger</Link>
        </>} />
      <Segmented value={tab} onChange={setTab} options={[{ value: "uncategorized", label: "To categorise" }, { value: "categorized", label: "Categorised" }, { value: "excluded", label: "Excluded" }]} />
      <Panel flush>
        <table className="dt">
          <thead><tr><th>Date</th><th>Description</th><th className="num">In</th><th className="num">Out</th><th>{tab === "uncategorized" ? "Categorise as" : "Account"}</th><th /></tr></thead>
          <tbody>
            <PagedRows rows={(lines as any[])} colSpan={6} after={<>{!(lines as any[]).length && <tr><td colSpan={6} className="text-center text-muted-foreground">Nothing here</td></tr>}</>}>{(pageRows) => pageRows.map((l) => { const m = matchFor.get(l.id); return (
              <tr key={l.id}>
                <td data-label="Date">{l.txn_date}</td>
                <td data-label="Description" className="max-w-sm truncate">{l.description}</td>
                <td data-label="In" className="num text-success">{l.amount > 0 ? money(l.amount) : ""}</td>
                <td data-label="Out" className="num">{l.amount < 0 ? money(-l.amount) : ""}</td>
                <td data-label="Account" className="min-w-[220px]">
                  {tab === "uncategorized"
                    ? (m?.action === "exclude"
                      ? <span className="text-muted-foreground">Exclude ({m.rule_name})</span>
                      : <Picker value={m?.account_id ?? null} onChange={(v) => v && void categorize(l.id, v)} options={opts} placeholder="Choose account…" />)
                    : accounts.find((a) => a.id === l.category_account_id)?.name || "—"}
                </td>
                <td className="text-right">
                  {tab === "uncategorized" ? <span className="inline-flex gap-0.5">
                    {m && <button title={`Apply rule: ${m.rule_name}`} onClick={() => void applyRules({ line: l.id })} className="icon-btn text-success"><Check className="h-4 w-4" /></button>}
                    <button title="Make a rule from this line" onClick={() => setRuleDraft({ ...blankRule(String(l.description || "").split(/\s+/).slice(0, 2).join(" ")), direction: l.amount > 0 ? "in" : "out" })} className="icon-btn"><Wand2 className="h-4 w-4" /></button>
                    <button title="Exclude" onClick={() => void categorize(l.id, null, true)} className="icon-btn"><Ban className="h-4 w-4" /></button>
                  </span>
                    : <button title="Undo" onClick={() => void sb.rpc("acc_uncategorize_bank_line", { p_line: l.id }).then(refreshLines)} className="icon-btn"><RefreshCw className="h-4 w-4" /></button>}
                </td>
              </tr>
            ); })}</PagedRows>
          </tbody>
        </table>
      </Panel>
      {rulesOpen && <BankRulesModal accountOptions={opts} bankOptions={bankOpts} onClose={() => setRulesOpen(false)} />}
      {ruleDraft && <BankRuleForm rule={ruleDraft} accountOptions={opts} bankOptions={bankOpts} onClose={() => setRuleDraft(null)} onSaved={() => setRuleDraft(null)} />}
      {importing && (
        <Modal open onClose={() => setImporting(null)} size="xl" title="Map the statement columns" icon={FileSpreadsheet}
          footer={<><button onClick={() => setImporting(null)} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button onClick={doImport} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Import {importing.length - 1} lines</button></>}>
          <div className="grid gap-3 sm:grid-cols-5">
            {(["date", "description", "amount", "debit", "credit"] as const).map((k) => (
              <Field key={k} label={k === "amount" ? "Amount (+in / -out)" : k === "debit" ? "Money out column" : k === "credit" ? "Money in column" : k[0].toUpperCase() + k.slice(1)}>
                <select className="fi" value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })}>
                  <option value={-1}>—</option>
                  {importing[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Use either one Amount column, or separate money in / money out columns (set Amount to —).</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="dt dt-keep text-xs"><tbody>{importing.slice(0, 6).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================ statements */

/** acc_tag_balances: income and expense movement per account and tag value. */
type TagBalance = { account_id: string; code: string | null; name: string; type: string; sub_type: string; tag_value: string | null; debit: number; credit: number };
function byAccount(list: TagBalance[]): Balance[] {
  const m = new Map<string, Balance>();
  for (const r of list) {
    const b = m.get(r.account_id) || { account_id: r.account_id, code: r.code, name: r.name, type: r.type, sub_type: r.sub_type, opening: 0, debit: 0, credit: 0, closing: 0 };
    b.debit += r.debit; b.credit += r.credit;
    m.set(r.account_id, b);
  }
  return [...m.values()];
}

/** Profit and loss with one column per value of a reporting tag (plus not tagged and the total). */
function TagPnl({ rows, tagName, options, from, to }: { rows: TagBalance[]; tagName: string; options: string[]; from: string; to: string }) {
  const seen = [...new Set(rows.map((r) => r.tag_value || ""))];
  const cols = [...options.filter((o) => seen.includes(o)), ...seen.filter((v) => v && !options.includes(v)), ...(seen.includes("") ? [""] : [])];
  const accounts = [...new Map(rows.map((r) => [r.account_id, r])).values()].sort((a, b) => String(a.code || "~").localeCompare(String(b.code || "~")) || a.name.localeCompare(b.name));
  const amt = (accId: string | null, v: string | null, pick: (r: TagBalance) => boolean = () => true) =>
    rows.filter((r) => (accId === null || r.account_id === accId) && (v === null || (r.tag_value || "") === v) && pick(r))
      .reduce((a, r) => a + (r.type === "income" ? r.credit - r.debit : r.debit - r.credit), 0);
  const isInc = (r: TagBalance) => r.type === "income";
  const isCogs = (r: TagBalance) => r.type === "expense" && r.sub_type === "cost_of_goods_sold";
  const isExp = (r: TagBalance) => r.type === "expense" && r.sub_type !== "cost_of_goods_sold";
  const values: (string | null)[] = [...cols, null];
  const section = (title: string, pick: (r: TagBalance) => boolean) => <>
    <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={values.length + 1}>{title}</td></tr>
    {accounts.filter(pick).map((a) => (
      <tr key={a.account_id}><td className="pl-8">{a.name}</td>{values.map((v) => <td key={v ?? "total"} className={cn("num", v === null && "font-semibold")}>{money(amt(a.account_id, v))}</td>)}</tr>
    ))}
  </>;
  const totalRow = (label: string, f: (v: string | null) => number) => (
    <tr className="bg-muted/40 font-semibold"><td>{label}</td>{values.map((v) => <td key={v ?? "total"} className="num">{money(f(v))}</td>)}</tr>
  );
  if (!rows.length) return <Panel><EmptyState icon={PieChart} title="Nothing posted in this period" /></Panel>;
  return (
    <Panel flush title={`Profit and loss by ${tagName} · ${from} to ${to}`}>
      <div className="overflow-x-auto">
        <table className="dt dt-keep min-w-[560px]">
          <thead><tr><th>Account</th>{values.map((v) => <th key={v ?? "total"} className="num">{v === null ? "Total" : v || "Not tagged"}</th>)}</tr></thead>
          <tbody>
            {section("Operating income", isInc)}
            {totalRow("Total income", (v) => amt(null, v, isInc))}
            {section("Cost of goods sold", isCogs)}
            {totalRow("Gross profit", (v) => amt(null, v, isInc) - amt(null, v, isCogs))}
            {section("Operating expenses", isExp)}
            {totalRow("Total expenses", (v) => amt(null, v, isExp))}
            {totalRow("Net profit / (loss)", (v) => amt(null, v, isInc) - amt(null, v, isCogs) - amt(null, v, isExp))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function FinancialStatements() {
  const [view, setView] = useState("pl");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data: bal = [], isLoading } = useBalances(from, to);
  // Reporting tags: the profit and loss for one tag value, or side by side for every value.
  const tenantId = useTenantId();
  const { data: allTags = [] } = useReportingTags();
  const tagList = allTags.filter((t) => t.is_active);
  const [tagId, setTagId] = useState("");
  const [tagValue, setTagValue] = useState("__all");
  const tag = tagList.find((t) => t.id === tagId);
  const { data: tagRows = [], isLoading: tagLoading } = useQuery({
    queryKey: ["acc-tag-balances", tenantId, from, to, tagId, tagValue], enabled: !!tenantId && !!tagId && view === "pl",
    queryFn: async (): Promise<TagBalance[]> => {
      const { data, error } = await sb.rpc("acc_tag_balances", { p_from: from, p_to: to, p_tag: tagId, p_value: tagValue === "__all" ? null : tagValue === "__none" ? "" : tagValue });
      if (error) throw error;
      return (data || []).map((r: any) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
    },
  });
  const plSource: Balance[] = tagId && tagValue !== "__all" ? byAccount(tagRows) : bal;
  const period = (b: Balance) => b.debit - b.credit;
  const sum = (rows: Balance[], f: (b: Balance) => number) => rows.reduce((a, b) => a + f(b), 0);
  const inc = plSource.filter((b) => b.type === "income");
  const cogs = plSource.filter((b) => b.type === "expense" && b.sub_type === "cost_of_goods_sold");
  const exp = plSource.filter((b) => b.type === "expense" && b.sub_type !== "cost_of_goods_sold");
  const income = -sum(inc, period), costs = sum(cogs, period), expenses = sum(exp, period);
  const gross = income - costs, net = gross - expenses;
  // Balance sheet at "to": retained earnings = all income/expense up to the date.
  const pnlToDate = -sum(bal.filter((b) => b.type === "income" || b.type === "expense"), (b) => b.closing);
  const assets = bal.filter((b) => b.type === "asset"), liabilities = bal.filter((b) => b.type === "liability"), equity = bal.filter((b) => b.type === "equity");
  const totalAssets = sum(assets, (b) => b.closing), totalLiab = -sum(liabilities, (b) => b.closing), totalEq = -sum(equity, (b) => b.closing) + pnlToDate;

  const Row = ({ label, value, bold, indent }: { label: string; value: number; bold?: boolean; indent?: boolean }) => (
    <tr className={cn(bold && "bg-muted/40 font-semibold")}><td className={cn(indent && "pl-8")}>{label}</td><td className="num">{money(value)}</td></tr>
  );
  const exportCsv = () => {
    const rows = bal.map((b) => [b.code || "", b.name, b.type, b.opening, b.debit, b.credit, b.closing].join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([["Code,Account,Type,Opening,Debit,Credit,Closing", ...rows].join("\n")], { type: "text/csv" })); a.download = `trial-balance-${to}.csv`; a.click();
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Financial Statements" icon={Scale} description="Profit & loss, balance sheet and trial balance, straight from your books."
        actions={<><button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" /> CSV</button><button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Printer className="h-4 w-4" /> Print</button></>} />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[{ value: "pl", label: "Profit & Loss" }, { value: "bs", label: "Balance Sheet" }, { value: "tb", label: "Trial Balance" }]} />
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {view === "pl" && tagList.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <select className="fi h-9 w-auto" value={tagId} onChange={(e) => { setTagId(e.target.value); setTagValue("__all"); }} aria-label="Reporting tag">
              <option value="">All (no tag)</option>
              {tagList.map((t) => <option key={t.id} value={t.id}>By {t.name}</option>)}
            </select>
            {tag && (
              <select className="fi h-9 w-auto" value={tagValue} onChange={(e) => setTagValue(e.target.value)} aria-label={`${tag.name} value`}>
                <option value="__all">Every value, side by side</option>
                {tag.options.map((o) => <option key={o} value={o}>Only {o}</option>)}
                <option value="__none">Only not tagged</option>
              </select>
            )}
          </span>
        )}
      </div>
      {isLoading || (tagId && tagLoading && view === "pl") ? <PageLoader /> : view === "pl" && tag && tagValue === "__all" ? (
        <TagPnl rows={tagRows} tagName={tag.name} options={tag.options} from={from} to={to} />
      ) : view === "pl" ? (
        <>
          <Panel flush title={`Profit and loss${tag ? ` · ${tag.name}: ${tagValue === "__none" ? "not tagged" : tagValue}` : ""} · ${from} to ${to}`}>
            <table className="dt dt-keep"><tbody>
              <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Operating income</td></tr>
              {inc.filter((b) => period(b)).map((b) => <Row key={b.account_id} label={b.name} value={-period(b)} indent />)}
              <Row label="Total income" value={income} bold />
              <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Cost of goods sold</td></tr>
              {cogs.filter((b) => period(b)).map((b) => <Row key={b.account_id} label={b.name} value={period(b)} indent />)}
              <Row label="Gross profit" value={gross} bold />
              <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Operating expenses</td></tr>
              {exp.filter((b) => period(b)).map((b) => <Row key={b.account_id} label={b.name} value={period(b)} indent />)}
              <Row label="Total expenses" value={expenses} bold />
              <Row label="Net profit / (loss)" value={net} bold />
            </tbody></table>
          </Panel>
        </>
      ) : view === "bs" ? (
        <Panel flush title={`Balance sheet as at ${to}`}>
          <table className="dt dt-keep"><tbody>
            <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Assets</td></tr>
            {assets.filter((b) => b.closing).map((b) => <Row key={b.account_id} label={b.name} value={b.closing} indent />)}
            <Row label="Total assets" value={totalAssets} bold />
            <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Liabilities</td></tr>
            {liabilities.filter((b) => b.closing).map((b) => <Row key={b.account_id} label={b.name} value={-b.closing} indent />)}
            <Row label="Total liabilities" value={totalLiab} bold />
            <tr><td className="text-xs font-semibold uppercase text-muted-foreground" colSpan={2}>Equity</td></tr>
            {equity.filter((b) => b.closing).map((b) => <Row key={b.account_id} label={b.name} value={-b.closing} indent />)}
            <Row label="Current year earnings" value={pnlToDate} indent />
            <Row label="Total equity" value={totalEq} bold />
            <Row label="Total liabilities & equity" value={totalLiab + totalEq} bold />
          </tbody></table>
          {Math.abs(totalAssets - totalLiab - totalEq) > 1 && <p className="p-4 text-sm text-destructive">Out of balance by {money(totalAssets - totalLiab - totalEq)}. Check Accountant → posting errors.</p>}
        </Panel>
      ) : (
        <Panel flush title={`Trial balance · ${from} to ${to}`}>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Account</th><th className="num">Opening</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Closing debit</th><th className="num">Closing credit</th></tr></thead>
              <tbody>
                {bal.filter((b) => b.opening || b.debit || b.credit).map((b) => (
                  <tr key={b.account_id}>
                    <td data-label="Account">{b.code ? `${b.code} · ` : ""}{b.name}</td>
                    <td data-label="Opening" className="num">{money(b.opening)}</td>
                    <td data-label="Debit" className="num">{money(b.debit)}</td>
                    <td data-label="Credit" className="num">{money(b.credit)}</td>
                    <td data-label="Closing Dr" className="num">{b.closing > 0 ? money(b.closing) : ""}</td>
                    <td data-label="Closing Cr" className="num">{b.closing < 0 ? money(-b.closing) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td className="num">{money(sum(bal, (b) => b.debit))}</td><td className="num">{money(sum(bal, (b) => b.credit))}</td>
                <td className="num">{money(sum(bal.filter((b) => b.closing > 0), (b) => b.closing))}</td><td className="num">{money(-sum(bal.filter((b) => b.closing < 0), (b) => b.closing))}</td></tr></tfoot>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ================================================================ opening balances */

export function OpeningBalances() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [date, setDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [vals, setVals] = useState<Record<string, { debit: string; credit: string }>>({});
  const { data: existing } = useQuery({
    queryKey: ["opening-journal"],
    queryFn: async () => (await sb.from("journals").select("*, journal_lines(*)").eq("source_type", "opening").maybeSingle()).data,
  });
  useEffect(() => {
    if (!existing) return;
    setDate(existing.journal_date);
    const v: Record<string, { debit: string; credit: string }> = {};
    (existing.journal_lines || []).forEach((l: any) => { v[l.account_id] = { debit: Number(l.debit) ? String(l.debit) : "", credit: Number(l.credit) ? String(l.credit) : "" }; });
    setVals(v);
  }, [existing]);
  const list = accounts.filter((a) => !["income", "expense"].includes(a.type) && a.system_key !== "opening_equity");
  const dr = Object.values(vals).reduce((a, v) => a + (Number(v.debit) || 0), 0), cr = Object.values(vals).reduce((a, v) => a + (Number(v.credit) || 0), 0);
  const save = async () => {
    const lines = Object.entries(vals).filter(([, v]) => Number(v.debit) || Number(v.credit)).map(([account_id, v]) => ({ account_id, debit: Number(v.debit) || 0, credit: Number(v.credit) || 0, description: "Opening balance" }));
    const { error } = await sb.rpc("acc_opening_balances", { p_date: date, p_lines: lines });
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["acc-balances"] }); void qc.invalidateQueries({ queryKey: ["opening-journal"] });
    toast.success("Opening balances saved", { description: dr !== cr ? `The difference of ${money(Math.abs(dr - cr))} went to Opening balance equity.` : undefined });
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Opening Balances" icon={Scale} description="Balances on the day you start. Customer and supplier balances come from their opening invoices and bills."
        actions={<button onClick={save} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4" /> Save</button>} />
      <Field label="Opening date" className="max-w-xs"><input type="date" className="fi" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Panel flush>
        <table className="dt">
          <thead><tr><th>Account</th><th className="num w-40">Debit</th><th className="num w-40">Credit</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td data-label="Account">{a.code ? `${a.code} · ` : ""}{a.name} <span className="text-xs text-muted-foreground">{TYPE_LABEL[a.type]}</span></td>
                <td className="!py-1.5"><input className="fi h-9 text-right" type="number" placeholder="0" value={vals[a.id]?.debit || ""} onChange={(e) => setVals({ ...vals, [a.id]: { debit: e.target.value, credit: "" } })} /></td>
                <td className="!py-1.5"><input className="fi h-9 text-right" type="number" placeholder="0" value={vals[a.id]?.credit || ""} onChange={(e) => setVals({ ...vals, [a.id]: { credit: e.target.value, debit: "" } })} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total {dr !== cr && <span className="text-xs font-normal text-muted-foreground">(difference {money(Math.abs(dr - cr))} → Opening balance equity)</span>}</td><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr></tfoot>
        </table>
      </Panel>
    </div>
  );
}

/* ================================================================ budgets */

export function Budgets() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { data: accounts = [] } = useAccounts();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: budget } = useQuery({
    queryKey: ["budget", tenantId, year], enabled: !!tenantId,
    queryFn: async () => (await sb.from("budgets").select("*").eq("fiscal_year", year).maybeSingle()).data,
  });
  const { data: bal = [] } = useBalances(`${year}-01-01`, `${year}-12-31`);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { const v: Record<string, string> = {}; (budget?.lines || []).forEach((l: any) => { v[l.account_id] = String(l.amount); }); setVals(v); }, [budget]);
  const pl = accounts.filter((a) => a.type === "income" || a.type === "expense");
  const save = async () => {
    const lines = Object.entries(vals).filter(([, v]) => Number(v)).map(([account_id, v]) => ({ account_id, amount: Number(v) }));
    const row = { name: `Budget ${year}`, fiscal_year: year, lines, updated_at: new Date().toISOString() };
    const { error } = budget ? await sb.from("budgets").update(row).eq("id", budget.id) : await sb.from("budgets").insert(row);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["budget"] }); toast.success("Budget saved");
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Budgets" icon={PieChart} description="Set the year's budget per account and compare it with what actually happened."
        actions={<><select className="fi h-10 w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}</select>
          <button onClick={save} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4" /> Save</button></>} />
      <Panel flush>
        <table className="dt">
          <thead><tr><th>Account</th><th className="num w-40">Budget {year}</th><th className="num">Actual</th><th className="num">Variance</th><th className="w-40">Used</th></tr></thead>
          <tbody>
            {pl.map((a) => {
              const b = bal.find((x) => x.account_id === a.id);
              const actual = a.type === "income" ? -(b ? b.debit - b.credit : 0) : (b ? b.debit - b.credit : 0);
              const budgetV = Number(vals[a.id]) || 0;
              const pct = budgetV ? Math.min(100, (actual / budgetV) * 100) : 0;
              return (
                <tr key={a.id}>
                  <td data-label="Account">{a.name} <span className="text-xs text-muted-foreground">{TYPE_LABEL[a.type]}</span></td>
                  <td className="!py-1.5"><input className="fi h-9 text-right" type="number" placeholder="0" value={vals[a.id] || ""} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} /></td>
                  <td data-label="Actual" className="num">{money(actual)}</td>
                  <td data-label="Variance" className={cn("num", budgetV && (a.type === "expense" ? actual > budgetV : actual < budgetV) ? "text-destructive" : "text-success")}>{budgetV ? money(budgetV - actual) : ""}</td>
                  <td>{budgetV ? <div className="h-2 rounded-full bg-muted"><div className={cn("h-2 rounded-full", pct >= 100 ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} /></div> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* ================================================================ locking */

export function TransactionLocking() {
  const tenantId = useTenantId();
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["lock-settings", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("business_settings").select("id, erp_settings").eq("tenant_id", tenantId).maybeSingle()).data,
  });
  const [date, setDate] = useState<string>("");
  const current = settings?.erp_settings?.lock_date || "";
  const { data: errors = [] } = useQuery({ queryKey: ["acc-errors", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("accounting_errors").select("*").order("created_at", { ascending: false }).limit(50)).data || [] });
  const set = async (value: string | null) => {
    const erp = { ...(settings?.erp_settings || {}), lock_date: value };
    const { error } = await sb.from("business_settings").update({ erp_settings: erp }).eq("id", settings.id);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["lock-settings"] }); toast.success(value ? `Books locked up to ${value}` : "Books unlocked");
  };
  const rebuild = async () => {
    if (!(await confirmAction({ title: "Rebuild the books?", message: "Every invoice, bill, payment, expense and sale is posted again. Use after an import or a fix." }))) return;
    const { data, error } = await sb.rpc("acc_repost_all");
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["acc-balances"] }); toast.success(`${data} documents posted again`);
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Transaction Locking" icon={Lock} description="Close a period so nothing dated on or before the lock date can be added, changed or deleted." />
      <Panel title="Lock date">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={current ? `Locked up to ${current}` : "Not locked"}><input type="date" className="fi w-auto" value={date || current} onChange={(e) => setDate(e.target.value)} /></Field>
          <button disabled={role !== "admin" && role !== "super_admin"} onClick={() => void set(date || current)} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Lock className="mr-1 inline h-4 w-4" /> Lock</button>
          {current && <button onClick={() => void set(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Unlock</button>}
        </div>
      </Panel>
      <Panel title="Posting health" actions={<button onClick={rebuild} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"><RefreshCw className="h-4 w-4" /> Rebuild books</button>}>
        {(errors as any[]).length === 0 ? <p className="flex items-center gap-2 text-sm text-success"><Check className="h-4 w-4" /> Every document posted cleanly.</p> : (
          <ul className="space-y-2 text-sm">{(errors as any[]).map((e) => <li key={e.id} className="rounded-xl bg-destructive/5 p-3"><b>{e.source_type}</b> · {new Date(e.created_at).toLocaleString()}<br /><span className="text-muted-foreground">{e.message}</span></li>)}</ul>
        )}
      </Panel>
    </div>
  );
}
