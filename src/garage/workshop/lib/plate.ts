/**
 * Kenyan number plates. Stored upper case with letters and digits only (the database
 * does the same in garage_plate()), shown with the usual spacing.
 *
 *   Private cars     KAA 123A … KDx 123x   (3 letters, 3 digits, 1 letter)
 *   Older cars       KAA 123               (3 letters, 3 digits)
 *   Motorbikes       KMxx 123x             (KM + 2 letters, 3 digits, 1 letter)
 *   Government       GK 123A / GKA 123A
 *   Diplomatic       123 CD 45 / CD 123 A …
 *   Trailers         ZA 1234 / ZB 1234 …   (Z + letter, 4 digits)
 *   Tuk-tuks / PSV   use the normal series
 */

export type PlateKind = "private" | "motorbike" | "government" | "diplomatic" | "trailer" | "old" | "other";

/** Letters and digits only, upper case. */
export function normalisePlate(raw: string | null | undefined): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const RULES: [PlateKind, RegExp][] = [
  ["motorbike", /^KM[A-Z]{2}\d{3}[A-Z]$/],
  ["private", /^K[A-D][A-Z]\d{3}[A-Z]$/],
  ["old", /^K[A-Z]{2}\d{3}$/],
  ["government", /^GK[A-Z]?\d{3,4}[A-Z]?$/],
  ["diplomatic", /^(\d{1,3}CD\d{1,3}[A-Z]?|CD\d{1,4}[A-Z]?|\d{1,3}(UN|KX|TAC)\d{1,3}[A-Z]?)$/],
  ["trailer", /^Z[A-Z]\d{3,4}[A-Z]?$/],
];

/** What kind of plate this is, or "other" when it does not match a known Kenyan format. */
export function plateKind(raw: string | null | undefined): PlateKind {
  const p = normalisePlate(raw);
  for (const [kind, re] of RULES) if (re.test(p)) return kind;
  return "other";
}

/** True for a plate that matches a known Kenyan format. Foreign or custom plates are still allowed to be saved. */
export function isKenyanPlate(raw: string | null | undefined): boolean {
  return plateKind(raw) !== "other";
}

/** "KCA123A" → "KCA 123A", "KMEA123B" → "KMEA 123B", "GK123A" → "GK 123A", "ZB1234" → "ZB 1234". */
export function formatPlate(raw: string | null | undefined): string {
  const p = normalisePlate(raw);
  if (!p) return "";
  const m = p.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
  if (m) return `${m[1]} ${m[2]}${m[3]}`;
  const cd = p.match(/^(\d{1,3})(CD|UN|KX|TAC)(\d{1,3}[A-Z]?)$/);
  if (cd) return `${cd[1]} ${cd[2]} ${cd[3]}`;
  return p;
}

/** Vehicle type to suggest from the plate (motorbike plates are clear). */
export function suggestTypeFromPlate(raw: string | null | undefined): string | null {
  const k = plateKind(raw);
  if (k === "motorbike") return "motorbike";
  if (k === "trailer") return "truck";
  return null;
}
