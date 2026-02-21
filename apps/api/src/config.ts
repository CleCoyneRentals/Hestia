import { z } from 'zod';
import 'dotenv/config';

// Every environment variable the API references must be declared here.
// Phase 0-required vars fail startup if missing. Future-phase vars are optional.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Database (Neon) — Required Phase 0
  // Note: For production, this URL must include ?sslmode=require
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_DIRECT: z.string().min(1, 'DATABASE_URL_DIRECT is required'),

  // Redis (Upstash) — Required Phase 0
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  UPSTASH_REDIS_REST_URL: z.string().min(1, 'UPSTASH_REDIS_REST_URL is required'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // Auth (Clerk) — Required Phase 1
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET is required'),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),

  // Payments (Stripe) — Required Phase 6
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // File Storage (Cloudflare R2) — Required Phase 3
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),

  // Push Notifications (OneSignal) — Required Phase 7
  ONESIGNAL_APP_ID: z.string().optional(),
  ONESIGNAL_API_KEY: z.string().optional(),

  // Error Tracking (Sentry) — Required Phase 0
  SENTRY_DSN: z.string().optional(),

  // Application — Required Phase 0
  // Deprecated after Clerk integration. Keep optional only for backwards compatibility.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000')
    .transform(s => s.split(',').map(o => o.trim()).filter(Boolean)),
  API_URL: z.string().url().default('http://localhost:3001'),
});

// Use safeParse for clear startup error messages instead of an unhandled Zod error.
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
