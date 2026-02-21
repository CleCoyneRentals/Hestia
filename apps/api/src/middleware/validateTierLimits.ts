import { FastifyRequest, FastifyReply } from 'fastify';
import { TIER_LIMITS, isUnlimited } from '@homeapp/shared';
import { prisma } from '../shared/db.js';

type Resource = 'homes' | 'items' | 'tasks';

export function requireTierCapacity(resource: Resource) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user?.id;
    if (!userId) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscription: { select: { tier: true } } },
    });

    const tier = user?.subscription?.tier ?? 'free';
    const limits = TIER_LIMITS[tier];

    if (resource === 'homes') {
      const count = await prisma.home.count({ where: { ownerId: userId } });
      if (!isUnlimited(limits.maxHomes) && count >= limits.maxHomes) {
        return reply.status(403).send({ code: 'TIER_LIMIT_HOMES' });
      }
    }

    // items and tasks are added here when those route handlers are built (Phase 3/5)
  };
}
