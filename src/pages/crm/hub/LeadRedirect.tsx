import { Navigate, useParams } from "react-router-dom";

/** Old lead addresses (/crm/lead/:id) open the lead's page in the rebuilt CRM. */
export default function LeadRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/crm/leads/${id}`} replace />;
}
