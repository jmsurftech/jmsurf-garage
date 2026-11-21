import { Link } from "react-router-dom";
import { DashLogo } from "@/components/brand/DashLogo";
import { APP_ORIGIN } from "@/lib/host";
import { CONTACT } from "@/lib/siteFacts";

/** Header for the website's inner pages (terms, privacy, status). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="JMSURF Garage home"><DashLogo /></Link>
        <nav className="ml-auto flex items-center gap-2">
          <a href={`${APP_ORIGIN}/login`} className="rounded-full px-4 py-2 text-sm font-semibold text-[#15171c] hover:bg-black/5">Sign in</a>
          <Link to="/register" className="rounded-full bg-[#a8121b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8a0d15]">Start free</Link>
        </nav>
      </div>
    </header>
  );
}

/** Footer for the website's inner pages. */
export function SiteFooter() {
  return (
    <footer className="border-t border-black/5 bg-[#0a0b0d] py-10 text-sm text-white/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
        <DashLogo tone="light" />
        <nav className="flex flex-wrap gap-5">
          <Link to="/" className="hover:text-white">Home</Link>
          <Link to="/terms" className="hover:text-white">Terms</Link>
          <Link to="/privacy" className="hover:text-white">Privacy</Link>
          <Link to="/status" className="hover:text-white">Status</Link>
        </nav>
        <p>© {new Date().getFullYear()} JMSURF Garage · <a href="https://www.jmsurf.co.ke" className="hover:text-white">Powered by <b className="tracking-wide">JMSURF TECHNOLOGIES</b></a></p>
      </div>
      <p className="mx-auto mt-6 max-w-6xl px-4 text-center text-xs sm:px-6 sm:text-left">
        <a href={`mailto:${CONTACT.email}`} className="hover:text-white">{CONTACT.email}</a> · <a href={`tel:${CONTACT.phone.replace(/\s/g, "")}`} className="hover:text-white">{CONTACT.phone}</a> (call or WhatsApp) · {CONTACT.address}
      </p>
    </footer>
  );
}
