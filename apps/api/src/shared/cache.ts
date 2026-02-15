import { redis } from './redis.js';
import { z } from 'zod';

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
  schema?: z.ZodType<T>,
): Promise<T> {
  // Cache reads are best-effort: if Redis is down, fall through to the database.
  try {
    const cachedValue = await redis.get(key);
    if (cachedValue !== null) {
      return schema ? schema.parse(cachedValue) : (cachedValue as T);
    }
  } catch {
    // Redis unavailable — continue to fetchFn
  }

  const freshValue = await fetchFn();

  // Cache writes are fire-and-forget: don't let a Redis failure block the response.
  redis.set(key, freshValue, { ex: ttlSeconds }).catch(() => {});

  return freshValue;
}

/**
 * Invalidates a cached key. Call this when data changes.
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // Best-effort: stale data will expire via TTL
  }
}
