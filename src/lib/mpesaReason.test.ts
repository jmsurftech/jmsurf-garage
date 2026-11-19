import { describe, expect, it } from "vitest";
import { mpesaReason } from "./mpesaReason";

describe("M-Pesa failure reasons", () => {
  it("explains Safaricom's common answers", () => {
    expect(mpesaReason("failed", "No response from user.").title).toBe("No answer from the phone");
    expect(mpesaReason("cancelled", "Request Cancelled by user.").title).toBe("Payment cancelled");
    expect(mpesaReason("failed", "The balance is insufficient for the transaction.").title).toBe("Not enough money");
    expect(mpesaReason("failed", "The transaction is still under processing").title).toBe("Still processing");
    expect(mpesaReason("cancelled", "The payment prompt did not go out, so no money was taken").title).toBe("Prompt not sent");
  });
  it("shows the gateway's own words when unknown", () => {
    const r = mpesaReason("failed", "Something odd");
    expect(r.title).toBe("Payment failed");
    expect(r.reason).toContain("Something odd");
  });
});
