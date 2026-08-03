export type InventorySortMode = "expiry" | "alphabetical" | "added";
export type InventoryViewMode = "default" | InventorySortMode;

type SortableInventoryItem = {
  id?: string;
  freezerId?: string;
  label: string;
  notes?: string;
  expiresOn?: string | null;
  createdAt: string;
};

function compareLabel(left: SortableInventoryItem, right: SortableInventoryItem) {
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}

function compareId(left: SortableInventoryItem, right: SortableInventoryItem) {
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

export function sortInventory<T extends SortableInventoryItem>(items: T[], mode: InventorySortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === "expiry") {
      if (!left.expiresOn && !right.expiresOn) {
        return compareLabel(left, right) || right.createdAt.localeCompare(left.createdAt) || compareId(left, right);
      }
      if (!left.expiresOn) return 1;
      if (!right.expiresOn) return -1;
      return left.expiresOn.localeCompare(right.expiresOn)
        || compareLabel(left, right)
        || right.createdAt.localeCompare(left.createdAt)
        || compareId(left, right);
    }
    if (mode === "alphabetical") {
      return compareLabel(left, right) || right.createdAt.localeCompare(left.createdAt) || compareId(left, right);
    }
    return right.createdAt.localeCompare(left.createdAt) || compareLabel(left, right) || compareId(left, right);
  });
}

export function selectInventoryResults<T extends SortableInventoryItem>(
  items: T[],
  householdFreezerIds: Iterable<string>,
  query: string,
  viewMode: InventoryViewMode,
): T[] {
  const allowedFreezers = new Set(householdFreezerIds);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingItems = items.filter((item) => {
    if (!item.freezerId || !allowedFreezers.has(item.freezerId)) return false;
    if (!normalizedQuery) return true;
    return `${item.label} ${item.notes ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
  });

  return sortInventory(matchingItems, viewMode === "default" ? "added" : viewMode);
}
