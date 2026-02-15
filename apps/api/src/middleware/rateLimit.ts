import { FastifyRequest, FastifyReply } from 'fastify';
import { standardRateLimit } from '../shared/redis.js';

/**
 * Rate limit middleware using Upstash sliding window.
 * Identifies users by their authenticated user ID (Phase 1+) or IP address.
 */
export async function rateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  // req.user is populated by auth middleware in Phase 1.
  // Until then, falls back to IP address.
  const identifier = (req as any).user?.id || req.ip;

  const { success, limit, remaining, reset } = await standardRateLimit.limit(
    identifier,
  );

  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', reset);

  if (!success) {
    reply.status(429).send({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil((reset - Date.now()) / 1000),
    });
  }
}
