import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuthMock,
  ensureUserForRequestMock,
  sentryCaptureExceptionMock,
  MockAuthSyncError,
} = vi.hoisted(() => {
  class HoistedAuthSyncError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, code = 'AUTH_USER_SYNC_FAILED', statusCode = 401) {
      super(message);
      this.name = 'AuthSyncError';
      this.code = code;
      this.statusCode = statusCode;
    }
  }

  return {
    getAuthMock: vi.fn(),
    ensureUserForRequestMock: vi.fn(),
    sentryCaptureExceptionMock: vi.fn(),
    MockAuthSyncError: HoistedAuthSyncError,
  };
});

vi.mock('@clerk/fastify', () => ({
  getAuth: getAuthMock,
}));

vi.mock('../src/modules/auth/userSync.js', () => ({
  ensureUserForRequest: ensureUserForRequestMock,
  AuthSyncError: MockAuthSyncError,
}));

vi.mock('../src/shared/sentry.js', () => ({
  Sentry: {
    captureException: sentryCaptureExceptionMock,
  },
}));

import { requireAuth } from '../src/middleware/auth.js';
import { AuthSyncError } from '../src/modules/auth/userSync.js';

function makeReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function makeRequest() {
  return {
    url: '/api/auth/me',
    log: {
      error: vi.fn(),
    },
  };
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps unexpected sync failures to 500 internal auth error', async () => {
    getAuthMock.mockReturnValue({
      isAuthenticated: true,
      userId: 'clerk_1',
      sessionClaims: null,
    });
    ensureUserForRequestMock.mockRejectedValueOnce(new Error('db offline'));

    const reply = makeReply();
    await requireAuth(makeRequest() as any, reply as any);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      code: 'AUTH_USER_SYNC_INTERNAL',
      message: 'Failed to sync authenticated user',
    });
  });

  it('preserves AuthSyncError status and code', async () => {
    getAuthMock.mockReturnValue({
      isAuthenticated: true,
      userId: 'clerk_1',
      sessionClaims: null,
    });
    ensureUserForRequestMock.mockRejectedValueOnce(
      new AuthSyncError('missing email', 'AUTH_EMAIL_MISSING', 401),
    );

    const reply = makeReply();
    await requireAuth(makeRequest() as any, reply as any);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      code: 'AUTH_EMAIL_MISSING',
      message: 'missing email',
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('returns 401 and does not call ensureUserForRequest when unauthenticated', async () => {
    getAuthMock.mockReturnValue({ isAuthenticated: false, userId: null, sessionClaims: null });

    const reply = makeReply();
    await requireAuth(makeRequest() as any, reply as any);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(ensureUserForRequestMock).not.toHaveBeenCalled();
  });

  it('sets req.user when authentication and sync succeed', async () => {
    getAuthMock.mockReturnValue({
      isAuthenticated: true,
      userId: 'clerk_1',
      sessionClaims: { email: 'user@example.com' },
    });
    ensureUserForRequestMock.mockResolvedValueOnce({
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
    });

    const req = makeRequest() as any;
    const reply = makeReply();
    await requireAuth(req, reply as any);

    expect(req.user).toEqual({
      id: 'user_1',
      clerkUserId: 'clerk_1',
      email: 'user@example.com',
    });
    expect(reply.code).not.toHaveBeenCalled();
  });
});
