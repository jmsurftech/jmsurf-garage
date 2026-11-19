/** Payslips as one HTML page: payroll and My Space print it, and the stored payroll documents keep it. */
const money = (n: unknown) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** NSSF lines on a payslip: Tier I, Tier II and the part of Tier II sent to a private scheme. */
function nssfLines(s: any, line: (l: string, v: number) => string) {
    const d = s.data || {};
    if (d.nssf_tier1 == null) return line("NSSF", s.nssf);
    const scheme = Number(d.nssf_scheme || 0);
    return line("NSSF Tier I", d.nssf_tier1) + (Number(d.nssf_tier2 || 0) - scheme > 0.004 ? line("NSSF Tier II", Number(d.nssf_tier2) - scheme) : "")
        + (scheme > 0 ? line(`${d.nssf_scheme_name || "Private pension scheme"} (Tier II)`, scheme) : "");
}

export function printPayslips(S: any[], period: string | undefined, biz: any, empById: Map<string, any>) {
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return;
    w.document.write(payslipsHtml(S, period, biz, empById, true));
    w.document.close();
}

export function payslipsHtml(S: any[], period: string | undefined, biz: any, empById: Map<string, any>, autoPrint = false) {
    const b: any = biz || {};
    const run = { period };
    const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
    const line = (l: string, v: number, bold = false) => `<tr${bold ? ' style="font-weight:bold;border-top:1px solid #ccc"' : ""}><td>${esc(l)}</td><td style="text-align:right">${money(v)}</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Payslips ${esc(run?.period)}</title><style>body{font-family:Arial,sans-serif;color:#222;margin:0}.slip{page-break-after:always;padding:28px;max-width:720px;margin:auto}h2{margin:0;color:#A8121B}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:4px 2px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:14px}.box{border:1px solid #eee;border-radius:8px;padding:10px}.net{background:#A8121B;color:#fff;padding:12px;border-radius:8px;font-size:18px;display:flex;justify-content:space-between;margin-top:14px}</style></head><body>
    ${S.map((s) => { const e = empById.get(s.employee_id); const d = s.data || {}; return `<div class="slip">
      <div style="display:flex;justify-content:space-between"><div><h2>${esc(b.business_name)}</h2><div style="font-size:12px">${esc(b.business_address || "")} ${esc(b.business_phone || "")}${b.tax_pin ? ` · PIN ${esc(b.tax_pin)}` : ""}</div></div><div style="text-align:right"><b>PAYSLIP</b><br>${esc(run?.period)}</div></div>
      <div class="box" style="margin-top:14px;font-size:13px"><b>${esc(s.employee_name)}</b> · ${esc(e?.employee_no || "")}<br>ID ${esc(e?.national_id || "—")} · KRA PIN ${esc(e?.kra_pin || "—")} · NSSF ${esc(e?.nssf_no || "—")} · SHA ${esc(e?.shif_no || "—")}</div>
      <div class="cols"><div class="box"><b>Earnings</b><table>${line(d.prorate_mode === "prorate" && d.prorate_days_period ? `Basic salary (${d.prorate_days} of ${d.prorate_days_period} days)` : d.prorate_mode === "fixed" ? "Basic salary (fixed for the month)" : "Basic salary", s.basic)}${(d.allowances || []).map((a: any) => line(a.name + (a.taxable ? "" : " (non-taxable)"), a.amount)).join("")}${d.overtime ? line(`Overtime (${d.overtime_hours} h)`, d.overtime) : ""}${d.unpaid_leave ? line(`Unpaid days (${(d.unpaid_leave_days || 0) + (d.absent_days || 0)})`, -d.unpaid_leave) : ""}${line("Gross pay", s.gross, true)}${d.benefits_noncash ? `<tr><td colspan="2" style="font-size:11px;color:#777">Non-cash benefits ${money(d.benefits_noncash)} (not paid${d.benefits_taxed ? ", taxed" : ", tax free"})</td></tr>` : ""}</table></div>
      <div class="box"><b>Deductions</b><table>${nssfLines(s, line)}${line("SHIF", s.shif)}${line("Housing Levy", s.housing_levy)}${line("PAYE", s.paye)}${d.pension ? line("Pension", d.pension) : ""}${d.prmf ? line("Post-retirement medical fund", d.prmf) : ""}${d.insurance ? line("Insurance premium", d.insurance) : ""}${d.helb ? line("HELB", d.helb) : ""}${s.loan_deductions ? line("Loans & advances", s.loan_deductions) : ""}${(d.other_deductions || []).map((x: any) => line(x.name, x.amount)).join("")}${line("Total deductions", d.total_deductions || 0, true)}</table></div></div>
      <div class="box" style="margin-top:14px;font-size:12px"><b>Tax</b><table>${line("Taxable pay", s.taxable_pay)}${line("Tax charged", d.tax_before_relief || 0)}${line("Personal relief", d.personal_relief || 0)}${d.insurance_relief ? line("Insurance relief", d.insurance_relief) : ""}${line("PAYE", s.paye, true)}</table></div>
      ${d.net_rounding ? `<p style="font-size:11px;color:#777;margin:6px 0 0">Net pay rounded by ${money(d.net_rounding)}</p>` : ""}<div class="net"><span>NET PAY</span><b>KES ${money(s.net_pay)}</b></div>
      <p style="font-size:11px;color:#777">Paid by ${esc(e?.payment_method === "bank" ? `${e?.bank_name || "bank"} ${e?.bank_account || ""}` : e?.payment_method === "mpesa" ? `M-Pesa ${e?.mpesa_phone || ""}` : e?.payment_method || "")}${s.pay_reference ? ` (ref ${esc(s.pay_reference)})` : ""} · Employer also paid NSSF ${money(s.employer_nssf)}${d.employer_nssf_scheme ? ` (${money(d.employer_nssf_scheme)} of it to ${esc(d.nssf_scheme_name || "the pension scheme")})` : ""}, Housing Levy ${money(s.employer_housing)}, NITA ${money(s.nita)}</p></div>`; }).join("")}
    ${autoPrint ? "<script>setTimeout(()=>print(),300)</script>" : ""}</body></html>`;
}
