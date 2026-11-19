import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import {
  darajaTimestamp, darajaPassword, darajaOutcome, darajaReference, darajaUrlAllowed,
  kenyaMsisdn, internationalPhone, phoneVariants, maskPhone,
  hmacValid, payWebhookValid, whatsappSignatureValid,
  encryptSecret, decryptSecret, isEncrypted, secretsKey,
  referenceCandidates, matchInvoiceRef,
  fitOneSms, gsmLength, smsPartsOf, ipInRanges, SAFARICOM_RANGES,
  credential, credentialSource, setSavedCredentials,
} from "../../../integrations-core.js";

describe("Daraja", () => {
  it("timestamp is Nairobi time (UTC+3), 14 digits", () => {
    expect(darajaTimestamp(new Date(Date.UTC(2026, 10, 19, 22, 5, 9)))).toBe("20261120010509");
    expect(darajaTimestamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("20260101030000");
  });
  it("password is base64(shortcode + passkey + timestamp)", () => {
    const p = darajaPassword("174379", "passkey", "20261120010509");
    expect(Buffer.from(p, "base64").toString()).toBe("174379passkey20261120010509");
  });
  it("reads STK result codes", () => {
    expect(darajaOutcome("")).toBe("pending");
    expect(darajaOutcome(undefined)).toBe("pending");
    expect(darajaOutcome("0")).toBe("completed");
    expect(darajaOutcome(0)).toBe("completed");
    expect(darajaOutcome("1032")).toBe("cancelled");
    expect(darajaOutcome("1037")).toBe("failed");
    expect(darajaOutcome("4999")).toBe("pending");
  });
  it("account reference: letters and digits, 12 at most", () => {
    expect(darajaReference("", "inv-0012/a")).toBe("INV0012A");
    expect(darajaReference("A very long business name")).toBe("AVERYLONGBUS");
    expect(darajaReference("", "  ")).toBe("GARAGE");
  });
  it("callback paths may not name the forbidden words", () => {
    expect(darajaUrlAllowed("https://garage.jmsurf.co.ke/api/garage/i/c2b/abc/confirm")).toBe(true);
    expect(darajaUrlAllowed("https://garage.jmsurf.co.ke/api/mpesa/confirm")).toBe(false);
    expect(darajaUrlAllowed("http://garage.jmsurf.co.ke/api/garage/i/c2b/abc/confirm")).toBe(false);
  });
});

describe("phone numbers", () => {
  it("normalises Kenyan mobiles", () => {
    expect(kenyaMsisdn("0712 345 678")).toBe("254712345678");
    expect(kenyaMsisdn("+254 110 123456")).toBe("254110123456");
    expect(kenyaMsisdn("712345678")).toBe("254712345678");
    expect(kenyaMsisdn("00254712345678")).toBe("254712345678");
    expect(kenyaMsisdn("0201234567")).toBe("");
    expect(kenyaMsisdn("")).toBe("");
  });
  it("international numbers keep their country", () => {
    expect(internationalPhone("+255 754 123 456")).toBe("255754123456");
    expect(internationalPhone("0712345678")).toBe("254712345678");
    expect(internationalPhone("12")).toBe("");
  });
  it("variants cover the ways a number is stored", () => {
    const v = phoneVariants("0712345678");
    expect(v).toEqual(expect.arrayContaining(["254712345678", "+254712345678", "0712345678", "712345678"]));
    expect(phoneVariants("nonsense")).toEqual([]);
  });
  it("masks the middle", () => { expect(maskPhone("0712345678")).toBe("2547••••5678"); });
});

describe("webhook signatures", () => {
  const body = Buffer.from(JSON.stringify({ event: "payment.completed", data: { checkoutRequestId: "ws_CO_1" } }));
  const hex = createHmac("sha256", "s3cret").update(body).digest("hex");
  it("JMSURF PAY: X-Webhook-Signature hex, with or without sha256=", () => {
    expect(payWebhookValid(body, { "x-webhook-signature": hex }, "s3cret")).toBe(true);
    expect(payWebhookValid(body, { "x-webhook-signature": `sha256=${hex}` }, "s3cret")).toBe(true);
    expect(payWebhookValid(body, { "x-webhook-signature": hex }, "other")).toBe(false);
    expect(payWebhookValid(Buffer.from("tampered"), { "x-webhook-signature": hex }, "s3cret")).toBe(false);
    expect(payWebhookValid(body, {}, "s3cret")).toBe(false);
    expect(payWebhookValid(body, { "x-webhook-signature": hex }, "")).toBe(false);
  });
  it("accepts a base64 signature too", () => {
    const b64 = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(hmacValid(body, b64, "s3cret")).toBe(true);
  });
  it("Meta: X-Hub-Signature-256 must be sha256=<hex>", () => {
    expect(whatsappSignatureValid(body, `sha256=${hex}`, "s3cret")).toBe(true);
    expect(whatsappSignatureValid(body, hex, "s3cret")).toBe(false);
    expect(whatsappSignatureValid(body, `sha256=${hex}`, "wrong")).toBe(false);
  });
});

describe("secrets at rest", () => {
  const key = secretsKey("a".repeat(64), "");
  it("round-trips and never stores the plain value", () => {
    const enc = encryptSecret("consumer-secret-value", key);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("consumer-secret-value");
    expect(decryptSecret(enc, key)).toBe("consumer-secret-value");
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key)); // fresh IV each time
  });
  it("a wrong key gives nothing; older plain values pass through", () => {
    const enc = encryptSecret("v", key);
    expect(decryptSecret(enc, secretsKey("b".repeat(64), ""))).toBe("");
    expect(decryptSecret("plain-old-value", key)).toBe("plain-old-value");
    expect(encryptSecret("", key)).toBe("");
  });
  it("derives a key from the service key when none is set", () => {
    expect(secretsKey("", "service")?.length).toBe(32);
    expect(secretsKey("", "")).toBeNull();
  });
});

describe("paybill account → invoice", () => {
  const invoices = [
    { id: "a", invoice_number: "INV-0012", total: 5000, amount_paid: 0, status: "sent" },
    { id: "b", invoice_number: "INV-0013", total: 2000, amount_paid: 2000, status: "paid" },
    { id: "c", invoice_number: "JC-0040", total: 900, amount_paid: 100, status: "partial" },
    { id: "d", invoice_number: "INV-0099", total: 100, amount_paid: 0, status: "draft" },
  ];
  it("reads what customers type", () => {
    expect(referenceCandidates(" inv-0012 ")).toEqual(["INV0012"]);
    expect(referenceCandidates("1234567#INV 12")[0]).toBe("1234567INV12");
    expect(referenceCandidates("1234567#INV 12")).toContain("INV12");
    expect(referenceCandidates("")).toEqual([]);
  });
  it("matches open invoices only", () => {
    expect(matchInvoiceRef("inv 0012", invoices)?.id).toBe("a");
    expect(matchInvoiceRef("INV-0013", invoices)).toBeNull(); // already paid
    expect(matchInvoiceRef("INV-0099", invoices)).toBeNull(); // draft
    expect(matchInvoiceRef("jc0040", invoices)?.id).toBe("c");
    expect(matchInvoiceRef("40", invoices)?.id).toBe("c");
    expect(matchInvoiceRef("12", invoices)?.id).toBe("a");
    expect(matchInvoiceRef("bank#INV-0012", invoices)?.id).toBe("a");
    expect(matchInvoiceRef("NOPE", invoices)).toBeNull();
  });
  it("never guesses between two invoices with the same number", () => {
    const two = [...invoices, { id: "e", invoice_number: "EST-12", total: 10, amount_paid: 0, status: "sent" }];
    expect(matchInvoiceRef("12", two)).toBeNull();
  });
});

describe("automatic SMS fit one part", () => {
  it("keeps short GSM text as it is", () => {
    expect(fitOneSms("Your car is ready.")).toBe("Your car is ready.");
  });
  it("swaps curly quotes, dashes and drops emoji so the message stays GSM", () => {
    const t = fitOneSms("We’re done — your car’s ready 🚗");
    expect(gsmLength(t)).not.toBeNull();
    expect(t).toBe("We're done - your car's ready");
  });
  it("shortens long text to 160 and keeps the link whole", () => {
    const link = "https://acme.garage.jmsurf.co.ke/t/abc123def456";
    const long = `Hello Customer, your vehicle KDA 123A has been inspected and the estimate for the brake pads, discs and labour is ready for your approval. Please review: ${link}`;
    const t = fitOneSms(long);
    expect(gsmLength(t)).toBeLessThanOrEqual(160);
    expect(smsPartsOf(t)).toBe(1);
    expect(t.endsWith(link)).toBe(true);
    expect(t).toContain("...");
  });
  it("counts parts like the gateway", () => {
    expect(smsPartsOf("a".repeat(160))).toBe(1);
    expect(smsPartsOf("a".repeat(161))).toBe(2);
    expect(smsPartsOf("€".repeat(80))).toBe(1);
    expect(smsPartsOf("€".repeat(81))).toBe(2);
    expect(smsPartsOf("ü".repeat(70))).toBe(1);
    expect(smsPartsOf("ш".repeat(71))).toBe(2);
  });
});

describe("Safaricom addresses", () => {
  it("checks CIDR ranges", () => {
    expect(ipInRanges("196.201.214.200", SAFARICOM_RANGES)).toBe(true);
    expect(ipInRanges("::ffff:196.201.212.69", SAFARICOM_RANGES)).toBe(true);
    expect(ipInRanges("196.201.216.1", SAFARICOM_RANGES)).toBe(false);
    expect(ipInRanges("10.0.0.1", SAFARICOM_RANGES)).toBe(false);
    expect(ipInRanges("not an ip", SAFARICOM_RANGES)).toBe(false);
  });
});

describe("platform credentials", () => {
  afterEach(() => { setSavedCredentials({}); delete process.env.JMSURF_SMS_API_KEY; });
  it("env wins over the saved value", () => {
    setSavedCredentials({ JMSURF_SMS_API_KEY: "saved-key" });
    expect(credential("JMSURF_SMS_API_KEY")).toBe("saved-key");
    expect(credentialSource("JMSURF_SMS_API_KEY")).toBe("saved");
    process.env.JMSURF_SMS_API_KEY = "env-key";
    expect(credential("JMSURF_SMS_API_KEY")).toBe("env-key");
    expect(credentialSource("JMSURF_SMS_API_KEY")).toBe("env");
  });
  it("missing when neither is set", () => {
    expect(credential("ETIMS_PARTNER_KEY_UNKNOWN")).toBe("");
    expect(credentialSource("JMSURF_SMS_API_KEY")).toBe("missing");
  });
});
