import { describe, expect, it } from "vitest";
import { RECEIPT_TEMPLATES, receiptDocumentHtml, receiptTemplateId, sampleReceipt } from "./receiptTemplates";

const money = (n: number) => `KES ${n.toFixed(2)}`;

describe("receipt templates", () => {
  it("offers between 5 and 10 unique templates", () => {
    const ids = RECEIPT_TEMPLATES.map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to classic for unknown values", () => {
    expect(receiptTemplateId(undefined)).toBe("classic");
    expect(receiptTemplateId("nope")).toBe("classic");
    expect(receiptTemplateId("boxed")).toBe("boxed");
  });

  it("prints terms only when set, with no platform branding", () => {
    for (const t of RECEIPT_TEMPLATES) {
      const without = receiptDocumentHtml(sampleReceipt({ money }), t.id);
      expect(without).not.toContain("TERMS &amp; CONDITIONS");
      const withTerms = receiptDocumentHtml(sampleReceipt({ money, terms: "No refunds <after> 7 days" }), t.id);
      expect(withTerms).toContain("No refunds &lt;after&gt; 7 days");
      const body = withTerms.slice(withTerms.indexOf("<body"));
      expect(body).not.toContain("JMSURF");
    }
  });
});
