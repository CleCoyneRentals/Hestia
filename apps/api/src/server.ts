import 'dotenv/config';
import { initSentry, Sentry } from './shared/sentry.js';

// Initialize Sentry before anything else so it captures all errors
initSentry();

import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { clerkPlugin } from '@clerk/fastify';

import { env } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { authRoutes } from './routes/api/auth.js';
import { userRoutes } from './routes/api/users.js';
import { clerkWebhookRoutes } from './routes/webhooks/clerk.js';
import { prisma } from './shared/db.js';
import './types.js'; // Fastify request type augmentation

// ---------- Create the Fastify instance ----------

const app = Fastify({
  trustProxy: true, // Required for correct req.ip behind reverse proxies / load balancers
  logger: {
    transport: env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
    level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  },
});

// ---------- Register global plugins ----------

await app.register(helmet);

await app.register(cors, {
  origin: env.CORS_ORIGINS,
  credentials: true,
});

await app.register(clerkPlugin);

// Rate limiting is two-layered (src/middleware/rateLimit.ts):
// 1. IP-based onRequest hook at the apiApp level (fires before auth) — coarse DDoS guard
// 2. Per-route preHandler after auth — user-based fairness limit (10 req/min for auth/profile endpoints)

// ---------- Health check ----------

app.get('/health', async (_req, reply) => {
  return reply.send({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

await app.register(clerkWebhookRoutes, {
  prefix: '/webhooks',
});

await app.register(async apiApp => {
  apiApp.addHook('onRequest', rateLimitMiddleware); // IP-based, fires before auth
  apiApp.addHook('preHandler', requireAuth);
  await apiApp.register(authRoutes);
  await apiApp.register(userRoutes);
}, { prefix: '/api' });

// ---------- Global error handler ----------

app.setErrorHandler((error: FastifyError, req, reply) => {
  req.log.error(error);

  // Report 5xx errors to Sentry
  if (!error.statusCode || error.statusCode >= 500) {
    Sentry.captureException(error, {
      extra: {
        method: req.method,
        url: req.url,
        userId: req.user?.id,
      },
    });
  }

  const statusCode = error.statusCode || 500;
  const response = {
    code: error.code || 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'development'
      ? error.message
      : statusCode >= 500
        ? 'An internal error occurred'
        : error.message,
  };

  reply.status(statusCode).send(response);
});

// ---------- Graceful shutdown ----------

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    await prisma.$disconnect();
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------- Start the server ----------

const start = async () => {
  try {
    await app.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });
    app.log.info(`Server running on port ${env.PORT}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
};

start();
