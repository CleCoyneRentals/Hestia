import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, clerkClientMock, sentryMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  clerkClientMock: {
    users: {
      getUser: vi.fn(),
    },
  },
  sentryMock: {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  },
}));

vi.mock('../src/shared/db.js', () => ({
  prisma: prismaMock,
}));

vi.mock('@clerk/fastify', () => ({
  clerkClient: clerkClientMock,
}));

vi.mock('../src/shared/sentry.js', () => ({
  Sentry: sentryMock,
}));

import {
  ensureUserForRequest,
  upsertUserFromClerkPayload,
} from '../src/modules/auth/userSync.js';

describe('userSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing active user for request auth', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
      isActive: true,
      deletedAt: null,
    });

    const result = await ensureUserForRequest('clerk_1', null);

    expect(result).toEqual({
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
    });
    expect(clerkClientMock.users.getUser).not.toHaveBeenCalled();
  });

  it('blocks inactive user for request auth', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
      isActive: false,
      deletedAt: new Date('2026-02-21T00:00:00.000Z'),
    });

    await expect(ensureUserForRequest('clerk_1', null)).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTH_USER_INACTIVE',
    });
    expect(clerkClientMock.users.getUser).not.toHaveBeenCalled();
  });

  it('uses serializable transaction for webhook upsert', async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'user_1',
          clerkUserId: 'clerk_1',
          email: 'new@example.com',
        }),
      },
    };
    let capturedOptions: unknown;

    prismaMock.$transaction.mockImplementation(async (callback, options) => {
      capturedOptions = options;
      return callback(tx);
    });

    await upsertUserFromClerkPayload({
      type: 'user.created',
      object: 'event',
      data: {
        id: 'clerk_1',
        first_name: 'New',
        last_name: 'User',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{
          id: 'email_1',
          email_address: 'new@example.com',
          verification: { status: 'verified' },
        }],
      },
      event_attributes: {
        http_request: {
          client_ip: '127.0.0.1',
          user_agent: 'vitest',
        },
      },
    } as any);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toEqual({ isolationLevel: 'Serializable' });
  });

  it('throws conflict when email is linked to another clerk user', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'user_existing',
            email: 'conflict@example.com',
            clerkUserId: 'clerk_other',
          }),
        update: vi.fn(),
        create: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async callback => callback(tx));

    await expect(upsertUserFromClerkPayload({
      type: 'user.updated',
      object: 'event',
      data: {
        id: 'clerk_1',
        first_name: 'Conflict',
        last_name: 'User',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{
          id: 'email_1',
          email_address: 'conflict@example.com',
          verification: { status: 'verified' },
        }],
      },
      event_attributes: {
        http_request: {
          client_ip: '127.0.0.1',
          user_agent: 'vitest',
        },
      },
    } as any)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AUTH_IDENTITY_CONFLICT',
    });
  });
});
