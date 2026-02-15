import { z } from 'zod';

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Tier limits
  TIER_LIMIT_HOMES: 'TIER_LIMIT_HOMES',
  TIER_LIMIT_ITEMS: 'TIER_LIMIT_ITEMS',
  TIER_LIMIT_TASKS: 'TIER_LIMIT_TASKS',
  TIER_FEATURE_DISABLED: 'TIER_FEATURE_DISABLED',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
