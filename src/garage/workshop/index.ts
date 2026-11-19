import {
  Wrench, LayoutGrid, CalendarDays, Car, ClipboardCheck, FileText, BellRing, BarChart3, PackageSearch, Settings2, BookOpenCheck, ClipboardList,
} from "lucide-react";
import type { GarageRoute } from "../routes";
import type { NavEntry } from "@/lib/navConfig";
import type { AppDef } from "@/apps/types";
import { lazyPage } from "@/lib/lazyPage";
import { registerWorkshopPermissions } from "./lib/permissions";

/** Workshop core: vehicles, job cards, inspections, estimates, workshop board, mechanic view, reminders. */

// Workshop roles and permissions join Settings → Users & Roles.
registerWorkshopPermissions();

const WorkshopToday = lazyPage(() => import("./pages/WorkshopToday"));
const BoardTV = lazyPage(() => import("./pages/BoardTV"));
const Jobs = lazyPage(() => import("./pages/Jobs"));
const CheckIn = lazyPage(() => import("./pages/CheckIn"));
const JobCard = lazyPage(() => import("./pages/JobCard"));
const Bookings = lazyPage(() => import("./pages/Bookings"));
const VehicleList = lazyPage(() => import("./pages/Vehicles").then((m) => ({ default: m.VehicleList })));
const VehicleDetail = lazyPage(() => import("./pages/Vehicles").then((m) => ({ default: m.VehicleDetail })));
const InspectionList = lazyPage(() => import("./pages/Inspections").then((m) => ({ default: m.InspectionList })));
const InspectionForm = lazyPage(() => import("./pages/Inspections").then((m) => ({ default: m.InspectionForm })));
const EstimateList = lazyPage(() => import("./pages/Lists").then((m) => ({ default: m.EstimateList })));
const PartsQueue = lazyPage(() => import("./pages/Lists").then((m) => ({ default: m.PartsQueue })));
const Reminders = lazyPage(() => import("./pages/Reminders"));
const Reports = lazyPage(() => import("./pages/Reports"));
const MechanicApp = lazyPage(() => import("./pages/MechanicApp"));
const WorkshopSettings = lazyPage(() => import("./pages/Settings"));
const TechNotes = lazyPage(() => import("./pages/TechNotes"));
const EstimateApproval = lazyPage(() => import("./pages/Public").then((m) => ({ default: m.EstimateApproval })));
const JobTracking = lazyPage(() => import("./pages/Public").then((m) => ({ default: m.JobTracking })));
const OnlineBooking = lazyPage(() => import("./pages/Public").then((m) => ({ default: m.OnlineBooking })));

export const WORKSHOP_ROUTES: GarageRoute[] = [
  { path: "garage", page: WorkshopToday },
  { path: "garage/board", page: BoardTV, bare: true },
  { path: "garage/mechanic", page: MechanicApp, bare: true },
  { path: "garage/jobs", page: Jobs },
  { path: "garage/jobs/new", page: CheckIn },
  { path: "garage/jobs/:id", page: JobCard },
  { path: "garage/bookings", page: Bookings },
  { path: "garage/vehicles", page: VehicleList },
  { path: "garage/vehicles/:id", page: VehicleDetail },
  { path: "garage/inspections", page: InspectionList },
  { path: "garage/inspections/:id", page: InspectionForm },
  { path: "garage/estimates", page: EstimateList },
  { path: "garage/parts", page: PartsQueue },
  { path: "garage/reminders", page: Reminders },
  { path: "garage/reports", page: Reports },
  { path: "garage/tech-notes", page: TechNotes },
  { path: "garage/settings", page: WorkshopSettings },
];

export const WORKSHOP_PUBLIC_ROUTES: GarageRoute[] = [
  { path: "/e/:token", page: EstimateApproval },
  { path: "/t/:token", page: JobTracking },
  { path: "/book/:slug", page: OnlineBooking },
];

export const WORKSHOP_NAV: NavEntry[] = [
  {
    path: "/garage-menu", label: "Workshop", icon: Wrench,
    children: [
      { path: "/garage", label: "Today / Workshop board", icon: LayoutGrid },
      { path: "/garage/jobs", label: "Job cards", icon: ClipboardList },
      { path: "/garage/bookings", label: "Bookings", icon: CalendarDays },
      { path: "/garage/vehicles", label: "Vehicles", icon: Car },
      { path: "/garage/inspections", label: "Inspections", icon: ClipboardCheck },
      { path: "/garage/estimates", label: "Estimates", icon: FileText },
      { path: "/garage/parts", label: "Parts for jobs", icon: PackageSearch },
      { path: "/garage/reminders", label: "Service reminders", icon: BellRing },
      { path: "/garage/tech-notes", label: "Technical notes", icon: BookOpenCheck },
      { path: "/garage/reports", label: "Workshop reports", icon: BarChart3 },
      { path: "/garage/settings", label: "Workshop settings", icon: Settings2 },
    ],
  },
];

/** The workshop keeps its records in its own tables (garage_*), so it adds no record-engine apps. */
export const WORKSHOP_APPS: AppDef[] = [];
