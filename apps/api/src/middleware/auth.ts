import { getAuth } from '@clerk/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ensureUserForRequest, AuthSyncError } from '../modules/auth/userSync.js';
import { Sentry } from '../shared/sentry.js';

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { isAuthenticated, userId, sessionClaims } = getAuth(req);

  if (!isAuthenticated || !userId) {
    reply.code(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    return;
  }

  try {
    const user = await ensureUserForRequest(userId, sessionClaims ?? null);
    req.user = {
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
    };
  } catch (error) {
    req.log.error(error, 'Failed to sync authenticated user');

    const authError = error instanceof AuthSyncError
      ? error
      : new AuthSyncError('Failed to sync authenticated user');

    Sentry.captureException(error, {
      extra: {
        clerkUserId: userId,
        path: req.url,
      },
    });

    reply.code(authError.statusCode).send({
      code: authError.code,
      message: authError.message,
    });
  }
}
