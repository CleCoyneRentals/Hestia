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
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Missing authorization token' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    const authId = payload.sub!;

    let user = await prisma.user.findUnique({ where: { authId } });

    if (!user) {
      // First sign-in: auto-provision the user account from JWT claims.
      // No webhook needed — Neon Auth user data is already trusted (verified JWT).
      user = await prisma.user.create({
        data: {
          authId,
          email: payload.email as string,
          displayName:
            (payload.name as string | undefined) ??
            (payload.email as string).split('@')[0],
          emailVerified: Boolean(payload.emailVerified),
          subscription: { create: {} }, // default free tier
        },
      });
    }

    req.user = { id: user.id };
  } catch {
    return reply.status(401).send({ code: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
  }
}
