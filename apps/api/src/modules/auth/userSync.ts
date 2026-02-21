import type { User } from '@clerk/backend';
import { clerkClient } from '@clerk/fastify';
import { prisma } from '../../shared/db.js';
import { Sentry } from '../../shared/sentry.js';
import type {
  AuthSyncResult,
  ClerkIdentity,
  ClerkUserWebhookData,
  ClerkWebhookEvent,
  RequestClaims,
} from './types.js';

export class AuthSyncError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code = 'AUTH_USER_SYNC_FAILED', statusCode = 401) {
    super(message);
    this.name = 'AuthSyncError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function claimEmail(claims?: RequestClaims | null): string | null {
  const direct = claims?.email;
  if (typeof direct === 'string' && direct.trim()) {
    return normalizeEmail(direct);
  }

  const snake = claims?.email_address;
  if (typeof snake === 'string' && snake.trim()) {
    return normalizeEmail(snake);
  }

  return null;
}

function formatDisplayName(raw: string): string {
  return raw
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveDisplayName({
  firstName,
  lastName,
  username,
  email,
}: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email: string;
}): string {
  const name = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  if (name) {
    return name;
  }

  if (username?.trim()) {
    return username.trim();
  }

  const localPart = email.split('@')[0] ?? 'user';
  return formatDisplayName(localPart) || 'User';
}

function getWebhookPrimaryEmail(user: ClerkUserWebhookData): {
  email: string | null;
  emailVerified: boolean;
} {
  const primary = user.primary_email_address_id
    ? user.email_addresses.find(email => email.id === user.primary_email_address_id)
    : null;

  const selected = primary ?? user.email_addresses[0];
  if (!selected?.email_address) {
    return { email: null, emailVerified: false };
  }

  return {
    email: normalizeEmail(selected.email_address),
    emailVerified: selected.verification?.status === 'verified',
  };
}

function clerkIdentityFromWebhook(user: ClerkUserWebhookData): ClerkIdentity | null {
  const emailData = getWebhookPrimaryEmail(user);
  if (!emailData.email) {
    return null;
  }

  return {
    clerkUserId: user.id,
    email: emailData.email,
    displayName: resolveDisplayName({
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      email: emailData.email,
    }),
    avatarUrl: user.image_url || null,
    emailVerified: emailData.emailVerified,
    lastLoginAt: user.last_sign_in_at ? new Date(user.last_sign_in_at) : null,
  };
}

function clerkIdentityFromUser(clerkUser: User): ClerkIdentity | null {
  const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? null;

  if (!primaryEmail) {
    return null;
  }

  return {
    clerkUserId: clerkUser.id,
    email: normalizeEmail(primaryEmail),
    displayName: resolveDisplayName({
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      username: clerkUser.username,
      email: primaryEmail,
    }),
    avatarUrl: clerkUser.imageUrl || null,
    emailVerified: clerkUser.primaryEmailAddress?.verification?.status === 'verified',
    lastLoginAt: clerkUser.lastSignInAt ? new Date(clerkUser.lastSignInAt) : null,
  };
}

function toAuthSyncResult(user: {
  id: string;
  clerkUserId: string | null;
  email: string;
}): AuthSyncResult {
  return {
    id: user.id,
    clerkUserId: user.clerkUserId || '',
    email: user.email,
  };
}

const MAX_UPSERT_RETRIES = 3;
const UPSERT_RETRYABLE_PRISMA_CODES = new Set(['P2002', 'P2034']);

function isRetryableUpsertError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;

  if (code && UPSERT_RETRYABLE_PRISMA_CODES.has(code)) {
    return true;
  }

  const message = 'message' in error && typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';

  return message.includes('could not serialize access')
    || message.includes('serialization')
    || message.includes('deadlock detected');
}

function clerkLookupStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const rawStatus = 'status' in error ? error.status : undefined;
  if (typeof rawStatus === 'number') {
    return rawStatus;
  }

  const rawStatusCode = 'statusCode' in error ? error.statusCode : undefined;
  if (typeof rawStatusCode === 'number') {
    return rawStatusCode;
  }

  return null;
}

function isPermanentClerkLookupError(status: number | null): boolean {
  return status === 403 || status === 404;
}

async function upsertIdentity(identity: ClerkIdentity): Promise<AuthSyncResult> {
  for (let attempt = 1; attempt <= MAX_UPSERT_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const byClerkUserId = await tx.user.findUnique({
          where: { clerkUserId: identity.clerkUserId },
        });

        if (byClerkUserId) {
          if (byClerkUserId.email !== identity.email) {
            const emailOwner = await tx.user.findUnique({
              where: { email: identity.email },
            });

            if (emailOwner && emailOwner.id !== byClerkUserId.id) {
              const message = 'Email already linked to another Clerk user';
              Sentry.captureMessage(message, {
                level: 'warning',
                extra: {
                  email: identity.email,
                  existingUserId: emailOwner.id,
                  existingClerkUserId: emailOwner.clerkUserId,
                  incomingClerkUserId: identity.clerkUserId,
                },
              });
              throw new AuthSyncError(message, 'AUTH_IDENTITY_CONFLICT', 409);
            }
          }

          const updated = await tx.user.update({
            where: { id: byClerkUserId.id },
            data: {
              email: identity.email,
              displayName: identity.displayName,
              avatarUrl: identity.avatarUrl,
              emailVerified: identity.emailVerified,
              isActive: true,
              deletedAt: null,
              ...(identity.lastLoginAt ? { lastLoginAt: identity.lastLoginAt } : {}),
            },
          });

          return toAuthSyncResult(updated);
        }

        const byEmail = await tx.user.findUnique({
          where: { email: identity.email },
        });

        if (byEmail) {
          if (byEmail.clerkUserId && byEmail.clerkUserId !== identity.clerkUserId) {
            const message = 'Email already linked to another Clerk user';
            Sentry.captureMessage(message, {
              level: 'warning',
              extra: {
                email: identity.email,
                existingClerkUserId: byEmail.clerkUserId,
                incomingClerkUserId: identity.clerkUserId,
              },
            });

            throw new AuthSyncError(message, 'AUTH_IDENTITY_CONFLICT', 409);
          }

          const updated = await tx.user.update({
            where: { id: byEmail.id },
            data: {
              clerkUserId: identity.clerkUserId,
              displayName: identity.displayName,
              avatarUrl: identity.avatarUrl,
              emailVerified: identity.emailVerified,
              isActive: true,
              deletedAt: null,
              ...(identity.lastLoginAt ? { lastLoginAt: identity.lastLoginAt } : {}),
            },
          });

          return toAuthSyncResult(updated);
        }

        const created = await tx.user.create({
          data: {
            clerkUserId: identity.clerkUserId,
            email: identity.email,
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            emailVerified: identity.emailVerified,
            isActive: true,
            deletedAt: null,
            lastLoginAt: identity.lastLoginAt,
          },
        });

        return toAuthSyncResult(created);
      }, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (attempt === MAX_UPSERT_RETRIES || !isRetryableUpsertError(error)) {
        throw error;
      }
    }
  }

  throw new Error('Unreachable upsert retry branch');
}

export async function ensureUserForRequest(
  clerkUserId: string,
  claims?: RequestClaims | null,
): Promise<AuthSyncResult> {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
  });

  if (existing) {
    if (!existing.isActive || existing.deletedAt) {
      const error = new AuthSyncError(
        'User account is inactive',
        'AUTH_USER_INACTIVE',
        403,
      );
      Sentry.captureException(error, {
        extra: {
          clerkUserId,
          userId: existing.id,
          isActive: existing.isActive,
          deletedAt: existing.deletedAt,
          stage: 'ensureUserForRequest',
        },
      });
      throw error;
    }

    return toAuthSyncResult(existing);
  }

  let identity: ClerkIdentity | null = null;

  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    identity = clerkIdentityFromUser(clerkUser);
  } catch (error) {
    const clerkLookupStatusCode = clerkLookupStatus(error);
    const permanentLookupError = isPermanentClerkLookupError(clerkLookupStatusCode);

    Sentry.captureException(error, {
      extra: {
        clerkUserId,
        stage: 'clerkClient.users.getUser',
        clerkLookupStatus: clerkLookupStatusCode,
        isPermanentLookupError: permanentLookupError,
      },
    });

    if (permanentLookupError) {
      throw new AuthSyncError(
        'Authenticated Clerk user could not be validated',
        'AUTH_CLERK_USER_NOT_ACCESSIBLE',
        401,
      );
    }
  }

  if (!identity) {
    const email = claimEmail(claims);
    if (!email) {
      const error = new AuthSyncError(
        'Authenticated Clerk user is missing a usable email address',
        'AUTH_EMAIL_MISSING',
        401,
      );
      Sentry.captureException(error, {
        extra: { clerkUserId, stage: 'ensureUserForRequest', claims },
      });
      throw error;
    }

    identity = {
      clerkUserId,
      email,
      displayName: resolveDisplayName({ email }),
      avatarUrl: null,
      emailVerified: false,
      lastLoginAt: null,
    };
  }

  return upsertIdentity(identity);
}

export async function upsertUserFromClerkPayload(
  event: ClerkWebhookEvent,
): Promise<void> {
  if (event.type === 'user.deleted') {
    const clerkUserId = event.data.id;
    if (!clerkUserId) {
      Sentry.captureMessage('Received Clerk user.deleted webhook without user id', {
        level: 'warning',
      });
      return;
    }

    await prisma.user.updateMany({
      where: { clerkUserId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
    return;
  }

  const identity = clerkIdentityFromWebhook(event.data);
  if (!identity) {
    const error = new AuthSyncError(
      'Clerk webhook payload missing a usable email address',
      'AUTH_EMAIL_MISSING',
      400,
    );
    Sentry.captureException(error, {
      extra: { eventType: event.type, clerkUserId: event.data.id },
    });
    throw error;
  }

  await upsertIdentity(identity);
}
