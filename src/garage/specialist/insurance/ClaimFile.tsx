import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Car, Download, FileSignature, FileText, Pencil, Receipt, Send, ShieldCheck, Wrench, BellRing, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageLoader, Panel, Segmented, EmptyState } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { SignaturePad } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { sendShopMessage } from "@/lib/messaging";
import { CLAIM_STAGES } from "../apps";
import { insertRec, logEvent, moveStage, num, patchRec, sendToWorkshop, today, useInvoices, useJobsFrom, useRec, useRecs, useRefresh, useCustomers } from "../shared/db";
import { createInvoice, invoiceBalance } from "../shared/billing";
import { downloadPdf, item, party, storePdfLink, totalsOf } from "../shared/pdf";
import { btn, btnDark, btnPrimary, Gate, KV, Labeled, LinesTable, ShareLink, StageBar, StageChip, useAction, VehicleSelect, type Col } from "../shared/ui";
import { claimSplit, ESTIMATE_SECTIONS, estimateTotals, lineAmount, type EstimateLine } from "../lib/calc";

const CLAIM_DOCS = ["Accident photos", "Police abstract", "Driver's licence", "Claim form", "Logbook copy", "Assessor's report", "Release letter"];
const SALVAGE_COLS: Col[] = [
  { key: "part", label: "Part replaced", placeholder: "Enter part" },
  { key: "condition", label: "Condition", type: "select", options: ["Damaged beyond repair", "Repairable", "Scrap"] },
  { key: "disposal", label: "What happened to it", type: "select", options: ["Returned to insurer", "Collected by assessor", "Kept by customer", "Sold as salvage", "Scrapped"] },
  { key: "date", label: "Date", type: "date" },
  { key: "ref", label: "Reference / value", placeholder: "Enter reference" },
];

export default function ClaimFile() {
  return <Gate module="insurance"><ClaimFileInner /></Gate>;
}

function ClaimFileInner() {
  const { id = "" } = useParams();
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { data: claim, isLoading } = useRec(id);
  const { data: insurer } = useRec(claim?.parent_id);
  const { data: assessor } = useRec(claim?.data?.assessor);
  const { data: customers = [] } = useCustomers();
  const { data: courtesy = [] } = useRecs("insurance", "courtesy", { parentId: id });
  const { data: jobs = [], refetch: refetchJobs } = useJobsFrom("claim_id", id);
  const { busy, run } = useAction();

  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [salvage, setSalvage] = useState<Record<string, any>[]>([]);
  const [supp, setSupp] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [release, setRelease] = useState<{ name: string; id_no: string; signature: string | null }>({ name: "", id_no: "", signature: null });
  const [link, setLink] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  useEffect(() => {
    if (!claim) return;
    setLines(Array.isArray(claim.data?.estimate) ? claim.data.estimate : []);
    setSalvage(Array.isArray(claim.data?.salvage) ? claim.data.salvage : []);
    setRelease({ name: claim.data?.release?.name || "", id_no: claim.data?.release?.id_no || "", signature: claim.data?.release?.signature || null });
    setVehicleId(claim.data?.vehicle_id || null);
    setDirty(false);
  }, [claim?.id, claim?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const invQ = useInvoices([claim?.data?.invoice_excess_id, claim?.data?.invoice_insurer_id]);
  const invoices = invQ.data;
  const suppCount = Math.max(0, ...lines.map((l) => num(l.supp)));
  const all = useMemo(() => estimateTotals(lines), [lines]);
  const cur = useMemo(() => estimateTotals(lines, supp), [lines, supp]);
  const excess = num(claim?.data?.excess);
  const split = claimSplit(all.approved, excess, all.customerExtras);
  const customer = customers.find((c) => c.id === claim?.customer_id);

  if (isLoading) return <PageLoader />;
  if (!claim || claim.app !== "insurance" || claim.kind !== "claim") return <EmptyState title="Claim not found" action={<Link className="text-primary underline" to="/garage/insurance">Back to claims</Link>} />;

  const shown = lines.map((l, i) => ({ ...l, _i: i })).filter((l) => num(l.supp) === supp);
  const setShown = (rows: Record<string, any>[]) => {
    const others = lines.filter((l) => num(l.supp) !== supp);
    setLines([...others, ...rows.map(({ _i, ...r }) => ({ ...r, supp, qty: r.qty === "" ? 0 : r.qty, rate: r.rate === "" ? 0 : r.rate } as EstimateLine))]);
    setDirty(true);
  };
  const cleanLines = () => lines.map((l) => ({ ...l, qty: num(l.qty) || 0, rate: num(l.rate), approved: l.approved === null || l.approved === undefined || String(l.approved) === "" ? null : num(l.approved) }));

  const save = () => run("save", async () => {
    await patchRec(claim.id, { data: { estimate: cleanLines(), salvage, vehicle_id: vehicleId }, amount: estimateTotals(cleanLines()).approved || claim.amount });
    setDirty(false); refresh("insurance", claim.id);
  }, "Claim saved");

  const layout = String(insurer?.data?.layout || "Parts / labour / paint sections");
  const estimateDoc = (s: number) => {
    const use = cleanLines().filter((l) => num(l.supp) === s);
    const ordered = layout === "One list" ? use : [...use].sort((a, b) => {
      const order = layout.startsWith("Parts first") ? ["Parts", "Labour"] : ESTIMATE_SECTIONS;
      const ia = order.indexOf(a.section) < 0 ? 99 : order.indexOf(a.section), ib = order.indexOf(b.section) < 0 ? 99 : order.indexOf(b.section);
      return ia - ib;
    });
    const items = ordered.map((l) => item(l.description || l.section, l.qty, l.rate, layout === "One list" ? null : l.section));
    const t = estimateTotals(use);
    return {
      title: s ? `Supplementary Estimate ${s}` : "Repair Estimate",
      number: `${claim.number || ""}${s ? `-S${s}` : ""}`,
      party: party("Insurer", insurer?.title || "Insurer", [assessor ? `Assessor: ${assessor.title}` : null, insurer?.data?.email]),
      secondParty: party("Insured", customer?.name || "—", [customer?.phone]),
      meta: [
        { label: "Vehicle", value: claim.data?.plate || claim.title },
        { label: "Policy no.", value: claim.data?.policy_no || "—" },
        { label: "Claim no.", value: claim.data?.claim_no || "—" },
        { label: "Accident date", value: claim.starts_at ? String(claim.starts_at).slice(0, 10) : "—" },
      ],
      currency: "KES", items, totals: { ...totalsOf(items) },
      sections: [
        ...(layout === "One list" ? [] : [{ title: "Summary by section", text: Object.entries(t.bySection).map(([k, v]) => `${k}: ${fmtMoney(v.estimate)}`).join("\n") }]),
        ...(excess ? [{ title: "Excess", text: `Policy excess payable by the insured: ${fmtMoney(excess)}` }] : []),
        ...(claim.data?.description ? [{ title: "Accident", text: String(claim.data.description) }] : []),
      ],
      signatures: ["Prepared by", "Assessor's approval"],
    };
  };

  const pdf = (s: number) => run("pdf", () => downloadPdf(tenantId!, estimateDoc(s) as any, `${claim.number || "estimate"}${s ? `-S${s}` : ""}.pdf`));
  const sendToAssessor = (s: number) => run("send", async () => {
    if (dirty) await patchRec(claim.id, { data: { estimate: cleanLines() } });
    const url = await storePdfLink(tenantId!, estimateDoc(s) as any, `${claim.number || "estimate"}${s ? `-S${s}` : ""}.pdf`, { type: "garage_claim", id: claim.id, name: claim.title, category: "Estimate" });
    setLink(url);
    await patchRec(claim.id, { data: { [`estimate_sent_${s}`]: new Date().toISOString() } });
    if (claim.stage === "new") await moveStage(claim, "estimate_sent", "Estimate sent");
    await logEvent(claim.id, `${s ? `Supplementary estimate ${s}` : "Estimate"} sent to the assessor.`);
    refresh("insurance", claim.id);
  }, "Estimate link ready to send");

  const approve = () => run("approve", async () => {
    const t = estimateTotals(cleanLines());
    if (!t.assessed) throw new Error("Enter the assessor-approved amount on the lines first");
    await patchRec(claim.id, { amount: t.approved, data: { estimate: cleanLines(), approved_at: today() } });
    if (["new", "estimate_sent"].includes(String(claim.stage))) await moveStage(claim, "approved", "Approved");
    await logEvent(claim.id, `Assessor approved ${fmtMoney(t.approved)}.`);
    setDirty(false); refresh("insurance", claim.id);
  }, "Approved amount saved");

  const toWorkshop = () => run("workshop", async () => {
    if (!vehicleId) throw new Error("Choose the vehicle first");
    const job = await sendToWorkshop(tenantId!, {
      vehicle_id: vehicleId, customer_id: claim.customer_id, job_type: "body_paint",
      source: { module: "insurance", claim_id: claim.id, claim_no: claim.number },
      complaint: `Insurance repair ${claim.number || ""} (${insurer?.title || "insurer"}). ${claim.data?.description || ""}`.trim(),
      payer_split: { insurer: split.insurer, customer: split.customer, insurer_id: insurer?.id || null },
    });
    await patchRec(claim.id, { data: { vehicle_id: vehicleId } });
    if (["approved", "estimate_sent", "new"].includes(String(claim.stage))) await moveStage(claim, "in_repair", "In repair");
    await logEvent(claim.id, `Sent to the workshop${job.job_no ? ` as job ${job.job_no}` : ""}.`);
    void refetchJobs(); refresh("insurance", claim.id);
  }, "Job card opened in the workshop");

  const invoice = () => run("invoice", async () => {
    const ls = cleanLines();
    const t = estimateTotals(ls);
    if (!t.approved) throw new Error("There is no approved amount to invoice yet");
    if (!insurer?.customer_id) throw new Error("Set the insurer's customer account (Insurers → Bill to) first");
    if (!claim.customer_id && (split.customer > 0)) throw new Error("Set the customer on the claim first");
    const s = claimSplit(t.approved, excess, t.customerExtras);
    const ref = [claim.number, claim.data?.claim_no].filter(Boolean).join(" / ");
    const patch: Record<string, any> = {};
    if (!claim.data?.invoice_insurer_id && s.insurer > 0) {
      // The insurer's invoice: the approved lines less the excess.
      const approvedLines = ls.filter((l) => num(l.approved) > 0).map((l) => ({ name: `${l.section}: ${l.description}`, quantity: 1, rate: num(l.approved) }));
      const inv = await createInvoice(tenantId!, {
        customerId: insurer.customer_id, lines: approvedLines, discount: s.excess, subject: `Claim ${claim.data?.claim_no || claim.number} · ${claim.data?.plate || claim.title}`,
        reference: ref, source: "garage_insurance", dueDays: num(insurer.data?.terms_days) || 30,
        notes: `Policy ${claim.data?.policy_no || "—"}.${s.excess > 0 ? ` Less the policy excess of ${fmtMoney(s.excess)} paid by the insured.` : ""}`,
      });
      patch.invoice_insurer_id = inv.id;
    }
    if (!claim.data?.invoice_excess_id && s.customer > 0 && claim.customer_id) {
      const custLines = [{ name: `Policy excess, claim ${claim.data?.claim_no || claim.number}`, quantity: 1, rate: s.excess }];
      for (const l of ls.filter((x) => x.customer)) {
        const extra = Math.max(0, lineAmount(l) - num(l.approved));
        if (extra > 0) custLines.push({ name: `${l.description} (not covered by the insurer)`, quantity: 1, rate: extra });
      }
      const inv = await createInvoice(tenantId!, { customerId: claim.customer_id, lines: custLines.filter((x) => x.rate > 0), subject: `Excess · ${claim.data?.plate || claim.title}`, reference: ref, source: "garage_insurance", dueDays: 0 });
      patch.invoice_excess_id = inv.id;
    }
    if (!Object.keys(patch).length) throw new Error("Both invoices are already made");
    await patchRec(claim.id, { data: { ...patch, estimate: ls, invoiced_at: today() }, amount: t.approved });
    await moveStage(claim, "invoiced", "Invoiced");
    await logEvent(claim.id, "Insurer and excess invoices created.");
    refresh("insurance", claim.id); void invQ.refetch();
  }, "Draft invoices created in Sales");

  const remind = () => run("remind", async () => {
    const inv = invoices?.get(claim.data?.invoice_insurer_id);
    const phone = insurer?.data?.phone;
    if (!phone) throw new Error("Add the insurer's claims phone first");
    const bal = invoiceBalance(inv);
    const text = `Reminder: claim ${claim.data?.claim_no || claim.number} (${claim.data?.plate || claim.title}), invoice ${inv?.invoice_number || ""} of ${fmtMoney(num(inv?.total))} has ${fmtMoney(bal)} unpaid. Kindly arrange payment.`;
    const r = await sendShopMessage("sms", phone, text, inv?.invoice_number);
    if (r && r.ok === false) throw new Error(r.error || "SMS not sent");
    await patchRec(claim.id, { data: { last_reminded: new Date().toISOString() } });
    await logEvent(claim.id, "Payment reminder sent to the insurer.");
  }, "Reminder sent");

  const saveRelease = () => run("release", async () => {
    if (!release.signature) throw new Error("Ask the customer to sign first");
    const rel = { ...release, at: new Date().toISOString() };
    await patchRec(claim.id, { data: { release: rel } });
    await logEvent(claim.id, `Release / satisfaction note signed by ${release.name || "the customer"}.`);
    await downloadPdf(tenantId!, {
      title: "Release & Satisfaction Note", number: claim.number,
      party: party("Insured", customer?.name || release.name || "—", [customer?.phone]),
      secondParty: party("Insurer", insurer?.title || "—", [claim.data?.claim_no ? `Claim no. ${claim.data.claim_no}` : null]),
      meta: [{ label: "Vehicle", value: claim.data?.plate || claim.title }, { label: "Date", value: new Date().toLocaleDateString("en-KE") }],
      currency: "KES", items: [], totals: { subtotal: 0, tax: 0, total: 0 },
      intro: `I, ${release.name || "the undersigned"}${release.id_no ? ` (ID ${release.id_no})` : ""}, confirm that I have collected the vehicle ${claim.data?.plate || claim.title} after repairs under claim ${claim.data?.claim_no || claim.number}, that the repairs were done to my satisfaction and that I have received the vehicle in good order.`,
      sections: [{ title: "Signed", text: `${release.name || "Customer"} · ${new Date().toLocaleString("en-KE")}` }],
      signatures: ["Customer", "For the garage"],
    } as any, `${claim.number || "claim"}-release.pdf`);
    refresh("insurance", claim.id);
  }, "Release note saved");

  const addCourtesy = () => run("courtesy", async () => {
    const plate = window.prompt("Courtesy car number plate");
    if (!plate) return;
    await insertRec("insurance", "courtesy", { title: plate.toUpperCase(), parent_id: claim.id, customer_id: claim.customer_id, starts_at: new Date().toISOString(), stage: "out" });
    await patchRec(claim.id, { data: { courtesy_car: true } });
    refresh("insurance", claim.id);
  }, "Courtesy car recorded");

  const cols: Col[] = [
    { key: "section", label: "Section", type: "select", options: ESTIMATE_SECTIONS, width: "140px" },
    { key: "description", label: "Description", placeholder: "Enter part or work" },
    { key: "qty", label: "Qty", type: "number", width: "70px" },
    { key: "rate", label: "Price", type: "money", width: "110px" },
    { key: "approved", label: "Assessor approved", type: "money", width: "130px" },
    { key: "customer", label: "Customer pays the rest", type: "checkbox", width: "90px" },
  ];
  const insurerInv = invoices?.get(claim.data?.invoice_insurer_id);
  const excessInv = invoices?.get(claim.data?.invoice_excess_id);

  return (
    <div className="space-y-3">
      <PageHeader title={`${claim.number || "Claim"} · ${claim.title}`} icon={ShieldCheck}
        actions={<>
          <Link to={`/apps/insurance/claim?open=${claim.id}`} className={btn}><Pencil className="h-4 w-4" /> Edit details</Link>
          <Link to="/garage/insurance" className={btn}>All claims</Link>
        </>} />
      <StageBar stages={CLAIM_STAGES} value={claim.stage} onChange={(s) => void run("stage", async () => { await moveStage(claim, s.key, s.label); refresh("insurance", claim.id); })} />
      <Panel>
        <KV items={[
          ["Insurer", insurer ? <Link className="text-primary" to={`/apps/insurance/insurer?open=${insurer.id}`}>{insurer.title}</Link> : "—"],
          ["Customer", customer?.name], ["Plate", claim.data?.plate], ["Policy no.", claim.data?.policy_no],
          ["Claim no.", claim.data?.claim_no], ["Assessor", assessor?.title], ["Accident", claim.starts_at ? String(claim.starts_at).slice(0, 10) : null], ["Excess", fmtMoney(excess)],
        ]} />
      </Panel>

      <Panel title="Estimate" icon={FileText} description="Lines in the insurer's layout. After strip-down add a supplementary estimate; the assessor's approved figure is entered against each line."
        actions={<button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={String(supp)} onChange={(v) => setSupp(Number(v))} options={Array.from({ length: suppCount + 1 }, (_, i) => ({ value: String(i), label: i ? `Supplementary ${i}` : "Estimate" }))} />
            <button className={btn} onClick={() => { setSupp(suppCount + 1); setLines([...lines, { section: "Parts", description: "", qty: 1, rate: 0, supp: suppCount + 1 }]); setDirty(true); }}><Plus className="h-4 w-4" /> Supplementary</button>
          </div>
          <LinesTable cols={cols} rows={shown} onChange={setShown} newRow={{ section: "Parts", qty: 1, supp }}
            footer={<p className="text-sm tabular-nums">This estimate {fmtMoney(cur.estimate)} · approved {fmtMoney(cur.approved)}</p>} />
          <div className="grid gap-2 rounded-xl bg-muted/40 p-3 text-sm sm:grid-cols-4">
            <p>All estimates <b className="block tabular-nums">{fmtMoney(all.estimate)}</b></p>
            <p>Assessor approved <b className="block tabular-nums">{fmtMoney(all.approved)}</b></p>
            <p>Insurer pays <b className="block tabular-nums">{fmtMoney(split.insurer)}</b></p>
            <p>Customer pays (excess + extras) <b className="block tabular-nums">{fmtMoney(split.customer)}</b></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={!!busy} onClick={() => pdf(supp)}><Download className="h-4 w-4" /> PDF</button>
            <button className={btn} disabled={!!busy} onClick={() => sendToAssessor(supp)}><Send className="h-4 w-4" /> {busy === "send" ? "Preparing…" : "Send to assessor"}</button>
            <button className={btnDark} disabled={!!busy} onClick={approve}><ShieldCheck className="h-4 w-4" /> Save approval</button>
          </div>
          {link && <ShareLink url={link} phone={assessor?.data?.phone || insurer?.data?.phone} label="Estimate link (valid 14 days)" text={`${insurer?.title || ""} claim ${claim.data?.claim_no || claim.number}, ${claim.data?.plate || ""}: repair estimate`} />}
          {link && (assessor?.data?.email || insurer?.data?.email) && (
            <a className={btn} href={`mailto:${assessor?.data?.email || insurer?.data?.email}?subject=${encodeURIComponent(`Repair estimate ${claim.number} · ${claim.data?.plate || ""}`)}&body=${encodeURIComponent(`Please find the repair estimate for claim ${claim.data?.claim_no || claim.number} here:\n${link}`)}`}>Email the link</a>
          )}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Workshop" icon={Wrench} description="Open a job card for the repair; it remembers this claim and the insurer / customer split.">
          <div className="space-y-2">
            <VehicleSelect value={vehicleId} onChange={(v) => { setVehicleId(v); setDirty(true); }} customerId={claim.customer_id} />
            <button className={btnPrimary} disabled={!!busy} onClick={toWorkshop}><Wrench className="h-4 w-4" /> Send to workshop</button>
            <ul className="divide-y divide-border text-sm">
              {jobs.map((j) => <li key={j.id} className="flex items-center justify-between py-1.5"><span>{j.job_no || "Job card"} · {j.job_type.replace("_", " ")}</span><span className="text-xs text-muted-foreground">{j.status}</span></li>)}
              {!jobs.length && <li className="py-2 text-xs text-muted-foreground">No job card yet.</li>}
            </ul>
          </div>
        </Panel>

        <Panel title="Invoices" icon={Receipt} description="The insurer's share and the customer's excess are billed on separate invoices.">
          <div className="space-y-2 text-sm">
            {[["Insurer", insurerInv], ["Excess (customer)", excessInv]].map(([label, inv]: any) => (
              <div key={label} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <span>{label}</span>
                {inv ? <Link to={`/sales/invoices/${inv.id}`} className="text-primary">{inv.invoice_number} · {fmtMoney(num(inv.total))} · {inv.status}{invoiceBalance(inv) > 0 ? ` · ${fmtMoney(invoiceBalance(inv))} due` : ""}</Link> : <span className="text-muted-foreground">Not invoiced</span>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} disabled={!!busy} onClick={invoice}><Receipt className="h-4 w-4" /> Create invoices</button>
              {insurerInv && invoiceBalance(insurerInv) > 0 && <button className={btn} disabled={!!busy} onClick={remind}><BellRing className="h-4 w-4" /> Remind insurer</button>}
              {insurerInv && insurerInv.status === "paid" && claim.stage !== "paid" && <button className={btnDark} onClick={() => void run("paid", async () => { await moveStage(claim, "paid", "Paid"); refresh("insurance", claim.id); })}>Mark claim paid</button>}
            </div>
            {claim.data?.last_reminded && <p className="text-xs text-muted-foreground">Last reminder {new Date(claim.data.last_reminded).toLocaleDateString("en-KE")}</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Salvage & replaced parts" icon={Wrench} actions={<button className={btn} disabled={!dirty || !!busy} onClick={save}>Save</button>}>
        <LinesTable cols={SALVAGE_COLS} rows={salvage} onChange={(r) => { setSalvage(r); setDirty(true); }} addLabel="Add part" />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Courtesy car" icon={Car} actions={<button className={btn} onClick={addCourtesy}><Plus className="h-4 w-4" /> Give car</button>}>
          <ul className="divide-y divide-border text-sm">
            {courtesy.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link className="text-primary" to={`/apps/insurance/courtesy?open=${c.id}`}>{c.title}</Link>
                <span className="text-xs text-muted-foreground">{c.starts_at ? new Date(c.starts_at).toLocaleDateString("en-KE") : ""} {c.ends_at ? `→ ${new Date(c.ends_at).toLocaleDateString("en-KE")}` : ""}</span>
                <StageChip stages={[{ key: "out", label: "Out", tone: "amber" }, { key: "returned", label: "Returned", tone: "green" }]} stage={c.stage} />
              </li>
            ))}
            {!courtesy.length && <li className="py-2 text-xs text-muted-foreground">No courtesy car on this claim.</li>}
          </ul>
        </Panel>

        <Panel title="Release / satisfaction note" icon={FileSignature} description="Signed by the customer at collection.">
          {claim.data?.release?.signature && <p className="mb-2 text-xs text-muted-foreground">Signed by {claim.data.release.name || "the customer"} on {new Date(claim.data.release.at).toLocaleString("en-KE")}.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Collected by"><input className="fi" placeholder="Enter full name" value={release.name} onChange={(e) => setRelease({ ...release, name: e.target.value })} /></Labeled>
            <Labeled label="ID number"><input className="fi" placeholder="Enter ID number" value={release.id_no} onChange={(e) => setRelease({ ...release, id_no: e.target.value })} /></Labeled>
          </div>
          <div className="mt-2"><SignaturePad value={release.signature} onChange={(v) => setRelease({ ...release, signature: v })} /></div>
          <button className={`${btnPrimary} mt-2`} disabled={!!busy} onClick={saveRelease}><FileSignature className="h-4 w-4" /> Save & download</button>
        </Panel>
      </div>

      <Panel title="Claim documents" icon={FileText}>
        <DocumentsPanel entityType="garage_claim" entityId={claim.id} entityName={`${claim.number || ""} ${claim.title}`} checklist={CLAIM_DOCS} />
      </Panel>
    </div>
  );
}
