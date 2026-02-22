# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the stack

```bash
# Start all apps (Turborepo)
npm run dev

# Start individual apps
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web

# Local infrastructure (PostgreSQL + Redis via Docker)
docker-compose up -d
```

### API

```bash
cd apps/api
npm run dev        # tsx watch (hot reload)
npm run build      # tsc → dist/
npm run lint       # eslint src/

# Tests
npx vitest run                          # all tests once
npx vitest run test/userSync.test.ts    # single file
npx vitest                              # watch mode

# Database
npx prisma migrate dev                  # apply migrations + regenerate client
npx prisma generate                     # regenerate client only (after schema changes)
npx prisma studio                       # GUI for local data
```

### Web

```bash
cd apps/web
npm run dev        # next dev --port 3000
npm run build      # next build
npm run lint       # next lint
```

### Shared package

```bash
cd packages/shared
npm run build      # tsup (CJS + ESM + .d.ts)
npm run dev        # tsup watch
```

### Monorepo

```bash
npm run build      # turbo build (respects dependency order)
npm run test       # turbo test (requires build first, per turbo.json)
npm run lint       # turbo lint (all packages)
```

## Architecture

### Monorepo layout

```
apps/api/       Fastify REST API (Node.js + TypeScript)
apps/web/       Next.js 15 web app
packages/shared/ Zod schemas, constants, and utils shared across apps
```

The shared package is referenced via the `@homeapp/shared` path alias in the API's tsconfig and must be built (`npm run build` in `packages/shared`) before the API can import from it.

### API structure

`src/server.ts` is the entry point and registration hub. It wires plugins in this order:

1. Sentry (must be first to capture all errors)
2. Helmet, CORS, `clerkPlugin`
3. `GET /health`
4. `POST /webhooks/clerk` (unauthenticated)
5. All `/api/*` routes — wrapped in a sub-app that applies `requireAuth` as a `preHandler` hook

**All routes under `/api` are protected by `requireAuth`.** New protected routes must be registered inside the `apiApp` sub-registration block in `server.ts`.

Route modules live in `src/routes/api/` (protected) or `src/routes/webhooks/` (public). Each is a `FastifyPluginAsync` registered via `app.register(...)`.

### Authentication flow

Every authenticated request goes through:

1. `middleware/auth.ts` (`requireAuth`) — calls Clerk's `getAuth()` to verify JWT, then calls `ensureUserForRequest`
2. `modules/auth/userSync.ts` (`ensureUserForRequest`) — looks up the user in the local DB by `clerkUserId`. If not found, fetches from Clerk API and upserts. Falls back to `sessionClaims.email` if the Clerk API is unavailable.
3. On success: populates `req.user` with `{ id, clerkUserId, email }` (type-augmented in `src/types.ts`)

The `upsertIdentity` function uses a **Serializable transaction with 3 retries** (P2002/P2034 are retryable) to handle concurrent auth + webhook races.

Webhook events (`user.created`, `user.updated`, `user.deleted`) go through `routes/webhooks/clerk.ts`, which uses Redis `SET NX EX` on the `svix-id` header for idempotency (24h TTL). On processing failure the idempotency key is deleted so Clerk can retry. `AuthSyncError` with `statusCode < 500` is returned as-is to Clerk (4xx = don't retry; 5xx = retry).

### Database

Prisma schema is at `apps/api/prisma/schema.prisma`. Two connection strings are required:
- `DATABASE_URL` — pooled connection (via Neon's PgBouncer)
- `DATABASE_URL_DIRECT` — direct connection (required for migrations)

Current models: `User`, `Subscription`, `Home`. Enums for future models (`RoomType`, `ItemCondition`) are already defined in the schema.

`clerkUserId` is nullable on `User` — intentional for incremental migration of pre-Clerk users. The `email` column has a separate unique constraint.

### Environment / config

`src/config.ts` validates all env vars at startup via Zod and exports a typed `env` object. **The server will not start if required vars are missing** — it logs which vars failed and exits. Every env var the API uses must be declared in `config.ts`. See `apps/api/.env.example` for the full list and which phase each var is required.

Required today (Phase 0): `DATABASE_URL`, `DATABASE_URL_DIRECT`, `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`.

### Rate limiting

Rate limiting is **per-route** (not global), using Upstash sliding window via `src/middleware/rateLimit.ts`. Add `rateLimitMiddleware` as a preHandler to routes that need it. It identifies users by `req.user?.id` (falling back to IP). Three preset tiers are available in `src/shared/redis.ts` (`standardRateLimit`, `authRateLimit`, `uploadRateLimit`).

### Shared package (`@homeapp/shared`)

Exports Zod schemas (create/update variants) for all domain models, standardized error codes (`src/constants/errors.ts`), subscription tier limits, and date/validation utilities. Use this package for any type or constant that needs to be consistent across the API and web app.

### Error handling pattern

Auth errors use `AuthSyncError` (exported from `modules/auth/userSync.ts`) with structured `code` and `statusCode` fields. The global error handler in `server.ts` reports 5xx errors to Sentry and sanitizes messages in production. New domain errors should follow the same `{ code, message }` response shape.

### Testing

Tests live in `apps/api/test/`. Vitest mocks are set up using `vi.hoisted()` for module-level mocks that must be hoisted before imports. The pattern in existing tests (e.g. `userSync.test.ts`) should be followed for new tests: hoist the mock factories, then `vi.mock(...)` each dependency, then import the module under test.

When mocking `../src/modules/auth/userSync.js`, always include `AuthSyncError` in the mock factory — any file that imports from `userSync.js` that uses `AuthSyncError` will fail at runtime if it's absent from the mock.

### Web app

Next.js App Router. All routes are protected by `src/middleware.ts` (Clerk `clerkMiddleware`) except `/`, `/sign-in/*`, and `/sign-up/*`. Server components use `currentUser()` from `@clerk/nextjs/server` for auth. The `ClerkProvider` wraps the root layout.

### Docker Compose (local dev)

`docker-compose.yml` provides PostgreSQL 16 and Redis 7. Data persists in named volumes (`hestia_postgres_data`, `hestia_redis_data`). The API and web apps are not containerized for local dev — only the infrastructure services are.
