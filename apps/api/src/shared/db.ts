import { PrismaClient } from '@prisma/client';
import { env } from '../config.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
