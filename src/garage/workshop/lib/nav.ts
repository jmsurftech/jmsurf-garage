import { useNavigate, useParams } from "react-router-dom";
import { tenantPath, isDevHost, SITE_ORIGIN } from "@/lib/host";

/** Full address of a public garage page (estimate, tracking, booking) on the main site. */
export const publicUrl = (path: string) => `${typeof window !== "undefined" && isDevHost() ? window.location.origin : SITE_ORIGIN}${path}`;

/** In-app links for workshop pages (keeps the company slug when there is one in the address). */
export function useWorkshopLinks() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const href = (path: string) => tenantPath(slug, path);
  return { href, go: (path: string, opts?: { replace?: boolean }) => navigate(href(path), opts), slug };
}
