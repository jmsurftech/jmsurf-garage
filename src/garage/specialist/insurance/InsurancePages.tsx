import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Building2, Car, Download, FilePlus2, FileText, ShieldCheck, UserCheck, BellRing } from "lucide-react";
import { PageHeader, Panel, Segmented } from "@/components/kit";
import { Picker } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { sendShopMessage } from "@/lib/messaging";
import { CLAIM_STAGES, INSURER_STAGES } from "../apps";
import { num, patchRec, useInvoices, useRecs, useCustomers, type Rec } from "../shared/db";
import { invoiceBalance } from "../shared/billing";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnPrimary, Gate, ModuleHome, RecTable, StageChip, useAction } from "../shared/ui";
import { AGING_BUCKETS, agingBucket, daysBetween } from "../lib/calc";

const OPEN = ["new", "estimate_sent", "approved", "in_repair", "repaired"];

export function InsuranceHome() {
  const { data: claims = [] } = useRecs("insurance", "claim");
  const { data: insurers = [] } = useRecs("insurance", "insurer");
  const { data: customers = [] } = useCustomers();
  const [filter, setFilter] = useState("open");
  const invQ = useInvoices(claims.map((c) => c.data?.invoice_insurer_id));
  const inv = invQ.data;
  const insurerName = new Map(insurers.map((i) => [i.id, i.title]));
  const custName = new Map(customers.map((c) => [c.id, c.name]));

  const owed = claims.reduce((a, c) => a + invoiceBalance(inv?.get(c.data?.invoice_insurer_id)), 0);
  const overdue = claims.filter((c) => {
    const i = inv?.get(c.data?.invoice_insurer_id);
    const ins = insurers.find((x) => x.id === c.parent_id);
    return i && invoiceBalance(i) > 0 && daysBetween(i.issue_date) > (num(ins?.data?.terms_days) || 30);
  });
  const rows = claims.filter((c) => filter === "all" ? true : filter === "open" ? OPEN.includes(String(c.stage)) : filter === "invoiced" ? c.stage === "invoiced" : filter === "overdue" ? overdue.includes(c) : c.stage === filter);
  const expiring = insurers.filter((i) => i.stage === "approved" && i.due_date && daysBetween(new Date(), i.due_date) <= 30);

  return (
    <ModuleHome module="insurance" title="Insurance claims" icon={ShieldCheck}
      actions={<Link to="/apps/insurance/claim?new=1" className={btnPrimary}><FilePlus2 className="h-4 w-4" /> New claim</Link>}
      stats={[
        { label: "Open claims", value: claims.filter((c) => OPEN.includes(String(c.stage))).length, icon: ShieldCheck },
        { label: "Waiting for approval", value: claims.filter((c) => ["new", "estimate_sent"].includes(String(c.stage))).length, tone: "warning" },
        { label: "Owed by insurers", value: fmtMoney(owed), tone: "info" },
        { label: "Overdue claims", value: overdue.length, tone: overdue.length ? "danger" : "success" },
      ]}
      links={[
        { to: "/apps/insurance/claim", label: "Claims board", icon: ShieldCheck },
        { to: "/apps/insurance/insurer", label: "Insurers", icon: Building2, hint: "Approved-garage status" },
        { to: "/apps/insurance/assessor", label: "Assessors", icon: UserCheck },
        { to: "/apps/insurance/courtesy", label: "Courtesy cars", icon: Car },
        { to: "/garage/insurance/statements", label: "Aging & statements", icon: BarChart3 },
      ]}>
      {expiring.length > 0 && (
        <Panel title="Approved-garage status ending soon" icon={Building2}>
          <ul className="text-sm">{expiring.map((i) => <li key={i.id}><Link className="text-primary" to={`/apps/insurance/insurer?open=${i.id}`}>{i.title}</Link> · until {String(i.due_date).slice(0, 10)}</li>)}</ul>
        </Panel>
      )}
      <Panel title="Claims" icon={FileText} flush actions={
        <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "invoiced", label: "Invoiced" }, { value: "overdue", label: "Overdue", count: overdue.length }, { value: "all", label: "All" }]} />
      }>
        <RecTable rows={rows} to={(r) => `/garage/insurance/claims/${r.id}`} empty="No claims here."
          cols={[
            { label: "Claim", get: (r) => `${r.number || ""} ${r.data?.plate || r.title}` },
            { label: "Insurer", get: (r) => insurerName.get(r.parent_id || "") || "—" },
            { label: "Customer", get: (r) => custName.get(r.customer_id || "") || "—" },
            { label: "Approved", get: (r) => fmtMoney(num(r.amount)), num: true },
            { label: "Insurer owes", get: (r) => { const b = invoiceBalance(inv?.get(r.data?.invoice_insurer_id)); return b ? fmtMoney(b) : "—"; }, num: true },
            { label: "Stage", get: (r) => <StageChip stages={CLAIM_STAGES} stage={r.stage} /> },
          ]} />
      </Panel>
    </ModuleHome>
  );
}

/** Money owed by each insurer by age, and a statement per insurer. */
export function InsuranceStatements() {
  return <Gate module="insurance"><Statements /></Gate>;
}

function Statements() {
  const tenantId = useTenantId();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: claims = [] } = useRecs("insurance", "claim");
  const { data: insurers = [] } = useRecs("insurance", "insurer");
  const invQ = useInvoices(claims.map((c) => c.data?.invoice_insurer_id));
  const inv = invQ.data;
  const { busy, run } = useAction();
  const sel = params.get("insurer") || "";

  const byInsurer = useMemo(() => {
    const out = new Map<string, { insurer: Rec; buckets: number[]; total: number; rows: { claim: Rec; inv: any; bal: number; days: number }[] }>();
    for (const i of insurers) out.set(i.id, { insurer: i, buckets: [0, 0, 0, 0], total: 0, rows: [] });
    for (const c of claims) {
      const i = inv?.get(c.data?.invoice_insurer_id);
      const g = out.get(c.parent_id || "");
      if (!i || !g || i.status === "void") continue;
      const bal = invoiceBalance(i);
      const days = daysBetween(i.issue_date);
      g.rows.push({ claim: c, inv: i, bal, days });
      if (bal > 0) { g.buckets[agingBucket(days)] += bal; g.total += bal; }
    }
    return Array.from(out.values()).sort((a, b) => b.total - a.total);
  }, [claims, insurers, inv]);

  const g = byInsurer.find((x) => x.insurer.id === sel);
  const statementPdf = () => run("pdf", async () => {
    if (!g) return;
    const items = g.rows.map((r) => item(`${r.inv.invoice_number} · claim ${r.claim.data?.claim_no || r.claim.number} · ${r.claim.data?.plate || r.claim.title}`, 1, r.bal, `Invoiced ${r.inv.issue_date} · total ${fmtMoney(num(r.inv.total))} · ${r.days} days`));
    await downloadPdf(tenantId!, {
      title: "Statement of Claims", number: null, party: party("Insurer", g.insurer.title, [g.insurer.data?.contact, g.insurer.data?.email]),
      meta: [{ label: "Date", value: new Date().toLocaleDateString("en-KE") }, { label: "Open claims", value: String(g.rows.filter((r) => r.bal > 0).length) }],
      currency: "KES", items, totals: { subtotal: g.total, tax: 0, total: g.total },
      sections: [{ title: "Aging", text: AGING_BUCKETS.map((b, i) => `${b}: ${fmtMoney(g.buckets[i])}`).join("\n") }],
    } as any, `statement-${g.insurer.title.replace(/\s+/g, "-")}.pdf`);
  });
  const remindAll = () => run("remind", async () => {
    if (!g) return;
    const phone = g.insurer.data?.phone;
    if (!phone) throw new Error("Add the insurer's claims phone first");
    const open = g.rows.filter((r) => r.bal > 0);
    if (!open.length) throw new Error("Nothing is owed");
    const text = `Statement reminder: ${open.length} claim invoice(s) totalling ${fmtMoney(g.total)} are unpaid, the oldest ${Math.max(...open.map((r) => r.days))} days. Kindly arrange payment.`;
    const r = await sendShopMessage("sms", phone, text);
    if (r && r.ok === false) throw new Error(r.error || "SMS not sent");
    for (const o of open) await patchRec(o.claim.id, { data: { last_reminded: new Date().toISOString() } });
  }, "Reminder sent");

  return (
    <div className="space-y-3">
      <PageHeader title="Insurer aging & statements" icon={BarChart3} actions={<Link className={btn} to="/garage/insurance">Claims</Link>} />
      <Panel title="Owed by insurer" flush>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Insurer</th><th>Status</th>{AGING_BUCKETS.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {byInsurer.map((x) => (
                <tr key={x.insurer.id} className="cursor-pointer" onClick={() => setParams({ insurer: x.insurer.id })}>
                  <td data-label="Insurer" className="font-medium">{x.insurer.title}</td>
                  <td data-label="Status"><StageChip stages={INSURER_STAGES} stage={x.insurer.stage} /></td>
                  {x.buckets.map((b, i) => <td key={i} data-label={AGING_BUCKETS[i]} className="num">{b ? fmtMoney(b) : "—"}</td>)}
                  <td data-label="Total" className="num font-semibold">{fmtMoney(x.total)}</td>
                </tr>
              ))}
              {!byInsurer.length && <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Add insurers first.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Statement" actions={g && <div className="flex gap-2"><button className={btn} disabled={!!busy} onClick={statementPdf}><Download className="h-4 w-4" /> PDF</button><button className={btn} disabled={!!busy} onClick={remindAll}><BellRing className="h-4 w-4" /> SMS reminder</button></div>}>
        <div className="mb-2 max-w-sm"><Picker value={sel} onChange={(v) => setParams(v ? { insurer: v } : {})} options={insurers.map((i) => ({ id: i.id, label: i.title }))} placeholder="Choose an insurer…" /></div>
        {g ? (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Invoice</th><th>Claim</th><th>Vehicle</th><th>Date</th><th className="num">Days</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.inv.id} className="cursor-pointer" onClick={() => navigate(`/garage/insurance/claims/${r.claim.id}`)}>
                    <td data-label="Invoice">{r.inv.invoice_number}</td><td data-label="Claim">{r.claim.data?.claim_no || r.claim.number}</td>
                    <td data-label="Vehicle">{r.claim.data?.plate || r.claim.title}</td><td data-label="Date">{r.inv.issue_date}</td>
                    <td data-label="Days" className="num">{r.days}</td><td data-label="Total" className="num">{fmtMoney(num(r.inv.total))}</td>
                    <td data-label="Balance" className="num font-semibold">{fmtMoney(r.bal)}</td>
                  </tr>
                ))}
                {!g.rows.length && <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No invoiced claims for this insurer.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Choose an insurer to see its statement.</p>}
      </Panel>
    </div>
  );
}
