/**
 * Stored payroll documents: each approved run's payslips and each year's P9 kept as HTML files in the
 * private payroll-docs bucket (<tenant>/<kind>/<period>/<employee>.html), one hr_payroll_documents row
 * each. HR stores and sends them from Payroll; staff download their own in My Space.
 */
import { sb, fullName, type Employee } from "./hrData";
import { payslipsHtml } from "./payslipPrint";

export const DOCS_BUCKET = "payroll-docs";
export type DocKind = "payslip" | "p9";
export type PayrollDoc = {
  id: string; tenant_id: string; run_id: string | null; employee_id: string; kind: DocKind; year: number; period: string;
  path: string; file_name: string | null; size_bytes: number | null; created_at: string; updated_at: string;
};
export type DocDelivery = { id: string; document_id: string; channel: "email" | "sms" | "whatsapp" | "portal"; sent_to: string | null; status: "sent" | "failed"; error: string | null; sent_at: string };

type Cell = string | number | null | undefined;
const money = (n: unknown) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
const slug = (s: string) => s.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

/** Saves one document file and its row (replacing an earlier one for the same person, kind and period). */
async function storeDoc(d: { tenantId: string; employeeId: string; kind: DocKind; period: string; runId?: string | null; html: string; fileName: string }) {
  const path = `${d.tenantId}/${d.kind}/${d.period}/${d.employeeId}.html`;
  const blob = new Blob([d.html], { type: "text/html" });
  const up = await sb.storage.from(DOCS_BUCKET).upload(path, blob, { upsert: true, contentType: "text/html; charset=utf-8", cacheControl: "0" });
  if (up.error) throw up.error;
  const { data, error } = await sb.from("hr_payroll_documents").upsert({
    tenant_id: d.tenantId, run_id: d.runId ?? null, employee_id: d.employeeId, kind: d.kind, year: Number(d.period.slice(0, 4)), period: d.period,
    path, file_name: d.fileName, content_type: "text/html", size_bytes: blob.size, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,employee_id,kind,period" }).select("*").single();
  if (error) throw error;
  return data as PayrollDoc;
}

/** Runs jobs a few at a time; returns what worked and why the rest failed. */
async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R>, size = 4) {
  const done: R[] = [], failed: string[] = [];
  for (let i = 0; i < items.length; i += size) {
    const res = await Promise.allSettled(items.slice(i, i + size).map(fn));
    res.forEach((r) => (r.status === "fulfilled" ? done.push(r.value) : failed.push(r.reason?.message || String(r.reason))));
  }
  return { done, failed };
}

/** Stores the payslip of each line (approved or paid runs). */
export async function storePayslipDocs(run: { id: string; period: string; tenant_id: string }, slips: any[], biz: any, empById: Map<string, Employee>) {
  return inBatches(slips, (s) => storeDoc({
    tenantId: run.tenant_id, employeeId: s.employee_id, kind: "payslip", period: run.period, runId: run.id,
    html: payslipsHtml([s], run.period, biz, empById), fileName: `payslip-${run.period}-${slug(String(s.employee_name || "employee"))}.html`,
  }));
}

/* ───────────────────────────── P9 ───────────────────────────── */

export const P9_HEAD = ["Month", "Basic salary", "Cash benefits & allowances", "Non-cash benefits", "Gross pay", "Retirement (NSSF + pension)", "PRMF", "Mortgage interest", "SHIF", "Housing Levy", "Chargeable pay", "Tax charged", "Relief", "PAYE"];

/** KRA P9A rows for one employee and year from their payslips (each joined to hr_payroll_runs(period)). */
export function p9Table(year: string, slips: any[]): Cell[][] {
  const months = Array.from({ length: 12 }, (_, i) => {
    const p = `${year}-${String(i + 1).padStart(2, "0")}`;
    const s = slips.find((r) => r.hr_payroll_runs?.period === p);
    const d = s?.data || {};
    return [new Date(`${p}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" }), Number(s?.basic || 0), Number(s?.gross || 0) - Number(s?.basic || 0), Number(d.benefits_taxed || 0),
      Number(s?.gross || 0) + Number(d.benefits_taxed || 0), Number(s?.nssf || 0) + Number(d.pension || 0), Number(d.prmf || 0), Number(d.mortgage || 0), Number(s?.shif || 0),
      Number(s?.housing_levy || 0), Number(s?.taxable_pay || 0), Number(d.tax_before_relief || 0), Number(d.personal_relief || 0) + Number(d.insurance_relief || 0), Number(s?.paye || 0)] as Cell[];
  });
  const total: Cell[] = ["TOTAL", ...P9_HEAD.slice(1).map((_, j) => Math.round(months.reduce((a, m) => a + Number(m[j + 1] || 0), 0) * 100) / 100)];
  return [P9_HEAD, ...months, total];
}

/** The P9 as a page to keep or print. */
export function p9Html(year: string, emp: Employee | undefined, biz: any, table: Cell[][]) {
  const b = biz || {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>P9A ${esc(year)} · ${esc(fullName(emp))}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#222}h2{color:#A8121B;margin:0 0 4px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}th,td{padding:5px;border:1px solid #ddd;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#faf6f2}tr.t td{font-weight:bold}</style></head><body>
  <h2>${esc(b.business_name)}</h2><b>P9A tax deduction card · ${esc(year)}</b>
  <p style="font-size:12px">Employer PIN ${esc(b.tax_pin || "—")}<br>Employee <b>${esc(fullName(emp))}</b> · ${esc(emp?.employee_no || "")} · KRA PIN ${esc(emp?.kra_pin || "—")}</p>
  <table><thead><tr>${table[0].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${table.slice(1).map((r) => `<tr${r[0] === "TOTAL" ? ' class="t"' : ""}>${r.map((c) => `<td>${typeof c === "number" ? money(c) : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <p style="font-size:11px;color:#777">From the approved payslips for ${esc(year)}. Use it for your iTax return.</p></body></html>`;
}

/** Builds, stores and returns the P9 of everyone paid in the year (approved or paid runs only). */
export async function storeP9Docs(tenantId: string, year: string, emps: Employee[], biz: any) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("hr_payslips").select("employee_id,basic,gross,nssf,shif,housing_levy,taxable_pay,paye,data,hr_payroll_runs!inner(period,status)")
      .eq("tenant_id", tenantId).like("hr_payroll_runs.period", `${year}-%`).neq("hr_payroll_runs.status", "draft").range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const byEmp = new Map<string, any[]>();
  for (const s of all) byEmp.set(s.employee_id, [...(byEmp.get(s.employee_id) || []), s]);
  const empById = new Map(emps.map((e) => [e.id, e]));
  return inBatches([...byEmp.entries()], ([id, slips]) => {
    const emp = empById.get(id);
    return storeDoc({ tenantId, employeeId: id, kind: "p9", period: year, html: p9Html(year, emp, biz, p9Table(year, slips)), fileName: `P9-${year}-${slug(fullName(emp) || "employee")}.html` });
  });
}

/* ───────────────────────────── Opening ───────────────────────────── */

/** Opens a stored document in a new tab, or downloads it. */
export async function openDoc(doc: Pick<PayrollDoc, "path" | "file_name">, mode: "view" | "download" = "view") {
  const w = mode === "view" ? window.open("", "_blank") : null;
  const { data, error } = await sb.storage.from(DOCS_BUCKET).download(doc.path);
  if (error || !data) { w?.close(); throw error || new Error("File not found"); }
  const url = URL.createObjectURL(new Blob([await data.text()], { type: "text/html" }));
  if (w) w.location.href = url;
  else { const a = document.createElement("a"); a.href = url; a.download = doc.file_name || "document.html"; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
