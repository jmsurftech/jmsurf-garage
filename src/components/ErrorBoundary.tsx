import { reportError } from "@/lib/errorReporter";
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global ErrorBoundary.
 *
 * Behaviour:
 * - Catches render errors and shows a friendly fallback.
 * - Auto-resets when the URL changes (popstate / pushState / replaceState),
 *   so users never get stuck on a stale error screen after navigating.
 * - "Try again" button resets state without a full reload (cheap recovery).
 * - "Refresh" forces a hard reload as a last resort.
 *
 * Chunk-load failures (common with code-splitting after a deploy) are
 * detected and trigger an automatic one-time reload so users always land
 * on the latest bundle instead of seeing a permanent crash.
 */
export default class ErrorBoundary extends Component<Props, State> {
  private removeNavListener: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidMount() {
    const reset = () => {
      if (this.state.hasError) this.setState({ hasError: false, error: null });
    };

    // Reset on browser back/forward
    window.addEventListener("popstate", reset);

    // Patch pushState / replaceState so SPA route changes also reset us.
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    window.history.pushState = function (...args) {
      const result = originalPush.apply(this, args as any);
      window.dispatchEvent(new Event("lovable:navigation"));
      return result;
    };
    window.history.replaceState = function (...args) {
      const result = originalReplace.apply(this, args as any);
      window.dispatchEvent(new Event("lovable:navigation"));
      return result;
    };
    window.addEventListener("lovable:navigation", reset);

    this.removeNavListener = () => {
      window.removeEventListener("popstate", reset);
      window.removeEventListener("lovable:navigation", reset);
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
    };
  }

  componentWillUnmount() {
    this.removeNavListener?.();
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    reportError(error, { componentStack: info.componentStack || undefined });

    // Auto-recover from chunk-load failures (e.g. after a deploy)
    const msg = `${error?.name || ""} ${error?.message || ""}`.toLowerCase();
    const isChunkError =
      msg.includes("chunkloaderror") ||
      msg.includes("loading chunk") ||
      msg.includes("dynamically imported module") ||
      msg.includes("failed to fetch dynamically");
    if (isChunkError && !sessionStorage.getItem("__chunk_reload__")) {
      sessionStorage.setItem("__chunk_reload__", "1");
      window.location.reload();
    } else {
      // clear the marker after a successful render later
      setTimeout(() => sessionStorage.removeItem("__chunk_reload__"), 5000);
    }
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center max-w-md space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              We hit an unexpected hiccup. You can try again, or head back home.
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground/70 font-mono break-words">
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-3 justify-center flex-wrap">
              <Button onClick={this.reset} className="rounded-xl">
                Try again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()} className="rounded-xl">
                Refresh
              </Button>
              <Button variant="ghost" onClick={() => { this.reset(); window.location.href = "/"; }} className="rounded-xl">
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
