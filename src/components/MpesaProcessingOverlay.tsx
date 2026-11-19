import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import mpesaLogo from "@/assets/mpesa-logo.png";

interface Props {
  open: boolean;
  /** "processing" shows animated dots, "success" shows green check, "failed" shows red X */
  state: "processing" | "success" | "failed";
  title?: string;
  description?: string;
  /** When set, shows a Cancel button (only relevant in 'processing'). */
  onCancel?: () => void;
  /** Auto-close handler — invoked by the user dismissing the success/failed view. */
  onDismiss?: () => void;
}

/**
 * Centered full-page overlay for in-flight M-Pesa / PayHero payments.
 *
 * Shows the M-PESA logo with a fully-rotating ring of dots while the STK push
 * is in flight, then swaps to a success or failure badge once the gateway
 * resolves the transaction.
 */
export default function MpesaProcessingOverlay({
  open,
  state,
  title,
  description,
  onCancel,
  onDismiss,
}: Props) {
  if (!open) return null;

  const headline =
    title || (state === "processing" ? "Processing" : state === "success" ? "Payment Successful" : "Payment Failed");
  const sub =
    description ||
    (state === "processing"
      ? "Approve the M-Pesa prompt on your phone."
      : state === "success"
      ? "The payment has been confirmed."
      : "The payment could not be completed.");

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-card rounded-3xl border border-border shadow-2xl max-w-sm w-full p-10 flex flex-col items-center text-center">
        {/* Center icon: M-Pesa logo with full rotating dot ring while processing */}
        <div className="relative w-36 h-36 flex items-center justify-center mb-6">
          {state === "processing" && (
            <>
              {/* Rotating dot ring — the wrapper itself spins so every dot animates uniformly */}
              <div className="absolute inset-0 mpesa-spin">
                {Array.from({ length: 12 }).map((_, i) => {
                  const angle = (i * 360) / 12;
                  return (
                    <span
                      key={i}
                      className="absolute left-1/2 top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-success"
                      style={{
                        transform: `rotate(${angle}deg) translateY(-58px)`,
                        opacity: 0.25 + (i / 12) * 0.75,
                      }}
                    />
                  );
                })}
              </div>
              <img
                src={mpesaLogo}
                alt="M-PESA"
                width={88}
                height={88}
                loading="lazy"
                className="relative z-10 w-22 h-22 object-contain drop-shadow"
                style={{ width: "5.5rem", height: "5.5rem" }}
              />
            </>
          )}
          {state === "success" && (
            <div className="w-24 h-24 rounded-full bg-success/15 flex items-center justify-center animate-in zoom-in duration-300">
              <Check className="w-14 h-14 text-success" strokeWidth={3} />
            </div>
          )}
          {state === "failed" && (
            <div className="w-24 h-24 rounded-full bg-destructive/15 flex items-center justify-center animate-in zoom-in duration-300">
              <X className="w-14 h-14 text-destructive" strokeWidth={3} />
            </div>
          )}
        </div>

        <h2
          className={cn(
            "text-2xl font-bold mb-2",
            state === "success" && "text-success",
            state === "failed" && "text-destructive"
          )}
        >
          {headline}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">{sub}</p>

        {state === "processing" && onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Cancel
          </button>
        )}
        {(state === "success" || state === "failed") && onDismiss && (
          <button
            onClick={onDismiss}
            className={cn(
              "px-6 py-2.5 rounded-xl font-medium text-sm",
              state === "success"
                ? "bg-success text-success-foreground hover:opacity-90"
                : "bg-muted text-foreground hover:bg-muted/70"
            )}
          >
            Close
          </button>
        )}
      </div>

      <style>{`
        @keyframes mpesaSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .mpesa-spin {
          animation: mpesaSpin 1.4s linear infinite;
        }
      `}</style>
    </div>
  );
}
