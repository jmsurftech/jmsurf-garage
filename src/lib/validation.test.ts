import { describe, it, expect } from "vitest";
import { contactFormSchema, nameSchema } from "./validation";

const baseForm = {
  name: "Jane Doe",
  email: "jane@example.com",
  subject: "Hello there",
  message: "This is a message with enough length.",
};

describe("nameSchema", () => {
  it.each([
    ["Wanjirũ"],
    ["José"],
    ["Zoë Müller"],
    ["Renée O'Neil"],
    ["李小龍"],
    ["أحمد"],
    ["María-José"],
    ["Jane Doe"],
  ])("accepts %s", (name) => {
    expect(nameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ["J"], // too short
    ["Jane123"], // digits
    ["Jane@Doe"], // symbol
    [""],
  ])("rejects %s", (name) => {
    expect(nameSchema.safeParse(name).success).toBe(false);
  });

  it("normalizes to NFC (composed form)", () => {
    // "José" using decomposed form (e + combining acute accent)
    const decomposed = "Jose\u0301";
    const composed = "José".normalize("NFC");
    const parsed = nameSchema.parse(decomposed);
    expect(parsed).toBe(composed);
    expect(parsed.normalize("NFC")).toBe(parsed);
  });

  it("error message mentions Unicode letters", () => {
    const res = nameSchema.safeParse("Jane123");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message.toLowerCase()).toContain("unicode");
    }
  });
});

describe("contactFormSchema", () => {
  it("accepts a form with a diacritic name", () => {
    const res = contactFormSchema.safeParse({ ...baseForm, name: "Wanjirũ" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.name).toBe("Wanjirũ".normalize("NFC"));
  });

  it("returns per-field errors keyed by field name", () => {
    const res = contactFormSchema.safeParse({ ...baseForm, name: "J", email: "not-an-email" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["name", "email"]));
    }
  });
});
