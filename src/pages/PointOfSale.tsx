import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Orb } from "@/components/Orb";
import OnlinePayModal from "@/components/OnlinePayModal";
import { useShopGateways } from "@/lib/gateways";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";
import { Globe2, Undo2, Droplet } from "lucide-react";
import { tenantPath } from "@/lib/host";
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, X, User, MapPin, Wrench, Wallet, Gift, ScanBarcode, Users, ImageIcon, Pause, Play, RotateCcw, FileText, DollarSign, Split, ClipboardList, Percent, Phone, Maximize2, Minimize2, LayoutGrid, PanelRight, Save, ShoppingCart, ZoomIn, ChevronDown, Check } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useLocation , Link } from "react-router-dom";
import { useCustomers, useLocations, useProductStocks, useUserLocations, useBusinessSettings, useStaff, useAllUserLocations } from "@/hooks/useData";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatKESWhole, validateKenyanPhone, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import ReceiptModal from "@/components/ReceiptModal";
import CashRegisterDrawer from "@/components/CashRegisterDrawer";
import SplitPaymentModal from "@/components/SplitPaymentModal";
import PaymentConfirmModal from "@/components/PaymentConfirmModal";
import MpesaProcessingOverlay from "@/components/MpesaProcessingOverlay";
// PaymentTimeline removed from POS — kept import out to avoid dead code.
import { addToSyncQueue, saveOfflineTransaction, deductLocalStock } from "@/lib/offlineDb";
import { isNetworkError } from "@/lib/network";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { useDisplayPublisher } from "@/hooks/useCustomerDisplay";
import CustomerDisplayLauncher from "@/components/CustomerDisplayLauncher";
import CategoryStrip from "@/components/CategoryStrip";
import Pagination, { usePaginated } from "@/components/Pagination";
import { useTenant } from "@/hooks/useTenant";
import { logActivity } from "@/lib/auditLog";
import type { Database } from "@/integrations/supabase/types";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useWaterTanks } from "@/hooks/useWaterTanks";
import { litresByTank, sizeCost } from "@/lib/waterMath";
import { mpesaReason } from "@/lib/mpesaReason";
import { formatLitres } from "@/lib/businessType";
import { useVariantsByProduct, type ProductVariant } from "@/hooks/useVariants";
import { useCreateOpenBill, useUpdateBillItems, useOpenBills, safeNum } from "@/hooks/useOpenBills";
import { sendReceiptEmail } from "@/lib/platformEmail";
import {
  posMpesaPrompt, posMpesaStatus, jmsurfMpesaPrompt, jmsurfMpesaStatus,
  darajaMpesaPrompt, darajaMpesaStatus, paystackInitialize, paystackVerify,
} from "@/lib/serverPayments";


type DbProduct = Database["public"]["Tables"]["products"]["Row"];
type DbCustomer = Database["public"]["Tables"]["customers"]["Row"];

interface CartItem extends DbProduct {
  quantity: number;
  discount: number;
  is_service?: boolean;
  price_mode?: "retail" | "wholesale";
  retail_price?: number;
}

interface HeldSale {
  id: string;
  cart: CartItem[];
  customer: DbCustomer | null;
  loyaltyRedeemPoints: number;
  heldAt: string;
  label: string;
}

type PosCardSize = "auto" | "compact" | "standard" | "comfortable";
type PosCartWidth = "auto" | "compact" | "standard" | "wide";
type PosCartHeight = "compact" | "balanced" | "expanded";

interface PosLayoutPrefs {
  cardSize: PosCardSize;
  cartWidth: PosCartWidth;
  cartHeight: PosCartHeight;
}

const POS_LAYOUT_PREFS_KEY = "jmsurf_pos_layout_preferences_v2";
const LEGACY_POS_LAYOUT_PREFS_KEY = "jmsurf_pos_layout_preferences_v1";
const DEFAULT_POS_LAYOUT_PREFS: PosLayoutPrefs = { cardSize: "auto", cartWidth: "auto", cartHeight: "balanced" };

function readPosLayoutPrefs(): PosLayoutPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_LAYOUT_PREFS_KEY) || localStorage.getItem(LEGACY_POS_LAYOUT_PREFS_KEY) || "null");
    return {
      cardSize: ["auto", "compact", "standard", "comfortable"].includes(saved?.cardSize) ? saved.cardSize : DEFAULT_POS_LAYOUT_PREFS.cardSize,
      cartWidth: ["auto", "compact", "standard", "wide"].includes(saved?.cartWidth) ? saved.cartWidth : DEFAULT_POS_LAYOUT_PREFS.cartWidth,
      cartHeight: ["compact", "balanced", "expanded"].includes(saved?.cartHeight) ? saved.cartHeight : DEFAULT_POS_LAYOUT_PREFS.cartHeight,
    };
  } catch {
    return DEFAULT_POS_LAYOUT_PREFS;
  }
}

const RESERVED_TENANT_PATHS = new Set(["admin", "login", "register", "reset-password", "subscription-expired", "billing", "dashboard", "pos", "inventory", "customers", "sales", "purchases", "payments", "communication", "email-logs", "reports", "staff", "settings", "message-logs", "delivery-notes", "packing-lists", "delivery-confirm", "stock-transfer", "purchase-orders", "suppliers", "invoices", "quotes", "expenses", "bills", "services", "mpesa-history", "credit-balances"]);

function getTenantSlugFromPath(pathname: string) {
  const first = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return first && !RESERVED_TENANT_PATHS.has(first) ? first : null;
}

async function readFunctionError(error: any) {
  let payload: any = null;
  let message = error?.message || "Request failed";
  try {
    const ctx: any = error?.context;
    if (ctx?.json) payload = await ctx.json();
    else if (ctx?.body) payload = await new Response(ctx.body).json();
    if (payload?.error || payload?.message || payload?.errorMessage) {
      message = payload.error || payload.message || payload.errorMessage;
    }
  } catch {}
  return { message, payload };
}

export default function PointOfSale() {
  const [search, setSearch] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<{ name: string; image_url: string | null } | null>(null);
  const [category, setCategory] = useState("All");
  const [posPage, setPosPage] = useState(1);
  const [posPageSize, setPosPageSize] = useState(50);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<DbCustomer | null>(null);
  // ERP: who made the sale (commission), when a credit sale is due, and the customer search / quick add.
  const [salesRep, setSalesRep] = useState<{ id: string; name: string } | null>(null);
  const [creditDue, setCreditDue] = useState<string>("");
  const [custSearch, setCustSearch] = useState("");
  const [quickCust, setQuickCust] = useState<{ name: string; phone: string } | null>(null);
  const { data: staffForReps = [] } = useStaff();
  // Sales reps (Staff → Sales rep). The signed-in rep is picked automatically.
  const { data: repRows = [] } = useQuery({
    queryKey: ["pos-sales-reps"],
    staleTime: 60_000,
    queryFn: async () => ((await (supabase as any).from("sales_reps").select("user_id,display_name").eq("is_active", true).order("display_name")).data || []) as { user_id: string; display_name: string }[],
  });
  const repChoices = (repRows.length ? repRows : (staffForReps as any[])).map((r: any) => ({ id: r.user_id as string, name: (r.display_name || "Staff") as string }));
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  // Card machine (PDQ): the cashier charges the card on the terminal, then records its approval code here.
  const [pdqOpen, setPdqOpen] = useState(false);
  const [pdqRef, setPdqRef] = useState("");
  const pdqRefRef = useRef("");
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  // Online gateways (Flutterwave, Stripe, MTN, Airtel…) switched on for this shop.
  const { data: shopGateways = [] } = useShopGateways();
  const onlineOn = shopGateways.some((g) => g.enabled);
  // Packages without the Customers module (e.g. Basic) sell to walk-ins only.
  const { has: hasFeature, ready: featuresReady } = useTenantFeatures();
  const customersOn = featuresReady && hasFeature("customers");
  const [onlinePay, setOnlinePay] = useState<any>(null);
  // Lets the M-Pesa watcher close an open tab that was paid from the till.
  const settleActiveBillRef = useRef<((txId: string, amount: number, method: string) => Promise<void>) | null>(null);
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [showMpesaInput, setShowMpesaInput] = useState(false);
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [pendingMpesa, setPendingMpesa] = useState<{ txId: string; customerId: string | null; redeemedPoints: number; startedAt: number; cartHash: string; phone: string; amount: number; customerName: string }| null>(null);
  // Terminal outcome shown on the waiting screen so the till reacts the moment
  // the customer approves or cancels on their phone.
  const [mpesaOutcome, setMpesaOutcome] = useState<null | { state: "success" | "failed"; title: string; description: string }>(null);
  const [mpesaDelayed, setMpesaDelayed] = useState(false);
  // Tills that were cancelled locally must ignore any answer that lands later.
  const abandonedMpesaRef = useRef<Set<string>>(new Set());
  // The sale id is known before the prompt leaves the till, so Cancel works
  // even while the prompt is still being sent.
  const startingMpesaRef = useRef<string | null>(null);

  // A confirmed payment shows a short tick, then clears so the receipt is visible.
  useEffect(() => {
    if (mpesaOutcome?.state !== "success") return;
    const t = setTimeout(() => setMpesaOutcome(null), 1200);
    return () => clearTimeout(t);
  }, [mpesaOutcome]);
  const [retrying, setRetrying] = useState(false);
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState(0);
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(true);
  const [showStaff, setShowStaff] = useState(false);
  const [heldSales, setHeldSales] = useState<HeldSale[]>(() => {
    try { return JSON.parse(localStorage.getItem("held_sales") || "[]"); } catch { return []; }
  });
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showCreditNote, setShowCreditNote] = useState(false);
  const [showCashRegister, setShowCashRegister] = useState(false);
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [showEndOfDay, setShowEndOfDay] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<null | { method: string; loyaltyOverride?: number }>(null);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [cartDiscountType, setCartDiscountType] = useState<"amount" | "percent">("amount");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [changeBanner, setChangeBanner] = useState<number | null>(null);
  const [layoutPrefs, setLayoutPrefs] = useState<PosLayoutPrefs>(() => readPosLayoutPrefs());
  const [savedLayoutPrefs, setSavedLayoutPrefs] = useState<PosLayoutPrefs>(() => readPosLayoutPrefs());
  const [layoutPrefsSaved, setLayoutPrefsSaved] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  // Customer display: stable session id per cashier session
  const [displaySessionId] = useState(() => {
    const k = "pos_display_session_id";
    let id = sessionStorage.getItem(k);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(k, id); }
    return id;
  });
  const { tenant } = useTenant();
  const routeLocation = useLocation();
  const publishDisplay = useDisplayPublisher(displaySessionId);
  const lastAddedItemRef = useRef<{ name: string; price: number; quantity: number } | null>(null);

  // Barcode scanner: listens for rapid keystrokes ending in Enter
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const meAsRep = repRows.find((r) => r.user_id === user?.id);
  useEffect(() => {
    if (!salesRep && meAsRep && cart.length === 0) setSalesRep({ id: meAsRep.user_id, name: meAsRep.display_name || "Me" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meAsRep?.user_id, cart.length]);
  const { vatEnabled } = useVatEnabled();
  const queryClient = useQueryClient();

  const { data: locations = [] } = useLocations();
  const { data: userLocations = [] } = useUserLocations(user?.id);
  const { data: stockProducts = [], isLoading: productsLoading } = useProductStocks(locationId);
  // Water refill sizes have no stock of their own: what can be sold is what
  // is in their tank, and their cost follows the tank's buying price.
  const { businessType: shopType } = useBusinessType();
  const { data: waterTanks = [] } = useWaterTanks(shopType === "water");
  const products = useMemo(() => {
    // Service items (Products & Services → type Service) have no stock: always sellable.
    const withServices = (stockProducts as any[]).map((p) => (p.product_type === "service" && !p.is_service ? { ...p, is_service: true, stock: 999, reorder_level: 0 } : p));
    if (shopType !== "water" || waterTanks.length === 0) return withServices;
    const byId = new Map(waterTanks.map((t) => [t.id, t]));
    return withServices.map((p) => {
      const tank = p.tank_id ? byId.get(p.tank_id) : null;
      const l = Number(p.litres) || 0;
      if (!tank || l <= 0) return p;
      return { ...p, stock: Math.floor(tank.current_l / l + 1e-9), reorder_level: Math.ceil(tank.alert_level_l / l), cost_price: sizeCost(l, tank.cost_per_litre) };
    });
  }, [shopType, waterTanks, stockProducts]);
  const { data: customers = [] } = useCustomers();
  const { data: bizSettings, refetch: refetchBizSettings } = useBusinessSettings();
  const { data: staff = [] } = useStaff();
  const { data: allUserLocations = [] } = useAllUserLocations();
  const paymentProvider = (bizSettings as any)?.payment_provider;
  const urlTenantSlug = useMemo(() => getTenantSlugFromPath(routeLocation.pathname), [routeLocation.pathname]);
  const mpesaTenantContext = useMemo(() => ({
    tenant_id: tenant?.id || profile?.tenant_id || null,
    tenant_slug: tenant?.slug || urlTenantSlug || null,
  }), [tenant?.id, tenant?.slug, profile?.tenant_id, urlTenantSlug]);
  const usesDarajaMpesa = paymentProvider !== "paystack" && paymentProvider !== "manual";
  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const sb: any = supabase;
      const { data, error } = await sb.from("services").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return (data || []).map((s: any) => ({
        ...s,
        sku: `SVC-${s.id.slice(0, 4).toUpperCase()}`,
        stock: 999,
        reorder_level: 0,
        cost_price: s.cost_price || 0,
        unit: "service",
        is_service: true,
      }));
    },
  });
  const [showServices, setShowServices] = useState(false);
  const [wholesaleMode, setWholesaleMode] = useState(false);
  // Pre-checkout wholesale violations dialog
  const [wholesaleViolations, setWholesaleViolations] = useState<
    Array<{ name: string; current: number; required: number }>
  >([]);

  // Resolve the till's branch. A cashier may have no branch linked to their
  // account yet, and a brand-new shop may have no branch at all — in both cases
  // the shop's main branch is used (created once if it is genuinely missing) so
  // the catalogue and checkout always work.
  const provisioningLocationRef = useRef(false);
  useEffect(() => {
    if (locationId) return;
    const primary = userLocations.find((u) => u.is_primary);
    const mine = primary?.location_id || userLocations[0]?.location_id;
    if (mine && locations.some((l: any) => l.id === mine)) { setLocationId(mine); return; }
    if (mine) { setLocationId(mine); return; }
    if (locations[0]?.id) { setLocationId(locations[0].id); return; }

    // No branch anywhere for this shop yet — create the main one once.
    const tenantId = tenant?.id || profile?.tenant_id;
    if (!tenantId || provisioningLocationRef.current) return;
    provisioningLocationRef.current = true;
    (async () => {
      try {
        const sb: any = supabase;
        const { data: existing } = await sb
          .from("locations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("is_main", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          setLocationId(existing.id);
        } else {
          const { data: created } = await sb
            .from("locations")
            .insert({ tenant_id: tenantId, name: "Main Store", is_active: true })
            .select("id")
            .maybeSingle();
          if (created?.id) setLocationId(created.id);
        }
        queryClient.invalidateQueries({ queryKey: ["locations"] });
        queryClient.invalidateQueries({ queryKey: ["user-locations"] });
      } catch {
        provisioningLocationRef.current = false;
      }
    })();
  }, [locationId, userLocations, locations, tenant?.id, profile?.tenant_id, queryClient]);

  // Switching account must never leave the previous cashier's branch selected.
  const lastUserRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id || null;
    if (lastUserRef.current && lastUserRef.current !== uid) {
      setLocationId("");
      provisioningLocationRef.current = false;
    }
    lastUserRef.current = uid;
  }, [user?.id]);

  // Barcode scanner keyboard listener
  const handleBarcodeScan = useCallback((code: string) => {
    const allItems = [...products, ...services];
    const match = allItems.find((p: any) =>
      p.sku?.toLowerCase() === code.toLowerCase() ||
      p.barcode?.toLowerCase() === code.toLowerCase() ||
      p.id === code
    );
    if (match) {
      addToCart(match);
      toast({ title: "Product scanned", description: `${match.name} added to cart` });
    } else {
      toast({ title: "Product not found", description: `No product with barcode: ${code}`, variant: "destructive" });
    }
  }, [products, services]);

  useEffect(() => {
    if (!scannerActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter" && barcodeBuffer.current.length >= 3) {
        handleBarcodeScan(barcodeBuffer.current.trim());
        barcodeBuffer.current = "";
        return;
      }
      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 300);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scannerActive, handleBarcodeScan]);

  // Cash drawer session is handled silently: if this cashier has no open
  // register for the active branch, one is opened in the background so cash
  // sales always land in a session without anyone pressing "Register".
  useEffect(() => {
    if (!locationId || !user?.id) return;
    let cancelled = false;
    (async () => {
      const sb: any = supabase;
      const { data: openReg } = await sb
        .from("cash_register")
        .select("id")
        .eq("location_id", locationId)
        .eq("opened_by", user.id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (cancelled || openReg) return;
      await sb.from("cash_register").insert({
        tenant_id: profile?.tenant_id,
        location_id: locationId,
        opened_by: user.id,
        opening_float: 0,
        expected_cash: 0,
        status: "open",
      });
    })();
    return () => { cancelled = true; };
  }, [locationId, user?.id, profile?.tenant_id]);

  // Global keyboard shortcuts for fast checkout
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const isFn = ["F2", "F3", "F4", "F8", "F9", "F10"].includes(e.key);
      if (inField && !isFn) return;
      switch (e.key) {
        case "F2":
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;
        case "F3":
          if (cart.length > 0) { e.preventDefault(); setPendingConfirm({ method: "mobile_money" }); }
          break;
        case "F4":
          if (cart.length > 0) { e.preventDefault(); setPendingConfirm({ method: "cash" }); }
          break;
        case "F8":
          e.preventDefault();
          setShowCreditNote(true);
          break;
        case "F9":
          if (cart.length > 0) { e.preventDefault(); setShowSplitPayment(true); }
          break;
        case "F10":
          if (cart.length > 0) { e.preventDefault(); setPendingConfirm({ method: "cash" }); }
          break;
        case "Escape":
          if (pendingConfirm) setPendingConfirm(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, pendingConfirm]);

  const MPESA_TIMEOUT_MS = 120_000;

  // Resume pending payments; a timeout is not proof that M-Pesa did not charge.
  useEffect(() => {
    if (!user?.id || pendingMpesa) return;
    const checkOrphaned = async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, created_at, customer_id, discount, mpesa_ref")
        .eq("cashier_id", user.id)
        .eq("status", "pending")
        .eq("payment_method", "mpesa")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!data || data.length === 0) return;
      const tx = data[0];
      const age = Date.now() - new Date(tx.created_at).getTime();
      setPendingMpesa({ txId: tx.id, customerId: tx.customer_id || null, redeemedPoints: tx.discount || 0, startedAt: Date.now() - age, cartHash: "", phone: "", amount: 0, customerName: "" });
      if (age > MPESA_TIMEOUT_MS) setMpesaDelayed(true);
      toast({ title: "Checking M-Pesa payment", description: "Confirm this sale before charging the customer again." });
    };
    checkOrphaned();
  }, [user?.id]);

  // Pressing Pay (or Enter) must react instantly: the phone box closes and the
  // waiting screen appears before the request even leaves the till.
  const startMpesaPayment = () => {
    const phone = mpesaPhone.trim();
    if (!phone || mpesaLoading) return;
    if (!validateKenyanPhone(phone)) {
      toast({ title: "Check the phone number", description: "Use a Safaricom number like 07XXXXXXXX or 2547XXXXXXXX.", variant: "destructive" });
      return;
    }
    setMpesaOutcome(null);
    setMpesaDelayed(false);
    setMpesaLoading(true);
    setShowMpesaInput(false);
    void Promise.resolve(completeSale("mpesa", phone)).finally(() => setMpesaLoading(false));
  };

  // Cancel must feel instant: clear the waiting screen straight away and tidy
  // up the record in the background.
  const cancelPendingMpesa = () => {
    const txId = pendingMpesa?.txId || startingMpesaRef.current;
    setPendingMpesa(null);
    setMpesaLoading(false);
    setMpesaOutcome(null);
    if (txId) {
      abandonedMpesaRef.current.add(txId);
      startingMpesaRef.current = null;
    }
    toast({ title: "Waiting screen closed", description: "The payment may still complete. Check the sale before charging the customer again." });
  };


  useEffect(() => {
    if (!pendingMpesa) return;
    const watchedTxId = pendingMpesa.txId;
    if (abandonedMpesaRef.current.has(watchedTxId)) return;
    let pollCount = 0;
    let checking = false;
    let handled = false;
    let stopped = false;

    // Closing the sale once the money is in: used both by the checks below and
    // by the live connection so any till in the shop reacts the same second.
    const finalize = async (data: any) => {
      if (!data || handled || stopped || abandonedMpesaRef.current.has(watchedTxId)) return;
      if (data.status === "completed") {
        handled = true;
        if (pendingMpesa.customerId) {
          const { data: c } = await supabase.from("customers").select("loyalty_points").eq("id", pendingMpesa.customerId).maybeSingle();
          if (c) {
            let newPoints = c.loyalty_points;
            if (pendingMpesa.redeemedPoints > 0) {
              newPoints = Math.max(0, newPoints - pendingMpesa.redeemedPoints);
            }
            newPoints += Math.floor(Number(data.total) * 0.2);
            await supabase.from("customers").update({ loyalty_points: newPoints }).eq("id", pendingMpesa.customerId);
          }
        }

        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["customers"] });
        queryClient.invalidateQueries({ queryKey: ["product-variants"] });

        const mpesaEarnedPts = pendingMpesa.customerId ? Math.floor(Number(data.total) * 0.2) : 0;
        setLastReceipt({ ...data, loyalty_points_earned: mpesaEarnedPts });
        publishDisplay({
          type: "paid",
          shopName: (bizSettings as any)?.business_name || tenant?.business_name || "Welcome",
          logoUrl: tenant?.logo_url || null,
          paymentMethod: "mpesa",
          total: Number(data.total),
        });
        setCart([]);
        setSelectedCustomer(null);
        setLoyaltyRedeemPoints(0);
        setPendingMpesa(null);
        setMpesaDelayed(false);
        setMpesaLoading(false);
        setMpesaOutcome({ state: "success", title: "Payment received", description: "M-Pesa payment confirmed." });
        void settleActiveBillRef.current?.(data.id, Number(data.total), "mpesa");
        toast({ title: "Sale completed", description: "M-Pesa payment confirmed." });
        return;
      }

      if (data.status === "failed" || data.status === "cancelled") {
        handled = true;
        setPendingMpesa(null);
        setMpesaDelayed(false);
        setMpesaLoading(false);
        const isCancelled = data.status === "cancelled";
        // The live update may not carry the reason; read it from the sale.
        let errText: string | null = (data as any).mpesa_error_message ?? null;
        if (!errText) {
          const { data: row } = await supabase.from("transactions").select("mpesa_error_message").eq("id", data.id).maybeSingle();
          errText = (row as any)?.mpesa_error_message ?? null;
        }
        const why = mpesaReason(data.status, errText);
        setMpesaOutcome({ state: "failed", title: why.title, description: `${why.reason} ${why.advice}` });
        const msg = why.reason;
        logActivity({
          action: isCancelled ? "payment_reversed" : "payment_failed",
          entity_type: "transaction",
          entity_id: data.id,
          description: isCancelled
            ? `Customer cancelled M-Pesa STK push (${formatKES(Number(data.total) || 0)})`
            : `M-Pesa payment failed (${formatKES(Number(data.total) || 0)})`,
          metadata: {
            status: data.status,
            total: Number(data.total) || 0,
            reason: isCancelled ? "customer_cancelled_stk" : "gateway_failure",
            gateway_message: errText,
            mpesa_ref: (data as any).mpesa_ref ?? null,
          },
        });
        toast({ title: isCancelled ? "Payment cancelled" : "Payment failed", description: msg, variant: "destructive" });
      }
    };

    // Live update straight from the shop's records — no waiting for the next check.
    const channel = supabase
      .channel(`pos-mpesa-${pendingMpesa.txId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${pendingMpesa.txId}` },
        (payload) => { void finalize(payload.new as any); },
      )
      .subscribe();
    const runCheck = async () => {
      if (checking || stopped || handled || abandonedMpesaRef.current.has(watchedTxId)) return;
      checking = true;
      try {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", pendingMpesa.txId)
        .maybeSingle();

      if (!data) return;

      const isJmsurfPayment = String((data as any).mpesa_ref || "").startsWith("jmsurf:");
      const isDarajaPayment = String((data as any).mpesa_ref || "").startsWith("daraja:");
      const isPayheroPayment = String((data as any).mpesa_ref || "").startsWith("payhero:") || isDarajaPayment;
      if (data.status === "pending" && Date.now() - pendingMpesa.startedAt > MPESA_TIMEOUT_MS) setMpesaDelayed(true);

      pollCount++;

      if (data.status === "pending") {
        // Active check: ask M-Pesa directly for the outcome so an approval or a
        // cancellation on the phone shows on the till straight away instead of
        // waiting for a confirmation message that may never arrive.
        try {
          const live: any = isJmsurfPayment
            ? await jmsurfMpesaStatus({ pos_transaction_id: pendingMpesa.txId, tenant_id: tenant?.id || profile?.tenant_id })
            : isDarajaPayment
              ? await darajaMpesaStatus({ pos_transaction_id: pendingMpesa.txId })
              : await posMpesaStatus({ pos_transaction_id: pendingMpesa.txId });
          const livePayload: any = live?.data ?? live;
          const resolved = String(livePayload?.resolved_status || livePayload?.status || "");
          if (resolved === "completed" || resolved === "failed" || resolved === "cancelled") {
            const { data: refreshed } = await supabase
              .from("transactions")
              .select("*")
              .eq("id", pendingMpesa.txId)
              .maybeSingle();
            if (refreshed) Object.assign(data, refreshed);
          }
        } catch (e) {
          console.log("payment status poll error:", e);
        }
      }

      await finalize(data);
      } finally {
        checking = false;
      }
    };

    void runCheck();
    const timer = setInterval(() => { void runCheck(); }, 1200);

    return () => {
      stopped = true;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [pendingMpesa, queryClient, toast]);

  // ---- Shop-type extras: clothing sizes/colours and liquor bottle/tot selling ----
  const { businessType } = useBusinessType();
  const { map: variantMap } = useVariantsByProduct();
  const createOpenBill = useCreateOpenBill();
  const updateBillItems = useUpdateBillItems();
  const { data: openBillList = [] } = useOpenBills("open");
  const [optionProduct, setOptionProduct] = useState<any | null>(null);
  // Water shops: a refill size with a matching empty bottle / jerrican for sale.
  const [waterChoice, setWaterChoice] = useState<{ refill: any; containers: any[] } | null>(null);
  const [showTabPicker, setShowTabPicker] = useState(false);
  const [showTabList, setShowTabList] = useState(false);
  const [activeBill, setActiveBill] = useState<any | null>(null);
  const [newTabLabel, setNewTabLabel] = useState("");
  const isLiquor = businessType === "liquor";

  const liquorUnits = (p: any) => {
    const units: { key: string; label: string; price: number; perBottle: number }[] = [
      { key: "bottle", label: p.bottle_size ? `Bottle (${p.bottle_size})` : "Bottle", price: Number(p.price ?? 0), perBottle: 1 },
    ];
    if (Number(p.tot_price) > 0 && Number(p.tots_per_bottle) > 0) {
      units.push({ key: "tot", label: "Tot / glass", price: Number(p.tot_price), perBottle: 1 / Number(p.tots_per_bottle) });
    }
    if (Number(p.units_per_crate) > 0) {
      units.push({ key: "crate", label: `Crate of ${Number(p.units_per_crate)}`, price: Number(p.price ?? 0) * Number(p.units_per_crate), perBottle: Number(p.units_per_crate) });
    }
    return units;
  };

  const needsOptions = (p: any) =>
    (variantMap[p.id] || []).length > 0 || (isLiquor && liquorUnits(p).length > 1);

  const containersFor = (p: any) => {
    const l = Number(p.litres) || 0;
    if (!l) return [];
    return (products as any[]).filter((c) => c.id !== p.id && Number(c.container_litres) === l);
  };

  const handleProductTap = (product: any) => {
    if (needsOptions(product)) { setOptionProduct(product); return; }
    if (shopType === "water") {
      const containers = containersFor(product);
      if (containers.length) { setWaterChoice({ refill: product, containers }); return; }
    }
    addToCart(product);
  };

  const addVariantToCart = (product: any, v: ProductVariant) => {
    addToCart({
      ...product,
      id: `${product.id}::${v.id}`,
      product_id: product.id,
      variant_id: v.id,
      name: `${product.name} — ${[v.size, v.color].filter(Boolean).join(" / ")}`,
      sku: v.sku || product.sku,
      price: Number(v.price ?? product.price ?? 0),
      cost_price: Number(v.cost_price ?? product.cost_price ?? 0),
      stock: Number(v.stock ?? 0),
      enable_wholesale: false,
    });
    setOptionProduct(null);
  };

  const addUnitToCart = (product: any, unit: { key: string; label: string; price: number; perBottle: number }) => {
    if (unit.key === "bottle") {
      addToCart(product);
    } else {
      addToCart({
        ...product,
        id: `${product.id}::${unit.key}`,
        product_id: product.id,
        unit_type: unit.key,
        stock_per_unit: unit.perBottle,
        name: `${product.name} — ${unit.label}`,
        price: unit.price,
        stock: unit.key === "tot" ? Math.floor(Number(product.stock ?? 0) / unit.perBottle) : Math.floor(Number(product.stock ?? 0) / unit.perBottle),
        enable_wholesale: false,
      });
    }
    setOptionProduct(null);
  };

  const sendCartToTab = async (billId: string | null, label?: string) => {
    const lines = cart.map((i: any) => ({
      product_id: i.product_id || i.id,
      variant_id: i.variant_id ?? null,
      name: i.name,
      sku: i.sku ?? null,
      size: i.size ?? null,
      color: i.color ?? null,
      bottle_size: i.bottle_size ?? null,
      unit_type: i.unit_type ?? "unit",
      price: Number(i.price),
      cost_price: Number(i.cost_price ?? 0),
      vat_rate: Number(i.vat_rate ?? 0),
      stock: Number(i.stock ?? 0),
      label: i.name,
      quantity: i.quantity,
    }));
    try {
      if (billId) {
        const bill: any = openBillList.find((b: any) => b.id === billId);
        await updateBillItems.mutateAsync({ bill, items: [...(bill.items || []), ...lines] as any });
      } else {
        const bill = await createOpenBill.mutateAsync({ label: label || "Tab", locationId });
        await updateBillItems.mutateAsync({ bill, items: lines as any });
      }
      setCart([]);
      setShowTabPicker(false);
      setNewTabLabel("");
      toast({ title: "Sent to tab", description: "Find it under Open Bills / Tabs." });
    } catch (e: any) {
      toast({ title: "Could not send to tab", description: e.message, variant: "destructive" });
    }
  };

  // If a saved tab line lost its price, fall back to the current catalogue price.
  const priceFromCatalog = (l: any) => {
    const p: any = (products as any[]).find((x: any) => x.id === l.product_id);
    if (!p) return 0;
    if (l.variant_id) {
      const v = (variantMap[l.product_id] || []).find((x: any) => x.id === l.variant_id);
      if (v) return safeNum((v as any).price, safeNum(p.price));
    }
    if (l.unit_type === "tot") return safeNum(p.tot_price, safeNum(p.price));
    if (l.unit_type === "crate") return safeNum(p.price) * Math.max(1, safeNum(p.units_per_crate, 1));
    return safeNum(p.price);
  };

  // Bring an open tab back into the till so the cashier can add rounds or take payment.
  const loadTabIntoCart = (bill: any) => {
    const items = (bill.items || []).map((l: any) => ({
      id: l.variant_id
        ? `${l.product_id}::${l.variant_id}`
        : l.unit_type && l.unit_type !== "unit"
          ? `${l.product_id}::${l.unit_type}`
          : l.product_id,
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      name: l.label || l.name,
      sku: l.sku ?? null,
      size: l.size ?? null,
      color: l.color ?? null,
      bottle_size: l.bottle_size ?? null,
      unit_type: l.unit_type ?? "unit",
      price: safeNum(l.price ?? l.unit_price ?? l.amount, safeNum(priceFromCatalog(l))),
      cost_price: safeNum(l.cost_price),
      vat_rate: safeNum(l.vat_rate),
      stock: safeNum(l.stock),
      quantity: Math.max(1, safeNum(l.quantity, 1)),
      discount: safeNum(l.discount),
      enable_wholesale: false,
    }));
    setCart(items as any);
    setActiveBill(bill);
    setShowTabList(false);
    setCartDiscount(0);
    setCartDiscountType("amount");
    toast({ title: `Tab loaded: ${bill.label}`, description: "Add more items or take payment." });
  };

  // Save any changes made in the till back onto the tab without taking payment.
  const saveCartToActiveBill = async () => {
    if (!activeBill) return;
    const lines = cart.map((i: any) => ({
      product_id: i.product_id || i.id,
      variant_id: i.variant_id ?? null,
      name: i.name,
      sku: i.sku ?? null,
      size: i.size ?? null,
      color: i.color ?? null,
      bottle_size: i.bottle_size ?? null,
      unit_type: i.unit_type ?? "unit",
      price: Number(i.price),
      cost_price: Number(i.cost_price ?? 0),
      vat_rate: Number(i.vat_rate ?? 0),
      stock: Number(i.stock ?? 0),
      label: i.name,
      quantity: i.quantity,
    }));
    try {
      await updateBillItems.mutateAsync({ bill: activeBill, items: lines as any });
      setCart([]);
      setActiveBill(null);
      toast({ title: "Tab updated", description: `${activeBill.label} saved. Nothing charged yet.` });
    } catch (e: any) {
      toast({ title: "Could not update tab", description: e.message, variant: "destructive" });
    }
  };

  // After a tab is paid in the till, close it and record the payment against it.
  const settleActiveBill = async (transactionId: string, amount: number, method: string) => {
    const bill = activeBill;
    if (!bill) return;
    try {
      await supabase.from("bill_payments" as any).insert({
        tenant_id: bill.tenant_id,
        bill_id: bill.id,
        amount,
        method,
        received_by: user?.id || null,
        transaction_id: transactionId,
      } as any);
      await supabase
        .from("open_bills" as any)
        .update({
          amount_paid: amount,
          status: "paid",
          closed_at: new Date().toISOString(),
          transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", bill.id);
      queryClient.invalidateQueries({ queryKey: ["open-bills"] });
      toast({ title: "Tab closed", description: `${bill.label} is fully paid.` });
    } catch (e: any) {
      toast({ title: "Tab not closed", description: e.message, variant: "destructive" });
    } finally {
      setActiveBill(null);
    }
  };
  settleActiveBillRef.current = settleActiveBill;

  // A tab sent here from the Open Bills page loads straight into the till.
  useEffect(() => {
    if (!isLiquor || activeBill || openBillList.length === 0) return;
    const wanted = sessionStorage.getItem("pos-load-bill");
    if (!wanted) return;
    const bill = openBillList.find((b: any) => b.id === wanted);
    sessionStorage.removeItem("pos-load-bill");
    if (bill) loadTabIntoCart(bill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiquor, openBillList, activeBill]);






  const displayItems = showServices
    ? services
    : wholesaleMode
      ? products.filter((p: any) => Boolean(p.enable_wholesale) && Number(p.wholesale_price ?? 0) > 0)
      : products;
  const categories = useMemo(() => ["All", ...new Set(displayItems.map((p: any) => p.category))], [displayItems]);

  const filteredProducts = useMemo(() => {
    const list = displayItems.filter((p: any) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").toLowerCase().includes(search.toLowerCase());
      const matchCategory = category === "All" || p.category === category;
      return matchSearch && matchCategory;
    });
    const byName = (a: any, b: any) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    if (shopType === "water") {
      const rank = (p: any) => (Number(p.litres) > 0 ? 0 : Number(p.container_litres) > 0 ? 1 : 2);
      const size = (p: any) => Number(p.litres) || Number(p.container_litres) || 0;
      return [...list].sort((a: any, b: any) => rank(a) - rank(b) || size(a) - size(b) || byName(a, b));
    }
    return [...list].sort(byName);
  }, [search, category, displayItems, shopType]);

  // Search suggestions expand every size/colour into its own row so a cashier
  // can type "shirt long 22 l" and land straight on that exact variant.
  const searchSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as any[];
    const tokens = q.split(/\s+/).filter(Boolean);
    const rows: any[] = [];
    displayItems.forEach((p: any) => {
      const variants = variantMap[p.id] || [];
      if (variants.length > 0) {
        variants.forEach((v) =>
          rows.push({
            key: `${p.id}::${v.id}`,
            product: p,
            variant: v,
            label: `${p.name} — ${[v.size, v.color].filter(Boolean).join(" / ") || "Standard"}`,
            stock: Number(v.stock ?? 0),
            price: Number(v.price ?? p.price ?? 0),
            isService: false,
          }),
        );
      } else {
        rows.push({
          key: p.id,
          product: p,
          variant: null,
          label: p.name,
          stock: Number(p.stock ?? 0),
          price: Number(p.price ?? 0),
          isService: Boolean(p.is_service),
        });
      }
    });
    return rows
      .filter((r) => {
        const hay = `${r.label} ${r.product.sku || ""} ${r.variant?.sku || ""} ${r.product.barcode || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 40);
  }, [search, displayItems, variantMap]);

  // Reset pagination when the visible product set changes
  useEffect(() => { setPosPage(1); }, [search, category, showServices, wholesaleMode]);
  const pagedProducts = usePaginated(filteredProducts, posPageSize, posPage);

  // Resolve effective unit price + mode for a given product/cart row at a quantity.
  // Wholesale ONLY activates when the cashier has explicitly toggled Wholesale mode
  // AND the product has wholesale enabled AND the qty meets wholesale_min_quantity.
  // Otherwise the retail price is always used (even if qty exceeds the wholesale min).
  const resolvePricing = (row: any, qty: number) => {
    const retail = Number(row.retail_price ?? row.price ?? 0);
    const wholesale = Number(row.wholesale_price ?? 0);
    const minQty = Math.max(1, Number(row.wholesale_min_quantity ?? 1));
    const enabled = Boolean(row.enable_wholesale) && wholesale > 0;
    const useWholesale = wholesaleMode && enabled && qty >= minQty;
    return {
      price: useWholesale ? wholesale : retail,
      price_mode: (useWholesale ? "wholesale" : "retail") as "retail" | "wholesale",
      retail_price: retail,
      wholesale_price: wholesale,
      wholesale_min_quantity: minQty,
    };
  };

  const addToCart = (product: any) => {
    if (pendingMpesa) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      const currentQty = existing ? existing.quantity : 0;
      const minWholesale = Math.max(1, Number(product.wholesale_min_quantity ?? 1));
      const wholesaleEnabled = Boolean(product.enable_wholesale) && Number(product.wholesale_price ?? 0) > 0;
      // In wholesale mode, the FIRST add jumps straight to the wholesale minimum quantity.
      const increment = !existing && wholesaleMode && wholesaleEnabled ? minWholesale : 1;
      const nextQty = currentQty + increment;
      if (!product.is_service && nextQty > product.stock) {
        toast({ title: "Insufficient stock", description: `Only ${product.stock} ${product.unit || "piece"}(s) available for ${product.name}.`, variant: "destructive" });
        return prev;
      }
      const base = existing || product;
      const p = resolvePricing(base, nextQty);
      lastAddedItemRef.current = { name: product.name, price: p.price, quantity: nextQty };
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, quantity: nextQty, ...p } : i);
      return [...prev, { ...product, ...p, quantity: nextQty, discount: 0 }];
    });
  };

  const setItemQuantity = (id: string, qty: number) => {
    setCart((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      if (qty <= 0) return { ...i, quantity: 0 };
      if (!(i as any).is_service && qty > i.stock) {
        toast({ title: "Insufficient stock", description: `Only ${i.stock} ${i.unit || "piece"}(s) available for ${i.name}.`, variant: "destructive" });
        return i;
      }
      // In Wholesale mode, never allow qty to drop below the product's wholesale min.
      const minQty = Math.max(1, Number((i as any).wholesale_min_quantity ?? 1));
      const wholesaleEnabled = Boolean((i as any).enable_wholesale) && Number((i as any).wholesale_price ?? 0) > 0;
      if (wholesaleMode && wholesaleEnabled && qty < minQty) {
        toast({ title: "Wholesale minimum", description: `Minimum wholesale quantity for ${i.name} is ${minQty}.`, variant: "destructive" });
        return i;
      }
      const p = resolvePricing(i, qty);
      return { ...i, quantity: qty, ...p };
    }).filter((i) => i.quantity > 0));
  };

  const updateQuantity = (id: string, delta: number) => {
    if (pendingMpesa) return;
    const current = cart.find(i => i.id === id);
    if (!current) return;
    setItemQuantity(id, current.quantity + delta);
  };

  // Recompute prices when the selected customer changes (wholesale_eligible may flip).
  useEffect(() => {
    setCart((prev) => prev.map((i) => ({ ...i, ...resolvePricing(i, i.quantity) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.id]);

  const removeItem = (id: string) => {
    if (pendingMpesa) return;
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const itemDiscountTotal = cart.reduce((sum, i) => sum + i.discount * i.quantity, 0);
  const subtotalRaw = cart.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  const subtotalAfterItemDiscounts = subtotalRaw - itemDiscountTotal;
  const tax = vatEnabled
    ? cart.reduce((sum, i) => sum + ((Number(i.price) - i.discount) * i.quantity * Number(i.vat_rate)) / (100 + Number(i.vat_rate)), 0)
    : 0;
  const computedCartDiscount = cartDiscountType === "percent" ? Math.round(subtotalAfterItemDiscounts * cartDiscount / 100) : cartDiscount;
  const loyaltyDiscount = Math.min(loyaltyRedeemPoints, selectedCustomer?.loyalty_points || 0, subtotalAfterItemDiscounts);
  const totalDiscounts = itemDiscountTotal + computedCartDiscount + loyaltyDiscount;
  const appliedDiscount = totalDiscounts;
  const total = Math.max(0, subtotalRaw - totalDiscounts);

  // Publish cart state to customer-facing display whenever it changes
  useEffect(() => {
    const shopName = (bizSettings as any)?.business_name || tenant?.business_name || "Welcome";
    const logoUrl = tenant?.logo_url || null;
    if (cart.length === 0) {
      publishDisplay({ type: "idle", shopName, logoUrl });
      lastAddedItemRef.current = null;
      return;
    }
    const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
    publishDisplay({
      type: lastAddedItemRef.current ? "item_added" : "running",
      shopName,
      logoUrl,
      lastItem: lastAddedItemRef.current,
      itemCount,
      subtotal: subtotalRaw,
      total,
    });
  }, [cart, total, subtotalRaw, bizSettings, tenant, publishDisplay]);

  // Credit payment eligibility
  const creditEligible = selectedCustomer && selectedCustomer.credit_limit > 0;
  const creditAvailable = selectedCustomer ? selectedCustomer.credit_limit - selectedCustomer.balance : 0;
  const canPayCredit = creditEligible && total <= creditAvailable;

  const finalizeImmediateSale = async (txRow: any, saleItems: any[], changeGiven = 0) => {
    const sb: any = supabase;
    const payMethod = txRow.payment_method;

    // The sale is already saved at this point, so the receipt is shown straight
    // away. Drawer, stock and loyalty updates then run behind the receipt.
    const txTotal = Number(txRow.total);
    const txDiscount = Number(txRow.discount);
    const earnedPts = selectedCustomer?.id ? Math.floor(txTotal * 0.2) : 0;
    const tendered = changeGiven > 0 ? txTotal + changeGiven : undefined;
    const receiptData = {
      ...txRow,
      items: saleItems,
      total: txTotal,
      discount: txDiscount,
      loyalty_points_earned: earnedPts,
      customer_phone: selectedCustomer?.phone || "",
      cash_tendered: tendered,
      change_given: changeGiven || undefined,
    };
    setLastReceipt(receiptData);


    // Update cash register if this is a cash sale (or split with cash component)
    if (payMethod === "cash" || payMethod === "split") {
      const { data: openReg } = await sb
        .from("cash_register")
        .select("id, cash_sales, expected_cash, opening_float, cash_in, cash_out")
        .eq("location_id", locationId)
        .eq("opened_by", user?.id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (openReg) {
        const cashAmount = Number(txRow.total);
        const newCashSales = (Number(openReg.cash_sales) || 0) + cashAmount;
        // Record change paid out as cash_out so drawer balance stays accurate
        const newCashOut = Number(openReg.cash_out || 0) + Number(changeGiven || 0);
        const newExpected = Number(openReg.opening_float) + newCashSales + Number(openReg.cash_in || 0) - newCashOut;
        await sb.from("cash_register").update({ cash_sales: newCashSales, cash_out: newCashOut, expected_cash: newExpected }).eq("id", openReg.id);
      }
    }

    // Stock is reduced by the database the moment the sale is saved as
    // completed (trigger apply_sale_stock), once per sale, for every till.

    // Liquor shops: every bottle or crate that leaves the counter is logged as an
    // empty owed back by the customer, so the empties page stays accurate on its own.
    if (isLiquor) {
      const emptyRows: any[] = [];
      for (const item of cart) {
        if ((item as any).is_service) continue;
        const unit = String((item as any).unit_type ?? "unit");
        if (unit === "tot") continue; // a tot leaves no container
        const productId = (item as any).product_id || item.id;
        const baseProduct: any = products.find((p: any) => p.id === productId);
        const perCrate = Number(baseProduct?.units_per_crate ?? 0);
        const crateDeposit = Number(baseProduct?.crate_deposit ?? 0);
        const isCrate = unit === "crate";
        const deposit = isCrate
          ? crateDeposit
          : perCrate > 0 && crateDeposit > 0
            ? Number((crateDeposit / perCrate).toFixed(2))
            : 0;
        emptyRows.push({
          tenant_id: tenant?.id,
          location_id: locationId,
          product_id: productId,
          item_label: item.name,
          container_kind: isCrate ? "crate" : "bottle",
          direction: "out",
          quantity: item.quantity,
          deposit_per_unit: deposit,
          deposit_total: Number((item.quantity * deposit).toFixed(2)),
          customer_id: selectedCustomer?.id ?? null,
          customer_name: selectedCustomer?.name ?? "Walk-in",
          note: `Sale ${txRow.id}`,
          created_by: user?.id ?? null,
        });
      }
      if (emptyRows.length) {
        await sb.from("empties_ledger").insert(emptyRows);
        queryClient.invalidateQueries({ queryKey: ["empties"] });
      }
    }




    const txDisc = Number(txRow.discount);
    const txTot = Number(txRow.total);

    if (selectedCustomer?.id && txDisc > 0) {
      await supabase
        .from("customers")
        .update({ loyalty_points: Math.max(0, selectedCustomer.loyalty_points - txDisc) })
        .eq("id", selectedCustomer.id);
    }

    if (selectedCustomer?.id) {
      const earnedPoints = Math.floor(txTot * 0.2);
      if (earnedPoints > 0) {
        const currentPoints = Math.max(0, selectedCustomer.loyalty_points - txDisc);
        await supabase
          .from("customers")
          .update({ loyalty_points: currentPoints + earnedPoints })
          .eq("id", selectedCustomer.id);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });

    void settleActiveBill(txRow.id, txTotal, txRow.payment_method);

    // Audit: sale created + payment recorded
    logActivity({
      action: "sale_created",
      entity_type: "transaction",
      entity_id: txRow.id,
      description: `Sale ${formatKES(txTotal)} via ${txRow.payment_method}${selectedCustomer?.name ? ` for ${selectedCustomer.name}` : ""}`,
      metadata: { total: txTotal, payment_method: txRow.payment_method, items: saleItems.length, location_id: locationId },
    });
    logActivity({
      action: "payment_added",
      entity_type: "transaction",
      entity_id: txRow.id,
      description: `Payment ${formatKES(txTotal)} (${txRow.payment_method}) recorded`,
      metadata: { amount: txTotal, method: txRow.payment_method },
    });

    // Notify customer-facing display: payment success
    publishDisplay({
      type: "paid",
      shopName: (bizSettings as any)?.business_name || tenant?.business_name || "Welcome",
      logoUrl: tenant?.logo_url || null,
      paymentMethod: txRow.payment_method,
      total: txTotal,
      changeGiven: changeGiven || undefined,
    });

    if (selectedCustomer?.email) {
      const customerEmail = selectedCustomer.email;
      sendReceiptEmail({ email: customerEmail, receipt: receiptData as any })
        .then((result) => {
          if (result.ok) {
            toast({ title: "Receipt emailed", description: `Sent to ${customerEmail}` });
          } else if (result.unavailable) {
            supabase.functions.invoke("send-receipt-email", {
              body: { email: customerEmail, receipt: receiptData },
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }


    setCart([]);
    setSelectedCustomer(null);
    setLoyaltyRedeemPoints(0);
    setCartDiscount(0);
    setCartDiscountType("amount");
    if (changeGiven > 0) {
      setChangeBanner(changeGiven);
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          const beep = (freq: number, start: number, dur: number) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine"; o.frequency.value = freq;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
            g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
            o.start(ctx.currentTime + start);
            o.stop(ctx.currentTime + start + dur + 0.02);
          };
          beep(880, 0, 0.18);
          beep(1320, 0.22, 0.22);
        }
      } catch {}
      setTimeout(() => setChangeBanner(null), 8000);
    }
    toast({
      title: "Sale completed!",
      description: changeGiven > 0 ? `${formatKES(txTot)} paid · Change: ${formatKES(changeGiven)}` : `${formatKES(txTot)} processed.`,
    });
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.log("Fullscreen error:", e);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (isFullscreen) {
      document.body.classList.add("pos-fullscreen");
    } else {
      document.body.classList.remove("pos-fullscreen");
    }
    return () => document.body.classList.remove("pos-fullscreen");
  }, [isFullscreen]);

  const updateLayoutPref = <K extends keyof PosLayoutPrefs>(key: K, value: PosLayoutPrefs[K]) => {
    setLayoutPrefs((prev) => ({ ...prev, [key]: value }));
    setLayoutPrefsSaved(false);
  };

  const saveLayoutPrefs = () => {
    localStorage.setItem(POS_LAYOUT_PREFS_KEY, JSON.stringify(layoutPrefs));
    localStorage.removeItem(LEGACY_POS_LAYOUT_PREFS_KEY);
    setSavedLayoutPrefs(layoutPrefs);
    setLayoutPrefsSaved(true);
    toast({ title: "Layout saved" });
  };

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const completeSale = async (paymentMethod: string, phone?: string, loyaltyOverride?: number, changeGiven = 0, amountPaid?: number) => {
    if (!locationId) {
      toast({ title: "Select a location", variant: "destructive" });
      return;
    }

    if (paymentMethod === "mpesa" && usesDarajaMpesa) {
      if (!mpesaTenantContext.tenant_id && !mpesaTenantContext.tenant_slug) {
        console.error("[POS] M-Pesa blocked: missing tenant context", mpesaTenantContext);
        toast({ title: "M-Pesa unavailable", description: "Open POS from the tenant workspace and try again.", variant: "destructive" });
        return;
      }
    }

    // Refill sizes share their tank: check the litres of the whole cart.
    if (waterTanks.length > 0) {
      const need = litresByTank(cart.map((i: any) => {
        const p: any = products.find((x: any) => x.id === (i.product_id || i.id));
        return { tank_id: p?.tank_id, litres: Number(p?.litres) || null, quantity: i.quantity };
      }));
      for (const [tankId, l] of Object.entries(need)) {
        const tank = waterTanks.find((t) => t.id === tankId);
        if (tank && l > tank.current_l + 1e-6) {
          toast({ title: "Not enough water", description: `${tank.name} has ${tank.current_l} L; this sale needs ${l} L.`, variant: "destructive" });
          return;
        }
      }
    }

    // Final stock validation before completing sale
    for (const item of cart) {
      if ((item as any).is_service) continue;
      const productId = (item as any).product_id || item.id;
      const variantId = (item as any).variant_id;
      const variant = variantId ? (variantMap[productId] || []).find((v) => v.id === variantId) : null;
      if (variantId && !variant) {
        toast({ title: "Stock not ready", description: `Reload ${item.name} and try again.`, variant: "destructive" });
        return;
      }
      const currentProduct = products.find((p: any) => p.id === productId);
      if (!currentProduct) {
        toast({ title: "Stock not ready", description: `Reload ${item.name} and try again.`, variant: "destructive" });
        return;
      }
      const available = Number(variant ? variant.stock : currentProduct?.stock);
      const needed = item.quantity * (variant ? 1 : Number((item as any).stock_per_unit ?? 1));
      if (Number.isFinite(available) && needed > available) {
        toast({ title: "Insufficient stock", description: `Only ${available} ${item.unit || "piece"}(s) available for ${item.name}. Please adjust quantity.`, variant: "destructive" });
        return;
      }
    }

    // Wholesale minimum-quantity enforcement: collect ALL violations and show
    // them in a single pre-checkout dialog so the cashier can fix everything at once.
    const violations: Array<{ name: string; current: number; required: number }> = [];
    for (const item of cart) {
      const minQty = Math.max(1, Number((item as any).wholesale_min_quantity ?? 1));
      const onWholesale = (item as any).price_mode === "wholesale";
      const isWholesaleEnforced = wholesaleMode || onWholesale;
      if (
        isWholesaleEnforced &&
        Boolean((item as any).enable_wholesale) &&
        Number((item as any).wholesale_price ?? 0) > 0 &&
        item.quantity < minQty
      ) {
        violations.push({ name: item.name, current: item.quantity, required: minQty });
      }
    }
    if (violations.length > 0) {
      setWholesaleViolations(violations);
      return;
    }

    // Credit payment validation
    if (paymentMethod === "credit") {
      if (!selectedCustomer) {
        toast({ title: "Customer required", description: "Select a customer to use credit payment.", variant: "destructive" });
        return;
      }
      if (total > creditAvailable) {
        toast({ title: "Credit limit exceeded", description: `Available credit: ${formatKES(creditAvailable)}. Purchase total: ${formatKES(total)}.`, variant: "destructive" });
        return;
      }
    }

    const saleItems = cart.map((i) => ({
      id: i.id,
      product_id: (i as any).product_id || i.id,
      variant_id: (i as any).variant_id ?? null,
      unit_type: (i as any).unit_type ?? "unit",
      name: i.name,
      sku: i.sku,
      price: Number(i.price),
      quantity: i.quantity,
      stock_per_unit: Number((i as any).stock_per_unit ?? 1),
      is_service: Boolean((i as any).is_service),
      vat_rate: Number(i.vat_rate),
      cost_price: Number(i.cost_price),
      price_mode: i.price_mode || "retail",
      retail_price: Number((i as any).retail_price ?? i.price),
      wholesale_price: Number((i as any).wholesale_price ?? 0),
      wholesale_min_quantity: Number((i as any).wholesale_min_quantity ?? 0),
      ...((i as any).litres ? { litres: Number((i as any).litres), tank_id: (i as any).tank_id ?? null } : {}),
    }));

    let finalDiscount = loyaltyOverride !== undefined ? loyaltyOverride : appliedDiscount;
    let finalTotal = Math.max(0, subtotalRaw - finalDiscount);
    // Cash taken at a different amount: less is the discount, more is added to the sale.
    if (amountPaid !== undefined && Number.isFinite(amountPaid) && amountPaid >= 0 && Math.abs(amountPaid - finalTotal) > 0.009) {
      if (amountPaid < finalTotal) finalDiscount = Math.round((finalDiscount + (finalTotal - amountPaid)) * 100) / 100;
      finalTotal = Math.round(amountPaid * 100) / 100;
    }
    const chargeAmount = Math.round(finalTotal * 100) / 100;
    // The till always uses the shop's current gateway; if it is not loaded
    // yet (slow start, new staff account) fetch it before saving the sale.
    let liveBiz: any = bizSettings;
    if (paymentMethod === "mpesa" && navigator.onLine && !liveBiz?.payment_provider) {
      liveBiz = (await refetchBizSettings()).data || liveBiz;
    }
    if (paymentMethod === "mpesa" && navigator.onLine && liveBiz && liveBiz.mpesa_ready === false) {
      toast({
        title: "M-Pesa is not set up yet",
        description: "Ask the company admin to open System → Payment gateways and save the Till, Paybill or bank. Use another payment method for now.",
        variant: "destructive",
      });
      return;
    }
    // An M-Pesa prompt needs the internet; never record an unpaid M-Pesa sale as paid.
    if (paymentMethod === "mpesa" && phone && !navigator.onLine) {
      toast({ title: "You are offline", description: "M-Pesa prompts need the internet. Take cash, or record an M-Pesa payment made to your till under Mobile Money.", variant: "destructive" });
      return;
    }
    if (paymentMethod === "online" && !navigator.onLine) {
      toast({ title: "You are offline", description: "Online payments need the internet. Use cash or record the payment another way.", variant: "destructive" });
      return;
    }
    if (paymentMethod === "mpesa" &&
        (!Number.isInteger(chargeAmount) || chargeAmount < 1 || chargeAmount > 150000)) {
      toast({
        title: "M-Pesa needs whole shillings",
        description: `M-Pesa takes whole shillings from KSh 1 to 150,000. This sale is ${formatKES(chargeAmount)} — adjust the discount or use another payment method.`,
        variant: "destructive",
      });
      return;
    }

    // First-time customers: an M-Pesa number with no customer chosen finds or creates their account.
    let saleCustomer: any = selectedCustomer;
    if (!saleCustomer && phone && navigator.onLine && String(phone).replace(/\D/g, "").length >= 9) {
      try {
        const { data: cid } = await (supabase as any).rpc("customer_find_or_create", { p_phone: phone, p_source: "pos" });
        if (cid) {
          const { data: c } = await (supabase as any).from("customers").select("*").eq("id", cid).maybeSingle();
          if (c) { saleCustomer = c; setSelectedCustomer(c); }
        }
      } catch { /* the sale still goes through as walk-in */ }
    }
    const rep = salesRep || (saleCustomer?.salesperson_id ? { id: saleCustomer.salesperson_id, name: (staffForReps as any[]).find((x) => x.user_id === saleCustomer.salesperson_id)?.display_name || "" } : null);

    const txData: any = {
      sales_rep_id: rep?.id || null,
      sales_rep_name: rep?.name || null,
      ...(paymentMethod === "credit" && creditDue ? { due_date: creditDue } : {}),
      items: saleItems,
      subtotal: subtotalRaw,
      tax,
      discount: finalDiscount,
      total: finalTotal,
      payment_method: paymentMethod === "loyalty" ? "loyalty_points" : paymentMethod,
      customer_id: saleCustomer?.id || null,
      customer_name: saleCustomer?.name || "Walk-in",
      cashier_id: user?.id,
      cashier_name: profile?.display_name || "Unknown",
      status: (paymentMethod === "mpesa" || paymentMethod === "card" || paymentMethod === "online") ? "pending" : "completed",
      location_id: locationId,
      tenant_id: mpesaTenantContext.tenant_id || profile?.tenant_id || null,
      // The database reduces stock for this sale when it completes.
      stock_by_server: true,
    };
    if (paymentMethod === "mpesa" && liveBiz?.payment_provider === "jmsurf") {
      txData.mpesa_ref = "jmsurf:initiating";
    }

    // For split payment, mark as completed immediately
    if (paymentMethod === "split") txData.status = "completed";

    let txRow: any;
    let txInsertPromise: Promise<any> | null = null;
    // Offline: save locally and queue for sync.
    // event_id is the dedup key — when sync replays the queue (e.g. after a
    // tab reload that re-queues the same offline sale), Postgres rejects the
    // second insert with 23505 and useOfflineSync treats it as already-synced.
    const saveOffline = async () => {
      const offlineId = crypto.randomUUID();
      const offlineTx = {
        ...txData,
        id: offlineId,
        event_id: offlineId,
        created_at: new Date().toISOString(),
        status: "completed",
      };
      await saveOfflineTransaction(offlineTx);
      await addToSyncQueue({ table: "transactions", action: "insert", payload: offlineTx });
      // Deduct local stock — allow negative so the sale is never blocked offline.
      for (const item of saleItems) {
        await deductLocalStock(item.id, locationId, item.quantity);
      }
      toast({ title: "Sale saved offline", description: "Will sync when you're back online." });
      return offlineTx;
    };
    if (!navigator.onLine) {
      txRow = await saveOffline();
    } else if (paymentMethod === "mpesa" && phone) {
      // Instant prompt: the sale row is written in the background with a
      // client-generated id so the STK push leaves without waiting a round trip.
      const preId = crypto.randomUUID();
      startingMpesaRef.current = preId;
      txRow = { ...txData, id: preId, created_at: new Date().toISOString() };

      txInsertPromise = Promise.resolve(
        supabase.from("transactions").insert({ ...txData, id: preId }),
      ).then(({ error }: any) => {
        if (error) throw new Error(`Sale could not be saved: ${error.message}`);
      });
    } else {
      let data: any = null, error: any = null;
      try {
        ({ data, error } = await supabase.from("transactions").insert(txData).select().single());
      } catch (e) { error = e; }
      if ((error || !data) && isNetworkError(error) && paymentMethod !== "online") {
        // Connected but no internet: keep selling, the sale syncs later.
        txRow = await saveOffline();
      } else if (error || !data) {
        toast({ title: "Error", description: error?.message || "Failed to save", variant: "destructive" });
        return;
      } else {
        txRow = data;
      }
    }

    // Online gateway: the payment window takes over; the sale completes when the gateway confirms.
    if (paymentMethod === "online") {
      setOnlinePay({ sale: txRow, saleItems, total, discount: appliedDiscount });
      return;
    }

    // Credit payment: update customer balance
    if (paymentMethod === "credit" && saleCustomer) {
      await supabase.from("customers").update({ balance: saleCustomer.balance + total }).eq("id", saleCustomer.id);
      // The debt is tracked as an invoice with its due date (Debts, reminders, statements).
      if (txRow?.id && navigator.onLine) {
        const { error: invErr } = await (supabase as any).rpc("pos_credit_invoice", { p_transaction: txRow.id, p_due: creditDue || null });
        if (invErr) toast({ title: "Sale saved, invoice not created", description: invErr.message, variant: "destructive" });
      }
      setCreditDue("");
    }

    if (paymentMethod === "mpesa" && phone) {
      const provider = liveBiz?.payment_provider;

      if (provider === "jmsurf") {
        setMpesaLoading(true);
        try {
          if (txInsertPromise) await txInsertPromise;
          // The payment server validates the saved sale itself. A second browser
          // read here only delayed the STK request after the insert completed.
          const { data: payment, error } = await jmsurfMpesaPrompt({
            tenant_id: mpesaTenantContext.tenant_id || profile?.tenant_id,
            pos_transaction_id: txRow.id,
            phone,
          });
          if (error || !payment?.success || !payment.checkout_request_id) throw new Error(error || "JMSURF PAY did not confirm the payment prompt");
          startingMpesaRef.current = null;
          if (abandonedMpesaRef.current.has(txRow.id)) return;
          const cartHash = JSON.stringify(cart.map((c) => [c.id, c.quantity])) + `|${total}`;
          setPendingMpesa({ txId: txRow.id, customerId: saleCustomer?.id || null, redeemedPoints: appliedDiscount, startedAt: Date.now(), cartHash, phone, amount: total, customerName: saleCustomer?.name || "Customer" });
          toast({ title: "STK sent", description: "Approve the M-Pesa prompt on the customer's phone." });
        } catch (e: any) {
          toast({ title: "M-Pesa payment needs attention", description: e?.message || "Check this sale before retrying payment.", variant: "destructive" });
        } finally {
          setMpesaLoading(false);
          setShowMpesaInput(false);
          setMpesaPhone("");
        }
        return;
      }

      // If Paystack is the chosen provider, route M-Pesa through Paystack (mobile_money channel)
      if (provider === "paystack") {
        setMpesaLoading(true);
        if (txInsertPromise) await txInsertPromise;
        try {
          const customerEmail = saleCustomer?.email || (bizSettings as any)?.business_email || "customer@jmsurf.co.ke";
          const { data: psData, error: psErr } = await paystackInitialize({
            email: customerEmail,
            transaction_id: txRow.id,
            callback_url: window.location.origin + window.location.pathname,
            channels: ["mobile_money"],
          });
          const realError = psErr || "";

          if (psErr || !psData?.data?.authorization_url) {
            await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id);
            toast({
              title: "Paystack M-Pesa not ready",
              description: realError || "Could not initialize M-Pesa via Paystack. Confirm your Paystack secret key in Settings.",
              variant: "destructive",
            });
            return;
          }

          const psWindow = window.open(psData.data.authorization_url, "_blank", "width=600,height=700");
          // Payment timeline UI removed.
          toast({ title: "Approve on phone", description: "Complete the M-Pesa prompt to finish the sale." });

          const pollInterval = setInterval(async () => {
            const { data: verifyData } = await paystackVerify({ reference: txRow.id });
            if (verifyData?.success) {
              clearInterval(pollInterval);
              psWindow?.close();
              queryClient.invalidateQueries({ queryKey: ["transactions"] });
              queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
              queryClient.invalidateQueries({ queryKey: ["products"] });
              queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });
              setLastReceipt({ ...txRow, items: saleItems, total, discount: appliedDiscount, loyalty_points_earned: 0 });
              setCart([]);
              setSelectedCustomer(null);
              setLoyaltyRedeemPoints(0);
              toast({ title: "Sale completed!", description: "Paystack M-Pesa payment confirmed." });
            }
          }, 4000);
          setTimeout(() => clearInterval(pollInterval), 300_000);
        } catch (e: any) {
          await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id);
          toast({ title: "Paystack failed", description: e?.message || "Could not start M-Pesa via Paystack.", variant: "destructive" });
        } finally {
          setMpesaLoading(false);
          setShowMpesaInput(false);
          setMpesaPhone("");
        }
        return;
      }

      
      // Manual provider — no online M-Pesa available
      if (provider === "manual") {
        if (txInsertPromise) await txInsertPromise;
        toast({
          title: "M-Pesa not configured",
          description: "Manual mode is active. Use Mobile Money to record an off-platform M-Pesa payment, or enable M-Pesa/Paystack in Settings.",
          variant: "destructive",
        });
        await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id);
        setShowMpesaInput(false);
        setMpesaPhone("");
        return;
      }

      // Direct Daraja (tenant's own Safaricom app) goes directly to their Paybill/Till.
      // Platform M-Pesa uses the registered direct merchant channel so funds land
      // straight in the merchant Till while the prompt label is forced to JMSURF.
      const useDirectDaraja = provider === "daraja";

      setMpesaLoading(true);
      try {
        const useFn: string = useDirectDaraja ? "mpesa-stk-push" : "payhero-stk-push";
        const body = useDirectDaraja
          ? {
              phone,
              amount: total,
              tenant_slug: mpesaTenantContext.tenant_slug,
              tenant_id: mpesaTenantContext.tenant_id,
              transaction_id: txRow.id,
              account_ref: ((bizSettings as any)?.mpesa_account_reference || (bizSettings as any)?.business_name || mpesaTenantContext.tenant_slug || "POS").slice(0, 12),
            }
          : {
              phone,
              amount: total,
              tenant_id: mpesaTenantContext.tenant_id,
              tenant_slug: mpesaTenantContext.tenant_slug,
              pos_transaction_id: txRow.id,
              account_ref: ((bizSettings as any)?.mpesa_account_reference || mpesaTenantContext.tenant_slug || "JMSURF").slice(0, 12),
              prompt_label: "jmsurf",
            };
        console.info(`[POS] ${useFn} request`, { ...body, phone: phone ? "[entered]" : "" });
        // Card/M-Pesa collection runs on the app's own server so it is always
        // up to date; direct Daraja shops keep using their own backend route.
        if (txInsertPromise) await txInsertPromise;
        const { data: stkData, error: stkErr } = useDirectDaraja
          ? await darajaMpesaPrompt(body)
          : await posMpesaPrompt(body);

        const checkoutId = (stkData as any)?.checkout_request_id || (stkData as any)?.CheckoutRequestID;
        const accepted = !stkErr && (stkData as any)?.success === true && !!checkoutId;

        if (!accepted) {
          if ((stkData as any)?.prompt_sent === false) {
            await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id).eq("status", "pending");
          }
          const rawMsg = String(
            stkErr || (stkData as any)?.error || (stkData as any)?.errorMessage || (stkData as any)?.message || "",
          );
          const lower = String(rawMsg).toLowerCase();
          let friendly = rawMsg || "M-Pesa payment couldn't be sent. Please try again.";
          if (lower.includes("merchant not found")) {
            friendly = "The platform M-Pesa merchant was rejected. Contact support to confirm the JMSURF shortcode.";
          } else if (lower.includes("till") || lower.includes("paybill") || lower.includes("channel")) {
            friendly = "Your Till/Paybill number is not set. Open System → Payment gateways and save it.";
          } else if (lower.includes("credentials")) {
            friendly = useDirectDaraja
              ? "M-Pesa keys are not configured. Open System → Payment gateways and confirm the Daraja credentials."
              : "Platform M-Pesa is not configured. Contact support: 0712 504 593.";
          } else if (lower.includes("invalid") && lower.includes("phone")) {
            friendly = "The phone number looks invalid. Use 07XXXXXXXX or 2547XXXXXXXX.";
          } else if (lower.includes("insufficient")) {
            friendly = "Customer's M-Pesa balance is too low.";
          }
          toast({ title: "M-Pesa not ready", description: friendly, variant: "destructive" });
          return;
        }

        // The server already saved the M-Pesa reference on the sale.
        // Cashier already pressed Cancel while the prompt was going out.
        if (abandonedMpesaRef.current.has(txRow.id)) {
          return;
        }
        startingMpesaRef.current = null;
        const cartHash = JSON.stringify(cart.map((c) => [c.id, c.quantity])) + `|${total}`;
        setPendingMpesa({ txId: txRow.id, customerId: saleCustomer?.id || null, redeemedPoints: appliedDiscount, startedAt: Date.now(), cartHash, phone, amount: total, customerName: saleCustomer?.name || "Customer" });
        toast({ title: "STK sent", description: "Approve payment on phone to complete sale." });

      } catch (e: any) {
        const friendly = e?.message || "Could not confirm whether M-Pesa received the request. Check this sale before charging again.";
        toast({ title: "M-Pesa not ready", description: friendly, variant: "destructive" });
      } finally {
        setMpesaLoading(false);
        setShowMpesaInput(false);
        setMpesaPhone("");
      }
      return;
    }

    
    if (paymentMethod === "card" && (bizSettings as any)?.payment_provider === "paystack") {
      setPaystackLoading(true);
      try {
        const customerEmail = saleCustomer?.email || (bizSettings as any)?.business_email || "customer@jmsurf.co.ke";
        const { data: psData, error: psErr } = await paystackInitialize({
          email: customerEmail,
          transaction_id: txRow.id,
          callback_url: window.location.origin + window.location.pathname,
        });
        const realError = psErr || "";

        if (psErr || !psData?.data?.authorization_url) {
          await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id);
          toast({
            title: "Paystack not ready",
            description: realError || "Could not initialize payment. Check System → Payment gateways → Paystack and confirm your secret key (sk_live_… or sk_test_…) is saved.",
            variant: "destructive",
          });
          return;
        }

        const paystackWindow = window.open(psData.data.authorization_url, "_blank", "width=600,height=700");

        const pollInterval = setInterval(async () => {
          const { data: verifyData } = await paystackVerify({ reference: txRow.id });

          if (verifyData?.success) {
            clearInterval(pollInterval);
            paystackWindow?.close();
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });
            setLastReceipt({ ...txRow, items: saleItems, total, discount: appliedDiscount, loyalty_points_earned: 0 });
            setCart([]);
            setSelectedCustomer(null);
            setLoyaltyRedeemPoints(0);
            toast({ title: "Sale completed!", description: "Paystack payment confirmed." });
          }
        }, 4000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setPaystackLoading(false);
        }, 300_000);
      } catch (e: any) {
        await supabase.from("transactions").update({ status: "failed" }).eq("id", txRow.id);
        toast({ title: "Payment failed", description: e.message, variant: "destructive" });
      } finally {
        setPaystackLoading(false);
      }
      return;
    }

    // For card without paystack or cash/credit
    if (paymentMethod === "card") {
      const ref = pdqRefRef.current.trim();
      pdqRefRef.current = "";
      await supabase.from("transactions").update({ status: "completed", ...(ref ? { mpesa_ref: `PDQ:${ref}`.slice(0, 60) } : {}) }).eq("id", txRow.id);
    }

    await finalizeImmediateSale(txRow, saleItems, changeGiven);
  };

  if (productsLoading) {
    return (
      <div className="flex gap-4 h-[calc(100svh-6.5rem)]">
        <div className="flex-1 space-y-3">
          <div className="h-12 rounded-2xl bg-muted animate-pulse" />
          <div className="h-8 w-2/3 rounded-full bg-muted animate-pulse" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {Array.from({ length: 18 }).map((_, i) => <div key={i} className="aspect-[4/5] rounded-2xl bg-muted animate-pulse" />)}
          </div>
        </div>
        <div className="hidden md:block w-80 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  // How many of each product are already in the cart (shown on its card).
  const cartQtyByProduct: Record<string, number> = {};
  cart.forEach((i: any) => {
    const pid = i.product_id || i.id;
    cartQtyByProduct[pid] = (cartQtyByProduct[pid] || 0) + Number(i.quantity || 0);
  });
  const cartItemCount = cart.reduce((n, i) => n + Number(i.quantity || 0), 0);

  const autoCardSize: Exclude<PosCardSize, "auto"> = viewportWidth < 640 ? "compact" : viewportWidth < 1180 ? "standard" : "comfortable";
  const autoCartWidth: Exclude<PosCartWidth, "auto"> = viewportWidth < 1024 ? "standard" : viewportWidth < 1280 ? "compact" : "wide";
  const effectiveCardSize = layoutPrefs.cardSize === "auto" ? autoCardSize : layoutPrefs.cardSize;
  const effectiveCartWidth = layoutPrefs.cartWidth === "auto" ? autoCartWidth : layoutPrefs.cartWidth;
  const layoutChanges = [
    layoutPrefs.cardSize !== savedLayoutPrefs.cardSize ? `Cards: ${savedLayoutPrefs.cardSize} → ${layoutPrefs.cardSize}` : null,
    layoutPrefs.cartWidth !== savedLayoutPrefs.cartWidth ? `Cart: ${savedLayoutPrefs.cartWidth} → ${layoutPrefs.cartWidth}` : null,
    layoutPrefs.cartHeight !== savedLayoutPrefs.cartHeight ? `Height: ${savedLayoutPrefs.cartHeight} → ${layoutPrefs.cartHeight}` : null,
  ].filter(Boolean);
  // Use auto-fill so product cards keep a fixed minimum width and the cart
  // (not the cards) absorbs horizontal space when the viewport shrinks.
  const productGridClass = {
    compact: "grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-1.5 sm:gap-2",
    standard: "grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2",
    comfortable: "grid-cols-[repeat(auto-fill,minmax(135px,1fr))] gap-2.5",
  }[effectiveCardSize];
  const productBodyClass = effectiveCardSize === "compact" ? "px-2 py-1.5" : effectiveCardSize === "comfortable" ? "px-3 py-2" : "px-2.5 py-1.5";
  const productNameClass = effectiveCardSize === "compact" ? "text-xs" : effectiveCardSize === "comfortable" ? "text-base" : "text-sm";
  const productPriceClass = effectiveCardSize === "compact" ? "text-[13px]" : effectiveCardSize === "comfortable" ? "text-base" : "text-sm";
  // Narrower cart on tablet/laptop so product cards keep their size.
  const cartWidthClass = {
    compact: "md:w-[13.5rem] lg:w-[14.25rem] xl:w-[16.5rem]",
    standard: "md:w-[14.25rem] lg:w-[15.75rem] xl:w-[19.5rem]",
    wide: "md:w-[15rem] lg:w-[18rem] xl:w-[22.5rem]",
  }[effectiveCartWidth];
  const cartHeightClass = {
    compact: "max-h-[38svh] sm:max-h-[42svh] md:max-h-none",
    balanced: "max-h-[48svh] sm:max-h-[52svh] md:max-h-none",
    expanded: "max-h-[58svh] sm:max-h-[62svh] md:max-h-none",
  }[layoutPrefs.cartHeight];

  return (
    <div className="pos-shell flex flex-col md:flex-row gap-3 md:gap-3 lg:gap-4 h-[calc(100svh-8.85rem)] md:h-[calc(100svh-8.6rem)] lg:h-[calc(100svh-8.6rem)] xl:h-[calc(100svh-5.6rem)] min-h-0 relative -mb-10 md:-mb-4 lg:-mb-6 pb-[env(safe-area-inset-bottom,0px)]">
      {/* Bottom-flush wrapper: svh + negative bottom margin + safe-area padding pin the POS to the screen edge on desktop, tablet and mobile. */}
      {changeBanner !== null && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-success text-success-foreground px-6 py-3 rounded-xl shadow-2xl border-2 border-success-foreground/20 flex items-center gap-3 animate-in slide-in-from-top-4 fade-in">
          <Banknote className="w-6 h-6" />
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">Change Due</div>
            <div className="font-display font-bold text-2xl leading-tight">{formatKES(changeBanner)}</div>
          </div>
          <button onClick={() => setChangeBanner(null)} className="ml-2 p-1 rounded hover:bg-white/20"><X className="w-4 h-4" /></button>
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="Search products or scan a barcode"
              className="w-full h-12 pl-12 pr-4 rounded-2xl bg-card border border-input text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            />
            {showSuggest && search.trim() !== "" && (
              <div className="absolute z-40 top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-card shadow-xl divide-y divide-border">
                {searchSuggestions.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No matching product.</p>
                ) : (
                  searchSuggestions.map((s: any) => (
                    <button
                      key={s.key}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (s.variant) addVariantToCart(s.product, s.variant);
                        else handleProductTap(s.product);
                        setSearch("");
                        setShowSuggest(false);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{s.label}</span>
                      <span className="shrink-0 flex items-center gap-3">
                        {!s.isService && (
                          <span className={cn(
                            "text-base font-bold",
                            s.stock <= 0 ? "text-destructive" : "text-foreground"
                          )}>
                            {s.stock <= 0 ? "Out of stock" : `${s.stock} left`}
                          </span>
                        )}
                        <span className="font-semibold text-primary text-sm">{formatKES(Number(s.price))}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {userLocations.length > 1 && (
            <div className="relative sm:w-52">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full h-11 pl-10 pr-3 rounded-lg bg-card border border-input text-sm appearance-none">
                {userLocations.map((ul) => {
                  const loc = locations.find((l) => l.id === ul.location_id);
                  if (!loc) return null;
                  return <option key={loc.id} value={loc.id}>{loc.name}</option>;
                })}
              </select>
            </div>
          )}
        </div>




        <div className="mb-3">
          <CategoryStrip
            active={category}
            onChange={setCategory}
            hideSearch
            items={categories.map((c: string) => ({ value: c, label: c }))}
            leading={
              <>
                {shopType !== "water" && <button
                  onClick={() => { setWholesaleMode((v) => !v); setShowServices(false); setCategory("All"); }}
                  className={cn(
                    "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1 shrink-0 border",
                    wholesaleMode
                      ? "bg-warning text-warning-foreground border-warning"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent"
                  )}
                  title="Show only wholesale-enabled products"
                >
                  {wholesaleMode ? "● Wholesale" : "Wholesale"}
                </button>}
                <button onClick={() => { setShowServices(false); setWholesaleMode(false); setCategory("All"); }} className={cn("px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap shrink-0 border", !showServices && !wholesaleMode ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent")}>Products</button>
                <button onClick={() => { setShowServices(true); setWholesaleMode(false); setCategory("All"); }} className={cn("px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap shrink-0 border flex items-center gap-1", showServices ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent")}><Wrench className="w-3 h-3" />Services</button>
              </>
            }
          />
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className={cn("grid", productGridClass)}>
            {pagedProducts.map((product: any) => {
              // Sized/coloured items keep their stock on each variant row, so the
              // tile must add the variants up. One colour in stock = sellable.
              const variantRows = variantMap[product.id] || [];
              const effectiveStock = variantRows.length > 0
                ? variantRows.reduce((s: number, v: any) => s + Number(v.stock ?? 0), 0)
                : Number(product.stock ?? 0);
              const outOfStock = !product.is_service && effectiveStock <= 0;
              const lowStock = !product.is_service && !outOfStock && effectiveStock <= (product.reorder_level ?? 0);
              const stockTone = outOfStock
                ? "bg-destructive/10 text-destructive"
                : lowStock
                  ? "bg-warning/15 text-warning"
                  : "bg-success/10 text-success";
              const stockLabel = outOfStock ? "Out" : lowStock ? `Low · ${effectiveStock}` : `${effectiveStock}`;
              return (
                <button
                  key={product.id}
                  onClick={() => handleProductTap(product)}
                  disabled={!!pendingMpesa}
                  aria-label={`Add ${product.name} to cart`}
                  className={cn(
                    "group relative flex flex-col rounded-2xl bg-card text-left overflow-hidden",
                    "border shadow-sm",
                    cartQtyByProduct[product.id] ? "border-primary ring-2 ring-primary/20" : "border-border",
                    "transition-all duration-200 hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl hover:shadow-primary/10 active:translate-y-0 active:scale-[0.98]",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    (outOfStock || pendingMpesa) && "opacity-50 pointer-events-none"
                  )}
                >
                  {/* Image area: 4:3 box. object-cover fills the card edge-to-edge
                      with no empty side bands. Tap the magnify button to open a
                      full uncropped preview. */}
                  <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-muted/60 to-muted/20 flex items-center justify-center overflow-hidden">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : Number(product.litres) > 0 || Number(product.container_litres) > 0 ? (
                      <span className="flex flex-col items-center gap-0.5 text-sky-500/80 select-none">
                        <Droplet className="w-8 h-8" fill="currentColor" fillOpacity={Number(product.litres) > 0 ? 0.25 : 0} />
                        <span className="font-display text-lg font-bold">{formatLitres(Number(product.litres) || Number(product.container_litres))}</span>
                      </span>
                    ) : (
                      <span className="font-display text-2xl font-bold text-muted-foreground/40 select-none">{String(product.name || "?").trim().slice(0, 2).toUpperCase()}</span>
                    )}
                    {product.image_url && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setPreviewProduct({ name: product.name, image_url: product.image_url }); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setPreviewProduct({ name: product.name, image_url: product.image_url }); } }}
                        aria-label={`Preview ${product.name}`}
                        className="absolute bottom-1.5 left-1.5 p-1 rounded-md bg-background/85 hover:bg-background text-foreground shadow-sm border border-border/60 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {!product.is_service && (
                      <span className={cn("absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background/90 shadow-sm backdrop-blur-sm", stockTone)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", outOfStock ? "bg-destructive" : lowStock ? "bg-warning" : "bg-success")} />
                        {stockLabel}
                      </span>
                    )}
                    {product.is_service && (
                      <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                        Service
                      </span>
                    )}
                    {cartQtyByProduct[product.id] > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow-md">
                        ×{cartQtyByProduct[product.id]}
                      </span>
                    )}
                  </div>
                  {/* Body: name (1-2 lines) + price pinned to bottom for
                      consistent alignment across cards. Reduced min-height
                      keeps card shorter overall. */}
                  <div className={cn("flex-1 flex flex-col gap-1.5", productBodyClass)}>
                    <p className={cn("font-semibold leading-snug line-clamp-2 text-foreground min-h-[2.4em]", productNameClass)}>{product.name}</p>
                    <div className="mt-auto min-w-0">
                      <span className={cn("block whitespace-nowrap overflow-hidden text-ellipsis font-display font-bold leading-none tracking-tight text-primary", productPriceClass)}>
                        {Number.isInteger(Number(product.price)) ? formatKESWhole(Number(product.price)) : formatKES(Number(product.price))}
                        {!product.is_service && product.unit && <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">/{product.unit}</span>}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <Pagination
          total={filteredProducts.length}
          page={posPage}
          pageSize={posPageSize}
          onPageChange={setPosPage}
          onPageSizeChange={setPosPageSize}
          itemLabel="products"
          className="mt-2 rounded-lg border border-border bg-card"
        />
      </div>

      <div className={cn(
        "shrink-0 flex-col bg-card border border-border overflow-hidden shadow-sm",
        "hidden md:flex md:h-full md:rounded-2xl",
        mobileCartOpen
          ? "!flex fixed top-0 right-0 bottom-0 z-50 w-[92vw] max-w-md !max-h-none rounded-l-2xl shadow-2xl translate-x-0 transition-transform duration-300"
          : "md:translate-x-0",
        cartWidthClass,
        cartHeightClass
      )}>
        {/* Mobile drawer header */}
        <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
          <span className="text-sm font-display font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Cart ({cart.reduce((s, i) => s + i.quantity, 0)})</span>
          <button onClick={() => setMobileCartOpen(false)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border gap-1 shrink-0">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            Current sale
            {cartItemCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold">{cartItemCount}</span>}
          </h2>
          <div className="flex items-center gap-1">
            <Link to={tenantPath((tenant as any)?.slug, "/sales/returns")} title="Returns & exchanges"
              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground">
              <Undo2 className="w-3.5 h-3.5" /> Returns
            </Link>
            {heldSales.length > 0 && (
              <button onClick={() => setShowHeldSales(true)} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20">
                <Pause className="w-3 h-3" /> {heldSales.length}
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="flex items-center justify-center p-2 rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen mode"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen mode"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <CustomerDisplayLauncher sessionId={displaySessionId} iconOnly />
            <button
              onClick={() => setShowCashRegister(true)}
              className="flex items-center justify-center p-2 rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted"
              title="Cash register"
              aria-label="Open cash register"
            >
              <DollarSign className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEndOfDay(true)}
              className="flex items-center justify-center p-2 rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted"
              title="End of day summary"
              aria-label="Open end of day summary"
            >
              <ClipboardList className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border bg-muted/30 px-3 py-2.5">
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sales rep</span>
            <select
              value={salesRep?.id || ""}
              onChange={(e) => { const r = repChoices.find((x) => x.id === e.target.value); setSalesRep(r ? { id: r.id, name: r.name } : null); }}
              aria-label="Sales rep"
              disabled={!!pendingMpesa}
              className="h-10 w-full truncate rounded-xl border border-input bg-card px-2.5 text-sm font-medium"
            >
              <option value="">No rep</option>
              {repChoices.map((r) => <option key={r.id} value={r.id}>{r.name}{r.id === user?.id ? " (you)" : ""}</option>)}
            </select>
          </label>
          <div className="min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</span>
            {customersOn ? (
              <button onClick={() => !pendingMpesa && setShowCustomerPicker(true)} disabled={!!pendingMpesa}
                className={cn("flex h-10 w-full items-center gap-2 rounded-xl border px-2.5 text-left text-sm font-semibold transition-colors disabled:opacity-50",
                  selectedCustomer ? "border-primary/40 bg-primary/5 text-primary" : "border-input bg-card hover:border-primary/50")}>
                <User className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{selectedCustomer ? selectedCustomer.name : "Walk-in customer"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
              </button>
            ) : <p className="flex h-10 items-center rounded-xl border border-input bg-card px-2.5 text-sm">Walk-in customer</p>}
          </div>
        </div>

        {activeBill && (
          <div className="px-4 py-2.5 text-xs bg-primary/10 text-primary border-b border-primary/20 flex items-center justify-between gap-2">
            <span className="font-semibold truncate">Tab: {activeBill.label}</span>
            <button
              onClick={() => { setActiveBill(null); setCart([]); }}
              className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-[10px] font-medium"
            >
              Close without paying
            </button>
          </div>
        )}

        {pendingMpesa && (
          <div className="px-4 py-3 text-xs bg-warning/10 text-warning border-b border-warning/20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Orb state="listening" size={20} label="Waiting for M-Pesa" />
              <span>Waiting for M-Pesa confirmation...</span>
            </div>
            <button onClick={cancelPendingMpesa} className="px-2 py-1 rounded bg-destructive text-destructive-foreground text-[10px] font-medium hover:opacity-90">
              Cancel
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 py-8">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center"><ShoppingCart className="w-6 h-6" /></div>
              <p className="text-sm font-medium text-foreground">No items yet</p>
              <p className="text-xs">Tap a product or scan a barcode to start a sale.</p>
            </div>
          )}
          {cart.map((item) => (
            <div key={item.id} className="py-2.5 border-b border-border last:border-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <div className="flex-1 min-w-[9rem]">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{item.name}</p>
                    {item.price_mode === "wholesale" && (
                      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold shrink-0">Wholesale</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <button onClick={() => updateQuantity(item.id, -1)} disabled={!!pendingMpesa} className="w-9 h-9 sm:w-8 sm:h-8 rounded-md bg-secondary flex items-center justify-center disabled:opacity-40"><Minus className="w-4 h-4" /></button>
                  <input
                    type="number" min="1" value={item.quantity} disabled={!!pendingMpesa}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (isNaN(val) || val < 1) return;
                      setItemQuantity(item.id, val);
                    }}
                    className="w-12 sm:w-11 h-9 sm:h-8 text-center text-sm font-semibold bg-transparent border border-input rounded-md py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-40"
                  />
                  <button onClick={() => updateQuantity(item.id, 1)} disabled={!!pendingMpesa} className="w-9 h-9 sm:w-8 sm:h-8 rounded-md bg-secondary flex items-center justify-center disabled:opacity-40"><Plus className="w-4 h-4" /></button>
                </div>
                <p className="text-sm font-bold w-20 sm:w-24 text-right">{formatKES(Math.max(0, safeNum(item.price) - safeNum((item as any).discount)) * safeNum(item.quantity, 1))}</p>
                <button onClick={() => removeItem(item.id)} disabled={!!pendingMpesa} className="text-destructive disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}

          {selectedCustomer && creditEligible && (
            <div className="rounded-lg border border-border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">Credit limit: {formatKES(selectedCustomer!.credit_limit)}</p>
              <p className="text-xs text-muted-foreground">Balance owed: {formatKES(selectedCustomer!.balance)}</p>
              <p className={cn("text-xs font-medium", canPayCredit ? "text-success" : "text-destructive")}>
                Available credit: {formatKES(creditAvailable)}
              </p>
              <label className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">If on credit, due on</span>
                <input type="date" value={creditDue} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCreditDue(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-card px-2 text-xs" aria-label="Credit due date" />
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 space-y-1.5 bg-muted/30 shrink-0">
          {vatEnabled && tax > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">VAT (incl.)</span><span>{formatKES(tax)}</span></div>}
          {isLiquor && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {cart.length > 0 && !activeBill && (
                <button
                  onClick={() => setShowTabPicker(true)}
                  disabled={!!pendingMpesa}
                  className="h-8 px-3 rounded-md border border-input bg-card text-xs font-medium hover:bg-muted disabled:opacity-40"
                >
                  Send to tab
                </button>
              )}
              {activeBill && (
                <button
                  onClick={saveCartToActiveBill}
                  disabled={!!pendingMpesa}
                  className="h-8 px-3 rounded-md border border-input bg-card text-xs font-medium hover:bg-muted disabled:opacity-40 max-w-[55%] truncate"
                >
                  Save back to {activeBill.label}
                </button>
              )}
              <button
                onClick={() => setShowTabList(true)}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold ml-auto"
              >
                Open tabs ({openBillList.length})
              </button>
            </div>
          )}
          {totalDiscounts > 0 && (
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Discount</span><span className="text-success">-{formatKES(totalDiscounts)}</span></div>
          )}
          <div className="flex items-end justify-between pt-1">
            <div>
              <p className="text-xs text-muted-foreground">Total{cartItemCount > 0 ? ` · ${cartItemCount} item${cartItemCount === 1 ? "" : "s"}` : ""}</p>
            </div>
            <span className="text-2xl font-display font-bold text-primary tracking-tight">{formatKES(total)}</span>
          </div>
        </div>

        {/* Hold / Cancel / Credit Note buttons */}
        <div className="px-3 pb-1.5 flex gap-1.5 shrink-0">
          <button disabled={cart.length === 0 || !!pendingMpesa} onClick={() => {
            const held: HeldSale = {
              id: crypto.randomUUID(),
              cart: [...cart],
              customer: selectedCustomer,
              loyaltyRedeemPoints,
              heldAt: new Date().toISOString(),
              label: selectedCustomer?.name || `Sale #${heldSales.length + 1}`,
            };
            const updated = [...heldSales, held];
            setHeldSales(updated);
            localStorage.setItem("held_sales", JSON.stringify(updated));
            setCart([]);
            setSelectedCustomer(null);
            setLoyaltyRedeemPoints(0);
            toast({ title: "Sale held", description: `Parked as "${held.label}"` });
          }}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-warning/10 text-warning border border-warning/20 text-[10px] font-medium hover:bg-warning/20 disabled:opacity-40">
            <Pause className="w-3 h-3" /> Hold
          </button>
          <button disabled={cart.length === 0 || !!pendingMpesa} onClick={() => { setCart([]); setSelectedCustomer(null); setLoyaltyRedeemPoints(0); setCartDiscount(0); setCartDiscountType("amount"); toast({ title: "Sale cancelled" }); }}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 text-[10px] font-medium hover:bg-destructive/20 disabled:opacity-40">
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>

        <div className="px-3 pb-3 grid grid-cols-2 gap-1.5 shrink-0">
          <button
            disabled={cart.length === 0 || mpesaLoading || paystackLoading || !!pendingMpesa}
            onClick={() => {
              // When Paystack is the active provider, skip the in-app phone modal and go
              // straight to Paystack's hosted checkout (it collects the M-Pesa phone there).
              // This prevents the double phone-entry UX.
              if ((bizSettings as any)?.payment_provider === "paystack") {
                completeSale("card");
              } else {
                setShowMpesaInput(true);
              }
            }}
            className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-success text-success-foreground font-semibold text-sm shadow-sm hover:opacity-90 disabled:opacity-40">
            <Smartphone className="w-4 h-4" />
            M-PESA
          </button>
          <button disabled={cart.length === 0 || !!pendingMpesa} onClick={() => setPendingConfirm({ method: "cash" })}
            className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-info text-info-foreground font-semibold text-sm shadow-sm hover:opacity-90 disabled:opacity-40">
            <Banknote className="w-4 h-4" /> Cash
          </button>
          <button
            disabled={cart.length === 0 || !!pendingMpesa}
            onClick={() => setPendingConfirm({ method: "mobile_money" })}
            title="Customer paid directly to your bank/till — record manually"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-warning text-warning-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40">
            <Phone className="w-4 h-4" /> Mobile Money
          </button>
          <button
            disabled={cart.length === 0 || !!pendingMpesa}
            onClick={() => setPendingConfirm({ method: "bank_transfer" })}
            title="Customer paid by bank transfer"
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-input bg-card text-foreground font-medium text-xs hover:bg-muted disabled:opacity-40">
            <Banknote className="w-4 h-4" /> Bank
          </button>
          {customersOn && <button
            disabled={cart.length === 0 || !!pendingMpesa || !canPayCredit || !creditEligible}
            onClick={() => setPendingConfirm({ method: "credit" })}
            title={
              !selectedCustomer
                ? "Select a customer with a credit limit"
                : !creditEligible
                ? "No credit limit set"
                : !canPayCredit
                ? `Exceeded. Available: ${formatKES(creditAvailable)}`
                : "Pay on credit"
            }
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-accent-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40">
            <Wallet className="w-4 h-4" /> Credit
          </button>}
          {(bizSettings as any)?.payment_provider !== "paystack" && (
            <button disabled={cart.length === 0 || !!pendingMpesa} onClick={() => { setPdqRef(""); setPdqOpen(true); }} title="Card paid on the PDQ machine"
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40">
              <CreditCard className="w-4 h-4" /> Card (PDQ)
            </button>
          )}
          {(bizSettings as any)?.payment_provider === "paystack" && (
            <button disabled={cart.length === 0 || !!pendingMpesa || paystackLoading} onClick={() => completeSale("card")}
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40">
              <CreditCard className="w-4 h-4" /> {paystackLoading ? "Processing..." : "Card"}
            </button>
          )}
          {onlineOn && (
            <button disabled={cart.length === 0 || !!pendingMpesa || !!onlinePay} onClick={() => completeSale("online")}
              title="Card, mobile money or wallet through your online gateways"
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40">
              <Globe2 className="w-4 h-4" /> Online
            </button>
          )}
          <button disabled={cart.length === 0 || !!pendingMpesa} onClick={() => setShowSplitPayment(true)}
            className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-40 border border-border">
            <Split className="w-4 h-4" /> Split Payment
          </button>
        </div>
      </div>

      {/* Mobile floating cart FAB */}
      {!mobileCartOpen && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-[104px] right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-primary-foreground shadow-2xl border border-primary-foreground/10 hover:opacity-90 active:scale-95 transition"
          aria-label="Open cart"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-sm font-semibold">{cart.reduce((s, i) => s + i.quantity, 0)}</span>
          {cart.length > 0 && <span className="text-xs opacity-80">· {formatKES(total)}</span>}
        </button>
      )}

      {/* Mobile cart drawer backdrop */}
      {mobileCartOpen && (
        <div onClick={() => setMobileCartOpen(false)} className="md:hidden fixed inset-0 bg-foreground/40 z-40" />
      )}

      {pdqOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={() => setPdqOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><CreditCard className="h-5 w-5 text-primary" /> Card payment</h2><button onClick={() => setPdqOpen(false)} className="rounded-lg p-1 hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button></div>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Key <b className="text-foreground">{formatKES(total)}</b> into the card machine and let the customer tap, insert or swipe.</li>
              <li>When the machine prints <b className="text-foreground">APPROVED</b>, enter its approval (auth) code below.</li>
            </ol>
            <input autoFocus value={pdqRef} onChange={(e) => setPdqRef(e.target.value.toUpperCase())} placeholder="Approval code, e.g. 123456" className="fi mb-3 font-mono" />
            <button disabled={!pdqRef.trim()} onClick={() => { pdqRefRef.current = pdqRef; setPdqOpen(false); void completeSale("card"); }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"><Check className="h-4 w-4" /> Card approved, complete sale</button>
            <p className="mt-3 text-xs text-muted-foreground">Declined? Close this and take another payment method. Card sales show as “Card” in Sales History and the end-of-day report, with the approval code for reconciling with the bank.</p>
          </div>
        </div>
      )}

      {showCustomerPicker && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowCustomerPicker(false)}>
          <div className="bg-card rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold">Customer</h2>
              <button onClick={() => setShowCustomerPicker(false)} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search name or phone…" className="fi mb-3" autoFocus />
            <button onClick={() => { setSelectedCustomer(null); setLoyaltyRedeemPoints(0); setShowCustomerPicker(false); }}
              className={cn("mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left", !selectedCustomer ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"><User className="h-4 w-4" /></span>
              <span className="flex-1"><span className="block text-sm font-semibold">Walk-in customer</span><span className="block text-xs text-muted-foreground">No account, paid now</span></span>
              {!selectedCustomer && <Check className="h-4 w-4 text-primary" />}
            </button>
            {quickCust ? (
              <div className="mb-3 space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm font-semibold">New customer</p>
                <input className="fi" placeholder="Name" value={quickCust.name} onChange={(e) => setQuickCust({ ...quickCust, name: e.target.value })} />
                <input className="fi" placeholder="Phone (07XXXXXXXX)" inputMode="tel" value={quickCust.phone} onChange={(e) => setQuickCust({ ...quickCust, phone: e.target.value })} />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setQuickCust(null)} className="rounded-full border border-input px-3 py-1.5 text-sm">Cancel</button>
                  <button
                    onClick={async () => {
                      if (quickCust.phone.replace(/\D/g, "").length < 9) { toast({ title: "Enter the customer's phone number", variant: "destructive" }); return; }
                      const { data: cid, error } = await (supabase as any).rpc("customer_find_or_create", { p_phone: quickCust.phone, p_name: quickCust.name, p_source: "pos" });
                      if (error) { toast({ title: "Customer not saved", description: error.message, variant: "destructive" }); return; }
                      const { data: c } = await (supabase as any).from("customers").select("*").eq("id", cid).maybeSingle();
                      if (c) { setSelectedCustomer(c); setLoyaltyRedeemPoints(0); }
                      setQuickCust(null); setCustSearch(""); setShowCustomerPicker(false);
                    }}
                    className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Save & select</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setQuickCust({ name: "", phone: /^[0-9+ ]{6,}$/.test(custSearch.trim()) ? custSearch.trim() : "" })}
                className="mb-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/40 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
                <Plus className="h-4 w-4" /> Create a new customer
              </button>
            )}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {customers.filter((c: any) => { const q = custSearch.trim().toLowerCase(); return !q || `${c.name} ${c.phone || ""}`.toLowerCase().includes(q) || String(c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~"); }).slice(0, 200).map((c) => (
                <button key={c.id} onClick={() => { setSelectedCustomer(c); setLoyaltyRedeemPoints(0); setShowCustomerPicker(false); }} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted text-left">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{c.name.charAt(0)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.phone}</p>
                  </div>
                  {c.credit_limit > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground">Credit: {formatKES(c.credit_limit - c.balance)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showMpesaInput && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowMpesaInput(false)}>
          <div className="bg-card rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold">M-Pesa Payment</h2>
              <button onClick={() => setShowMpesaInput(false)} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">Enter customer's M-Pesa phone number</p>
            <input
              type="tel"
              autoFocus
              placeholder="Enter phone number"
              value={mpesaPhone}
              onChange={(e) => setMpesaPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && mpesaPhone && !mpesaLoading) {
                  e.preventDefault();
                  startMpesaPayment();
                }
              }}
              className="w-full px-4 py-3 rounded-lg bg-muted border border-input text-sm mb-3"
            />
            <button
              disabled={!mpesaPhone || mpesaLoading}
              onClick={startMpesaPayment}
              className="w-full py-3 rounded-xl bg-success text-success-foreground font-medium text-sm hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Pay
            </button>
          </div>
        </div>
      )}

      <MpesaProcessingOverlay
        open={!!pendingMpesa || mpesaLoading || !!mpesaOutcome}
        state={mpesaOutcome ? mpesaOutcome.state : "processing"}
        title={mpesaOutcome ? mpesaOutcome.title : pendingMpesa ? (mpesaDelayed ? "Still checking M-Pesa" : "Processing M-Pesa") : "Sending M-Pesa prompt"}
        description={mpesaOutcome
          ? mpesaOutcome.description
          : pendingMpesa
            ? (mpesaDelayed ? "Confirmation is taking longer than usual. Check the sale before charging again." : "Customer should approve the prompt on their phone.")
            : "Hold on, the prompt is going out to the customer's phone."}
        onCancel={mpesaOutcome ? undefined : cancelPendingMpesa}
        onDismiss={() => setMpesaOutcome(null)}
      />

      {/* Bottom-right payment timeline removed — the processing overlay covers status feedback. */}

      {lastReceipt && <ReceiptModal receipt={lastReceipt} onClose={() => setLastReceipt(null)} />}

      {wholesaleViolations.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center font-bold">!</div>
              <div className="flex-1">
                <h3 className="text-lg font-display font-semibold">Wholesale minimums not met</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  These items are priced as wholesale but their cart quantity is below the required minimum. Adjust the quantities (or switch them to retail) to continue.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border divide-y divide-border bg-background overflow-hidden">
              {wholesaleViolations.map((v, idx) => (
                <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                  <span className="font-medium truncate pr-2">{v.name}</span>
                  <span className="text-xs whitespace-nowrap">
                    <span className="text-destructive font-semibold">{v.current}</span>
                    <span className="text-muted-foreground"> / min </span>
                    <span className="text-foreground font-semibold">{v.required}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  // Bump every violating wholesale line up to its required minimum
                  // and recompute pricing so the cart totals reflect the change.
                  const fixes = new Map(wholesaleViolations.map((v) => [v.name, v.required]));
                  setCart((prev) => prev.map((i) => {
                    const required = fixes.get(i.name);
                    if (required && i.quantity < required) {
                      // Respect on-hand stock for non-service items.
                      const target = (i as any).is_service ? required : Math.min(required, Number(i.stock ?? required));
                      const p = resolvePricing(i, target);
                      return { ...i, quantity: target, ...p };
                    }
                    return i;
                  }));
                  setWholesaleViolations([]);
                  toast({ title: "Quantities adjusted", description: "Wholesale lines bumped to their minimums." });
                }}
                className="px-4 py-2 rounded-lg bg-success text-success-foreground text-sm font-medium hover:opacity-90"
              >
                Auto-adjust to minimums
              </button>
              <button
                onClick={() => setWholesaleViolations([])}
                className="px-4 py-2 rounded-lg bg-muted border border-input text-foreground text-sm font-medium hover:bg-accent"
              >
                I'll fix manually
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <PaymentConfirmModal
          paymentMethod={pendingConfirm.method}
          total={total}
          customerName={selectedCustomer?.name || "Walk-in"}
          onClose={() => setPendingConfirm(null)}
          onConfirm={async ({ paid }) => {
            const m = pendingConfirm.method;
            setPendingConfirm(null);
            await completeSale(m, undefined, pendingConfirm.loyaltyOverride, 0, paid);
          }}
        />
      )}

      {/* Staff Drawer */}
      {showStaff && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowStaff(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="font-display text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Staff at Location</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{locations.find(l => l.id === locationId)?.name || "All"}</p>
              </div>
              <button onClick={() => setShowStaff(false)} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {(() => {
                const locationUserIds = new Set(allUserLocations.filter((ul: any) => ul.location_id === locationId).map((ul: any) => ul.user_id));
                const locationStaff = locationUserIds.size > 0
                  ? staff.filter((s: any) => locationUserIds.has(s.user_id))
                  : staff;
                if (locationStaff.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No staff assigned to this location</p>;
                return locationStaff.map((s: any) => {
                  const isCurrentUser = s.user_id === user?.id;
                  return (
                    <div key={s.id} className={cn("flex items-center gap-3 p-3 rounded-xl border transition-colors", isCurrentUser ? "border-primary/30 bg-primary/5" : "border-border")}>
                      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0", isCurrentUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                        {(s.display_name || "U").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{s.display_name}{isCurrentUser && <span className="text-xs text-primary ml-1">(You)</span>}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.phone || "No phone"}</p>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{s.role || "staff"}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Held Sales Modal */}
      {showHeldSales && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowHeldSales(false)}>
          <div className="bg-card rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="font-display text-lg font-bold flex items-center gap-2"><Pause className="w-5 h-5 text-warning" /> Held Sales ({heldSales.length})</h2>
              <button onClick={() => setShowHeldSales(false)} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {heldSales.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No held sales</p>}
              {heldSales.map((held) => (
                <div key={held.id} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{held.label}</p>
                      <p className="text-xs text-muted-foreground">{held.cart.length} items · {new Date(held.heldAt).toLocaleTimeString()}</p>
                    </div>
                    <p className="text-sm font-bold text-primary">{formatKES(held.cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0))}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => {
                      if (cart.length > 0) {
                        const currentHeld: HeldSale = {
                          id: crypto.randomUUID(), cart: [...cart], customer: selectedCustomer,
                          loyaltyRedeemPoints, heldAt: new Date().toISOString(),
                          label: selectedCustomer?.name || `Sale #${heldSales.length + 1}`,
                        };
                        const updated = [...heldSales.filter(h => h.id !== held.id), currentHeld];
                        setHeldSales(updated);
                        localStorage.setItem("held_sales", JSON.stringify(updated));
                      } else {
                        const updated = heldSales.filter(h => h.id !== held.id);
                        setHeldSales(updated);
                        localStorage.setItem("held_sales", JSON.stringify(updated));
                      }
                      setCart(held.cart);
                      setSelectedCustomer(held.customer);
                      setLoyaltyRedeemPoints(held.loyaltyRedeemPoints);
                      setShowHeldSales(false);
                      toast({ title: "Sale resumed", description: `"${held.label}" loaded` });
                    }} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">
                      <Play className="w-3 h-3" /> Resume
                    </button>
                    <button onClick={() => {
                      const updated = heldSales.filter(h => h.id !== held.id);
                      setHeldSales(updated);
                      localStorage.setItem("held_sales", JSON.stringify(updated));
                      toast({ title: "Held sale deleted" });
                    }} className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Credit Note Modal */}
      {showCreditNote && (
        <CreditNoteModal
          customers={customers}
          locationId={locationId}
          user={user}
          profile={profile}
          onClose={() => setShowCreditNote(false)}
        />
      )}

      {/* Cash Register */}
      {showCashRegister && (
        <CashRegisterDrawer locationId={locationId} onClose={() => setShowCashRegister(false)} />
      )}

      {/* Online gateway payment */}
      {onlinePay && (
        <OnlinePayModal
          sale={{ id: onlinePay.sale.id, total: onlinePay.total }}
          gateways={shopGateways}
          customerPhone={selectedCustomer?.phone || ""}
          customerEmail={(selectedCustomer as any)?.email || ""}
          onPaid={() => {
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["customers"] });
            queryClient.invalidateQueries({ queryKey: ["product-variants"] });
            setLastReceipt({ ...onlinePay.sale, status: "completed", items: onlinePay.saleItems, total: onlinePay.total, discount: onlinePay.discount, loyalty_points_earned: 0 });
            setCart([]);
            setSelectedCustomer(null);
            setLoyaltyRedeemPoints(0);
            setOnlinePay(null);
            toast({ title: "Sale completed", description: "Online payment confirmed." });
          }}
          onCancel={async () => {
            const id = onlinePay.sale.id;
            setOnlinePay(null);
            await supabase.from("transactions").update({ status: "cancelled" } as any).eq("id", id).eq("status", "pending");
            toast({ title: "Online payment cancelled", description: "The cart is still here. Choose another way to pay." });
          }}
        />
      )}

      {/* Split Payment */}
      {showSplitPayment && (
        <SplitPaymentModal
          total={total}
          onClose={() => setShowSplitPayment(false)}
          onConfirm={async (payments) => {
            setShowSplitPayment(false);
            // Persist the split breakdown on the transaction (split_payments column).
            // We patch it after completeSale inserts the row by listening for the latest tx.
            (window as any).__pendingSplitPayments = payments;
            await completeSale("split", undefined, appliedDiscount);
            // Patch the most recent transaction row with the breakdown
            try {
              const { data: latestTx } = await supabase
                .from("transactions")
                .select("id")
                .eq("cashier_id", user?.id)
                .eq("payment_method", "split")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (latestTx?.id) {
                await supabase
                  .from("transactions")
                  .update({ split_payments: payments as any })
                  .eq("id", latestTx.id);
              }
            } catch (e) { console.warn("Could not persist split breakdown", e); }
            delete (window as any).__pendingSplitPayments;
          }}
        />
      )}

      {/* End of Day Summary */}
      {showEndOfDay && (
        <EndOfDayModal locationId={locationId} onClose={() => setShowEndOfDay(false)} />
      )}

      {/* Product image preview (tap-to-zoom from product cards) */}
      <Dialog open={!!previewProduct} onOpenChange={(o) => { if (!o) setPreviewProduct(null); }}>
        <DialogContent className="max-w-3xl p-0 bg-background overflow-hidden">
          {previewProduct?.image_url && (
            <div className="flex flex-col">
              <div className="bg-white dark:bg-muted/30 flex items-center justify-center p-4 max-h-[80vh]">
                <img
                  src={previewProduct.image_url}
                  alt={previewProduct.name}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              </div>
              <div className="px-5 py-3 border-t border-border">
                <p className="font-semibold text-foreground truncate">{previewProduct.name}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Water: refill only, or with an empty bottle / jerrican */}
      {waterChoice && (
        <div className="fixed inset-0 z-[70] bg-foreground/40 flex items-center justify-center p-4" onClick={() => setWaterChoice(null)}>
          <div className="bg-card rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">{waterChoice.refill.name}</h2>
            <p className="text-xs text-muted-foreground">Does the customer have their own container?</p>
            <div className="grid grid-cols-1 gap-2">
              <button
                autoFocus
                onClick={() => { addToCart(waterChoice.refill); setWaterChoice(null); }}
                className="border-2 border-primary/40 rounded-xl px-3 py-3 text-left text-sm hover:border-primary flex items-center justify-between"
              >
                <span><span className="font-semibold block">Refill only</span><span className="text-xs text-muted-foreground">Customer brings a container</span></span>
                <span className="font-bold">{formatKES(Number(waterChoice.refill.price))}</span>
              </button>
              {waterChoice.containers.map((c: any) => {
                const left = Number(c.stock ?? 0);
                return (
                  <button
                    key={c.id}
                    disabled={left <= 0}
                    onClick={() => { addToCart(waterChoice.refill); addToCart(c); setWaterChoice(null); }}
                    className="border border-border rounded-xl px-3 py-3 text-left text-sm hover:border-primary disabled:opacity-40 flex items-center gap-3"
                  >
                    {c.image_url
                      ? <img src={c.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      : <span className="h-10 w-10 rounded-lg bg-muted" />}
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold block truncate">With {c.name}</span>
                      <span className="text-xs text-muted-foreground">+{formatKES(Number(c.price))} · {left > 0 ? `${left} left` : "out of stock"}</span>
                    </span>
                    <span className="font-bold">{formatKES(Number(waterChoice.refill.price) + Number(c.price))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Choose a size/colour or a bottle/tot before adding to the cart */}
      {optionProduct && (
        <div className="fixed inset-0 z-[70] bg-foreground/40 flex items-center justify-center p-4" onClick={() => setOptionProduct(null)}>
          <div className="bg-card rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">{optionProduct.name}</h2>
            {(variantMap[optionProduct.id] || []).length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">Pick a size / colour</p>
                <div className="grid grid-cols-2 gap-2">
                  {(variantMap[optionProduct.id] || []).map((v) => (
                    <button
                      key={v.id}
                      disabled={Number(v.stock ?? 0) <= 0}
                      onClick={() => addVariantToCart(optionProduct, v)}
                      className="border border-border rounded-xl px-3 py-2.5 text-left text-sm hover:border-primary disabled:opacity-40"
                    >
                      <span className="font-medium block">{[v.size, v.color].filter(Boolean).join(" / ") || "Option"}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatKES(Number(v.price ?? optionProduct.price ?? 0))} · {Number(v.stock ?? 0)} left
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">How are you selling it?</p>
                <div className="grid grid-cols-1 gap-2">
                  {liquorUnits(optionProduct).map((u) => (
                    <button
                      key={u.key}
                      onClick={() => addUnitToCart(optionProduct, u)}
                      className="border border-border rounded-xl px-3 py-2.5 text-left text-sm hover:border-primary flex items-center justify-between"
                    >
                      <span className="font-medium">{u.label}</span>
                      <span className="text-xs text-muted-foreground">{formatKES(u.price)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab controls now live in the cart totals area. */}

      {/* Pick a running tab and bring it into the till */}
      {showTabList && (
        <div className="fixed inset-0 z-[70] bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowTabList(false)}>
          <div className="bg-card rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Open tabs</h2>
            {openBillList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No running tabs right now.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {openBillList.map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => loadTabIntoCart(b)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-left hover:border-primary"
                  >
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>{b.label}</span>
                      <span>{formatKES(Number(b.total))}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(b.items || []).length} item{(b.items || []).length === 1 ? "" : "s"}
                      {Number(b.amount_paid) > 0 ? ` · paid ${formatKES(Number(b.amount_paid))}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Pick a tab to load it here, then take payment with Cash, Card or M-Pesa as usual.
            </p>
          </div>
        </div>
      )}

      {showTabPicker && (
        <div className="fixed inset-0 z-[70] bg-foreground/40 flex items-center justify-center p-4" onClick={() => setShowTabPicker(false)}>
          <div className="bg-card rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Send cart to a tab</h2>
            {openBillList.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {openBillList.map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => sendCartToTab(b.id)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-left text-sm hover:border-primary"
                  >
                    {b.label} · {formatKES(Number(b.total))}
                  </button>
                ))}
              </div>
            )}
            <input
              value={newTabLabel}
              onChange={(e) => setNewTabLabel(e.target.value)}
              placeholder="Or new tab name (Table 4)"
              className="w-full px-3 py-2.5 rounded-lg bg-muted border border-input text-sm"
            />
            <button
              disabled={!newTabLabel.trim()}
              onClick={() => sendCartToTab(null, newTabLabel.trim())}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              Open new tab
            </button>
          </div>
        </div>
      )}
    </div>

  );
}

function CreditNoteModal({ customers, locationId, user, profile, onClose }: {
  customers: DbCustomer[];
  locationId: string;
  user: any;
  profile: any;
  onClose: () => void;
}) {
  const [txSearch, setTxSearch] = useState("");
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: recentTx = [] } = useQuery({
    queryKey: ["recent-completed-tx", txSearch],
    queryFn: async () => {
      let q = supabase.from("transactions").select("*").eq("status", "completed").order("created_at", { ascending: false }).limit(20);
      if (txSearch) q = q.or(`customer_name.ilike.%${txSearch}%,id.ilike.%${txSearch}%`);
      const { data } = await q;
      return data || [];
    },
  });

  const handleIssue = async () => {
    if (!selectedTx) return;
    const items = (selectedTx.items as any[]) || [];
    const returnEntries = items.filter(i => (returnItems[i.id] || 0) > 0).map(i => ({
      ...i, return_quantity: returnItems[i.id],
    }));
    if (returnEntries.length === 0) { toast({ title: "Select items to return", variant: "destructive" }); return; }

    const creditTotal = returnEntries.reduce((s, i) => s + Number(i.price) * i.return_quantity, 0);
    setSaving(true);

    // Create credit note transaction
    const cnData: any = {
      items: returnEntries,
      subtotal: -creditTotal,
      tax: 0,
      discount: 0,
      total: -creditTotal,
      payment_method: "credit_note",
      customer_id: selectedTx.customer_id,
      customer_name: selectedTx.customer_name || "Walk-in",
      cashier_id: user?.id,
      cashier_name: profile?.display_name || "Unknown",
      status: "completed",
      location_id: locationId,
      tenant_id: profile?.tenant_id || null,
    };

    const { error } = await supabase.from("transactions").insert(cnData);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }

    // Restore stock for returned items
    for (const item of returnEntries) {
      if (item.is_service) continue;
      const { data: ps } = await (supabase as any).from("product_stocks").select("stock").eq("product_id", item.id).eq("location_id", locationId).maybeSingle();
      const currentStock = ps?.stock || 0;
      await (supabase as any).from("product_stocks").upsert({
        product_id: item.id, location_id: locationId,
        stock: currentStock + item.return_quantity,
      }, { onConflict: "product_id,location_id" });
    }

    // If customer has credit, add balance
    if (selectedTx.customer_id) {
      const cust = customers.find(c => c.id === selectedTx.customer_id);
      if (cust && cust.credit_limit > 0) {
        await supabase.from("customers").update({ balance: Math.max(0, Number(cust.balance) - creditTotal) }).eq("id", cust.id);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });
    setSaving(false);
    logActivity({
      action: "refund_processed",
      entity_type: "transaction",
      entity_id: selectedTx?.id,
      description: `Credit note ${formatKES(creditTotal)} issued${selectedTx?.customer_name ? ` for ${selectedTx.customer_name}` : ""}`,
      metadata: { amount: creditTotal, original_tx: selectedTx?.id, items: returnEntries.length },
    });
    toast({ title: "Credit note issued", description: `${formatKES(creditTotal)} credit note created.` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><RotateCcw className="w-5 h-5 text-info" /> Issue Credit Note</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!selectedTx ? (
            <>
              <input value={txSearch} onChange={e => setTxSearch(e.target.value)} placeholder="Search by customer name or receipt #..."
                className="w-full px-4 py-2.5 rounded-lg bg-muted border border-input text-sm" />
              <p className="text-xs text-muted-foreground">Select the original transaction:</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {recentTx.map((tx: any) => (
                  <button key={tx.id} onClick={() => { setSelectedTx(tx); setReturnItems({}); }}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted text-left">
                    <div>
                      <p className="text-sm font-medium">{tx.customer_name || "Walk-in"}</p>
                      <p className="text-xs text-muted-foreground">#{tx.id.slice(0, 8).toUpperCase()} · {new Date(tx.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className="text-sm font-bold">{formatKES(Number(tx.total))}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{selectedTx.customer_name || "Walk-in"}</p>
                  <p className="text-xs text-muted-foreground">#{selectedTx.id.slice(0, 8).toUpperCase()}</p>
                </div>
                <button onClick={() => setSelectedTx(null)} className="text-xs text-primary hover:underline">Change</button>
              </div>
              <p className="text-xs font-medium text-muted-foreground">Select items & quantities to return:</p>
              <div className="space-y-2">
                {((selectedTx.items as any[]) || []).map((item: any) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{formatKES(Number(item.price))} × {item.quantity}</p>
                    </div>
                    <input type="number" min={0} max={item.quantity} value={returnItems[item.id] || 0}
                      onChange={e => setReturnItems({ ...returnItems, [item.id]: Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)) })}
                      className="w-16 px-2 py-1 rounded-lg bg-muted border border-input text-sm text-center" />
                  </div>
                ))}
              </div>
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for return (optional)"
                className="w-full px-3 py-2 rounded-lg bg-muted border border-input text-sm" rows={2} />
              {(() => {
                const items = (selectedTx.items as any[]) || [];
                const creditTotal = items.reduce((s: number, i: any) => s + Number(i.price) * (returnItems[i.id] || 0), 0);
                return (
                  <button onClick={handleIssue} disabled={creditTotal <= 0 || saving}
                    className="w-full py-3 rounded-xl bg-info text-info-foreground font-medium text-sm hover:opacity-90 disabled:opacity-40">
                    {saving ? "Processing..." : `Issue Credit Note for ${formatKES(creditTotal)}`}
                  </button>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EndOfDayModal({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      // A trading day runs from when the till was opened, not from midnight,
      // so a shift that crosses midnight (bars, night shops) is reported whole.
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const { data: openReg } = await (supabase as any)
        .from("cash_register")
        .select("opened_at")
        .eq("location_id", locationId)
        .eq("status", "open")
        .order("opened_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const openedAt = openReg?.opened_at ? new Date(openReg.opened_at) : null;
      const since = openedAt && openedAt < midnight ? openedAt : midnight;
      const { data: txns } = await supabase
        .from("transactions")
        .select("*")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .gte("created_at", since.toISOString());

      const transactions = txns || [];
      const totalSales = transactions.reduce((s: number, t: any) => s + Number(t.total), 0);
      const totalTx = transactions.length;
      const avgSale = totalTx > 0 ? totalSales / totalTx : 0;
      const cashSales = transactions.filter((t: any) => t.payment_method === "cash").reduce((s: number, t: any) => s + Number(t.total), 0);
      const mpesaSales = transactions.filter((t: any) => t.payment_method === "mpesa").reduce((s: number, t: any) => s + Number(t.total), 0);
      const cardSales = transactions.filter((t: any) => t.payment_method === "card").reduce((s: number, t: any) => s + Number(t.total), 0);
      const creditSales = transactions.filter((t: any) => t.payment_method === "credit").reduce((s: number, t: any) => s + Number(t.total), 0);
      const splitSales = transactions.filter((t: any) => t.payment_method === "split").reduce((s: number, t: any) => s + Number(t.total), 0);
      const totalDiscount = transactions.reduce((s: number, t: any) => s + Number(t.discount || 0), 0);
      const creditNotes = transactions.filter((t: any) => t.payment_method === "credit_note");
      const totalReturns = Math.abs(creditNotes.reduce((s: number, t: any) => s + Number(t.total), 0));

      // Top products
      const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
      transactions.forEach((t: any) => {
        ((t.items as any[]) || []).forEach((item: any) => {
          if (!productMap[item.id]) productMap[item.id] = { name: item.name, qty: 0, revenue: 0 };
          productMap[item.id].qty += item.quantity;
          productMap[item.id].revenue += Number(item.price) * item.quantity;
        });
      });
      const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

      setData({ totalSales, totalTx, avgSale, cashSales, mpesaSales, cardSales, creditSales, splitSales, totalDiscount, totalReturns, topProducts });
      setLoading(false);
    };
    load();
  }, [locationId]);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><ClipboardList className="w-5 h-5 text-primary" /> End of Day Summary</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading summary...</p>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Total Sales</p>
                  <p className="text-xl font-bold text-primary">{formatKES(data.totalSales)}</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <p className="text-xl font-bold">{data.totalTx}</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Average Sale</p>
                  <p className="text-lg font-bold">{formatKES(data.avgSale)}</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Total Discounts</p>
                  <p className="text-lg font-bold text-warning">{formatKES(data.totalDiscount)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-sm font-semibold">Payment Breakdown</p>
                {[
                  { label: "Cash", amount: data.cashSales, color: "bg-blue-400" },
                  { label: "M-Pesa", amount: data.mpesaSales, color: "bg-green-400" },
                  { label: "Card", amount: data.cardSales, color: "bg-purple-400" },
                  { label: "Credit", amount: data.creditSales, color: "bg-orange-400" },
                  { label: "Split", amount: data.splitSales, color: "bg-cyan-400" },
                ].filter(p => p.amount > 0).map(p => (
                  <div key={p.label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${p.color}`} />
                      <span className="text-muted-foreground">{p.label}</span>
                    </div>
                    <span className="font-medium">{formatKES(p.amount)}</span>
                  </div>
                ))}
              </div>

              {data.totalReturns > 0 && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">Returns / Credit Notes: {formatKES(data.totalReturns)}</p>
                </div>
              )}

              {data.topProducts.length > 0 && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-sm font-semibold">Top Products</p>
                  {data.topProducts.map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate flex-1">{i + 1}. {p.name}</span>
                      <span className="text-xs text-muted-foreground mx-2">×{p.qty}</span>
                      <span className="font-medium">{formatKES(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
