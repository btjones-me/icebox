import {
  ArchiveIcon,
  BoxIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChatBubbleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Cross2Icon,
  DoubleArrowDownIcon,
  DoubleArrowUpIcon,
  DownloadIcon,
  DotsVerticalIcon,
  FileTextIcon,
  HamburgerMenuIcon,
  HomeIcon,
  LetterCaseCapitalizeIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MobileIcon,
  MinusIcon,
  MixerHorizontalIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ResetIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BottomSheet, KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard } from "./mobile";
import { selectInventoryResults, sortInventory, type InventorySortMode, type InventoryViewMode } from "./inventory-sort";
import { ImageProcessingError, processImageFile } from "./image-processing";
import { itemInitials, itemThumbnailColour } from "./item-thumbnail";
import { expiryUrgency } from "./expiry-urgency";
import { clearPrivateCache, loadCachedBootstrap, saveCachedBootstrap } from "./private-cache";
import {
  enableClientTelemetryTransport,
  feedbackDeviceContext,
  getClientSessionId,
  getRecentClientEvents,
  installClientTelemetry,
  recordClientEvent,
  setTelemetryHouseholdId,
  trackedFetch,
} from "./telemetry";

type SyncState = "current" | "pending" | "attention";

type Household = {
  id: string;
  name: string;
  ownerUserId?: string;
  ownerEmail: string;
  memberCount: number;
};

type Freezer = {
  id: string;
  householdId: string;
  name: string;
  position: number;
  defaultSortMode?: InventorySortMode;
};

type Drawer = {
  id: string;
  freezerId: string;
  name: string;
  position: number;
  defaultSortMode?: InventorySortMode;
};

type InventoryItem = {
  id: string;
  freezerId: string;
  drawerId: string;
  label: string;
  frozenOn: string;
  expiresOn?: string | null;
  createdAt: string;
  notes: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  thumbnailReady?: boolean | number;
  imageId?: string;
  version: number;
};

type Invitation = {
  id: string;
  householdId: string;
  householdName: string;
  invitedBy: string;
  expiresAt: string;
};

const thumbnailBackfillAttempts = new Set<string>();
let thumbnailBackfillQueue = Promise.resolve();

async function backfillLegacyThumbnail(image: HTMLImageElement, mediaId: string) {
  if (thumbnailBackfillAttempts.has(mediaId) || !image.naturalWidth || !image.naturalHeight) return null;
  thumbnailBackfillAttempts.add(mediaId);
  const run = async () => {
  try {
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob || blob.size > 256 * 1024) return null;
    const form = new FormData();
    form.append("thumbnail", new File([blob], "thumbnail.jpg", { type: "image/jpeg" }));
    const { response } = await trackedFetch(`/api/media/${mediaId}/thumbnail`, { method: "POST", body: form });
    if (!response.ok) return null;
    const result = await response.json() as { thumbnailUrl?: string };
    recordClientEvent("image_thumbnail_backfilled", { thumbnailBytes: blob.size });
    return result.thumbnailUrl ?? null;
  } catch {
    return null;
  }
  };
  const queued = thumbnailBackfillQueue.then(run, run);
  thumbnailBackfillQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

type HouseholdMember = {
  id: string;
  email: string;
  fullName?: string | null;
  joinedAt: string;
  isOwner: boolean | number;
};

type HouseholdInvitation = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type SheetMode = "add" | "edit" | "settings" | "households" | "invite" | "edit-freezer" | "sort" | "feedback" | "install" | "structure-sort" | "structure-rename" | null;

type StructureTarget = {
  id: string;
  kind: "freezer" | "drawer";
};

type PhotoViewerState = {
  imageUrl: string;
  label: string;
};

type BootstrapResponse = {
  user: { id: string; email: string; fullName?: string; aiLabelEnabled: boolean; isOperator?: boolean };
  households: Household[];
  freezers: Freezer[];
  drawers: Drawer[];
  items: InventoryItem[];
  invitations: Invitation[];
  defaultHouseholdId?: string;
  backup: { state: SyncState; pendingCount: number; lastSuccessAt?: string };
};

type InductionFreezer = { name: string; drawerCount: number };

const seedHouseholds: Household[] = [
  { id: "house-alder", name: "Alder House", ownerUserId: "demo-user", ownerEmail: "alex@example.com", memberCount: 3 },
];

const seedFreezers: Freezer[] = [
  { id: "freezer-kitchen", householdId: "house-alder", name: "Kitchen Freezer", position: 1 },
  { id: "freezer-garage", householdId: "house-alder", name: "Garage Freezer", position: 2 },
];

const seedDrawers: Drawer[] = [
  { id: "drawer-top", freezerId: "freezer-kitchen", name: "Top Drawer", position: 1 },
  { id: "drawer-upper", freezerId: "freezer-kitchen", name: "Upper Drawer", position: 2 },
  { id: "drawer-middle", freezerId: "freezer-kitchen", name: "Middle Drawer", position: 3 },
  { id: "drawer-lower", freezerId: "freezer-kitchen", name: "Lower Drawer", position: 4 },
  { id: "drawer-bottom", freezerId: "freezer-kitchen", name: "Bottom Drawer", position: 5 },
  { id: "garage-one", freezerId: "freezer-garage", name: "Drawer 1", position: 1 },
  { id: "garage-two", freezerId: "freezer-garage", name: "Drawer 2", position: 2 },
  { id: "garage-three", freezerId: "freezer-garage", name: "Drawer 3", position: 3 },
];

const seedItems: InventoryItem[] = [
  {
    id: "item-curry",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Chicken curry",
    frozenOn: "2026-07-28",
    expiresOn: "2026-10-15",
    createdAt: "2026-07-28T18:30:00.000Z",
    notes: "Two generous portions. Defrost overnight and reheat until piping hot.",
    imageUrl: "/assets/food/chicken-curry.png",
    version: 1,
  },
  {
    id: "item-bread",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Sourdough loaf",
    frozenOn: "2026-07-25",
    expiresOn: "2026-09-10",
    createdAt: "2026-07-25T09:15:00.000Z",
    notes: "Pre-sliced. Toast from frozen.",
    imageUrl: "/assets/food/sourdough.png",
    version: 1,
  },
  {
    id: "item-peas",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Peas",
    frozenOn: "2026-07-20",
    createdAt: "2026-07-20T17:00:00.000Z",
    notes: "Half a bag remaining.",
    imageUrl: "/assets/food/peas.png",
    version: 1,
  },
  {
    id: "item-stock",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Vegetable stock",
    frozenOn: "2026-07-18",
    expiresOn: "2026-08-20",
    createdAt: "2026-07-18T13:45:00.000Z",
    notes: "About 500ml, unsalted.",
    imageUrl: "/assets/food/vegetable-stock.png",
    version: 1,
  },
  {
    id: "item-lasagne",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Lasagne portions",
    frozenOn: "2026-07-15",
    expiresOn: "2026-12-01",
    createdAt: "2026-07-15T19:20:00.000Z",
    notes: "Two portions in separate containers.",
    imageUrl: "/assets/food/lasagne.png",
    version: 1,
  },
  {
    id: "item-blueberries",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-middle",
    label: "Blueberries",
    frozenOn: "2026-07-12",
    createdAt: "2026-07-12T11:00:00.000Z",
    notes: "Use from frozen in porridge or smoothies.",
    imageUrl: "/assets/food/blueberries.png",
    version: 1,
  },
  {
    id: "item-soup",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-top",
    label: "Tomato soup",
    frozenOn: "2026-07-30",
    expiresOn: "2026-08-12",
    createdAt: "2026-07-30T12:10:00.000Z",
    notes: "One lunch portion.",
    version: 1,
  },
  {
    id: "item-burgers",
    freezerId: "freezer-kitchen",
    drawerId: "drawer-lower",
    label: "Bean burgers",
    frozenOn: "2026-07-11",
    createdAt: "2026-07-11T16:40:00.000Z",
    notes: "Four burgers, cook from frozen.",
    version: 1,
  },
];

const today = new Date().toLocaleDateString("en-CA");

function formatFrozenDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function shortTime(value?: string) {
  if (!value) return "just now";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

const inventoryViewLabels: Record<InventoryViewMode, string> = {
  default: "Default freezer view",
  expiry: "Expiring soonest",
  alphabetical: "Alphabetical",
  added: "Added date",
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const formDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const binaryBody = typeof Blob !== "undefined" && init?.body instanceof Blob;
  const { response, requestId } = await trackedFetch(path, {
    ...init,
    headers: {
      ...(formDataBody || binaryBody ? {} : { "content-type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok || !contentType.includes("application/json")) {
    const code = data?.error?.code ? ` ${data.error.code}` : "";
    const debug = data?.error?.details?.debug ? `: ${data.error.details.debug}` : "";
    recordClientEvent("api_response_error", {
      requestId,
      serverRequestId: data?.requestId,
      route: path.split("?")[0],
      status: response.status,
      code: data?.error?.code || "unexpected_response",
    }, "error");
    if (response.status === 401 || response.status === 403) {
      await clearPrivateCache();
      window.location.replace("/");
    }
    throw new Error(`Request failed: ${response.status}${code}${debug}`);
  }
  return data as T;
}

function inventoryPayload(item: InventoryItem) {
  return {
    label: item.label,
    frozenOn: item.frozenOn,
    expiresOn: item.expiresOn || null,
    notes: item.notes,
    freezerId: item.freezerId,
    drawerId: item.drawerId,
    imageId: item.imageId ?? null,
    version: item.version,
  };
}

export default function Prototype({ initialOffline = false }: { initialOffline?: boolean }) {
  const keyboard = useKeyboard();
  const [backendReady, setBackendReady] = useState(false);
  const [bootstrapState, setBootstrapState] = useState<"loading" | "ready" | "error">("loading");
  const [user, setUser] = useState({
    id: "demo-user",
    email: "alex@example.com",
    fullName: "Alex Morgan",
    aiLabelEnabled: true,
    isOperator: true,
  });
  const [households, setHouseholds] = useState(seedHouseholds);
  const [freezers, setFreezers] = useState(seedFreezers);
  const [drawers, setDrawers] = useState(seedDrawers);
  const [items, setItems] = useState(seedItems);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState("house-alder");
  const [activeFreezerId, setActiveFreezerId] = useState("freezer-kitchen");
  const [openFreezerIds, setOpenFreezerIds] = useState<string[]>(["freezer-kitchen"]);
  const [openDrawerIds, setOpenDrawerIds] = useState<string[]>(["drawer-middle"]);
  const [openDrawerId, setOpenDrawerId] = useState("drawer-middle");
  const [search, setSearch] = useState("");
  const [inventoryViewMode, setInventoryViewMode] = useState<InventoryViewMode>("default");
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [draft, setDraft] = useState<InventoryItem>(() => emptyDraft("freezer-kitchen", "drawer-middle"));
  const [syncState, setSyncState] = useState<SyncState>("current");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>(new Date().toISOString());
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const labelGenerationRequestRef = useRef(0);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<"main" | "freezer" | "household" | "account">("main");
  const [installPlatform, setInstallPlatform] = useState<"choice" | "ios" | "android">("choice");
  const [inviteEmail, setInviteEmail] = useState("");
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [householdInvitations, setHouseholdInvitations] = useState<HouseholdInvitation[]>([]);
  const [householdPeopleLoading, setHouseholdPeopleLoading] = useState(false);
  const [memberRemovalArmedId, setMemberRemovalArmedId] = useState<string | null>(null);
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [offline, setOffline] = useState(initialOffline || !navigator.onLine);
  const [inductionName, setInductionName] = useState("");
  const [inductionFreezers, setInductionFreezers] = useState<InductionFreezer[]>([
    { name: "Freezer 1", drawerCount: 3 },
  ]);
  const [editingFreezer, setEditingFreezer] = useState<Freezer | null>(null);
  const [structureDraft, setStructureDraft] = useState<{ name: string; drawers: Drawer[] }>({ name: "", drawers: [] });
  const [householdNameDraft, setHouseholdNameDraft] = useState("");
  const [accountDeleteArmed, setAccountDeleteArmed] = useState(false);
  const [householdDeleteArmed, setHouseholdDeleteArmed] = useState(false);
  const [freezerDeleteArmed, setFreezerDeleteArmed] = useState(false);
  const [drawerDeleteArmedId, setDrawerDeleteArmedId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackReference, setFeedbackReference] = useState<string | null>(null);
  const [feedbackPhoto, setFeedbackPhoto] = useState<{ file: File; previewUrl: string; original: boolean } | null>(null);
  const [feedbackPhotoProcessing, setFeedbackPhotoProcessing] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<PhotoViewerState | null>(null);
  const [structureTarget, setStructureTarget] = useState<StructureTarget | null>(null);
  const [structureRenameDraft, setStructureRenameDraft] = useState("");
  const [printReady, setPrintReady] = useState(false);

  function openSingleHierarchy(freezerId: string, drawerId: string) {
    setOpenFreezerIds(freezerId ? [freezerId] : []);
    setOpenDrawerIds(drawerId ? [drawerId] : []);
    setOpenDrawerId(drawerId);
  }

  function applyBootstrap(data: BootstrapResponse, connected = true) {
    setBackendReady(connected);
    setUser({
      id: data.user.id,
      email: data.user.email,
      fullName: data.user.fullName ?? data.user.email.split("@")[0],
      aiLabelEnabled: data.user.aiLabelEnabled,
      isOperator: Boolean(data.user.isOperator),
    });
    setHouseholds(data.households);
    setFreezers(data.freezers);
    setDrawers(data.drawers);
    setItems(data.items);
    setInvitations(data.invitations);
    openSingleHierarchy("", "");
    const firstHousehold = data.defaultHouseholdId ?? data.households[0]?.id;
    if (firstHousehold) {
      setActiveHouseholdId(firstHousehold);
      const firstFreezer = data.freezers.find((freezer) => freezer.householdId === firstHousehold);
      if (firstFreezer) {
        setActiveFreezerId(firstFreezer.id);
        const firstDrawer = data.drawers.find((drawer) => drawer.freezerId === firstFreezer.id);
        openSingleHierarchy(firstFreezer.id, firstDrawer?.id ?? "");
      }
    }
    setSyncState(data.backup.state);
    setPendingCount(data.backup.pendingCount);
    setLastBackupAt(data.backup.lastSuccessAt);
  }

  useEffect(() => {
    let active = true;
    const uninstallTelemetry = installClientTelemetry();
    if (initialOffline) {
      void loadCachedBootstrap<BootstrapResponse>().then((cached) => {
        if (!active) return;
        if (cached) {
          applyBootstrap(cached, false);
          setOffline(true);
          setBootstrapState("ready");
        } else {
          setBootstrapState("error");
        }
      }).catch(() => { if (active) setBootstrapState("error"); });
    } else {
    apiRequest<BootstrapResponse>("/api/bootstrap")
      .then((data) => {
        if (!active) return;
        applyBootstrap(data);
        setTelemetryHouseholdId(data.defaultHouseholdId ?? data.households[0]?.id ?? null);
        enableClientTelemetryTransport();
        setBootstrapState("ready");
        void saveCachedBootstrap(data);
      })
      .catch(async (error) => {
        console.error("Icebox bootstrap failed:", error instanceof Error ? error.message : "Unknown error");
        const networkFailure = error instanceof TypeError || !navigator.onLine;
        const cached = networkFailure ? await loadCachedBootstrap<BootstrapResponse>().catch(() => null) : null;
        if (active && networkFailure && cached) {
          applyBootstrap(cached, false);
          setOffline(true);
          setBootstrapState("ready");
        } else if (active) {
          setBootstrapState(import.meta.env.DEV ? "ready" : "error");
        }
        // The local Vite preview deliberately keeps realistic seed data when no Worker is attached.
      });
    }
    if ("serviceWorker" in navigator) {
      if (import.meta.env.DEV) {
        void navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
        if ("caches" in window) {
          void caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith("icebox-")).map((key) => caches.delete(key))));
        }
      } else {
        void navigator.serviceWorker.register("/sw.js");
      }
    }
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      active = false;
      uninstallTelemetry();
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [initialOffline]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!printReady) return;
    const finishPrinting = () => setPrintReady(false);
    window.addEventListener("afterprint", finishPrinting);
    return () => window.removeEventListener("afterprint", finishPrinting);
  }, [printReady]);

  const activeHousehold = households.find((household) => household.id === activeHouseholdId) ?? households[0];
  const householdFreezers = freezers
    .filter((freezer) => freezer.householdId === activeHousehold?.id)
    .sort((a, b) => a.position - b.position);
  const activeFreezer = householdFreezers.find((freezer) => freezer.id === activeFreezerId) ?? householdFreezers[0];
  const activeDrawers = drawers
    .filter((drawer) => drawer.freezerId === activeFreezer?.id)
    .sort((a, b) => a.position - b.position);
  const householdFreezerIds = householdFreezers.map((freezer) => freezer.id);
  const householdDrawers = drawers.filter((drawer) => householdFreezerIds.includes(drawer.freezerId));
  const allHierarchyOpen = householdFreezers.length > 0
    && householdFreezers.every((freezer) => openFreezerIds.includes(freezer.id))
    && householdDrawers.every((drawer) => openDrawerIds.includes(drawer.id));
  const searchActive = Boolean(search.trim());
  const flatInventoryActive = searchActive || inventoryViewMode !== "default";

  useEffect(() => {
    setTelemetryHouseholdId(bootstrapState === "ready" ? activeHousehold?.id || null : null);
    recordClientEvent("ui_state", {
      sheet: sheet || "inventory",
      settingsView,
      activeHouseholdId: activeHousehold?.id || null,
      activeFreezerId: activeFreezer?.id || null,
      openDrawerId: openDrawerId || null,
      sortMode: inventoryViewMode,
      searchActive,
      offline,
      itemCount: items.length,
    });
  }, [activeHousehold?.id, activeFreezer?.id, bootstrapState, inventoryViewMode, items.length, offline, openDrawerId, searchActive, settingsView, sheet]);

  const inventoryResults = useMemo(() => selectInventoryResults(
    items,
    freezers.filter((freezer) => freezer.householdId === activeHousehold?.id).map((freezer) => freezer.id),
    search,
    inventoryViewMode,
  ), [activeHousehold?.id, freezers, inventoryViewMode, items, search]);

  function drawerItems(drawer: Drawer) {
    const freezer = freezers.find((entry) => entry.id === drawer.freezerId);
    return sortInventory(
      items.filter((item) => item.drawerId === drawer.id),
      drawer.defaultSortMode ?? freezer?.defaultSortMode ?? "added",
    );
  }

  function openStructureAction(target: StructureTarget, action: "sort" | "rename") {
    keyboard.hide();
    const structure = target.kind === "freezer"
      ? freezers.find((freezer) => freezer.id === target.id)
      : drawers.find((drawer) => drawer.id === target.id);
    if (!structure) return;
    setStructureTarget(target);
    setStructureRenameDraft(structure.name);
    setSheet(action === "sort" ? "structure-sort" : "structure-rename");
  }

  async function updateStructureSort(defaultSortMode: InventorySortMode) {
    if (!structureTarget || saving) return;
    if (offline) {
      setToast("Icebox is read-only while offline");
      return;
    }
    const previousFreezers = freezers;
    const previousDrawers = drawers;
    setSaving(true);
    if (structureTarget.kind === "freezer") {
      setFreezers((current) => current.map((freezer) => freezer.id === structureTarget.id ? { ...freezer, defaultSortMode } : freezer));
      setDrawers((current) => current.map((drawer) => drawer.freezerId === structureTarget.id ? { ...drawer, defaultSortMode } : drawer));
    } else {
      setDrawers((current) => current.map((drawer) => drawer.id === structureTarget.id ? { ...drawer, defaultSortMode } : drawer));
    }
    try {
      if (backendReady) {
        const path = structureTarget.kind === "freezer" ? `/api/freezers/${structureTarget.id}` : `/api/drawers/${structureTarget.id}`;
        await apiRequest(path, { method: "PATCH", body: JSON.stringify({ defaultSortMode }) });
      }
      const label = inventoryViewLabels[defaultSortMode].toLocaleLowerCase();
      setToast(structureTarget.kind === "freezer" ? `Every drawer now sorts by ${label}` : `Drawer now sorts by ${label}`);
      closeSheet();
    } catch (error) {
      setFreezers(previousFreezers);
      setDrawers(previousDrawers);
      setToast(error instanceof Error ? error.message : "Couldn’t change the default sort order");
    } finally {
      setSaving(false);
    }
  }

  async function saveStructureRename() {
    if (!structureTarget || saving) return;
    const name = structureRenameDraft.trim();
    if (!name) {
      setToast(`Add a ${structureTarget.kind} name`);
      return;
    }
    if (offline) {
      setToast("Icebox is read-only while offline");
      return;
    }
    setSaving(true);
    try {
      let backupPending = false;
      if (backendReady) {
        const path = structureTarget.kind === "freezer" ? `/api/freezers/${structureTarget.id}` : `/api/drawers/${structureTarget.id}`;
        const result = await apiRequest<{ backupPending?: boolean }>(path, { method: "PATCH", body: JSON.stringify({ name }) });
        backupPending = Boolean(result.backupPending);
      }
      if (structureTarget.kind === "freezer") {
        setFreezers((current) => current.map((freezer) => freezer.id === structureTarget.id ? { ...freezer, name } : freezer));
      } else {
        setDrawers((current) => current.map((drawer) => drawer.id === structureTarget.id ? { ...drawer, name } : drawer));
      }
      if (backupPending) {
        setSyncState("pending");
        setPendingCount((count) => count + 1);
      }
      setToast(`${structureTarget.kind === "freezer" ? "Freezer" : "Drawer"} renamed`);
      closeSheet();
    } catch (error) {
      setToast(error instanceof Error ? error.message : `Couldn’t rename that ${structureTarget.kind}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleFreezer(freezer: Freezer) {
    if (openFreezerIds.includes(freezer.id)) {
      setOpenFreezerIds((current) => current.filter((id) => id !== freezer.id));
      if (drawers.some((drawer) => drawer.freezerId === freezer.id && drawer.id === openDrawerId)) setOpenDrawerId("");
      return;
    }
    const firstDrawer = drawers
      .filter((drawer) => drawer.freezerId === freezer.id)
      .sort((left, right) => left.position - right.position)[0];
    setActiveFreezerId(freezer.id);
    setOpenFreezerIds((current) => current.includes(freezer.id) ? current : [...current, freezer.id]);
    if (firstDrawer) {
      setOpenDrawerIds((current) => current.includes(firstDrawer.id) ? current : [...current, firstDrawer.id]);
      setOpenDrawerId(firstDrawer.id);
    }
  }

  function toggleDrawer(drawer: Drawer) {
    if (openDrawerIds.includes(drawer.id)) {
      setOpenDrawerIds((current) => current.filter((id) => id !== drawer.id));
      if (openDrawerId === drawer.id) setOpenDrawerId("");
      return;
    }
    setActiveFreezerId(drawer.freezerId);
    setOpenFreezerIds((current) => current.includes(drawer.freezerId) ? current : [...current, drawer.freezerId]);
    setOpenDrawerIds((current) => current.includes(drawer.id) ? current : [...current, drawer.id]);
    setOpenDrawerId(drawer.id);
  }

  function toggleAllHierarchy() {
    if (allHierarchyOpen) {
      setOpenFreezerIds([]);
      setOpenDrawerIds([]);
      setOpenDrawerId("");
      return;
    }
    setOpenFreezerIds(householdFreezerIds);
    setOpenDrawerIds(householdDrawers.map((drawer) => drawer.id));
    if (!householdDrawers.some((drawer) => drawer.id === openDrawerId)) setOpenDrawerId(householdDrawers[0]?.id ?? "");
  }

  function openAdd(drawerId = openDrawerId) {
    keyboard.hide();
    const selectedDrawer = drawers.find((entry) => entry.id === drawerId) ?? activeDrawers[0];
    const selectedFreezerId = selectedDrawer?.freezerId ?? activeFreezer?.id ?? "";
    setDraft(emptyDraft(selectedFreezerId, selectedDrawer?.id ?? ""));
    setEditingItem(null);
    setDeleteArmed(false);
    setSheet("add");
  }

  function openEdit(item: InventoryItem) {
    keyboard.hide();
    setEditingItem(item);
    setDraft({ ...item });
    setDeleteArmed(false);
    setSheet("edit");
  }

  function openPhotoViewer(imageUrl: string, label: string) {
    keyboard.hide();
    setPhotoViewer({ imageUrl, label });
  }

  function closeSheet() {
    keyboard.hide();
    labelGenerationRequestRef.current += 1;
    setSuggesting(false);
    setSheet(null);
    setDeleteArmed(false);
    setAccountDeleteArmed(false);
    setHouseholdDeleteArmed(false);
    setFreezerDeleteArmed(false);
    setDrawerDeleteArmedId(null);
    setMemberRemovalArmedId(null);
    setSettingsView("main");
    setInstallPlatform("choice");
    if (feedbackPhoto) URL.revokeObjectURL(feedbackPhoto.previewUrl);
    setFeedbackPhoto(null);
    setFeedbackPhotoProcessing(false);
  }

  function returnToDefaultInventoryView() {
    keyboard.hide();
    setSearch("");
    setInventoryViewMode("default");
    window.requestAnimationFrame(() => sortButtonRef.current?.focus());
  }

  function chooseInventoryView(mode: InventoryViewMode) {
    setSearch("");
    setInventoryViewMode(mode);
    closeSheet();
  }

  function printInventory() {
    keyboard.hide();
    const activeFreezerIds = new Set(householdFreezers.map((freezer) => freezer.id));
    recordClientEvent("inventory_print_requested", {
      householdId: activeHousehold?.id ?? null,
      itemCount: items.filter((item) => activeFreezerIds.has(item.freezerId)).length,
    });
    setPrintReady(true);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }

  async function chooseFeedbackPhoto(event: ChangeEvent<HTMLInputElement>) {
    const source = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!source) return;
    setFeedbackPhotoProcessing(true);
    try {
      const processed = await processImageFile(source);
      if (feedbackPhoto) URL.revokeObjectURL(feedbackPhoto.previewUrl);
      setFeedbackPhoto({ file: processed.file, previewUrl: URL.createObjectURL(processed.file), original: false });
      recordClientEvent("feedback_photo_prepared", { convertedFromHeic: processed.convertedFromHeic });
    } catch {
      if (feedbackPhoto) URL.revokeObjectURL(feedbackPhoto.previewUrl);
      setFeedbackPhoto({ file: source, previewUrl: URL.createObjectURL(source), original: true });
      setToast("Original photo attached");
      recordClientEvent("feedback_photo_original_fallback", { sourceBytes: source.size, sourceType: source.type || "unknown" }, "warn");
    } finally {
      setFeedbackPhotoProcessing(false);
    }
  }

  function removeFeedbackPhoto() {
    if (feedbackPhoto) URL.revokeObjectURL(feedbackPhoto.previewUrl);
    setFeedbackPhoto(null);
  }

  async function loadHouseholdPeople() {
    if (!activeHousehold) return;
    if (!backendReady) {
      setHouseholdMembers([{ id: user.id, email: user.email, fullName: user.fullName, joinedAt: new Date().toISOString(), isOwner: true }]);
      setHouseholdInvitations([]);
      return;
    }
    setHouseholdPeopleLoading(true);
    try {
      const [membersResult, invitationsResult] = await Promise.all([
        apiRequest<{ members: HouseholdMember[] }>(`/api/households/${activeHousehold.id}/members`),
        apiRequest<{ invitations: HouseholdInvitation[] }>(`/api/households/${activeHousehold.id}/invitations`),
      ]);
      setHouseholdMembers(membersResult.members);
      setHouseholdInvitations(invitationsResult.invitations.filter((invitation) => invitation.status === "pending" && new Date(invitation.expiresAt).getTime() > Date.now()));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn’t load household members");
    } finally {
      setHouseholdPeopleLoading(false);
    }
  }

  function openHouseholdSetup() {
    setHouseholdNameDraft(activeHousehold?.name ?? "");
    setMemberRemovalArmedId(null);
    setSettingsView("household");
    void loadHouseholdPeople();
  }

  async function removeHouseholdMember(member: HouseholdMember) {
    if (Boolean(member.isOwner)) return;
    if (memberRemovalArmedId !== member.id) {
      setMemberRemovalArmedId(member.id);
      return;
    }
    try {
      if (backendReady) await apiRequest(`/api/households/${activeHouseholdId}/members/${member.id}`, { method: "DELETE" });
      setHouseholdMembers((current) => current.filter((entry) => entry.id !== member.id));
      setHouseholds((current) => current.map((household) => household.id === activeHouseholdId ? { ...household, memberCount: Math.max(1, household.memberCount - 1) } : household));
      setMemberRemovalArmedId(null);
      setToast(`${member.fullName || member.email} removed`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn’t remove that member");
    }
  }

  async function revokeHouseholdInvitation(invitation: HouseholdInvitation) {
    try {
      if (backendReady) await apiRequest(`/api/invitations/${invitation.id}/revoke`, { method: "POST", body: "{}" });
      setHouseholdInvitations((current) => current.filter((entry) => entry.id !== invitation.id));
      setToast(`Invitation for ${invitation.email} revoked`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn’t revoke that invitation");
    }
  }

  async function saveItem(completion: "close" | "continue" = "close") {
    if (saving) return;
    if (offline) {
      setToast("Icebox is read-only while offline");
      return;
    }
    const label = draft.label.trim();
    if (!label || !draft.freezerId || !draft.drawerId) {
      setToast("Add a label and choose a drawer");
      return;
    }
    const continueAdding = completion === "continue" && !editingItem;
    setSaving(true);
    const optimistic: InventoryItem = {
      ...draft,
      label,
      id: editingItem?.id ?? crypto.randomUUID(),
      createdAt: editingItem?.createdAt ?? new Date().toISOString(),
      version: editingItem ? editingItem.version + 1 : 1,
    };
    setItems((current) =>
      editingItem ? current.map((item) => (item.id === editingItem.id ? optimistic : item)) : [optimistic, ...current],
    );
    setSyncState("pending");
    setPendingCount((count) => count + 1);
    if (!continueAdding) closeSheet();
    try {
      if (backendReady) {
        const result = editingItem
          ? await apiRequest<{ item: InventoryItem; backupPending: boolean }>(`/api/items/${editingItem.id}`, {
              method: "PATCH",
              body: JSON.stringify({ ...inventoryPayload(optimistic), version: editingItem.version }),
            })
          : await apiRequest<{ item: InventoryItem; backupPending: boolean }>("/api/items", {
              method: "POST",
              body: JSON.stringify(inventoryPayload(optimistic)),
            });
        setItems((current) => current.map((item) => (item.id === optimistic.id ? result.item : item)));
        setSyncState(result.backupPending ? "pending" : "current");
        setPendingCount(result.backupPending ? 1 : 0);
      } else {
        window.setTimeout(() => {
          setSyncState("current");
          setPendingCount(0);
          setLastBackupAt(new Date().toISOString());
        }, 850);
      }
      if (continueAdding) {
        labelGenerationRequestRef.current += 1;
        setSuggesting(false);
        setDraft(emptyDraft(draft.freezerId, draft.drawerId));
        setToast("Item added — ready for the next");
      } else {
        setToast(editingItem ? "Item updated" : "Item added");
      }
    } catch (error) {
      if (backendReady) {
        setItems((current) =>
          editingItem
            ? current.map((item) => (item.id === optimistic.id ? editingItem : item))
            : current.filter((item) => item.id !== optimistic.id),
        );
        setPendingCount((count) => Math.max(0, count - 1));
      }
      setSyncState("attention");
      setToast(error instanceof Error ? error.message : "Couldn’t save changes; reload and try again");
    } finally {
      setSaving(false);
    }
  }

  async function performItemDelete(itemToDelete: InventoryItem, closeEditor = false) {
    if (offline) {
      setToast("Icebox is read-only while offline");
      return;
    }
    const id = itemToDelete.id;
    setItems((current) => current.filter((item) => item.id !== id));
    setSyncState("pending");
    setPendingCount((count) => count + 1);
    if (closeEditor) closeSheet();
    try {
      if (backendReady) {
        const result = await apiRequest<{ backupPending: boolean }>(`/api/items/${id}`, {
          method: "DELETE",
          headers: { "if-match": String(itemToDelete.version) },
        });
        setSyncState(result.backupPending ? "pending" : "current");
      } else {
        window.setTimeout(() => {
          setSyncState("current");
          setPendingCount(0);
          setLastBackupAt(new Date().toISOString());
        }, 850);
      }
      setToast("Item deleted");
    } catch (error) {
      if (backendReady) {
        setItems((current) => current.some((item) => item.id === id) ? current : [itemToDelete, ...current]);
        setPendingCount((count) => Math.max(0, count - 1));
      }
      setSyncState("attention");
      setToast(error instanceof Error ? error.message : "Couldn’t delete; reload and try again");
    }
  }

  async function deleteItem() {
    if (!editingItem) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    await performItemDelete(editingItem, true);
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.currentTarget.value = "";
    const shouldAutoSuggest = user.aiLabelEnabled && !draft.label.trim();
    const previousImageId = draft.imageId;
    const previousImageUrl = draft.imageUrl;
    let previewUrl: string | null = null;
    let uploadErrorCode: string | null = null;
    let serverRequestId: string | null = null;
    setProcessingPhoto(true);
    try {
      const processed = await processImageFile(file);
      recordClientEvent("image_processed", {
        sourceType: file.type || "unknown",
        sourceBytes: file.size,
        outputBytes: processed.file.size,
        thumbnailBytes: processed.thumbnailFile.size,
        width: processed.width,
        height: processed.height,
        convertedFromHeic: processed.convertedFromHeic,
      });
      previewUrl = URL.createObjectURL(processed.file);
      setDraft((current) => {
        return { ...current, imageUrl: previewUrl ?? undefined };
      });
      if (!backendReady) {
        if (previousImageUrl?.startsWith("blob:") && previousImageUrl !== previewUrl) URL.revokeObjectURL(previousImageUrl);
        if (shouldAutoSuggest) void suggestLabel(undefined, true);
        return;
      }
      const form = new FormData();
      form.append("image", processed.file);
      form.append("thumbnail", processed.thumbnailFile);
      form.append("householdId", activeHouseholdId);
      const { response: mediaResponse } = await trackedFetch("/api/media", { method: "POST", body: form });
      if (!mediaResponse.ok) {
        const problem = await mediaResponse.json().catch(() => null) as { requestId?: string; error?: { code?: string; message?: string } } | null;
        uploadErrorCode = problem?.error?.code ?? null;
        serverRequestId = problem?.requestId ?? null;
        throw new Error(problem?.error?.message || "Photo upload failed");
      }
      const media = (await mediaResponse.json()) as { id: string; url: string; thumbnailUrl: string };
      setDraft((current) => {
        if (current.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(current.imageUrl);
        return { ...current, imageId: media.id, imageUrl: media.url, thumbnailUrl: media.thumbnailUrl, thumbnailReady: true };
      });
      if (previousImageUrl?.startsWith("blob:") && previousImageUrl !== previewUrl) URL.revokeObjectURL(previousImageUrl);
      previewUrl = null;
      if (shouldAutoSuggest) void suggestLabel(media.id, true);
    } catch (error) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        const failedPreview = previewUrl;
        setDraft((current) => current.imageUrl === failedPreview
          ? { ...current, imageId: previousImageId, imageUrl: previousImageUrl }
          : current);
      }
      recordClientEvent("image_processing_failed", {
        stage: error instanceof ImageProcessingError ? error.stage : "upload",
        sourceType: file.type || "unknown",
        sourceBytes: file.size,
        error: error instanceof Error ? error.name : "Error",
        code: uploadErrorCode,
        serverRequestId,
      }, "error");
      setToast(error instanceof Error ? error.message : "Couldn’t process that image");
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function suggestLabel(imageId = draft.imageId, onlyIfBlank = false) {
    if (!imageId && backendReady) return;
    const requestId = labelGenerationRequestRef.current + 1;
    labelGenerationRequestRef.current = requestId;
    setSuggesting(true);
    try {
      if (backendReady && imageId) {
        const result = await apiRequest<{ label: string; confidence: number }>("/api/ai/label", {
          method: "POST",
          body: JSON.stringify({ imageId, householdId: activeHouseholdId }),
        });
        if (labelGenerationRequestRef.current !== requestId) return;
        setDraft((current) => onlyIfBlank && current.label.trim() ? current : { ...current, label: result.label });
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        if (labelGenerationRequestRef.current !== requestId) return;
        setDraft((current) => onlyIfBlank && current.label.trim() ? current : { ...current, label: "Homemade freezer meal" });
      }
    } catch {
      if (labelGenerationRequestRef.current === requestId) setToast("Couldn’t suggest a label — type one instead");
    } finally {
      if (labelGenerationRequestRef.current === requestId) setSuggesting(false);
    }
  }

  async function toggleAiLabel() {
    const next = !user.aiLabelEnabled;
    setUser((current) => ({ ...current, aiLabelEnabled: next }));
    try {
      if (backendReady) {
        await apiRequest("/api/me/preferences", {
          method: "PATCH",
          body: JSON.stringify({ aiLabelEnabled: next }),
        });
      }
    } catch {
      setToast("Preference will sync when you’re online");
    }
  }

  async function submitFeedback() {
    const message = feedbackText.trim();
    if (!message) {
      setToast("Tell us what happened or what you’d like changed");
      return;
    }
    if (!backendReady || offline) {
      setToast("Feedback needs a connection so diagnostics can be attached");
      return;
    }
    setFeedbackSending(true);
    try {
      recordClientEvent("feedback_submit_started", { sheet: "feedback" });
      const payload = {
        sessionId: getClientSessionId(),
        householdId: activeHousehold?.id || null,
        message,
        context: feedbackDeviceContext({
          activeHouseholdId: activeHousehold?.id || null,
          activeFreezerId: activeFreezer?.id || null,
          openDrawerId: openDrawerId || null,
          sheet: "feedback",
          sortMode: inventoryViewMode,
          searchActive,
          itemCount: items.length,
          syncState,
          pendingBackupCount: pendingCount,
        }),
        recentEvents: getRecentClientEvents(50),
      };
      const result = await apiRequest<{ id: string; reference: string }>("/api/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const selectedFeedbackPhoto = feedbackPhoto;
      if (selectedFeedbackPhoto) {
        await apiRequest(`/api/feedback/${result.id}/photo`, {
          method: "POST",
          headers: {
            "content-type": selectedFeedbackPhoto.file.type || "application/octet-stream",
            "x-icebox-file-size": String(selectedFeedbackPhoto.file.size),
          },
          body: selectedFeedbackPhoto.file,
        });
      }
      removeFeedbackPhoto();
      setFeedbackReference(result.reference);
      setFeedbackText("");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Feedback could not be sent");
    } finally {
      setFeedbackSending(false);
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim().toLocaleLowerCase();
    if (!email.includes("@")) {
      setToast("Enter a valid ChatGPT account email");
      return;
    }
    try {
      if (backendReady) {
        await apiRequest(`/api/households/${activeHouseholdId}/invitations`, {
          method: "POST",
          body: JSON.stringify({ email }),
        });
      }
      setInviteEmail("");
      setToast("Invitation added");
      setSheet("settings");
      setSettingsView("household");
      await loadHouseholdPeople();
    } catch {
      setToast("Couldn’t add that invitation");
    }
  }

  async function createHousehold() {
    const name = newHouseholdName.trim();
    if (!name) {
      setToast("Give the household a name");
      return;
    }
    const ownedHouseholds = households.filter((household) => household.ownerUserId === user.id || !backendReady).length;
    if (ownedHouseholds >= 3) {
      setToast("You can create up to three households");
      return;
    }
    try {
      let householdId: string = crypto.randomUUID();
      let freezerId: string = crypto.randomUUID();
      let drawerId: string = crypto.randomUUID();
      if (backendReady) {
        const result = await apiRequest<{ household: Household; freezers: Freezer[]; drawers: Drawer[] }>("/api/households", {
          method: "POST",
          body: JSON.stringify({ name, freezers: [{ name: "Freezer 1", drawerCount: 1 }] }),
        });
        householdId = result.household.id;
        freezerId = result.freezers[0].id;
        drawerId = result.drawers[0].id;
      }
      const household = { id: householdId, name, ownerUserId: user.id, ownerEmail: user.email, memberCount: 1 };
      setHouseholds((current) => [...current, household]);
      setFreezers((current) => [...current, { id: freezerId, householdId, name: "Freezer 1", position: 1, defaultSortMode: "added" }]);
      setDrawers((current) => [...current, { id: drawerId, freezerId, name: "Drawer 1", position: 1, defaultSortMode: "added" }]);
      setActiveHouseholdId(householdId);
      setActiveFreezerId(freezerId);
      openSingleHierarchy(freezerId, drawerId);
      setNewHouseholdName("");
      closeSheet();
    } catch {
      setToast("Couldn’t create that household");
    }
  }

  async function completeInduction() {
    const name = inductionName.trim();
    if (!name) {
      setToast("Give your household a name");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ household: Household; freezers: Freezer[]; drawers: Drawer[] }>("/api/households", {
        method: "POST",
        body: JSON.stringify({ name, freezers: inductionFreezers }),
      });
      const household = { ...result.household, ownerEmail: user.email };
      setHouseholds([household]);
      setFreezers(result.freezers);
      setDrawers(result.drawers);
      setActiveHouseholdId(household.id);
      setActiveFreezerId(result.freezers[0]?.id ?? "");
      openSingleHierarchy(result.freezers[0]?.id ?? "", result.drawers[0]?.id ?? "");
      setToast("Household ready");
    } catch {
      setToast("Couldn’t finish household setup");
    } finally {
      setSaving(false);
    }
  }

  async function respondToInvitation(invitation: Invitation, action: "accept" | "decline") {
    try {
      await apiRequest(`/api/invitations/${invitation.id}/${action}`, { method: "POST", body: "{}" });
      const data = await apiRequest<BootstrapResponse>("/api/bootstrap");
      applyBootstrap(data);
      void saveCachedBootstrap(data);
      setToast(action === "accept" ? `${invitation.householdName} added` : "Invitation declined");
    } catch {
      setToast("Couldn’t update that invitation");
    }
  }

  async function signOut() {
    await clearPrivateCache();
    window.location.assign(`/signout-with-chatgpt?return_to=${encodeURIComponent(window.location.origin)}`);
  }

  function openFreezerEditor(freezer: Freezer) {
    setEditingFreezer(freezer);
    setFreezerDeleteArmed(false);
    setDrawerDeleteArmedId(null);
    setStructureDraft({
      name: freezer.name,
      drawers: drawers.filter((drawer) => drawer.freezerId === freezer.id).sort((left, right) => left.position - right.position),
    });
    setSheet("edit-freezer");
  }

  function openNewFreezerEditor() {
    if (householdFreezers.length >= 6) {
      setToast("A household can have up to six freezers");
      return;
    }
    const position = householdFreezers.length + 1;
    setEditingFreezer(null);
    setFreezerDeleteArmed(false);
    setDrawerDeleteArmedId(null);
    setStructureDraft({
      name: `Freezer ${position}`,
      drawers: [{ id: `new-${crypto.randomUUID()}`, freezerId: "", name: "Drawer 1", position: 1 }],
    });
    setSheet("edit-freezer");
  }

  function removeDrawerFromDraft(drawer: Drawer) {
    if (structureDraft.drawers.length <= 1) {
      setToast("A freezer needs at least one drawer");
      return;
    }
    if (!drawer.id.startsWith("new-") && drawerDeleteArmedId !== drawer.id) {
      setDrawerDeleteArmedId(drawer.id);
      return;
    }
    setStructureDraft((current) => ({ ...current, drawers: current.drawers.filter((entry) => entry.id !== drawer.id) }));
    setDrawerDeleteArmedId(null);
  }

  async function deleteFreezer() {
    if (!editingFreezer) return;
    if (householdFreezers.length <= 1) {
      setToast("A household needs at least one freezer");
      return;
    }
    if (!freezerDeleteArmed) {
      setFreezerDeleteArmed(true);
      return;
    }
    setSaving(true);
    try {
      if (backendReady) {
        const hasItems = items.some((item) => item.freezerId === editingFreezer.id);
        await apiRequest(`/api/freezers/${editingFreezer.id}${hasItems ? "?deleteItems=true" : ""}`, { method: "DELETE" });
        const data = await apiRequest<BootstrapResponse>("/api/bootstrap");
        applyBootstrap(data);
        void saveCachedBootstrap(data);
      } else {
        const remainingFreezers = householdFreezers.filter((freezer) => freezer.id !== editingFreezer.id);
        const nextFreezer = remainingFreezers[0];
        const removedDrawerIds = new Set(drawers.filter((drawer) => drawer.freezerId === editingFreezer.id).map((drawer) => drawer.id));
        setFreezers((current) => current.filter((freezer) => freezer.id !== editingFreezer.id));
        setDrawers((current) => current.filter((drawer) => drawer.freezerId !== editingFreezer.id));
        setItems((current) => current.filter((item) => !removedDrawerIds.has(item.drawerId)));
        if (nextFreezer) {
          const nextDrawer = drawers.find((drawer) => drawer.freezerId === nextFreezer.id);
          setActiveFreezerId(nextFreezer.id);
          openSingleHierarchy(nextFreezer.id, nextDrawer?.id ?? "");
        } else {
          openSingleHierarchy("", "");
        }
      }
      setFreezerDeleteArmed(false);
      setToast("Freezer deleted");
      setSheet("settings");
      setSettingsView("freezer");
    } catch {
      setFreezerDeleteArmed(false);
      setToast("Couldn’t delete that freezer");
    } finally {
      setSaving(false);
    }
  }

  async function saveFreezerStructure() {
    if (!structureDraft.name.trim() || structureDraft.drawers.length < 1 || !activeHousehold) return;
    setSaving(true);
    try {
      if (backendReady) {
        let createdFreezer: Freezer | null = null;
        if (editingFreezer) {
          const original = drawers.filter((drawer) => drawer.freezerId === editingFreezer.id);
          for (const drawer of original.filter((entry) => !structureDraft.drawers.some((candidate) => candidate.id === entry.id))) {
            const hasItems = items.some((item) => item.drawerId === drawer.id);
            await apiRequest(`/api/drawers/${drawer.id}${hasItems ? "?deleteItems=true" : ""}`, { method: "DELETE" });
          }
          await apiRequest(`/api/freezers/${editingFreezer.id}`, { method: "PATCH", body: JSON.stringify({ name: structureDraft.name }) });
          for (const drawer of structureDraft.drawers.filter((entry) => original.some((candidate) => candidate.id === entry.id))) {
            const before = original.find((candidate) => candidate.id === drawer.id);
            if (before?.name !== drawer.name) await apiRequest(`/api/drawers/${drawer.id}`, { method: "PATCH", body: JSON.stringify({ name: drawer.name }) });
          }
          for (const drawer of structureDraft.drawers.filter((entry) => entry.id.startsWith("new-"))) {
            await apiRequest(`/api/freezers/${editingFreezer.id}/drawers`, { method: "POST", body: JSON.stringify({ name: drawer.name }) });
          }
        } else {
          const result = await apiRequest<{ freezer: Freezer; drawers: Drawer[] }>(`/api/households/${activeHousehold.id}/freezers`, {
            method: "POST",
            body: JSON.stringify({
              name: structureDraft.name.trim(),
              drawerNames: structureDraft.drawers.map((drawer, index) => drawer.name.trim() || `Drawer ${index + 1}`),
            }),
          });
          createdFreezer = result.freezer;
        }
        const data = await apiRequest<BootstrapResponse>("/api/bootstrap");
        applyBootstrap(data);
        void saveCachedBootstrap(data);
        if (createdFreezer) {
          const firstDrawer = data.drawers.find((drawer) => drawer.freezerId === createdFreezer.id);
          setActiveFreezerId(createdFreezer.id);
          openSingleHierarchy(createdFreezer.id, firstDrawer?.id ?? "");
        }
      } else {
        if (editingFreezer) {
          const retainedDrawerIds = new Set(structureDraft.drawers.filter((drawer) => !drawer.id.startsWith("new-")).map((drawer) => drawer.id));
          setFreezers((current) => current.map((freezer) => freezer.id === editingFreezer.id ? { ...freezer, name: structureDraft.name.trim() } : freezer));
          setDrawers((current) => [
            ...current.filter((drawer) => drawer.freezerId !== editingFreezer.id),
            ...structureDraft.drawers.map((drawer, index) => ({ ...drawer, id: drawer.id.startsWith("new-") ? crypto.randomUUID() : drawer.id, name: drawer.name || `Drawer ${index + 1}`, position: index + 1, defaultSortMode: drawer.defaultSortMode ?? editingFreezer.defaultSortMode ?? "added" })),
          ]);
          setItems((current) => current.filter((item) => item.freezerId !== editingFreezer.id || retainedDrawerIds.has(item.drawerId)));
        } else {
          const freezerId = crypto.randomUUID();
          const createdDrawers = structureDraft.drawers.map((drawer, index) => ({ ...drawer, id: crypto.randomUUID(), freezerId, name: drawer.name || `Drawer ${index + 1}`, position: index + 1, defaultSortMode: "added" as const }));
          setFreezers((current) => [...current, { id: freezerId, householdId: activeHousehold.id, name: structureDraft.name.trim(), position: householdFreezers.length + 1, defaultSortMode: "added" }]);
          setDrawers((current) => [...current, ...createdDrawers]);
          setActiveFreezerId(freezerId);
          openSingleHierarchy(freezerId, createdDrawers[0]?.id ?? "");
        }
      }
      setDrawerDeleteArmedId(null);
      setToast(editingFreezer ? "Freezer setup updated" : "Freezer added");
      setSheet("settings");
      setSettingsView("freezer");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn’t update freezer setup");
    } finally {
      setSaving(false);
    }
  }

  async function saveHouseholdName() {
    const name = householdNameDraft.trim();
    if (!activeHousehold || !name) return;
    try {
      if (backendReady) await apiRequest(`/api/households/${activeHousehold.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setHouseholds((current) => current.map((household) => household.id === activeHousehold.id ? { ...household, name } : household));
      setToast("Household renamed");
    } catch {
      setToast("Couldn’t rename that household");
    }
  }

  async function deleteHousehold() {
    if (!activeHousehold) return;
    if (!householdDeleteArmed) {
      setHouseholdDeleteArmed(true);
      return;
    }
    try {
      if (backendReady) await apiRequest(`/api/households/${activeHousehold.id}`, { method: "DELETE" });
      const remaining = households.filter((household) => household.id !== activeHousehold.id);
      setHouseholds(remaining);
      setFreezers((current) => current.filter((freezer) => freezer.householdId !== activeHousehold.id));
      setItems((current) => current.filter((item) => !householdFreezers.some((freezer) => freezer.id === item.freezerId)));
      if (remaining[0]) chooseHousehold(remaining[0].id);
      else closeSheet();
      setToast("Household deleted");
    } catch {
      setToast("Only the owner can delete this household");
    }
  }

  async function deleteAccount() {
    if (!accountDeleteArmed) {
      setAccountDeleteArmed(true);
      return;
    }
    try {
      if (backendReady) await apiRequest("/api/me", { method: "DELETE" });
      await clearPrivateCache();
      window.location.assign(`/signout-with-chatgpt?return_to=${encodeURIComponent(window.location.origin)}`);
    } catch {
      setToast("Transfer or delete the households you own first");
    }
  }

  function chooseHousehold(householdId: string) {
    const firstFreezer = freezers.find((freezer) => freezer.householdId === householdId);
    const firstDrawer = drawers.find((drawer) => drawer.freezerId === firstFreezer?.id);
    setActiveHouseholdId(householdId);
    if (firstFreezer) {
      setActiveFreezerId(firstFreezer.id);
      openSingleHierarchy(firstFreezer.id, firstDrawer?.id ?? "");
    } else {
      openSingleHierarchy("", "");
    }
    setSearch("");
    setInventoryViewMode("default");
    closeSheet();
  }

  const openDrawer = drawers.find((drawer) => drawer.id === openDrawerId);
  const selectedStructure = structureTarget?.kind === "freezer"
    ? freezers.find((freezer) => freezer.id === structureTarget.id)
    : drawers.find((drawer) => drawer.id === structureTarget?.id);
  const selectedStructureSortMode = selectedStructure?.defaultSortMode ?? "added";

  if (bootstrapState !== "ready") {
    return (
      <MobileScroll className="app-screen">
        <main className="bootstrap-screen" aria-live="polite" aria-busy={bootstrapState === "loading"}>
          <img className="bootstrap-icon" src="/icons/icon-192.png" alt="" />
          <p className="brand-name">Icebox</p>
          {bootstrapState === "loading" ? (
            <>
              <span className="bootstrap-spinner" aria-hidden="true" />
              <strong>Opening Icebox…</strong>
              <span>Loading your household inventory</span>
            </>
          ) : (
            <>
              <strong>Icebox couldn’t load</strong>
              <span>Check your connection and try again.</span>
              <button className="save-button bootstrap-retry" type="button" onClick={() => window.location.reload()}>Try again</button>
            </>
          )}
        </main>
      </MobileScroll>
    );
  }

  if (backendReady && households.length === 0) {
    return (
      <MobileScroll className="app-screen">
        <main className="induction-screen" aria-label="Set up Icebox">
          <img className="induction-icon" src="/icons/icon-192.png" alt="" />
          <p className="brand-name">Icebox</p>
          {invitations.length > 0 ? (
            <section className="induction-card">
              <p className="eyebrow">You’re invited</p>
              <h1>{invitations[0].householdName}</h1>
              <p>{invitations[0].invitedBy} has invited your ChatGPT account to share this freezer inventory.</p>
              <div className="induction-actions">
                <button type="button" className="secondary-button" onClick={() => respondToInvitation(invitations[0], "decline")}>Decline</button>
                <button type="button" className="save-button" onClick={() => respondToInvitation(invitations[0], "accept")}>Accept invitation</button>
              </div>
            </section>
          ) : (
            <section className="induction-card">
              <p className="eyebrow">Set up your household</p>
              <h1>Where do these freezers live?</h1>
              <label className="form-field">
                <span>Household name</span>
                <KeyboardInput value={inductionName} onChange={(event) => setInductionName(event.currentTarget.value)} placeholder="e.g. Alder House" maxLength={60} />
              </label>
              <div className="induction-freezers">
                {inductionFreezers.map((freezer, index) => (
                  <div className="induction-freezer" key={index}>
                    <label>
                      <span>Freezer {index + 1}</span>
                      <KeyboardInput value={freezer.name} maxLength={60} onChange={(event) => {
                        const name = event.currentTarget.value;
                        setInductionFreezers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name } : entry));
                      }} />
                    </label>
                    <label>
                      <span>Drawers</span>
                      <select value={freezer.drawerCount} onChange={(event) => {
                        const drawerCount = Number(event.currentTarget.value);
                        setInductionFreezers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, drawerCount } : entry));
                      }}>
                        {Array.from({ length: 8 }, (_, option) => <option key={option + 1} value={option + 1}>{option + 1}</option>)}
                      </select>
                    </label>
                    {inductionFreezers.length > 1 ? <button type="button" aria-label={`Remove freezer ${index + 1}`} onClick={() => setInductionFreezers((current) => current.filter((_, entryIndex) => entryIndex !== index))}><TrashIcon /></button> : null}
                  </div>
                ))}
              </div>
              {inductionFreezers.length < 6 ? <button type="button" className="add-structure-button" onClick={() => setInductionFreezers((current) => [...current, { name: `Freezer ${current.length + 1}`, drawerCount: 3 }])}><PlusIcon /> Add another freezer</button> : null}
              <button type="button" className="save-button induction-save" disabled={saving} onClick={completeInduction}>{saving ? "Setting up…" : "Finish setup"}</button>
            </section>
          )}
        </main>
        {toast ? <div className="toast" role="status">{toast}</div> : null}
      </MobileScroll>
    );
  }

  return (
    <>
      <MobileScroll className="app-screen">
        <main className="icebox-app" data-testid="icebox-app" aria-label="Icebox freezer inventory">
          <header className="app-header">
            <div className="brand-row">
              <div className="brand-lockup">
                <div className="brand-wordmark">
                  <p className="brand-name">Icebox</p>
                  <img className="brand-corner-icon" src="/icons/icon-192.png" alt="" aria-hidden="true" />
                </div>
                <p className="brand-subtitle">Your freezer, but organised</p>
              </div>
              <div className="header-actions">
                <button
                  className="header-menu-button household-indicator"
                  type="button"
                  aria-label={`Open settings for ${activeHousehold?.name ?? "household"}`}
                  onClick={() => setSheet("settings")}
                >
                  <HomeIcon aria-hidden="true" />
                  <span>{activeHousehold?.name ?? "Household"}</span>
                  <span className="header-menu-icon" aria-hidden="true"><HamburgerMenuIcon /></span>
                </button>
              </div>
            </div>

            {invitations.length > 0 ? (
              <section className="invitation-banner" aria-label="Pending household invitations">
                <PersonIcon aria-hidden="true" />
                <div>
                  <strong>{invitations[0].householdName}</strong>
                  <span>{invitations[0].invitedBy} invited you</span>
                </div>
                <button type="button" onClick={() => respondToInvitation(invitations[0], "accept")}>Accept</button>
              </section>
            ) : null}

            <div className="search-and-sort">
              <label className="search-box" htmlFor="inventory-search">
                <MagnifyingGlassIcon aria-hidden="true" />
                <KeyboardInput
                  id="inventory-search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search items"
                  aria-label="Search inventory"
                />
                {search ? (
                  <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>
                    <Cross2Icon aria-hidden="true" />
                  </button>
                ) : null}
              </label>
              <button ref={sortButtonRef} className="sort-button" type="button" onClick={() => setSheet("sort")} aria-label={`Sort inventory: ${inventoryViewLabels[inventoryViewMode]}`}>
                <MixerHorizontalIcon aria-hidden="true" />
                <span>Sort</span>
              </button>
              <button className="hierarchy-toggle" type="button" onClick={toggleAllHierarchy} aria-label={`${allHierarchyOpen ? "Close" : "Open"} all freezers and drawers`}>
                {allHierarchyOpen ? <DoubleArrowUpIcon aria-hidden="true" /> : <DoubleArrowDownIcon aria-hidden="true" />}
                <span>{allHierarchyOpen ? "Close all" : "Open all"}</span>
              </button>
            </div>
          </header>

          {flatInventoryActive ? (
            <InventoryResultsView
              eyebrow={searchActive ? "Search results" : inventoryViewLabels[inventoryViewMode]}
              items={inventoryResults}
              freezers={householdFreezers}
              drawers={drawers}
              emptyTitle={searchActive ? "No matching items" : "No items in this household"}
              emptyMessage={searchActive ? "Try a label, ingredient, or note." : "Add an item to a freezer drawer to see it here."}
              showSearchIcon={searchActive}
              onDone={returnToDefaultInventoryView}
              onDelete={performItemDelete}
              onOpen={openEdit}
              onViewPhoto={openPhotoViewer}
            />
          ) : (
            <section className="freezer-section">
              <div className="freezer-accordion" aria-label={`${activeHousehold?.name ?? "Household"} freezers`}>
                {householdFreezers.map((freezer, freezerIndex) => {
                  const freezerDrawers = drawers
                    .filter((drawer) => drawer.freezerId === freezer.id)
                    .sort((left, right) => left.position - right.position);
                  const isFreezerOpen = openFreezerIds.includes(freezer.id);
                  return (
                    <article className="freezer-panel" data-open={isFreezerOpen ? "true" : "false"} key={freezer.id}>
                      <div className="structure-band-shell">
                        <button
                          className="freezer-band"
                          type="button"
                          aria-expanded={isFreezerOpen}
                          onClick={() => toggleFreezer(freezer)}
                        >
                          <span className="freezer-icon"><img src="/icons/upright-freezer.svg" alt="" aria-hidden="true" /></span>
                          <span className="freezer-copy"><strong>{freezer.name}</strong></span>
                          <span className="freezer-count">{freezerDrawers.length} {freezerDrawers.length === 1 ? "drawer" : "drawers"}</span>
                          {isFreezerOpen ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
                        </button>
                        <StructureMenu
                          label={freezer.name}
                          kind="freezer"
                          onAction={(action) => openStructureAction({ kind: "freezer", id: freezer.id }, action)}
                        />
                      </div>
                      {isFreezerOpen ? (
                        <div className="freezer-panel-content">
                          <div className="drawer-stack" aria-label={`${freezer.name} drawers`}>
                            {freezerDrawers.map((drawer) => {
                              const drawerInventory = drawerItems(drawer);
                              const isDrawerOpen = openDrawerIds.includes(drawer.id);
                              return (
                                <article className={`drawer ${isDrawerOpen ? "drawer-open" : ""}`} key={drawer.id}>
                                  <div className="structure-band-shell">
                                    <button
                                      className="drawer-band"
                                      type="button"
                                      aria-expanded={isDrawerOpen}
                                      aria-label={drawer.name}
                                      onClick={() => toggleDrawer(drawer)}
                                    >
                                      <span className="drawer-icon"><BoxIcon aria-hidden="true" /><MinusIcon aria-hidden="true" /></span>
                                      <span className="drawer-title">{drawer.name}</span>
                                      <span className="drawer-count" aria-hidden="true">{drawerInventory.length} {drawerInventory.length === 1 ? "item" : "items"}</span>
                                      {isDrawerOpen ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
                                    </button>
                                    <StructureMenu
                                      label={drawer.name}
                                      kind="drawer"
                                      onAction={(action) => openStructureAction({ kind: "drawer", id: drawer.id }, action)}
                                    />
                                  </div>
                                  {isDrawerOpen ? (
                                    <div className="item-list" data-testid="open-drawer-items">
                                      {drawerInventory.length ? (
                                        drawerInventory.map((item) => (
                                          <SwipeDeleteRow key={item.id} label={item.label} onDelete={() => performItemDelete(item)}>
                                            <ItemRow item={item} onOpen={() => openEdit(item)} onViewPhoto={openPhotoViewer} />
                                          </SwipeDeleteRow>
                                        ))
                                      ) : (
                                        <div className="empty-drawer">
                                          <strong>This drawer is empty</strong>
                                          <button type="button" onClick={() => openAdd(drawer.id)}>Add first item</button>
                                        </div>
                                      )}
                                    </div>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      </MobileScroll>

      {printReady ? (
        <PrintInventory
          household={activeHousehold}
          freezers={householdFreezers}
          drawers={drawers}
          items={items}
        />
      ) : null}

      {sheet === null ? (
        <div className="primary-action-wrap">
          <button className="primary-action" type="button" onClick={() => openAdd()} disabled={offline} data-testid="add-item-button">
            <PlusIcon aria-hidden="true" />
            <span>Add item{!flatInventoryActive && openDrawer ? ` to ${openDrawer.name}` : ""}</span>
          </button>
        </div>
      ) : null}

      <BottomSheet
        open={sheet === "add" || sheet === "edit"}
        onOpenChange={(open) => !open && closeSheet()}
        title={sheet === "edit" ? "Edit item" : "Add an item"}
        description={sheet === "edit" ? "Update the label, date, notes, photo, or location." : "Add a clear label so everyone can find it later."}
        snap={0.88}
      >
        <ItemForm
          draft={draft}
          setDraft={setDraft}
          freezers={householdFreezers}
          drawers={drawers}
          aiLabelEnabled={user.aiLabelEnabled}
          suggesting={suggesting}
          processingPhoto={processingPhoto}
          saving={saving}
          deleteArmed={deleteArmed}
          isEditing={sheet === "edit"}
          onPhoto={handlePhoto}
          onSuggest={() => suggestLabel()}
          onViewPhoto={openPhotoViewer}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "sort"}
        onOpenChange={(open) => !open && closeSheet()}
        title="Sort inventory"
        description="View all household items in a flat list, or return to your freezers and drawers."
        snap={0.72}
      >
        <div className="sort-options" role="radiogroup" aria-label="Inventory view">
          {([
            { mode: "expiry" as const, icon: <CalendarIcon aria-hidden="true" />, detail: "Dates set soonest first; items without an expiry date appear last" },
            { mode: "alphabetical" as const, icon: <LetterCaseCapitalizeIcon aria-hidden="true" />, detail: "Label from A to Z" },
            { mode: "added" as const, icon: <PlusIcon aria-hidden="true" />, detail: "Most recently added first" },
            { mode: "default" as const, icon: <HomeIcon aria-hidden="true" />, detail: "Browse by freezer and drawer" },
          ]).map((option) => (
            <button
              key={option.mode}
              className="sort-option"
              type="button"
              role="radio"
              aria-checked={inventoryViewMode === option.mode}
              data-active={inventoryViewMode === option.mode ? "true" : "false"}
              data-default={option.mode === "default" ? "true" : "false"}
              onClick={() => chooseInventoryView(option.mode)}
            >
              <span className="sort-option-icon">{option.icon}</span>
              <span><strong>{inventoryViewLabels[option.mode]}</strong><small>{option.detail}</small></span>
              {inventoryViewMode === option.mode ? <CheckCircledIcon aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "structure-sort"}
        onOpenChange={(open) => !open && closeSheet()}
        title={`Sort ${selectedStructure?.name ?? structureTarget?.kind ?? "items"}`}
        description={structureTarget?.kind === "freezer" ? "Choose the default order for every drawer in this freezer." : "Choose the default order for items in this drawer."}
        snap={0.62}
      >
        <div className="sort-options structure-sort-options" role="radiogroup" aria-label="Default sort order">
          {([
            { mode: "expiry" as const, icon: <CalendarIcon aria-hidden="true" />, detail: "Dates set soonest first; items without an expiry date appear last" },
            { mode: "alphabetical" as const, icon: <LetterCaseCapitalizeIcon aria-hidden="true" />, detail: "Label from A to Z" },
            { mode: "added" as const, icon: <PlusIcon aria-hidden="true" />, detail: "Most recently added first" },
          ]).map((option) => (
            <button
              key={option.mode}
              className="sort-option"
              type="button"
              role="radio"
              aria-checked={selectedStructureSortMode === option.mode}
              data-active={selectedStructureSortMode === option.mode ? "true" : "false"}
              disabled={saving}
              onClick={() => void updateStructureSort(option.mode)}
            >
              <span className="sort-option-icon">{option.icon}</span>
              <span><strong>{inventoryViewLabels[option.mode]}</strong><small>{option.detail}</small></span>
              {selectedStructureSortMode === option.mode ? <CheckCircledIcon aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "structure-rename"}
        onOpenChange={(open) => !open && closeSheet()}
        title={`Rename ${structureTarget?.kind ?? "item"}`}
        description={`Update the name shown throughout this household.`}
        snap={0.46}
      >
        <div className="inline-form structure-rename-form">
          <label htmlFor="structure-rename-field">{structureTarget?.kind === "freezer" ? "Freezer name" : "Drawer name"}</label>
          <KeyboardInput
            id="structure-rename-field"
            value={structureRenameDraft}
            maxLength={60}
            onChange={(event) => setStructureRenameDraft(event.currentTarget.value)}
          />
          <button className="primary-sheet-button" type="button" disabled={saving || !structureRenameDraft.trim()} onClick={() => void saveStructureRename()}>{saving ? "Saving…" : "Save name"}</button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "settings"}
        onOpenChange={(open) => !open && closeSheet()}
        title={settingsView === "main" ? "Settings" : settingsView === "freezer" ? "Freezer setup" : settingsView === "household" ? "Household setup" : "Your account"}
        description={settingsView === "main" ? "Manage Icebox for this account and household." : undefined}
        snap={0.82}
      >
        {settingsView === "main" ? (
          <div className="settings-list">
            <button className="settings-profile" type="button" onClick={() => setSettingsView("account")}>
              <span className="avatar"><PersonIcon aria-hidden="true" /></span>
              <span><strong>{user.fullName}</strong><small>{user.email}</small></span>
              <ChevronRightIcon aria-hidden="true" />
            </button>
            <div className="settings-group">
              <button className="settings-row" type="button" onClick={toggleAiLabel}>
                <span><MagicWandIcon aria-hidden="true" /><span><strong>Photo label suggestions</strong><small>Use AI to suggest an editable label</small></span></span>
                <span className="toggle" data-on={user.aiLabelEnabled ? "true" : "false"} aria-label={user.aiLabelEnabled ? "On" : "Off"}><i /></span>
              </button>
              <button className="settings-row" type="button" onClick={() => setSettingsView("freezer")}>
                <span><ArchiveIcon aria-hidden="true" /><span><strong>Freezer setup</strong><small>Freezers and drawers</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={openHouseholdSetup}>
                <span><PersonIcon aria-hidden="true" /><span><strong>Household setup</strong><small>Name, members, and invitations</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={() => setSheet("households")}>
                <span><HomeIcon aria-hidden="true" /><span><strong>Households</strong><small>Switch household or create a new one</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={printInventory}>
                <span><FileTextIcon aria-hidden="true" /><span><strong>Print Inventory</strong><small>Print or save this household as a PDF</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={() => { removeFeedbackPhoto(); setFeedbackText(""); setFeedbackReference(null); setSheet("feedback"); }}>
                <span><ChatBubbleIcon aria-hidden="true" /><span><strong>Add feedback</strong><small>Send a note with private diagnostics</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={() => { setInstallPlatform("choice"); setSheet("install"); }}>
                <span><DownloadIcon aria-hidden="true" /><span><strong>Add to Home Screen</strong><small>Install Icebox on this device</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </div>
            <div className={`backup-card sync-${syncState}`} data-testid="backup-status">
              <CheckCircledIcon aria-hidden="true" />
              <div>
                <strong>{syncState === "current" ? "Inventory backup is current" : syncState === "pending" ? `Inventory backup is pending${pendingCount ? ` · ${pendingCount}` : ""}` : "Inventory backup needs attention"}</strong>
                <span>{offline ? "Offline · read only" : `Private operator-owned Google Sheet · ${syncState === "current" ? shortTime(lastBackupAt) : "will retry"}`}</span>
              </div>
            </div>
            <p className="privacy-note">The private pilot operator can access household inventory through the recovery spreadsheet. Photos are not copied to Google Drive.</p>
          </div>
        ) : settingsView === "freezer" ? (
          <div className="settings-list">
            <div className="settings-group compact">
              {householdFreezers.map((freezer) => (
                <div className="structure-row" key={freezer.id}>
                  <div><strong>{freezer.name}</strong><small>{drawers.filter((drawer) => drawer.freezerId === freezer.id).length} drawers</small></div>
                  <button type="button" aria-label={`Edit ${freezer.name}`} onClick={() => openFreezerEditor(freezer)}><Pencil1Icon aria-hidden="true" /></button>
                </div>
              ))}
            </div>
            {householdFreezers.length < 6 ? (
              <button className="secondary-button add-freezer-button" type="button" onClick={openNewFreezerEditor}><PlusIcon aria-hidden="true" /> Add freezer</button>
            ) : null}
            <p className="structure-help">Open a freezer to rename it or manage its drawers. Drawer removals are confirmed, then applied when you save.</p>
            <button className="text-button" type="button" onClick={() => setSettingsView("main")}>Back to settings</button>
          </div>
        ) : settingsView === "household" ? (
          <div className="settings-list">
            <div className="inline-form household-name-form">
              <label htmlFor="household-name-setting">Household name</label>
              <KeyboardInput id="household-name-setting" value={householdNameDraft} maxLength={60} onChange={(event) => setHouseholdNameDraft(event.currentTarget.value)} />
              <button className="secondary-button" type="button" onClick={saveHouseholdName}>Save name</button>
            </div>
            <div className="household-people-heading">
              <div><strong>Members</strong><small>{activeHousehold?.memberCount ?? householdMembers.length} in this household</small></div>
              <button className="secondary-button" type="button" onClick={() => setSheet("invite")}><PlusIcon aria-hidden="true" /> Invite</button>
            </div>
            {householdPeopleLoading ? <p className="household-people-status">Loading household members…</p> : (
              <div className="settings-group compact household-people-list">
                {householdMembers.map((member) => (
                  <div className="household-person-row" key={member.id}>
                    <span className="avatar"><PersonIcon aria-hidden="true" /></span>
                    <div><strong>{member.fullName || member.email}</strong><small>{member.email}{Boolean(member.isOwner) ? " · Owner" : ""}</small></div>
                    {!Boolean(member.isOwner) ? (
                      <button className={memberRemovalArmedId === member.id ? "armed" : ""} type="button" onClick={() => void removeHouseholdMember(member)} aria-label={`${memberRemovalArmedId === member.id ? "Confirm removal of" : "Remove"} ${member.email}`}>
                        {memberRemovalArmedId === member.id ? "Confirm" : <TrashIcon aria-hidden="true" />}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {householdInvitations.length ? (
              <div className="household-invitations">
                <strong>Pending invitations</strong>
                <div className="settings-group compact household-people-list">
                  {householdInvitations.map((invitation) => (
                    <div className="household-person-row" key={invitation.id}>
                      <span className="avatar"><PersonIcon aria-hidden="true" /></span>
                      <div><strong>{invitation.email}</strong><small>Expires {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(invitation.expiresAt))}</small></div>
                      <button type="button" onClick={() => void revokeHouseholdInvitation(invitation)} aria-label={`Revoke invitation for ${invitation.email}`}><TrashIcon aria-hidden="true" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {activeHousehold?.ownerUserId === user.id || !backendReady ? (
              <button className={`danger-button ${householdDeleteArmed ? "armed" : ""}`} type="button" onClick={deleteHousehold}><TrashIcon aria-hidden="true" /> {householdDeleteArmed ? "Tap again to permanently delete" : "Delete household"}</button>
            ) : null}
            <button className="text-button" type="button" onClick={() => setSettingsView("main")}>Back to settings</button>
          </div>
        ) : (
          <div className="settings-list">
            <div className="account-card"><span className="avatar large"><PersonIcon aria-hidden="true" /></span><strong>{user.fullName}</strong><span>{user.email}</span><small>Signed in with ChatGPT</small></div>
            <button className="secondary-button" type="button" onClick={signOut}><span>Sign out</span></button>
            <button className={`danger-button ${accountDeleteArmed ? "armed" : ""}`} type="button" onClick={deleteAccount}><TrashIcon aria-hidden="true" /> {accountDeleteArmed ? "Tap again to delete Icebox account" : "Delete Icebox account"}</button>
            <p className="privacy-note">Deleting Icebox does not delete your ChatGPT account. Transfer or delete any household you own first.</p>
            <button className="text-button" type="button" onClick={() => setSettingsView("main")}>Back to settings</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet === "install"}
        onOpenChange={(open) => !open && closeSheet()}
        title={installPlatform === "ios" ? "Add on iPhone or iPad" : installPlatform === "android" ? "Add on Android" : "Add to Home Screen"}
        description={installPlatform === "choice" ? "Choose your device for the correct installation steps." : "Follow these steps to keep Icebox on your Home Screen."}
        snap={installPlatform === "choice" ? 0.52 : 0.72}
      >
        {installPlatform === "choice" ? (
          <div className="install-platform-list" aria-label="Choose a device">
            <button className="install-platform-option" type="button" onClick={() => setInstallPlatform("ios")}>
              <span className="install-platform-icon"><MobileIcon aria-hidden="true" /></span>
              <span><strong>iPhone or iPad</strong><small>Use Safari’s Share menu</small></span>
              <ChevronRightIcon aria-hidden="true" />
            </button>
            <button className="install-platform-option" type="button" onClick={() => setInstallPlatform("android")}>
              <span className="install-platform-icon"><MobileIcon aria-hidden="true" /></span>
              <span><strong>Android</strong><small>Use Chrome’s main menu</small></span>
              <ChevronRightIcon aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="install-guide">
            <ol className="install-steps">
              {(installPlatform === "ios" ? [
                ["Open Icebox in Safari", "Go to ice-box.xyz in the Safari app."],
                ["Open the Share menu", "Tap Safari’s Share button — the square with an upward arrow."],
                ["Choose Add to Home Screen", "Scroll through the Share menu and tap Add to Home Screen."],
                ["Confirm", "Check the name, then tap Add."],
              ] : [
                ["Open Icebox in Chrome", "Go to ice-box.xyz in the Chrome app."],
                ["Open Chrome’s menu", "Tap the three-dot menu in the top-right corner."],
                ["Choose the install action", "Tap Add to Home screen or Install app."],
                ["Confirm", "Tap Add or Install when Chrome asks."],
              ]).map(([heading, detail], index) => (
                <li key={heading}>
                  <span className="install-step-number" aria-hidden="true">{index + 1}</span>
                  <span><strong>{heading}</strong><small>{detail}</small></span>
                </li>
              ))}
            </ol>
            <p className="install-note">Menu wording can vary slightly with your device and browser version.</p>
            <button className="secondary-button" type="button" onClick={() => setInstallPlatform("choice")}>Back to device choice</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet === "feedback"}
        onOpenChange={(open) => !open && closeSheet()}
        title={feedbackReference ? "Feedback sent" : "Add feedback"}
        description={feedbackReference ? "Keep this reference if you need to follow up." : "Tell us what happened. Icebox will attach recent technical diagnostics to help us investigate."}
        snap={0.68}
      >
        {feedbackReference ? (
          <div className="feedback-success" role="status">
            <span className="feedback-success-icon"><CheckCircledIcon aria-hidden="true" /></span>
            <strong>Thanks — your feedback is saved</strong>
            <span>Diagnostic reference</span>
            <code>{feedbackReference}</code>
            <button className="secondary-button" type="button" onClick={closeSheet}>Back to inventory</button>
          </div>
        ) : (
          <div className="feedback-form">
            <label className="field feedback-message" htmlFor="feedback-message">
              <span>Your feedback</span>
              <KeyboardTextarea
                id="feedback-message"
                value={feedbackText}
                onFocus={(event) => {
                  const field = event.currentTarget;
                  window.setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
                }}
                onChange={(event) => {
                  const message = event.currentTarget.value;
                  setFeedbackText(message);
                }}
                maxLength={4000}
                placeholder="What happened, and what were you trying to do?"
              />
              <small>{feedbackText.length}/4000</small>
            </label>
            <div className="feedback-photo-field">
              <span className="feedback-photo-label">Photo <small>optional</small></span>
              {feedbackPhoto ? (
                <div className="feedback-photo-preview">
                  <img src={feedbackPhoto.previewUrl} alt="Feedback attachment preview" />
                  <div><strong>Photo attached</strong><small>{feedbackPhoto.original ? "Original format" : "Optimised"} · included in the operator diagnostic download</small></div>
                  <button type="button" onClick={removeFeedbackPhoto} aria-label="Remove feedback photo"><TrashIcon aria-hidden="true" /></button>
                </div>
              ) : (
                <label className={`feedback-photo-picker ${feedbackPhotoProcessing ? "processing" : ""}`}>
                  <input type="file" accept="image/*,.heic,.heif,.avif,.tif,.tiff" onChange={chooseFeedbackPhoto} disabled={feedbackPhotoProcessing || feedbackSending} />
                  {feedbackPhotoProcessing ? <><span className="button-spinner dark" aria-hidden="true" /> Preparing photo…</> : <><PlusIcon aria-hidden="true" /> Add a photo</>}
                </label>
              )}
            </div>
            <p className="feedback-privacy">Diagnostics include app and device state, recent request status and sanitized errors. If you add a feedback photo, it is stored privately and included in the operator’s diagnostic download. Inventory labels, notes, photos, searches and credentials are never included.</p>
            <button className="primary-sheet-button" type="button" disabled={feedbackSending || feedbackPhotoProcessing || !feedbackText.trim() || offline || !backendReady} onClick={submitFeedback}>
              {feedbackSending ? <><span className="button-spinner" aria-hidden="true" /> Sending…</> : "Send feedback"}
            </button>
            {offline || !backendReady ? <p className="feedback-offline">Connect to the internet to send feedback with diagnostics.</p> : null}
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet === "households"}
        onOpenChange={(open) => !open && closeSheet()}
        title="Households"
        description="Switch household or set up another home."
        snap={0.72}
      >
        <div className="household-list">
          {households.map((household) => (
            <button className="household-card" type="button" key={household.id} data-active={household.id === activeHouseholdId ? "true" : "false"} onClick={() => chooseHousehold(household.id)}>
              <span><strong>{household.name}</strong><small>{freezers.filter((freezer) => freezer.householdId === household.id).length} freezers · {household.memberCount} members</small></span>
              {household.id === activeHouseholdId ? <CheckCircledIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
            </button>
          ))}
          <div className="inline-form">
            <label htmlFor="new-household">New household</label>
            <KeyboardInput id="new-household" value={newHouseholdName} onChange={(event) => setNewHouseholdName(event.currentTarget.value)} placeholder="e.g. Seaview Cottage" maxLength={60} />
            <button className="secondary-button" type="button" onClick={createHousehold}><PlusIcon aria-hidden="true" /> Create with one freezer</button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "invite"}
        onOpenChange={(open) => !open && closeSheet()}
        title="Invite someone"
        description="They’ll see the invitation when they next sign in with this ChatGPT account email."
        snap={0.58}
      >
        <div className="inline-form">
          <label htmlFor="invite-email">ChatGPT account email</label>
          <KeyboardInput id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.currentTarget.value)} placeholder="name@example.com" autoCapitalize="none" />
          <p>All accepted household members can manage inventory, freezers, drawers, and other members.</p>
          <button className="primary-sheet-button" type="button" onClick={sendInvite}>Add invitation</button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "edit-freezer"}
        onOpenChange={(open) => !open && closeSheet()}
        title={editingFreezer ? `Edit ${editingFreezer.name}` : "Add freezer"}
        description={editingFreezer ? "Rename this freezer and manage its drawers." : "Name the freezer and set up between one and eight drawers."}
        snap={0.78}
      >
        <div className="settings-list structure-editor">
          <label className="form-field">
            <span>Freezer name</span>
            <KeyboardInput value={structureDraft.name} maxLength={60} onChange={(event) => {
              const name = event.currentTarget.value;
              setStructureDraft((current) => ({ ...current, name }));
            }} />
          </label>
          <div className="settings-group compact">
            {structureDraft.drawers.map((drawer, index) => {
              const drawerInventory = items.filter((item) => item.drawerId === drawer.id);
              const armed = drawerDeleteArmedId === drawer.id;
              return (
                <div className="drawer-edit-block" key={drawer.id}>
                  <div className="drawer-edit-row">
                    <span>{index + 1}</span>
                    <KeyboardInput value={drawer.name} maxLength={60} aria-label={`Drawer ${index + 1} name`} onChange={(event) => {
                      const name = event.currentTarget.value;
                      setStructureDraft((current) => ({ ...current, drawers: current.drawers.map((entry) => entry.id === drawer.id ? { ...entry, name } : entry) }));
                    }} />
                    {structureDraft.drawers.length > 1 ? (
                      <button
                        className={armed ? "armed" : ""}
                        type="button"
                        aria-label={armed ? `Confirm remove drawer ${index + 1}${drawerInventory.length ? ` and delete ${drawerInventory.length} ${drawerInventory.length === 1 ? "item" : "items"}` : ""}` : `Remove drawer ${index + 1}`}
                        title={armed ? "Tap again to remove" : "Remove drawer"}
                        onClick={() => removeDrawerFromDraft(drawer)}
                      ><TrashIcon aria-hidden="true" /></button>
                    ) : null}
                  </div>
                  {armed ? (
                    <div className="structure-delete-warning" role="alert">
                      <strong>{drawerInventory.length ? `This will also delete ${drawerInventory.length} ${drawerInventory.length === 1 ? "item" : "items"}:` : "This drawer is empty."}</strong>
                      {drawerInventory.length ? <ul>{drawerInventory.map((item) => <li key={item.id}>{item.label}</li>)}</ul> : null}
                      <span>Press the red bin again, then save the freezer setup.</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {structureDraft.drawers.length < 8 ? <button className="secondary-button" type="button" onClick={() => { setDrawerDeleteArmedId(null); setStructureDraft((current) => ({ ...current, drawers: [...current.drawers, { id: `new-${crypto.randomUUID()}`, freezerId: editingFreezer?.id ?? "", name: `Drawer ${current.drawers.length + 1}`, position: current.drawers.length + 1 }] })); }}><PlusIcon aria-hidden="true" /> Add drawer</button> : null}
          <button className="save-button" type="button" disabled={saving} onClick={saveFreezerStructure}>{saving ? "Saving…" : editingFreezer ? "Save freezer setup" : "Add freezer"}</button>
          {editingFreezer ? (
            <>
              {freezerDeleteArmed ? (() => {
                const freezerInventory = items.filter((item) => item.freezerId === editingFreezer.id);
                return (
                  <div className="structure-delete-warning freezer-warning" role="alert">
                    <strong>{freezerInventory.length ? `This will permanently delete ${freezerInventory.length} ${freezerInventory.length === 1 ? "item" : "items"}:` : "This freezer is empty."}</strong>
                    {freezerInventory.length ? <ul>{freezerInventory.map((item) => <li key={item.id}>{item.label}</li>)}</ul> : null}
                    <span>This cannot be undone.</span>
                  </div>
                );
              })() : null}
              <button
                className={`danger-button ${freezerDeleteArmed ? "armed" : ""}`}
                type="button"
                disabled={saving || householdFreezers.length <= 1}
                onClick={deleteFreezer}
              >
                <TrashIcon aria-hidden="true" />
                {householdFreezers.length <= 1
                  ? "A household needs one freezer"
                  : freezerDeleteArmed
                    ? `Delete freezer${items.some((item) => item.freezerId === editingFreezer.id) ? " and its items" : ""}`
                    : "Delete freezer"}
              </button>
            </>
          ) : null}
        </div>
      </BottomSheet>

      <PhotoViewer
        key={photoViewer?.imageUrl ?? "closed-photo-viewer"}
        photo={photoViewer}
        onOpenChange={(open) => !open && setPhotoViewer(null)}
      />

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}

function emptyDraft(freezerId: string, drawerId: string): InventoryItem {
  return {
    id: "",
    freezerId,
    drawerId,
    label: "",
    frozenOn: today,
    createdAt: new Date().toISOString(),
    notes: "",
    version: 0,
  };
}

type SwipeSession = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  mode: "pending" | "horizontal" | "vertical";
};

function PrintInventory({
  household,
  freezers,
  drawers,
  items,
}: {
  household?: Household;
  freezers: Freezer[];
  drawers: Drawer[];
  items: InventoryItem[];
}) {
  if (!household) return null;
  const orderedFreezers = [...freezers]
    .filter((freezer) => freezer.householdId === household.id)
    .sort((left, right) => left.position - right.position);
  const activeFreezerIds = new Set(orderedFreezers.map((freezer) => freezer.id));
  const itemCount = items.filter((item) => activeFreezerIds.has(item.freezerId)).length;
  const generatedAt = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" }).format(new Date());

  return (
    <article className="print-inventory" data-testid="print-inventory">
      <header className="print-inventory-header">
        <div><p>Icebox</p><h1>{household.name}</h1></div>
        <div><strong>{itemCount} {itemCount === 1 ? "item" : "items"}</strong><span>Prepared {generatedAt}</span></div>
      </header>
      {orderedFreezers.map((freezer) => {
        const freezerDrawers = drawers
          .filter((drawer) => drawer.freezerId === freezer.id)
          .sort((left, right) => left.position - right.position);
        return (
          <section className="print-freezer" key={freezer.id}>
            <h2>{freezer.name}</h2>
            {freezerDrawers.map((drawer) => {
              const drawerInventory = sortInventory(
                items.filter((item) => item.drawerId === drawer.id),
                drawer.defaultSortMode ?? freezer.defaultSortMode ?? "added",
              );
              return (
                <section className="print-drawer" key={drawer.id}>
                  <h3>{drawer.name} <span>{drawerInventory.length}</span></h3>
                  {drawerInventory.length ? (
                    <table>
                      <thead><tr><th>Label</th><th>Frozen on</th><th>Expiry</th><th>Notes</th></tr></thead>
                      <tbody>
                        {drawerInventory.map((item) => (
                          <tr key={item.id}>
                            <td>{item.label}</td>
                            <td>{formatFrozenDate(item.frozenOn)}</td>
                            <td>{item.expiresOn ? formatFrozenDate(item.expiresOn) : "—"}</td>
                            <td>{item.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="print-empty">Empty</p>}
                </section>
              );
            })}
          </section>
        );
      })}
    </article>
  );
}

function StructureMenu({
  kind,
  label,
  onAction,
}: {
  kind: "freezer" | "drawer";
  label: string;
  onAction: (action: "sort" | "rename") => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="structure-menu-trigger" type="button" aria-label={`More options for ${label}`}>
          <DotsVerticalIcon aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="structure-menu-content" sideOffset={5} collisionPadding={12} align="end">
          <DropdownMenu.Item className="structure-menu-item" onSelect={() => onAction("sort")}>Change default sort order</DropdownMenu.Item>
          <DropdownMenu.Item className="structure-menu-item" onSelect={() => onAction("rename")}>Rename {kind}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SwipeDeleteRow({ children, label, onDelete }: { children: ReactNode; label: string; onDelete: () => void }) {
  const actionWidth = 88;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const sessionRef = useRef<SwipeSession | null>(null);
  const suppressClickUntilRef = useRef(0);
  const deleteRevealed = offset <= -actionWidth + 1;

  function updateOffset(next: number) {
    const value = Math.max(-actionWidth, Math.min(0, next));
    offsetRef.current = value;
    setOffset(value);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".swipe-delete-action")) return;
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offsetRef.current,
      mode: "pending",
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const movementX = event.clientX - session.startX;
    const movementY = event.clientY - session.startY;

    if (session.mode === "pending") {
      if (Math.max(Math.abs(movementX), Math.abs(movementY)) < 9) return;
      session.mode = Math.abs(movementX) > Math.abs(movementY) * 1.2 ? "horizontal" : "vertical";
      if (session.mode === "horizontal") {
        setDragging(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The browser may already have released a canceled pointer.
        }
      }
    }

    if (session.mode !== "horizontal") return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntilRef.current = Date.now() + 250;
    updateOffset(session.startOffset + movementX);
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.mode === "horizontal") {
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      updateOffset(offsetRef.current <= -actionWidth / 2 ? -actionWidth : 0);
      setDragging(false);
    }
    sessionRef.current = null;
  }

  return (
    <div
      className="swipe-delete-row"
      data-revealed={offset < 0 ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(".swipe-delete-action")) return;
        if (offsetRef.current < 0 || Date.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
          updateOffset(0);
        }
      }}
      style={{ "--swipe-offset": `${offset}px` } as CSSProperties}
    >
      {offset < 0 ? (
        <button
          className="swipe-delete-action"
          type="button"
          aria-label={`Delete ${label}`}
          aria-hidden={deleteRevealed ? undefined : true}
          tabIndex={deleteRevealed ? 0 : -1}
          onClick={() => {
            updateOffset(0);
            onDelete();
          }}
        >
          <TrashIcon aria-hidden="true" />
          <span>Delete</span>
        </button>
      ) : null}
      <div className="swipe-delete-content">{children}</div>
    </div>
  );
}

function InventoryResultsView({
  eyebrow,
  items,
  freezers,
  drawers,
  emptyTitle,
  emptyMessage,
  showSearchIcon,
  onDone,
  onDelete,
  onOpen,
  onViewPhoto,
}: {
  eyebrow: string;
  items: InventoryItem[];
  freezers: Freezer[];
  drawers: Drawer[];
  emptyTitle: string;
  emptyMessage: string;
  showSearchIcon: boolean;
  onDone: () => void;
  onDelete: (item: InventoryItem) => void;
  onOpen: (item: InventoryItem) => void;
  onViewPhoto: (imageUrl: string, label: string) => void;
}) {
  const freezersById = useMemo(() => new Map(freezers.map((freezer) => [freezer.id, freezer])), [freezers]);
  const drawersById = useMemo(() => new Map(drawers.map((drawer) => [drawer.id, drawer])), [drawers]);

  return (
    <section className="search-results" aria-live="polite" data-testid="inventory-results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{items.length} {items.length === 1 ? "item" : "items"}</h1>
        </div>
        <button type="button" onClick={onDone}>Done</button>
      </div>
      <div className="item-list search-list">
        {items.length ? (
          items.map((item) => (
            <SwipeDeleteRow key={item.id} label={item.label} onDelete={() => onDelete(item)}>
              <ItemRow
                item={item}
                freezer={freezersById.get(item.freezerId)}
                drawer={drawersById.get(item.drawerId)}
                showLocation
                onOpen={() => onOpen(item)}
                onViewPhoto={onViewPhoto}
              />
            </SwipeDeleteRow>
          ))
        ) : (
          <div className="empty-state">
            {showSearchIcon ? <MagnifyingGlassIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
            <strong>{emptyTitle}</strong>
            <span>{emptyMessage}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ItemRow({
  item,
  freezer,
  drawer,
  showLocation = false,
  onOpen,
  onViewPhoto,
}: {
  item: InventoryItem;
  freezer?: Freezer;
  drawer?: Drawer;
  showLocation?: boolean;
  onOpen: () => void;
  onViewPhoto: (imageUrl: string, label: string) => void;
}) {
  const freezerName = freezer?.name ?? "Unknown freezer";
  const drawerName = drawer?.name ?? "Unknown drawer";
  const accessibleLocation = showLocation ? ` in ${freezerName}, ${drawerName}` : "";
  const urgency = expiryUrgency(item.expiresOn);

  return (
    <div className="item-row">
      {item.imageUrl ? (
        <button
          className="item-photo-button"
          type="button"
          aria-label={`View photo of ${item.label}`}
          onClick={() => onViewPhoto(item.imageUrl!, item.label)}
        >
          <ItemThumbnail
            itemId={item.id}
            label={item.label}
            imageUrl={item.thumbnailUrl ?? item.imageUrl}
            mediaId={item.imageId}
            thumbnailReady={item.thumbnailReady}
          />
        </button>
      ) : (
        <ItemThumbnail itemId={item.id} label={item.label} />
      )}
      <button className="item-edit-button" type="button" onClick={onOpen} aria-label={`Edit ${item.label}${accessibleLocation}`}>
        <span className="item-copy">
          <strong>{item.label}</strong>
          {showLocation ? <small className="item-location">{freezerName} · {drawerName}</small> : null}
          <small>Frozen {formatFrozenDate(item.frozenOn)}</small>
          {item.expiresOn ? (
            <small className="expiry-date" data-expiry-urgency={urgency?.level}>
              Expires {formatFrozenDate(item.expiresOn)}
              {urgency?.warning ? (
                <span
                  className="expiry-warning"
                  role="img"
                  aria-label={urgency.daysRemaining < 0 ? "Expired" : "Expires today"}
                >⚠️</span>
              ) : null}
            </small>
          ) : null}
        </span>
        <ChevronRightIcon aria-hidden="true" />
      </button>
    </div>
  );
}

function ItemThumbnail({
  itemId,
  label,
  imageUrl,
  mediaId,
  thumbnailReady = true,
  size = "row",
}: {
  itemId: string;
  label: string;
  imageUrl?: string;
  mediaId?: string;
  thumbnailReady?: boolean | number;
  size?: "row" | "editor";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [optimizedImageUrl, setOptimizedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setImageFailed(false);
    setOptimizedImageUrl(null);
  }, [imageUrl]);

  return (
    <span
      className="item-thumbnail"
      data-colour={itemThumbnailColour(itemId)}
      data-size={size}
      aria-hidden="true"
    >
      {imageUrl && !imageFailed ? (
        <img
          src={optimizedImageUrl ?? imageUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            if (!thumbnailReady && mediaId) {
              void backfillLegacyThumbnail(event.currentTarget, mediaId).then((url) => url && setOptimizedImageUrl(url));
            }
          }}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{itemInitials(label)}</span>
      )}
    </span>
  );
}

function PhotoViewer({
  photo,
  onOpenChange,
}: {
  photo: PhotoViewerState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<
    | { kind: "pan"; pointerId: number; startPoint: { x: number; y: number }; startOffset: { x: number; y: number } }
    | { kind: "pinch"; pointerIds: [number, number]; startDistance: number; startMidpoint: { x: number; y: number }; startScale: number; startOffset: { x: number; y: number } }
    | null
  >(null);

  const minimumScale = 1;
  const maximumScale = 4;

  function normalizedScale(nextScale: number) {
    return Math.min(maximumScale, Math.max(minimumScale, nextScale));
  }

  function clampOffset(nextOffset: { x: number; y: number }, nextScale = scale) {
    const stage = stageRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!stage || !image?.clientWidth || !image.clientHeight || nextScale <= minimumScale) return { x: 0, y: 0 };

    const availableWidth = Math.max(1, stage.width);
    const availableHeight = Math.max(1, stage.height);
    const renderedWidth = image.clientWidth * nextScale;
    const renderedHeight = image.clientHeight * nextScale;
    const maximumX = Math.max(0, (renderedWidth - availableWidth) / 2);
    const maximumY = Math.max(0, (renderedHeight - availableHeight) / 2);

    return {
      x: Math.min(maximumX, Math.max(-maximumX, nextOffset.x)),
      y: Math.min(maximumY, Math.max(-maximumY, nextOffset.y)),
    };
  }

  function changeScale(nextScale: number) {
    const next = normalizedScale(nextScale);
    const ratio = scale ? next / scale : 1;
    setOffset((current) => clampOffset({ x: current.x * ratio, y: current.y * ratio }, next));
    setScale(next);
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    pointersRef.current.clear();
    gestureRef.current = null;
  }

  function beginGesture() {
    const pointers = [...pointersRef.current.entries()];
    if (pointers.length >= 2) {
      const [[firstId, first], [secondId, second]] = pointers;
      gestureRef.current = {
        kind: "pinch",
        pointerIds: [firstId, secondId],
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startMidpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        startScale: scale,
        startOffset: offset,
      };
      setDragging(true);
      return;
    }

    const [entry] = pointers;
    if (entry) {
      gestureRef.current = {
        kind: "pan",
        pointerId: entry[0],
        startPoint: entry[1],
        startOffset: offset,
      };
      setDragging(scale > minimumScale);
    } else {
      gestureRef.current = null;
      setDragging(false);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is best-effort on older WebKit. */ }
    beginGesture();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.kind === "pinch") {
      const first = pointersRef.current.get(gesture.pointerIds[0]);
      const second = pointersRef.current.get(gesture.pointerIds[1]);
      if (!first || !second) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const nextScale = normalizedScale(gesture.startScale * (distance / gesture.startDistance));
      const nextOffset = clampOffset({
        x: gesture.startOffset.x + midpoint.x - gesture.startMidpoint.x,
        y: gesture.startOffset.y + midpoint.y - gesture.startMidpoint.y,
      }, nextScale);
      setScale(nextScale);
      setOffset(nextOffset);
      return;
    }

    const pointer = pointersRef.current.get(gesture.pointerId);
    if (!pointer || scale <= minimumScale) return;
    setOffset(clampOffset({
      x: gesture.startOffset.x + pointer.x - gesture.startPoint.x,
      y: gesture.startOffset.y + pointer.y - gesture.startPoint.y,
    }));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture may already be released. */ }
    beginGesture();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeScale(scale + (event.deltaY < 0 ? 0.35 : -0.35));
  }

  useEffect(() => {
    setImageFailed(false);
    resetView();
  }, [photo?.imageUrl]);

  return (
    <Dialog.Root open={Boolean(photo)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="photo-viewer-overlay" />
        <Dialog.Content className="photo-viewer" aria-describedby="photo-viewer-description">
          <header className="photo-viewer-header">
            <Dialog.Title>{photo?.label ?? "Item photo"}</Dialog.Title>
            <Dialog.Description id="photo-viewer-description">Pinch, scroll, or use the controls to zoom. Drag the photo when zoomed.</Dialog.Description>
            <Dialog.Close className="photo-viewer-close" aria-label="Close photo viewer">
              <Cross2Icon aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div
            ref={stageRef}
            className="photo-viewer-stage"
            data-dragging={dragging ? "true" : "false"}
            data-scale={scale.toFixed(2)}
            role="region"
            aria-label="Zoomable item photo"
            onDoubleClick={() => scale > minimumScale ? resetView() : changeScale(2)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onWheel={handleWheel}
          >
            {photo && !imageFailed ? (
              <img
                ref={imageRef}
                src={photo.imageUrl}
                alt={photo.label}
                draggable={false}
                style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
                onLoad={() => setOffset((current) => clampOffset(current, scale))}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="photo-viewer-unavailable" role="status">
                <strong>Photo unavailable</strong>
                <span>Close this view and try again when you’re connected.</span>
              </div>
            )}
          </div>
          <footer className="photo-viewer-controls">
            <div role="group" aria-label="Photo zoom controls">
              <button type="button" aria-label="Zoom out" disabled={scale <= minimumScale} onClick={() => changeScale(scale - 0.5)}>
                <MinusIcon aria-hidden="true" />
              </button>
              <output aria-live="polite" aria-label="Photo zoom level">{Math.round(scale * 100)}%</output>
              <button type="button" aria-label="Zoom in" disabled={scale >= maximumScale} onClick={() => changeScale(scale + 0.5)}>
                <PlusIcon aria-hidden="true" />
              </button>
              <button className="photo-viewer-reset" type="button" disabled={scale === minimumScale && offset.x === 0 && offset.y === 0} onClick={resetView}>
                <ResetIcon aria-hidden="true" /> Reset
              </button>
            </div>
            <span>Pinch or scroll to zoom · drag to move</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ItemForm({
  draft,
  setDraft,
  freezers,
  drawers,
  aiLabelEnabled,
  suggesting,
  processingPhoto,
  saving,
  deleteArmed,
  isEditing,
  onPhoto,
  onSuggest,
  onViewPhoto,
  onSave,
  onDelete,
}: {
  draft: InventoryItem;
  setDraft: (updater: (current: InventoryItem) => InventoryItem) => void;
  freezers: Freezer[];
  drawers: Drawer[];
  aiLabelEnabled: boolean;
  suggesting: boolean;
  processingPhoto: boolean;
  saving: boolean;
  deleteArmed: boolean;
  isEditing: boolean;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onSuggest: () => void;
  onViewPhoto: (imageUrl: string, label: string) => void;
  onSave: (completion?: "close" | "continue") => void;
  onDelete: () => void;
}) {
  const availableDrawers = drawers.filter((drawer) => drawer.freezerId === draft.freezerId);
  return (
    <div className="item-form">
      <div className="photo-field">
        <div
          className="photo-picker"
          data-processing={processingPhoto ? "true" : "false"}
          aria-disabled={processingPhoto}
        >
          {draft.imageUrl ? (
            <button
              className="item-photo-button editor-photo-button"
              type="button"
              aria-label={`View photo of ${draft.label || "this item"}`}
              onClick={() => onViewPhoto(draft.imageUrl!, draft.label || "Item photo")}
            >
              <ItemThumbnail itemId={draft.id} label={draft.label} imageUrl={draft.imageUrl} size="editor" />
            </button>
          ) : (
            <ItemThumbnail itemId={draft.id} label={draft.label} size="editor" />
          )}
          <label
            className="photo-upload-control"
            role="button"
            tabIndex={processingPhoto ? -1 : 0}
            onKeyDown={(event) => {
              if (processingPhoto) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.currentTarget.querySelector<HTMLInputElement>("input")?.click();
              }
            }}
          >
            <span>{processingPhoto ? <><span className="photo-processing-spinner" aria-hidden="true" /> Processing photo…</> : draft.imageUrl ? "Change photo" : "Add photo"}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" onChange={onPhoto} disabled={processingPhoto} />
          </label>
        </div>
      </div>
      <div className="label-field-row">
        <label className="field label-field" htmlFor="item-label">
          <span>Label</span>
          <KeyboardInput id="item-label" value={draft.label} onChange={(event) => {
            const label = event.currentTarget.value;
            setDraft((current) => ({ ...current, label }));
          }} maxLength={80} placeholder={suggesting ? "Looking at your photo…" : "e.g. Chicken curry"} />
          <small>{draft.label.length}/80</small>
        </label>
        {aiLabelEnabled && draft.imageUrl ? (
          <button
            className="suggest-button"
            type="button"
            onClick={onSuggest}
            disabled={suggesting}
            aria-label={suggesting ? "Generating label" : "Generate label from photo"}
            title={suggesting ? "Generating label" : "Generate label from photo"}
          >
            {suggesting ? <span className="label-generation-spinner" aria-hidden="true" /> : <MagicWandIcon aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <div className="field-grid">
        <label className="field" htmlFor="item-freezer">
          <span>Freezer</span>
          <select id="item-freezer" value={draft.freezerId} onChange={(event) => {
            const freezerId = event.currentTarget.value;
            const drawerId = drawers.find((drawer) => drawer.freezerId === freezerId)?.id ?? "";
            setDraft((current) => ({ ...current, freezerId, drawerId }));
          }}>
            {freezers.map((freezer) => <option key={freezer.id} value={freezer.id}>{freezer.name}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="item-drawer">
          <span>Drawer</span>
          <select id="item-drawer" value={draft.drawerId} onChange={(event) => {
            const drawerId = event.currentTarget.value;
            setDraft((current) => ({ ...current, drawerId }));
          }}>
            {availableDrawers.map((drawer) => <option key={drawer.id} value={drawer.id}>{drawer.name}</option>)}
          </select>
        </label>
      </div>
      <div className="field-grid date-grid">
        <label className="field" htmlFor="item-date">
          <span>Frozen on</span>
          <input id="item-date" type="date" value={draft.frozenOn} onChange={(event) => {
            const frozenOn = event.currentTarget.value;
            setDraft((current) => ({ ...current, frozenOn }));
          }} />
        </label>
        <label className="field" htmlFor="item-expiry-date">
          <span>Expiry <i>optional</i></span>
          <input id="item-expiry-date" type="date" value={draft.expiresOn ?? ""} onChange={(event) => {
            const expiresOn = event.currentTarget.value || undefined;
            setDraft((current) => ({ ...current, expiresOn }));
          }} />
        </label>
      </div>
      <label className="field notes-field" htmlFor="item-notes">
        <span>Notes <i>optional</i></span>
        <KeyboardTextarea id="item-notes" value={draft.notes} onChange={(event) => {
          const notes = event.currentTarget.value;
          setDraft((current) => ({ ...current, notes }));
        }} maxLength={2000} placeholder="Describe the item in more detail, number of portions, instructions for reheating etc" />
      </label>
      <button className="primary-sheet-button" type="button" onClick={() => onSave("close")} disabled={saving || processingPhoto}>{saving ? "Saving…" : processingPhoto ? "Processing photo…" : isEditing ? "Save changes" : "Add to freezer"}</button>
      {!isEditing ? <button className="secondary-button" type="button" onClick={() => onSave("continue")} disabled={saving || processingPhoto}>{saving ? "Saving…" : "Save and add another"}</button> : null}
      {isEditing ? <button className={`danger-button ${deleteArmed ? "armed" : ""}`} type="button" onClick={onDelete}><TrashIcon aria-hidden="true" /> {deleteArmed ? "Confirm delete" : "Delete item"}</button> : null}
    </div>
  );
}
