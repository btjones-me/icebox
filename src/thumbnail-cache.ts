type ThumbnailCacheEntry = {
  objectUrl: string;
  byteSize: number;
  lastUsed: number;
};

const MAX_CACHE_ENTRIES = 96;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;

const thumbnailCache = new Map<string, ThumbnailCacheEntry>();
const thumbnailLoads = new Map<string, Promise<string>>();
let cachedBytes = 0;
let accessSequence = 0;
let cacheGeneration = 0;

function cacheKey(url: string) {
  return new URL(url, window.location.origin).href;
}

function touch(entry: ThumbnailCacheEntry) {
  entry.lastUsed = accessSequence += 1;
  return entry.objectUrl;
}

function removeEntry(key: string) {
  const entry = thumbnailCache.get(key);
  if (!entry) return;
  thumbnailCache.delete(key);
  cachedBytes = Math.max(0, cachedBytes - entry.byteSize);
  URL.revokeObjectURL(entry.objectUrl);
}

function trimCache() {
  while (thumbnailCache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    let oldestKey: string | null = null;
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [key, entry] of thumbnailCache) {
      if (entry.lastUsed < oldestUse) {
        oldestKey = key;
        oldestUse = entry.lastUsed;
      }
    }
    if (!oldestKey) return;
    removeEntry(oldestKey);
  }
}

export function isCacheableThumbnailUrl(url?: string) {
  if (!url) return false;
  const parsed = new URL(url, window.location.origin);
  return parsed.origin === window.location.origin && /^\/api\/media\/[^/]+\/thumbnail$/.test(parsed.pathname);
}

export function peekCachedThumbnail(url: string) {
  const entry = thumbnailCache.get(cacheKey(url));
  return entry ? touch(entry) : null;
}

export function cacheThumbnailBlob(url: string, blob: Blob) {
  const key = cacheKey(url);
  removeEntry(key);
  const objectUrl = URL.createObjectURL(blob);
  thumbnailCache.set(key, {
    objectUrl,
    byteSize: blob.size,
    lastUsed: accessSequence += 1,
  });
  cachedBytes += blob.size;
  trimCache();
  return thumbnailCache.get(key)?.objectUrl ?? objectUrl;
}

export function loadCachedThumbnail(url: string) {
  const existing = peekCachedThumbnail(url);
  if (existing) return Promise.resolve(existing);
  const key = cacheKey(url);
  const inFlight = thumbnailLoads.get(key);
  if (inFlight) return inFlight;

  const generation = cacheGeneration;
  const load = fetch(key, { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) throw new Error("Thumbnail response was not an image");
      const blob = await response.blob();
      if (generation !== cacheGeneration) throw new Error("Thumbnail cache was cleared");
      return cacheThumbnailBlob(key, blob);
    })
    .finally(() => thumbnailLoads.delete(key));
  thumbnailLoads.set(key, load);
  return load;
}

export function clearThumbnailCache() {
  cacheGeneration += 1;
  for (const key of [...thumbnailCache.keys()]) removeEntry(key);
  thumbnailLoads.clear();
  cachedBytes = 0;
}
