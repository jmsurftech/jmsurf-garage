import { createElement, Suspense, type ComponentType } from "react";
import {
  BarChart3, Battery, Building2, CalendarDays, Calculator, Car, CircleDot, ClipboardCheck, Droplets, FileSpreadsheet, Fuel, Globe2, KeyRound,
  LayoutDashboard, MapPin, MessageSquare, MonitorPlay, Package, Paintbrush, Settings2, ShieldCheck, Ship, Siren, Smartphone, Truck, UserRound, Warehouse,
} from "lucide-react";
import type { GarageRoute } from "../routes";
import type { NavEntry } from "@/lib/navConfig";
import type { AppDef } from "@/apps/types";
import { lazyPage } from "@/lib/lazyPage";
import { SPECIALIST_APP_DEFS } from "./apps";

/** Specialist modules: insurance, fleet, imports, vehicle yard, body & paint, car wash, tyres, towing, car hire. */

const page = <T extends ComponentType<any>>(load: () => Promise<{ default: T }>) => lazyPage(load) as ComponentType;
/** No-login pages sit outside the staff layout, so they bring their own loading fallback. */
const pub = (load: () => Promise<{ default: ComponentType<any> }>): ComponentType => {
  const P = lazyPage(load);
  const Wrapped = () => createElement(Suspense, { fallback: createElement("div", { className: "py-20 text-center text-sm text-muted-foreground" }, "Loading…") }, createElement(P));
  (Wrapped as any).preload = (P as any).preload;
  return Wrapped;
};

const ins = () => import("./insurance/InsurancePages");
const fleet = () => import("./fleet/FleetPages");
const imp = () => import("./imports/ImportsPages");
const yard = () => import("./yard/YardPages");
const body = () => import("./bodypaint/BodyPages");
const wash = () => import("./wash/WashPages");
const tow = () => import("./towing/TowPages");
const hire = () => import("./hire/HirePages");

export const SPECIALIST_ROUTES: GarageRoute[] = [
  { path: "garage/insurance", page: page(() => ins().then((m) => ({ default: m.InsuranceHome }))) },
  { path: "garage/insurance/claims/:id", page: page(() => import("./insurance/ClaimFile")) },
  { path: "garage/insurance/statements", page: page(() => ins().then((m) => ({ default: m.InsuranceStatements }))) },

  { path: "garage/fleet", page: page(() => fleet().then((m) => ({ default: m.FleetHome }))) },
  { path: "garage/fleet/:id", page: page(() => fleet().then((m) => ({ default: m.FleetAccount }))) },

  { path: "garage/imports", page: page(() => imp().then((m) => ({ default: m.ImportsHome }))) },
  { path: "garage/imports/orders/:id", page: page(() => import("./imports/ImportOrder")) },
  { path: "garage/imports/shipments/:id", page: page(() => import("./imports/Shipment")) },
  { path: "garage/imports/duty", page: page(() => imp().then((m) => ({ default: m.DutyCalculator }))) },
  { path: "garage/imports/settings", page: page(() => imp().then((m) => ({ default: m.ImportSettingsPage }))) },
  { path: "garage/imports/reports", page: page(() => imp().then((m) => ({ default: m.ImportReports }))) },

  { path: "garage/yard", page: page(() => yard().then((m) => ({ default: m.YardHome }))) },
  { path: "garage/yard/cars/:id", page: page(() => yard().then((m) => ({ default: m.YardCar }))) },

  { path: "garage/body-paint", page: page(() => body().then((m) => ({ default: m.BodyHome }))) },
  { path: "garage/body-paint/jobs/:id", page: page(() => body().then((m) => ({ default: m.BodyJob }))) },
  { path: "garage/body-paint/booth", page: page(() => body().then((m) => ({ default: m.BoothBoard }))) },
  { path: "garage/body-paint/settings", page: page(() => body().then((m) => ({ default: m.BodySettingsPage }))) },

  { path: "garage/wash", page: page(() => wash().then((m) => ({ default: m.WashHome }))) },
  { path: "garage/wash/board", page: page(() => wash().then((m) => ({ default: m.WashBoard }))), bare: true },

  { path: "garage/tyres", page: page(() => import("./tyres/TyrePages").then((m) => ({ default: m.TyresHome }))) },

  { path: "garage/towing", page: page(() => tow().then((m) => ({ default: m.TowingHome }))) },
  { path: "garage/towing/dispatch", page: page(() => tow().then((m) => ({ default: m.TowDispatch }))) },
  { path: "garage/towing/driver", page: page(() => tow().then((m) => ({ default: m.TowDriver }))), bare: true },
  { path: "garage/towing/rates", page: page(() => tow().then((m) => ({ default: m.TowRatesPage }))) },

  { path: "garage/hire", page: page(() => hire().then((m) => ({ default: m.HireHome }))) },
  { path: "garage/hire/calendar", page: page(() => hire().then((m) => ({ default: m.HireCalendar }))) },
  { path: "garage/hire/bookings/:id", page: page(() => hire().then((m) => ({ default: m.HireBooking }))) },
];

const fleetPub = () => import("./public/FleetPublic");
const yardPub = () => import("./public/YardPublic");

export const SPECIALIST_PUBLIC_ROUTES: GarageRoute[] = [
  { path: "/fleet/:token", page: pub(() => fleetPub().then((m) => ({ default: m.FleetPortal }))) },
  { path: "/check/:token", page: pub(() => fleetPub().then((m) => ({ default: m.DriverCheck }))) },
  { path: "/yard/:slug", page: pub(() => yardPub().then((m) => ({ default: m.YardListings }))) },
  { path: "/yard/:slug/:id", page: pub(() => yardPub().then((m) => ({ default: m.YardListing }))) },
  { path: "/preorder/:token", page: pub(() => yardPub().then((m) => ({ default: m.PreorderStatus }))) },
];

const leaf = (path: string, label: string, icon: NavEntry["icon"], module: string, match?: string[]) => ({ path, label, icon, module, match });

export const SPECIALIST_NAV: NavEntry[] = [
  {
    path: "/garage/insurance", label: "Insurance claims", icon: ShieldCheck, module: "insurance", lockable: true,
    children: [
      leaf("/garage/insurance", "Overview", LayoutDashboard, "insurance", ["/garage/insurance/claims/"]),
      leaf("/apps/insurance/claim", "Claims board", ShieldCheck, "insurance"),
      leaf("/apps/insurance/insurer", "Insurers", Building2, "insurance", ["/apps/insurance/assessor"]),
      leaf("/apps/insurance/courtesy", "Courtesy cars", Car, "insurance"),
      leaf("/garage/insurance/statements", "Aging & statements", BarChart3, "insurance"),
    ],
  },
  {
    path: "/garage/fleet", label: "Fleet contracts", icon: Truck, module: "fleet_contracts", lockable: true,
    children: [
      leaf("/garage/fleet", "Fleet accounts", Truck, "fleet_contracts", ["/garage/fleet/"]),
      leaf("/apps/fleet_contracts/approval", "Approvals", ClipboardCheck, "fleet_contracts"),
      leaf("/apps/fleet_contracts/lpo", "LPOs & LSOs", FileSpreadsheet, "fleet_contracts"),
      leaf("/apps/fleet_contracts/fuel", "Fuel log", Fuel, "fleet_contracts"),
      leaf("/apps/fleet_contracts/daily_check", "Driver checks", ClipboardCheck, "fleet_contracts"),
    ],
  },
  {
    path: "/garage/imports", label: "Imports", icon: Globe2, module: "imports", lockable: true,
    children: [
      leaf("/garage/imports", "Overview", LayoutDashboard, "imports", ["/garage/imports/orders/", "/garage/imports/shipments/"]),
      leaf("/apps/imports/import_order", "Import orders", Package, "imports"),
      leaf("/apps/imports/shipment", "Shipments", Ship, "imports"),
      leaf("/apps/imports/preorder", "Pre-orders", UserRound, "imports"),
      leaf("/apps/imports/registration", "NTSA & logbooks", FileSpreadsheet, "imports", ["/apps/imports/clearing_agent"]),
      leaf("/garage/imports/duty", "Duty calculator", Calculator, "imports"),
      leaf("/garage/imports/reports", "Profit & exchange", BarChart3, "imports"),
      leaf("/garage/imports/settings", "Rates & settings", Settings2, "imports"),
    ],
  },
  {
    path: "/garage/yard", label: "Vehicle yard", icon: Warehouse, module: "vehicle_yard", lockable: true,
    children: [
      leaf("/garage/yard", "Stock", Warehouse, "vehicle_yard", ["/garage/yard/cars/"]),
      leaf("/apps/vehicle_yard/car", "Stock board", Car, "vehicle_yard"),
      leaf("/apps/vehicle_yard/enquiry", "Enquiries", MessageSquare, "vehicle_yard"),
      leaf("/apps/vehicle_yard/valuation", "Trade-ins", Car, "vehicle_yard"),
    ],
  },
  {
    path: "/garage/body-paint", label: "Body & paint", icon: Paintbrush, module: "body_paint", lockable: true,
    children: [
      leaf("/garage/body-paint", "Overview", LayoutDashboard, "body_paint", ["/garage/body-paint/jobs/"]),
      leaf("/apps/body_paint/bp_job", "Jobs board", Paintbrush, "body_paint"),
      leaf("/garage/body-paint/booth", "Booth schedule", CalendarDays, "body_paint"),
      leaf("/garage/body-paint/settings", "Rates & booths", Settings2, "body_paint"),
    ],
  },
  {
    path: "/garage/wash", label: "Car wash", icon: Droplets, module: "car_wash", lockable: true,
    children: [
      leaf("/garage/wash", "Overview", LayoutDashboard, "car_wash"),
      leaf("/garage/wash/board", "Queue board", MonitorPlay, "car_wash"),
      leaf("/apps/car_wash/package", "Packages", Package, "car_wash"),
      leaf("/apps/car_wash/subscription", "Subscriptions", CalendarDays, "car_wash"),
    ],
  },
  {
    path: "/garage/tyres", label: "Tyres & batteries", icon: CircleDot, module: "tyres", lockable: true,
    children: [
      leaf("/garage/tyres", "Overview", LayoutDashboard, "tyres"),
      leaf("/apps/tyres/tyre_job", "Tyre & alignment jobs", CircleDot, "tyres"),
      leaf("/apps/tyres/tyre_hotel", "Tyre hotel", Warehouse, "tyres"),
      leaf("/apps/tyres/battery", "Batteries", Battery, "tyres"),
    ],
  },
  {
    path: "/garage/towing", label: "Towing", icon: Siren, module: "towing", lockable: true,
    children: [
      leaf("/garage/towing", "Overview", LayoutDashboard, "towing"),
      leaf("/garage/towing/dispatch", "Dispatch board", MapPin, "towing"),
      leaf("/garage/towing/driver", "Driver screen", Smartphone, "towing"),
      leaf("/apps/towing/tow", "Call-outs", Siren, "towing"),
      leaf("/apps/towing/truck", "Trucks & vans", Truck, "towing"),
      leaf("/garage/towing/rates", "Prices", Settings2, "towing"),
    ],
  },
  {
    path: "/garage/hire", label: "Car hire", icon: KeyRound, module: "car_hire", lockable: true,
    children: [
      leaf("/garage/hire", "Overview", LayoutDashboard, "car_hire", ["/garage/hire/bookings/"]),
      leaf("/garage/hire/calendar", "Availability", CalendarDays, "car_hire"),
      leaf("/apps/car_hire/booking", "Bookings", KeyRound, "car_hire"),
      leaf("/apps/car_hire/hire_car", "Hire fleet", Car, "car_hire"),
    ],
  },
];

export const SPECIALIST_APPS: AppDef[] = SPECIALIST_APP_DEFS;
