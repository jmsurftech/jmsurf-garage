import PageHead from "@/components/PageHead";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { OrbSpinner } from "@/components/orbs";

/** Shop subdomains can't POST to /api, so always use the main address there. */
const API = "/api/email/unsubscribe";
const post = (body: Record<string, unknown>) =>
  fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "valid" | "already" | "invalid" | "submitting" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    (async () => {
      try {
        const data = await post({ token });
        if (data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch {
        setState("invalid");
      }
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const data = await post({ token, confirm: true });
      if (data.success || data.reason === "already_unsubscribed") setState("success");
      else {
        setErrorMsg(data.error || "Failed to unsubscribe");
        setState("error");
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Network error");
      setState("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <PageHead
        title="Unsubscribe from JMSURF Garage emails"
        description="Manage your email preferences and unsubscribe from JMSURF Garage marketing and notification emails."
        path="/unsubscribe"
        noindex
      />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <OrbSpinner className="h-4 w-4" /> Validating link...
            </div>
          )}
          {state === "valid" && (
            <>
              <p className="text-sm text-muted-foreground">
                Click below to unsubscribe from JMSURF Garage emails.
              </p>
              <Button onClick={handleConfirm} className="w-full">Confirm Unsubscribe</Button>
            </>
          )}
          {state === "submitting" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <OrbSpinner className="h-4 w-4" /> Processing...
            </div>
          )}
          {state === "success" && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" /> You have been unsubscribed.
            </div>
          )}
          {state === "already" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-5 w-5" /> You are already unsubscribed.
            </div>
          )}
          {state === "invalid" && (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> Invalid or expired unsubscribe link.
            </div>
          )}
          {state === "error" && (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> {errorMsg}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
