const CACHE_DB = "icebox-private-cache-v2";
const LEGACY_CACHE_DBS = ["icebox-private-cache-v1"];
const CACHE_STORE = "bootstrap";
const LAST_USER_KEY = "icebox:last-user-id";

type UserKeyedBootstrap = {
  user: { id: string };
};

function deleteCacheDatabase(name: string) {
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const request = indexedDB.deleteDatabase(name);
    const timeout = window.setTimeout(finish, 250);
    request.onsuccess = request.onerror = request.onblocked = finish;
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

export async function saveCachedBootstrap<T extends UserKeyedBootstrap>(data: T) {
  const db = await openCache();
  const previousUserId = localStorage.getItem(LAST_USER_KEY);
  const transaction = db.transaction(CACHE_STORE, "readwrite");
  if (previousUserId && previousUserId !== data.user.id) transaction.objectStore(CACHE_STORE).clear();
  transaction.objectStore(CACHE_STORE).put(data, data.user.id);
  localStorage.setItem(LAST_USER_KEY, data.user.id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  await Promise.all(LEGACY_CACHE_DBS.map(deleteCacheDatabase));
}

export async function loadCachedBootstrap<T>(): Promise<T | null> {
  const userId = localStorage.getItem(LAST_USER_KEY);
  if (!userId) return null;
  const db = await openCache();
  const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(userId);
  const result = await new Promise<T | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function clearPrivateCache() {
  localStorage.removeItem(LAST_USER_KEY);
  await Promise.all([CACHE_DB, ...LEGACY_CACHE_DBS].map(deleteCacheDatabase));
  navigator.serviceWorker?.controller?.postMessage("CLEAR_ICEBOX_CACHES");
}
