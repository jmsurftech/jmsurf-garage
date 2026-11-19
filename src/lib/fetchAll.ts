/**
 * Every row of a query, not just the first 1,000 (the database API's page size).
 * Pass a function that builds the query; it is re-run with .range() until a page
 * comes back short. Used by the admin lists so no record is ever silently left out.
 *
 *   const rows = await fetchAll((q) => sb.from("tenants").select("id, business_name").order("created_at"));
 */
const PAGE = 1000;

export async function fetchAll<T = any>(build: () => any, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Downloads rows as a CSV file (Excel opens it). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** fetchAll shaped like a single query's result ({ data, error }), to drop into a Promise.all of queries. */
export function allRows<T = any>(build: () => any): Promise<{ data: T[] | null; error: any }> {
  return fetchAll<T>(build).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
}
