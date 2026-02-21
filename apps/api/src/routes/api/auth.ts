import type { FastifyPluginAsync } from 'fastify';

export const authRoutes: FastifyPluginAsync = async app => {
  app.get('/auth/me', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    return reply.send({
      user: req.user,
    });
  });
};
