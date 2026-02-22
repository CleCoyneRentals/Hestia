import type { FastifyPluginAsync } from 'fastify';
import { authRateLimitMiddleware } from '../../middleware/rateLimit.js';

export const authRoutes: FastifyPluginAsync = async app => {
  app.get('/auth/me', {
    preHandler: authRateLimitMiddleware,
  }, async (req, reply) => {
    return reply.send({
      user: req.user,
    });
  });
};
