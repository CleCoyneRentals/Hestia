import { z } from 'zod';

// ---------- Enums ----------

export const subscriptionTierEnum = z.enum(['free', 'basic', 'premium']);
export const subscriptionStatusEnum = z.enum(['active', 'past_due', 'canceled', 'trialing']);

// ---------- Base schema ----------

export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tier: subscriptionTierEnum.default('free'),
  status: subscriptionStatusEnum.default('active'),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  currentPeriodStart: z.coerce.date().nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  cancelAtPeriodEnd: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ---------- Type exports ----------

export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscriptionTier = z.infer<typeof subscriptionTierEnum>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusEnum>;
