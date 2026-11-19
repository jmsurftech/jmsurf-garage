import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileSpreadsheet, FileDown, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { saveFile } from "@/lib/erpApi";

type Col = { key: string; label: string; required?: boolean; type?: "number" | "date" | "boolean" | "text" };
/** What an import writes: a table, its columns and how a spreadsheet row becomes a record. */
export type ImportSpec = {
  table: string;
  columns: Col[];
  /** Turns a parsed row into a database record (tenant_id is added). Return null to skip. */
  toRecord?: (row: Record<string, any>) => Record<string, any> | null;
  /** Match existing rows on this column and update them instead of adding duplicates. */
  upsertOn?: string;
};

const title = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** Lists whose imports also accept exports from other accounting systems (handled by the Move-in engine). */
const EXPORT_KIND: Record<string, "items" | "customers" | "vendors"> = { products: "items", customers: "customers", suppliers: "vendors" };
const KIND_WORD = { items: "items", customers: "customers", vendors: "suppliers" } as const;

/**
 * Export (CSV / Excel) and, with `spec`, import (CSV / Excel with a template)
 * for any list. Rows are exported as given, so pass what the user sees.
 */
export default function ImportExport({ entity, rows, spec, label }: { entity: string; rows: Record<string, any>[]; spec?: ImportSpec; label?: string }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, any>[] | null>(null);
  const [busy, setBusy] = useState(false);
  // A recognised export from another system: imported with every detail through the Move-in engine.
  const [moveIn, setMoveIn] = useState<{ kind: "items" | "customers" | "vendors"; rows: Record<string, string>[]; file: string } | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  const exportCsv = () => {
    if (!rows.length) return toast({ title: "Nothing to export" });
    const keys = Object.keys(rows[0]);
    const csv = [keys.map(title).join(","), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    saveFile(`${entity}-${stamp}.csv`, "﻿" + csv, "text/csv");
    toast({ title: "Exported", description: `${rows.length} rows` });
  };
  const exportXlsx = async () => {
    if (!rows.length) return toast({ title: "Nothing to export" });
    const XLSX = await import("@e965/xlsx");
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [title(k), v]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title(entity).slice(0, 30));
    XLSX.writeFile(wb, `${entity}-${stamp}.xlsx`);
    toast({ title: "Exported", description: `${rows.length} rows` });
  };
  const template = async () => {
    if (!spec) return;
    const XLSX = await import("@e965/xlsx");
    const ws = XLSX.utils.aoa_to_sheet([spec.columns.map((c) => c.label + (c.required ? " *" : ""))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import");
    XLSX.writeFile(wb, `${entity}-import-template.xlsx`);
  };
  const pick = async (f?: File) => {
    if (!f || !spec) return;
    // Exports from other systems (Zoho Books and similar): recognise them by name and columns, keep every detail.
    const want = EXPORT_KIND[spec.table];
    if (want) {
      try {
        const { readFile, detect, norm } = await import("@/pages/migrate/importEngine");
        const rows = await readFile(f);
        const cols = new Set(Object.keys(rows[0] || {}));
        const fitsTemplate = spec.columns.filter((c) => c.required).every((c) => cols.has(norm(c.label)) || cols.has(norm(c.key)));
        const kind = detect(f.name, rows);
        const contacts = kind === "customers" || kind === "vendors";
        if (!fitsTemplate && (kind === want || (contacts && want !== "items"))) {
          const keep = want === "items" ? rows : rows.filter((r) => !r.contacttype || /vendor/i.test(r.contacttype) === (want === "vendors"));
          if (!keep.length) return toast({ title: `No ${KIND_WORD[want]} in this file`, description: want === "vendors" ? "It only has customers." : "It only has vendors.", variant: "destructive" });
          setMoveIn({ kind: want, rows: keep, file: f.name });
          return;
        }
      } catch { /* not a recognised export: fall through to the template */ }
    }
    try {
      const XLSX = await import("@e965/xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const norm = (s: string) => s.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]/g, "");
      const parsed = raw.map((r) => {
        const out: Record<string, any> = {};
        for (const c of spec.columns) {
          const hit = Object.keys(r).find((k) => norm(k) === norm(c.label) || norm(k) === norm(c.key));
          let v = hit ? r[hit] : "";
          if (c.type === "number") v = v === "" ? null : Number(String(v).replace(/[^\d.-]/g, ""));
          else if (c.type === "boolean") v = /^(y|yes|true|1)$/i.test(String(v));
          else if (c.type === "date") v = v instanceof Date ? v.toISOString().slice(0, 10) : String(v || "").slice(0, 10) || null;
          else v = String(v ?? "").trim();
          out[c.key] = v;
        }
        return out;
      }).filter((r) => spec.columns.filter((c) => c.required).every((c) => r[c.key] !== "" && r[c.key] != null));
      if (!parsed.length) return toast({ title: "No usable rows", description: "Use the template; required columns are marked with *.", variant: "destructive" });
      setPreview(parsed);
    } catch (e: any) { toast({ title: "Could not read the file", description: e.message, variant: "destructive" }); }
  };
  const run = async () => {
    if (!preview || !spec) return;
    setBusy(true);
    try {
      const records = preview.map((r) => (spec.toRecord ? spec.toRecord(r) : r)).filter(Boolean).map((r) => ({ tenant_id: tenantId, ...r }));
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200);
        const { error } = spec.upsertOn ? await (supabase as any).from(spec.table).upsert(chunk, { onConflict: spec.upsertOn }) : await (supabase as any).from(spec.table).insert(chunk);
        if (error) throw error;
      }
      toast({ title: "Import complete", description: `${records.length} rows added` });
      setPreview(null);
      qc.invalidateQueries();
    } catch (e: any) { toast({ title: "Import stopped", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const runMoveIn = async () => {
    if (!moveIn || !tenantId) return;
    setBusy(true);
    try {
      const { runImport } = await import("@/pages/migrate/importEngine");
      const logs = await runImport(new Map([[moveIn.kind, moveIn.rows]]), { tenantId, synthPayments: false, onStep: () => undefined, onLog: () => undefined });
      const l = logs[0] || { ok: 0, skipped: 0, errors: [] as string[] };
      toast({ title: "Import complete", description: `${l.ok} added${l.skipped ? `, ${l.skipped} already here` : ""}${l.errors.length ? `. Not added: ${l.errors.slice(0, 3).join("; ")}` : ""}`, variant: l.errors.length && !l.ok ? "destructive" : undefined, duration: l.errors.length ? 15000 : 5000 });
      setMoveIn(null);
      qc.invalidateQueries();
    } catch (e: any) { toast({ title: "Import stopped", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline"><FileSpreadsheet /> {label || (spec ? "Import / Export" : "Export")} <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuItem onSelect={exportXlsx}><FileDown /> Excel (.xlsx)</DropdownMenuItem>
          <DropdownMenuItem onSelect={exportCsv}><Download /> CSV</DropdownMenuItem>
          {spec && <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Import</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => file.current?.click()}><Upload /> Import from Excel / CSV</DropdownMenuItem>
            <DropdownMenuItem onSelect={template}><FileSpreadsheet /> Download the template</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Check the import" description={`${preview?.length || 0} rows ready`} icon={Upload} size="xl"
        footer={<><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button><Button onClick={run} disabled={busy}>{busy && <OrbSpinner />} Import {preview?.length} rows</Button></>}>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="dt"><thead><tr>{spec?.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{(preview || []).slice(0, 50).map((r, i) => <tr key={i}>{spec?.columns.map((c) => <td key={c.key}>{String(r[c.key] ?? "")}</td>)}</tr>)}</tbody></table>
        </div>
        {(preview?.length || 0) > 50 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 50 rows.</p>}
      </Modal>
      <Modal open={!!moveIn} onClose={() => setMoveIn(null)} icon={Upload} size="md"
        title={`Import ${moveIn?.rows.length || 0} ${moveIn ? KIND_WORD[moveIn.kind] : ""}`}
        description={`"${moveIn?.file || ""}" is an export from another accounting system. Everything in it comes across: ${moveIn?.kind === "items" ? "prices, cost, units, brand, reorder levels, stock on hand, barcodes and tax" : "phones, emails, addresses, KRA PIN, credit limit, payment terms and notes"}. Records already here are skipped.`}
        footer={<><Button variant="ghost" onClick={() => setMoveIn(null)}>Cancel</Button><Button onClick={runMoveIn} disabled={busy}>{busy && <OrbSpinner />} Import {moveIn?.rows.length} {moveIn ? KIND_WORD[moveIn.kind] : ""}</Button></>}>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-3 text-sm">
          {(moveIn?.rows || []).slice(0, 30).map((r, i) => <li key={i} className="truncate">{r.itemname || r.displayname || r.contactname || r.companyname || r.name || "—"}</li>)}
          {(moveIn?.rows.length || 0) > 30 && <li className="text-xs text-muted-foreground">and {(moveIn?.rows.length || 0) - 30} more</li>}
        </ul>
      </Modal>
    </>
  );
}
