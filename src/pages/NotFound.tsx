import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Compass, ArrowLeft } from "lucide-react";
import PageHead from "@/components/PageHead";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4"
      style={{ "--primary": "24 95% 53%", "--primary-foreground": "0 0% 100%" } as React.CSSProperties}>
      <PageHead
        title="Page not found"
        description="The page you're looking for does not exist. Head back to the home page to continue."
        noindex
      />
      <div aria-hidden className="lp-glow absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative max-w-md text-center">
        <span className="lp-float mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Compass className="h-8 w-8" /></span>
        <p className="mt-6 font-display text-7xl font-bold tracking-tight">404</p>
        <h1 className="mt-2 font-display text-2xl font-bold">This page doesn't exist</h1>
        <p className="mt-2 text-muted-foreground">The link may be old or mistyped.</p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Link to="/" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><ArrowLeft className="h-4 w-4" /> Go home</Link>
          <Link to="/login" className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-6 text-sm font-semibold hover:bg-muted">Sign in</Link>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
