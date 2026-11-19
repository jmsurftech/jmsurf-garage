// The systems a company can move in from: how to export from each, and how
// their export columns map onto the columns the import engine reads.
import { detect, norm, type Kind, type Row } from "./importEngine";

export type SourceKey = "zoho" | "quickbooks" | "sage" | "xero" | "odoo" | "erpnext" | "tally" | "loyverse" | "other";
export type ApiSource = "books_api" | "quickbooks" | "odoo" | "sage" | "xero" | "erpnext" | "loyverse";

export type Source = {
  key: SourceKey; name: string; logo: string; tagline: string;
  /** Connect by API: the server-side source id used by the migrate routes. */
  api?: ApiSource;
  /** Where each list is exported in that system. */
  where: Partial<Record<Kind, string>>;
  /** Before you export: general tips shown above the list. */
  tips: string[];
  /** File names that point to a kind in this system's exports. */
  files?: [RegExp, Kind][];
  /** Their column (normalised) → the engine's column (normalised), per kind or for every kind ("*"). */
  columns?: Partial<Record<Kind | "*", Record<string, string>>>;
  /** Their account types → the engine's (normalised) account types. */
  accountTypes?: Record<string, string>;
};

const ALL: Source[] = [
  {
    key: "zoho", name: "Zoho", logo: "zoho", api: "books_api", tagline: "Zoho Books, Inventory, Invoice, CRM and People",
    tips: ["Sign in as an admin. Each list has Export in its ⋯ menu (choose CSV and all records).", "Or Settings → Data backup → Backup your data, then unzip the download and upload all the files."],
    where: {
      accounts: "Accountant → Chart of Accounts → ⋯ → Export", customers: "Sales → Customers → ⋯ → Export Customers", vendors: "Purchases → Vendors → ⋯ → Export Vendors",
      items: "Items → ⋯ → Export Items", quotes: "Sales → Quotes → ⋯ → Export", sales_orders: "Sales → Sales Orders → ⋯ → Export", invoices: "Sales → Invoices → ⋯ → Export Invoices",
      credit_notes: "Sales → Credit Notes → ⋯ → Export", payments: "Sales → Payments Received → ⋯ → Export", purchase_orders: "Purchases → Purchase Orders → ⋯ → Export",
      bills: "Purchases → Bills → ⋯ → Export", vendor_payments: "Purchases → Payments Made → ⋯ → Export", vendor_credits: "Purchases → Vendor Credits → ⋯ → Export",
      expenses: "Purchases → Expenses → ⋯ → Export", journals: "Accountant → Manual Journals → ⋯ → Export", bank_accounts: "Banking → ⋯ → Export",
      bank_transactions: "Banking → open the account → ⋯ → Export", opening_balances: "Settings → Opening Balances (or a trial balance as at the start date)",
      recurring_invoices: "Sales → Recurring Invoices → ⋯ → Export", recurring_bills: "Purchases → Recurring Bills → ⋯ → Export", recurring_expenses: "Purchases → Recurring Expenses → ⋯ → Export",
      price_lists: "Items → Price Lists → ⋯ → Export", projects: "Time Tracking → Projects → ⋯ → Export", timesheets: "Time Tracking → Timesheet → ⋯ → Export",
      leads: "Zoho CRM → Leads → ⋯ → Export", employees: "Zoho People / Payroll → Employees → Export",
    },
  },
  {
    key: "quickbooks", name: "QuickBooks", logo: "quickbooks", api: "quickbooks", tagline: "QuickBooks Online and QuickBooks Desktop",
    tips: ["QuickBooks Online: the quickest way is Connect by API. For files, open each list or report, then Export → Export to Excel.", "QuickBooks Desktop: File → Utilities → Export → Lists to IIF is not needed; use Reports → (report) → Excel → Create new worksheet."],
    files: [[/product.?service|products?.?and.?services/i, "items"], [/account.?list|chart/i, "accounts"], [/customer.?contact|customer.?list/i, "customers"], [/vendor.?contact|vendor.?list/i, "vendors"], [/invoice.?list|^invoices?/i, "invoices"], [/bill.?list|unpaid.?bills/i, "bills"], [/journal/i, "journals"]],
    where: {
      accounts: "Settings ⚙ → Chart of accounts → Run report → Export to Excel", customers: "Sales → Customers → Export (↓ icon above the list)", vendors: "Expenses → Vendors → Export (↓ icon)",
      items: "Settings ⚙ → Products and services → More → Export to Excel", invoices: "Reports → Invoice List (with line items: Sales by Customer Detail) → Export to Excel",
      payments: "Reports → Transaction List by Customer, filtered to Payment → Export", bills: "Reports → Bill Payment List / Unpaid Bills → Export to Excel",
      vendor_payments: "Reports → Bill Payment List → Export", expenses: "Reports → Transaction List by Vendor, filtered to Expense → Export", journals: "Reports → Journal → Export to Excel",
      purchase_orders: "Reports → Open Purchase Order List → Export", quotes: "Reports → Estimates by Customer → Export", credit_notes: "Reports → Transaction List by Customer, filtered to Credit Memo → Export",
      opening_balances: "Reports → Trial Balance as at your start date → Export",
    },
    columns: {
      "*": { customer: "customername", vendor: "vendorname", phonenumbers: "phone", fullname: "displayname", openbalance: "balance", memo: "notes", memodescription: "description" },
      customers: { customer: "displayname", billingaddress: "billingaddress", companyname: "companyname", taxid: "taxregistrationnumber" },
      vendors: { vendor: "vendorname", address: "billingaddress", taxid: "taxregistrationnumber", accountno: "customernumber" },
      items: { productservicename: "itemname", productservice: "itemname", salespricerate: "rate", salesprice: "rate", purchasecost: "purchaserate", quantityonhand: "stockonhand", type: "producttype", category: "categoryname", reorderpoint: "reorderpoint" },
      accounts: { account: "accountname", fullname: "accountname", type: "accounttype", accountnumber: "accountcode", detailtype: "description" },
      invoices: { no: "invoicenumber", num: "invoicenumber", invoiceno: "invoicenumber", date: "invoicedate", amount: "total", duedate: "duedate", productservice: "itemname", qty: "quantity", salesprice: "rate", rate: "rate" },
      quotes: { no: "estimatenumber", num: "estimatenumber", date: "estimatedate", amount: "total" },
      credit_notes: { no: "creditnotenumber", num: "creditnotenumber", date: "creditnotedate", amount: "total" },
      payments: { no: "paymentnumber", num: "paymentnumber", amount: "amount" },
      bills: { no: "billnumber", num: "billnumber", date: "billdate", amount: "total", duedate: "duedate" },
      vendor_payments: { no: "paymentnumber", num: "paymentnumber" },
      purchase_orders: { no: "purchaseordernumber", num: "purchaseordernumber", date: "purchaseorderdate", amount: "total" },
      journals: { num: "journalnumber", no: "journalnumber", date: "journaldate", account: "accountname" },
    },
    accountTypes: {
      bank: "bank", accountsreceivablear: "accountsreceivable", accountsreceivable: "accountsreceivable", othercurrentassets: "othercurrentasset", fixedassets: "fixedasset", otherassets: "otherasset",
      accountspayableap: "accountspayable", accountspayable: "accountspayable", creditcard: "creditcard", othercurrentliabilities: "othercurrentliability", longtermliabilities: "longtermliability",
      equity: "equity", income: "income", otherincome: "otherincome", costofgoodssold: "costofgoodssold", expenses: "expense", otherexpense: "otherexpense", inventory: "stock",
    },
  },
  {
    key: "odoo", name: "Odoo", logo: "odoo", api: "odoo", tagline: "Odoo Online, Odoo.sh and self-hosted, any edition",
    tips: ["The quickest way is Connect by API with an API key.", "For files: open the list view, tick the records (select all), then Action ⚙ → Export, choose the fields and Export as XLSX."],
    files: [[/res.?partner|contact/i, "customers"], [/product/i, "items"], [/account.?move|journal.?entr/i, "invoices"], [/account.?account|chart/i, "accounts"]],
    where: {
      accounts: "Accounting → Configuration → Chart of Accounts → select all → Action → Export", customers: "Contacts (or Accounting → Customers) → select all → Action → Export",
      vendors: "Accounting → Vendors → Vendors → select all → Action → Export (save as Vendors.xlsx)", items: "Inventory (or Sales) → Products → select all → Action → Export",
      invoices: "Accounting → Customers → Invoices → select all → Action → Export (add Invoice lines fields for line items)", credit_notes: "Accounting → Customers → Credit Notes → Export",
      payments: "Accounting → Customers → Payments → Export", bills: "Accounting → Vendors → Bills → select all → Action → Export", vendor_payments: "Accounting → Vendors → Payments → Export",
      quotes: "Sales → Quotations → Export", sales_orders: "Sales → Orders → Export", purchase_orders: "Purchase → Orders → Export", journals: "Accounting → Accounting → Journal Entries → Export",
      employees: "Employees → select all → Action → Export", leads: "CRM → Leads → Export",
    },
    columns: {
      "*": { partner: "customername", street: "billingaddress", city: "billingcity", country: "billingcountry", mobile: "mobilephone", taxid: "taxregistrationnumber", vat: "taxregistrationnumber", internalnotes: "notes" },
      customers: { name: "displayname", displayname: "displayname", companyname: "companyname" },
      vendors: { name: "vendorname", displayname: "vendorname", partner: "vendorname" },
      items: { name: "itemname", internalreference: "sku", salesprice: "rate", cost: "purchaserate", quantityonhand: "stockonhand", producttype: "producttype", productcategory: "categoryname", barcode: "barcode", unitofmeasure: "unit" },
      accounts: { code: "accountcode", accountname: "accountname", name: "accountname", type: "accounttype" },
      invoices: { number: "invoicenumber", invoicedate: "invoicedate", invoicebilldate: "invoicedate", customer: "customername", total: "total", totalsigned: "total", untaxedamount: "subtotal", tax: "taxtotal", amountdue: "balance", status: "invoicestatus", invoicelinesproduct: "itemname", invoicelinesquantity: "quantity", invoicelinesunitprice: "rate", invoicelinessubtotal: "itemtotal" },
      credit_notes: { number: "creditnotenumber", invoicedate: "creditnotedate", total: "total" },
      bills: { number: "billnumber", billdate: "billdate", invoicebilldate: "billdate", vendor: "vendorname", partner: "vendorname", total: "total", amountdue: "balance", status: "billstatus" },
      payments: { number: "paymentnumber", amount: "amount", date: "paymentdate" },
      vendor_payments: { number: "paymentnumber", partner: "vendorname", amount: "amount" },
      quotes: { orderreference: "estimatenumber", number: "estimatenumber", orderdate: "estimatedate", customer: "customername", total: "total" },
      sales_orders: { orderreference: "salesordernumber", number: "salesordernumber", orderdate: "orderdate", customer: "customername", total: "total" },
      purchase_orders: { reference: "purchaseordernumber", orderreference: "purchaseordernumber", vendor: "vendorname", partner: "vendorname", orderdeadline: "deliverydate", total: "total" },
      employees: { employeename: "name", workemail: "email", workmobile: "mobilephone", jobposition: "designation" },
    },
    accountTypes: {
      receivable: "accountsreceivable", bankandcash: "bank", currentassets: "othercurrentasset", noncurrentassets: "otherasset", prepayments: "othercurrentasset", fixedassets: "fixedasset",
      payable: "accountspayable", creditcard: "creditcard", currentliabilities: "othercurrentliability", noncurrentliabilities: "longtermliability", equity: "equity", currentyearearnings: "equity",
      income: "income", otherincome: "otherincome", expenses: "expense", depreciation: "expense", costofrevenue: "costofgoodssold",
    },
  },
  {
    key: "sage", name: "Sage", logo: "sage", api: "sage", tagline: "Sage Business Cloud Accounting (Connect by API), Sage 50 and Sage Pastel (files)",
    tips: ["Sage Business Cloud Accounting: the quickest way is Connect by API: you sign in on Sage's page and allow read access.", "Sage Business Cloud: open each list, then Export (CSV) above the list. Reports can be exported to CSV or Excel too.", "Sage 50 / Pastel: File → Export (or the list's Export button) to CSV; for documents, run the report and export to Excel.", "Name each file after what it holds (Customers.csv, Suppliers.csv, Products.csv, Nominal accounts.csv, Invoices.csv, Supplier invoices.csv…)."],
    files: [[/nominal|ledger.?account|chart/i, "accounts"], [/supplier.?invoice|purchase.?invoice/i, "bills"], [/sales.?invoice|customer.?invoice/i, "invoices"], [/stock|product/i, "items"], [/supplier.?payment/i, "vendor_payments"], [/customer.?receipt|receipt/i, "payments"]],
    where: {
      accounts: "Settings → Chart of Accounts → Export (Sage 50: Nominal codes → Export)", customers: "Contacts → Customers → Export", vendors: "Contacts → Suppliers → Export",
      items: "Products & Services → Export (Sage 50: Products → Export)", invoices: "Sales → Sales Invoices → Export, or the Customer Invoices report → CSV",
      credit_notes: "Sales → Sales Credit Notes → Export", payments: "Banking → Customer receipts report → Export", quotes: "Sales → Quotes & Estimates → Export",
      bills: "Purchases → Purchase Invoices → Export, or the Supplier Invoices report → CSV", vendor_payments: "Banking → Supplier payments report → Export",
      purchase_orders: "Purchases → Purchase Orders → Export", journals: "Accounting → Journals → Export", opening_balances: "Reports → Trial Balance at your start date → Export",
      bank_transactions: "Banking → (bank account) → Export transactions", employees: "Sage Payroll → Employees → Export",
    },
    columns: {
      "*": { accountref: "customernumber", reference: "referencenumber", telephone: "phone", tel: "phone", emailaddress: "email", addressline1: "billingaddress", address1: "billingaddress", town: "billingcity", city: "billingcity", country: "billingcountry", vatnumber: "taxregistrationnumber", taxnumber: "taxregistrationnumber", vatregistrationnumber: "taxregistrationnumber", contactname: "contactname", creditlimit: "creditlimit", outstanding: "balance", outstandingamount: "balance", net: "subtotal", netamount: "subtotal", vat: "taxtotal", vatamount: "taxtotal", gross: "total", grossamount: "total", totalamount: "total" },
      customers: { name: "displayname", customername: "displayname", companyname: "displayname" },
      vendors: { name: "vendorname", suppliername: "vendorname", companyname: "vendorname" },
      items: { itemcode: "sku", productcode: "sku", stockcode: "sku", description: "itemname", itemname: "itemname", salesprice: "rate", sellingprice: "rate", costprice: "purchaserate", lastcostprice: "purchaserate", quantityinstock: "stockonhand", qtyinstock: "stockonhand", instock: "stockonhand", reorderlevel: "reorderlevel", category: "categoryname", itemtype: "producttype", unitofsale: "unit" },
      accounts: { nominalcode: "accountcode", ledgeraccountcode: "accountcode", code: "accountcode", name: "accountname", nominalname: "accountname", ledgeraccountname: "accountname", category: "accounttype", accounttype: "accounttype", ledgeraccounttype: "accounttype" },
      invoices: { invoiceno: "invoicenumber", invoicenumber: "invoicenumber", number: "invoicenumber", documentnumber: "invoicenumber", date: "invoicedate", invoicedate: "invoicedate", customer: "customername", customername: "customername", duedate: "duedate", status: "invoicestatus" },
      credit_notes: { creditnoteno: "creditnotenumber", creditnotenumber: "creditnotenumber", number: "creditnotenumber", date: "creditnotedate", customer: "customername" },
      payments: { receiptno: "paymentnumber", number: "paymentnumber", customer: "customername", amount: "amount", date: "paymentdate" },
      bills: { invoiceno: "billnumber", supplierinvoicenumber: "billnumber", number: "billnumber", documentnumber: "billnumber", reference: "billnumber", date: "billdate", invoicedate: "billdate", supplier: "vendorname", suppliername: "vendorname", duedate: "duedate", status: "billstatus" },
      vendor_payments: { paymentno: "paymentnumber", number: "paymentnumber", supplier: "vendorname", suppliername: "vendorname", amount: "amount" },
      quotes: { quoteno: "estimatenumber", number: "estimatenumber", date: "estimatedate", customer: "customername" },
      purchase_orders: { orderno: "purchaseordernumber", number: "purchaseordernumber", supplier: "vendorname", suppliername: "vendorname", date: "purchaseorderdate" },
      journals: { journalno: "journalnumber", reference: "journalnumber", date: "journaldate", nominalcode: "accountcode", ledgeraccount: "accountname" },
      employees: { forename: "firstname", surname: "lastname", startdate: "dateofjoining", worksnumber: "employeeid", employeereference: "employeeid" },
    },
    accountTypes: {
      sales: "income", revenue: "income", otherincome: "otherincome", purchases: "costofgoodssold", directexpenses: "costofgoodssold", costofsales: "costofgoodssold", overheads: "expense", expenses: "expense",
      currentassets: "othercurrentasset", fixedassets: "fixedasset", bank: "bank", cashinhand: "cash", debtors: "accountsreceivable", tradedebtors: "accountsreceivable", stock: "stock",
      currentliabilities: "othercurrentliability", creditors: "accountspayable", tradecreditors: "accountspayable", vat: "othercurrentliability", longtermliabilities: "longtermliability",
      capitalandreserves: "equity", capital: "equity", equity: "equity", depreciation: "expense",
    },
  },
  {
    key: "xero", name: "Xero", logo: "xero", api: "xero", tagline: "Xero accounting, any plan",
    tips: ["The quickest way is Connect by API: you sign in on Xero's page and allow read access.", "For files: each list has Import/Export → Export (contacts, items, chart of accounts). Invoices and bills: Business → Invoices (or Bills to pay) → Export."],
    where: {
      accounts: "Accounting → Chart of accounts → Export", customers: "Contacts → Customers → Export", vendors: "Contacts → Suppliers → Export (save as Suppliers.csv)",
      items: "Business → Products and services → Export", invoices: "Business → Invoices → Export", bills: "Business → Bills to pay → Export (save as Bills.csv)",
      credit_notes: "Business → Invoices → Credit notes → Export", quotes: "Business → Quotes → Export", journals: "Accounting → Manual journals → Export",
      bank_transactions: "Accounting → Bank accounts → (account) → Account transactions → Export", opening_balances: "Accounting → Reports → Trial balance at your start date → Export",
    },
    files: [[/supplier/i, "vendors"], [/bill/i, "bills"], [/inventory|product|item/i, "items"], [/chart|accounts?/i, "accounts"]],
    columns: {
      "*": { contactname: "customername", emailaddress: "email", description: "itemdesc", unitamount: "rate", lineamount: "itemtotal", accountcode: "account", reference: "referencenumber", taxamount: "itemtaxamount" },
      customers: { contactname: "displayname", accountnumber: "customernumber", taxnumber: "taxregistrationnumber", phonenumber: "phone", mobilenumber: "mobilephone", poaddressline1: "billingaddress", pocity: "billingcity", saaddressline1: "billingaddress", sacity: "billingcity" },
      vendors: { contactname: "vendorname", taxnumber: "taxregistrationnumber", phonenumber: "phone", mobilenumber: "mobilephone", poaddressline1: "billingaddress", pocity: "billingcity" },
      items: { itemname: "itemname", itemcode: "sku", salesunitprice: "rate", purchasesunitprice: "purchaserate", quantityonhand: "stockonhand", salesdescription: "description" },
      accounts: { name: "accountname", code: "accountcode", type: "accounttype" },
      invoices: { inventoryitemcode: "itemname", total: "total" },
      bills: { contactname: "vendorname", invoicenumber: "billnumber", invoicedate: "billdate", inventoryitemcode: "itemname" },
      credit_notes: { invoicenumber: "creditnotenumber", creditnotenumber: "creditnotenumber", invoicedate: "creditnotedate" },
      quotes: { quotenumber: "estimatenumber", date: "estimatedate", expirydate: "expirydate" },
      journals: { narration: "notes", date: "journaldate" },
    },
    accountTypes: { bank: "bank", current: "othercurrentasset", currentasset: "othercurrentasset", currliab: "othercurrentliability", currentliability: "othercurrentliability", depreciatn: "expense", depreciation: "expense", directcosts: "costofgoodssold", equity: "equity", expense: "expense", fixed: "fixedasset", fixedasset: "fixedasset", inventory: "stock", liability: "othercurrentliability", noncurrent: "otherasset", noncurrentasset: "otherasset", otherincome: "otherincome", overheads: "expense", overhead: "expense", prepayment: "othercurrentasset", revenue: "income", sales: "income", termliab: "longtermliability", noncurrentliability: "longtermliability" },
  },
  {
    key: "erpnext", name: "ERPNext", logo: "erpnext", api: "erpnext", tagline: "ERPNext / Frappe, cloud or self-hosted",
    tips: ["The quickest way is Connect by API with an API key and secret.", "For files: open a list (e.g. Sales Invoice), Menu ⋯ → Export, tick the fields (and the child table Items for line items) and export as Excel or CSV. Or use Data Export."],
    where: {
      accounts: "Accounting → Chart of Accounts → Menu → Export (or Data Export → Account)", customers: "Selling → Customer → Menu → Export", vendors: "Buying → Supplier → Menu → Export",
      items: "Stock → Item → Menu → Export", quotes: "Selling → Quotation → Export", sales_orders: "Selling → Sales Order → Export", invoices: "Accounting → Sales Invoice → Export (include Items)",
      credit_notes: "Sales Invoice filtered to Is Return → Export (save as Credit notes.csv)", payments: "Accounting → Payment Entry (Receive) → Export (save as Customer payments.csv)",
      bills: "Accounting → Purchase Invoice → Export (save as Bills.csv)", vendor_payments: "Payment Entry (Pay) → Export (save as Vendor payments.csv)",
      purchase_orders: "Buying → Purchase Order → Export", journals: "Accounting → Journal Entry → Export (include Accounts)", employees: "HR → Employee → Export", leads: "CRM → Lead → Export",
    },
    files: [[/purchase.?invoice/i, "bills"], [/sales.?invoice/i, "invoices"], [/quotation/i, "quotes"], [/supplier/i, "vendors"], [/^items?\b|^item/i, "items"], [/journal/i, "journals"], [/^accounts?\b|chart/i, "accounts"]],
    columns: {
      "*": { id: "number", customer: "customername", customername: "customername", supplier: "vendorname", suppliername: "vendorname", grandtotal: "total", nettotal: "subtotal", totaltaxesandcharges: "taxtotal", outstandingamount: "balance", postingdate: "date", itemnameitems: "itemname", qtyitems: "quantity", rateitems: "rate", amountitems: "itemtotal", taxid: "taxregistrationnumber", mobileno: "mobilephone", emailid: "email" },
      customers: { customername: "displayname", name: "displayname", customergroup: "notes" },
      vendors: { suppliername: "vendorname", name: "vendorname" },
      items: { itemname: "itemname", itemcode: "sku", standardsellingrate: "rate", standardrate: "rate", valuationrate: "purchaserate", openingstock: "stockonhand", itemgroup: "categoryname", stockuom: "unit", defaultunitofmeasure: "unit" },
      accounts: { accountname: "accountname", accountnumber: "accountcode", accounttype: "accounttype", roottype: "description" },
      invoices: { id: "invoicenumber", name: "invoicenumber", postingdate: "invoicedate", duedate: "duedate", status: "invoicestatus" },
      credit_notes: { id: "creditnotenumber", name: "creditnotenumber", postingdate: "creditnotedate" },
      quotes: { id: "estimatenumber", name: "estimatenumber", transactiondate: "estimatedate", validtill: "expirydate", partyname: "customername" },
      sales_orders: { id: "salesordernumber", name: "salesordernumber", transactiondate: "orderdate", deliverydate: "expectedshipmentdate" },
      payments: { id: "paymentnumber", name: "paymentnumber", party: "customername", partyname: "customername", paidamount: "amount", modeofpayment: "mode", referenceno: "referencenumber" },
      bills: { id: "billnumber", name: "billnumber", postingdate: "billdate", duedate: "duedate", billno: "referencenumber", status: "billstatus" },
      vendor_payments: { id: "paymentnumber", name: "paymentnumber", party: "vendorname", partyname: "vendorname", paidamount: "amount" },
      purchase_orders: { id: "purchaseordernumber", name: "purchaseordernumber", transactiondate: "purchaseorderdate" },
      journals: { id: "journalnumber", name: "journalnumber", postingdate: "journaldate", accountaccounts: "account", debitaccounts: "debit", creditaccounts: "credit", userremark: "notes" },
      employees: { id: "employeeid", name: "employeeid", firstname: "firstname", lastname: "lastname", cellnumber: "mobilephone", companyemail: "emailid", dateofjoining: "dateofjoining" },
    },
    accountTypes: { bank: "bank", cash: "cash", receivable: "accountsreceivable", payable: "accountspayable", stock: "stock", fixedasset: "fixedasset", costofgoodssold: "costofgoodssold", depreciation: "expense", equity: "equity", tax: "othercurrentliability", incomeaccount: "income", expenseaccount: "expense", chargeable: "expense" },
  },
  {
    key: "tally", name: "Tally", logo: "tally", tagline: "TallyPrime and Tally.ERP 9",
    tips: ["In Tally open each report below and press Alt+E (Export), choose Excel (Spreadsheet) or CSV, and keep the file name as suggested or rename it after what it holds.", "Export masters first (ledgers, stock items), then registers (sales, purchases, receipts, payments, journals) for the period you are moving."],
    where: {
      accounts: "Gateway of Tally → Display More Reports → List of Accounts → Alt+E", customers: "List of Accounts filtered to Sundry Debtors (Ledgers) → Alt+E, save as Customers.xlsx",
      vendors: "List of Accounts filtered to Sundry Creditors → Alt+E, save as Suppliers.xlsx", items: "Display More Reports → Inventory Books / Stock Summary (or List of Stock Items) → Alt+E",
      invoices: "Display More Reports → Account Books → Sales Register → Alt+E (detailed, with items)", bills: "Account Books → Purchase Register → Alt+E (save as Bills.xlsx)",
      payments: "Account Books → Receipt Register → Alt+E (save as Customer payments.xlsx)", vendor_payments: "Account Books → Payment Register → Alt+E (save as Vendor payments.xlsx)",
      journals: "Account Books → Journal Register → Alt+E", opening_balances: "Trial Balance as at your start date → Alt+E",
    },
    files: [[/sales.?reg|sales/i, "invoices"], [/purchase.?reg|purchase/i, "bills"], [/receipt/i, "payments"], [/payment.?reg/i, "vendor_payments"], [/stock|item/i, "items"], [/debtor|customer/i, "customers"], [/creditor|supplier/i, "vendors"], [/list.?of.?accounts|ledger|account/i, "accounts"], [/journal/i, "journals"], [/trial.?balance/i, "opening_balances"]],
    columns: {
      "*": { particulars: "name", voucherno: "number", vchno: "number", grosstotal: "total", value: "total", debitamount: "debit", creditamount: "credit", closingbalance: "balance", under: "group", gstin: "taxregistrationnumber", pan: "taxregistrationnumber", ledgermobileno: "mobilephone", mobileno: "mobilephone", ledgeremail: "email" },
      customers: { particulars: "displayname", name: "displayname", address: "billingaddress", contactperson: "contactname" },
      vendors: { particulars: "vendorname", name: "vendorname", address: "billingaddress", contactperson: "contactname" },
      items: { particulars: "itemname", name: "itemname", rate: "rate", closingquantity: "stockonhand", quantity: "stockonhand", under: "categoryname", units: "unit", partno: "sku" },
      accounts: { particulars: "accountname", name: "accountname", under: "accounttype", group: "accounttype" },
      invoices: { particulars: "customername", voucherno: "invoicenumber", vchno: "invoicenumber", date: "invoicedate", grosstotal: "total", value: "total", stockitem: "itemname", quantity: "quantity", rate: "rate", amount: "itemtotal" },
      bills: { particulars: "vendorname", voucherno: "billnumber", vchno: "billnumber", supplierinvoiceno: "billnumber", date: "billdate", grosstotal: "total", value: "total", stockitem: "itemname" },
      payments: { particulars: "customername", voucherno: "paymentnumber", vchno: "paymentnumber", value: "amount", creditamount: "amount" },
      vendor_payments: { particulars: "vendorname", voucherno: "paymentnumber", vchno: "paymentnumber", value: "amount", debitamount: "amount" },
      journals: { voucherno: "journalnumber", vchno: "journalnumber", date: "journaldate", particulars: "account", narration: "notes" },
    },
    accountTypes: { sundrydebtors: "accountsreceivable", sundrycreditors: "accountspayable", bankaccounts: "bank", bankodac: "othercurrentliability", bankocca: "othercurrentliability", cashinhand: "cash", salesaccounts: "income", directincomes: "income", indirectincomes: "otherincome", purchaseaccounts: "costofgoodssold", directexpenses: "costofgoodssold", indirectexpenses: "expense", fixedassets: "fixedasset", currentassets: "othercurrentasset", loansadvancesasset: "othercurrentasset", depositsasset: "othercurrentasset", stockinhand: "stock", investments: "otherasset", currentliabilities: "othercurrentliability", dutiestaxes: "othercurrentliability", provisions: "othercurrentliability", capitalaccount: "equity", reservessurplus: "equity", loansliability: "longtermliability", securedloans: "longtermliability", unsecuredloans: "longtermliability", suspenseac: "othercurrentliability" },
  },
  {
    key: "loyverse", name: "Loyverse", logo: "loyverse", api: "loyverse", tagline: "Loyverse POS: items, stock, customers, suppliers and sales receipts",
    tips: ["The quickest way is Connect by API with an access token (Back office → Integrations → Access tokens).", "For files: Back office → Items → Export, Customers → Export, and Reports → Receipts → Export."],
    where: { items: "Back office → Items → Item list → Export", customers: "Back office → Customers → Export", vendors: "Back office → Inventory management → Suppliers → Export", invoices: "Back office → Reports → Receipts → Export (save as Invoices.csv)" },
    files: [[/receipt/i, "invoices"], [/supplier/i, "vendors"]],
    columns: {
      "*": { customername: "customername", receiptnumber: "invoicenumber", phone: "phone", email: "email" },
      customers: { name: "displayname", customercode: "customernumber", address: "billingaddress", city: "billingcity", note: "notes" },
      vendors: { name: "vendorname", contact: "firstname", address1: "billingaddress" },
      items: { name: "itemname", handle: "sku", sku: "sku", price: "rate", cost: "purchaserate", category: "categoryname", barcode: "barcode", instock: "stockonhand" },
      invoices: { date: "invoicedate", totalcollected: "total", netsales: "subtotal", taxes: "taxtotal", item: "itemname", quantity: "quantity", grosssales: "itemtotal" },
    },
  },
  {
    key: "other", name: "Other / Excel", logo: "excel", tagline: "Any other system, or your own spreadsheets",
    tips: ["Export each list from your old system to CSV or Excel, or prepare spreadsheets yourself.", "Use clear column headings like Customer Name, Phone, Email, Item Name, Rate, Invoice Number, Invoice Date, Total. After uploading, choose what each file holds if it is not recognised."],
    where: {},
    columns: { "*": { name: "displayname", customer: "customername", supplier: "vendorname", vendor: "vendorname", price: "rate", sellingprice: "rate", costprice: "purchaserate", stock: "stockonhand", quantity: "quantity", number: "invoicenumber", date: "invoicedate", telephone: "phone", tel: "phone" } },
  },
];

export const SOURCES: Source[] = (["zoho", "quickbooks", "sage", "xero", "odoo", "erpnext", "tally", "loyverse", "other"] as SourceKey[]).map((k) => ALL.find((s) => s.key === k)!);
export const sourceOf = (k: SourceKey) => SOURCES.find((s) => s.key === k)!;

/** What a file holds: this system's file names first, then the general rules. */
export function detectFor(src: Source, name: string, rows: Row[]): Kind | null {
  const base = name.replace(/\.[^.]+$/, "");
  const hit = src.files?.find(([re]) => re.test(base));
  return hit ? hit[1] : detect(name, adapt(src, null, rows));
}

/** Renames this system's columns to the ones the import engine reads (only where that column is missing). */
export function adapt(src: Source, kind: Kind | null, rows: Row[]): Row[] {
  const maps = [src.columns?.["*"] || {}, (kind && src.columns?.[kind]) || {}];
  if (!maps.some((m) => Object.keys(m).length) && !src.accountTypes) return rows;
  const merged: Record<string, string> = { ...maps[0], ...maps[1] };
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const [from, to] of Object.entries(merged)) {
      const k = norm(from);
      if (out[k] !== undefined && String(out[k]).trim() !== "" && (out[to] === undefined || String(out[to]).trim() === "")) out[to] = out[k];
    }
    if (kind === "accounts" && src.accountTypes && out.accounttype) {
      const t = src.accountTypes[norm(String(out.accounttype))];
      if (t) out.accounttype = t;
    }
    return out;
  });
}
