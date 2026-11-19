/** Terms of Service and Privacy Policy text (the /terms and /privacy pages and their build-time snapshots). */

export const UPDATED = "17 October 2026";

export type Section = { h: string; p: (string | string[])[] };

export function termsSections(email: string): Section[] {
  return [
    { h: "1. Who we are", p: [
      "JMSURF Garage is a cloud garage management service provided by JMSURF Technologies, Devan Plaza, 5th Floor, Westlands, Nairobi, Kenya (\"we\", \"us\"). JMSURF TECHNOLOGIES LTD is registered with the Office of the Data Protection Commissioner (ODPC) as a Data Controller and Data Processor, registration no. 194-9812-26EB. These terms apply to everyone who creates a business or uses one (\"you\").",
    ] },
    { h: "2. Your account", p: [
      "You must give accurate details when you sign up and keep your password private. You are responsible for everything done under your company, including by staff you add.",
      "The person who creates a business is its owner. The owner decides who else can use it and what they can do.",
    ] },
    { h: "3. Free trial and packages", p: [
      "New companies get a 14-day free trial. After the trial you need an active package to keep using the service. Package prices are shown in Kenyan shillings (KES) on our website and inside the app.",
      "Packages are paid in advance for the period you choose. You can renew, change or stop your package at any time; stopping takes effect at the end of the period you have paid for. Payments already made are not refunded unless the law requires it.",
      "If a package is not renewed, the business is paused. Your data is kept so you can pick up where you left off when you renew.",
    ] },
    { h: "4. Payments you take from customers", p: [
      "When you accept mobile money or card payments through the app, the money is paid by the customer to the account you set up (for example your M-Pesa Till or Paybill, bank or Paystack account) through the payment provider. The provider's own terms and charges apply to those payments.",
      "You are responsible for the prices you charge, the taxes you collect and the receipts you issue.",
    ] },
    { h: "5. Acceptable use", p: [
      "Do not use the service for anything unlawful, to sell illegal goods, to send spam, or to try to access other companies' data or disrupt the service.",
      "We may suspend a business that breaks these rules or puts other users at risk. Where we can, we will tell you first and give you a chance to fix the problem.",
    ] },
    { h: "6. Our service and intellectual property", p: [
      "JMSURF Garage, its software, design, screens, documents, templates, text, graphics, logos and the names JMSURF and JMSURF Garage belong to JMSURF Technologies or our licensors and are protected by copyright, trade mark and other laws in Kenya and elsewhere.",
      "While your package is active we give you a limited, non-exclusive, non-transferable right to use the service for your own business. Nothing in these terms transfers ownership of the service to you.",
    ] },
    { h: "7. What you may not do", p: [
      "You agree not to, and not to let anyone else:",
      [
        "copy, reproduce, modify, translate or create works based on the service, its screens, documents, templates or text, except your own business documents produced by the app;",
        "reverse engineer, decompile, disassemble or try to find the source code, structure or methods of the service, except where the law expressly allows it despite this term;",
        "use the service, your account or any information from it to design, build or improve a product or service that competes with JMSURF Garage, or to copy its features, layouts or workflows;",
        "access the service with robots, scrapers or automated tools other than our published API, or overload, probe or test its security without our written permission;",
        "publish benchmarks, comparisons or screenshots of the service for marketing a competing product;",
        "resell, rent, sub-license, share accounts outside your company, or offer the service to others as a bureau, unless we agree in writing (for example as a JMSURF partner);",
        "remove or hide any notice of ours, including \"Powered by JMSURF TECHNOLOGIES\" where it appears;",
        "frame or mirror the service, or use our names or logos in a way that suggests we endorse you.",
      ],
      "Breaking this section is a serious breach. We may suspend or close the account straight away and take any action the law allows.",
    ] },
    { h: "8. Data you bring in", p: [
      "When you import data or connect another system (for example through Move-in), you confirm you are allowed to use that data and to give us access to it. You are responsible for following the other system's terms. We only read what is needed to bring your records across.",
    ] },
    { h: "9. Your data", p: [
      "Your business data belongs to you. You can export it at any time from Settings. We only use it to provide and improve the service, as explained in our Privacy Policy.",
      "If you close your company account we archive it: nothing is deleted, sign-in stops, and you or we can restore it later. You can ask us to delete it permanently.",
    ] },
    { h: "10. Confidentiality and feedback", p: [
      "Each of us keeps the other's non-public information confidential and uses it only for this service. Ideas or suggestions you send us may be used freely to improve JMSURF Garage, without any obligation to you.",
    ] },
    { h: "11. Data protection", p: [
      "We process personal data under the Kenya Data Protection Act, 2019, as a processor for the personal data in your business records and as a controller for account and billing details. Details are in our Privacy Policy.",
    ] },
    { h: "12. Availability", p: [
      "We work hard to keep JMSURF Garage running and to back up data, and the app keeps selling offline when your internet drops. We cannot promise the service will never be interrupted, for example during maintenance or problems with internet or payment providers.",
    ] },
    { h: "13. Liability and indemnity", p: [
      "The service is provided as it is. To the extent the law allows, we are not liable for indirect losses such as lost profits, and our total liability for any claim is limited to the fees you paid us in the three months before the claim.",
      "You will cover our reasonable losses and costs from claims that arise from your business, your data or your breach of these terms.",
    ] },
    { h: "14. Suspension and ending", p: [
      "You may close your company at any time from Settings. We may suspend or close a company that does not pay, breaks these terms or puts the service or other users at risk. After closing, sections 6, 7, 10 and 13 continue to apply.",
    ] },
    { h: "15. Changes", p: [
      "We may update these terms. If a change is significant we will tell business owners by email or in the app before it takes effect. Continuing to use the service after that means you accept the new terms.",
    ] },
    { h: "16. Law, disputes and contact", p: [
      "These terms are governed by the laws of Kenya. We will first try to settle any dispute by talking in good faith; if that fails within 30 days, the courts of Nairobi have jurisdiction.",
      "These terms are the whole agreement between us about the service. If any part cannot be enforced, the rest still applies. You may not transfer your rights under them without our written consent.",
      `Questions? Email ${email}.`,
    ] },
  ];
}

export function privacySections(email: string): Section[] {
  return [
    { h: "1. Who is responsible", p: [
      "JMSURF Technologies, Devan Plaza, 5th Floor, Westlands, Nairobi, Kenya, runs JMSURF Garage. JMSURF TECHNOLOGIES LTD is registered with the Office of the Data Protection Commissioner (ODPC) as a Data Controller and Data Processor, registration no. 194-9812-26EB. For the business data a business owner puts into the app (such as their customers' details), the business owner decides what is collected and we process it on their behalf.",
    ] },
    { h: "2. What we collect", p: [[
      "Account details: names, email addresses, phone numbers and passwords (stored encrypted) of business owners and staff.",
      "Business details: company name, address, tax ID, logo, branches and settings.",
      "Business records you create: products, stock, sales, receipts, invoices, quotes, expenses, suppliers, shifts and customers, including customer names, phone numbers, credit and loyalty balances.",
      "Payment information: amounts, phone numbers and references needed to send payment prompts and confirm payments. We do not store card numbers.",
      "Technical data: device and browser type, pages used and error reports, so we can keep the service secure and fix problems.",
    ]] },
    { h: "3. How we use it", p: [[
      "To provide the service: keep your books and records, run the apps you switch on, and print and send documents.",
      "To take and confirm payments, and to bill your package.",
      "To keep accounts secure, prevent fraud and fix errors.",
      "To send important messages about your account. We only send marketing if you agree, and you can opt out at any time.",
    ]] },
    { h: "4. Who we share it with", p: [
      "We do not sell personal data. We share only what is needed with service providers that help us run JMSURF Garage, such as hosting, email delivery and payment providers (mobile money and card processors). They may only use it to provide their service to us.",
      "We may disclose data where the law requires it.",
    ] },
    { h: "5. How long we keep it", p: [
      "We keep your data while your company account is active. If you close it, we archive it rather than delete it, so it can be restored or exported later. If you want it permanently deleted, email us and we will do so, except for records the law requires us to keep (for example tax records).",
    ] },
    { h: "6. Security", p: [
      "Each company's data is kept separate and access is controlled by staff roles. Connections are encrypted and data is backed up regularly.",
    ] },
    { h: "7. Your rights", p: [
      "Under the Kenya Data Protection Act, 2019 and similar laws, you can ask to see, correct, export or delete your personal data, and object to certain uses of it. Store owners can export their data from Settings at any time.",
      `To make a request, email ${email}. If you are a customer of a company that uses JMSURF Garage, you can also contact the business directly. You may complain to the Office of the Data Protection Commissioner.`,
    ] },
    { h: "8. Changes", p: [
      "We may update this policy. The date at the top shows when it last changed; significant changes will be announced in the app or by email.",
    ] },
  ];
}

