import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyWebhookMock,
  upsertUserFromClerkPayloadMock,
  redisSetMock,
  redisDelMock,
} = vi.hoisted(() => ({
  verifyWebhookMock: vi.fn(),
  upsertUserFromClerkPayloadMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
}));

vi.mock('@clerk/fastify/webhooks', () => ({
  verifyWebhook: verifyWebhookMock,
}));

vi.mock('../src/modules/auth/userSync.js', () => ({
  upsertUserFromClerkPayload: upsertUserFromClerkPayloadMock,
}));

vi.mock('../src/shared/redis.js', () => ({
  redis: {
    set: redisSetMock,
    del: redisDelMock,
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
});
