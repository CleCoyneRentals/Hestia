import { initSentry, Sentry } from './shared/sentry.js';

// Initialize Sentry before anything else so it captures all errors
initSentry();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config.js';

// ---------- Create the Fastify instance ----------

const app = Fastify({
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
  origin: env.CORS_ORIGINS.split(','),
  credentials: true,
});

// ---------- Health check ----------

app.get('/health', async (_req, reply) => {
  return reply.send({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ---------- Global error handler ----------

app.setErrorHandler((error, req, reply) => {
  req.log.error(error);

  // Report 5xx errors to Sentry
  if (!error.statusCode || error.statusCode >= 500) {
    Sentry.captureException(error, {
      extra: {
        method: req.method,
        url: req.url,
        userId: (req as any).user?.id,
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
