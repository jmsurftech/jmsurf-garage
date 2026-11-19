// Contract drafts: pick a type and an area, choose the customer, vendor or
// employee, and a complete first draft is written with both parties' details.
// Body format: numbered headings ("3. PAYMENT") and clauses ("3.1 …"),
// paragraphs separated by blank lines. ContractPaper and contractPdf render it.

export type PartyKind = "customer" | "supplier" | "employee" | "other";

export const CONTRACT_TYPES = [
  { key: "nda", label: "Non-disclosure agreement (NDA)", hint: "Keep shared information confidential, both ways." },
  { key: "service", label: "Service agreement", hint: "Services delivered for a fee." },
  { key: "supply", label: "Supply / tender contract", hint: "Goods delivered over a period, e.g. after a tender award." },
  { key: "sales", label: "Sale of goods", hint: "A one-off sale of goods." },
  { key: "consultancy", label: "Consultancy agreement", hint: "An independent consultant engaged for a project." },
  { key: "employment", label: "Employment contract", hint: "Employer and employee terms." },
  { key: "sla", label: "Service level agreement (SLA)", hint: "Uptime, response and resolution targets with credits." },
  { key: "maintenance", label: "Maintenance and support", hint: "Planned maintenance and repairs." },
  { key: "licence", label: "Software / licence agreement", hint: "Right to use software or content." },
  { key: "lease", label: "Lease / rental agreement", hint: "Premises or equipment rented for a period." },
  { key: "agency", label: "Distribution / agency agreement", hint: "A distributor or agent sells on our behalf." },
  { key: "partnership", label: "Partnership / joint venture", hint: "Working together and sharing results." },
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number]["key"];

export const CONTRACT_AREAS = [
  { key: "general", label: "General" },
  { key: "it", label: "IT, software and telecoms" },
  { key: "construction", label: "Construction and engineering" },
  { key: "healthcare", label: "Healthcare and pharmacy" },
  { key: "finance", label: "Finance, insurance and SACCOs" },
  { key: "education", label: "Education and training" },
  { key: "hospitality", label: "Hospitality and events" },
  { key: "manufacturing", label: "Manufacturing" },
  { key: "agriculture", label: "Agriculture and food" },
  { key: "logistics", label: "Transport and logistics" },
  { key: "retail", label: "Retail and wholesale" },
  { key: "realestate", label: "Real estate and property" },
  { key: "energy", label: "Energy and utilities" },
  { key: "public", label: "Government and public tenders" },
  { key: "ngo", label: "NGOs and donor-funded projects" },
  { key: "security", label: "Security and facilities" },
] as const;
export type ContractArea = (typeof CONTRACT_AREAS)[number]["key"];

export type DraftParty = { name: string; contact?: string | null; email?: string | null; phone?: string | null; address?: string | null; pin?: string | null; idNo?: string | null };
export type DraftInput = {
  type: ContractType; area: ContractArea; partyKind: PartyKind;
  company: DraftParty; party: DraftParty;
  value?: number; currency?: string; start?: string | null; end?: string | null; noticeDays?: number; renewal?: "none" | "notify" | "auto";
  /** Employment: job title, monthly pay, place of work; others: what is supplied. */
  role?: string | null; scope?: string | null; place?: string | null; paymentDays?: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (d?: string | null) => { if (!d) return "the date of the last signature"; const x = new Date(d); return isNaN(x.getTime()) ? d : `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const money = (n = 0, ccy = "KES") => `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What each side is called in this kind of contract. */
export function contractRoles(type: ContractType, kind: PartyKind): { us: string; them: string } {
  const theySupply = kind === "supplier";
  switch (type) {
    case "nda": return { us: "First Party", them: "Second Party" };
    case "employment": return { us: "Employer", them: "Employee" };
    case "consultancy": return theySupply || kind === "employee" || kind === "other" ? { us: "Client", them: "Consultant" } : { us: "Consultant", them: "Client" };
    case "supply": return theySupply ? { us: "Purchaser", them: "Supplier" } : { us: "Supplier", them: "Purchaser" };
    case "sales": return theySupply ? { us: "Buyer", them: "Seller" } : { us: "Seller", them: "Buyer" };
    case "licence": return theySupply ? { us: "Licensee", them: "Licensor" } : { us: "Licensor", them: "Licensee" };
    case "lease": return theySupply ? { us: "Tenant", them: "Landlord" } : { us: "Landlord", them: "Tenant" };
    case "agency": return { us: "Principal", them: kind === "supplier" ? "Agent" : "Distributor" };
    case "partnership": return { us: "First Partner", them: "Second Partner" };
    default: return theySupply ? { us: "Client", them: "Service Provider" } : { us: "Service Provider", them: "Client" };
  }
}

export function contractTitle(type: ContractType, area: ContractArea) {
  const t = CONTRACT_TYPES.find((x) => x.key === type)?.label.replace(/\s*\(.*\)$/, "") || "Agreement";
  const a = area === "general" ? "" : ` (${CONTRACT_AREAS.find((x) => x.key === area)?.label.split(",")[0]})`;
  return `${t}${a}`;
}

type Clause = [string, string[]]; // heading, clauses

/** Writes a complete first draft. */
export function draftContract(i: DraftInput): { title: string; body: string } {
  const r = contractRoles(i.type, i.partyKind);
  const ccy = i.currency || "KES";
  const value = Number(i.value || 0);
  const days = i.paymentDays ?? 30;
  const notice = i.noticeDays ?? 30;
  const us = `the ${r.us}`, them = `the ${r.them}`;
  const scope = (i.scope || "").trim();
  const title = contractTitle(i.type, i.area);

  const who = (p: DraftParty, role: string) => [
    `${p.name || "____________________"}${p.pin ? `, KRA PIN ${p.pin}` : ""}${p.idNo ? `, ID No. ${p.idNo}` : ""}`,
    p.address ? `of ${p.address}` : "",
    [p.phone, p.email].filter(Boolean).join(", ") ? `(${[p.phone, p.email].filter(Boolean).join(", ")})` : "",
    `("${role}")`,
  ].filter(Boolean).join(" ");

  const term = i.end
    ? `This Agreement starts on ${longDate(i.start)} and ends on ${longDate(i.end)}, unless ended earlier under clause "Termination".`
    : `This Agreement starts on ${longDate(i.start)} and continues until ended under clause "Termination".`;
  const renew = i.renewal === "auto"
    ? `It renews automatically for the same period unless either party gives written notice at least ${notice} days before the end date.`
    : i.renewal === "notify" ? `The parties may renew it in writing before the end date, on the same or agreed new terms.` : `It does not renew automatically.`;

  const main: Clause[] = [];
  const pay = (what: string): Clause => ["PAYMENT", [
    value ? `${cap(what)} is ${money(value, ccy)}${i.type === "employment" ? " per month, before statutory deductions" : ", exclusive of VAT unless stated otherwise"}.` : `${cap(what)} is as set out in the quotation, purchase order or schedule agreed in writing.`,
    i.type === "employment" ? `Salary is paid by the last working day of each month, after PAYE, the Social Health Insurance Fund (SHIF), NSSF, the Affordable Housing Levy and any other deductions required by law or agreed in writing.`
      : `Invoices are payable within ${days} days of receipt. Each invoice shall be a valid KRA eTIMS tax invoice where the law requires one.`,
    i.type === "employment" ? "" : `Amounts not disputed in writing within 7 days of an invoice are treated as accepted. Disputed amounts are settled in good faith; the undisputed part is paid on time.`,
    i.type === "employment" ? "" : `Withholding tax and withholding VAT, where they apply, are deducted and a certificate is given to the other party.`,
  ].filter(Boolean)];

  switch (i.type) {
    case "nda":
      main.push(["PURPOSE", [`The parties intend to share information to evaluate or carry out ${scope || "a possible business relationship"} (the "Purpose").`]]);
      main.push(["CONFIDENTIAL INFORMATION", [
        `"Confidential Information" means all information shared by one party (the discloser) with the other (the recipient), in any form, that is marked confidential or that a reasonable person would treat as confidential, including prices, customers, plans, software, designs, know-how and financial information.`,
        `It does not include information that is or becomes public without the recipient's fault, that the recipient already lawfully had, that the recipient receives lawfully from someone else without a duty of confidence, or that the recipient develops independently.`,
      ]]);
      main.push(["OBLIGATIONS", [
        `The recipient shall use Confidential Information only for the Purpose, keep it secure with at least the care it uses for its own, and share it only with employees, officers and advisers who need it for the Purpose and are bound by similar duties.`,
        `The recipient may disclose Confidential Information when required by law, a court or a regulator, after telling the discloser promptly (where allowed) so it can seek protection.`,
        `On request, or when the Purpose ends, the recipient shall return or destroy the Confidential Information and confirm this in writing, except copies it must keep by law.`,
      ]]);
      main.push(["DURATION OF CONFIDENTIALITY", [`These duties last for 3 years after this Agreement ends, and for trade secrets and personal data for as long as they remain such.`]]);
      main.push(["NO LICENCE OR COMMITMENT", [`No rights in the Confidential Information are given except as stated. Nothing here obliges either party to enter into any further agreement.`]]);
      break;
    case "employment":
      main.push(["APPOINTMENT", [
        `${cap(us)} employs ${them} as ${i.role || "____________________"}${i.place ? `, based at ${i.place}` : ""}. ${cap(them)} reports to the person ${us} names and performs the duties of the role and other reasonable duties given.`,
        `The first 3 months are a probation period. During probation either party may end employment by giving 7 days' notice or pay in lieu.`,
      ]]);
      main.push(["HOURS AND LEAVE", [
        `Normal working hours are 8 hours a day, Monday to Friday, and as reasonably needed for the role, within the limits of the Employment Act, 2007.`,
        `${cap(them)} is entitled to 21 working days of paid annual leave per year, public holidays, sick leave and maternity or paternity leave in line with the Employment Act, 2007.`,
      ]]);
      main.push(pay("the gross salary"));
      main.push(["CONDUCT AND CONFIDENTIALITY", [
        `${cap(them)} shall follow ${us}'s lawful policies and instructions, act honestly, and avoid conflicts of interest.`,
        `${cap(them)} shall keep ${us}'s confidential information secret during and after employment, and return all property, documents and data on leaving.`,
        `Work created in the course of employment belongs to ${us}.`,
      ]]);
      main.push(["ENDING EMPLOYMENT", [
        `After probation, either party may end employment by giving ${Math.max(notice, 28)} days' written notice or pay in lieu of notice.`,
        `${cap(us)} may end employment summarily for gross misconduct as defined in the Employment Act, 2007, after giving ${them} a fair hearing.`,
        `On leaving, ${them} receives a certificate of service and any pay and leave due.`,
      ]]);
      break;
    case "sales":
      main.push(["GOODS", [scope ? `${cap(r.us === "Seller" ? us : them)} sells and ${r.us === "Seller" ? them : us} buys: ${scope}.` : `The goods, quantities and prices are as set out in the attached quotation or schedule (the "Goods").`]]);
      main.push(["DELIVERY, RISK AND OWNERSHIP", [
        `The Goods are delivered ${i.place ? `to ${i.place}` : "to the agreed delivery address"} on or before the agreed date, with a delivery note.`,
        `Risk passes to the buyer on delivery. Ownership passes when the price has been paid in full.`,
        `The buyer inspects the Goods on delivery and reports shortages or visible damage within 3 working days; hidden defects within 14 days of discovery.`,
      ]]);
      main.push(pay("the price"));
      main.push(["WARRANTY", [`The seller warrants that the Goods match their description, are of good quality, fit for their usual purpose and free from claims by others. Faulty Goods are repaired, replaced or refunded at the seller's choice.`]]);
      break;
    case "supply":
      main.push(["SUPPLY", [
        scope ? `${cap(r.us === "Supplier" ? us : them)} supplies: ${scope}.` : `The goods, specifications, quantities and unit prices are listed in the schedule, tender award or purchase orders issued under this Agreement (the "Goods").`,
        `Each purchase order issued under this Agreement forms part of it. If they conflict, this Agreement prevails unless the purchase order expressly says otherwise.`,
        value ? `The total value of supplies under this Agreement is not expected to exceed ${money(value, ccy)} unless agreed in writing.` : "",
      ].filter(Boolean)]);
      main.push(["DELIVERY AND INSPECTION", [
        `Goods are delivered ${i.place ? `to ${i.place}` : "to the delivery points named in each order"}, on the dates stated, with a delivery note quoting the order number.`,
        `The purchaser may inspect and test the Goods and reject any that do not meet the specification within 7 days of delivery. Rejected Goods are collected and replaced by the supplier at its cost.`,
        `If the supplier delivers late without good reason, the purchaser may charge liquidated damages of 0.5% of the value of the late Goods for each week of delay, up to 10%, or buy elsewhere and recover the extra cost.`,
      ]]);
      main.push(pay("the price for each delivery"));
      main.push(["PERFORMANCE SECURITY", [`Where the tender or order requires it, the supplier provides a performance security (bank or insurance guarantee) for the stated amount, valid until all Goods are delivered and accepted.`]]);
      break;
    case "consultancy":
      main.push(["SERVICES AND DELIVERABLES", [
        `${cap(r.them === "Consultant" ? them : us)} provides: ${scope || "the services and deliverables described in the schedule"} (the "Services").`,
        `The consultant decides how the Services are carried out, uses suitably skilled people, and keeps the client informed of progress.`,
      ]]);
      main.push(["INDEPENDENT CONTRACTOR", [`The consultant is an independent contractor, not an employee. The consultant is responsible for its own taxes, statutory contributions and insurance. Withholding tax is deducted where the law requires.`]]);
      main.push(pay("the fee"));
      main.push(["OWNERSHIP OF WORK", [`On payment, the client owns the deliverables made for it. The consultant keeps its existing know-how and tools and grants the client a free licence to use any that are built into the deliverables.`]]);
      break;
    case "sla":
    case "maintenance":
    case "service":
      main.push(["SERVICES", [
        `${cap(r.us === "Service Provider" ? us : them)} provides: ${scope || "the services described in the attached schedule or quotation"} (the "Services").`,
        `The Services are performed with reasonable skill and care, by suitably qualified people, in line with good industry practice and applicable law.`,
        `The client gives timely access, information and decisions the provider reasonably needs.`,
      ]]);
      if (i.type === "sla") main.push(["SERVICE LEVELS", [
        `Availability target: 99.5% per month, measured outside agreed maintenance windows.`,
        `Response and resolution targets: Critical (service down) — respond within 1 hour, resolve or work around within 4 hours; High — 4 hours / 1 working day; Normal — 1 working day / 5 working days.`,
        `If availability falls below the target in a month, the client receives a service credit of 5% of that month's fee for each 1% below target, up to 30%. Credits are the client's main remedy for missed service levels, without limiting rights for repeated or serious failure.`,
        `The provider sends a monthly service report showing availability, tickets and times.`,
      ]]);
      if (i.type === "maintenance") main.push(["MAINTENANCE", [
        `Planned maintenance visits are carried out on the agreed schedule, with a signed job card for each visit.`,
        `Breakdowns reported by the client are attended within 24 hours (or as agreed). Spare parts are charged at agreed rates unless included.`,
      ]]);
      main.push(pay("the fee"));
      break;
    case "licence":
      main.push(["LICENCE", [
        `${cap(r.us === "Licensor" ? us : them)} grants ${r.us === "Licensor" ? them : us} a non-exclusive, non-transferable right to use ${scope || "the software, documentation and updates described in the schedule"} (the "Software") for its own business during this Agreement.`,
        `The licensee shall not copy (except for backup), resell, reverse engineer or let others use the Software, except as allowed by law or in writing.`,
        `The licensor provides updates and support during business hours, and fixes reported defects within a reasonable time.`,
      ]]);
      main.push(pay("the licence fee"));
      main.push(["OWNERSHIP AND INFRINGEMENT", [`All intellectual property in the Software stays with the licensor. The licensor defends the licensee against claims that the Software infringes another's rights, and may modify or replace it to avoid infringement.`]]);
      break;
    case "lease":
      main.push(["PROPERTY", [`${cap(r.us === "Landlord" ? us : them)} lets to ${r.us === "Landlord" ? them : us} ${scope || i.place || "the premises or equipment described in the schedule"} (the "Property").`]]);
      main.push(["RENT AND DEPOSIT", [
        value ? `Rent is ${money(value, ccy)} per month, payable in advance by the 5th day of each month.` : `Rent is as stated in the schedule, payable monthly in advance by the 5th day of each month.`,
        `A refundable deposit equal to one month's rent is paid on signing and returned within 30 days of the end, less unpaid rent and the cost of repairing damage beyond fair wear and tear.`,
        `Rent may be reviewed once a year by written agreement.`,
      ]]);
      main.push(["USE AND CARE", [
        `The tenant uses the Property only for lawful business purposes, keeps it clean and in good condition, and does not make structural changes or sublet without written consent.`,
        `The landlord keeps the structure and main services in repair and allows the tenant quiet enjoyment.`,
      ]]);
      break;
    case "agency":
      main.push(["APPOINTMENT AND TERRITORY", [
        `${cap(us)} appoints ${them} to promote and sell ${scope || "its products and services"}${i.place ? ` in ${i.place}` : " in the agreed territory"}. The appointment is non-exclusive unless stated in writing.`,
        `${cap(them)} uses ${us}'s brand only as approved, and gives monthly sales and stock reports.`,
        `Minimum targets, discounts or commission are as set out in the schedule.`,
      ]]);
      main.push(pay("each order"));
      break;
    case "partnership":
      main.push(["PURPOSE AND CONTRIBUTIONS", [
        `The parties will work together on ${scope || "the project described in the schedule"} (the "Project").`,
        `Each party makes the contributions (money, people, equipment, know-how) set out in the schedule. Costs and income are shared ${value ? `on a budget of ${money(value, ccy)} and ` : ""}in the agreed proportions.`,
        `A joint committee with one representative from each party meets monthly to manage the Project. Decisions need both parties' agreement.`,
        `Neither party may bind the other or create debts in the other's name without written approval.`,
      ]]);
      break;
  }

  const area = AREA_TERMS[i.area] || [];
  const general: Clause[] = [
    ...(i.type === "nda" ? [] : [["CONFIDENTIALITY", [`Each party keeps the other's confidential information secret and uses it only for this Agreement, during it and for 3 years after.`]] as Clause]),
    ["DATA PROTECTION", [`Each party complies with the Data Protection Act, 2019 when handling personal data under this Agreement, keeps it secure, uses it only for this Agreement, and reports any data breach to the other without delay.`]],
    ...(i.type === "employment" ? [] : [["LIABILITY", [
      `Neither party is liable for indirect or consequential loss, loss of profit or loss of data.`,
      `Each party's total liability under this Agreement is limited to the amounts paid or payable under it in the 12 months before the claim, except for fraud, death or personal injury caused by negligence, breach of confidentiality, or amounts that cannot be limited by law.`,
    ]] as Clause, ["INSURANCE", [`Each party keeps insurance suitable for its obligations under this Agreement with reputable insurers, and shows proof on request.`]] as Clause]),
    ["BREACH AND REMEDY", [
      `If a party breaches this Agreement, the other may give written notice describing the breach. The party in breach shall remedy it within 14 days (or another reasonable period stated in the notice).`,
      `Each breach notice and remedy is recorded by both parties. Repeated breaches of the same kind may be treated as a material breach.`,
    ]],
    ["TERMINATION", [
      `Either party may end this Agreement by giving ${notice} days' written notice.`,
      `Either party may end it immediately by written notice if the other commits a material breach not remedied within the remedy period, becomes insolvent, or is unable to perform for more than 60 days because of force majeure.`,
      `On termination, amounts due for work done or goods delivered up to the termination date are paid, and each party returns the other's property and confidential information.`,
    ]],
    ["FORCE MAJEURE", [`A party is not liable for delay or failure caused by events beyond its reasonable control (such as natural disasters, epidemics, war, riots, government action or national power or network outages), if it tells the other promptly and does its best to limit the effect.`]],
    ["AMENDMENTS", [`This Agreement may be changed only by a written amendment signed (including electronically) by both parties. Each amendment is numbered and forms part of this Agreement.`]],
    ["DISPUTES", [
      `The parties first try to settle any dispute through good-faith talks between senior representatives within 14 days.`,
      `If not settled, either party may refer it to mediation, and failing that to arbitration in Nairobi by a single arbitrator under the Arbitration Act, 1995, appointed by agreement or, failing agreement, by the Chairperson of the Chartered Institute of Arbitrators (Kenya Branch). This does not prevent either party from seeking urgent orders from a court.`,
    ]],
    ["NOTICES", [`Notices are given in writing to the addresses or email addresses above, and are received on delivery by hand, on the next working day after email (unless a bounce is received), or 3 working days after posting.`]],
    ["GENERAL", [
      `This Agreement is the whole agreement between the parties on its subject and replaces earlier discussions.`,
      `Neither party may transfer this Agreement without the other's written consent, which shall not be unreasonably withheld.`,
      `If any part is found invalid, the rest stays in force. A delay in using a right is not a waiver of it.`,
      `This Agreement is governed by the laws of Kenya.`,
      `This Agreement may be signed electronically and in counterparts. Electronic signatures and signed copies sent electronically have the same effect as originals.`,
    ]],
  ];

  const sections: Clause[] = [
    ["TERM", [term, renew]],
    ...main,
    ...(area.length ? [["SECTOR TERMS", area] as Clause] : []),
    ...general,
  ];

  const out: string[] = [];
  out.push(title.toUpperCase());
  out.push("");
  out.push(`This Agreement is made on ${longDate(i.start)} between:`);
  out.push("");
  out.push(`(1) ${who(i.company, r.us)}; and`);
  out.push("");
  out.push(`(2) ${who(i.party, r.them)}${i.party.contact && i.party.contact !== i.party.name ? `, represented by ${i.party.contact}` : ""}.`);
  out.push("");
  out.push(`The ${r.us} and the ${r.them} are each a "party" and together the "parties". They agree as follows:`);
  sections.forEach(([h, cl], n) => {
    out.push("");
    out.push(`${n + 1}. ${h}`);
    cl.forEach((c, k) => { out.push(""); out.push(`${n + 1}.${k + 1} ${c}`); });
  });
  out.push("");
  out.push(`SIGNED by the parties on the dates shown below.`);
  return { title, body: out.join("\n") };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const AREA_TERMS: Partial<Record<ContractArea, string[]>> = {
  it: [
    `Systems and data are protected with industry-standard security (access control, encryption in transit, backups and patching). Security incidents affecting the other party are reported within 24 hours.`,
    `Client data stays the client's property. On request, and when this Agreement ends, it is returned in a usable format and then deleted from the provider's systems.`,
    `Source code, credentials and documentation for work paid for by the client are handed over on completion, unless agreed otherwise.`,
    `Any cross-border transfer of personal data follows the Data Protection Act, 2019 and its regulations.`,
  ],
  construction: [
    `Works follow the approved drawings, specifications and bill of quantities, the National Construction Authority requirements and county approvals. The contractor holds the right NCA registration category.`,
    `The contractor keeps the site safe under the Occupational Safety and Health Act, 2007, provides protective equipment, and keeps a site diary.`,
    `Payment is by interim certificates for work done, less 10% retention, half released on practical completion and the rest after a 6-month defects liability period.`,
    `Variations are carried out only on a written instruction stating the change in price and time.`,
  ],
  healthcare: [
    `Patient information is confidential and handled under the Data Protection Act, 2019, the Health Act, 2017 and professional codes.`,
    `Medicines and medical devices supplied are registered or authorised by the Pharmacy and Poisons Board, stored in the right conditions (cold chain where needed), and delivered with batch numbers and expiry dates of at least 12 months, unless agreed otherwise.`,
    `Staff providing clinical services hold current practising licences from the relevant regulatory body.`,
  ],
  finance: [
    `Each party complies with anti-money-laundering and know-your-customer laws, including the Proceeds of Crime and Anti-Money Laundering Act, 2009, and with the requirements of its regulator.`,
    `Financial records are kept accurately and made available for audit by the other party or its regulator on reasonable notice.`,
  ],
  education: [
    `Learning materials and curricula remain the property of their author unless assigned in writing. Learner records are confidential.`,
    `Staff working with minors undergo background checks, and the parties follow child-protection rules.`,
  ],
  hospitality: [
    `Food handled under this Agreement complies with the Food, Drugs and Chemical Substances Act and county health licences; food handlers hold valid medical certificates.`,
    `Bookings cancelled less than 14 days before the event may be charged as set out in the schedule, except for force majeure.`,
  ],
  manufacturing: [
    `Products meet the agreed specifications and relevant Kenya Bureau of Standards (KEBS) standards, with certificates of conformity on request.`,
    `Each batch is traceable by batch number. Defective batches are recalled and replaced at the supplier's cost.`,
  ],
  agriculture: [
    `Produce meets the agreed grade, moisture content and food-safety standards, and is free from banned pesticides and residues above legal limits.`,
    `Prices for later deliveries may be adjusted in writing if official market prices change by more than 15%.`,
  ],
  logistics: [
    `The carrier is responsible for goods from collection until delivery, keeps goods-in-transit insurance, and gives proof of delivery for each consignment.`,
    `Vehicles are roadworthy, insured and driven by licensed drivers under the Traffic Act and NTSA rules. Loss or damage is reported within 24 hours.`,
  ],
  retail: [
    `Products are supplied with clear labelling, barcodes where agreed, and minimum remaining shelf life of 70% at delivery for perishable goods.`,
    `Unsold or damaged stock is handled as set out in the schedule (returns, credit notes or write-off).`,
  ],
  realestate: [
    `Service charges, utilities and county rates are paid as set out in the schedule. The Property is used in line with planning approvals.`,
    `Entry for inspection or repairs is given on 24 hours' notice, except in emergencies.`,
  ],
  energy: [
    `Installations meet the Energy and Petroleum Regulatory Authority (EPRA) requirements and are done by licensed technicians.`,
    `Meter readings are the basis of billing; either party may ask for a meter test, paid for by the party proved wrong.`,
  ],
  public: [
    `This Agreement follows the tender award and the Public Procurement and Asset Disposal Act, 2015. The tender documents, bid and award letter form part of it.`,
    `The supplier confirms it has not given or offered any inducement to win this contract, and will keep valid tax compliance and AGPO or other registrations as required.`,
    `Payment is made on submission of a valid invoice, delivery note and inspection and acceptance certificate.`,
  ],
  ngo: [
    `Funds are used only for the approved budget and activities. Changes over 10% of a budget line need written approval.`,
    `Financial and narrative reports are given as set out in the schedule. Records are kept for 7 years for audit by the donor.`,
    `Both parties follow safeguarding, anti-fraud and anti-terrorism financing policies of the donor.`,
  ],
  security: [
    `Guards are vetted, trained and licensed under the Private Security Regulation Act, 2016, and are paid at least the legal minimum wage.`,
    `Incidents are reported immediately and recorded in the occurrence book. The provider keeps public liability insurance.`,
  ],
};

/** Parses the body into title, heading and clause blocks for display. */
export function contractBlocks(body: string): { kind: "title" | "heading" | "clause" | "para"; text: string; num?: string }[] {
  const out: { kind: "title" | "heading" | "clause" | "para"; text: string; num?: string }[] = [];
  const paras = body.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((p, i) => {
    const h = p.match(/^(\d+)\.\s+([^\n]+)$/);
    const c = p.match(/^(\d+\.\d+(?:\.\d+)*)\s+([\s\S]+)$/);
    if (i === 0 && p === p.toUpperCase() && p.length < 120 && !/^\d/.test(p)) out.push({ kind: "title", text: p });
    else if (h && h[2] === h[2].toUpperCase()) out.push({ kind: "heading", num: h[1], text: h[2] });
    else if (c) out.push({ kind: "clause", num: c[1], text: c[2] });
    else out.push({ kind: "para", text: p });
  });
  return out;
}
