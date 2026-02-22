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

  it('creates new user via Clerk API when not found in DB', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    clerkClientMock.users.getUser.mockResolvedValueOnce({
      id: 'clerk_1',
      primaryEmailAddress: {
        emailAddress: 'new@example.com',
        verification: { status: 'verified' },
      },
      emailAddresses: [{ emailAddress: 'new@example.com' }],
      firstName: 'New',
      lastName: 'User',
      username: null,
      imageUrl: null,
      lastSignInAt: null,
    });

    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'user_new',
          clerkUserId: 'clerk_1',
          email: 'new@example.com',
        }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback, _options) => callback(tx));

    const result = await ensureUserForRequest('clerk_1', null);

    expect(clerkClientMock.users.getUser).toHaveBeenCalledWith('clerk_1');
    expect(result).toEqual({ id: 'user_new', clerkUserId: 'clerk_1', email: 'new@example.com' });
  });

  it('rejects when Clerk lookup returns 404 even if claims email exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    clerkClientMock.users.getUser.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));

    await expect(
      ensureUserForRequest('clerk_1', { email: 'fallback@example.com' }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_CLERK_USER_NOT_ACCESSIBLE',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when Clerk lookup returns 403', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    clerkClientMock.users.getUser.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(
      ensureUserForRequest('clerk_1', { email: 'fallback@example.com' }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_CLERK_USER_NOT_ACCESSIBLE',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('falls back to claims on transient Clerk lookup error', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    clerkClientMock.users.getUser.mockRejectedValueOnce(new Error('Clerk API unavailable'));

    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'user_fallback',
          clerkUserId: 'clerk_1',
          email: 'fallback@example.com',
        }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback, _options) => callback(tx));

    const result = await ensureUserForRequest('clerk_1', { email: 'fallback@example.com' });

    expect(clerkClientMock.users.getUser).toHaveBeenCalledWith('clerk_1');
    expect(sentryMock.captureException).toHaveBeenCalled();
    expect(result).toEqual({ id: 'user_fallback', clerkUserId: 'clerk_1', email: 'fallback@example.com' });
  });

  it('soft-deletes user on user.deleted webhook', async () => {
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });

    await upsertUserFromClerkPayload({
      type: 'user.deleted',
      object: 'event',
      data: { id: 'clerk_1', deleted: true },
      event_attributes: {
        http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' },
      },
    } as any);

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk_1' },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws AUTH_EMAIL_MISSING when Clerk lookup fails transiently and no claims email', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    clerkClientMock.users.getUser.mockRejectedValueOnce(new Error('Clerk API unavailable'));

    await expect(
      ensureUserForRequest('clerk_1', null),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_EMAIL_MISSING',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws conflict when byClerkUserId email changes to one owned by another user', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 'user_1', clerkUserId: 'clerk_1', email: 'old@example.com' })
          .mockResolvedValueOnce({ id: 'user_2', email: 'new@example.com', clerkUserId: 'clerk_other' }),
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
        first_name: 'User',
        last_name: 'One',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'new@example.com', verification: { status: 'verified' } }],
      },
      event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' } },
    } as any)).rejects.toMatchObject({ statusCode: 409, code: 'AUTH_IDENTITY_CONFLICT' });
  });

  it('throws AUTH_EMAIL_MISSING when user.created has empty email list', async () => {
    await expect(upsertUserFromClerkPayload({
      type: 'user.created',
      object: 'event',
      data: {
        id: 'clerk_1',
        first_name: 'No',
        last_name: 'Email',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: null,
        email_addresses: [],
      },
      event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' } },
    } as any)).rejects.toMatchObject({ statusCode: 400, code: 'AUTH_EMAIL_MISSING' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('logs warning and skips updateMany when user.deleted has no id', async () => {
    await upsertUserFromClerkPayload({
      type: 'user.deleted',
      object: 'event',
      data: { id: null, deleted: true },
      event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' } },
    } as any);

    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      'Received Clerk user.deleted webhook without user id',
      expect.objectContaining({ level: 'warning' }),
    );
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('treats Clerk 401 as permanent — does not fall through to claims-based identity', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    clerkClientMock.users.getUser.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );

    await expect(
      ensureUserForRequest('clerk_1', { email: 'fallback@example.com' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'AUTH_CLERK_USER_NOT_ACCESSIBLE' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('user.updated does not reactivate a soft-deleted user', async () => {
    const softDeletedUser = {
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
      isActive: false,
      deletedAt: new Date('2026-01-01'),
    };
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValueOnce(softDeletedUser),
        update: vi.fn().mockResolvedValue(softDeletedUser),
        create: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async callback => callback(tx));

    await upsertUserFromClerkPayload({
      type: 'user.updated',
      object: 'event',
      data: {
        id: 'clerk_1',
        first_name: 'User',
        last_name: 'One',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'user@example.com', verification: { status: 'verified' } }],
      },
      event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' } },
    } as any);

    const updateCallData = (tx.user.update.mock.calls[0] as any[])[0].data;
    expect(updateCallData).not.toHaveProperty('isActive');
    expect(updateCallData).not.toHaveProperty('deletedAt');
  });

  it('blocks legacy account link when email is not verified', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null) // byClerkUserId → not found
          .mockResolvedValueOnce({ id: 'legacy_user', email: 'legacy@example.com', clerkUserId: null }),
        update: vi.fn(),
        create: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async callback => callback(tx));

    await expect(upsertUserFromClerkPayload({
      type: 'user.created',
      object: 'event',
      data: {
        id: 'clerk_new',
        first_name: 'New',
        last_name: 'User',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'legacy@example.com', verification: { status: 'unverified' } }],
      },
      event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' } },
    } as any)).rejects.toMatchObject({ statusCode: 403, code: 'AUTH_EMAIL_VERIFICATION_REQUIRED' });

    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('retries upsertIdentity on P2002 and succeeds on second attempt', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });

    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null) // byClerkUserId attempt 1
          .mockResolvedValueOnce(null) // byEmail attempt 1
          .mockResolvedValueOnce(null) // byClerkUserId attempt 2
          .mockResolvedValueOnce(null), // byEmail attempt 2
        update: vi.fn(),
        create: vi.fn()
          .mockRejectedValueOnce(p2002Error)
          .mockResolvedValueOnce({
            id: 'user_retry',
            clerkUserId: 'clerk_1',
            email: 'retry@example.com',
          }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback, _options) => callback(tx));

    await upsertUserFromClerkPayload({
      type: 'user.created',
      object: 'event',
      data: {
        id: 'clerk_1',
        first_name: 'Retry',
        last_name: 'User',
        username: null,
        image_url: null,
        last_sign_in_at: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{
          id: 'email_1',
          email_address: 'retry@example.com',
          verification: { status: 'verified' },
        }],
      },
      event_attributes: {
        http_request: { client_ip: '127.0.0.1', user_agent: 'vitest' },
      },
    } as any);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });
});
