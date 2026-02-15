// Fastify request type augmentation.
// Adds the `user` property populated by auth middleware (Phase 1).
declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string };
  }
}
