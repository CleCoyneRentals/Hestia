import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authRateLimitMiddleware } from '../../middleware/rateLimit.js';
import { prisma } from '../../shared/db.js';

const userProfileSelect = {
  id: true,
  clerkUserId: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const;

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.union([
    z.string().trim().url().refine(u => u.startsWith('https://'), { message: 'Only HTTPS URLs are allowed' }),
    z.literal(''),
    z.null(),
  ]).optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.displayName === undefined && value.avatarUrl === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided',
      });
    }
  });

function normalizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/g, ' ');
}

function toValidationIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export const userRoutes: FastifyPluginAsync = async app => {
  app.get('/users/me', {
    preHandler: authRateLimitMiddleware,
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: userProfileSelect,
    });

    if (!user) {
      return reply.code(404).send({
        code: 'USER_NOT_FOUND',
        message: 'User profile not found',
      });
    }

    return reply.send({ user });
  });

  app.patch('/users/me', {
    preHandler: authRateLimitMiddleware,
  }, async (req, reply) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'INVALID_PAYLOAD',
        message: 'Invalid profile update payload',
        issues: toValidationIssues(parsed.error),
      });
    }

    const updateData: { displayName?: string; avatarUrl?: string | null } = {};
    if (parsed.data.displayName !== undefined) {
      updateData.displayName = normalizeDisplayName(parsed.data.displayName);
    }
    if (parsed.data.avatarUrl !== undefined) {
      updateData.avatarUrl = parsed.data.avatarUrl === '' ? null : parsed.data.avatarUrl;
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: req.user!.id },
        data: updateData,
        select: userProfileSelect,
      });
      return reply.send({ user: updatedUser });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({
          code: 'USER_NOT_FOUND',
          message: 'User profile not found',
        });
      }
      throw err;
    }
  });
};
