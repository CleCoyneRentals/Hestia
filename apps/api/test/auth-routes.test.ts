import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authRateLimitMiddlewareMock } = vi.hoisted(() => ({
  authRateLimitMiddlewareMock: vi.fn(),
}));

vi.mock('../src/middleware/rateLimit.js', () => ({
  authRateLimitMiddleware: authRateLimitMiddlewareMock,
}));

import { authRoutes } from '../src/routes/api/auth.js';

describe('authRoutes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    authRateLimitMiddlewareMock.mockResolvedValue(undefined);

    app = Fastify();
    app.addHook('preHandler', async req => {
      req.user = {
        id: 'user_1',
        clerkUserId: 'clerk_1',
        email: 'user@example.com',
      };
    });
    await app.register(authRoutes, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('applies auth rate limiting before returning auth user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 'user_1',
        clerkUserId: 'clerk_1',
        email: 'user@example.com',
      },
    });
    expect(authRateLimitMiddlewareMock).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when auth rate limit middleware blocks the request', async () => {
    authRateLimitMiddlewareMock.mockImplementationOnce(async (_req, reply) => {
      reply.code(429).send({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down.',
      });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    });
  });
});
