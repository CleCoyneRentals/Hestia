import type { FastifyPluginAsync } from 'fastify';
import { verifyWebhook } from '@clerk/fastify/webhooks';
import type { WebhookEvent } from '@clerk/fastify/webhooks';
import { upsertUserFromClerkPayload, AuthSyncError } from '../../modules/auth/userSync.js';
import type { ClerkWebhookEvent } from '../../modules/auth/types.js';
import { webhookRateLimitMiddleware } from '../../middleware/rateLimit.js';
import { redis } from '../../shared/redis.js';

const SUPPORTED_USER_EVENTS: ReadonlySet<ClerkWebhookEvent['type']> = new Set([
  'user.created',
  'user.updated',
  'user.deleted',
]);
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

function isSupportedUserEvent(eventType: WebhookEvent['type']): eventType is ClerkWebhookEvent['type'] {
  return SUPPORTED_USER_EVENTS.has(eventType as ClerkWebhookEvent['type']);
}

function parseSvixId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }
  }

  return null;
}

function parseSvixTimestamp(value: string | string[] | undefined): Date | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  const ms = Number(raw) * 1000;
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

function idempotencyKeyForEvent(event: ClerkWebhookEvent, svixId: string | null): string {
  if (svixId) {
    return `clerk-webhook:svix:${svixId}`;
  }

  const userId = typeof event.data.id === 'string' && event.data.id
    ? event.data.id
    : 'unknown';
  return `clerk-webhook:fallback:${event.type}:${userId}`;
}

export const clerkWebhookRoutes: FastifyPluginAsync = async app => {
  app.post('/clerk', {
    preHandler: webhookRateLimitMiddleware,
  }, async (req, reply) => {
    let event: WebhookEvent;
    try {
      event = await verifyWebhook(req);
    } catch (error) {
      req.log.warn(error, 'Invalid or failed Clerk webhook');
      return reply.code(400).send({
        code: 'INVALID_WEBHOOK',
        message: 'Webhook verification failed',
      });
    }

    if (!isSupportedUserEvent(event.type)) {
      return reply.code(200).send({ ok: true });
    }

    const supportedEvent = event as ClerkWebhookEvent;
    const svixId = parseSvixId(req.headers['svix-id']);
    const idempotencyKey = idempotencyKeyForEvent(supportedEvent, svixId);
    let processingReserved = false;

    try {
      const reserveResult = await redis.set(idempotencyKey, '1', {
        nx: true,
        ex: WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
      });

      if (!reserveResult) {
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      processingReserved = true;
      const eventTimestamp = parseSvixTimestamp(req.headers['svix-timestamp']);
      await upsertUserFromClerkPayload(supportedEvent, eventTimestamp);

      return reply.code(200).send({ ok: true });
    } catch (error) {
      req.log.error(error, 'Failed to process Clerk webhook');

      if (error instanceof AuthSyncError && error.statusCode < 500) {
        return reply.code(error.statusCode).send({
          code: error.code,
          message: error.message,
        });
      }

      if (processingReserved) {
        await redis.del(idempotencyKey).catch(clearError => {
          req.log.warn(clearError, 'Failed to clear webhook idempotency key');
        });
      }

      const authErr = error instanceof AuthSyncError ? error : null;
      return reply.code(authErr?.statusCode ?? 500).send({
        code: authErr?.code ?? 'WEBHOOK_PROCESSING_FAILED',
        message: authErr?.message ?? 'Webhook processing failed',
      });
    }
  });
};
