import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportError } from "@/lib/errorReporter";

type State = { error: Error | null };

/**
 * Keeps a crash inside one page: the sidebar and the rest of the app stay
 * usable, the error is reported to the platform, and the page can be retried.
 * Opening another page clears it (the boundary is keyed on the address).
 */
class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    try { reportError(error, { componentStack: info?.componentStack || undefined }); } catch { /* reporting must never throw */ }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto my-10 max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm" role="alert">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <AlertTriangle className="h-7 w-7" />
        </span>
        <h2 className="mt-4 font-display text-xl font-bold">This page couldn't load</h2>
        <p className="mt-1 text-sm text-muted-foreground">The problem has been reported to support. Your data is safe. Try again, or open another page from the menu.</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }
}

export default function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
