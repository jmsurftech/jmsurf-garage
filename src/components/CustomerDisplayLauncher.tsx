import { useState } from "react";
import { Monitor, ExternalLink, Smartphone, Copy, Check } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { tenantUrl } from "@/lib/host";

interface Props {
  sessionId: string;
  onOpen?: () => void;
  /** Render only the monitor icon (used in the compact POS cart header). */
  iconOnly?: boolean;
}

export default function CustomerDisplayLauncher({ sessionId, onOpen, iconOnly }: Props) {
  const { tenant } = useTenant();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const slug = tenant?.slug || "store";
  const remoteUrl = tenantUrl(slug, `/pos/display/${sessionId}`);

  const openSameDevice = () => {
    // Use absolute URL so popups always resolve at the app origin (avoids 404 in published builds)
    const url = `${window.location.origin}/pos/display/local/${sessionId}`;
    const w = window.open(url, "pos-display", "width=1280,height=800");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups for this site to open the customer display.", variant: "destructive" });
      return;
    }
    onOpen?.();
    setOpen(false);
    toast({ title: "Customer display opened", description: "It will mirror your sales in real time." });
  };

  const copyRemoteLink = async () => {
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Manually copy the URL shown.", variant: "destructive" });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          iconOnly
            ? "flex items-center justify-center p-2 rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted transition-colors"
            : "inline-flex h-11 items-center gap-2 px-3 rounded-lg text-sm font-medium border border-input bg-card text-muted-foreground hover:bg-muted transition-colors"
        }
        title="Customer display"
        aria-label="Customer display"
      >
        <Monitor className="w-4 h-4" />
        {!iconOnly && <span className="hidden sm:inline">Customer Display</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="text-lg font-display font-bold">Open Customer Display</h2>
              <p className="text-xs text-muted-foreground mt-1">Show your customers their items and total in real time.</p>
            </div>

            <button onClick={openSameDevice} className="w-full text-left rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 p-4 transition-colors group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Monitor className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">Same Device</p>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Opens in a new window — drag to a second monitor.</p>
                </div>
              </div>
            </button>

            <div className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Another Device (Tablet/Phone)</p>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">Open this link on the customer's screen:</p>
                  <div className="flex gap-2">
                    <input readOnly value={remoteUrl} className="flex-1 px-2 py-1.5 rounded-lg bg-muted border border-input text-xs font-mono" />
                    <button onClick={copyRemoteLink} className="px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1">
                      {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button onClick={() => setOpen(false)} className="w-full px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm">Close</button>
          </div>
        </div>
      )}
    </>
  );
}
