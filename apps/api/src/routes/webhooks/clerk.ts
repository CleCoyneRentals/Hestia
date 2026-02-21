import type { FastifyPluginAsync } from 'fastify';
import { verifyWebhook } from '@clerk/fastify/webhooks';
import type { WebhookEvent } from '@clerk/fastify/webhooks';
import { upsertUserFromClerkPayload } from '../../modules/auth/userSync.js';
import type { ClerkWebhookEvent } from '../../modules/auth/types.js';

export const clerkWebhookRoutes: FastifyPluginAsync = async app => {
  app.post('/clerk', async (req, reply) => {
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

    try {
      if (
        event.type === 'user.created'
        || event.type === 'user.updated'
        || event.type === 'user.deleted'
      ) {
        await upsertUserFromClerkPayload(event as ClerkWebhookEvent);
      }

      return reply.code(200).send({ ok: true });
    } catch (error) {
      req.log.error(error, 'Failed to process Clerk webhook');
      return reply.code(500).send({
        code: 'WEBHOOK_PROCESSING_FAILED',
        message: 'Webhook processing failed',
      });
    }
  });
};
