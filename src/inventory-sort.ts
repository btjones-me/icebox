export type InventorySortMode = "expiry" | "alphabetical" | "added";

type SortableInventoryItem = {
  label: string;
  expiresOn?: string | null;
  createdAt: string;
};

export function sortInventory<T extends SortableInventoryItem>(items: T[], mode: InventorySortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === "expiry") {
      if (!left.expiresOn && !right.expiresOn) {
        return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      }
      if (!left.expiresOn) return 1;
      if (!right.expiresOn) return -1;
      return left.expiresOn.localeCompare(right.expiresOn) || left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    }
    if (mode === "alphabetical") {
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    }
    return right.createdAt.localeCompare(left.createdAt) || left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  });
}
