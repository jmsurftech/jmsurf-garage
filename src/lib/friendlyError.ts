// Translates technical/developer errors into messages a typical store owner can understand.
export function friendlyError(err: any): string {
  const raw = (err?.message || err?.error_description || err?.error || String(err || "")).toString();
  const m = raw.toLowerCase();

  // Auth
  if (m.includes("phone number already belongs") || m.includes("profiles_phone_unique") || m.includes("customer_accounts_phone_unique"))
    return "This phone number already belongs to another account. Every account needs its own number.";
  if (m.includes("invalid login credentials") || m.includes("invalid_grant"))
    return "Wrong email or password. Please try again.";
  if (m.includes("email not confirmed") || m.includes("email_not_confirmed"))
    return "Please verify your email first. Check your inbox (and spam folder) for the verification link.";
  if (m.includes("user already registered") || m.includes("already exists") || m.includes("already been registered"))
    return "An account with this email already exists. Please sign in instead.";
  if (m.includes("password should be") || m.includes("weak_password") || m.includes("password is too short"))
    return "Your password is too short. Use at least 6 characters.";
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("over_email_send_rate_limit"))
    return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("database error saving new user") || m.includes("unexpected_failure"))
    return "We couldn't create your account right now. Please try again in a moment, or use a different email.";
  if (m.includes("invalid email"))
    return "Please enter a valid email address.";

  // Network
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed"))
    return "No internet connection. Please check your network and try again.";
  if (m.includes("timeout") || m.includes("timed out"))
    return "The request took too long. Please try again.";

  // M-Pesa / payments
  if (m.includes("mpesa") || m.includes("daraja") || m.includes("stk")) {
    if (m.includes("credentials") || m.includes("consumer_key") || m.includes("passkey") || m.includes("shortcode") || m.includes("unauthorized") || m.includes("401"))
      return "M-Pesa is not set up yet. Go to Settings → Payment Gateways and add your M-Pesa credentials.";
    if (m.includes("insufficient") || m.includes("balance"))
      return "The customer's M-Pesa balance is too low to complete this payment.";
    if (m.includes("cancelled") || m.includes("canceled") || m.includes("1032"))
      return "The customer cancelled the M-Pesa payment.";
    if (m.includes("timeout"))
      return "The customer didn't enter their M-Pesa PIN in time. Please try again.";
    return "M-Pesa payment failed. Please try again or use a different payment method.";
  }
  if (m.includes("paystack")) {
    if (m.includes("key") || m.includes("unauthorized"))
      return "Paystack is not set up yet. Go to Settings → Payment Gateways and add your Paystack keys.";
    return "Paystack payment failed. Please try again.";
  }

  // SMTP / email
  if (m.includes("smtp") || m.includes("mail")) {
    if (m.includes("auth") || m.includes("535") || m.includes("password") || m.includes("not configured"))
      return "Email is not set up correctly. Go to Settings → Email and check your SMTP details.";
    return "We couldn't send the email. Please check your email settings and try again.";
  }

  // Permission / row level security
  if (m.includes("permission denied") || m.includes("rls") || m.includes("row-level security") || m.includes("not authorized") || m.includes("403"))
    return "You don't have permission to do that. Ask your admin for access.";
  if (m.includes("foreign key") || m.includes("violates"))
    return "This item is being used elsewhere and can't be changed or removed.";
  if (m.includes("duplicate key") || m.includes("unique constraint"))
    return "This already exists. Please use a different value.";

  // Storage / uploads
  if (m.includes("payload too large") || m.includes("file too large"))
    return "That file is too large. Please use a smaller file.";

  // Subscription
  if (m.includes("subscription") && (m.includes("expired") || m.includes("inactive")))
    return "Your subscription has expired. Please renew it from the Billing page to continue.";

  // Fallback: clean up dev-y messages
  if (raw.length > 200) return "Something went wrong. Please try again, or contact support if it keeps happening.";
  return raw || "Something went wrong. Please try again.";
}
