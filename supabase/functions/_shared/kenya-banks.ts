// Standard Kenyan bank paybill list used as a dependable fallback whenever the
// PayHero bank catalogue cannot be reached. Keeps the "Bank" payout dropdown
// usable at all times instead of showing "Could not load banks".
export type BankOption = { id: string; name: string; paybill: string };

export const KENYA_BANK_PAYBILLS: BankOption[] = [
  { id: "absa", name: "Absa Bank Kenya", paybill: "303030" },
  { id: "access", name: "Access Bank Kenya", paybill: "899100" },
  { id: "bank-of-africa", name: "Bank of Africa", paybill: "972900" },
  { id: "bank-of-baroda", name: "Bank of Baroda", paybill: "885500" },
  { id: "citibank", name: "Citibank Kenya", paybill: "800700" },
  { id: "consolidated", name: "Consolidated Bank", paybill: "508400" },
  { id: "coop", name: "Co-operative Bank of Kenya", paybill: "400200" },
  { id: "credit-bank", name: "Credit Bank", paybill: "972700" },
  { id: "dtb", name: "Diamond Trust Bank (DTB)", paybill: "516600" },
  { id: "ecobank", name: "Ecobank Kenya", paybill: "700201" },
  { id: "equity", name: "Equity Bank Kenya", paybill: "247247" },
  { id: "family", name: "Family Bank", paybill: "222111" },
  { id: "faulu", name: "Faulu Microfinance Bank", paybill: "328585" },
  { id: "gulf-african", name: "Gulf African Bank", paybill: "985050" },
  { id: "guaranty", name: "Guaranty Trust Bank (GTBank)", paybill: "910200" },
  { id: "hfc", name: "HFC Bank", paybill: "100400" },
  { id: "im", name: "I&M Bank", paybill: "542542" },
  { id: "kcb", name: "Kenya Commercial Bank (KCB)", paybill: "522522" },
  { id: "kingdom", name: "Kingdom Bank", paybill: "516600" },
  { id: "kwft", name: "Kenya Women Microfinance Bank (KWFT)", paybill: "923300" },
  { id: "middle-east", name: "Middle East Bank", paybill: "972100" },
  { id: "national-bank", name: "National Bank of Kenya", paybill: "547700" },
  { id: "ncba", name: "NCBA Bank", paybill: "880100" },
  { id: "paramount", name: "Paramount Bank", paybill: "972200" },
  { id: "prime", name: "Prime Bank", paybill: "982800" },
  { id: "sbm", name: "SBM Bank Kenya", paybill: "552800" },
  { id: "sidian", name: "Sidian Bank", paybill: "111999" },
  { id: "stanbic", name: "Stanbic Bank Kenya", paybill: "600100" },
  { id: "stanchart", name: "Standard Chartered Bank", paybill: "329329" },
  { id: "uba", name: "UBA Kenya", paybill: "559900" },
  { id: "victoria", name: "Victoria Commercial Bank", paybill: "972800" },
];
