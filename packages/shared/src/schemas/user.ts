import { z } from 'zod';

// ---------- Base schema: a user as returned from the API ----------

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  avatarUrl: z.string().url().nullable(),
  emailVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastLoginAt: z.coerce.date().nullable(),
  deletedAt: z.coerce.date().nullable(),
});

// ---------- Request schemas ----------

export const createUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  displayName: z.string().min(1, 'Display name is required').max(200),
  avatarUrl: z.string().url().optional(),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

// ---------- Type exports ----------

export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
