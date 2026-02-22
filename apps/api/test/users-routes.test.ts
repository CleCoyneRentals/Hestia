import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, authRateLimitMiddlewareMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  authRateLimitMiddlewareMock: vi.fn(),
}));

vi.mock('../src/shared/db.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/middleware/rateLimit.js', () => ({
  authRateLimitMiddleware: authRateLimitMiddlewareMock,
}));

import { userRoutes } from '../src/routes/api/users.js';

function makeUserResponse() {
  return {
    id: 'user_1',
    clerkUserId: 'clerk_1',
    email: 'user@example.com',
    displayName: 'Pat Coyne',
    avatarUrl: 'https://example.com/avatar.jpg',
    emailVerified: true,
    createdAt: new Date('2026-02-22T00:00:00.000Z'),
    updatedAt: new Date('2026-02-22T00:00:00.000Z'),
    lastLoginAt: new Date('2026-02-22T00:00:00.000Z'),
  };
}

describe('userRoutes', () => {
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
    await app.register(userRoutes, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns authenticated user profile for GET /api/users/me', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeUserResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        ...makeUserResponse(),
        createdAt: '2026-02-22T00:00:00.000Z',
        updatedAt: '2026-02-22T00:00:00.000Z',
        lastLoginAt: '2026-02-22T00:00:00.000Z',
      },
    });
    expect(authRateLimitMiddlewareMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when profile is missing', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User profile not found',
    });
  });

  it('updates displayName and avatarUrl on PATCH /api/users/me', async () => {
    prismaMock.user.update.mockResolvedValueOnce({
      ...makeUserResponse(),
      displayName: 'Patricia Coyne',
      avatarUrl: null,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: {
        displayName: '  Patricia   Coyne  ',
        avatarUrl: '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user_1' },
      data: {
        displayName: 'Patricia Coyne',
        avatarUrl: null,
      },
    }));
    expect(response.json()).toEqual({
      user: {
        ...makeUserResponse(),
        displayName: 'Patricia Coyne',
        avatarUrl: null,
        createdAt: '2026-02-22T00:00:00.000Z',
        updatedAt: '2026-02-22T00:00:00.000Z',
        lastLoginAt: '2026-02-22T00:00:00.000Z',
      },
    });
    expect(authRateLimitMiddlewareMock).toHaveBeenCalledTimes(1);
  });

  it('updates only avatarUrl on PATCH /api/users/me (partial update)', async () => {
    prismaMock.user.update.mockResolvedValueOnce({
      ...makeUserResponse(),
      avatarUrl: 'https://example.com/new-avatar.jpg',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { avatarUrl: 'https://example.com/new-avatar.jpg' },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user_1' },
      data: { avatarUrl: 'https://example.com/new-avatar.jpg' },
    }));
  });

  it('returns 400 for PATCH with unknown fields (.strict() enforcement)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: 'Pat', unknownField: 'bad' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid profile update payload',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('returns 400 for PATCH with whitespace-only displayName', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid profile update payload',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 on PATCH when user is deleted concurrently (P2025)', async () => {
    const prismaError = Object.assign(
      new Error('Record to update not found.'),
      { code: 'P2025', clientVersion: '6.0.0' },
    );
    // Make it pass instanceof Prisma.PrismaClientKnownRequestError
    Object.setPrototypeOf(prismaError, (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype);
    prismaMock.user.update.mockRejectedValueOnce(prismaError);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: 'Pat' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User profile not found',
    });
  });

  it('returns 400 for invalid PATCH payload (no fields)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid profile update payload',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
