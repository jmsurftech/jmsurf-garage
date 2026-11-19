import PageHead from "@/components/PageHead";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Smartphone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { subscriptionPayment } from "@/lib/serverPayments";

export default function SubscriptionExpired() {
  const { signOut, subscription, profile } = useAuth();
  const { toast } = useToast();
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<"mpesa" | null>(null);

  const price = subscription?.price || 500;
  const planName = subscription?.plan_name || "Starter";

  // Renewals go through the app server, which records the payment, sends the
  // M-Pesa prompt and confirms it with Safaricom before reactivating the shop.
  const handleMpesa = async () => {
    if (!mpesaPhone || !subscription?.plan_id || !profile?.tenant_id) return;
    setLoading(true);
    try {
      const { data, error } = await subscriptionPayment({
        action: "start",
        plan_id: subscription.plan_id,
        cycle: subscription.billing_cycle || "monthly",
        phone: mpesaPhone,
        tenant_id: profile.tenant_id,
      });
      if (error || !data?.checkout_request_id) {
        toast({ title: "Failed", description: error || "Could not send the M-Pesa prompt. Try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Check your phone", description: `Enter your M-Pesa PIN to pay KES ${Number(data.amount).toLocaleString()}.` });

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: s, error: statusError } = await subscriptionPayment({
          action: "status",
          checkout_request_id: data.checkout_request_id,
          tenant_id: profile.tenant_id,
        });
        if (statusError) {
          toast({ title: "Error", description: statusError, variant: "destructive" });
          return;
        }
        if (s?.status === "completed") {
          toast({ title: "Payment received", description: "Your company is active again." });
          setTimeout(() => window.location.reload(), 1200);
          return;
        }
        if (s?.status === "failed" || s?.status === "cancelled") {
          toast({ title: "Payment not completed", description: s?.message || "The M-Pesa payment was not completed.", variant: "destructive" });
          return;
        }
      }
      toast({ title: "Still waiting", description: "We have not heard back from M-Pesa yet. Refresh this page in a minute." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background flex items-center justify-center p-4">
      <div aria-hidden className="lp-glow absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <PageHead
        title="Subscription expired · JMSURF Garage"
        description="Renew your JMSURF Garage subscription with M-Pesa or card to restore access to your dashboard."
        path="/subscription-expired"
        noindex
      />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="w-16 h-16 rounded-2xl bg-warning/15 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-warning" />
        </div>
        <h1 className="font-display text-2xl font-bold mb-2">
          {subscription?.status === "suspended" ? "Subscription Suspended" : subscription?.status === "paused" ? "Subscription Paused" : "Subscription Expired"}
        </h1>
        <p className="text-muted-foreground mb-4">
          {subscription?.status === "suspended"
            ? ((subscription as any)?.suspended_reason || "Your subscription has been suspended by the administrator. Please contact support.")
            : subscription?.status === "paused"
            ? "Your subscription has been paused by the administrator."
            : "Your free trial has ended. Pick a package to keep selling — your data is safe and waiting."}
        </p>
        <p className="mb-6 inline-flex rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
          {planName} · KES {Number(price).toLocaleString()} / {subscription?.billing_cycle || "monthly"}
        </p>

        {!method && subscription?.status !== "paused" && subscription?.status !== "suspended" && (
          <div className="space-y-3 mb-6">
            <Button onClick={() => setMethod("mpesa")} className="w-full bg-green-600 hover:bg-green-700 rounded-xl h-12 gap-2">
              <Smartphone className="w-5 h-5" /> Pay with M-Pesa
            </Button>
          </div>
        )}

        {method === "mpesa" && (
          <div className="rounded-2xl border border-border bg-muted/40 p-4 mb-6 space-y-3 text-left">
            <p className="text-sm font-medium">M-Pesa number</p>
            <input
              value={mpesaPhone}
              onChange={e => setMpesaPhone(e.target.value)}
              placeholder="07XXXXXXXX" inputMode="tel"
              className="fi h-12 text-base"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMethod(null)} className="flex-1 rounded-xl">
                Back
              </Button>
              <Button onClick={handleMpesa} disabled={loading || !mpesaPhone || !subscription || !profile?.tenant_id} className="flex-1 bg-green-600 hover:bg-green-700 rounded-xl">
                {loading ? "Sending…" : `Pay KES ${Number(price).toLocaleString()}`}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Link to="/billing">
            <Button className="w-full rounded-xl h-12">See packages</Button>
          </Link>
          <Button variant="ghost" className="w-full rounded-xl h-12" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
