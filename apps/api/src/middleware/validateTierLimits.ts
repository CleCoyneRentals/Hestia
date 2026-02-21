import { FastifyRequest, FastifyReply } from 'fastify';
import { TIER_LIMITS, isUnlimited } from '@homeapp/shared';
import { prisma } from '../shared/db.js';

type Resource = 'homes' | 'items' | 'tasks';

export function requireTierCapacity(resource: Resource) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { subscription: { select: { tier: true } } },
    });

    const tier = user?.subscription?.tier ?? 'free';
    const limits = TIER_LIMITS[tier];

    if (resource === 'homes') {
      const count = await prisma.home.count({ where: { ownerId: req.user!.id } });
      if (!isUnlimited(limits.maxHomes) && count >= limits.maxHomes) {
        return reply.status(403).send({ code: 'TIER_LIMIT_HOMES' });
      }
    }

    // items and tasks are added here when those route handlers are built (Phase 3/5)
  };
}
