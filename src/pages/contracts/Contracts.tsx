import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Plus, Upload, CalendarClock, ShieldAlert, Wallet, Clock, Users, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Pill, Segmented } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { friendlyError } from "@/lib/friendlyError";
import { CONTRACT_AREAS, CONTRACT_TYPES, contractTitle, draftContract, type ContractArea, type ContractType, type PartyKind } from "@/lib/contractTemplates";
import { PARTY_LABEL, STATUS, daysLeft, findParty, logEvent, readAsBase64, sb, useContracts, useParties, type Contract, type PartyOption } from "./contractData";
import { uploadDocument } from "@/components/DocumentsPanel";
import ContractDetail from "./ContractDetail";

import { PagedRows } from "@/components/Pager";
const VIEWS = ["all", "draft", "out", "active", "expiring", "expired"] as const;
type View = (typeof VIEWS)[number];
const typeLabel = (t: string) => CONTRACT_TYPES.find((x) => x.key === t)?.label.replace(/\s*\(.*\)$/, "") || t;

/** Contracts: drafts from templates, uploads, signing, expiry and renewals. */
export default function Contracts() {
  const { id } = useParams();
  if (id) return <ContractDetail id={id} />;
  return <ContractsList />;
}

function ContractsList() {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { data = [], isLoading } = useContracts();
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Employees whose HR contract ends soon (HRM), next to the contracts here.
  const { data: hrEnding = [] } = useQuery({
    queryKey: ["hr-contract-ending", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("hr_employees").select("id,first_name,last_name,contract_end,employment_type").not("contract_end", "is", null).neq("status", "exited").lte("contract_end", new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)).order("contract_end").limit(50)).data || []) as any[],
  });
  const { data: breaches = 0 } = useQuery({
    queryKey: ["contract-open-breaches", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("contract_issues").select("id", { count: "exact", head: true }).eq("kind", "breach").eq("status", "open")).count || 0,
  });

  const live = (c: Contract) => c.status === "active" || c.status === "signed";
  const expiring = (c: Contract) => live(c) && (daysLeft(c.end_date) ?? 9999) <= 60;
  const rows = useMemo(() => data.filter((c) => {
    const ok = view === "all" ? true : view === "draft" ? ["draft", "review"].includes(c.status) : view === "out" ? ["sent", "amend_requested"].includes(c.status)
      : view === "active" ? live(c) : view === "expiring" ? expiring(c) : ["expired", "terminated"].includes(c.status);
    return ok && (!q.trim() || `${c.number} ${c.title} ${c.party_name || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  }), [data, view, q]);

  const count = (v: View) => data.filter((c) => (v === "draft" ? ["draft", "review"].includes(c.status) : v === "out" ? ["sent", "amend_requested"].includes(c.status) : v === "active" ? live(c) : v === "expiring" ? expiring(c) : v === "expired" ? ["expired", "terminated"].includes(c.status) : true)).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Contracts" icon={FileSignature} description="Draft from templates, sign and stamp, send for the other party to sign online, and track every renewal, breach and amendment."
        actions={<>
          <Button variant="outline" onClick={() => setUploading(true)}><Upload /> Upload a contract</Button>
          <Button onClick={() => setChoosing(true)}><Plus /> New contract</Button>
        </>} />
      <StatGrid className="lg:grid-cols-5">
        <StatTile label="Active" value={data.filter(live).length} icon={FileSignature} tone="success" />
        <StatTile label="Out for signature" value={count("out")} icon={Clock} tone="warning" />
        <StatTile label="Ending in 60 days" value={count("expiring")} icon={CalendarClock} tone="danger" />
        <StatTile label="Active contract value" value={formatKES(data.filter(live).reduce((a, c) => a + Number(c.value || 0), 0))} icon={Wallet} tone="primary" />
        <StatTile label="Open breaches" value={breaches} icon={ShieldAlert} tone={breaches ? "danger" : "muted"} />
      </StatGrid>

      {(data.some(expiring) || hrEnding.length > 0) && (
        <Panel title="Coming up for renewal" icon={CalendarClock} description="Contracts and employee contracts (HRM) ending within the next 60–90 days.">
          <ul className="divide-y divide-border text-sm">
            {data.filter(expiring).sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).slice(0, 8).map((c) => {
              const d = daysLeft(c.end_date)!;
              return (
                <li key={c.id} className="flex cursor-pointer flex-wrap items-center gap-2 py-2 hover:bg-muted/40" onClick={() => navigate(`/contracts/${c.id}`)}>
                  <Pill tone={d <= 7 ? "danger" : d <= 30 ? "warning" : "info"}>{d <= 0 ? "Ends today" : `${d} days`}</Pill>
                  <span className="font-medium">{c.number}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{c.title} · {c.party_name}</span>
                  <span className="text-xs text-muted-foreground">{c.renewal === "auto" ? "Renews automatically" : `Ends ${fmtDate(c.end_date)}`}</span>
                </li>
              );
            })}
            {hrEnding.map((e) => {
              const d = daysLeft(e.contract_end)!;
              return (
                <li key={e.id} className="flex cursor-pointer flex-wrap items-center gap-2 py-2 hover:bg-muted/40" onClick={() => navigate(`/hrm/employees/${e.id}`)}>
                  <Pill tone={d <= 7 ? "danger" : d <= 30 ? "warning" : "info"}>{d < 0 ? "Ended" : d === 0 ? "Ends today" : `${d} days`}</Pill>
                  <Users className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-medium">{[e.first_name, e.last_name].filter(Boolean).join(" ")}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">Employee contract{e.employment_type ? ` · ${String(e.employment_type).replace(/_/g, " ")}` : ""}</span>
                  <span className="text-xs text-muted-foreground">Ends {fmtDate(e.contract_end)}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View> value={view} onChange={setView} options={[
          { value: "all", label: "All", count: data.length }, { value: "draft", label: "Drafts", count: count("draft") }, { value: "out", label: "Out for signature", count: count("out") },
          { value: "active", label: "Active", count: count("active") }, { value: "expiring", label: "Ending soon", count: count("expiring") }, { value: "expired", label: "Ended", count: count("expired") },
        ]} />
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search contracts" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <Panel flush>
        {isLoading ? <div className="p-10"><OrbLoader /></div> : rows.length === 0 ? (
          <EmptyState icon={FileSignature} title="No contracts here" description="Write one from a template in seconds, or upload one that is already signed."
 />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Contract</th><th>Party</th><th>Type</th><th>Ends</th><th className="num">Value</th><th>Status</th></tr></thead>
              <tbody>
                <PagedRows rows={rows} colSpan={6}>{(pageRows) => pageRows.map((c) => {
                  const d = live(c) ? daysLeft(c.end_date) : null;
                  return (
                    <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/contracts/${c.id}`)}>
                      <td><b>{c.number}</b><span className="block max-w-[320px] truncate text-xs text-muted-foreground">{c.title}</span></td>
                      <td>{c.party_name || "—"}<span className="block text-xs text-muted-foreground">{PARTY_LABEL[c.party_kind]}</span></td>
                      <td className="text-sm">{typeLabel(c.type)}</td>
                      <td>{c.end_date ? fmtDate(c.end_date) : "—"}{d !== null && d <= 60 && <span className={`block text-xs ${d <= 7 ? "text-destructive" : "text-[hsl(32_90%_38%)]"}`}>{d <= 0 ? "ends today" : `${d} days left`}</span>}</td>
                      <td className="num">{Number(c.value) ? formatKES(Number(c.value)) : "—"}</td>
                      <td><Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>{c.lawyer_status === "pending" && <span className="block text-xs text-muted-foreground">With lawyer</span>}</td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      {choosing && <NewChooser onClose={() => setChoosing(false)} onPick={(k) => { setChoosing(false); if (k === "write") setCreating(true); else setUploading(true); }} />}
      {creating && <NewContract onClose={() => setCreating(false)} />}
      {uploading && <UploadContract onClose={() => setUploading(false)} />}
    </div>
  );
}

/** Customer, vendor, employee or someone else, with their details filled in. */
export function PartyPicker({ kind, setKind, party, setParty, kinds = ["customer", "supplier", "employee", "other"] }: {
  kind: PartyKind; setKind: (k: PartyKind) => void; party: PartyOption | null; setParty: (p: PartyOption | null) => void; kinds?: PartyKind[];
}) {
  const { data = [], isLoading } = useParties(kind);
  const [q, setQ] = useState("");
  const list = data.filter((p) => !q.trim() || `${p.name} ${p.contact || ""} ${p.email || ""} ${p.phone || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40);
  const set = (patch: Partial<PartyOption>) => setParty({ ...(party || { id: "", name: "" }), ...patch });
  return (
    <div className="space-y-3">
      <Segmented<PartyKind> value={kind} onChange={(k) => { setKind(k); setParty(null); setQ(""); }} options={kinds.map((k) => ({ value: k, label: PARTY_LABEL[k] }))} />
      {kind !== "other" && !party?.id && !party?.name && (
        <div className="rounded-xl border border-border">
          <input className="fi rounded-b-none border-0 border-b" placeholder={`Search ${PARTY_LABEL[kind].toLowerCase()}s`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="max-h-56 overflow-auto">
            {isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
            {!isLoading && list.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody found.</li>}
            {list.map((p) => (
              <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setParty(p)}>
                <b>{p.name}</b><span className="block text-xs text-muted-foreground">{[p.contact, p.role, p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
      {(kind === "other" || party?.id || party?.name) && (
        <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><input className="fi" value={party?.name || ""} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Person signing"><input className="fi" value={party?.contact || ""} placeholder="Name of the signatory" onChange={(e) => set({ contact: e.target.value })} /></Field>
          <Field label="Email"><input className="fi" type="email" value={party?.email || ""} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Phone"><input className="fi" value={party?.phone || ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label={kind === "employee" ? "KRA PIN / ID" : "KRA PIN"}><input className="fi" value={party?.pin || ""} onChange={(e) => set({ pin: e.target.value })} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="fi" value={party?.address || ""} onChange={(e) => set({ address: e.target.value })} /></Field>
          {kind !== "other" && <button type="button" className="text-left text-xs text-primary sm:col-span-2" onClick={() => setParty(null)}>{party?.id ? "Choose someone else" : `Not in your ${PARTY_LABEL[kind].toLowerCase()}s yet: it is added when you link it. Choose an existing one instead`}</button>}
        </div>
      )}
    </div>
  );
}

const defaultKind = (t: ContractType): PartyKind => (t === "employment" ? "employee" : t === "consultancy" || t === "supply" || t === "lease" || t === "agency" ? "supplier" : "customer");

function NewContract({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth() as any;
  const { data: biz } = useBusinessSettings();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<ContractType>("service");
  const [area, setArea] = useState<ContractArea>("general");
  const [kind, setKind] = useState<PartyKind>("customer");
  const [party, setParty] = useState<PartyOption | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ value: "", start: today, end: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10), renewal: "notify" as "none" | "notify" | "auto", notice: "30", role: "", scope: "", place: "", payDays: "30" });
  const [busy, setBusy] = useState(false);
  const b: any = biz || {};

  const create = async () => {
    if (!party?.name?.trim()) return toast.error("Choose or type the other party");
    setBusy(true);
    try {
      const value = Number(f.value || 0) || (type === "employment" ? Number(party.pay || 0) : 0);
      const { title, body } = draftContract({
        type, area, partyKind: kind,
        company: { name: b.business_name || "Our company", address: b.business_address, phone: b.business_phone, email: b.business_email, pin: b.tax_pin },
        party: { name: party.name, contact: party.contact, email: party.email, phone: party.phone, address: party.address, pin: party.pin, idNo: party.idNo },
        value, currency: "KES", start: f.start || null, end: f.end || null, noticeDays: Number(f.notice || 30), renewal: f.renewal,
        role: f.role || party.role, scope: f.scope, place: f.place, paymentDays: Number(f.payDays || 30),
      });
      const { data, error } = await sb.from("contracts").insert({
        title: `${title} — ${party.name}`, type, area, party_kind: kind, party_id: party.id || null, party_name: party.name, party_contact: party.contact || null,
        party_email: party.email || null, party_phone: party.phone || null, party_address: party.address || null, party_pin: party.pin || null,
        value, start_date: f.start || null, end_date: f.end || null, renewal: f.renewal, notice_days: Number(f.notice || 30), body, owner_id: user?.id,
      }).select("id").single();
      if (error) throw error;
      await sb.from("contract_versions").insert({ contract_id: data.id, version: 1, body, note: "First draft from the template", created_by_name: profile?.display_name || null });
      await logEvent(data, "created", profile?.display_name || null, `Drafted from the ${typeLabel(type)} template (${CONTRACT_AREAS.find((a) => a.key === area)?.label})`);
      void qc.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Draft written", { description: "Read it through, edit anything, then sign and send it." });
      navigate(`/contracts/${data.id}`);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="New contract" icon={Sparkles} size="2xl" description={step === 1 ? "What kind of contract, and for which area of business?" : step === 2 ? "Who is it with?" : "Dates, value and details"}
      footer={<div className="flex w-full gap-2">
        {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
        <span className="flex-1" />
        {step < 3 ? <Button disabled={step === 2 && !party?.name} onClick={() => setStep(step + 1)}>Next</Button>
          : <Button onClick={() => void create()} disabled={busy}>{busy ? <OrbSpinner /> : <Sparkles />} Write the draft</Button>}
      </div>}>
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CONTRACT_TYPES.map((t) => (
              <button key={t.key} type="button" onClick={() => { setType(t.key); setKind(defaultKind(t.key)); setParty(null); }}
                className={`rounded-xl border p-3 text-left transition ${type === t.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"}`}>
                <b className="text-sm">{t.label}</b><span className="mt-0.5 block text-xs text-muted-foreground">{t.hint}</span>
              </button>
            ))}
          </div>
          <Field label="Area of business" hint="Adds the terms that matter in that sector.">
            <select className="fi" value={area} onChange={(e) => setArea(e.target.value as ContractArea)}>{CONTRACT_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
          </Field>
          <p className="text-xs text-muted-foreground">Title: <b>{contractTitle(type, area)}</b></p>
        </div>
      )}
      {step === 2 && <PartyPicker kind={kind} setKind={setKind} party={party} setParty={setParty} />}
      {step === 3 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts"><input type="date" className="fi" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Ends" hint="Leave empty if it runs until ended."><input type="date" className="fi" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label={type === "employment" ? "Gross monthly salary (KES)" : type === "lease" ? "Monthly rent (KES)" : "Contract value (KES)"}>
            <input className="fi" inputMode="decimal" value={f.value} placeholder={type === "employment" && party?.pay ? String(party.pay) : "0.00"} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </Field>
          {type !== "employment" && <Field label="Payment within (days)"><input className="fi" inputMode="numeric" value={f.payDays} onChange={(e) => setF({ ...f, payDays: e.target.value })} /></Field>}
          <Field label="At the end"><select className="fi" value={f.renewal} onChange={(e) => setF({ ...f, renewal: e.target.value as any })}><option value="notify">Remind me to renew</option><option value="auto">Renew automatically</option><option value="none">Just end</option></select></Field>
          <Field label="Notice period (days)"><input className="fi" inputMode="numeric" value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /></Field>
          {type === "employment" && <Field label="Job title"><input className="fi" value={f.role} placeholder={party?.role || "e.g. Sales Executive"} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>}
          <Field label={type === "employment" ? "Place of work" : type === "lease" ? "Property" : "Delivery place / territory"}><input className="fi" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
          {type !== "employment" && (
            <Field label={type === "nda" ? "Purpose" : "What is supplied"} className="sm:col-span-2" hint="One or two lines. It goes into the scope clause.">
              <textarea className="fi min-h-[70px]" value={f.scope} placeholder={type === "nda" ? "Discussions about a joint software project" : "e.g. Supply of 500 laptops as per tender no. …"} onChange={(e) => setF({ ...f, scope: e.target.value })} />
            </Field>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">The draft is a starting point written for Kenya. Edit it freely, and send it to your lawyer from the contract if you want it reviewed.</p>
        </div>
      )}
    </Modal>
  );
}

/** Upload a contract (signed on paper, or one a customer or vendor sent): Garage AI reads it and fills in the particulars. */
function UploadContract({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const [kind, setKind] = useState<PartyKind>("customer");
  const [party, setParty] = useState<PartyOption | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: "", type: "service" as ContractType, area: "general" as ContractArea, value: "", currency: "KES", start: "", end: "", renewal: "notify" as "none" | "notify" | "auto", notice: "30", signed: true, body: "", summary: "" });
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const readIt = async (file: File) => {
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) return;
    setReading(true);
    try {
      const data = await readAsBase64(file);
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/ai/extract-contract", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ file: { name: file.name, type: file.type, data } }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "The contract could not be read");
      const c = out.contract || {};
      const k: PartyKind = ["customer", "supplier", "employee", "other"].includes(c.party_kind) ? c.party_kind : "other";
      const match = await findParty(k, c.party_name);
      setKind(match ? k : k === "employee" ? "employee" : k);
      setParty(match ? { ...match, contact: match.contact || c.party_contact } : { id: "", name: c.party_name || "", contact: c.party_contact, email: c.party_email, phone: c.party_phone, address: c.party_address, pin: c.party_pin });
      setF((x) => ({
        ...x, title: c.title || x.title, type: CONTRACT_TYPES.some((t) => t.key === c.type) ? c.type : x.type, area: CONTRACT_AREAS.some((a) => a.key === c.area) ? c.area : "general",
        value: c.value ? String(c.value) : "", currency: c.currency || "KES", start: /^\d{4}-\d{2}-\d{2}$/.test(c.start_date || "") ? c.start_date : "", end: /^\d{4}-\d{2}-\d{2}$/.test(c.end_date || "") ? c.end_date : "",
        renewal: ["none", "notify", "auto"].includes(c.renewal) ? c.renewal : "notify", notice: String(c.notice_days || 30), signed: !!c.signed_by_both, body: c.full_text || "", summary: c.summary || "",
      }));
      setRead(true);
      toast.success("Contract read", { description: `${match ? `Matched ${match.name}. ` : ""}Check the particulars, then save.${out.truncated ? " It is long: the end of the text may be cut; the file is kept in full." : ""}` });
    } catch (e) { toast.error(friendlyError(e), { description: "Fill in the particulars yourself; the file is still saved." }); } finally { setReading(false); }
  };
  const pick = (file: File | null) => { setFile(file); setRead(false); if (file) void readIt(file); };

  const save = async () => {
    if (!file) return toast.error("Choose the contract file");
    if (!party?.name?.trim()) return toast.error("Choose or type the other party");
    if (file.size > 20 * 1024 * 1024) return toast.error("The file must be under 20 MB");
    setBusy(true);
    try {
      const title = f.title.trim() || `${typeLabel(f.type)} — ${party.name}`;
      const live = f.start && f.start > new Date().toISOString().slice(0, 10) ? "signed" : "active";
      const { data, error } = await sb.from("contracts").insert({
        title, type: f.type, area: f.area, party_kind: kind, party_id: party.id || null, party_name: party.name, party_contact: party.contact || null, party_email: party.email || null,
        party_phone: party.phone || null, party_address: party.address || null, party_pin: party.pin || null, value: Number(f.value || 0), currency: f.currency || "KES", start_date: f.start || null, end_date: f.end || null,
        renewal: f.renewal, notice_days: Number(f.notice || 30), source: "uploaded", status: f.signed ? live : "sent", owner_id: user?.id, sent_at: f.signed ? null : new Date().toISOString(),
        party_signed_at: f.signed ? new Date().toISOString() : null, party_signer_name: f.signed ? party.contact || party.name : null, body: f.body,
      }).select("id,number").single();
      if (error) throw error;
      // Filed in Documents → Contracts, in this contract's folder.
      const doc = await uploadDocument(tenantId!, file, { entity_type: "contract", entity_id: data.id, entity_name: `${data.number} · ${party.name} — ${title}`, category: f.signed ? "Signed contract" : "Contract (to be signed)", expires_on: f.end || null, uploaded_by_name: profile?.display_name });
      await sb.from("contracts").update({ file_path: doc.path }).eq("id", data.id);
      if (f.body.trim()) await sb.from("contract_versions").insert({ contract_id: data.id, version: 1, body: f.body, note: "Text read from the uploaded file", created_by_name: profile?.display_name || null });
      await logEvent(data, "uploaded", profile?.display_name || null, `${f.signed ? "Uploaded the fully signed contract" : "Uploaded the contract to be signed by the other party"}${f.summary ? `\n${f.summary}` : ""}`);
      void qc.invalidateQueries({ queryKey: ["contracts"] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Contract saved", { description: f.signed ? "Expiry and renewal reminders are on." : "Share the link so they can sign it." });
      navigate(`/contracts/${data.id}`);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Upload a contract" icon={Upload} size="2xl" description="A contract already signed on paper, or one a customer or vendor sent you. Garage AI reads it and fills in the parties, dates and terms."
      footer={<Button onClick={() => void save()} disabled={busy || reading}>{busy && <OrbSpinner />} Save contract</Button>}>
      <div className="space-y-4">
        <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
        <button type="button" onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}
          className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-border p-6 text-sm hover:bg-muted/40">
          {reading ? <><OrbSpinner /><b>Reading the contract…</b><span className="text-xs text-muted-foreground">Parties, dates, value, renewal and the full text. This takes up to a minute for long contracts.</span></>
            : <><Upload className="h-5 w-5 text-muted-foreground" />{file ? <b>{file.name}</b> : <span>Choose or drop the PDF or photo of the contract</span>}{read && <span className="text-xs text-success">Read: check the particulars below</span>}</>}
        </button>
        {f.summary && <p className="rounded-xl bg-muted/60 p-3 text-sm"><b>In short:</b> {f.summary}</p>}
        <PartyPicker kind={kind} setKind={setKind} party={party} setParty={setParty} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title" className="sm:col-span-2 lg:col-span-3"><input className="fi" value={f.title} placeholder="e.g. Supply of laptops — Tender 12/2026" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Type"><select className="fi" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ContractType })}>{CONTRACT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
          <Field label="Area"><select className="fi" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as ContractArea })}>{CONTRACT_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
          <Field label={`Value (${f.currency || "KES"})`}><input className="fi" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <Field label="Starts"><input type="date" className="fi" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Ends (expiry)"><input type="date" className="fi" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label="Notice period (days)"><input className="fi" inputMode="numeric" value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /></Field>
          <Field label="At the end"><select className="fi" value={f.renewal} onChange={(e) => setF({ ...f, renewal: e.target.value as any })}><option value="notify">Remind me to renew</option><option value="auto">Renew automatically</option><option value="none">Just end</option></select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.signed} onChange={(e) => setF({ ...f, signed: e.target.checked })} /> It is already signed by both sides</label>
        </div>
        {f.body && <p className="text-xs text-muted-foreground">The full text was read too ({f.body.split(/\s+/).length.toLocaleString()} words): you can edit it on the contract after saving.</p>}
      </div>
    </Modal>
  );
}

/** New contract: write one from a template, or upload one that already exists. */
function NewChooser({ onPick, onClose }: { onPick: (k: "write" | "upload") => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="New contract" icon={FileSignature} size="xl" description="Write a new contract, or bring in one that already exists.">
      <div className="grid gap-3 sm:grid-cols-2">
        {([["write", Sparkles, "Write from a template", "Choose the type and area and the customer, vendor or employee. A full draft is written with their details, ready to edit, sign and send."],
          ["upload", Upload, "Upload an existing contract", "A PDF or photo of a contract already drafted or signed. Garage AI reads it and sets the parties, dates, expiry, value and renewal for you."]] as const).map(([k, Icon, t, d]) => (
          <button key={k} type="button" onClick={() => onPick(k)} className="group flex flex-col gap-2 rounded-2xl border-2 border-border p-5 text-left transition-all hover:border-primary hover:bg-primary/5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon className="h-5 w-5" /></span>
            <b>{t}</b><span className="text-sm text-muted-foreground">{d}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
