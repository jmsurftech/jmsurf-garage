/**
 * The words on the website's home and pricing pages, shared by the live pages
 * (Landing.tsx, Pricing.tsx) and the build-time snapshots (src/seo/pages.ts), so
 * search engines read exactly what visitors see. Plain words, no invented people.
 */

export const HOME = {
  eyebrow: "JMSURF Garage · Garage software for Kenya",
  headline: "Run your garage from your phone.",
  lead: "Job cards, estimates your customers approve online, parts, M-Pesa payments and KRA eTIMS invoices in one place. For the roadside fundi, the busy workshop and the dealer.",
  stats: [
    { v: "KES 500", l: "a month to start" },
    { v: "14 days", l: "free, no card" },
    { v: "M-Pesa", l: "and eTIMS built in" },
    { v: "1 login", l: "for every branch" },
  ],
  who: [
    { t: "Roadside fundi", d: "Job cards and M-Pesa receipts on your phone, from KES 500 a month." },
    { t: "Neighbourhood garage", d: "Book cars in, send estimates, invoice with eTIMS and tell customers by SMS when the car is ready." },
    { t: "Busy workshop", d: "Bay board, inspections with photos and a phone view for every mechanic." },
    { t: "Dealer service centre", d: "Branches, payroll, accounting and insurance work in one system." },
    { t: "Spares shop", d: "A fast counter till, wholesale price lists and parts stock across stores." },
    { t: "Importer", d: "Shipments, duty and clearing spread into the true landed cost of each part or car." },
    { t: "Body shop", d: "Panel and paint stages, photos for the insurer and the excess billed to the customer." },
    { t: "Car wash", d: "A queue by number plate, packages, attendants' commission and M-Pesa at the bay." },
    { t: "Fleets, towing and car hire", d: "Fleet contracts with a portal, tow call-outs by distance and cars out on hire." },
  ],
  flow: [
    { t: "Book in", d: "Open a job card with the customer, the car, its plate and mileage. Returning cars bring their history." },
    { t: "Inspect", d: "Tick the checklist and add photos, so the customer sees what you see." },
    { t: "Estimate", d: "Parts and labour priced in a minute and sent by SMS or WhatsApp." },
    { t: "Approve", d: "The customer approves the estimate from the link on their phone. No more calling back and forth." },
    { t: "Repair", d: "Mechanics see their jobs, parts come off stock and the bay board shows progress." },
    { t: "Invoice and pay", d: "A KRA eTIMS invoice and an M-Pesa prompt. The payment is matched to the invoice by itself." },
    { t: "Ready and reminded", d: "An SMS when the car is ready, and a reminder when the next service is due." },
  ],
  kenya: [
    { t: "M-Pesa built in", d: "STK push, Till and Paybill. Payments land on your own number and mark invoices paid." },
    { t: "KRA eTIMS invoices", d: "Every invoice signed for KRA without extra steps, with VAT worked out." },
    { t: "SMS updates", d: "Estimates, car-ready messages, receipts and service reminders by SMS." },
    { t: "Phone first", d: "Every screen works on a phone, installs like an app and is fast on slow data." },
    { t: "Local support", d: "Real people in Nairobi on phone and WhatsApp who know how garages run." },
    { t: "Pay in shillings", d: "Plans in KES, paid by M-Pesa. Pay yearly and get 2 months free." },
  ],
  security: [
    { t: "Each garage kept apart", d: "Database-level separation: one garage can never see another one's records." },
    { t: "Two-step sign-in", d: "An authenticator code for owners and staff who want it." },
    { t: "Roles and rights", d: "Mechanics see their jobs; only the owner sees the money if you want it that way." },
    { t: "Daily backups", d: "Automatic backups and a standby server in another country." },
  ],
  faq: [
    ["Who is JMSURF Garage for?", "Every kind of motor business in Kenya: the roadside fundi, small and busy workshops, dealers' service centres, spares shops, importers, car yards, body shops, car washes, tyre centres, fleets, towing and car hire."],
    ["What do I get on the smallest plan?", "The Fundi plan (KES 500 a month, 3 users) has Garage Core: job cards, customers and vehicles, estimates approved online, M-Pesa payments, KRA eTIMS invoices, SMS updates, basic stock and the owner's dashboard."],
    ["How do modules work?", "Your plan sets the size of your garage. Modules add what your business does, such as a spares counter, body and paint or car hire. Turn one on any time: it is free for 14 days the first time and then added to your monthly bill from that day."],
    ["What happens if I turn a module off?", "It keeps working until the end of the period you paid for. Your records are kept and can be read, and everything comes back if you turn it on again."],
    ["Can my customers approve estimates on their phone?", "Yes. The estimate goes by SMS or WhatsApp with a link; the customer sees the parts, labour and photos and approves it there."],
    ["Does it work with M-Pesa and KRA?", "Yes. M-Pesa payments and KRA eTIMS invoices are part of every plan."],
    ["Can I run more than one branch?", "Yes. Pro includes two branches and each extra branch is KES 2,000 a month. Groups with many branches get an Enterprise price."],
    ["Is my data safe?", "Yes. Data is encrypted in transit, each garage is kept apart at database level, sign-in supports two-step verification, and backups run every day."],
    ["Is there a free trial?", "Yes: 14 days free with every module you choose, no card needed."],
  ] as [string, string][],
  pricingFaq: [
    ["What does yearly payment cost?", "Ten times the monthly price: you get 2 months free."],
    ["What is an extra branch?", "Each branch above what your plan includes costs KES 2,000 a month."],
    ["How are SMS paid for?", "SMS are bought in bundles from inside your workspace, and you only pay for what you send."],
    ["Do prices include VAT?", "No. Prices are in Kenya shillings and exclude VAT."],
    ["Can I change plan later?", "Yes. Moving up works at once and you pay only for the days left in your period. Moving down takes effect at your next renewal."],
    ["Who can buy or remove modules?", "The owner, or someone the owner gives billing rights to."],
  ] as [string, string][],
};

/** The section headings on the home page, as shown (highlighted words joined in). */
export const HOME_HEADINGS = {
  who: "From the roadside fundi to the dealer.",
  flow: "Every car, from gate to gate.",
  kenya: "Made for how Kenya pays and files.",
  modules: "Start with the core. Add what you do.",
  pricing: "Pay for the size of your garage.",
  security: "Your records, kept safe.",
  faq: "Questions garage owners ask.",
  final: "Your garage, in your pocket.",
};
