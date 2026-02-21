import type { FastifyPluginAsync } from 'fastify';

export const authRoutes: FastifyPluginAsync = async app => {
  app.get('/auth/me', async (req, reply) => {
    return reply.send({
      user: req.user,
    });
  });
};
