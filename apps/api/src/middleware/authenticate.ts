import { createRemoteJWKSet, jwtVerify } from 'jose';
import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../shared/db.js';
import { env } from '../config.js';

// Derive JWKS URL from the auth base URL's origin.
// e.g. https://ep-xxx.us-east-2.aws.neon.tech/neondb/auth → https://ep-xxx.us-east-2.aws.neon.tech/.well-known/jwks.json
const jwksUrl = new URL('/.well-known/jwks.json', new URL(env.NEON_AUTH_URL).origin);

// jose caches the remote JWKS in memory and refetches automatically on key rotation.
const JWKS = createRemoteJWKSet(jwksUrl);

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Missing authorization token' });
  }
  const token = authHeader.slice(7);

  // Only catch JWT verification errors as 401 — DB errors bubble to the global error handler as 500.
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS));
  } catch (error) {
    req.log.warn(error, 'JWT verification failed');
    return reply.status(401).send({ code: 'TOKEN_INVALID', message: 'Invalid or expired token' });
  }

  const authId = payload.sub;
  if (!authId) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Token missing subject claim' });
  }

  const email = payload.email as string | undefined;
  if (!email) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Token missing email claim' });
  }

  const name = payload.name as string | undefined;

  // Upsert is atomic — safe against concurrent first-login requests from SPAs.
  // email and emailVerified are authoritative from the auth provider and sync on every login.
  // displayName is set on first login only (users may customize it later in-app).
  const user = await prisma.user.upsert({
    where: { authId },
    update: {
      email,
      emailVerified: Boolean(payload.email_verified),
    },
    create: {
      authId,
      email,
      displayName: name ?? email.split('@')[0],
      emailVerified: Boolean(payload.email_verified),
      subscription: { create: {} },
    },
  });

  req.user = { id: user.id };
}
