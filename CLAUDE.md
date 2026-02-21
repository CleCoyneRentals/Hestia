# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hestia is a home inventory & maintenance SaaS platform built as a Turborepo monorepo. It provides homeowners with tools to track property inventory, schedule maintenance tasks, and manage their homes.

## Common Commands

```bash
# Development (runs both API and web concurrently)
npm run dev

# Build all packages
npm run build

# Run tests
npm run test

# Run linting
npm run lint

# Run a single app
npm run dev --filter=@homeapp/api
npm run dev --filter=@homeapp/web

# Database operations (from apps/api/)
npx prisma migrate dev          # Create and apply migrations
npx prisma generate            # Regenerate Prisma client
npx prisma studio              # Open database GUI
```

## Architecture

### Monorepo Structure

- **apps/api** - Fastify REST API server (port 3001)
- **apps/web** - Next.js 15 web application (port 3000)
- **packages/shared** - Shared TypeScript code (Zod schemas, types, constants, utilities)

### Key Patterns

**Shared Package Usage**: All domain schemas, validation, and types are defined in `@homeapp/shared` using Zod. Both API and web apps import from this package. When adding new entities:
1. Create schemas in `packages/shared/src/schemas/`
2. Export from `packages/shared/src/index.ts`
3. Run `npm run build --filter=@homeapp/shared` to rebuild

**API Structure**:
- `src/server.ts` - Fastify app setup, global plugins, error handler
- `src/config.ts` - Zod-validated environment variables (fails startup if required vars missing)
- `src/middleware/` - Authentication (Neon Auth JWT), rate limiting (Upstash), tier validation
- `src/shared/` - Database (Prisma), Redis, cache utilities, Sentry

**Authentication Flow**: Uses Neon Auth with JWT tokens. The `authenticate` middleware:
1. Validates JWT against Neon's JWKS endpoint
2. Upserts user in database (creates subscription on first login)
3. Sets `req.user.id` for downstream handlers

**Database**: PostgreSQL via Neon with Prisma ORM. Schema is in `apps/api/prisma/schema.prisma`. Uses snake_case for database columns (`@map`) with camelCase in TypeScript.

### Environment Setup

Copy `apps/api/.env.example` to `apps/api/.env`. Required for Phase 0:
- `DATABASE_URL` / `DATABASE_URL_DIRECT` - Neon PostgreSQL (pooled and direct)
- `REDIS_URL` / `UPSTASH_REDIS_REST_*` - Upstash Redis
- `NEON_AUTH_URL` - Neon Auth endpoint

## Tech Stack

- **Runtime**: Node.js with ES modules (`"type": "module"`)
- **API**: Fastify 5 with TypeScript, Prisma, Zod validation
- **Web**: Next.js 15, React 19, Neon Auth client
- **Validation**: Zod schemas shared between API and web
- **Build**: Turborepo for monorepo orchestration, tsup for shared package bundling
