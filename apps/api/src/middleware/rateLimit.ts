import { FastifyRequest, FastifyReply } from 'fastify';
import { authRateLimit, standardRateLimit, webhookRateLimit } from '../shared/redis.js';

type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

type RateLimiter = {
  limit: (identifier: string) => Promise<RateLimitResult>;
};

async function applyRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  limiter: RateLimiter,
) {
  // req.user is populated by auth middleware in Phase 1.
  // Until then, falls back to IP address.
  const identifier = req.user?.id || req.ip;

  const { success, limit, remaining, reset } = await limiter.limit(identifier);

  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', reset);

  if (!success) {
    return reply.status(429).send({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil((reset - Date.now()) / 1000),
    });
  }
}

/**
 * Rate limit middleware using Upstash sliding window.
 * Identifies users by their authenticated user ID (Phase 1+) or IP address.
 */
export async function rateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  return applyRateLimit(req, reply, standardRateLimit);
}

/**
 * Auth-specific rate limit middleware.
 * Keeps authentication/profile endpoints at 10 requests/minute.
 */
export async function authRateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  return applyRateLimit(req, reply, authRateLimit);
}

/**
 * Webhook-specific rate limit middleware for public webhook endpoints.
 * Uses IP-based throttling to protect signature verification from abuse.
 */
export async function webhookRateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  return applyRateLimit(req, reply, webhookRateLimit);
}
