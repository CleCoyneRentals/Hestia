import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyWebhookMock,
  upsertUserFromClerkPayloadMock,
  redisSetMock,
  redisDelMock,
  webhookLimitMock,
  AuthSyncErrorMock,
} = vi.hoisted(() => ({
  verifyWebhookMock: vi.fn(),
  upsertUserFromClerkPayloadMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
  webhookLimitMock: vi.fn(),
  AuthSyncErrorMock: class AuthSyncError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, code = 'AUTH_USER_SYNC_FAILED', statusCode = 401) {
      super(message);
      this.name = 'AuthSyncError';
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@clerk/fastify/webhooks', () => ({
  verifyWebhook: verifyWebhookMock,
}));

vi.mock('../src/modules/auth/userSync.js', () => ({
  upsertUserFromClerkPayload: upsertUserFromClerkPayloadMock,
  AuthSyncError: AuthSyncErrorMock,
}));

vi.mock('../src/shared/redis.js', () => ({
  redis: {
    set: redisSetMock,
    del: redisDelMock,
  },
  webhookRateLimit: {
    limit: webhookLimitMock,
  },
}));

import { clerkWebhookRoutes } from '../src/routes/webhooks/clerk.js';

function makeUserEvent(type: 'user.created' | 'user.updated' | 'user.deleted') {
  return {
    type,
    object: 'event',
    data: {
      id: 'user_123',
    },
    event_attributes: {
      http_request: {
        client_ip: '127.0.0.1',
        user_agent: 'vitest',
      },
    },
  };
}

describe('clerk webhook route', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    webhookLimitMock.mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60_000,
    });
    app = Fastify();
    await app.register(clerkWebhookRoutes, { prefix: '/webhooks' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns duplicate response when idempotency key already exists', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.created'));
    redisSetMock.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: {
        'svix-id': 'msg_1',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(redisSetMock).toHaveBeenCalledWith(
      'clerk-webhook:svix:msg_1',
      '1',
      { nx: true, ex: 86400 },
    );
    expect(upsertUserFromClerkPayloadMock).not.toHaveBeenCalled();
  });

  it('returns 429 when webhook rate limit is exceeded', async () => {
    webhookLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: {
        'svix-id': 'msg_rl_1',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    });
    expect(verifyWebhookMock).not.toHaveBeenCalled();
    expect(upsertUserFromClerkPayloadMock).not.toHaveBeenCalled();
  });

  it('processes first delivery and returns ok', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.updated'));
    redisSetMock.mockResolvedValueOnce('OK');
    upsertUserFromClerkPayloadMock.mockResolvedValueOnce(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: {
        'svix-id': 'msg_2',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(upsertUserFromClerkPayloadMock).toHaveBeenCalledTimes(1);
    expect(redisDelMock).not.toHaveBeenCalled();
  });

  it('clears idempotency key when processing fails', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.deleted'));
    redisSetMock.mockResolvedValueOnce('OK');
    upsertUserFromClerkPayloadMock.mockRejectedValueOnce(new Error('sync failed'));
    redisDelMock.mockResolvedValueOnce(1);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: {
        'svix-id': 'msg_3',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'WEBHOOK_PROCESSING_FAILED',
      message: 'Webhook processing failed',
    });
    expect(redisDelMock).toHaveBeenCalledWith('clerk-webhook:svix:msg_3');
  });

  it('returns 400 INVALID_WEBHOOK when signature verification fails', async () => {
    verifyWebhookMock.mockRejectedValueOnce(new Error('Invalid signature'));

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'svix-id': 'msg_bad' },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'INVALID_WEBHOOK',
      message: 'Webhook verification failed',
    });
    expect(redisSetMock).not.toHaveBeenCalled();
    expect(upsertUserFromClerkPayloadMock).not.toHaveBeenCalled();
  });

  it('returns 200 ok for unsupported event type without touching idempotency or upsert', async () => {
    verifyWebhookMock.mockResolvedValueOnce({
      type: 'organization.created',
      object: 'event',
      data: { id: 'org_123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'svix-id': 'msg_org' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(redisSetMock).not.toHaveBeenCalled();
    expect(upsertUserFromClerkPayloadMock).not.toHaveBeenCalled();
  });

  it('clears idempotency key and preserves 5xx AuthSyncError status/code/message', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.created'));
    redisSetMock.mockResolvedValueOnce('OK');
    upsertUserFromClerkPayloadMock.mockRejectedValueOnce(
      new AuthSyncErrorMock('Upstream sync error', 'AUTH_UPSTREAM_FAILURE', 503),
    );
    redisDelMock.mockResolvedValueOnce(1);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'svix-id': 'msg_5xx' },
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'AUTH_UPSTREAM_FAILURE',
      message: 'Upstream sync error',
    });
    expect(redisDelMock).toHaveBeenCalledWith('clerk-webhook:svix:msg_5xx');
  });

  it('uses fallback idempotency key when svix-id header is absent', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.created'));
    redisSetMock.mockResolvedValueOnce('OK');
    upsertUserFromClerkPayloadMock.mockResolvedValueOnce(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      // no svix-id header
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(redisSetMock).toHaveBeenCalledWith(
      'clerk-webhook:fallback:user.created:user_123',
      '1',
      { nx: true, ex: 86400 },
    );
  });

  it('preserves non-5xx AuthSyncError response and keeps idempotency key', async () => {
    verifyWebhookMock.mockResolvedValueOnce(makeUserEvent('user.created'));
    redisSetMock.mockResolvedValueOnce('OK');
    upsertUserFromClerkPayloadMock.mockRejectedValueOnce(
      new AuthSyncErrorMock(
        'Clerk webhook payload missing a usable email address',
        'AUTH_EMAIL_MISSING',
        400,
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: {
        'svix-id': 'msg_4',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'AUTH_EMAIL_MISSING',
      message: 'Clerk webhook payload missing a usable email address',
    });
    expect(redisDelMock).not.toHaveBeenCalled();
  });
});
