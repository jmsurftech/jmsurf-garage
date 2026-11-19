import { useParams } from "react-router-dom";
import Portal from "@/shop/portal/Portal";

/** Staff "View as customer": the customer's portal, read-only (nothing saved, sent or marked read). */
export default function PortalPreview() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <Portal preview={{ customerId: id }} />;
}
