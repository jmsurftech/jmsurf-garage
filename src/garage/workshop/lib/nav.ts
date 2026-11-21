import { useNavigate, useParams } from "react-router-dom";
import { tenantPath, customerUrl } from "@/lib/host";

/** Full address of a public garage page (estimate, tracking, booking): the company's own domain, else app.jmsurfgarage.co.ke/<slug>. */
export const publicUrl = (path: string) => customerUrl(path);

/** In-app links for workshop pages (keeps the company slug when there is one in the address). */
export function useWorkshopLinks() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const href = (path: string) => tenantPath(slug, path);
  return { href, go: (path: string, opts?: { replace?: boolean }) => navigate(href(path), opts), slug };
}
