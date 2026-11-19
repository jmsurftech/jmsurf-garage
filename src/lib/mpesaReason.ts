/**
 * Turns the reason Safaricom (or the payment gateway) gives for a failed
 * M-Pesa prompt into words a cashier can act on.
 */
export interface MpesaReason { title: string; reason: string; advice: string }

export function mpesaReason(status: string | null | undefined, message: string | null | undefined): MpesaReason {
  const m = String(message || "").toLowerCase();
  if (status === "cancelled" && /did not go out|no money was taken/.test(m)) {
    return { title: "Prompt not sent", reason: "The payment prompt never reached the customer's phone, so no money was taken.", advice: "Check the phone number and try again, or take another payment method." };
  }
  if (status === "cancelled" || /cancel/.test(m)) {
    return { title: "Payment cancelled", reason: "The customer cancelled the M-Pesa prompt on their phone.", advice: "Ask them to try again and enter their PIN, or take another payment method." };
  }
  if (/no response|timeout|timed out|did not respond|unreachable|ds timeout/.test(m)) {
    return { title: "No answer from the phone", reason: "The prompt timed out: the phone was off, out of network, or the PIN wasn't entered in time.", advice: "Make sure the phone is on with signal and unlocked, then send the prompt again." };
  }
  if (/insufficient|balance/.test(m)) {
    return { title: "Not enough money", reason: "The customer's M-Pesa balance is too low for this amount.", advice: "Ask them to top up, use Fuliza, or pay part in cash." };
  }
  if (/pin|initiator information is invalid|wrong/.test(m)) {
    return { title: "Wrong PIN", reason: "The customer entered a wrong M-Pesa PIN.", advice: "Send the prompt again and ask them to enter the correct PIN." };
  }
  if (/still under processing|processing/.test(m)) {
    return { title: "Still processing", reason: "Safaricom was still processing the payment when we checked.", advice: "Check the customer's M-Pesa message. If they were charged, look it up under M-Pesa history before charging again." };
  }
  if (/minimum|less than/.test(m)) {
    return { title: "Amount too small", reason: "M-Pesa does not accept this amount.", advice: "Take cash for small amounts." };
  }
  if (/limit|exceed/.test(m)) {
    return { title: "Over the M-Pesa limit", reason: "The amount is above the customer's M-Pesa transaction limit.", advice: "Split the payment or take another method." };
  }
  if (/invalid.*(phone|msisdn|number)|not registered/.test(m)) {
    return { title: "Number not on M-Pesa", reason: "That phone number is not a valid M-Pesa number.", advice: "Check the number and try again." };
  }
  return {
    title: "Payment failed",
    reason: message ? `M-Pesa said: "${message}".` : "The payment did not go through.",
    advice: "Try again, or take another payment method.",
  };
}
