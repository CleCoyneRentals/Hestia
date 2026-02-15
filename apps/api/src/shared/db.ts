import { PrismaClient } from '@prisma/client';
import { env } from '../config.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});

// Note: Prisma disconnect is handled by the graceful shutdown in server.ts (SIGTERM/SIGINT).
// Do NOT use process.on('beforeExit') — it doesn't fire on signals.
