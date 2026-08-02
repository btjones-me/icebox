import {
  ArchiveIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Cross2Icon,
  GearIcon,
  HamburgerMenuIcon,
  HomeIcon,
  LetterCaseCapitalizeIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BottomSheet, KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard } from "./mobile";
import { sortInventory, type InventorySortMode as SortMode } from "./inventory-sort";
import { itemInitials, itemThumbnailColour } from "./item-thumbnail";

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
};

type Drawer = {
  id: string;
  freezerId: string;
  name: string;
  position: number;
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

type SheetMode = "add" | "edit" | "settings" | "households" | "invite" | "edit-freezer" | "sort" | null;

type BootstrapResponse = {
  user: { id: string; email: string; fullName?: string; aiLabelEnabled: boolean };
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

const sortLabels: Record<SortMode, string> = {
  expiry: "Expiring soonest",
  alphabetical: "Alphabetical",
  added: "Added date",
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok || !contentType.includes("application/json")) {
    const code = data?.error?.code ? ` ${data.error.code}` : "";
    const debug = data?.error?.details?.debug ? `: ${data.error.details.debug}` : "";
    throw new Error(`Request failed: ${response.status}${code}${debug}`);
  }
  return data as T;
}

const CACHE_DB = "icebox-private-cache-v2";
const LEGACY_CACHE_DBS = ["icebox-private-cache-v1"];
const CACHE_STORE = "bootstrap";

function deleteCacheDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCachedBootstrap(data: BootstrapResponse) {
  const db = await openCache();
  const previousUserId = localStorage.getItem("icebox:last-user-id");
  const transaction = db.transaction(CACHE_STORE, "readwrite");
  if (previousUserId && previousUserId !== data.user.id) transaction.objectStore(CACHE_STORE).clear();
  transaction.objectStore(CACHE_STORE).put(data, data.user.id);
  localStorage.setItem("icebox:last-user-id", data.user.id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  await Promise.all(LEGACY_CACHE_DBS.map(deleteCacheDatabase));
}

async function loadCachedBootstrap(): Promise<BootstrapResponse | null> {
  const userId = localStorage.getItem("icebox:last-user-id");
  if (!userId) return null;
  const db = await openCache();
  const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(userId);
  const result = await new Promise<BootstrapResponse | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as BootstrapResponse | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function clearPrivateCache() {
  localStorage.removeItem("icebox:last-user-id");
  await Promise.all([CACHE_DB, ...LEGACY_CACHE_DBS].map(deleteCacheDatabase));
  navigator.serviceWorker?.controller?.postMessage("CLEAR_ICEBOX_CACHES");
}

async function reencodeImage(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Invalid image"));
      element.src = sourceUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.84, 0.72, 0.6]) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= 2_097_152) break;
    }
    if (!blob || blob.size > 2_097_152) throw new Error("Image is too large after processing");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "icebox"}.webp`, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
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

export default function Prototype() {
  const keyboard = useKeyboard();
  const [backendReady, setBackendReady] = useState(false);
  const [user, setUser] = useState({
    id: "demo-user",
    email: "alex@example.com",
    fullName: "Alex Morgan",
    aiLabelEnabled: true,
  });
  const [households, setHouseholds] = useState(seedHouseholds);
  const [freezers, setFreezers] = useState(seedFreezers);
  const [drawers, setDrawers] = useState(seedDrawers);
  const [items, setItems] = useState(seedItems);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState("house-alder");
  const [activeFreezerId, setActiveFreezerId] = useState("freezer-kitchen");
  const [openFreezerId, setOpenFreezerId] = useState("freezer-kitchen");
  const [openDrawerId, setOpenDrawerId] = useState("drawer-middle");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [draft, setDraft] = useState<InventoryItem>(() => emptyDraft("freezer-kitchen", "drawer-middle"));
  const [syncState, setSyncState] = useState<SyncState>("current");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>(new Date().toISOString());
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<"main" | "household" | "account">("main");
  const [inviteEmail, setInviteEmail] = useState("");
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
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

  function applyBootstrap(data: BootstrapResponse, connected = true) {
    setBackendReady(connected);
    setUser({
      id: data.user.id,
      email: data.user.email,
      fullName: data.user.fullName ?? data.user.email.split("@")[0],
      aiLabelEnabled: data.user.aiLabelEnabled,
    });
    setHouseholds(data.households);
    setFreezers(data.freezers);
    setDrawers(data.drawers);
    setItems(data.items);
    setInvitations(data.invitations);
    const firstHousehold = data.defaultHouseholdId ?? data.households[0]?.id;
    if (firstHousehold) {
      setActiveHouseholdId(firstHousehold);
      const firstFreezer = data.freezers.find((freezer) => freezer.householdId === firstHousehold);
      if (firstFreezer) {
        setActiveFreezerId(firstFreezer.id);
        setOpenFreezerId(firstFreezer.id);
        const firstDrawer = data.drawers.find((drawer) => drawer.freezerId === firstFreezer.id);
        if (firstDrawer) setOpenDrawerId(firstDrawer.id);
      }
    }
    setSyncState(data.backup.state);
    setPendingCount(data.backup.pendingCount);
    setLastBackupAt(data.backup.lastSuccessAt);
  }

  useEffect(() => {
    let active = true;
    apiRequest<BootstrapResponse>("/api/bootstrap")
      .then((data) => {
        if (!active) return;
        applyBootstrap(data);
        void saveCachedBootstrap(data);
      })
      .catch(async (error) => {
        console.error("Icebox bootstrap failed:", error instanceof Error ? error.message : "Unknown error");
        const cached = await loadCachedBootstrap().catch(() => null);
        if (active && cached) {
          applyBootstrap(cached, false);
          setOffline(true);
        }
        // The local Vite preview deliberately keeps realistic seed data when no Worker is attached.
      });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      active = false;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeHousehold = households.find((household) => household.id === activeHouseholdId) ?? households[0];
  const householdFreezers = freezers
    .filter((freezer) => freezer.householdId === activeHousehold?.id)
    .sort((a, b) => a.position - b.position);
  const activeFreezer = householdFreezers.find((freezer) => freezer.id === activeFreezerId) ?? householdFreezers[0];
  const activeDrawers = drawers
    .filter((drawer) => drawer.freezerId === activeFreezer?.id)
    .sort((a, b) => a.position - b.position);

  const searchResults = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const householdFreezerIds = new Set(householdFreezers.map((freezer) => freezer.id));
    return sortInventory(items.filter(
      (item) =>
        householdFreezerIds.has(item.freezerId) &&
        `${item.label} ${item.notes}`.toLocaleLowerCase().includes(normalized),
    ), sortMode);
  }, [householdFreezers, items, search, sortMode]);

  function drawerItems(drawerId: string) {
    return sortInventory(items.filter((item) => item.drawerId === drawerId), sortMode);
  }

  function toggleFreezer(freezer: Freezer) {
    if (openFreezerId === freezer.id) {
      setOpenFreezerId("");
      setOpenDrawerId("");
      return;
    }
    const firstDrawer = drawers
      .filter((drawer) => drawer.freezerId === freezer.id)
      .sort((left, right) => left.position - right.position)[0];
    setActiveFreezerId(freezer.id);
    setOpenFreezerId(freezer.id);
    setOpenDrawerId(firstDrawer?.id ?? "");
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

  function closeSheet() {
    keyboard.hide();
    setSheet(null);
    setDeleteArmed(false);
    setAccountDeleteArmed(false);
    setHouseholdDeleteArmed(false);
    setFreezerDeleteArmed(false);
    setDrawerDeleteArmedId(null);
    setSettingsView("main");
  }

  async function saveItem() {
    if (offline) {
      setToast("Icebox is read-only while offline");
      return;
    }
    const label = draft.label.trim();
    if (!label || !draft.freezerId || !draft.drawerId) {
      setToast("Add a label and choose a drawer");
      return;
    }
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
    closeSheet();
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
      setToast(editingItem ? "Item updated" : "Item added");
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
    if (file.size > 8 * 1024 * 1024) {
      setToast("Choose an image under 8MB");
      return;
    }
    let processed: File;
    try {
      processed = await reencodeImage(file);
    } catch {
      setToast("Couldn’t process that image; try a smaller photo");
      return;
    }
    const preview = URL.createObjectURL(processed);
    setDraft((current) => ({ ...current, imageUrl: preview }));
    if (!backendReady) return;
    try {
      const form = new FormData();
      form.append("image", processed);
      form.append("householdId", activeHouseholdId);
      const mediaResponse = await fetch("/api/media", { method: "POST", body: form });
      if (!mediaResponse.ok) {
        const problem = await mediaResponse.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(problem?.error?.message || "Photo upload failed");
      }
      const media = (await mediaResponse.json()) as { id: string; url: string };
      setDraft((current) => ({ ...current, imageId: media.id, imageUrl: media.url }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Photo kept locally; upload will need retrying");
    }
  }

  async function suggestLabel(imageId = draft.imageId) {
    if (!imageId && backendReady) return;
    setSuggesting(true);
    try {
      if (backendReady && imageId) {
        const result = await apiRequest<{ label: string; confidence: number }>("/api/ai/label", {
          method: "POST",
          body: JSON.stringify({ imageId, householdId: activeHouseholdId }),
        });
        setDraft((current) => ({ ...current, label: result.label }));
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setDraft((current) => ({ ...current, label: "Homemade freezer meal" }));
      }
    } catch {
      setToast("Couldn’t suggest a label — type one instead");
    } finally {
      setSuggesting(false);
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
      closeSheet();
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
      setFreezers((current) => [...current, { id: freezerId, householdId, name: "Freezer 1", position: 1 }]);
      setDrawers((current) => [...current, { id: drawerId, freezerId, name: "Drawer 1", position: 1 }]);
      setActiveHouseholdId(householdId);
      setActiveFreezerId(freezerId);
      setOpenFreezerId(freezerId);
      setOpenDrawerId(drawerId);
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
      setOpenFreezerId(result.freezers[0]?.id ?? "");
      setOpenDrawerId(result.drawers[0]?.id ?? "");
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
    if (!drawer.id.startsWith("new-") && items.some((item) => item.drawerId === drawer.id)) {
      setToast("Move or delete this drawer’s items first");
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
        await apiRequest(`/api/freezers/${editingFreezer.id}`, { method: "DELETE" });
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
          setOpenFreezerId(nextFreezer.id);
          setOpenDrawerId(nextDrawer?.id ?? "");
        }
      }
      setFreezerDeleteArmed(false);
      setToast("Freezer deleted");
      setSheet("settings");
      setSettingsView("household");
    } catch {
      setFreezerDeleteArmed(false);
      setToast("Move or delete this freezer’s items before deleting it");
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
            await apiRequest(`/api/drawers/${drawer.id}`, { method: "DELETE" });
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
          setOpenFreezerId(createdFreezer.id);
          setOpenDrawerId(firstDrawer?.id ?? "");
        }
      } else {
        if (editingFreezer) {
          setFreezers((current) => current.map((freezer) => freezer.id === editingFreezer.id ? { ...freezer, name: structureDraft.name.trim() } : freezer));
          setDrawers((current) => [
            ...current.filter((drawer) => drawer.freezerId !== editingFreezer.id),
            ...structureDraft.drawers.map((drawer, index) => ({ ...drawer, id: drawer.id.startsWith("new-") ? crypto.randomUUID() : drawer.id, name: drawer.name || `Drawer ${index + 1}`, position: index + 1 })),
          ]);
        } else {
          const freezerId = crypto.randomUUID();
          const createdDrawers = structureDraft.drawers.map((drawer, index) => ({ ...drawer, id: crypto.randomUUID(), freezerId, name: drawer.name || `Drawer ${index + 1}`, position: index + 1 }));
          setFreezers((current) => [...current, { id: freezerId, householdId: activeHousehold.id, name: structureDraft.name.trim(), position: householdFreezers.length + 1 }]);
          setDrawers((current) => [...current, ...createdDrawers]);
          setActiveFreezerId(freezerId);
          setOpenFreezerId(freezerId);
          setOpenDrawerId(createdDrawers[0]?.id ?? "");
        }
      }
      setDrawerDeleteArmedId(null);
      setToast(editingFreezer ? "Freezer setup updated" : "Freezer added");
      setSheet("settings");
      setSettingsView("household");
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
      setOpenFreezerId(firstFreezer.id);
    }
    if (firstDrawer) setOpenDrawerId(firstDrawer.id);
    closeSheet();
  }

  const openDrawer = drawers.find((drawer) => drawer.id === openDrawerId);

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
                      <KeyboardInput value={freezer.name} maxLength={60} onChange={(event) => setInductionFreezers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: event.currentTarget.value } : entry))} />
                    </label>
                    <label>
                      <span>Drawers</span>
                      <select value={freezer.drawerCount} onChange={(event) => setInductionFreezers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, drawerCount: Number(event.currentTarget.value) } : entry))}>
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
              <div>
                <p className="brand-name">Icebox</p>
                <p className="brand-subtitle">Freezer inventory</p>
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
              <button className="sort-button" type="button" onClick={() => setSheet("sort")} aria-label={`Sort inventory: ${sortLabels[sortMode]}`}>
                <MixerHorizontalIcon aria-hidden="true" />
                <span>Sort</span>
              </button>
            </div>
          </header>

          {search.trim() ? (
            <section className="search-results" aria-live="polite">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Search results</p>
                  <h1>{searchResults.length} {searchResults.length === 1 ? "item" : "items"}</h1>
                </div>
                <button type="button" onClick={() => setSearch("")}>Done</button>
              </div>
              <div className="item-list search-list">
                {searchResults.length ? (
                  searchResults.map((item) => (
                    <SwipeDeleteRow
                      key={item.id}
                      label={item.label}
                      onDelete={() => performItemDelete(item)}
                    >
                      <ItemRow
                        item={item}
                        drawer={drawers.find((drawer) => drawer.id === item.drawerId)}
                        onOpen={() => openEdit(item)}
                      />
                    </SwipeDeleteRow>
                  ))
                ) : (
                  <div className="empty-state">
                    <MagnifyingGlassIcon aria-hidden="true" />
                    <strong>No matching items</strong>
                    <span>Try a label, ingredient, or note.</span>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="freezer-section">
              <div className="freezer-accordion" aria-label={`${activeHousehold?.name ?? "Household"} freezers`}>
                {householdFreezers.map((freezer, freezerIndex) => {
                  const freezerDrawers = drawers
                    .filter((drawer) => drawer.freezerId === freezer.id)
                    .sort((left, right) => left.position - right.position);
                  const isFreezerOpen = freezer.id === openFreezerId;
                  return (
                    <article className="freezer-panel" data-open={isFreezerOpen ? "true" : "false"} key={freezer.id}>
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
                      {isFreezerOpen ? (
                        <div className="freezer-panel-content">
                          <div className="drawer-stack" aria-label={`${freezer.name} drawers`}>
                            {freezerDrawers.map((drawer) => {
                              const drawerInventory = drawerItems(drawer.id);
                              const isDrawerOpen = drawer.id === openDrawerId;
                              return (
                                <article className={`drawer ${isDrawerOpen ? "drawer-open" : ""}`} key={drawer.id}>
                                  <button
                                    className="drawer-band"
                                    type="button"
                                    aria-expanded={isDrawerOpen}
                                    onClick={() => setOpenDrawerId((current) => current === drawer.id ? "" : drawer.id)}
                                  >
                                    <span className="drawer-icon"><ArchiveIcon aria-hidden="true" /></span>
                                    <span className="drawer-title">{drawer.name}</span>
                                    {isDrawerOpen ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
                                  </button>
                                  {isDrawerOpen ? (
                                    <div className="item-list" data-testid="open-drawer-items">
                                      {drawerInventory.length ? (
                                        drawerInventory.map((item) => (
                                          <SwipeDeleteRow key={item.id} label={item.label} onDelete={() => performItemDelete(item)}>
                                            <ItemRow item={item} onOpen={() => openEdit(item)} />
                                          </SwipeDeleteRow>
                                        ))
                                      ) : (
                                        <div className="empty-drawer">
                                          <strong>This drawer is empty</strong>
                                          <button type="button" onClick={() => openAdd(drawer.id)}>Add its first item</button>
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

      {sheet === null ? (
        <div className="primary-action-wrap">
          <button className="primary-action" type="button" onClick={() => openAdd()} disabled={offline} data-testid="add-item-button">
            <PlusIcon aria-hidden="true" />
            <span>Add item{openDrawer ? ` to ${openDrawer.name}` : ""}</span>
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
          saving={saving}
          deleteArmed={deleteArmed}
          isEditing={sheet === "edit"}
          onPhoto={handlePhoto}
          onSuggest={() => suggestLabel()}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "sort"}
        onOpenChange={(open) => !open && closeSheet()}
        title="Sort inventory"
        description="Choose how items are ordered within drawers and search results."
        snap={0.46}
      >
        <div className="sort-options" role="radiogroup" aria-label="Inventory sort order">
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
              aria-checked={sortMode === option.mode}
              data-active={sortMode === option.mode ? "true" : "false"}
              onClick={() => { setSortMode(option.mode); closeSheet(); }}
            >
              <span className="sort-option-icon">{option.icon}</span>
              <span><strong>{sortLabels[option.mode]}</strong><small>{option.detail}</small></span>
              {sortMode === option.mode ? <CheckCircledIcon aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "settings"}
        onOpenChange={(open) => !open && closeSheet()}
        title={settingsView === "main" ? "Settings" : settingsView === "household" ? activeHousehold?.name ?? "Household" : "Your account"}
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
              <button className="settings-row" type="button" onClick={() => { setHouseholdNameDraft(activeHousehold?.name ?? ""); setSettingsView("household"); }}>
                <span><GearIcon aria-hidden="true" /><span><strong>Household setup</strong><small>Freezers, drawers, members, and invitations</small></span></span>
                <ChevronRightIcon aria-hidden="true" />
              </button>
              <button className="settings-row" type="button" onClick={() => setSheet("households")}>
                <span><HomeIcon aria-hidden="true" /><span><strong>Households</strong><small>Switch household or create a new one</small></span></span>
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
        ) : settingsView === "household" ? (
          <div className="settings-list">
            <div className="inline-form household-name-form">
              <label htmlFor="household-name-setting">Household name</label>
              <KeyboardInput id="household-name-setting" value={householdNameDraft} maxLength={60} onChange={(event) => setHouseholdNameDraft(event.currentTarget.value)} />
              <button className="secondary-button" type="button" onClick={saveHouseholdName}>Save name</button>
            </div>
            <button className="settings-row" type="button" onClick={() => setSheet("invite")}>
              <span><PersonIcon aria-hidden="true" /><span><strong>Invite someone</strong><small>Add their ChatGPT account email</small></span></span>
              <PlusIcon aria-hidden="true" />
            </button>
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
        description={editingFreezer ? "Rename this freezer and manage its drawers. Non-empty drawers must be emptied first." : "Name the freezer and set up between one and eight drawers."}
        snap={0.78}
      >
        <div className="settings-list structure-editor">
          <label className="form-field">
            <span>Freezer name</span>
            <KeyboardInput value={structureDraft.name} maxLength={60} onChange={(event) => setStructureDraft((current) => ({ ...current, name: event.currentTarget.value }))} />
          </label>
          <div className="settings-group compact">
            {structureDraft.drawers.map((drawer, index) => (
              <div className="drawer-edit-row" key={drawer.id}>
                <span>{index + 1}</span>
                <KeyboardInput value={drawer.name} maxLength={60} aria-label={`Drawer ${index + 1} name`} onChange={(event) => setStructureDraft((current) => ({ ...current, drawers: current.drawers.map((entry) => entry.id === drawer.id ? { ...entry, name: event.currentTarget.value } : entry) }))} />
                {structureDraft.drawers.length > 1 ? (
                  <button
                    className={drawerDeleteArmedId === drawer.id ? "armed" : ""}
                    type="button"
                    aria-label={drawerDeleteArmedId === drawer.id ? `Confirm remove drawer ${index + 1}` : `Remove drawer ${index + 1}`}
                    title={drawerDeleteArmedId === drawer.id ? "Tap again to remove" : "Remove drawer"}
                    onClick={() => removeDrawerFromDraft(drawer)}
                  ><TrashIcon aria-hidden="true" /></button>
                ) : null}
              </div>
            ))}
          </div>
          {structureDraft.drawers.length < 8 ? <button className="secondary-button" type="button" onClick={() => { setDrawerDeleteArmedId(null); setStructureDraft((current) => ({ ...current, drawers: [...current.drawers, { id: `new-${crypto.randomUUID()}`, freezerId: editingFreezer?.id ?? "", name: `Drawer ${current.drawers.length + 1}`, position: current.drawers.length + 1 }] })); }}><PlusIcon aria-hidden="true" /> Add drawer</button> : null}
          <button className="save-button" type="button" disabled={saving} onClick={saveFreezerStructure}>{saving ? "Saving…" : editingFreezer ? "Save freezer setup" : "Add freezer"}</button>
          {editingFreezer ? (
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
                  ? "Confirm delete freezer"
                  : "Delete freezer"}
            </button>
          ) : null}
        </div>
      </BottomSheet>

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

function ItemRow({ item, drawer, onOpen }: { item: InventoryItem; drawer?: Drawer; onOpen: () => void }) {
  return (
    <button className="item-row" type="button" onClick={onOpen} aria-label={`Edit ${item.label}`}>
      <ItemThumbnail itemId={item.id} label={item.label} imageUrl={item.imageUrl} />
      <span className="item-copy">
        <strong>{item.label}</strong>
        <small>Frozen {formatFrozenDate(item.frozenOn)}{drawer ? ` · ${drawer.name}` : ""}</small>
        {item.expiresOn ? <small className="expiry-date">Expires {formatFrozenDate(item.expiresOn)}</small> : null}
      </span>
      <ChevronRightIcon aria-hidden="true" />
    </button>
  );
}

function ItemThumbnail({
  itemId,
  label,
  imageUrl,
  size = "row",
}: {
  itemId: string;
  label: string;
  imageUrl?: string;
  size?: "row" | "editor";
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <span
      className="item-thumbnail"
      data-colour={itemThumbnailColour(itemId)}
      data-size={size}
      aria-hidden="true"
    >
      {imageUrl && !imageFailed ? (
        <img src={imageUrl} alt="" draggable={false} onError={() => setImageFailed(true)} />
      ) : (
        <span>{itemInitials(label)}</span>
      )}
    </span>
  );
}

function ItemForm({
  draft,
  setDraft,
  freezers,
  drawers,
  aiLabelEnabled,
  suggesting,
  saving,
  deleteArmed,
  isEditing,
  onPhoto,
  onSuggest,
  onSave,
  onDelete,
}: {
  draft: InventoryItem;
  setDraft: (updater: (current: InventoryItem) => InventoryItem) => void;
  freezers: Freezer[];
  drawers: Drawer[];
  aiLabelEnabled: boolean;
  suggesting: boolean;
  saving: boolean;
  deleteArmed: boolean;
  isEditing: boolean;
  onPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onSuggest: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const availableDrawers = drawers.filter((drawer) => drawer.freezerId === draft.freezerId);
  return (
    <div className="item-form">
      <div className="photo-field">
        <label
          className="photo-picker"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.querySelector<HTMLInputElement>("input")?.click();
            }
          }}
        >
          <ItemThumbnail itemId={draft.id} label={draft.label} imageUrl={draft.imageUrl} size="editor" />
          <span>{draft.imageUrl ? "Change photo" : "Add photo"}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onPhoto} />
        </label>
      </div>
      <div className="label-field-row">
        <label className="field label-field" htmlFor="item-label">
          <span>Label</span>
          <KeyboardInput id="item-label" value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.currentTarget.value }))} maxLength={80} placeholder={suggesting ? "Looking at your photo…" : "e.g. Chicken curry"} />
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
            <MagicWandIcon aria-hidden="true" />
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
          <select id="item-drawer" value={draft.drawerId} onChange={(event) => setDraft((current) => ({ ...current, drawerId: event.currentTarget.value }))}>
            {availableDrawers.map((drawer) => <option key={drawer.id} value={drawer.id}>{drawer.name}</option>)}
          </select>
        </label>
      </div>
      <div className="field-grid date-grid">
        <label className="field" htmlFor="item-date">
          <span>Frozen on</span>
          <input id="item-date" type="date" value={draft.frozenOn} onChange={(event) => setDraft((current) => ({ ...current, frozenOn: event.currentTarget.value }))} />
        </label>
        <label className="field" htmlFor="item-expiry-date">
          <span>Expiry <i>optional</i></span>
          <input id="item-expiry-date" type="date" value={draft.expiresOn ?? ""} onChange={(event) => setDraft((current) => ({ ...current, expiresOn: event.currentTarget.value || undefined }))} />
        </label>
      </div>
      <label className="field notes-field" htmlFor="item-notes">
        <span>Notes <i>optional</i></span>
        <KeyboardTextarea id="item-notes" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.currentTarget.value }))} maxLength={2000} placeholder="Describe the item in more detail, number of portions, instructions for reheating etc" />
      </label>
      <button className="primary-sheet-button" type="button" onClick={onSave} disabled={saving}>{saving ? "Saving…" : isEditing ? "Save changes" : "Add to freezer"}</button>
      {isEditing ? <button className={`danger-button ${deleteArmed ? "armed" : ""}`} type="button" onClick={onDelete}><TrashIcon aria-hidden="true" /> {deleteArmed ? "Confirm delete" : "Delete item"}</button> : null}
    </div>
  );
}
