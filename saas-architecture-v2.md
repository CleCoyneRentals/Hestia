# SaaS Platform Architecture Design
## Home Inventory & Maintenance at Scale

---

## Table of Contents

1. [Database Design & Models](#1-database-design--models)
2. [Recommended Tech Stack](#2-recommended-tech-stack)
3. [Real-Time Architecture](#3-real-time-architecture)
4. [Hosting Strategy & Migration Triggers](#4-hosting-strategy--migration-triggers)
5. [Potential Issues & How to Prepare](#5-potential-issues--how-to-prepare)

---

## 1. Database Design & Models

### Why PostgreSQL

For this type of application, PostgreSQL is the strongest choice as your primary database. Here's why:

- **Relational data fits your domain.** Users own homes. Homes have rooms. Rooms contain items. Items have maintenance tasks. These are natural parent-child relationships that relational databases handle natively. You'll be querying across these relationships constantly ("show me all overdue tasks for my kitchen") and PostgreSQL makes that fast and simple with JOINs.
- **JSONB for flexible metadata.** Every home item is different — a furnace has different attributes than a dishwasher. PostgreSQL's JSONB column type lets you store flexible, queryable key-value data without needing a separate column for every possible attribute.
- **Row-Level Security (RLS).** PostgreSQL can enforce "User A can only see User A's data" at the database level itself, not just in your application code. This is a critical safety net for multi-tenant SaaS.
- **Proven at scale.** PostgreSQL comfortably handles tens of millions of rows with proper indexing. Instagram ran on PostgreSQL well past 100 million users.

**What to avoid:** MongoDB or other document databases. Your data is inherently relational (users → homes → rooms → items → tasks). Document databases would force you to either duplicate data everywhere or make multiple round-trip queries to assemble what PostgreSQL gives you in one query.

### Why Neon for Managed PostgreSQL

Neon is a serverless PostgreSQL provider. What "serverless" means here is that the database scales compute up and down automatically based on load, and can scale to zero when nobody is using it (saving money during off-hours). Key advantages for your project:

- **Built-in connection pooling.** Neon includes PgBouncer-compatible pooling, which is critical when you have many WebSocket-connected API instances all needing database access. Without pooling, you'd exhaust PostgreSQL's connection limit quickly.
- **Branching.** Neon lets you create instant copies of your database for testing. When you want to test a schema migration, you branch the production database, run the migration on the branch, verify it works, then apply it to production. This is a workflow most teams don't get without significant infrastructure.
- **Generous free tier.** Good for development and early production.
- **Standard PostgreSQL.** No vendor lock-in. If you outgrow Neon, you can migrate to AWS RDS or any other PostgreSQL host with a standard pg_dump/pg_restore.

### Supporting Data Stores

PostgreSQL alone won't cover all your needs. Here's the full picture:

| Data Store | Purpose | Why It's Needed |
|------------|---------|-----------------|
| **PostgreSQL (Neon)** | Primary data store | All user data, items, tasks, subscriptions |
| **Redis (Upstash or Railway addon)** | Caching, sessions, real-time pub/sub | Live sync between devices, rate limiting, caching frequent queries |
| **S3-compatible storage** (Cloudflare R2 or AWS S3) | File storage | Item photos, receipts, manuals, documents |

**Redis** is essential for your real-time requirements. When User A updates an item on their phone, Redis pub/sub broadcasts that change to User B's laptop in milliseconds. It also caches things like "what subscription tier is this user on?" so you're not hitting PostgreSQL on every single API request. Upstash is a good managed Redis option — it's serverless like Neon, so you only pay for what you use.

### Core Data Models

Below is the complete schema. Each section explains *why* the tables are structured this way.

#### Users & Authentication

```sql
-- UUIDs are used as primary keys instead of auto-incrementing integers.
-- Why: Sequential IDs leak information (a competitor can estimate your user
-- count by creating an account and seeing their ID is #4,521). UUIDs are
-- random and reveal nothing.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- Enables UUID generation

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    email_verified  BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ  -- "soft delete": marks as deleted without
                                 -- actually removing the row. Important for
                                 -- data recovery and legal compliance.
);

-- An INDEX is like a book's index — it lets the database find rows fast
-- without scanning every row in the table. This index covers the most
-- common query in the entire system: looking up a user by email at login.
-- The WHERE clause means we skip deleted accounts.
CREATE INDEX idx_users_email ON users (email) WHERE deleted_at IS NULL;
```

**Why no password column?** Use a dedicated authentication service (covered in the tech stack section). Storing and managing passwords yourself is a massive security liability. Services like Auth0, Clerk, or Firebase Auth handle password hashing, brute-force protection, OAuth (Sign in with Google/Apple), and email verification. You focus on your product, not on getting security right.

#### Subscriptions & Billing

```sql
-- ENUMs restrict a column to specific allowed values.
-- The database itself will reject any value not in this list.
CREATE TYPE subscription_tier AS ENUM ('free', 'basic', 'premium');
CREATE TYPE subscription_status AS ENUM (
    'active',      -- Currently paying
    'past_due',    -- Payment failed, grace period
    'canceled',    -- User canceled
    'trialing'     -- Free trial period
);

CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier                    subscription_tier DEFAULT 'free',
    status                  subscription_status DEFAULT 'active',
    stripe_customer_id      TEXT,      -- Stripe's ID for this customer
    stripe_subscription_id  TEXT,      -- Stripe's ID for this subscription
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Tier limits are stored in the database, not in code.
-- This means you can adjust limits (like raising max_items from 50 to 75
-- for free users) with a simple database update instead of deploying new code.
CREATE TABLE tier_limits (
    tier            subscription_tier PRIMARY KEY,
    max_homes       INT NOT NULL,    -- -1 means unlimited
    max_items       INT NOT NULL,
    max_tasks       INT NOT NULL,
    can_share       BOOLEAN DEFAULT FALSE,
    can_attach      BOOLEAN DEFAULT FALSE,
    max_file_mb     INT DEFAULT 5
);

INSERT INTO tier_limits VALUES
    ('free',    1,   50,   25, FALSE, FALSE, 5),
    ('basic',   3,  500,  200, TRUE,  TRUE,  25),
    ('premium', -1,  -1,   -1, TRUE,  TRUE,  100);
```

**Why Stripe specifically?** Stripe is the industry standard for SaaS billing. It handles credit cards, invoicing, proration (upgrading mid-cycle), tax calculation, and webhook notifications when payments succeed or fail. Alternatives exist (Paddle, LemonSqueezy) but Stripe has the best documentation and ecosystem.

#### Homes, Rooms, and Items

```sql
CREATE TABLE homes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,          -- "Lake House", "Main Residence"
    address     TEXT,
    home_type   TEXT,                   -- "single_family", "duplex", "condo"
    year_built  INT,
    square_feet INT,
    photo_url   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_homes_owner ON homes (owner_id);

-- Sharing/collaboration: who else can access this home?
CREATE TYPE access_role AS ENUM ('viewer', 'editor', 'admin');

CREATE TABLE home_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_id     UUID NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        access_role NOT NULL DEFAULT 'viewer',
    invited_by  UUID REFERENCES users(id),
    accepted_at TIMESTAMPTZ,           -- NULL means pending invitation
    created_at  TIMESTAMPTZ DEFAULT NOW(),

    -- UNIQUE constraint prevents duplicate invitations
    UNIQUE(home_id, user_id)
);

CREATE INDEX idx_home_members_user ON home_members (user_id);

CREATE TABLE rooms (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_id     UUID NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,          -- "Kitchen", "Master Bedroom"
    room_type   TEXT,                   -- For icons/categorization in the UI
    floor       INT,
    notes       TEXT,
    sort_order  INT DEFAULT 0,         -- User can reorder rooms in the UI
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rooms_home ON rooms (home_id);

CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    category        TEXT,              -- "appliance", "furniture", "system"
    manufacturer    TEXT,
    model_number    TEXT,
    serial_number   TEXT,
    purchase_date   DATE,
    purchase_price  DECIMAL(10,2),
    warranty_until  DATE,
    condition       TEXT,              -- "excellent", "good", "fair", "poor"

    -- JSONB stores flexible key-value data specific to the item type.
    -- A furnace might have: {"btu_rating": 80000, "fuel_type": "gas"}
    -- A dishwasher might have: {"energy_star": true, "decibel_level": 44}
    -- You can still query this: WHERE metadata->>'fuel_type' = 'gas'
    metadata        JSONB DEFAULT '{}',

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_room ON items (room_id);

-- GIN index makes searching inside JSONB fast
CREATE INDEX idx_items_metadata ON items USING GIN (metadata);

-- Full-text search index: lets users search "Samsung dishwasher" across
-- name, description, manufacturer, and model_number simultaneously
CREATE INDEX idx_items_search ON items USING GIN (
    to_tsvector('english', coalesce(name, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(manufacturer, '') || ' ' ||
    coalesce(model_number, ''))
);

-- Photos, receipts, manuals attached to items
CREATE TABLE item_attachments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    file_url    TEXT NOT NULL,          -- S3/R2 URL
    file_type   TEXT NOT NULL,          -- "image/jpeg", "application/pdf"
    file_name   TEXT NOT NULL,
    file_size   INT,                   -- bytes
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_item ON item_attachments (item_id);
```

#### Tasks (One-Time and Recurring)

This is the most complex part of the schema. Recurring tasks need special handling.

```sql
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');
CREATE TYPE recurrence_type AS ENUM (
    'none',         -- One-time task
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'custom_days'   -- Every N days
);

-- This is the TEMPLATE for a task. For recurring tasks, this defines
-- the pattern. Individual occurrences are tracked in task_instances.
CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_id             UUID NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    item_id             UUID REFERENCES items(id) ON DELETE SET NULL,
    created_by          UUID NOT NULL REFERENCES users(id),
    assigned_to         UUID REFERENCES users(id),

    title               TEXT NOT NULL,
    description         TEXT,
    priority            INT DEFAULT 0,     -- 0=low, 1=medium, 2=high, 3=urgent

    -- Recurrence configuration
    recurrence          recurrence_type DEFAULT 'none',
    recurrence_interval INT DEFAULT 1,     -- "every 2 weeks" = weekly + interval 2
    recurrence_day      INT,               -- Day of week (0-6) or day of month (1-31)
    recurrence_end_date DATE,              -- Optional: stop recurring after this date
    custom_days         INT,               -- For 'custom_days': every N days

    -- For one-time tasks, this is the due date.
    -- For recurring tasks, this is the NEXT occurrence date.
    next_due_date       DATE,

    -- Notification preferences
    notify_days_before  INT DEFAULT 1,     -- Push notification N days before due
    notify_day_of       BOOLEAN DEFAULT TRUE,

    is_active           BOOLEAN DEFAULT TRUE,  -- Pause recurring tasks without deleting
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_home ON tasks (home_id);
CREATE INDEX idx_tasks_item ON tasks (item_id);
CREATE INDEX idx_tasks_assigned ON tasks (assigned_to);

-- This index is critical for the notification system.
-- It quickly finds all tasks due within a date range.
CREATE INDEX idx_tasks_due ON tasks (next_due_date)
    WHERE is_active = TRUE;

-- Each time a recurring task comes due, a concrete INSTANCE is created.
-- This is the record of "did they actually do it?"
-- One-time tasks also get exactly one instance when created.
CREATE TABLE task_instances (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    due_date        DATE NOT NULL,
    status          task_status DEFAULT 'pending',
    completed_by    UUID REFERENCES users(id),
    completed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_instances_task ON task_instances (task_id);
CREATE INDEX idx_task_instances_due ON task_instances (due_date, status);
```

**Why separate tasks and task_instances?** Consider "Change HVAC filter every 3 months." The `tasks` row defines the pattern. Each quarter, the system creates a `task_instances` row for that specific occurrence. This lets you track completion history ("they changed it in January and April but missed July") without losing the recurring pattern.

#### Real-Time Sync Support

```sql
-- Every meaningful change is logged here. When a user's device connects,
-- it asks "what changed since I last synced?" and gets the answer from
-- this table. This is how live sync works without constant polling.
CREATE TABLE sync_log (
    id          BIGSERIAL PRIMARY KEY,  -- Sequential for ordering
    home_id     UUID NOT NULL,
    user_id     UUID NOT NULL,          -- Who made the change
    entity_type TEXT NOT NULL,           -- 'item', 'task', 'room', etc.
    entity_id   UUID NOT NULL,
    action      TEXT NOT NULL,           -- 'create', 'update', 'delete'
    changes     JSONB,                  -- What specifically changed
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- The key query: "give me everything that changed in home X since timestamp Y"
CREATE INDEX idx_sync_log_home_time ON sync_log (home_id, created_at);

-- Implement a cleanup job that deletes entries older than 90 days
-- to prevent this table from growing forever.
```

#### Push Notification Tracking

```sql
CREATE TABLE device_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,          -- 'ios', 'android', 'web'
    token           TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    last_used_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, token)
);

CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id),
    task_id         UUID REFERENCES tasks(id),
    type            TEXT NOT NULL,          -- 'task_due', 'task_assigned', 'home_invite'
    title           TEXT NOT NULL,
    body            TEXT,
    sent_at         TIMESTAMPTZ DEFAULT NOW(),
    read_at         TIMESTAMPTZ,
    platform        TEXT                    -- Which platform received it
);
```

#### Security: Row-Level Security (RLS)

Row-Level Security means the database *itself* enforces data access rules, not just your application code. Even if a bug in your code accidentally tries to fetch another user's data, PostgreSQL will block it.

```sql
-- Enable RLS on sensitive tables
ALTER TABLE homes ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see homes they own or are members of
CREATE POLICY homes_access ON homes
    FOR ALL
    USING (
        owner_id = current_setting('app.current_user_id')::UUID
        OR id IN (
            SELECT home_id FROM home_members
            WHERE user_id = current_setting('app.current_user_id')::UUID
            AND accepted_at IS NOT NULL
        )
    );

-- Your API sets this before every query:
-- SET LOCAL app.current_user_id = '<user-uuid>';
-- Then even if code has a bug, the wrong user's data won't leak.
```

### Schema Design Principles Applied

These principles will guide every future modeling decision:

- **Normalize first, denormalize later.** The schema above has no duplicated data. If query performance becomes an issue on specific screens, you can add targeted caching or materialized views then — but starting denormalized creates data consistency nightmares.
- **Soft deletes everywhere.** `deleted_at` timestamps instead of actual DELETE operations. Users will accidentally delete things. You need the ability to restore data, and you may have legal requirements to retain records.
- **UUIDs as primary keys.** No auto-incrementing integers that leak your scale or allow enumeration attacks.
- **Timestamps always in UTC with timezone (TIMESTAMPTZ).** The application layer converts to the user's local time for display. Storing in local time causes catastrophic bugs when users travel or daylight saving time changes.
- **Indexes on every foreign key and every frequent query path.** Without indexes, PostgreSQL scans every row in the table. With tens of thousands of users, unindexed queries will grind to a halt.

---

## 2. Recommended Tech Stack

### The Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Mobile App** | React Native | Single codebase for iOS and Android. Since the entire backend is JavaScript/TypeScript, you share validation logic, types, and utilities across the whole stack. |
| **Web App** | Next.js (React) | Server-side rendering for SEO on marketing pages, client-side interactivity for the app dashboard. Same React knowledge as mobile. |
| **API** | Node.js with Fastify | Fastify is faster than Express, has built-in schema validation, and excellent TypeScript support. It's the modern choice for Node.js APIs. Express works too but is showing its age. |
| **Real-Time** | Socket.io | Handles WebSocket connections with automatic reconnection, rooms (one per home), and graceful fallbacks. See Section 3 for the full real-time architecture. |
| **Database** | PostgreSQL via Neon | Serverless PostgreSQL with built-in connection pooling, database branching for safe migrations, and automatic scaling. |
| **Cache & Pub/Sub** | Redis via Upstash | Serverless Redis for caching, rate limiting, session storage, and pub/sub messaging between API instances. Upstash is pay-per-request, so costs stay low until you have real traffic. |
| **Auth** | Auth0 or Clerk | Handles passwords, OAuth (Google/Apple sign-in), JWT tokens, email verification, and MFA. Clerk is newer with a better developer experience; Auth0 is more established with more features. |
| **Payments** | Stripe | Industry standard for SaaS billing. Handles subscriptions, invoices, proration, tax calculation, and webhook notifications. |
| **Push Notifications** | OneSignal (wraps FCM + APNs) | OneSignal provides a single API for iOS, Android, and web push notifications. Under the hood it uses Firebase Cloud Messaging and Apple Push Notification Service, but you don't have to manage either directly. |
| **File Storage** | Cloudflare R2 | S3-compatible object storage with zero egress fees. When users browse item photos, you're not paying per download. Use with Cloudflare Images or imgproxy for thumbnail generation. |
| **Background Jobs** | BullMQ | Redis-backed job queue for Node.js. Handles recurring task generation, notification scheduling, cleanup jobs, and retry logic. Battle-tested and well-documented. |
| **ORM** | Prisma or Drizzle | Prisma has the better developer experience and auto-generates TypeScript types from your schema. Drizzle is lighter-weight and gives you more control over queries. Either is a strong choice. |
| **Validation** | Zod | Define data shapes once, use them for API request validation, TypeScript types, and form validation on the frontend. Shared between frontend and backend. |
| **Monitoring** | Sentry (errors) + PostHog (analytics) | Sentry captures every unhandled exception with full context. PostHog tracks user behavior and feature usage. Both have generous free tiers. |
| **Language** | TypeScript everywhere | Type safety across the entire stack. Catches bugs at compile time instead of production. Non-negotiable for a project of this scale. |

### Why Node.js Over Python for This Project

This is a common decision point, and the answer depends on what you're building. For *this* project, Node.js is the clear winner for several specific reasons:

**Node.js advantages for your use case:**

- **Native async I/O.** Node's event loop was designed from the ground up for handling many concurrent connections. Your WebSocket server, API requests, and database queries all run concurrently without threads. Python can do this with asyncio, but it's added on top of a language that was originally synchronous — you'll constantly fight libraries that block.
- **One language everywhere.** React Native (mobile), Next.js (web), Fastify (API), BullMQ (jobs) — all TypeScript. You define a Zod schema for an "item" once and use it for API validation, database queries, and form validation across all three platforms. With Python, you'd define the same shape in Pydantic (backend) and then again in Zod or Yup (frontend), and keep them in sync manually.
- **Socket.io ecosystem.** Socket.io is the most mature real-time library in any language. The Python equivalent (python-socketio) works but has a fraction of the community, examples, and battle-testing.
- **NPM ecosystem for your domain.** Libraries for Stripe integration, push notifications, image processing, and job queues are all first-class in the Node ecosystem.
- **Deployment simplicity.** One runtime (Node.js) for everything. No managing separate Python and Node environments.

**When Python would have been the better choice:**

- If this were primarily a data processing or analytics product (Python's pandas, NumPy, scikit-learn have no Node equivalents).
- If you planned to build ML features like predictive maintenance ("your water heater is likely to fail within 6 months based on age and usage patterns"). Python dominates machine learning.
- If the product were a traditional server-rendered web app with minimal real-time needs. Django is incredibly productive for that kind of product.
- If the team already had deep Python expertise and no JavaScript experience. Language familiarity often outweighs theoretical performance differences.

**A note on the future:** If you eventually want to add ML-powered features (like smart maintenance predictions), you can add a small Python microservice just for that. The main application stays Node.js; the ML service is a separate container that your Node API calls when needed. This is a common and clean pattern.

### Why These Specific Choices Over Alternatives

**Fastify over Express:** Express is the most popular Node.js framework, but it's essentially unmaintained and missing modern features. Fastify is actively developed, handles 2-3x more requests per second, has built-in JSON schema validation (pairs well with Zod), and has first-class TypeScript support.

**Clerk or Auth0 over building auth yourself:** Authentication is one of those things that seems simple ("just hash the password and store it") but has an enormous surface area for security vulnerabilities: timing attacks, bcrypt cost factors, token rotation, brute force protection, account enumeration, OAuth state validation, PKCE flows for mobile. A single mistake exposes all your users. Auth services have teams of security engineers focused entirely on this. Use them.

**BullMQ over node-cron or setInterval:** For recurring task generation, you might be tempted to use a simple cron-like scheduler. The problem: if your server restarts, crashes, or scales to multiple instances, cron jobs either get missed or run multiple times. BullMQ uses Redis as a persistent backing store, so jobs survive server restarts, and its concurrency controls prevent duplicate execution across multiple server instances.

**Prisma or Drizzle over raw SQL:** You *could* write all your queries in raw SQL. The problem is that you lose type safety — TypeScript won't catch it if you misspell a column name or return the wrong shape from a query. ORMs generate TypeScript types from your database schema, so the compiler catches data access bugs before they reach production. For the 5% of queries that need complex SQL (like the full-text search), both Prisma and Drizzle let you drop into raw SQL.

### Architecture Pattern: Modular Monolith

```
┌──────────────────────────────────────────────────────┐
│                 Fastify API Server                    │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐ │
│  │   Auth   │ │Inventory │ │  Tasks & Scheduling   │ │
│  │  Module  │ │  Module  │ │       Module          │ │
│  └──────────┘ └──────────┘ └───────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐ │
│  │ Billing  │ │  Notif.  │ │  Real-Time Sync       │ │
│  │  Module  │ │  Module  │ │  (Socket.io)          │ │
│  └──────────┘ └──────────┘ └───────────────────────┘ │
└──────┬─────────────┬─────────────┬───────────────────┘
       │             │             │
┌──────┴──┐   ┌──────┴──┐   ┌─────┴─────┐
│  Neon   │   │ Upstash │   │Cloudflare │
│(Postgres)│   │ (Redis) │   │   R2/S3   │
└─────────┘   └─────────┘   └───────────┘
```

Each module has its own directory, routes, and service logic with clear boundaries. They share the database but access only their own tables. When a module needs to grow into its own service later, the boundaries are already clean.

**Example project structure:**

```
src/
├── modules/
│   ├── auth/
│   │   ├── auth.routes.ts      -- API endpoints
│   │   ├── auth.service.ts     -- Business logic
│   │   └── auth.schemas.ts     -- Zod validation schemas
│   ├── inventory/
│   │   ├── inventory.routes.ts
│   │   ├── inventory.service.ts
│   │   └── inventory.schemas.ts
│   ├── tasks/
│   │   ├── tasks.routes.ts
│   │   ├── tasks.service.ts
│   │   └── tasks.schemas.ts
│   ├── billing/
│   ├── notifications/
│   └── sync/
├── shared/
│   ├── db.ts                   -- Prisma/Drizzle client
│   ├── redis.ts                -- Upstash client
│   ├── middleware/              -- Auth, rate limiting, etc.
│   └── types/                  -- Shared TypeScript types
├── jobs/
│   ├── generateTaskInstances.ts
│   ├── sendNotifications.ts
│   └── cleanupSyncLog.ts
├── socket/
│   ├── index.ts                -- Socket.io server setup
│   ├── homeRoom.ts             -- Per-home room logic
│   └── handlers.ts             -- Event handlers
└── server.ts                   -- Fastify + Socket.io entry point
```

---

## 3. Real-Time Architecture

Since you need live sync across devices and push notifications without Supabase's built-in real-time layer, here are your options and the recommended approach.

### Option Comparison

| Approach | Complexity | Cost | Best For |
|----------|-----------|------|----------|
| **Socket.io + Redis (recommended)** | Medium | Low (self-hosted) | Full control, bi-directional, scales with Redis |
| **Ably or Pusher (managed)** | Low | Medium-High at scale | If you want to avoid managing WebSocket infrastructure entirely |
| **Server-Sent Events (SSE)** | Low | Low | One-way updates only (server → client). Not sufficient for your needs. |
| **Neon's Logical Replication + custom listener** | High | Low | Database-level change streaming. Powerful but complex to build on. |

### Recommended: Socket.io + Redis Pub/Sub

This is the most common pattern for real-time collaborative apps. Here's how it works end-to-end:

#### How Live Sync Works

```
User A (phone)                    API Server              User B (laptop)
     │                                │                        │
     │  1. Updates item name          │                        │
     │  ───── HTTP PATCH ──────────>  │                        │
     │                                │  2. Saves to Postgres  │
     │                                │  3. Writes to sync_log │
     │                                │  4. Publishes to Redis │
     │                                │     pub/sub channel    │
     │                                │  ─── Socket.io ──────> │
     │  5. Confirms update            │                        │  6. Receives real-time
     │  <──── HTTP 200 ────────────   │                        │     update, refreshes UI
     │                                │                        │
```

#### Implementation Overview

```typescript
// socket/index.ts — Socket.io server setup

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export async function setupSocketIO(httpServer) {
  // Redis adapter allows multiple API server instances to share
  // WebSocket connections. User A might be connected to Server 1
  // while User B is on Server 2 — Redis ensures both get updates.
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL },
    adapter: createAdapter(pubClient, subClient),
  });

  // Authentication: verify JWT before allowing connection
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    try {
      const user = await verifyJWT(token);
      socket.data.userId = user.id;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    // Find all homes this user belongs to and join those "rooms"
    // A Socket.io "room" is a broadcast group — messages sent to
    // a room reach everyone in it.
    const homes = await getUserHomes(socket.data.userId);
    for (const home of homes) {
      socket.join(`home:${home.id}`);
    }

    // When we need to broadcast a change to all household members:
    // io.to(`home:${homeId}`).emit('sync:update', changeData);
  });

  return io;
}
```

```typescript
// Inside any API route that modifies data (e.g., updating an item):

async function updateItem(req, reply) {
  const { itemId } = req.params;
  const updates = req.body;

  // 1. Update in PostgreSQL
  const item = await db.item.update({
    where: { id: itemId },
    data: updates,
  });

  // 2. Log the change for offline sync
  await db.syncLog.create({
    data: {
      homeId: item.homeId,
      userId: req.user.id,
      entityType: 'item',
      entityId: itemId,
      action: 'update',
      changes: updates,
    },
  });

  // 3. Broadcast to all connected household members
  req.io.to(`home:${item.homeId}`).emit('sync:update', {
    entityType: 'item',
    entityId: itemId,
    action: 'update',
    changes: updates,
    updatedBy: req.user.id,
  });

  return reply.send(item);
}
```

#### Handling Offline Devices

When a device comes back online after being disconnected (phone was in airplane mode, laptop was asleep), it needs to catch up on everything it missed. This is what the `sync_log` table is for:

```typescript
// Client-side: on reconnection, fetch missed changes
socket.on('connect', async () => {
  const lastSyncTimestamp = await getLastSyncTimestamp(); // stored locally
  const response = await fetch(`/api/sync?since=${lastSyncTimestamp}`);
  const missedChanges = await response.json();

  // Apply each missed change to local state
  for (const change of missedChanges) {
    applyChange(change);
  }

  saveLastSyncTimestamp(new Date().toISOString());
});
```

```typescript
// Server-side: the sync catchup endpoint
app.get('/api/sync', async (req, reply) => {
  const { since } = req.query;
  const userHomes = await getUserHomeIds(req.user.id);

  const changes = await db.syncLog.findMany({
    where: {
      homeId: { in: userHomes },
      createdAt: { gt: new Date(since) },
    },
    orderBy: { createdAt: 'asc' },
  });

  return reply.send(changes);
});
```

### Alternative: Managed Real-Time (Ably or Pusher)

If managing Socket.io infrastructure feels like too much, Ably and Pusher are managed services that handle WebSocket connections for you. You publish events to their API, and they deliver them to connected clients.

**Pros:** No WebSocket server to manage, built-in presence detection (see who's online), automatic scaling, message history for catch-up.

**Cons:** Cost scales with connected devices and messages. At 10,000 users with 1.5 devices each, Ably costs roughly $200-400/month for the connections alone. With Socket.io + Redis, the same load costs you the Redis bill (maybe $10-30/month on Upstash).

**Recommendation:** Start with Socket.io + Redis. It's more work upfront but significantly cheaper at scale and gives you full control. If you find yourself spending too much time debugging WebSocket issues instead of building features, consider switching to Ably.

### Push Notifications (Separate from Live Sync)

Push notifications and live sync are different systems that solve different problems:

- **Live sync (Socket.io):** Updates the UI when the app is open and the device is connected. Instant, bi-directional.
- **Push notifications (OneSignal/FCM/APNs):** Alerts the user when the app is *closed*. "Your HVAC filter is due for replacement tomorrow." Goes through Apple/Google's notification infrastructure.

Both are triggered by BullMQ background jobs:

```typescript
// jobs/sendNotifications.ts — runs every hour via BullMQ scheduled job

async function checkAndSendNotifications() {
  const now = new Date();
  const tomorrow = addDays(now, 1);

  // Find tasks due tomorrow that haven't been notified yet
  const dueTasks = await db.task.findMany({
    where: {
      nextDueDate: { lte: tomorrow },
      isActive: true,
      notifyDayBefore: true,
    },
    include: {
      home: { include: { members: true } },
      assignedTo: true,
    },
  });

  for (const task of dueTasks) {
    // Send to assigned user, or all home members if unassigned
    const recipients = task.assignedTo
      ? [task.assignedTo]
      : task.home.members;

    for (const user of recipients) {
      await oneSignal.sendNotification({
        userId: user.id,
        title: `Maintenance Due: ${task.title}`,
        body: `Due ${format(task.nextDueDate, 'MMM d')} at ${task.home.name}`,
        data: { taskId: task.id, homeId: task.homeId },
      });
    }
  }
}
```

---

## 4. Hosting Strategy & Migration Triggers

### Phase 1: Platform-as-a-Service (Railway)

**When:** 0 to roughly 5,000 active users

Railway handles server provisioning, SSL certificates, deployments, and basic scaling for you. You focus purely on building the product.

**Typical monthly costs at this phase:**

- API server (Fastify + Socket.io): $5–20/month
- BullMQ worker: $5–10/month
- Redis (Railway addon or Upstash): $0-10/month
- Neon PostgreSQL: $0-19/month (free tier is generous)
- Cloudflare R2: $0-5/month (10GB free)
- **Total: roughly $10–65/month**

**This is the right choice to start.** Premature migration to AWS wastes weeks of engineering time on infrastructure instead of features.

### Phase 2: Growing Pains (When to Start Worrying)

Watch for these specific signals — any one of them means it's time to plan migration:

| Signal | What It Looks Like | Why It Matters |
|--------|-------------------|---------------|
| **Database connection limits** | "too many connections" errors in logs | Even with Neon's pooling, WebSocket-heavy workloads can exhaust connections on lower tiers. |
| **Monthly bill exceeds $300-500** | Railway billing creeps up as you add instances | At this point, equivalent AWS resources cost 40-60% less. |
| **WebSocket connection limits** | Disconnections, users report sync lag | Railway containers have memory limits that cap how many persistent connections they can hold. |
| **Cold starts** | API takes 2-5 seconds to respond after inactivity | Railway may sleep inactive containers. Unacceptable for a notification worker. |
| **Single-region only** | Users in Europe or Asia report slow performance | Railway runs in one region. AWS/GCP offer global distribution. |
| **Background job scaling** | Notifications sent late, recurring tasks generated behind schedule | Railway makes it hard to independently scale worker processes apart from the API. |

**Estimated timeline:** Most SaaS products hit this around 5,000-15,000 active users, or $300-500/month in PaaS costs, whichever comes first.

### Phase 3: Cloud Provider (AWS, GCP, or DigitalOcean)

**When:** Roughly 5,000 to 50,000+ active users

You don't need to go straight to raw AWS EC2 instances. There's a middle ground:

**Option A: AWS with managed services (recommended)**

- ECS Fargate or App Runner for containers (no server management)
- RDS for PostgreSQL if moving off Neon (managed backups, replicas, scaling), or keep Neon
- ElastiCache for Redis (or keep Upstash)
- S3 for files (or keep R2)
- CloudFront CDN for static assets and API caching
- SQS + Lambda for background jobs (or keep BullMQ in a container)

**Option B: DigitalOcean App Platform**

- Middle ground between PaaS simplicity and cloud flexibility
- Managed PostgreSQL and Redis
- Simpler than AWS, cheaper, but less room to grow long term

**Option C: Kubernetes (EKS/GKE)**

- Only if you hit 100,000+ users or need complex auto-scaling
- Massive operational complexity — don't do this until you have dedicated DevOps staff

**Estimated monthly costs at 20,000 users on AWS:**

- ECS Fargate (2 API instances + 1 worker): $70-120
- Neon Pro (or RDS db.t3.medium): $60-80
- Upstash Redis Pro (or ElastiCache): $30-50
- R2/S3 + CloudFront: $20-50
- Miscellaneous (monitoring, logs, DNS): $20-30
- **Total: roughly $200-330/month**

Compare to Railway at the same scale: likely $400-700/month.

### Migration Strategy

The key principle: **never do a "big bang" migration.** Move services one at a time.

1. **Evaluate what actually needs to move.** Neon and Upstash are cloud-native services — they work regardless of where your API runs. You may not need to move the database at all.
2. **Move the API server first.** Containerize with Docker (which Railway already requires), deploy to ECS Fargate. Point it at the same Neon database and Upstash Redis.
3. **Move file storage if needed.** If you started with Railway's ephemeral storage, migrate to R2/S3 with a one-time script.
4. **Move background workers.** Deploy BullMQ worker as a separate Fargate task with independent scaling.
5. **Evaluate database hosting last.** Neon may continue to serve you well. Only migrate to RDS if you need features Neon doesn't offer (like read replicas in specific regions).

---

## 5. Potential Issues & How to Prepare

### Data Issues

**Conflict resolution in real-time sync.**
When two household members edit the same item simultaneously from different devices, which edit wins? This is the hardest problem in collaborative software.

- **Last-write-wins (simplest).** Timestamp each change; most recent wins. Works for most fields but can silently lose edits.
- **Field-level merging (recommended).** If User A changes the item name while User B changes the description, merge both. Only flag a conflict when both users change the *same* field.
- **Operational transforms or CRDTs (complex).** Necessary for real-time text editing (like Google Docs) but overkill for inventory fields.

**Recommendation:** Implement field-level merging with the sync_log table. Each change records which fields were modified. On conflict, merge non-overlapping changes and use last-write-wins for the same field. Show the user a brief notification: "John also updated this item — your changes have been merged."

**Database migrations without downtime.**
Every time you change the database schema (add a column, rename a table), you need to do it without taking the app offline.

- Never rename or delete a column in one step. Add the new column, migrate data, update code to use both, then remove the old column in a later release.
- Never add a NOT NULL column without a DEFAULT value — the database locks the entire table to backfill existing rows.
- Use Neon's branching feature to test migrations against a copy of production data before applying them.
- Use Prisma Migrate or Drizzle Kit to version-control all schema changes.

### Security Issues

**JWT token theft.**
JWTs (the tokens that prove "this request is from User #123") are bearer tokens — anyone who has one can impersonate that user.

- Short-lived access tokens (15 minutes) paired with longer-lived refresh tokens (7-30 days).
- Refresh tokens stored in the database so you can revoke them.
- Refresh token rotation: every time a refresh token is used, issue a new one and invalidate the old. If someone tries to use an already-rotated token, revoke ALL tokens for that user (indicates potential theft).
- On mobile, store tokens in the device's secure keychain (iOS) or keystore (Android), never in AsyncStorage or localStorage.

**Rate limiting.**
Without rate limits, a malicious user (or a buggy client) can overwhelm your API. Implement using Upstash Redis:

- 100 requests per minute per user for standard endpoints
- 10 requests per minute for login attempts (prevents brute force password guessing)
- 20 requests per minute for file uploads
- Higher limits for paid tiers (incentivizes upgrading)

**Input validation.**
Validate every single input on the server side. Never trust the client. A user can bypass any client-side validation by sending API requests directly with tools like curl or Postman. With Zod, you define the schema once and use it in both Fastify route validation and your React Native forms.

**File upload security.**
Users will upload photos and documents. Dangers include malicious files, oversized uploads, and wrong file types.

- Validate file types by reading the file header (magic bytes), not just the file extension. Someone can rename malware.exe to photo.jpg.
- Set maximum file sizes (e.g., 10MB for images, 25MB for PDFs).
- Never serve uploaded files from the same domain as your API — use a separate R2 URL. This prevents cross-site scripting attacks through uploaded HTML files.
- Generate presigned upload URLs so files go directly from the client to R2, never passing through your API server (reduces server load and attack surface).

### Scaling Issues

**The N+1 query problem.**
This is the most common performance killer in web applications. Example: to show a home's inventory, your code loads the home, then loads each room individually, then loads each item individually. If a home has 10 rooms with 20 items each, that's 1 + 10 + 200 = 211 database queries for one screen.

Fix: use Prisma's `include` (eager loading) or Drizzle's relational queries to batch queries. Fetch all rooms for a home in one query, all items for those rooms in one query. Total: 3 queries instead of 211.

**Connection pooling.**
Each database connection uses RAM on the PostgreSQL server. Neon includes PgBouncer-compatible pooling, which multiplexes many application connections over fewer database connections. Make sure you're using Neon's pooled connection string (the one with `-pooler` in the hostname), not the direct connection string, for your application. Use the direct string only for migrations.

**WebSocket scaling.**
WebSocket connections are persistent — each connected device holds an open connection to your server. With 10,000 users averaging 1.5 devices each, that's 15,000 simultaneous connections. A single server handles roughly 10,000-50,000 WebSocket connections depending on message frequency. Beyond that, the Redis adapter for Socket.io handles coordination across multiple server instances automatically.

**Image processing and storage costs.**
Users will upload high-resolution photos of items. Store the original in R2, but generate and serve thumbnails for list views. A 4MB photo displayed as a 100px thumbnail in a list wastes bandwidth and makes the app feel sluggish. Options:

- Cloudflare Images (resizes on-the-fly via URL parameters, integrates with R2)
- Generate thumbnails on upload using a BullMQ job with the `sharp` library
- Either approach works; Cloudflare Images is simpler, sharp gives you more control

### Operational Issues

**Monitoring and alerting.**
You need to know about problems before your users report them. Minimum viable monitoring:

- **Error tracking** (Sentry): captures every unhandled exception with full stack trace and request context. Free tier covers most early-stage needs.
- **Uptime monitoring** (BetterUptime or UptimeRobot): pings your API every minute, alerts you by text/email when it goes down.
- **Database monitoring**: Neon's dashboard shows slow queries. Set alerts when queries exceed 1 second.
- **Queue depth monitoring**: BullMQ has a dashboard (Bull Board). Alert when job queue depth exceeds a threshold — this means notifications or task generation is falling behind.
- **WebSocket connection count**: Track how many active connections each server instance has. Alert if it approaches the limit.

**Backups and disaster recovery.**

- Neon handles automated backups and provides point-in-time recovery (PITR). Verify your plan includes sufficient retention (at least 7 days, ideally 30).
- Test restoring from backup at least quarterly. An untested backup is not a backup.
- R2/S3 objects are durable by design (99.999999999% durability), but enable versioning so deleted files can be recovered.
- Document your recovery procedure. When your database is down at 2 AM, you don't want to be reading documentation for the first time.

**Background job reliability.**
The recurring task system generates task instances and sends push notifications. If this worker crashes, tasks don't appear on their due date and users miss maintenance reminders. Users lose trust in the product fast.

Mitigations:

- Make jobs idempotent (running the same job twice produces the same result with no duplicates). Use unique constraints and "upsert" patterns.
- Configure BullMQ retry with exponential backoff (retry after 1s, 4s, 16s, etc.) so transient failures resolve themselves.
- Use dead-letter queues for permanently failed jobs — review these weekly.
- Set up health checks that alert when the worker hasn't processed a job in the expected time window.

**App Store and Play Store compliance.**
If you offer subscriptions through a mobile app, Apple and Google require you to use their in-app purchase systems and take 15-30% of revenue.

- You can offer subscriptions only through the website to avoid the app store commission entirely. Many SaaS products take this approach.
- Alternatively, use in-app purchases for mobile subscribers and absorb the fee.
- Be aware that Apple's rules prohibit directing users to external payment pages from within the iOS app. You can offer both payment methods but cannot steer users toward the cheaper web option while inside the app.
- RevenueCat is a popular service that unifies Apple IAP, Google Play Billing, and Stripe under one API if you do decide to support in-app purchases.

---

## Appendix: Suggested Development Order

Building all of this at once is overwhelming. Here's a recommended sequence that gets you to a usable product fastest:

1. **Project setup** — TypeScript monorepo (Turborepo or Nx), Prisma schema, Neon database, basic Fastify server.
2. **Auth + User accounts** — Clerk or Auth0 integration, JWT middleware, sign up, log in, manage profile.
3. **Home and room CRUD** — Create homes, add rooms, basic API endpoints.
4. **Item inventory** — Add items to rooms with photo uploads to R2.
5. **One-time tasks** — Create and complete simple tasks.
6. **Subscription and billing** — Stripe integration, enforce tier limits.
7. **Recurring tasks** — BullMQ scheduler, task instance generation, the scheduling engine.
8. **Push notifications** — OneSignal integration, task reminders and due date alerts.
9. **Sharing and collaboration** — Invite household members, assign roles, permission checks.
10. **Real-time sync** — Socket.io + Redis, live updates across devices, offline catch-up.
11. **Search** — PostgreSQL full-text search across items and tasks.
12. **Monitoring and hardening** — Sentry, uptime checks, rate limiting, load testing.

Steps 1 through 6 are your minimum viable product. Steps 7 through 12 can be rolled out iteratively after initial launch.
