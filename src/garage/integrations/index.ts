import { Headset, MessageCircle } from "lucide-react";
import type { GarageRoute } from "../routes";
import type { NavEntry } from "@/lib/navConfig";
import { lazyPage } from "@/lib/lazyPage";

const WhatsAppInbox = lazyPage(() => import("./WhatsAppInbox"));
const CallCentrePage = lazyPage(() => import("./CallCentre"));

/**
 * Integration screens owned by the integrations work:
 *   garage/whatsapp    two-way WhatsApp inbox (module `whatsapp`)
 *   garage/callcentre  JMSURF CALL CENTRE link + missed calls to call back (module `callcentre`)
 * System → Connections (Settings ?tab=connections) and Super admin → Settings → Integrations
 * mount ConnectionsPanel / PlatformIntegrations from this folder.
 */
export const INTEGRATION_ROUTES: GarageRoute[] = [
  { path: "garage/whatsapp", page: WhatsAppInbox },
  { path: "garage/callcentre", page: CallCentrePage },
];

export const INTEGRATION_NAV: NavEntry[] = [
  { path: "/garage/whatsapp", label: "WhatsApp", icon: MessageCircle, module: "whatsapp" },
  { path: "/garage/callcentre", label: "Call centre", icon: Headset, module: "callcentre" },
];

export { garageI, openCallCentre, requestInvoiceMpesa, invoiceMpesaStatus, sendWhatsApp } from "./api";
export type { ConnectionStatus } from "./api";
