import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import IORedis from 'ioredis';
import { env } from '../config.js';

// ---------- Upstash REST Client ----------
// HTTP-based, stateless. Used for caching and simple get/set operations.

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- Rate Limiters ----------
// Sliding window: "no more than X requests in any rolling Y-second period."

// Standard API endpoints: 100 requests per 60 seconds
export const standardRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '60 s'),
  analytics: true,
  prefix: 'rl:standard',
});

// Auth endpoints (login, register): 10 requests per 60 seconds
export const authRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:auth',
});

// File upload endpoints: 20 requests per 60 seconds
export const uploadRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '60 s'),
  prefix: 'rl:upload',
});

// ---------- IORedis Client ----------
// Persistent TCP connection. Required by Socket.io adapter (Phase 9) and BullMQ (Phase 5).

export const ioRedisClient = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

ioRedisClient.on('connect', () => {
  console.log('IORedis connected to Upstash');
});

ioRedisClient.on('error', (err) => {
  console.error('IORedis connection error:', err.message);
});
