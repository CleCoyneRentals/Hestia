import { redis } from './redis.js';

/**
 * Generic cache-aside helper.
 * Returns cached data if available, otherwise calls fetchFn, caches the result, and returns it.
 *
 * @param key - Unique cache key (e.g., `sub:${userId}`)
 * @param ttlSeconds - How long to cache (e.g., 300 = 5 minutes)
 * @param fetchFn - Function that fetches fresh data from the database
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cachedValue = await redis.get(key);
  // TODO(Phase 2): Add Zod schema parameter for type-safe deserialization instead of `as T`
  if (cachedValue !== null) {
    return cachedValue as T;
  }

  const freshValue = await fetchFn();
  await redis.set(key, freshValue, { ex: ttlSeconds });

  return freshValue;
}

/**
 * Invalidates a cached key. Call this when data changes.
 */
export async function invalidateCache(key: string): Promise<void> {
  await redis.del(key);
}
