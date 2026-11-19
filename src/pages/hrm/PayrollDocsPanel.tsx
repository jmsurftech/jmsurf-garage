/** Payroll → a run's Documents: each person's stored payslip, how it was sent, and Resend. */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, Mail, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { PagedRows } from "@/components/Pager";
import { useToast } from "@/hooks/use-toast";
import { erpApi } from "@/lib/erpApi";
import { fmtDate } from "@/lib/doc-pdf";
import { sb, type Employee } from "./hrData";
import { openDoc, storePayslipDocs, type DocDelivery, type PayrollDoc } from "./payrollDocs";

const CHANNEL: Record<DocDelivery["channel"], string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", portal: "My Space" };

export function RunDocuments({ run, slips, biz, empById }: { run: any; slips: any[]; biz: any; empById: Map<string, Employee> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const draft = run.status === "draft";

  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-run-docs", run.id], enabled: !draft,
    queryFn: async () => {
      const { data: docs, error: e1 } = await sb.from("hr_payroll_documents").select("*").eq("run_id", run.id).eq("kind", "payslip");
      if (e1) throw e1;
      const ids = (docs || []).map((d: PayrollDoc) => d.id);
      const dels: DocDelivery[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data: part } = await sb.from("hr_payroll_document_deliveries").select("*").in("document_id", ids.slice(i, i + 150)).order("sent_at", { ascending: false });
        dels.push(...(part || []));
      }
      return { docs: (docs || []) as PayrollDoc[], dels };
    },
  });
  const docByEmp = useMemo(() => new Map((data?.docs || []).map((d) => [d.employee_id, d])), [data]);
  const delsByDoc = useMemo(() => {
    const m = new Map<string, DocDelivery[]>();
    for (const d of data?.dels || []) m.set(d.document_id, [...(m.get(d.document_id) || []), d]);
    return m;
  }, [data]);
  const shown = slips.filter((s) => !q.trim() || String(s.employee_name).toLowerCase().includes(q.trim().toLowerCase()));
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-run-docs", run.id] });

  const store = async (only?: any[]) => {
    setBusy("store");
    try {
      const r = await storePayslipDocs(run, only || slips, biz, empById);
      refresh();
      toast({ title: `${r.done.length} payslip${r.done.length === 1 ? "" : "s"} stored`, description: r.failed.length ? `${r.failed.length} not stored: ${r.failed[0]}` : undefined, variant: r.failed.length && !r.done.length ? "destructive" : undefined });
    } finally { setBusy(""); }
  };
  const resend = async (docIds: string[], key: string) => {
    if (!docIds.length) return;
    setBusy(key);
    try {
      const r: any = await erpApi("payroll-docs/send", { document_ids: docIds });
      refresh(); qc.invalidateQueries({ queryKey: ["hr-slips"] });
      toast({ title: `${r.email || 0} emailed`, description: r.failed?.length ? r.failed.slice(0, 2).join(" · ") : r.skipped ? `${r.skipped} without an email address` : undefined, variant: r.failed?.length && !r.email ? "destructive" : undefined });
    } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const open = (d: PayrollDoc, mode: "view" | "download") => openDoc(d, mode).catch((e: any) => toast({ title: "File not opened", description: e.message, variant: "destructive" }));

  if (draft) return <Panel><EmptyState icon={FileText} title="Approve the payroll first" description="Payslips are stored once the payroll is approved." /></Panel>;
  if (isLoading) return <OrbLoader label="Loading documents…" />;
  if (error) return <Panel><EmptyState icon={FileText} title="Documents are not set up yet" description={(error as any).message} /></Panel>;
  const stored = slips.filter((s) => docByEmp.has(s.employee_id)).length;
  const missing = slips.filter((s) => !docByEmp.has(s.employee_id));

  return (
    <Panel flush title="Payslip documents" icon={FileText} description={`${stored} of ${slips.length} stored. Staff see theirs in My Space.`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-52"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-9 pl-9" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {missing.length > 0 && <Button size="sm" onClick={() => store(missing)} disabled={!!busy}>{busy === "store" ? <OrbSpinner /> : <FileText />} Store {missing.length} missing</Button>}
        <Button size="sm" variant="outline" onClick={() => store()} disabled={!!busy}>{busy === "store" ? <OrbSpinner /> : <RefreshCw />} Store all again</Button>
        {stored > 0 && <Button size="sm" variant="outline" onClick={() => resend((data?.docs || []).map((d) => d.id), "all")} disabled={!!busy}>{busy === "all" ? <OrbSpinner /> : <Mail />} Email all</Button>}
      </div>}>
      {slips.length === 0 ? <EmptyState icon={FileText} title="Nobody in this payroll" /> : (
        <TableWrap><table className="dt"><thead><tr><th>Employee</th><th>Stored</th><th>Last sent</th><th /></tr></thead>
          <tbody><PagedRows rows={shown} colSpan={4}>{(rows) => rows.map((s) => {
            const d = docByEmp.get(s.employee_id);
            const dels = d ? delsByDoc.get(d.id) || [] : [];
            const last = dels.find((x) => x.channel !== "portal");
            const seen = dels.find((x) => x.channel === "portal");
            return (
              <tr key={s.id}>
                <td className="font-medium">{s.employee_name}</td>
                <td data-label="Stored">{d ? <span className="text-sm">{fmtDate(d.updated_at || d.created_at)}</span> : <Pill tone="warning">Not stored</Pill>}</td>
                <td data-label="Last sent">
                  {!last ? <span className="text-xs text-muted-foreground">{d ? "Not sent yet" : "—"}</span> : (
                    <span className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Pill tone={last.status === "sent" ? "success" : "danger"}>{CHANNEL[last.channel]} {last.status === "sent" ? "sent" : "failed"}</Pill>
                      <span className="text-muted-foreground">{fmtDate(last.sent_at)}{last.sent_to ? ` · ${last.sent_to}` : ""}</span>
                      {last.status === "failed" && last.error && <span className="w-full break-words text-destructive">{last.error}</span>}
                    </span>
                  )}
                  {seen && <span className="mt-0.5 block text-[11px] text-info">Opened in My Space {fmtDate(seen.sent_at)}</span>}
                </td>
                <td><span className="flex justify-end gap-1">
                  {d ? <>
                    <button className="icon-btn" title="View" aria-label="View" onClick={() => open(d, "view")}><Eye className="h-4 w-4" /></button>
                    <button className="icon-btn" title="Download" aria-label="Download" onClick={() => open(d, "download")}><Download className="h-4 w-4" /></button>
                    <Button size="sm" variant="outline" onClick={() => resend([d.id], d.id)} disabled={!!busy}>{busy === d.id ? <OrbSpinner /> : <Mail />} Resend</Button>
                  </> : <Button size="sm" variant="outline" onClick={() => store([s])} disabled={!!busy}><FileText /> Store</Button>}
                </span></td>
              </tr>
            );
          })}</PagedRows></tbody></table></TableWrap>
      )}
    </Panel>
  );
}
