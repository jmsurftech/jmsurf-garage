/**
 * The record engine: one table (app_records) and one set of screens serve every
 * module whose records are "a list of things with a status" (projects, tasks,
 * tickets, contracts, vehicles, applicants…). Each module describes its record
 * kinds here; the screens (list / kanban / calendar / form / timeline) are
 * generic. Studio custom apps use the same shape, stored in app_definitions.
 */

/** Native columns of app_records a field can map to (everything else lives in data). */
export type RecordColumn =
  | "title" | "stage" | "priority" | "customer_id" | "supplier_id" | "employee_id" | "product_id"
  | "assigned_to" | "parent_id" | "amount" | "quantity" | "starts_at" | "ends_at" | "due_date";

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "percent" | "date" | "datetime" | "select" | "multiselect"
  | "checkbox" | "email" | "phone" | "url" | "rating" | "color"
  | "customer" | "supplier" | "employee" | "product" | "user" | "record" | "lines" | "signature";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Native column; defaults to data[key]. */
  column?: RecordColumn;
  options?: string[];
  /** For type "record": the kind it points at (same app, or "app.kind"). */
  ref?: string;
  /** For type "lines": the columns of each line. */
  lineFields?: FieldDef[];
  required?: boolean;
  /** Show as a column in the list view. */
  list?: boolean;
  help?: string;
  placeholder?: string;
  /** Half width on the form. */
  half?: boolean;
  defaultValue?: unknown;
}

export interface StageDef {
  key: string;
  label: string;
  /** Tailwind colour name used for chips and the kanban header. */
  tone: "slate" | "blue" | "amber" | "violet" | "green" | "red" | "cyan" | "pink";
  /** A finished state (closed / done / won / lost). */
  done?: boolean;
}

export interface KindDef {
  key: string;
  label: string;
  plural: string;
  /** Number prefix, e.g. "PRJ-" → PRJ-00001. Empty = no number. */
  prefix?: string;
  /** Label for the title field. */
  titleLabel?: string;
  stages?: StageDef[];
  views?: ("list" | "kanban" | "calendar")[];
  fields: FieldDef[];
  /** Kinds shown as related lists on this kind's record (child.parent_id = this). */
  children?: string[];
  /** Hidden from the app's tabs (reached from a parent). */
  hidden?: boolean;
  /** Summary tiles on the app home: field to sum or "count". */
  stats?: { label: string; sum?: string; where?: { stage?: string[] } }[];
  description?: string;
}

export interface AppDef {
  key: string;
  kinds: KindDef[];
}
