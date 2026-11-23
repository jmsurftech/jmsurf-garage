/**
 * The words of the website's guide pages: garage types (/for/...), buyer guides
 * (/guides/...), the questions page (/faq) and a few town pages (/garage-software/...).
 *
 * Shared by the live page (src/pages/ContentPage.tsx) and the build-time snapshots
 * (src/seo/pages.ts), so search engines and AI assistants read exactly what visitors see.
 * Plain data only. Prices are worked out from src/lib/garagePlans.ts and src/lib/modules.ts
 * (the same defaults the plans and platform_modules tables were seeded with), never typed in.
 * Rules: true facts only (what the code does), no invented customers or numbers, no rival names.
 */
import { DEFAULT_CATALOGUE, DEFAULT_PLANS, EXTRA_BRANCH_PRICE, TRIAL_DAYS, YEAR_MONTHS, priceBox, type GaragePlan } from "@/lib/garagePlans";
import { MODULE_BY_KEY, PUBLIC_MODULES } from "@/lib/modules";
import type { PhotoKey } from "@/lib/photos";
import { HOME } from "./homeContent";

export interface Table { caption: string; head: string[]; rows: string[][] }
export interface Block {
  h: string;
  p?: string[];
  list?: string[];
  table?: Table;
  /** Links with a line about each: [label, path, description]. */
  links?: [string, string, string][];
  /** A paragraph after the list / table / links. */
  after?: string[];
}
export type ContentGroup = "for" | "guides" | "faq" | "places";
export interface ContentPage {
  path: string;
  /** 50-60 characters. */
  title: string;
  /** 140-160 characters. */
  description: string;
  group: ContentGroup;
  /** Short name in the breadcrumb trail. */
  crumb: string;
  eyebrow: string;
  h1: string;
  lead: string;
  photo?: PhotoKey;
  blocks: Block[];
  faqs?: [string, string][];
  /** Module pages linked under "Modules for this". */
  modules?: string[];
  /** "Read next" links: [label, path]. */
  related: [string, string][];
  /** Opening line of the WhatsApp message. */
  wa: string;
  /** Guides are articles (dated). */
  article?: boolean;
}

export const CONTENT_PUBLISHED = "2026-11-23";
export const PLAN_TABLE_HEADING = "Plans side by side";

/** The footer's Guides column (same as the live footer). */
export const FOOTER_GUIDES: [string, string][] = [
  ["Garage types", "/for"], ["Choosing garage software", "/guides/best-garage-management-software-kenya"], ["Garage software prices", "/guides/garage-software-price-kenya"],
  ["M-Pesa at a garage", "/guides/mpesa-payments-for-garages"], ["eTIMS for garages", "/guides/etims-invoices-for-garages"], ["Questions", "/faq"],
];

/** Fixed words on every guide page (the live page uses the same). */
export const CONTENT_LABELS = {
  start: "Start free for 14 days",
  whatsapp: "Book a demo on WhatsApp",
  modules: "Modules for this",
  faqs: "Questions",
  next: "Read next",
  updated: "Updated",
  finalText: "Set up in a few minutes. Free for 14 days, no card needed. Or talk to us first on WhatsApp or by phone on +254 712 504 593.",
};
export const SMS_PRICE_KES = 0.8;
export const SMS_MIN_TOPUP_KES = 50;
export const CUSTOM_DOMAIN_KES = 300;
export const WA_NUMBER = "254712504593";
export const waLink = (text: string) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

export const GROUP_PARENT: Record<ContentGroup, [string, string] | null> = {
  for: ["Garage types", "/for"],
  guides: ["Guides", "/guides"],
  faq: null,
  places: null,
};

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const plan = (code: string) => DEFAULT_PLANS.find((p) => p.code === code)!;
const mod = (key: string) => MODULE_BY_KEY[key];
const mp = (key: string) => kes(mod(key).price);
const total = (planCode: string, mods: string[], year = false) => priceBox(DEFAULT_CATALOGUE, planCode, mods, { cycle: year ? "year" : "month" }).total;
const usersOf = (p: GaragePlan) => (p.users >= 999999 ? "Any number" : String(p.users));
const branchesOf = (p: GaragePlan) => (p.branches >= 999 ? "Many" : String(p.branches));

/** A worked price for one kind of business: one row per line of the price box, then the totals. */
export function costBlock(h: string, intro: string, planCode: string, mods: string[], after: string[] = []): Block {
  const box = priceBox(DEFAULT_CATALOGUE, planCode, mods);
  const year = total(planCode, mods, true);
  return {
    h,
    p: [intro],
    table: {
      caption: `${box.plan.name} plan${mods.length ? ` with ${mods.map((k) => mod(k).name).join(", ")}` : ""}, KES per month, VAT excluded`,
      head: ["Item", "Per month"],
      rows: [
        ...box.lines.map((l) => [l.label, l.note ? `Included (${l.note})` : kes(l.amount)]),
        ["Total per month", kes(box.total)],
        ["Total per year (2 months free)", kes(year)],
      ],
    },
    after: [`Every module is free for the first ${TRIAL_DAYS} days, no card needed. You can add or remove modules later; a module you add is billed from that day.`, ...after],
  };
}

/** Plans side by side (pricing page, price guide). */
export function planTable(plans: GaragePlan[] = DEFAULT_PLANS): Table {
  return {
    caption: "JMSURF Garage plans, KES per garage, VAT excluded",
    head: ["Plan", "Per month", "Per year", "Users", "Branches", "Included"],
    rows: plans.map((p) => [
      p.name,
      p.quoteOnly ? "Priced for you" : kes(p.price),
      p.quoteOnly ? "Priced for you" : kes(p.priceYear),
      usersOf(p),
      branchesOf(p),
      p.bundle || p.quoteOnly ? "Garage Core and every garage module" : ["Garage Core", ...p.includes.map((k) => mod(k).name)].join(", "),
    ]),
  };
}

/** Every paid module and its monthly price. */
export function moduleTable(): Table {
  return {
    caption: "JMSURF Garage modules, KES per month, VAT excluded",
    head: ["Module", "Per month", "Included free in"],
    rows: PUBLIC_MODULES.filter((m) => !m.included).map((m) => [
      m.name, kes(m.price), (m.includedIn || []).map((c) => plan(c).name).join(", ") || "None",
    ]),
  };
}

const FUNDI = plan("fundi"), STARTER = plan("starter"), BUSINESS = plan("business"), PRO = plan("pro"), ALL = plan("all_modules");

/* ================================================================== garage types */

const FOR: ContentPage[] = [
  {
    path: "/for/mechanical-workshops", group: "for", crumb: "Mechanical workshops",
    title: "Mechanical Workshop Software for Kenya | JMSURF Garage",
    description: "Job cards, inspections with photos, a bay board, parts stock, M-Pesa and KRA eTIMS invoices for mechanical workshops in Kenya. 14 days free, no card needed.",
    eyebrow: "For mechanical workshops", h1: "Software for mechanical workshops in Kenya",
    lead: "Book cars in, inspect them, get the estimate approved on the customer's phone, fix them, invoice with eTIMS and get paid by M-Pesa, with every mechanic and every bay on one screen.",
    photo: "workshop",
    blocks: [
      { h: "What slows a busy workshop down", p: [
        "Most workshops do not lose money on the repair itself. They lose it around the repair: a job card that goes missing, a customer who cannot be reached to approve extra work, a part fitted but never billed, a car that leaves the gate before the balance is paid, a mechanic who is busy on one car while three others wait.",
        "JMSURF Garage puts every car on one list from the moment it arrives. The front desk, the mechanics and the owner see the same job card, the same estimate and the same balance, on a phone, a tablet or the office PC.",
      ] },
      { h: "How a car moves through your workshop", p: [
        "Every job card follows the same steps. The system will not let a job skip a step that matters: a car cannot be marked ready before it passes the quality check, and the gate pass checks the payment before the car is released.",
      ], list: [
        "Booked: the customer booked online or by phone.",
        "Checked in: customer, car, plate and mileage recorded. Returning cars bring their history.",
        "Diagnosing: the mechanic checks the car and notes what is wrong.",
        "Waiting approval: the estimate has gone to the customer by SMS or WhatsApp.",
        "Waiting parts: approved, waiting for parts to arrive.",
        "In progress: work on the car, with parts and labour added to the job.",
        "Quality check: final checks and road test before the car is ready.",
        "Ready: the customer gets an SMS that the car is ready, with the invoice and a way to pay.",
        "Collected: the gate pass is done and the car leaves.",
      ], after: ["Each job card shows how long the car spent waiting for approval or parts, as opposed to being worked on, so you can see where the hours go."] },
      { h: "Inspections and the bay board", p: [
        "With Workshop Pro, mechanics run digital inspections on their phones. The multi-point inspection checks under the bonnet, brakes and suspension, tyres, underneath, and lights and electrics; each item is marked green, amber or red with a note and photos. There are also ready-made checklists for a pre-purchase inspection and for preparing a car for its NTSA inspection, and you can change any of them.",
        "The inspection goes to the customer with the estimate, so they see the worn brake pads for themselves. The bay board shows every car, the bay it is in and who is working on it, on a TV in the workshop, and the mechanic app lets each mechanic see their jobs and clock time on them.",
      ] },
      { h: "Parts on every job, and on the bill", p: [
        "Parts added to a job card come off stock by themselves, so what was fitted is what is billed. The parts queue shows which jobs are waiting for which parts. With Parts & Stock you get purchase orders, receiving, several stores and branches, reorder alerts and stock-takes.",
        "When the job is done, the invoice is made from the job card in one step, signed for KRA eTIMS, and the customer pays by M-Pesa from a prompt on their phone or from the link in their SMS.",
      ] },
      costBlock("What it costs a busy workshop",
        `The Business plan (up to ${BUSINESS.users} users) already includes Workshop Pro, Parts & Stock and Accounting, so a workshop with inspections, a bay board, full stock and books pays the plan price only.`,
        "business", ["workshop_pro", "inventory", "accounting"],
        [`A smaller workshop can start on Starter (${kes(STARTER.price)} a month, up to ${STARTER.users} users) and add Workshop Pro for ${mp("workshop_pro")} a month: ${kes(total("starter", ["workshop_pro"]))} in all.`]),
    ],
    faqs: [
      ["Can my mechanics use it on their phones?", "Yes. JMSURF Garage works in any browser and installs like an app on Android and iPhone. With Workshop Pro each mechanic gets a phone view of their own jobs, can add photos and clock time."],
      ["Can a customer approve only part of an estimate?", "Yes. The customer opens the estimate from the link and approves or declines each line, and can leave a note. You see the answer on the job card at once."],
      ["Do I need Workshop Pro for job cards?", "No. Job cards, bookings, estimates, service reminders and workshop reports are in Garage Core on every plan. Workshop Pro adds digital inspections, the bay board and the mechanic app."],
    ],
    modules: ["garage_core", "workshop_pro", "inventory", "accounting"],
    related: [["Job cards vs paper and spreadsheets", "/guides/job-cards-vs-paper"], ["KRA eTIMS invoices for garages", "/guides/etims-invoices-for-garages"], ["Garages that service company fleets", "/for/fleet-maintenance"], ["Pricing", "/pricing"]],
    wa: "Hello, I run a mechanical workshop and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/roadside-mechanics", group: "for", crumb: "Roadside fundis",
    title: "Software for Roadside Mechanics and Fundis | JMSURF Garage",
    description: `Job cards, M-Pesa receipts, KRA eTIMS invoices and SMS on your phone for the roadside fundi and one-man garage in Kenya, from KES ${FUNDI.price} a month. 14 days free.`,
    eyebrow: "For the roadside fundi", h1: "Garage software for the roadside fundi",
    lead: `Keep every job, every customer and every shilling on your phone. The Fundi plan costs ${kes(FUNDI.price)} a month and has everything a one-man garage needs.`,
    photo: "fundi",
    blocks: [
      { h: "Your garage is wherever you are working", p: [
        "A fundi working at the roadside, under a tree or at a customer's home does not have a desk, a printer or a filing cabinet. What you do have is a phone. JMSURF Garage runs in the phone's browser and installs like an app, so the job card, the customer's number and the money are with you all day.",
        "When a car comes in you take the plate, the mileage and what the customer says is wrong. The next time the same car comes back, its history is already there: what you did, which parts you fitted and what the customer paid.",
      ] },
      { h: "What the Fundi plan gives you", list: [
        "Job cards from the first car of the day to the last.",
        "Customers and their vehicles, with plates, mileage and history.",
        "Estimates sent by SMS or WhatsApp that the customer approves from a link.",
        "M-Pesa payments that mark the invoice paid by themselves.",
        "KRA eTIMS invoices when you are registered for VAT or need tax invoices.",
        "An SMS when the car is ready, and service reminders when it is due again.",
        "Basic parts stock, expenses and a simple owner's dashboard.",
        `Up to ${FUNDI.users} users, so a helper or a family member can use it too.`,
      ] },
      { h: "Why a fundi should keep records at all", p: [
        "Customers trust a mechanic who can show them what was done last time and send a proper receipt. Fleet owners, boda boda groups and businesses that send you their vehicles usually need an invoice before they pay, and more and more of them ask for an eTIMS invoice.",
        "Records also protect you. When a customer says the part you fitted failed, the job card shows the date, the part and the price. When you want a loan or a bigger space, a year of jobs and M-Pesa payments shows what your business really earns.",
      ] },
      { h: "Getting paid without chasing", p: [
        "When the job is done, send an M-Pesa prompt straight to the customer's phone, or send the invoice link and let them pay from it. The money goes to your own Till or Paybill, not to JMSURF, and the payment lands on the right invoice. For bigger jobs you can ask for a deposit by M-Pesa before you buy the parts.",
      ] },
      costBlock("What it costs",
        `The Fundi plan is the smallest JMSURF Garage plan: Garage Core for up to ${FUNDI.users} users and one branch.`,
        "fundi", [],
        [`SMS are paid as you use them: on the JMSURF SMS line they cost ${kes(SMS_PRICE_KES)} per SMS, topped up by M-Pesa from ${kes(SMS_MIN_TOPUP_KES)}. When you grow, move up to Starter or Business and keep all your records.`]),
    ],
    faqs: [
      ["Do I need a computer?", "No. Everything works on a smartphone with a browser. A computer or tablet is useful later, for example for a bay board, but it is not needed."],
      ["Does it work on slow data?", "The pages are made to load fast on mobile data and every screen has a phone layout. You do need a data connection to save jobs and send SMS."],
      ["Can I move to a bigger plan later?", "Yes. Moving up works at once and you pay only for the days left in your period. Your customers, vehicles and jobs stay as they are."],
    ],
    modules: ["garage_core", "workshop_pro"],
    related: [["How to take M-Pesa payments at a garage", "/guides/mpesa-payments-for-garages"], ["Garage software prices in Kenya", "/guides/garage-software-price-kenya"], ["Mechanical workshops", "/for/mechanical-workshops"], ["Questions garage owners ask", "/faq"]],
    wa: "Hello, I am a fundi and would like to try JMSURF Garage.",
  },
  {
    path: "/for/body-shops", group: "for", crumb: "Body and paint shops",
    title: "Body Shop and Panel Beating Software Kenya | JMSURF Garage",
    description: "Body and paint stages, before and after photos, paint and materials per job, insurance claims with assessor steps and excess billing for body shops in Kenya.",
    eyebrow: "For body and paint shops", h1: "Software for body shops and panel beaters",
    lead: "Follow every accident repair from strip-down to polish, cost the paint and materials on each car, and keep insurers, assessors and customers in step.",
    photo: "welding",
    blocks: [
      { h: "Accident repairs have more moving parts", p: [
        "A body shop job is rarely one person and one bill. There is the customer, the insurer, the assessor, sometimes a towing company, and a car that may sit in the shop for weeks while panels, paint and parts come in. Paper files and phone photos make it hard to know which cars are at which stage and what each one has really cost.",
        "With the Body & Paint module, every car moves through clear stages from strip-down through panel work, preparation and painting to finish and polish. Before and after photos are kept on the job and can go to the customer or the insurer.",
      ] },
      { h: "Paint and materials booked to the job", p: [
        "Paint, primer, filler, clear coat and other materials are booked to the job they were used on. That way the invoice can carry them and you can see the real cost of every repair, instead of finding out at the end of the month that the paint bill was higher than what you charged.",
      ] },
      { h: "Insurance work without lost claims", p: [
        "The Insurance Claims module records the claim, the insurer and the assessor, the photos and the assessment, and follows the approval. When the work is done the bill is split: the insurer's share goes to the insurer and the excess goes to the customer, each on its own invoice.",
        "You see what each insurer owes you and for how long. JMSURF Garage can send reminders by SMS when an insurer's invoice is past its payment terms, so money owed by insurers does not quietly grow old.",
      ], list: [
        "Claim, insurer, assessor and claim number on the job.",
        "Photos and documents attached to the claim.",
        "Approval steps before work starts.",
        "Excess billed to the customer, the rest to the insurer.",
        "Statements and amounts owed per insurer.",
      ] },
      { h: "The rest of the garage comes with it", p: [
        "Body jobs use the same customers, vehicles, job cards, M-Pesa payments and KRA eTIMS invoices as the rest of JMSURF Garage. If you also do mechanical work, the same car can have a body job and a mechanical job open at the same time, and the customer gets one set of updates by SMS.",
      ] },
      costBlock("What it costs a body shop",
        `A small body shop on the Starter plan (up to ${STARTER.users} users) with Body & Paint and Insurance Claims:`,
        "starter", ["body_paint", "insurance"],
        [`The Pro plan (${kes(PRO.price)} a month, up to ${PRO.users} users and ${PRO.branches} branches) includes Insurance Claims, so a big body shop on Pro adds only Body & Paint: ${kes(total("pro", ["body_paint"]))} a month.`]),
    ],
    faqs: [
      ["Can I send photos to the insurer?", "Yes. Before and after photos are stored on the job and the claim, and you can share them with the insurer or the customer."],
      ["Can one car have both an insurance part and a customer part on the bill?", "Yes. The insurer is billed for its share and the customer for the excess, each on a separate KRA eTIMS invoice."],
      ["Do I need Insurance Claims to use Body & Paint?", "No. Body & Paint works on its own for cash customers. Insurance Claims adds the insurer, assessor and excess steps."],
    ],
    modules: ["body_paint", "insurance", "garage_core", "towing"],
    related: [["Towing and roadside call-outs", "/for/towing"], ["KRA eTIMS invoices for garages", "/guides/etims-invoices-for-garages"], ["Insurance Claims module", "/solutions/insurance"], ["Pricing", "/pricing"]],
    wa: "Hello, I run a body shop and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/car-washes", group: "for", crumb: "Car washes",
    title: "Car Wash Management Software with M-Pesa | JMSURF Garage",
    description: "A wash queue by number plate, packages and add-ons, attendants' commission, prepaid wash cards and M-Pesa at the bay for car washes and detailers in Kenya.",
    eyebrow: "For car washes and detailers", h1: "Car wash software with M-Pesa at the bay",
    lead: "Know how many cars you washed today, what each attendant earned and that every wash was paid for, without a notebook at the gate.",
    photo: "wash",
    blocks: [
      { h: "Where car wash money disappears", p: [
        "A busy car wash takes many small payments in a day. When washes are written in a book, or not written at all, it is hard to know how many cars came, which packages they took, which attendant washed them and whether all of it was paid. Commission is worked out by hand at the end of the week and arguments follow.",
        "The Car Wash & Detailing module puts every car in a queue by its number plate. The attendant is assigned, the package and add-ons are chosen, and the customer pays by M-Pesa at the bay. At the end of the day the numbers add up by themselves.",
      ] },
      { h: "How a wash is recorded", list: [
        "Type the plate: a returning car brings its owner and past washes.",
        "Choose the package, for example a body wash or a full valet, and any add-ons.",
        "Assign the attendant or attendants.",
        "Move the car from waiting to washing to done on the queue screen.",
        "Take payment by M-Pesa prompt, cash or a prepaid wash card.",
      ] },
      { h: "Commission and wash cards", p: [
        "Attendants' commission is worked out from the washes they did, so the weekly payout is a report rather than an argument. Regular customers can buy prepaid wash cards, and each wash is taken off the card when they come in.",
        "Because the wash uses the same customer list as the rest of JMSURF Garage, you can send SMS offers to customers who have not been in for a while, and if you also run a workshop, the same car's wash and repair history sit together.",
      ] },
      { h: "Payments that land on your own number", p: [
        "M-Pesa payments go to your own Till or Paybill. Each payment is recorded against the wash it was for, so the day's washes and the money received can be checked against each other.",
      ] },
      costBlock("What it costs a car wash",
        `A car wash on the Starter plan (up to ${STARTER.users} users) with Car Wash & Detailing:`,
        "starter", ["car_wash"],
        [`A small wash run by the owner and one or two helpers can use the Fundi plan instead: ${kes(total("fundi", ["car_wash"]))} a month with the Car Wash module.`]),
    ],
    faqs: [
      ["Can attendants use their own phones?", "Yes. Staff sign in with their own login and see only what their role allows. The queue works on a phone, a tablet or a PC."],
      ["Can I run a car wash and a garage in one account?", "Yes. Switch on the Car Wash module next to Garage Core and both share the same customers, vehicles and payments."],
      ["Do washes get KRA eTIMS invoices?", "Washes are invoiced like any other sale in JMSURF Garage, so when eTIMS is set up for your business the invoice is signed for KRA."],
    ],
    modules: ["car_wash", "garage_core", "marketing", "commerce"],
    related: [["How to take M-Pesa payments at a garage", "/guides/mpesa-payments-for-garages"], ["Tyre and battery shops", "/for/tyre-shops"], ["Car Wash module", "/solutions/car_wash"], ["Pricing", "/pricing"]],
    wa: "Hello, I run a car wash and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/tyre-shops", group: "for", crumb: "Tyre and battery shops",
    title: "Tyre Shop and Wheel Alignment Software Kenya | JMSURF Garage",
    description: "Find tyres by size, record wheel alignment and balancing, test batteries and keep warranties, with stock, M-Pesa and KRA eTIMS invoices. For tyre shops, Kenya.",
    eyebrow: "For tyre, alignment and battery centres", h1: "Software for tyre, alignment and battery shops",
    lead: "Sell the right tyre the first time, record every alignment and battery test, and keep the warranty for each tyre and battery you sell.",
    photo: "wheel",
    blocks: [
      { h: "Tyres are stock with many sizes", p: [
        "A tyre shop carries hundreds of sizes and brands, and a customer at the counter wants to know in seconds whether you have their size. When stock lives in a notebook or in the shopkeeper's head, sales are lost and old tyres sit unsold.",
        "The Tyres, Alignment & Batteries module lets staff find tyres by size and see what is in stock. With Parts & Stock you also get purchase orders from suppliers, receiving, reorder alerts and stock-takes, so the count stays right.",
      ] },
      { h: "Alignment, balancing and battery records", p: [
        "Each wheel alignment and balancing job is recorded on the vehicle, so the next time the car comes in you can see what was done and when. Battery tests are recorded too, which helps when a customer asks whether a battery really needs replacing.",
        "Every tyre and battery sold keeps its warranty with the customer and the vehicle. When a customer comes back with a claim, the sale date, the item and the warranty are on screen instead of in a receipt book.",
      ], list: [
        "Find tyres by size.",
        "Wheel alignment and balancing records per vehicle.",
        "Battery tests, sales and warranties.",
        "Warranty kept for each item sold.",
      ] },
      { h: "Counter sales and workshop jobs together", p: [
        "Many tyre centres also do brakes, shocks and small repairs. Those jobs use the same job cards, customers and vehicles as the rest of JMSURF Garage. If you sell over the counter a lot, the Spares POS & Wholesale module adds a fast till that keeps working when the internet drops, with M-Pesa, card and cash.",
        "Payments by M-Pesa go to your own Till or Paybill and mark the invoice paid. Invoices are signed for KRA eTIMS when your business is set up for it.",
      ] },
      costBlock("What it costs a tyre shop",
        `A tyre and battery shop on Starter (up to ${STARTER.users} users) with Tyres, Alignment & Batteries and full Parts & Stock:`,
        "starter", ["tyres", "inventory"]),
    ],
    faqs: [
      ["Can I search stock by tyre size?", "Yes. The Tyres module finds tyres by size, and stock levels come from Parts & Stock or Garage Core's basic stock."],
      ["Are battery warranties tracked?", "Yes. Each battery and tyre sold keeps its warranty on the customer and vehicle, so claims can be checked quickly."],
      ["Does the counter till work offline?", "The Spares POS till keeps selling when the internet drops and catches up when it comes back."],
    ],
    modules: ["tyres", "inventory", "commerce", "garage_core"],
    related: [["Spare parts shops", "/for/spare-parts-shops"], ["Car washes", "/for/car-washes"], ["Tyres module", "/solutions/tyres"], ["Garage software prices in Kenya", "/guides/garage-software-price-kenya"]],
    wa: "Hello, I run a tyre shop and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/spare-parts-shops", group: "for", crumb: "Spare parts shops",
    title: "Spare Parts Shop Software and POS in Kenya | JMSURF Garage",
    description: "A spares counter till that works offline, parts stock across stores, wholesale prices, trade credit limits, M-Pesa and KRA eTIMS invoices for spares shops.",
    eyebrow: "For spare parts shops", h1: "Software for spare parts shops in Kenya",
    lead: "Sell fast at the counter, give trade buyers their own prices and credit, and know exactly which parts you have in which store.",
    photo: "spares",
    blocks: [
      { h: "A spares shop lives or dies by its stock", p: [
        "A spares shop can hold thousands of part numbers. The money is tied up on the shelves, so knowing what you have, what sells and what has not moved in months matters more than in almost any other shop. When the count is wrong, customers are told a part is out when it is on the shelf, or promised one that is not there.",
        "Parts & Stock keeps stock in several stores or branches, with purchase orders to suppliers, receiving against them, transfers between branches, serial numbers, batches, reorder alerts and stock-takes with the differences posted.",
      ] },
      { h: "A fast counter till", p: [
        "The Spares POS & Wholesale module adds a till for the counter. It works on a tablet or a PC, reads barcodes, prints receipts and takes M-Pesa, card and cash. When the internet drops it keeps selling and catches up later. Shifts, cash-up and Z-reports show what each cashier took.",
      ], list: [
        "Works offline and catches up later.",
        "M-Pesa prompt, card and cash.",
        "Shifts, cash-up and Z-reports.",
        "One stock for the counter and the workshop.",
      ] },
      { h: "Wholesale and trade customers", p: [
        "Garages and fundis who buy from you every week expect trade prices and credit. Each wholesale customer can have their own price list and a credit limit, so the counter staff do not have to remember who gets what. Loyalty points and vouchers bring retail buyers back.",
        "If you also want to sell online, the Online Parts Shop & Website module puts your parts on your own website with live stock and M-Pesa checkout.",
      ] },
      { h: "Importing your own parts", p: [
        "Spares shops that import their own stock can add Imports & Landed Cost. Freight, duty, clearing and port charges are spread over the parts in each shipment, so every part carries its true cost and you can price it properly.",
      ] },
      costBlock("What it costs a spares shop",
        `A spares shop on Starter (up to ${STARTER.users} users) with full Parts & Stock and the Spares POS till:`,
        "starter", ["inventory", "commerce"],
        [`Adding the online parts shop and website costs ${mp("website")} a month more, and Imports & Landed Cost ${mp("imports")} a month.`]),
    ],
    faqs: [
      ["Can I give different prices to trade customers?", "Yes. Wholesale customers get their own price lists and credit limits, and the till applies them when you choose the customer."],
      ["Can I run two shops?", `Yes. Stock is kept per store or branch and moved with transfers. The Pro plan includes ${PRO.branches} branches; other plans add a branch for ${kes(EXTRA_BRANCH_PRICE)} a month.`],
      ["Does the till need internet all the time?", "No. It keeps selling offline and sends the sales when the connection is back."],
    ],
    modules: ["inventory", "commerce", "website", "imports"],
    related: [["Motor importers", "/for/motor-importers"], ["Tyre and battery shops", "/for/tyre-shops"], ["Spares POS module", "/solutions/commerce"], ["How to take M-Pesa payments at a garage", "/guides/mpesa-payments-for-garages"]],
    wa: "Hello, I run a spare parts shop and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/car-dealers", group: "for", crumb: "Car yards and dealers",
    title: "Car Yard and Car Dealer Software in Kenya | JMSURF Garage",
    description: "Cars for sale with photos and costs, reconditioning, deposits and part payments, logbook transfer and real profit per car, for car yards and dealers in Kenya.",
    eyebrow: "For car yards and dealers", h1: "Software for car yards and car dealers",
    lead: "Know what every car on your yard really cost, what it is listed for, who has paid a deposit and where the logbook transfer stands.",
    photo: "yard",
    blocks: [
      { h: "The profit on a car is in the details", p: [
        "A car bought for one price can end up costing much more by the time it is sold: repairs, a respray, new tyres, cleaning, transport and the time it sat on the yard. When those costs are scattered across receipts, the profit you think you made is not the profit you really made.",
        "The Vehicle Yard & Car Sales module keeps every car in stock with its purchase cost, its repairs and reconditioning, its photos and its asking price. When it sells, you see the real profit on that car.",
      ] },
      { h: "From stock to sold", list: [
        "Add the car with its photos, cost and asking price.",
        "Book repairs and reconditioning to the car, including work done in your own workshop.",
        "Take a deposit and part payments, by M-Pesa or bank.",
        "Sell on cash or on finance.",
        "Follow the logbook transfer steps until the buyer has the logbook.",
      ], after: ["Cars can be shown on your public listings page, where buyers can send an enquiry about a car straight to you."] },
      { h: "Your own workshop and your imports", p: [
        "Many yards prepare cars in their own workshop or a partner garage. When the reconditioning is done as a job card in JMSURF Garage, the parts and labour go straight onto the car's cost.",
        "If you import cars, the Imports & Landed Cost module follows each shipment from order to arrival, adds freight, duty, clearing and port charges, and brings each car into the yard at its true landed cost. You can see which cars are on the water, at the port or already on the yard, and get an SMS when a shipment at the port is close to the end of its free days.",
      ] },
      { h: "Payments and paperwork", p: [
        "Deposits and part payments are recorded against the sale, so you always know what a buyer still owes. Payments by M-Pesa land on your own Till or Paybill. Invoices and receipts are signed for KRA eTIMS when your business is set up for it. With Contracts & e-Sign, sale agreements can be signed on any phone.",
      ] },
      costBlock("What it costs a car yard",
        `A car yard on Starter (up to ${STARTER.users} users) with Vehicle Yard & Car Sales:`,
        "starter", ["vehicle_yard"],
        [`A dealer that imports its own cars adds Imports & Landed Cost (${mp("imports")} a month): ${kes(total("starter", ["vehicle_yard", "imports"]))} a month in all.`]),
    ],
    faqs: [
      ["Can buyers see my cars online?", "Yes. Cars you choose to list appear on your public listings page with photos, and buyers can send an enquiry from it."],
      ["Can I record a deposit and the balance later?", "Yes. Deposits and part payments are recorded on the sale and the balance owed is always shown."],
      ["Does it work with my workshop?", "Yes. Reconditioning done as job cards adds its parts and labour to the car's cost."],
    ],
    modules: ["vehicle_yard", "imports", "contracts", "garage_core"],
    related: [["Motor importers", "/for/motor-importers"], ["Car hire companies", "/for/car-hire"], ["Vehicle Yard module", "/solutions/vehicle_yard"], ["Garage software in Mombasa", "/garage-software/mombasa"]],
    wa: "Hello, I run a car yard and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/motor-importers", group: "for", crumb: "Motor importers",
    title: "Car and Spare Parts Import Software, Kenya | JMSURF Garage",
    description: "Follow car and parts imports from order to arrival: shipments, containers, freight, duty and clearing, landed cost per item and port demurrage alerts. Kenya.",
    eyebrow: "For car and parts importers", h1: "Software for car and spare parts importers",
    lead: "See what is on the water, what is at the port and what has arrived, and give every car or part its true landed cost.",
    photo: "port",
    blocks: [
      { h: "Imports hide their real cost", p: [
        "The price on the supplier's invoice is only the start. Freight, insurance, duty and taxes, clearing and forwarding, port charges and transport to your yard all add to it, often in a different currency and paid on different days. When those costs are not spread over the items in the shipment, you price parts and cars on a guess.",
        "Imports & Landed Cost records the supplier, the shipment and the container, collects every cost that belongs to it, and spreads those costs over the parts or vehicles so each one carries its true landed cost.",
      ] },
      { h: "What you can follow", list: [
        "Shipments and containers, from order to arrival.",
        "Suppliers who bill in foreign currency.",
        "Freight, duty, clearing and port charges.",
        "Landed cost per part or per vehicle.",
        "Arrivals straight into stock or onto the yard.",
      ], after: ["When a shipment is waiting at the port and is close to the end of its free days, JMSURF Garage sends the company an SMS, so demurrage does not creep up unnoticed."] },
      { h: "After the goods arrive", p: [
        "Parts arrive into Parts & Stock, at the store you choose, ready to sell at the counter, online or on job cards. Vehicles arrive onto the Vehicle Yard with their landed cost, ready for reconditioning and sale. Either way, the margin you see later is based on what the item really cost you.",
        "Because the import, the stock, the sale and the payment are in one system, your accounts see the whole chain. With the Accounting module, the costs post to the books, and the VAT return and profit and loss come from the same records.",
      ] },
      { h: "Who it fits", p: [
        "Spare parts importers and wholesalers, dealers who bring in used vehicles, and garages that import parts for their own workshop. Small importers can start on the Starter plan and grow into Business or Pro as the team grows.",
      ] },
      costBlock("What it costs an importer",
        `A parts importer on Starter (up to ${STARTER.users} users) with Imports & Landed Cost and full Parts & Stock:`,
        "starter", ["imports", "inventory"],
        [`A vehicle importer swaps Parts & Stock for Vehicle Yard & Car Sales (${mp("vehicle_yard")} a month): ${kes(total("starter", ["imports", "vehicle_yard"]))} a month.`]),
    ],
    faqs: [
      ["Can suppliers bill in dollars or yen?", "Yes. Suppliers can be set up in a foreign currency, and the landed cost is worked out in Kenya shillings."],
      ["How are shared costs split over items?", "Freight, duty, clearing and other charges on a shipment are spread over the items in it, so each part or vehicle carries its share."],
      ["Do I get warned about demurrage?", "Yes. When a shipment at the port is close to the end of its free days, the company gets an SMS."],
    ],
    modules: ["imports", "inventory", "vehicle_yard", "accounting"],
    related: [["Car yards and dealers", "/for/car-dealers"], ["Spare parts shops", "/for/spare-parts-shops"], ["Imports module", "/solutions/imports"], ["Garage software in Mombasa", "/garage-software/mombasa"]],
    wa: "Hello, I import cars or parts and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/towing", group: "for", crumb: "Towing and mobile mechanics",
    title: "Towing and Mobile Mechanic Software Kenya | JMSURF Garage",
    description: "Answer tow and roadside calls, dispatch a truck or mechanic, charge by distance, keep photos from the road and turn each call-out into a job card. Kenya.",
    eyebrow: "For towing and mobile mechanics", h1: "Software for towing and mobile mechanics",
    lead: "Every call-out recorded from the first phone call to the payment, and every towed car turned into a job at the garage without retyping.",
    photo: "fundi",
    blocks: [
      { h: "Call-outs happen fast", p: [
        "A breakdown call comes in, a truck or a mechanic goes out, and by evening nobody is sure how far the truck went, what was agreed on the phone or whether the customer paid. Towing and roadside work is easy to lose money on because so much of it happens away from the office.",
        "The Towing & Mobile Mechanic module records each call-out with its pick-up and drop-off, dispatches it to a truck or a mechanic, charges by distance, keeps photos taken on the road and records the payment.",
      ] },
      { h: "From the call to the garage", list: [
        "Record the call: who called, where the car is and where it is going.",
        "Dispatch to a tow truck or a mobile mechanic.",
        "Charge by distance, so the price is clear before the truck leaves.",
        "Take photos of the car on the road, which protect you if there is a dispute about damage.",
        "Take payment by M-Pesa.",
        "Turn the call-out into a job card when the car reaches the garage.",
      ] },
      { h: "Works with body shops and insurers", p: [
        "Accident cars often go from the roadside to a body shop and onto an insurance claim. When the tow, the body job and the claim are in the same system, the photos and details from the road are already on the car when the assessor asks for them.",
        "Your own tow trucks and pick-ups can be kept under Company vehicles in Parts & Stock, with their fuel, insurance and service costs, so you know what each truck costs to run.",
      ] },
      { h: "Your team on their phones", p: [
        "Drivers and mobile mechanics use JMSURF Garage on their phones, with their own login and only the screens their role allows. Expense Claims lets them claim fuel and trips with a receipt photo, approved by the owner in one tap and refunded by M-Pesa.",
      ] },
      costBlock("What it costs a towing business",
        `A towing or mobile mechanic business on Starter (up to ${STARTER.users} users) with Towing & Mobile Mechanic:`,
        "starter", ["towing"],
        [`A body shop that runs its own tow truck can add Towing to its plan for ${mp("towing")} a month.`]),
    ],
    faqs: [
      ["Can I charge per kilometre?", "Yes. Call-outs are charged by distance, worked out from the pick-up and drop-off."],
      ["Does a towed car become a job card?", "Yes. When the car reaches the garage, the call-out becomes a job card with the customer, the vehicle and the photos already on it."],
      ["Can drivers use their phones?", "Yes. Every screen works on a phone, and each driver signs in with their own login."],
    ],
    modules: ["towing", "body_paint", "insurance", "expense"],
    related: [["Body and paint shops", "/for/body-shops"], ["Garage software in Nakuru", "/garage-software/nakuru"], ["Towing module", "/solutions/towing"], ["Pricing", "/pricing"]],
    wa: "Hello, I run a towing business and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/car-hire", group: "for", crumb: "Car hire companies",
    title: "Car Hire Management Software for Kenya | JMSURF Garage",
    description: "A booking calendar per car, deposits by M-Pesa, hand-over and return checks with photos and fuel level, and late or damage charges, for car hire in Kenya.",
    eyebrow: "For car hire companies", h1: "Car hire software for Kenyan rental businesses",
    lead: "See which car is out, which is coming back and which is free, take deposits by M-Pesa and settle damage and late returns with photos as proof.",
    photo: "yard",
    blocks: [
      { h: "Every car is a small business", p: [
        "A hire car earns only when it is out, and it costs money every day it is in the garage or parked. When bookings sit in a diary and hand-over checks on paper, double bookings, missing deposits and arguments about scratches and fuel follow.",
        "The Car Hire module gives each car its own booking calendar, takes deposits by M-Pesa and records hand-over and return checks with photos and fuel level. Late returns and damage charges go straight onto the bill.",
      ] },
      { h: "A hire, step by step", list: [
        "Check the car's calendar and book it for the dates the customer wants.",
        "Take the deposit by M-Pesa prompt to the customer's phone.",
        "At hand-over, record the condition with photos and the fuel level.",
        "At return, do the same check and compare.",
        "Add late return or damage charges to the bill, then close the hire.",
      ] },
      { h: "Keep the cars on the road", p: [
        "A car that is due back late or comes back damaged is where most hire disputes start, which is why the return check sits next to the hand-over check on the same hire. Hire cars also need regular servicing. When you also service them in JMSURF Garage, every service is on the car's history and service reminders by date or mileage tell you when each one is due. If you send them to an outside garage, record the costs as expenses against the car.",
      ] },
      { h: "Payments and records", p: [
        "Deposits and payments by M-Pesa go to your own Till or Paybill. Invoices are signed for KRA eTIMS when your business is set up for it. With Contracts & e-Sign, the hire agreement can be signed on the customer's phone and kept on their record.",
      ] },
      costBlock("What it costs a car hire business",
        `A car hire business on Starter (up to ${STARTER.users} users) with Car Hire:`,
        "starter", ["car_hire"],
        [`Adding Contracts & e-Sign for signed hire agreements costs ${mp("contracts")} a month more.`]),
    ],
    faqs: [
      ["Can I stop a car being booked twice?", "Each car has its own booking calendar, so staff see when it is already out before they book it."],
      ["Can I take the deposit by M-Pesa?", "Yes. Send an M-Pesa prompt to the customer's phone and the deposit is recorded on the hire."],
      ["How are damage disputes handled?", "Hand-over and return checks are recorded with photos and the fuel level, so you can compare the car's condition at both ends of the hire."],
    ],
    modules: ["car_hire", "contracts", "garage_core", "marketing"],
    related: [["Car yards and dealers", "/for/car-dealers"], ["Service reminders that bring customers back", "/guides/garage-service-reminders"], ["Car Hire module", "/solutions/car_hire"], ["Pricing", "/pricing"]],
    wa: "Hello, I run a car hire business and would like a demo of JMSURF Garage.",
  },
  {
    path: "/for/fleet-maintenance", group: "for", crumb: "Fleet maintenance",
    title: "Fleet Maintenance Software for Garages | JMSURF Garage",
    description: "Service contracts for company fleets: contract rates, service due reminders, job approval with LPO numbers, driver checks and a fleet manager portal. Kenya.",
    eyebrow: "For garages that service fleets", h1: "Fleet maintenance software for garages",
    lead: "Win and keep company fleet contracts with agreed rates, jobs approved by the fleet manager, one monthly statement and a portal they can open any time.",
    photo: "workshop",
    blocks: [
      { h: "Fleet customers want control", p: [
        "Companies that run delivery vans, pick-ups, matatus or staff cars want to know what is being done to each vehicle, approve work before it starts and get one clear statement at the end of the month. A garage that can give them that is easier to keep on contract.",
        "The Fleet Contracts & Fleet Portal module keeps each fleet with its vehicles, contract rates and service schedules, reminds you when each vehicle is due, and gives the fleet manager their own portal.",
      ] },
      { h: "What the fleet manager sees", list: [
        "Every vehicle in their fleet, with jobs and invoices.",
        "Jobs waiting for their approval, which they approve or decline with their name and LPO number.",
        "Monthly statements of everything done on their vehicles.",
        "Daily check forms their drivers fill in on the phone: odometer, answers and photos.",
      ], after: ["The portal opens from a private link, so the fleet manager does not need a JMSURF Garage login."] },
      { h: "What the garage gets", p: [
        "Each fleet's contract rates are kept with its contract, so the front desk does not have to remember who gets which price. Service due reminders by date or mileage tell you which fleet vehicles to call in. Insurance, inspection, speed governor and PSV licence expiry reminders can be set per vehicle, which matters for public service vehicles.",
        "Every job is still a normal JMSURF Garage job card, with inspections, parts, the quality check, the KRA eTIMS invoice and payment, so fleet work and walk-in work run the same way in the workshop.",
      ] },
      { h: "Statements and payment", p: [
        "At the end of the month, send one statement per fleet instead of a pile of invoices. Payments by M-Pesa or bank are matched to the invoices, and you can see which fleets owe you and for how long.",
      ] },
      costBlock("What it costs",
        `Fleet work suits a busy workshop. On the Business plan (up to ${BUSINESS.users} users, with Workshop Pro, Parts & Stock and Accounting included) with Fleet Contracts:`,
        "business", ["fleet_contracts"]),
    ],
    faqs: [
      ["Does the fleet manager need an account?", "No. The fleet portal opens from a private link that you share with the fleet manager."],
      ["Can the fleet approve jobs before work starts?", "Yes. The fleet manager approves or declines each job in the portal and adds their name and LPO number."],
      ["Can drivers report problems?", "Yes. Drivers fill in a daily check form on their phone with the odometer reading, answers and photos."],
    ],
    modules: ["fleet_contracts", "workshop_pro", "inventory", "garage_core"],
    related: [["Mechanical workshops", "/for/mechanical-workshops"], ["Service reminders that bring customers back", "/guides/garage-service-reminders"], ["Fleet Contracts module", "/solutions/fleet_contracts"], ["Garage software in Eldoret", "/garage-software/eldoret"]],
    wa: "Hello, I service company fleets and would like a demo of JMSURF Garage.",
  },
];

/* ================================================================== guides */

const BEST: ContentPage = {
  path: "/guides/best-garage-management-software-kenya", group: "guides", crumb: "Choosing garage software", article: true,
  title: "Best Garage Management Software in Kenya: How to Choose",
  description: "What to look for in garage management software in Kenya: job cards, customer approval, M-Pesa, KRA eTIMS, phone use, stock, prices, data safety and support.",
  eyebrow: "Buyer's guide", h1: "How to choose the best garage management software in Kenya",
  lead: "Ten things that matter for a Kenyan garage, the questions to ask any supplier, and how JMSURF Garage answers them. Honest, including where it may not fit.",
  photo: "inspect",
  blocks: [
    { h: "Start with how your garage really works", p: [
      "There is no single best system for every garage. A roadside fundi, a twenty-bay workshop, a body shop that lives on insurance work and a spares shop with a busy counter need different things. Before you compare systems, write down the jobs that cost you time or money today: lost job cards, unpaid balances, parts not billed, customers you cannot reach, stock that does not add up, eTIMS invoices typed one by one.",
      "Then judge every system by whether it fixes those problems, on the phones and data your team already has, at a price that makes sense for your size.",
    ] },
    { h: "Ten things to look for", list: [
      "1. Job cards built for vehicles: plate, mileage and service history, not a general sales invoice with a notes field.",
      "2. Customer approval of estimates from their phone, ideally line by line, so you are not chasing calls.",
      "3. M-Pesa built in, paying into your own Till or Paybill and marking invoices paid by itself.",
      "4. KRA eTIMS signing of invoices and credit notes without retyping them on another system.",
      "5. Works on a phone and on slow data, because mechanics do not sit at desks.",
      "6. Parts stock tied to jobs, so what is fitted is what is billed.",
      "7. Prices in Kenya shillings per month, a free trial, and no long contract.",
      "8. Your data kept safe and apart from other businesses, with a supplier registered with the Office of the Data Protection Commissioner.",
      "9. Support from people in Kenya who answer on phone and WhatsApp.",
      "10. Room to grow: branches, payroll, accounting and specialist work when you need them, without changing systems.",
    ] },
    { h: "Questions to ask any supplier", list: [
      "Can I see the whole flow, from booking a car in to the M-Pesa payment, in a live demo?",
      "Does the money go to my own Till or Paybill, or through someone else's account first?",
      "Is the eTIMS integration done through a KRA-approved route, and what happens when KRA is slow?",
      "What does it cost per month for my size, with every extra written down?",
      "Can I leave at any time, and what happens to my records?",
      "Who do I call when something goes wrong on a Saturday morning?",
    ] },
    { h: "How JMSURF Garage answers those points", p: [
      "JMSURF Garage was built for Kenyan motor businesses by JMSURF Technologies in Nairobi. Garage Core, which comes with every plan, has job cards for vehicles, customers and vehicles with history, estimates the customer approves or declines line by line from a link, M-Pesa payments that land on your own number, KRA eTIMS invoices, SMS updates, service reminders and basic stock.",
      `Plans go by the size of your garage, from ${kes(FUNDI.price)} a month for the Fundi plan to ${kes(PRO.price)} for Pro, with Enterprise priced for groups. Modules add what your business does, such as inspections and a bay board, a spares till, body and paint, car wash, tyres, imports, car yard, fleet contracts, towing or car hire. Everything is free for ${TRIAL_DAYS} days without a card, and paying yearly gives 2 months free.`,
      "Each garage's records are kept apart at database level, sign-in supports two-step verification and every change is recorded. JMSURF TECHNOLOGIES LTD is registered with the ODPC as a data controller and processor (reg. no. 194-9812-26EB).",
    ] },
    { h: "Where it may not fit", p: [
      "JMSURF Garage runs in the browser and needs a data connection to save work; only the spares counter till keeps selling offline. It installs like an app from the browser rather than from an app store. To sign invoices with KRA you need your own eTIMS registration (an OSCU device for your KRA PIN and branch), which KRA issues to you. If you need a feature that is not listed on the module pages, ask before you buy rather than after.",
    ] },
    { h: "Try before you decide", p: [
      `The quickest test is to run a week of real cars through a trial. Sign up, add your team, book in today's cars and send one estimate and one M-Pesa prompt. If it does not save you time in that week, it will not save you time in a year.`,
    ] },
  ],
  faqs: [
    ["Is there free garage software in Kenya?", `Free tools exist, but they rarely include M-Pesa matching, KRA eTIMS signing or support. JMSURF Garage starts at ${kes(FUNDI.price)} a month and every plan is free for ${TRIAL_DAYS} days so you can test it first.`],
    ["Do I need a computer for garage software?", "Not for JMSURF Garage. It works on a smartphone in the browser and installs like an app. A PC or a TV is useful for the office or a bay board, but not required."],
    ["Can I move my records from paper or spreadsheets?", "Most garages start with the cars that come in from today, and returning customers are added as they come back. Talk to us on WhatsApp if you have a big customer list to bring in."],
  ],
  modules: ["garage_core", "workshop_pro", "inventory", "commerce"],
  related: [["Garage software prices in Kenya", "/guides/garage-software-price-kenya"], ["Job cards vs paper and spreadsheets", "/guides/job-cards-vs-paper"], ["Questions garage owners ask", "/faq"], ["Garage types", "/for"]],
  wa: "Hello, I am choosing garage software and would like a demo of JMSURF Garage.",
};

const PRICE: ContentPage = {
  path: "/guides/garage-software-price-kenya", group: "guides", crumb: "Garage software prices", article: true,
  title: "Garage Software Price in Kenya: Real Monthly Costs in KES",
  description: `What garage management software costs in Kenya: JMSURF Garage plans from KES ${FUNDI.price} a month, module prices, branches, SMS, yearly discount and worked examples.`,
  eyebrow: "Price guide", h1: "Garage software prices in Kenya, in shillings",
  lead: "Every JMSURF Garage plan and module price, what is included, what costs extra, and what a real garage of your size would pay each month.",
  photo: "parts",
  blocks: [
    { h: "How the price is made up", p: [
      "JMSURF Garage is priced per garage per month in Kenya shillings, with VAT excluded. You pay for two things: a plan, chosen by the size of your garage (how many people use it and how many branches you have), and modules, chosen by what your business does. Garage Core is in every plan.",
      `Paying for a year costs ${YEAR_MONTHS} times the monthly price, so you get 2 months free. Every plan and every module you choose is free for the first ${TRIAL_DAYS} days, and no card is needed to start.`,
    ] },
    { h: "Plans", table: planTable(), after: [
      "Garage Core covers job cards, customers and vehicles, estimates approved online, M-Pesa payments, KRA eTIMS invoices, SMS updates, service reminders, basic stock and the owner's dashboard.",
    ] },
    { h: "Modules", p: ["Turn a module on when you need it and off when you do not. A module you turn on is billed from that day; one you turn off runs to the end of the period you have paid for, and its records are kept."], table: moduleTable() },
    { h: "Other costs", list: [
      `Extra branch above what your plan includes: ${kes(EXTRA_BRANCH_PRICE)} a month each.`,
      `SMS on the JMSURF SMS line: ${kes(SMS_PRICE_KES)} per SMS, topped up by M-Pesa from ${kes(SMS_MIN_TOPUP_KES)}. You can also connect your own SMS account.`,
      `Your own web address for your garage's customer pages: ${kes(CUSTOM_DOMAIN_KES)} once.`,
      "M-Pesa: JMSURF Garage does not take a cut of your sales. Payments go to your own Till or Paybill at your normal Safaricom charges.",
    ] },
    costBlock("Example: a one-man garage", "A fundi working alone or with a helper, with job cards, M-Pesa, eTIMS and SMS:", "fundi", []),
    costBlock("Example: a busy workshop", "A workshop with up to 15 staff, inspections, a bay board, full parts stock and books:", "business", ["workshop_pro", "inventory", "accounting"]),
    costBlock("Example: a body shop with a car wash", "A small body shop that also washes cars, with insurance work:", "starter", ["body_paint", "insurance", "car_wash"]),
    { h: "When the All modules bundle pays off", p: [
      `The All modules bundle is the Pro plan plus every garage module for ${kes(ALL.price)} a month. Bought one by one, the same modules on Pro would cost more, so if you run several kinds of business under one roof, for example a workshop, body shop, car wash, spares counter and car hire, the bundle is usually cheaper. The price box at sign-up shows when the bundle would save you money.`,
    ] },
  ],
  faqs: [
    ["Can I pay by M-Pesa?", "Yes. Plans are priced in Kenya shillings and paid by M-Pesa, monthly or yearly."],
    ["Do prices include VAT?", "No. All prices are in Kenya shillings and exclude VAT."],
    ["Can I change plan later?", "Yes. Moving up works at once and you pay only for the days left in your period. Moving down takes effect at your next renewal."],
  ],
  modules: ["garage_core", "workshop_pro", "inventory", "accounting"],
  related: [["Pricing and price calculator", "/pricing"], ["How to choose garage software", "/guides/best-garage-management-software-kenya"], ["Software for the roadside fundi", "/for/roadside-mechanics"], ["Questions garage owners ask", "/faq"]],
  wa: "Hello, I would like a price for JMSURF Garage for my business.",
};

const MPESA: ContentPage = {
  path: "/guides/mpesa-payments-for-garages", group: "guides", crumb: "M-Pesa at a garage", article: true,
  title: "How to Take M-Pesa Payments at a Garage in Kenya | Guide",
  description: "How a garage can take M-Pesa payments that mark invoices paid by themselves: STK prompts, Till and Paybill, deposits, pay links and a gate pass check.",
  eyebrow: "How-to guide", h1: "How to take M-Pesa payments at a garage",
  lead: "Stop checking M-Pesa messages against a notebook. Send the prompt, let the customer pay, and let the payment find its own invoice.",
  photo: "lift",
  blocks: [
    { h: "The problem with M-Pesa at the counter", p: [
      "Almost every garage customer in Kenya pays by M-Pesa. The trouble is not taking the money, it is matching it. A customer pays to the Till, reads out a code, someone writes it down, and at the end of the day the owner tries to tie the messages on the phone to the jobs in the book. Payments get credited to the wrong car, part payments are forgotten, and some cars leave with a balance nobody notices.",
      "JMSURF Garage ties each M-Pesa payment to an invoice, so the job, the invoice and the payment are one record.",
    ] },
    { h: "Three ways to connect M-Pesa", p: ["Choose one active way to take payments for your garage in your workspace settings:"], list: [
      "JMSURF PAY: enter your own Till, Paybill or bank account. JMSURF Garage sends M-Pesa prompts to your customers' phones and the money settles to your account. No Safaricom developer set-up needed.",
      "Your own Safaricom Daraja app: for garages that already have Daraja keys. You get M-Pesa prompts, and payments customers make themselves to your Paybill, with the invoice number as the account, are matched to the invoice.",
      "Paystack: for garages that want card and mobile money payments through their own Paystack account.",
    ], after: ["In every case the money goes to your own number or account, not to JMSURF, and a payment is only marked as received after the provider confirms it and the amount."] },
    { h: "How a payment works, step by step", list: [
      "The job is finished and the invoice is made from the job card.",
      "Staff press the M-Pesa button and enter the customer's phone number, or the customer opens the link in their SMS.",
      "The customer gets the M-Pesa prompt on their phone and enters their PIN.",
      "M-Pesa confirms the payment and the invoice is marked paid, or part paid with the balance shown.",
      "The customer gets a receipt, and the gate pass can be done because the payment is in.",
    ] },
    { h: "Deposits and part payments", p: [
      "For big jobs, ask for a deposit before you order parts. Staff can send an M-Pesa prompt for a deposit on the job, and the deposit is counted against the final invoice. Part payments work the same way: the invoice shows what has been paid and what is left.",
    ] },
    { h: "Payment links and the tracking page", p: [
      "Each job has a tracking link that the customer gets by SMS. It shows where the car is, the photos, the invoices and a pay link. A customer who has already left can pay from the link without calling the garage.",
    ] },
    { h: "Cars do not leave unpaid", p: [
      "The gate pass in JMSURF Garage checks payment first. A car with a balance is not released unless someone with the right permission releases it on credit, and that decision is recorded with their name. Owners who are not at the garage can see exactly which cars left on credit and who allowed it.",
    ] },
    { h: "What it costs", p: [
      `M-Pesa payments are part of Garage Core in every plan, from ${kes(FUNDI.price)} a month. JMSURF Garage does not take a percentage of your payments; Safaricom's normal charges for your Till or Paybill apply.`,
    ] },
  ],
  faqs: [
    ["Does the money go to JMSURF first?", "No. Payments go to your own Till, Paybill or account. JMSURF Garage records and matches them."],
    ["What if the customer pays without the prompt?", "With your own Daraja app, payments to your Paybill with the invoice number as the account are matched to the invoice automatically. Otherwise staff record the payment on the invoice."],
    ["Can I take M-Pesa at the spares counter too?", "Yes. The Spares POS till takes M-Pesa prompts, card and cash, and keeps selling when the internet drops."],
  ],
  modules: ["garage_core", "commerce", "accounting"],
  related: [["KRA eTIMS invoices for garages", "/guides/etims-invoices-for-garages"], ["Software for the roadside fundi", "/for/roadside-mechanics"], ["Car washes", "/for/car-washes"], ["JMSURF PAY", "https://jmsurfpay.co.ke"]],
  wa: "Hello, I would like to see how M-Pesa payments work in JMSURF Garage.",
};

const PAPER: ContentPage = {
  path: "/guides/job-cards-vs-paper", group: "guides", crumb: "Job cards vs paper", article: true,
  title: "Digital Job Cards vs Paper and Spreadsheets for Garages",
  description: "Why Kenyan garages move from paper job cards and spreadsheets to digital ones: lost cards, approvals, unbilled parts, unpaid balances and how to switch.",
  eyebrow: "Comparison", h1: "Digital job cards vs paper and spreadsheets",
  lead: "Paper job cards and spreadsheets cost nothing to start. Here is what they cost later, and how to move to digital job cards without stopping work.",
  photo: "engine",
  blocks: [
    { h: "Why paper still runs most garages", p: [
      "Paper job cards are quick, need no training and work when the power is off. Spreadsheets feel like a step up: you can add up the month's jobs and keep a customer list. For a garage with a handful of cars a week, that can be enough.",
      "The trouble starts as the garage gets busier. Cards get oily, lost or filled in after the fact. The spreadsheet is on one computer and only one person updates it. Nobody can see, from home or from another branch, which cars are in, what they owe and what has been promised.",
    ] },
    { h: "Side by side", table: {
      caption: "Paper or spreadsheets compared with JMSURF Garage job cards",
      head: ["", "Paper or spreadsheets", "JMSURF Garage"],
      rows: [
        ["Finding a job card", "Search the pile or the file", "Search by plate, name or phone"],
        ["Car history", "Old cards, if kept", "Every past job on the vehicle"],
        ["Customer approval", "Phone calls, often unrecorded", "Link by SMS or WhatsApp, approved line by line"],
        ["Parts used", "Written on the card, often missed on the bill", "Added to the job and taken off stock"],
        ["Invoice", "Written or typed again", "Made from the job card in one step, signed for KRA eTIMS"],
        ["Payment", "M-Pesa code written by hand", "M-Pesa matched to the invoice"],
        ["Car leaving", "Depends who is at the gate", "Gate pass checks payment first"],
        ["Seeing the day", "Walk the floor", "Every car by stage on one list, on any phone"],
        ["Bringing customers back", "Rarely done", "Service reminders by date or mileage"],
        ["Cost to start", "A receipt book", `From ${kes(FUNDI.price)} a month, ${TRIAL_DAYS} days free`],
      ],
    } },
    { h: "What paper really costs", p: [
      "Add up a month of small losses: a part fitted but not billed, a balance not followed up, a car that left before paying, a customer who went elsewhere because nobody reminded them their service was due. For most garages those losses are worth more than the monthly price of a system.",
      "There is also the cost of not knowing. Without records you cannot tell which jobs make money, which mechanic is fastest, or which customers bring the most work.",
    ] },
    { h: "When paper is still fine", p: [
      "If you work alone, do a few jobs a week, are not registered for VAT and your customers pay cash on the spot, paper may be all you need for now. Once you have staff, regular customers, insurers or fleets, or need eTIMS invoices, digital job cards pay for themselves quickly.",
    ] },
    { h: "How to switch without stopping work", list: [
      `Sign up and use it free for ${TRIAL_DAYS} days, no card needed.`,
      "Add your team, each with their own login and role.",
      "From tomorrow morning, book every new car in on JMSURF Garage instead of a paper card.",
      "Finish the cars already in on paper; do not try to copy old cards across.",
      "Send your first estimate link and your first M-Pesa prompt.",
      "After two weeks, look at the reports: jobs done, money in, balances owed.",
    ], after: ["Returning customers are added the first time they come back, so the customer list builds itself."] },
  ],
  faqs: [
    ["Will my mechanics manage it?", "If they use WhatsApp, they can use JMSURF Garage. The job card shows one next step at a time, and mechanics see only their own jobs if you want."],
    ["What if the internet goes down?", "Work saved before the outage is safe. You need a data connection to save new work, so many garages keep a phone hotspot as backup."],
    ["Can I print job cards?", "Yes. Job cards, estimates and invoices can be printed or sent as links and PDFs."],
  ],
  modules: ["garage_core", "workshop_pro"],
  related: [["How to choose garage software", "/guides/best-garage-management-software-kenya"], ["Mechanical workshops", "/for/mechanical-workshops"], ["Garage Core module", "/solutions/garage_core"], ["Pricing", "/pricing"]],
  wa: "Hello, we use paper job cards and would like to try JMSURF Garage.",
};

const ETIMS: ContentPage = {
  path: "/guides/etims-invoices-for-garages", group: "guides", crumb: "eTIMS for garages", article: true,
  title: "KRA eTIMS Invoices for Garages in Kenya: How It Works",
  description: "How JMSURF Garage signs invoices and credit notes with KRA eTIMS: what you need from KRA, automatic signing, receipt numbers, QR codes and when KRA is slow.",
  eyebrow: "eTIMS guide", h1: "KRA eTIMS invoices for garages",
  lead: "What eTIMS means for a garage, what you need from KRA, and exactly what JMSURF Garage does with every invoice and credit note.",
  photo: "parts",
  blocks: [
    { h: "What eTIMS is", p: [
      "eTIMS is the Kenya Revenue Authority's electronic Tax Invoice Management System. Invoices are sent to KRA when they are issued, and KRA returns a receipt number, a signature and a QR code that anyone can use to check the invoice. Businesses that buy from you increasingly ask for eTIMS invoices, because KRA expects expenses to be backed by them.",
      "For a garage, that means every invoice for parts and labour should go through eTIMS. Typing invoices a second time into another system is slow and leads to mistakes, so the invoice should be signed straight from your garage system.",
    ] },
    { h: "How JMSURF Garage connects to KRA", p: [
      "JMSURF Garage connects to KRA's eTIMS through the JMSURF eTIMS hub, run by JMSURF Tax, using the online sales control unit (OSCU) route. Your business is set up on the hub with its own KRA details and key; JMSURF Garage never mixes your invoices with another company's.",
    ] },
    { h: "What happens to every invoice", list: [
      "Automatic signing is on unless you switch it off, so every sales invoice and every credit note is sent to KRA, job card invoices included.",
      "KRA's receipt number, signature and QR code are written onto the invoice and its PDF.",
      "If KRA is slow or down, the invoice stays pending and is checked again every 2 minutes, so you can keep working.",
      "A credit note must be linked to the invoice it corrects, and that invoice must already be signed, as KRA requires.",
      "Staff can also push a single invoice to eTIMS with a button and see its status.",
    ] },
    { h: "Labour and parts on the same invoice", p: [
      "KRA classifies every item. JMSURF Garage gives labour and services a default class for vehicle maintenance and repair services, and parts a default class for transport components, and you can set your own class on any item. Check the classes with your tax adviser or KRA before you go live; the defaults are a starting point, not tax advice.",
      "VAT is worked out on each line, so mixed invoices with VAT-able parts and labour come out right.",
    ] },
    { h: "What you need from KRA", list: [
      "Your KRA PIN and branch ID.",
      "An eTIMS OSCU registration for that PIN and branch, which gives you a device serial number. KRA issues this to you; JMSURF Tax can help with the application.",
      "Item classes for what you sell, if you want to change the defaults.",
    ], after: ["Your details are entered once in the KRA eTIMS settings of your workspace. You can test against KRA's sandbox before switching to live."] },
    { h: "What eTIMS costs in JMSURF Garage", p: [
      `eTIMS signing is part of Garage Core, so it comes with every plan from ${kes(FUNDI.price)} a month. There is no charge per invoice from JMSURF Garage.`,
    ] },
  ],
  faqs: [
    ["Do I need a separate eTIMS system?", "No. JMSURF Garage signs invoices and credit notes itself through the JMSURF eTIMS hub. You only need your own eTIMS OSCU registration from KRA."],
    ["What happens if KRA's system is down?", "The invoice is saved as pending and checked again every 2 minutes until KRA answers. You can keep working."],
    ["Can I switch automatic signing off?", "Yes. Automatic signing is on by default and can be switched off; staff can then push invoices to eTIMS one at a time."],
  ],
  modules: ["garage_core", "accounting"],
  related: [["JMSURF Tax (eTIMS hub)", "https://jmsurftax.co.ke"], ["How to take M-Pesa payments at a garage", "/guides/mpesa-payments-for-garages"], ["Accounting module", "/solutions/accounting"], ["Questions garage owners ask", "/faq"]],
  wa: "Hello, I would like to know how eTIMS works in JMSURF Garage.",
};

const REMIND: ContentPage = {
  path: "/guides/garage-service-reminders", group: "guides", crumb: "Service reminders", article: true,
  title: "Service Reminders for Garages: Bring Customers Back by SMS",
  description: "Send service reminders by date or mileage, insurance, inspection and PSV expiry reminders and win-back messages by SMS or WhatsApp, in English or Swahili.",
  eyebrow: "How-to guide", h1: "Service reminders that bring customers back",
  lead: "The cheapest customer to win is the one you already served. Remind them when the next service is due, before they drive past to another garage.",
  photo: "garage",
  blocks: [
    { h: "Why reminders matter", p: [
      "Most car owners do not track their own service dates. They come back when a light comes on or something sounds wrong, and by then they may go to whichever garage is nearest. A short SMS a few days before the service is due keeps your garage in their mind and their car in good shape.",
      "Reminders also help with the paperwork drivers forget: insurance, inspection, speed governor and PSV licence renewals. A garage that reminds them is a garage they trust.",
    ] },
    { h: "Reminders JMSURF Garage can send", list: [
      "Service due, by date or by mileage, a set number of days or kilometres before it is due.",
      "Insurance expiry.",
      "Inspection expiry.",
      "Speed governor expiry.",
      "PSV licence expiry.",
      "We miss you, to customers you have not seen for 6 or 12 months.",
      "Booking reminder, the day before a booked visit.",
    ], after: ["Service reminders, bookings and estimates are part of Garage Core on every plan."] },
    { h: "How they are sent", p: [
      "Reminders go by SMS or WhatsApp, in English or Swahili, at the hour you choose. You can change the wording of each kind of reminder, and a preview shows what is due today before anything is sent. Each due item is sent once, not every day.",
      "Customers' choices are respected: a customer who does not want reminders or offers is not sent them, and a customer who asks to stop is stopped.",
    ] },
    { h: "What it costs to send", p: [
      `On the JMSURF SMS line each SMS costs ${kes(SMS_PRICE_KES)}, paid from credit you top up by M-Pesa from ${kes(SMS_MIN_TOPUP_KES)}. A message that runs over one SMS counts as more than one, so short reminders cost less. Garages with their own SMS account can connect it instead. WhatsApp reminders use the WhatsApp Inbox module.`,
    ] },
    { h: "Getting more from reminders", p: [
      "Keep mileage up to date at every visit, because mileage-based reminders depend on it. Ask for the customer's consent at check-in and record it. Use the job tracking page and the rating it asks for to learn which customers were happy; follow up the unhappy ones yourself.",
      "For bigger campaigns, such as a discount on brake checks before the rains, the Marketing module sends SMS, WhatsApp and email campaigns to groups of customers chosen from your customer and vehicle list.",
      "Start small: switch on the service reminder and the booking reminder first, watch for a month how many customers come back after a reminder, then add the expiry and win-back messages.",
    ] },
  ],
  faqs: [
    ["Do reminders cost extra?", `The reminders feature is in every plan. The SMS themselves cost ${kes(SMS_PRICE_KES)} each on the JMSURF SMS line, or go through your own SMS account.`],
    ["Can reminders be in Swahili?", "Yes. Each reminder has English and Swahili text, and you choose the language."],
    ["Will customers get the same reminder every day?", "No. Each due item is sent once and logged."],
  ],
  modules: ["garage_core", "marketing", "whatsapp"],
  related: [["Car hire companies", "/for/car-hire"], ["Fleet maintenance", "/for/fleet-maintenance"], ["Marketing module", "/solutions/marketing"], ["JMSURF SMS", "https://jmsurfsms.co.ke"]],
  wa: "Hello, I would like to see service reminders in JMSURF Garage.",
};

const GUIDES: ContentPage[] = [BEST, PRICE, MPESA, PAPER, ETIMS, REMIND];

/* ================================================================== town pages */

interface Town { slug: string; name: string; title: string; description: string; local: string[]; focus: string[]; photo: PhotoKey; nearby: [string, string] }

const TOWNS: Town[] = [
  { slug: "nairobi", name: "Nairobi", photo: "fundi",
    title: "Garage Management Software in Nairobi | JMSURF Garage",
    description: "Garage software for Nairobi workshops, spares shops, body shops and car washes: job cards, M-Pesa, KRA eTIMS invoices and SMS, with support from Westlands.",
    local: [
      "Nairobi has every kind of motor business, from fundis working at the roadside to dealers' service centres, spares shops in town and along the industrial areas, body shops, car washes and car yards. Traffic means customers want to know when their car will be ready before they set off to collect it, which is what the job tracking link and the car-ready SMS are for.",
      "JMSURF Technologies is based at Devan Plaza, 5th Floor, Crossway Road, Westlands, Nairobi. Nairobi garages can call or WhatsApp us, or arrange a visit to the office to see JMSURF Garage before signing up.",
    ],
    focus: ["mechanical-workshops", "spare-parts-shops", "body-shops", "car-washes"], nearby: ["Nakuru", "/garage-software/nakuru"] },
  { slug: "mombasa", name: "Mombasa", photo: "port",
    title: "Garage Management Software in Mombasa | JMSURF Garage",
    description: "Garage software for Mombasa garages, importers, car yards and spares shops: job cards, landed cost of imports, M-Pesa and KRA eTIMS invoices. 14 days free.",
    local: [
      "Mombasa is Kenya's main port, where imported vehicles and spare parts come ashore. Many motor businesses at the coast import their own stock, run car yards or prepare imported cars for sale, so the Imports & Landed Cost and Vehicle Yard modules fit them well: freight, duty, clearing and port charges are spread over each car or part, and an SMS warns you when a shipment at the port is close to the end of its free days.",
      "Coast garages are set up and supported remotely by phone and WhatsApp from our Nairobi office, so there is nothing to install and no need to travel.",
    ],
    focus: ["motor-importers", "car-dealers", "spare-parts-shops", "mechanical-workshops"], nearby: ["Nairobi", "/garage-software/nairobi"] },
  { slug: "kisumu", name: "Kisumu", photo: "garage",
    title: "Garage Management Software in Kisumu | JMSURF Garage",
    description: "Garage software for Kisumu workshops, spares shops, car washes and boda boda mechanics: job cards, M-Pesa, KRA eTIMS invoices and SMS reminders. 14 days free.",
    local: [
      "Kisumu is the main town of western Kenya and the lakeside region, with workshops, spares shops and car washes serving private cars, matatus, trucks and a very large number of motorbikes. Small garages and fundis there can start on the Fundi plan, and mechanics who work on boda bodas can keep each bike's history and the owner's phone number on the job card just as for a car.",
      "Kisumu businesses are set up and supported remotely by phone and WhatsApp from our Nairobi office. Everything runs in the browser, so there is nothing to install.",
    ],
    focus: ["roadside-mechanics", "mechanical-workshops", "car-washes", "spare-parts-shops"], nearby: ["Eldoret", "/garage-software/eldoret"] },
  { slug: "nakuru", name: "Nakuru", photo: "lift",
    title: "Garage Management Software in Nakuru | JMSURF Garage",
    description: "Garage software for Nakuru workshops, tyre shops, towing firms and spares shops: job cards, M-Pesa, KRA eTIMS invoices and SMS reminders, 14 days free to start.",
    local: [
      "Nakuru sits on the main highway between Nairobi and western Kenya, so its garages see a steady flow of trucks, buses and travelling cars as well as local customers. Breakdowns and accidents on the highway mean towing and roadside work, and long-distance vehicles wear tyres quickly, so the Towing & Mobile Mechanic and Tyres, Alignment & Batteries modules suit many Nakuru businesses.",
      "Nakuru businesses are set up and supported remotely by phone and WhatsApp from our Nairobi office, and everything runs in the browser.",
    ],
    focus: ["towing", "tyre-shops", "mechanical-workshops", "fleet-maintenance"], nearby: ["Nairobi", "/garage-software/nairobi"] },
  { slug: "eldoret", name: "Eldoret", photo: "inspect",
    title: "Garage Management Software in Eldoret | JMSURF Garage",
    description: "Garage software for Eldoret workshops, fleet garages, tyre shops and spares shops: job cards, fleet contracts, M-Pesa and KRA eTIMS invoices. 14 days free.",
    local: [
      "Eldoret is on the Northern Corridor road towards Uganda and serves a large farming region, so its garages work on transit trucks, farm vehicles and company fleets as well as private cars. Garages that service fleets on contract can use Fleet Contracts & Fleet Portal for agreed rates, job approval by the fleet manager with an LPO number, and monthly statements.",
      "Eldoret businesses are set up and supported remotely by phone and WhatsApp from our Nairobi office, and everything runs in the browser.",
    ],
    focus: ["fleet-maintenance", "tyre-shops", "mechanical-workshops", "spare-parts-shops"], nearby: ["Kisumu", "/garage-software/kisumu"] },
];

const forBySlug = (slug: string) => FOR.find((f) => f.path === `/for/${slug}`)!;

function townPage(t: Town): ContentPage {
  return {
    path: `/garage-software/${t.slug}`, group: "places", crumb: `Garage software in ${t.name}`,
    title: t.title, description: t.description,
    eyebrow: `${t.name}, Kenya`, h1: `Garage management software in ${t.name}`,
    lead: `JMSURF Garage runs job cards, estimates, parts, M-Pesa payments and KRA eTIMS invoices for motor businesses in ${t.name}, on the phones your team already has.`,
    photo: t.photo,
    blocks: [
      { h: `Motor businesses in ${t.name}`, p: t.local },
      { h: "What every garage gets", p: [
        `Garage Core is in every plan. It covers job cards from check-in to collection, customers and vehicles with their history, estimates the customer approves line by line from a link, M-Pesa payments that land on your own Till or Paybill and mark invoices paid, KRA eTIMS invoices, SMS when the car is ready, service reminders by date or mileage in English or Swahili, basic stock and the owner's dashboard.`,
        "Each person on your team signs in with their own login at app.jmsurfgarage.co.ke and sees only what their role allows. The owner can follow every car and every shilling from anywhere, which matters when you are not at the garage all day.",
      ] },
      { h: `Kinds of business in ${t.name} it fits`, links: t.focus.map((s) => { const f = forBySlug(s); return [f.crumb, f.path, f.lead] as [string, string, string]; }) },
      { h: "Getting started", list: [
        `Sign up online and use every module you choose free for ${TRIAL_DAYS} days, no card needed.`,
        "Add your team and set each person's role.",
        "Book in your next car and send your first estimate link.",
        "Connect M-Pesa with your own Till or Paybill, and KRA eTIMS with your own registration.",
        "Call or WhatsApp us on +254 712 504 593 if you want help with any step.",
      ] },
      costBlock("Prices", `Plans go by the size of your garage. A small ${t.name} garage on the Starter plan (up to ${STARTER.users} users) with Garage Core pays:`, "starter", [],
        [`The Fundi plan for one-person garages is ${kes(FUNDI.price)} a month, Business ${kes(BUSINESS.price)} and Pro ${kes(PRO.price)}. See the pricing page for every module.`]),
    ],
    faqs: [
      [`Do you have an office in ${t.name}?`, t.slug === "nairobi" ? "Yes. JMSURF Technologies is at Devan Plaza, 5th Floor, Crossway Road, Westlands, Nairobi." : `No. JMSURF Technologies is in Nairobi (Westlands). ${t.name} garages are set up and supported by phone and WhatsApp, and nothing needs to be installed.`],
      ["Does it work on mobile data?", "Yes. Every screen has a phone layout and loads fast on mobile data. You need a connection to save work."],
      ["Can I try it first?", `Yes. Every plan and module is free for ${TRIAL_DAYS} days, no card needed.`],
    ],
    modules: ["garage_core", "workshop_pro", "inventory"],
    related: [[`Garage software in ${t.nearby[0]}`, t.nearby[1]], ["Garage software prices in Kenya", "/guides/garage-software-price-kenya"], ["How to choose garage software", "/guides/best-garage-management-software-kenya"], ["Pricing", "/pricing"]],
    wa: `Hello, I run a motor business in ${t.name} and would like a demo of JMSURF Garage.`,
  };
}

const PLACES = TOWNS.map(townPage);

/* ================================================================== indexes and FAQ */

const FOR_INDEX: ContentPage = {
  path: "/for", group: "for", crumb: "Garage types",
  title: "Garage Software for Every Motor Business in Kenya | JMSURF",
  description: "JMSURF Garage for workshops, fundis, body shops, car washes, tyre shops, spares shops, car yards, importers, towing, car hire and fleet garages in Kenya.",
  eyebrow: "Who it is for", h1: "Garage software for every kind of motor business",
  lead: "One system for the roadside fundi, the busy workshop, the body shop, the spares counter and the car yard. Pick your kind of business to see how it works for you and what it costs.",
  photo: "workshop",
  blocks: [
    { h: "Choose your kind of business", links: FOR.map((f) => [f.crumb, f.path, f.lead]) },
    { h: "More than one kind under one roof", p: [
      "Many Kenyan motor businesses do several things at once: a workshop with a car wash at the gate, a body shop with a tow truck, a spares shop that also fits parts, a car yard that prepares its own cars. JMSURF Garage handles that by letting you switch on a module for each thing you do. They all share the same customers, vehicles, parts, staff and invoices, so nothing is typed twice.",
      `At sign-up you tick what your business does and the matching modules are chosen for you, with the monthly price shown before you start. If you run many kinds of work, the All modules bundle gives the Pro plan and every garage module for ${kes(ALL.price)} a month.`,
    ] },
    { h: "Across Kenya", p: ["JMSURF Garage runs in the browser, so it works anywhere in Kenya with a data connection. Garages outside Nairobi are set up and supported by phone and WhatsApp."],
      links: PLACES.map((pl) => [pl.crumb, pl.path, pl.description]) },
  ],
  modules: ["garage_core", "workshop_pro", "inventory", "commerce"],
  related: [["All modules", "/solutions"], ["Pricing", "/pricing"], ["Guides", "/guides"], ["Questions garage owners ask", "/faq"]],
  wa: "Hello, I would like to know which JMSURF Garage plan fits my business.",
};

const GUIDE_INDEX: ContentPage = {
  path: "/guides", group: "guides", crumb: "Guides",
  title: "Guides for Garage Owners in Kenya: M-Pesa, eTIMS, Prices",
  description: "Plain guides for Kenyan garage owners: choosing garage software, real prices, M-Pesa payments, KRA eTIMS invoices, job cards vs paper and service reminders.",
  eyebrow: "Guides", h1: "Guides for garage owners in Kenya",
  lead: "Short, practical guides on running a garage with software: what to look for, what it costs, and how M-Pesa, eTIMS, job cards and reminders work.",
  photo: "engine",
  blocks: [
    { h: "All guides", links: GUIDES.map((g) => [g.h1, g.path, g.description]) },
    { h: "Why we write these", p: [
      "Garage owners ask us the same questions every week: what should garage software do, what should it cost, how do M-Pesa payments get matched to invoices, what does eTIMS need, and is it worth leaving paper job cards. These guides answer those questions in plain words, with real prices from our own plans and only what our software really does.",
      "Every price in these guides is worked out from the same plan and module prices the sign-up page uses, so the numbers stay in step when prices change. Features are described only as far as JMSURF Garage really does them today.",
      "If a guide does not answer your question, ask us on WhatsApp or by phone on +254 712 504 593, or read the questions page.",
    ] },
    { h: "Guides by kind of business", links: FOR.slice(0, 6).map((f) => [f.crumb, f.path, f.lead]) },
  ],
  modules: ["garage_core"],
  related: [["Questions garage owners ask", "/faq"], ["Garage types", "/for"], ["Pricing", "/pricing"], ["All modules", "/solutions"]],
  wa: "Hello, I have a question about JMSURF Garage.",
};

/** All the questions on /faq (the home page and pricing page questions plus more). */
export const FAQ_ALL: [string, string][] = [
  ...HOME.faq,
  ...HOME.pricingFaq,
  ["Do customers pay JMSURF or my garage?", "Your garage. M-Pesa payments go to your own Till, Paybill or account; JMSURF Garage records them and matches them to invoices."],
  ["How do I connect M-Pesa?", "Choose one way in your workspace settings: JMSURF PAY with your own Till, Paybill or bank account, your own Safaricom Daraja app, or Paystack for card and mobile money."],
  ["What do I need for KRA eTIMS?", "Your KRA PIN, your branch ID and an eTIMS OSCU registration from KRA for them. You enter them once; then invoices and credit notes are signed automatically."],
  ["What happens when KRA eTIMS is slow?", "The invoice stays pending and is checked again every 2 minutes until KRA answers, so your staff can keep working."],
  ["How much do SMS cost?", `On the JMSURF SMS line, ${kes(SMS_PRICE_KES)} per SMS, from credit you top up by M-Pesa from ${kes(SMS_MIN_TOPUP_KES)}. You can also connect your own SMS account.`],
  ["Can customers follow their car's repair?", "Yes. Each job has a tracking link sent by SMS that shows the stage, photos, invoices and a pay link, and asks for a rating when the job is done."],
  ["Can customers book online?", "Yes. Your garage gets an online booking page; bookings arrive in your workspace and the customer gets a reminder the day before."],
  ["Can a car leave without paying?", "The gate pass checks payment first. A car with a balance is released only by someone allowed to release on credit, and their name is recorded."],
  ["Does it work for boda boda and truck repairs?", "Yes. A vehicle can be any kind of vehicle; it keeps its plate, mileage and history the same way."],
  ["Can I use my own web address?", `Yes. Your garage's customer pages can run on your own domain for ${kes(CUSTOM_DOMAIN_KES)} once. The Online Parts Shop & Website module adds a full garage website and parts shop.`],
  ["Where do my staff sign in?", "Everyone signs in at app.jmsurfgarage.co.ke with their own email and password. One login works for every garage you run."],
  ["Who makes JMSURF Garage?", "JMSURF TECHNOLOGIES LTD, a Kenyan software company at Devan Plaza, 5th Floor, Crossway Road, Westlands, Nairobi. It also makes JMSURF POS, JMSURF PAY, JMSURF SMS and other business systems."],
  ["How do I get help?", "Call or WhatsApp +254 712 504 593, or email info@jmsurf.co.ke."],
];

const FAQ_PAGE: ContentPage = {
  path: "/faq", group: "faq", crumb: "Questions",
  title: "JMSURF Garage FAQ: Prices, M-Pesa, eTIMS and Set-up, Kenya",
  description: "What garage owners ask about JMSURF Garage: plans and modules, free trial, M-Pesa payments, KRA eTIMS, SMS costs, branches, staff logins and data safety.",
  eyebrow: "Questions", h1: "Questions garage owners ask about JMSURF Garage",
  lead: "Plans, modules, M-Pesa, KRA eTIMS, SMS, staff and data safety, answered in plain words. If your question is not here, call or WhatsApp us.",
  blocks: [],
  faqs: FAQ_ALL,
  modules: ["garage_core"],
  related: [["Pricing", "/pricing"], ["Guides", "/guides"], ["Garage types", "/for"], ["Start free", "/register"]],
  wa: "Hello, I have a question about JMSURF Garage.",
};

/** Every guide page, in sitemap order. */
export const CONTENT_PAGES: ContentPage[] = [FOR_INDEX, ...FOR, GUIDE_INDEX, ...GUIDES, FAQ_PAGE, ...PLACES];
export const CONTENT_BY_PATH: Record<string, ContentPage> = Object.fromEntries(CONTENT_PAGES.map((c) => [c.path, c]));

/** Breadcrumb trail of a guide page: [name, path][]. */
export function contentCrumbs(c: ContentPage): [string, string][] {
  const parent = GROUP_PARENT[c.group];
  const trail: [string, string][] = [["Home", "/"]];
  if (parent && parent[1] !== c.path) trail.push(parent);
  trail.push([c.crumb, c.path]);
  return trail;
}
