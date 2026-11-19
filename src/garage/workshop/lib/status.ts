/**
 * Job status flow. The same rules live in the database (garage_status_allowed) so a
 * job can never skip the gate or the quality check, whatever screen moves it.
 */
export const JOB_STATUSES = [
  "booked", "checked_in", "diagnosing", "waiting_approval", "waiting_parts", "in_progress", "quality_check", "ready", "collected", "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const STATUS_LABEL: Record<JobStatus, string> = {
  booked: "Booked", checked_in: "Checked in", diagnosing: "Diagnosing", waiting_approval: "Waiting approval",
  waiting_parts: "Waiting parts", in_progress: "In progress", quality_check: "Quality check", ready: "Ready",
  collected: "Collected", cancelled: "Cancelled",
};

/** Plain words for the customer tracking page. */
export const STATUS_CUSTOMER: Record<JobStatus, string> = {
  booked: "Booked in", checked_in: "Your car is with us", diagnosing: "We are checking your car",
  waiting_approval: "Waiting for your approval", waiting_parts: "Waiting for parts", in_progress: "Work in progress",
  quality_check: "Final checks and road test", ready: "Ready for collection", collected: "Collected", cancelled: "Cancelled",
};

export const STATUS_TONE: Record<JobStatus, "muted" | "info" | "warning" | "primary" | "success" | "danger"> = {
  booked: "muted", checked_in: "info", diagnosing: "info", waiting_approval: "warning", waiting_parts: "warning",
  in_progress: "primary", quality_check: "primary", ready: "success", collected: "muted", cancelled: "danger",
};

/** Stages shown as columns on the workshop board, in order. */
export const BOARD_STAGES: JobStatus[] = ["checked_in", "diagnosing", "waiting_approval", "waiting_parts", "in_progress", "quality_check", "ready"];

/** Stages where the car is waiting rather than being worked on (time lost). */
export const WAITING_STAGES: JobStatus[] = ["waiting_approval", "waiting_parts"];

const NEXT: Record<JobStatus, JobStatus[]> = {
  booked: ["checked_in"],
  checked_in: ["diagnosing", "waiting_approval", "in_progress", "waiting_parts"],
  diagnosing: ["waiting_approval", "waiting_parts", "in_progress"],
  waiting_approval: ["waiting_parts", "in_progress", "diagnosing", "ready"],
  waiting_parts: ["in_progress", "waiting_approval"],
  in_progress: ["waiting_parts", "waiting_approval", "quality_check"],
  quality_check: ["in_progress", "ready"],
  ready: ["in_progress", "collected"],
  collected: [],
  cancelled: ["checked_in"],
};

export const isOpen = (s: string) => s !== "collected" && s !== "cancelled";

/** Statuses a job may move to next (cancelled is allowed from any open stage). */
export function nextStatuses(from: JobStatus): JobStatus[] {
  const out = [...NEXT[from]];
  if (isOpen(from)) out.push("cancelled");
  return out;
}

export function canMove(from: JobStatus, to: JobStatus): boolean {
  return from === to || nextStatuses(from).includes(to);
}

/**
 * Why a move is refused, or null when it is fine. Extra checks beyond the flow:
 * collected needs the gate pass, ready needs the quality check to have passed.
 */
export function moveProblem(
  from: JobStatus, to: JobStatus,
  job: { gate_released_at?: string | null; qc?: { passed?: boolean } | null } = {},
): string | null {
  if (!canMove(from, to)) return `A job cannot go from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}`;
  if (to === "collected" && from !== "collected" && !job.gate_released_at) return "Release the car at the gate first: it must be paid or approved on credit";
  if (to === "ready" && from === "quality_check" && !job.qc?.passed) return "Finish the quality check first";
  return null;
}

/** The main forward step for a quick "Next" button. */
export function primaryNext(from: JobStatus): JobStatus | null {
  const order: Partial<Record<JobStatus, JobStatus>> = {
    booked: "checked_in", checked_in: "diagnosing", diagnosing: "waiting_approval", waiting_approval: "in_progress",
    waiting_parts: "in_progress", in_progress: "quality_check", quality_check: "ready", ready: "collected",
  };
  return order[from] ?? null;
}

/** Minutes spent in each stage, with the current stage counted up to now. */
export function stageMinutes(job: { status: string; stage_minutes?: Record<string, number> | null; stage_entered_at?: string | null }, now = Date.now()) {
  const out: Record<string, number> = { ...(job.stage_minutes || {}) };
  if (job.stage_entered_at && isOpen(job.status)) {
    const m = Math.max(0, (now - Date.parse(job.stage_entered_at)) / 60000);
    out[job.status] = (Number(out[job.status]) || 0) + m;
  }
  return out;
}

/** "3h 20m", "2d 4h", "12m". */
export function humanMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ""}`.trim();
}

export const JOB_TYPES: [string, string][] = [
  ["mechanical", "Mechanical"], ["body_paint", "Body and paint"], ["tyres", "Tyres"], ["wash", "Wash"],
  ["towing", "Towing"], ["inspection", "Inspection"], ["prep", "Vehicle prep"], ["warranty", "Warranty / comeback"],
];

export const FUEL_LEVELS = ["Empty", "1/4", "1/2", "3/4", "Full"];

export const VEHICLE_TYPES: [string, string][] = [
  ["car", "Car"], ["pickup", "Pickup"], ["SUV", "SUV"], ["van", "Van"], ["truck", "Truck"], ["bus", "Bus"], ["matatu", "Matatu"],
  ["motorbike", "Motorbike"], ["tuk-tuk", "Tuk-tuk"], ["tractor", "Tractor"], ["generator", "Generator"], ["other", "Other"],
];
