# Implementation Plan
## Home Inventory & Maintenance SaaS Platform

---

## Table of Contents

1. [Updated Stack for Native Mobile](#1-updated-stack-for-native-mobile)
2. [Environment Setup & Security](#2-environment-setup--security)
3. [Repository & Project Structure](#3-repository--project-structure)
4. [Implementation Phases](#4-implementation-phases)
5. [Native Mobile Considerations](#5-native-mobile-considerations)
6. [Testing Strategy](#6-testing-strategy)
7. [Launch Checklist](#7-launch-checklist)

---

## 1. Updated Stack for Native Mobile

Going native instead of React Native changes the stack in important ways. Here's what's different and what stays the same.

### What Changes

| Layer | Before (React Native) | Now (Native) |
|-------|----------------------|--------------|
| **iOS App** | React Native (JavaScript) | Swift + SwiftUI |
| **Android App** | React Native (JavaScript) | Kotlin + Jetpack Compose |
| **Shared validation** | Zod schemas shared across all platforms | Zod on web/backend only; validation duplicated natively |
| **Shared types** | TypeScript interfaces everywhere | TypeScript on web/backend; Swift Codable + Kotlin data classes on mobile |
| **LiDAR / AR** | Limited, requires native modules | Full access to ARKit (iOS) and ARCore (Android) |
| **Development effort** | One mobile codebase | Two separate mobile codebases |

### What Stays the Same

The entire backend and web stack is unchanged: Fastify API, Neon PostgreSQL, Upstash Redis, Socket.io, BullMQ, Cloudflare R2, Stripe, Clerk/Auth0, OneSignal. Native apps consume the same REST API and WebSocket connections as the web app.

### The Three-Codebase Reality

This is the most important thing to internalize. With native mobile, you now have three separate applications that all need to talk to the same API and display the same data:

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   iOS App    │   │ Android App  │   │   Web App    │
│  Swift/SwiftUI│   │Kotlin/Compose│   │   Next.js    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                   │
       └──────────────────┼───────────────────┘
                          │
                   ┌──────┴───────┐
                   │  Fastify API │
                   │  + Socket.io │
                   └──────┬───────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
        ┌─────┴──┐  ┌────┴───┐  ┌───┴────┐
        │  Neon  │  │Upstash │  │   R2   │
        └────────┘  └────────┘  └────────┘
```

Every feature you build must be implemented three times (iOS, Android, web) on the frontend, but only once on the backend. This means: **invest heavily in making the API excellent.** Clear documentation, consistent response shapes, thorough error messages. The API is the single source of truth that all three clients depend on.

### Recommended iOS-First Strategy

LiDAR is currently available on iPhone 12 Pro and later, iPad Pro (2020+), and essentially zero mainstream Android devices. Android's depth sensing (ToF sensors) is rare, inconsistent across manufacturers, and less capable than Apple's LiDAR.

**Recommendation:** Build iOS first as your primary mobile platform. Build Android second, without LiDAR features initially. Android users get manual room/item entry; iOS users get the premium LiDAR-powered experience. This also halves your initial mobile development timeline.

---

## 2. Environment Setup & Security

### Environment Overview

You need four distinct environments. Each serves a different purpose and has different security requirements.

| Environment | Purpose | Who Uses It | Database | Data |
|-------------|---------|-------------|----------|------|
| **Local Development** | Day-to-day coding | Developers | Neon branch or local Docker Postgres | Seed data (fake) |
| **Staging** | Pre-release testing, QA | Developers + testers | Neon branch of production | Anonymized copy of production data |
| **Preview/PR** | Per-pull-request environments | Developers during code review | Neon branch (temporary) | Seed data |
| **Production** | Live users | Everyone | Neon main branch | Real user data |

### Secret Management

Secrets are values like database passwords, API keys, and encryption keys. Mismanaging secrets is one of the most common ways SaaS applications get compromised. Here are the rules:

**Rule 1: Secrets never go in code.**
Not in source files, not in configuration files checked into Git, not in comments, nowhere. A single API key committed to a Git repository lives in the Git history forever, even if you delete it in the next commit.

**Rule 2: Use environment variables for everything.**
Each environment has its own set of environment variables. Your code reads them at runtime:

```typescript
// config.ts — centralized configuration with validation
import { z } from 'zod';

// Define the exact shape of your environment variables.
// If anything is missing or wrong, the app crashes on startup
// with a clear error instead of failing mysteriously later.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().url(),          // Neon pooled connection
  DATABASE_URL_DIRECT: z.string().url(),   // Neon direct (for migrations only)

  // Redis
  REDIS_URL: z.string().url(),

  // Auth
  CLERK_SECRET_KEY: z.string(),
  CLERK_PUBLISHABLE_KEY: z.string(),

  // Stripe
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),

  // File storage
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_NAME: z.string(),

  // Push notifications
  ONESIGNAL_APP_ID: z.string(),
  ONESIGNAL_API_KEY: z.string(),

  // Application
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string(),               // Comma-separated allowed origins
  API_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
// If any variable is missing, this line throws a detailed error
// and the server refuses to start. This is intentional.
```

**Rule 3: Use a secret management service, not .env files in production.**
For local development, `.env` files are fine (add `.env` to `.gitignore` immediately). For staging and production, use a proper secret manager:

| Platform | Secret Manager | How It Works |
|----------|---------------|-------------|
| **Railway** | Built-in environment variables | Set via the Railway dashboard per service per environment. Encrypted at rest. |
| **AWS (later)** | AWS Secrets Manager or SSM Parameter Store | Secrets stored encrypted, fetched at container startup. Access controlled by IAM roles. |
| **Neon** | Connection string in dashboard | Copy to your secret manager, never embed in code. |
| **Clerk** | Dashboard API keys | Copy to your secret manager. Separate keys for dev/staging/production. |

**Rule 4: Every service gets separate credentials per environment.**
Never use the same Stripe API key in development and production. You'll accidentally charge real customers while testing. Every third-party service should have isolated credentials per environment:

```
Development:
  STRIPE_SECRET_KEY=sk_test_...      ← Stripe test mode
  DATABASE_URL=postgres://...dev     ← Neon development branch
  CLERK_SECRET_KEY=sk_test_...       ← Clerk development instance

Production:
  STRIPE_SECRET_KEY=sk_live_...      ← Stripe live mode
  DATABASE_URL=postgres://...main    ← Neon main branch
  CLERK_SECRET_KEY=sk_live_...       ← Clerk production instance
```

**Rule 5: Rotate secrets on a schedule.**
Set a calendar reminder to rotate (change) all API keys and database passwords every 90 days. If any secret is ever accidentally exposed (committed to Git, shown in a screenshot, sent in Slack), rotate it immediately — within minutes, not hours.

### Environment File Template

Create a `.env.example` file that is checked into Git (with placeholder values, never real secrets). New developers copy this to `.env` and fill in their own values:

```bash
# .env.example — COPY TO .env AND FILL IN REAL VALUES
# This file is safe to commit. .env is not.

NODE_ENV=development
PORT=3000

# Database (Neon)
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
DATABASE_URL_DIRECT=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Redis (Upstash)
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# Auth (Clerk)
CLERK_SECRET_KEY=sk_test_xxxasdfgf
CLERK_PUBLISHABLE_KEY=pk_test_xxx1235412

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# File Storage (Cloudflare R2)
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=dev-uploads

# Push Notifications (OneSignal)
ONESIGNAL_APP_ID=xxx
ONESIGNAL_API_KEY=xxx

# Application
JWT_SECRET=change-me-to-a-random-32-character-string
CORS_ORIGINS=http://localhost:3000,http://localhost:19006
API_URL=http://localhost:3001
```

### Neon Branch Strategy

Neon's branching feature is central to your environment strategy. A branch is an instant, copy-on-write clone of your database — it shares storage with the parent until data diverges, so it's cheap and fast.

```
Neon Database Branches:

main (production)
  ├── staging        ← long-lived, reset weekly from main
  ├── dev            ← long-lived, shared development
  ├── pr-142         ← temporary, auto-created per pull request
  ├── pr-143         ← temporary, auto-deleted when PR merges
  └── migration-test ← temporary, for testing schema changes
```

**How to use branches:**

1. **Production** runs on `main`. All migrations are applied here after testing.
2. **Staging** is a branch of `main`, reset weekly so it has fresh production-like data (anonymized — see below).
3. **Development** is a shared branch for day-to-day work. Seed data, not real data.
4. **PR branches** are created automatically by CI when a pull request includes a database migration. The migration runs on the branch, tests run against it, and the branch is deleted when the PR merges.
5. **Migration test branches** are created manually when you want to test a risky schema change against production-scale data before applying it.

**Data anonymization for staging:** Never copy real user data into non-production environments without anonymizing it first. Write a script that replaces emails with fake ones, names with generated names, and addresses with fake addresses. The structure and volume of data stays realistic, but no personal information leaks outside production.

### Git Security

```bash
# .gitignore — critical entries
.env
.env.local
.env.staging
.env.production
*.pem
*.key
node_modules/
.DS_Store

# iOS
*.xcuserdata
Pods/

# Android
*.keystore
local.properties
```

**Enable Git hooks to prevent accidental secret commits.** Use a tool like `git-secrets` or `gitleaks`:

```bash
# Install gitleaks (runs automatically before each commit)
brew install gitleaks

# Add as a pre-commit hook
# .husky/pre-commit
gitleaks protect --staged --verbose
```

This scans every commit for patterns that look like API keys, passwords, or tokens, and blocks the commit if it finds any.

### Network Security

**HTTPS everywhere.** Every environment, including local development, should use HTTPS. Railway and Neon handle this automatically for deployed services. For local development, use `mkcert` to create locally-trusted certificates:

```bash
brew install mkcert
mkcert -install
mkcert localhost 127.0.0.1
# Creates localhost.pem and localhost-key.pem
# Configure Fastify to use these in development
```

**CORS (Cross-Origin Resource Sharing).** Your API should only accept requests from your own web and mobile apps, not from any random website. Configure this per environment:

```typescript
// In Fastify setup
app.register(cors, {
  origin: env.CORS_ORIGINS.split(','),
  // Development: ['http://localhost:3000']
  // Production:  ['https://app.yourproduct.com']
  credentials: true,
});
```

**API rate limiting by environment:**

| Environment | Rate Limit | Why |
|-------------|-----------|-----|
| Development | Off or very high | Don't slow down development |
| Staging | Same as production | Test that rate limiting works |
| Production | 100 req/min standard, 10/min auth | Protect against abuse |

### Mobile App Security Specifics

Native apps have their own security considerations beyond what the backend handles:

**iOS (Swift):**

```swift
// Store auth tokens in Keychain, NEVER in UserDefaults
import Security

func storeToken(_ token: String, forKey key: String) {
    let data = token.data(using: .utf8)!
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: key,
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]
    SecItemDelete(query as CFDictionary) // Remove old value
    SecItemAdd(query as CFDictionary, nil)
}
```

**Android (Kotlin):**

```kotlin
// Store auth tokens in EncryptedSharedPreferences, NEVER plain SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

val masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
val prefs = EncryptedSharedPreferences.create(
    "secure_prefs",
    masterKey,
    context,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

prefs.edit().putString("auth_token", token).apply()
```

**Certificate pinning (both platforms):** Configure your apps to only trust your specific API server's SSL certificate, not any certificate that a device happens to trust. This prevents man-in-the-middle attacks where an attacker installs a rogue certificate on a device. Implement this before launch, but be careful — if you rotate certificates without updating the app, users get locked out until they update.

**API key for mobile apps:** In addition to user authentication, include an app-level API key in every request from mobile apps. This lets your backend distinguish between legitimate app traffic and someone who reverse-engineered your API. It's not a strong security measure (the key can be extracted from the app binary), but it's one more layer.

---

## 3. Repository & Project Structure

### Monorepo vs Multi-Repo

With three clients and a backend, you need to decide how to organize your code.

**Recommended: Hybrid approach.**

- **One repository** for the backend API + web app (TypeScript monorepo using Turborepo)
- **Separate repository** for iOS app (Xcode project)
- **Separate repository** for Android app (Android Studio project)

Why not put everything in one giant monorepo? Because Xcode and Android Studio have their own project structures, build systems, and CI/CD pipelines that don't integrate well with JavaScript tooling. Forcing them into a Turborepo creates friction without benefit.

The backend and web app share TypeScript code (types, validation, utilities), so they genuinely benefit from being in the same repo. The mobile apps consume the API over HTTP and don't share code with the backend.

### Backend + Web Monorepo Structure

```
home-app/
├── apps/
│   ├── api/                        # Fastify API server
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── auth.schemas.ts
│   │   │   │   │   └── auth.test.ts
│   │   │   │   ├── inventory/
│   │   │   │   │   ├── inventory.routes.ts
│   │   │   │   │   ├── inventory.service.ts
│   │   │   │   │   ├── inventory.schemas.ts
│   │   │   │   │   └── inventory.test.ts
│   │   │   │   ├── tasks/
│   │   │   │   ├── billing/
│   │   │   │   ├── notifications/
│   │   │   │   └── sync/
│   │   │   ├── socket/
│   │   │   │   ├── index.ts
│   │   │   │   ├── homeRoom.ts
│   │   │   │   └── handlers.ts
│   │   │   ├── jobs/
│   │   │   │   ├── generateTaskInstances.ts
│   │   │   │   ├── sendNotifications.ts
│   │   │   │   └── cleanupSyncLog.ts
│   │   │   ├── middleware/
│   │   │   │   ├── authenticate.ts
│   │   │   │   ├── rateLimit.ts
│   │   │   │   ├── validateTierLimits.ts
│   │   │   │   └── errorHandler.ts
│   │   │   ├── config.ts           # Env validation (the Zod schema above)
│   │   │   └── server.ts           # Entry point
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Database schema
│   │   │   ├── migrations/         # Version-controlled migrations
│   │   │   └── seed.ts             # Development seed data
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        # Next.js web application
│       ├── src/
│       │   ├── app/                # Next.js App Router pages
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── styles/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                     # Shared between API and web
│       ├── src/
│       │   ├── schemas/            # Zod schemas (validation + types)
│       │   │   ├── item.ts
│       │   │   ├── task.ts
│       │   │   ├── home.ts
│       │   │   └── user.ts
│       │   ├── types/              # Generated TypeScript types
│       │   │   └── index.ts
│       │   └── constants/          # Tier limits, categories, etc.
│       │       ├── tiers.ts
│       │       └── categories.ts
│       ├── package.json
│       └── tsconfig.json
│
├── .env.example
├── .gitignore
├── .husky/
│   └── pre-commit                  # gitleaks + lint
├── turbo.json                      # Turborepo config
├── package.json
└── docker-compose.yml              # Local Postgres + Redis for offline dev
```

### iOS Project Structure

```
home-app-ios/
├── HomeApp/
│   ├── App/
│   │   ├── HomeApp.swift           # App entry point
│   │   └── AppDelegate.swift
│   ├── Core/
│   │   ├── Network/
│   │   │   ├── APIClient.swift     # HTTP client (URLSession or Alamofire)
│   │   │   ├── APIEndpoints.swift  # All endpoint definitions
│   │   │   ├── AuthInterceptor.swift
│   │   │   └── WebSocketManager.swift  # Socket.io client
│   │   ├── Auth/
│   │   │   ├── AuthManager.swift
│   │   │   └── KeychainHelper.swift
│   │   ├── Storage/
│   │   │   ├── CoreDataStack.swift # Local offline cache
│   │   │   └── SyncManager.swift   # Handles offline/online transitions
│   │   └── Config/
│   │       └── Environment.swift   # API URLs per build config
│   ├── Features/
│   │   ├── Home/
│   │   │   ├── HomeListView.swift
│   │   │   ├── HomeDetailView.swift
│   │   │   └── HomeViewModel.swift
│   │   ├── Inventory/
│   │   │   ├── ItemListView.swift
│   │   │   ├── ItemDetailView.swift
│   │   │   └── ItemViewModel.swift
│   │   ├── Tasks/
│   │   ├── LiDAR/                  # LiDAR-specific features
│   │   │   ├── RoomScanView.swift
│   │   │   ├── RoomScanViewModel.swift
│   │   │   ├── ARSessionManager.swift
│   │   │   └── MeshProcessing.swift
│   │   └── Settings/
│   ├── Models/                     # Swift Codable structs (mirror API response shapes)
│   │   ├── User.swift
│   │   ├── Home.swift
│   │   ├── Room.swift
│   │   ├── Item.swift
│   │   └── Task.swift
│   └── Resources/
│       ├── Assets.xcassets
│       └── Info.plist
├── HomeAppTests/
├── HomeAppUITests/
├── Podfile or Package.swift        # Dependencies
└── .gitignore
```

### Android Project Structure

```
home-app-android/
├── app/
│   ├── src/main/
│   │   ├── java/com/homeapp/
│   │   │   ├── core/
│   │   │   │   ├── network/
│   │   │   │   │   ├── ApiClient.kt
│   │   │   │   │   ├── ApiEndpoints.kt
│   │   │   │   │   ├── AuthInterceptor.kt
│   │   │   │   │   └── WebSocketManager.kt
│   │   │   │   ├── auth/
│   │   │   │   │   ├── AuthManager.kt
│   │   │   │   │   └── SecureStorage.kt
│   │   │   │   ├── storage/
│   │   │   │   │   ├── AppDatabase.kt    # Room database (local cache)
│   │   │   │   │   └── SyncManager.kt
│   │   │   │   └── di/                   # Dependency injection (Hilt)
│   │   │   │       └── AppModule.kt
│   │   │   ├── features/
│   │   │   │   ├── home/
│   │   │   │   ├── inventory/
│   │   │   │   ├── tasks/
│   │   │   │   └── settings/
│   │   │   ├── models/                   # Kotlin data classes
│   │   │   │   ├── User.kt
│   │   │   │   ├── Home.kt
│   │   │   │   ├── Room.kt
│   │   │   │   ├── Item.kt
│   │   │   │   └── Task.kt
│   │   │   └── HomeAppApplication.kt
│   │   ├── res/
│   │   └── AndroidManifest.xml
│   ├── src/test/
│   └── src/androidTest/
├── build.gradle.kts
├── gradle.properties
└── .gitignore
```

### API Contract: The Glue Between All Three Clients

Since three separate codebases all consume the same API, you need a single source of truth for the API contract. Options:

**Option A: OpenAPI/Swagger specification (recommended).** Write your API spec in OpenAPI format. Use it to auto-generate Swift and Kotlin API client code, and validate your Fastify routes against it. This ensures all three clients agree on request/response shapes.

**Option B: Fastify's built-in JSON Schema.** Fastify can auto-generate an OpenAPI spec from your route schemas. Combine with Zod-to-OpenAPI (`@asteasolutions/zod-to-openapi`) to go from Zod schemas → OpenAPI spec → generated mobile clients.

The workflow:

```
Zod schemas (source of truth)
  → OpenAPI spec (auto-generated)
    → TypeScript types (for web, auto-generated)
    → Swift Codable structs (auto-generated via swift-openapi-generator)
    → Kotlin data classes (auto-generated via openapi-generator)
    → API documentation (auto-generated, hosted for reference)
```

This eliminates the biggest risk of multi-platform development: API contract drift, where the iOS app expects one response shape, Android expects another, and the server returns a third.

---

## 4. Implementation Phases

### Phase 0: Foundation (Weeks 1-2)

Everything else builds on this. Do not skip or rush any of these steps.

**Backend:**
- [x] Initialize Turborepo monorepo with `apps/api` and `apps/web` and `packages/shared`
- [x] Set up Fastify with TypeScript, configure hot-reload for development
- [x] Set up Prisma with Neon PostgreSQL, create initial schema (users, subscriptions)
- [x] Configure environment variable validation (the Zod config.ts pattern)
- [x] Set up Upstash Redis client
- [x] Set up basic middleware: error handler, request logging, CORS
- [x] Set up Docker Compose for local development (Postgres + Redis, for offline work)
- [x] Write the `.env.example` file with all required variables documented
- [x] Install and configure gitleaks pre-commit hook
- [x] Set up Sentry for error tracking

**iOS:**
- [ ] Create Xcode project with SwiftUI
- [ ] Set up project structure (Core/, Features/, Models/)
- [ ] Configure build schemes for Development, Staging, Production (each with different API URLs)
- [ ] Implement `Environment.swift` configuration switching
- [ ] Set up `KeychainHelper.swift` for secure token storage
- [ ] Implement basic `APIClient.swift` with auth token injection
- [ ] Set up XCTest targets

**CI/CD:**
- [x] Backend: GitHub Actions pipeline — lint, test, build on every PR
- [ ] iOS: Xcode Cloud or GitHub Actions with Fastlane — build and test on every PR
- [ ] Configure Neon branch creation on PRs that include migration files

**Deliverable:** Empty app shells that can communicate with a running API server. All environments configured. Security foundations in place.

### Phase 1: Authentication & User Management (Weeks 3-4)

**Backend:**
- [x] Integrate Clerk SDK (or Auth0) with Fastify
- [x] Create auth middleware that verifies JWTs on every request
- [ ] Build user profile endpoints: GET/PATCH /api/users/me
- [x] Build user registration webhook handler (Clerk sends a webhook when a user signs up; create the database record)
- [ ] Implement refresh token rotation if using custom JWT layer on top of Clerk
- [ ] Set up rate limiting on auth endpoints (10 requests/minute)

**iOS:**
- [ ] Integrate Clerk iOS SDK (or Auth0.swift)
- [ ] Build sign-up screen (email + password, or Apple Sign-In)
- [ ] Build login screen
- [ ] Build profile management screen
- [ ] Implement automatic token refresh on 401 responses
- [ ] Store tokens in Keychain

**Web:**
- [x] Integrate Clerk Next.js SDK
- [x] Build sign-up and login pages
- [ ] Build profile page
- [x] Set up protected routes (redirect to login if not authenticated)

**Deliverable:** Users can create accounts and log in from iOS and web. Auth tokens are managed securely.

### Phase 2: Homes & Rooms (Weeks 5-6)

**Backend:**
- [ ] Create Prisma models for homes and rooms
- [ ] Run migration on Neon dev branch, test, then apply to main
- [ ] Build homes CRUD endpoints: GET/POST/PATCH/DELETE /api/homes
- [ ] Build rooms CRUD endpoints: GET/POST/PATCH/DELETE /api/homes/:homeId/rooms
- [ ] Implement Row-Level Security checks (user can only access their own homes)
- [ ] Implement subscription tier limits (free tier: 1 home max)
- [ ] Write API tests for all endpoints including authorization edge cases

**iOS:**
- [ ] Build home list screen
- [ ] Build home creation/edit flow
- [ ] Build room list within a home
- [ ] Build room creation/edit flow
- [ ] Implement pull-to-refresh and loading states
- [ ] Handle tier limit errors gracefully (show upgrade prompt)

**Web:**
- [ ] Build equivalent home and room management pages
- [ ] Implement responsive layouts for desktop and mobile web

**Deliverable:** Users can create homes and organize them into rooms on both platforms.

### Phase 3: Item Inventory (Weeks 7-9)

This is the core feature and deserves extra time.

**Backend:**
- [ ] Create Prisma models for items and item_attachments
- [ ] Build items CRUD endpoints: GET/POST/PATCH/DELETE /api/homes/:homeId/rooms/:roomId/items
- [ ] Implement JSONB metadata storage and querying
- [ ] Implement full-text search endpoint: GET /api/homes/:homeId/search?q=samsung
- [ ] Build presigned URL endpoint for R2 direct uploads: POST /api/uploads/presign
- [ ] Implement thumbnail generation (BullMQ job using sharp library, triggered on upload)
- [ ] Implement tier limit checks (free tier: 50 items max)
- [ ] Build item detail endpoint that includes attachments, linked tasks, warranty status

**iOS:**
- [ ] Build item list within a room (with thumbnail grid view)
- [ ] Build item detail screen showing all fields, photos, and metadata
- [ ] Build item creation/edit form with photo capture (camera + photo library)
- [ ] Implement direct-to-R2 upload using presigned URLs
- [ ] Build search screen with real-time search-as-you-type
- [ ] Build barcode scanner for model number lookup (use AVFoundation)

**Web:**
- [ ] Build equivalent item management pages
- [ ] Implement drag-and-drop photo upload
- [ ] Implement search with debounced input

**Deliverable:** Users can catalog their home items with photos, details, and search. This is your MVP core.

### Phase 4: LiDAR Room Scanning — iOS Only (Weeks 10-12)

This is the differentiating feature. Build it after basic inventory works.

**iOS:**
- [ ] Implement ARKit LiDAR room scanning using RoomPlan API (iOS 16+)
- [ ] Build room scan UI with real-time mesh preview
- [ ] Process scanned room data: extract dimensions, wall positions, door/window locations
- [ ] Store room scan data (dimensions, floor area) in the room model
- [ ] Build 3D room visualization using SceneKit or RealityKit
- [ ] Implement item placement: user taps a location in the scanned room to place an inventory item
- [ ] Build item measurement feature: use LiDAR to capture approximate item dimensions

**Backend:**
- [ ] Extend room model with scan data fields (dimensions, floor_plan_data JSONB)
- [ ] Build endpoints for storing/retrieving room scan data
- [ ] Implement scan data storage in R2 (3D mesh files can be large)

**Deliverable:** iOS users can scan rooms with LiDAR, see 3D visualizations, get room dimensions, and place items in a spatial context. This is the "wow" feature for marketing.

### Phase 5: Tasks & Recurring Scheduling (Weeks 13-15)

**Backend:**
- [ ] Create Prisma models for tasks and task_instances
- [ ] Build task CRUD endpoints with recurrence configuration
- [ ] Build the task instance generation job (BullMQ scheduled job, runs daily)
  - Finds all active recurring tasks where next_due_date <= today
  - Creates a task_instance for each
  - Advances next_due_date based on recurrence pattern
  - Idempotent: uses a unique constraint on (task_id, due_date) to prevent duplicates
- [ ] Build task completion endpoint: PATCH /api/tasks/:taskId/instances/:instanceId
- [ ] Build task dashboard endpoint: GET /api/homes/:homeId/tasks?status=pending&sort=due_date
- [ ] Build overdue task detection
- [ ] Implement tier limits on total tasks

**iOS:**
- [ ] Build task list with filtering (pending, completed, overdue)
- [ ] Build task creation form with recurrence picker (daily, weekly, monthly, yearly, custom)
- [ ] Build task detail screen showing completion history (past instances)
- [ ] Build task completion flow with optional notes
- [ ] Link tasks to items (e.g., "Change filter" linked to "HVAC System")
- [ ] Show tasks on the item detail screen

**Web:**
- [ ] Build equivalent task management pages
- [ ] Build a calendar view for upcoming tasks
- [ ] Build a dashboard showing overdue tasks prominently

**Deliverable:** Users can create one-time and recurring maintenance tasks, mark them complete, and see their maintenance history.

### Phase 6: Subscriptions & Billing (Weeks 16-17)

**Backend:**
- [ ] Integrate Stripe SDK
- [ ] Build subscription creation flow: POST /api/billing/checkout (creates Stripe Checkout session)
- [ ] Build Stripe webhook handler for:
  - `checkout.session.completed` → activate subscription
  - `invoice.paid` → extend subscription period
  - `invoice.payment_failed` → mark as past_due, send grace period notification
  - `customer.subscription.deleted` → downgrade to free tier
- [ ] Build subscription management endpoints: GET /api/billing/subscription, POST /api/billing/portal (creates Stripe customer portal session)
- [ ] Implement graceful downgrade: when a user cancels, don't delete their data above the free tier limit, just make it read-only until they either upgrade again or manually delete items
- [ ] Write comprehensive webhook tests (Stripe provides test webhook events)

**iOS:**
- [ ] Build subscription screen showing current tier and usage
- [ ] Build upgrade flow (opens Stripe Checkout in a web view or Safari)
- [ ] Build manage subscription flow (opens Stripe customer portal)
- [ ] Handle tier limit enforcement in the UI (gray out "add item" when at limit, show upgrade prompt)
- [ ] Optionally implement Apple In-App Purchases with RevenueCat if you want to offer in-app payment alongside web payment

**Web:**
- [ ] Build pricing page
- [ ] Build subscription management in settings
- [ ] Build checkout flow with Stripe Elements

**Deliverable:** Working payment system. Free users see limits, paid users get more capacity.

### Phase 7: Push Notifications (Weeks 18-19)

**Backend:**
- [ ] Integrate OneSignal server SDK
- [ ] Build device token registration endpoint: POST /api/devices
- [ ] Build the notification sender job (BullMQ, runs hourly):
  - Checks for tasks due tomorrow (notify_days_before)
  - Checks for tasks due today (notify_day_of)
  - Checks for overdue tasks (daily nag)
  - Sends via OneSignal, logs to notification_log table
- [ ] Build notification preferences endpoint: PATCH /api/users/me/notification-preferences
- [ ] Build in-app notification list: GET /api/notifications
- [ ] Implement notification deduplication (don't send the same notification twice)

**iOS:**
- [ ] Integrate OneSignal iOS SDK
- [ ] Request push notification permissions (with good UX — explain WHY before the system dialog)
- [ ] Handle notification taps (deep link to relevant task)
- [ ] Build in-app notification center showing recent alerts
- [ ] Register/update device token with backend

**Web:**
- [ ] Implement web push notifications via OneSignal
- [ ] Build notification center in the app header

**Deliverable:** Users get reminded about upcoming and overdue maintenance tasks. The product is now useful even when users aren't actively looking at it.

### Phase 8: Sharing & Collaboration (Weeks 20-22)

**Backend:**
- [ ] Build invitation system:
  - POST /api/homes/:homeId/members (sends invite email via Clerk/SendGrid)
  - PATCH /api/invitations/:id/accept
  - DELETE /api/homes/:homeId/members/:userId (remove member)
- [ ] Implement role-based access control:
  - Viewer: can see everything, can't modify
  - Editor: can add/edit items and tasks, can't manage members or delete the home
  - Admin: full access including member management
- [ ] Update ALL existing endpoints to check member permissions, not just ownership
- [ ] Extend task assignment to include any home member
- [ ] This is a security-critical phase — write thorough tests for every permission edge case

**iOS:**
- [ ] Build member management screen (invite, view members, change roles, remove)
- [ ] Build invitation acceptance flow (deep link from email)
- [ ] Show who completed each task, who added each item
- [ ] Handle permission-based UI (hide edit buttons for viewers)

**Web:**
- [ ] Build equivalent collaboration features

**Deliverable:** Households can share home management. One person scans the rooms, another adds items, another handles tasks.

### Phase 9: Real-Time Sync (Weeks 23-25)

**Backend:**
- [ ] Set up Socket.io with Redis adapter (Upstash)
- [ ] Implement authentication on WebSocket connections (verify JWT)
- [ ] Implement home-based rooms (Socket.io rooms, one per home)
- [ ] Add sync_log writes to all create/update/delete operations
- [ ] Emit Socket.io events on every data change
- [ ] Build the sync catch-up endpoint: GET /api/sync?since=timestamp
- [ ] Implement sync_log cleanup job (delete entries older than 90 days)
- [ ] Load test WebSocket connections (simulate 1,000+ concurrent connections)

**iOS:**
- [ ] Integrate Socket.io Swift client
- [ ] Implement connection management (connect on app foreground, disconnect on background)
- [ ] Implement local cache using Core Data (so the app works offline)
- [ ] Build sync manager: 
  - On connect: fetch all changes since last sync timestamp
  - While connected: apply incoming changes to local cache in real-time
  - While offline: queue outgoing changes locally
  - On reconnect: push queued changes, then pull missed changes
- [ ] Implement conflict resolution (field-level merge with last-write-wins fallback)
- [ ] Show sync status indicator (synced, syncing, offline)

**Web:**
- [ ] Integrate Socket.io JavaScript client
- [ ] Implement real-time UI updates (when another user edits something, the screen updates live)

**Deliverable:** Changes propagate across devices in real-time. The app works offline and syncs when connectivity returns.

### Phase 10: Polish, Search & Launch Prep (Weeks 26-28)

**Backend:**
- [ ] Optimize slow queries (review Neon query dashboard)
- [ ] Implement full-text search API with result ranking
- [ ] Add request logging and analytics events
- [ ] Security audit: review all endpoints for authorization gaps
- [ ] Load testing: simulate expected traffic (10,000 users, 15,000 connections)
- [ ] Set up production monitoring dashboards

**iOS:**
- [ ] Performance optimization: profile with Instruments, fix memory leaks
- [ ] Accessibility audit (VoiceOver, Dynamic Type)
- [ ] App Store submission preparation:
  - Screenshots for all required device sizes
  - App Store description and keywords
  - Privacy policy and terms of service
  - App Review guidelines compliance check
  - TestFlight beta distribution for pre-launch testers

**Web:**
- [ ] SEO for marketing pages
- [ ] Performance optimization (Lighthouse audit, target 90+ scores)
- [ ] Build onboarding flow for new users

**Cross-platform:**
- [ ] Write user documentation / help center
- [ ] Set up customer support channel (Intercom, Crisp, or email)
- [ ] Set up status page (BetterUptime)
- [ ] Final backup and recovery test
- [ ] Incident response plan: who gets paged, how to roll back

**Deliverable: Production launch.**

---

## 5. Native Mobile Considerations

### Managing Feature Parity Across Platforms

With three codebases, features will inevitably ship at different times on different platforms. This is normal and expected, but you need a strategy:

**Tier 1 features (must be on all platforms before launch):** Account management, home/room/item CRUD, task management, search, push notifications.

**Tier 2 features (iOS first, then web, then Android):** LiDAR scanning, 3D room visualization, real-time sync. These either depend on iOS hardware or are complex enough that staggering the rollout is wise.

**Tier 3 features (one platform only for now):** LiDAR measurements will likely be iOS-only for a long time, since Android hardware support is sparse.

### Shared API Client Generation

To avoid manually writing the same API client code in Swift, Kotlin, and TypeScript, use OpenAPI code generation:

1. Your Fastify API exports an OpenAPI spec (auto-generated from Zod schemas)
2. Run `swift-openapi-generator` to produce Swift API client code
3. Run `openapi-generator` with the Kotlin target for Android
4. The web app uses the Zod schemas directly (no generation needed)

When you add or change an API endpoint, regenerate the clients. This eliminates an entire class of bugs where one platform sends the wrong request shape.

### Offline-First Architecture for Mobile

Mobile apps must work without internet. Users might be in their basement scanning rooms with no signal. The pattern:

1. **Local database** stores a cache of all the user's data (Core Data on iOS, Room on Android).
2. **All reads** come from the local database, never directly from the API. This makes the app feel instant.
3. **All writes** go to the local database first, then get queued for sync to the server.
4. **A sync manager** handles pushing queued changes to the server and pulling remote changes into the local database.
5. **Conflict resolution** uses the field-level merge strategy from the architecture document.

This is significantly more complex than a simple API client, but it's what users expect from a native app. The app should never show a "no internet" blank screen — it should show the last known state and sync when connectivity returns.

### Local Database Schemas

The local databases mirror the server schema but with additional sync metadata:

```swift
// iOS Core Data entity (simplified)
@objc(ItemEntity)
class ItemEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var name: String
    @NSManaged var roomId: UUID
    // ... all item fields ...

    // Sync metadata
    @NSManaged var lastSyncedAt: Date?      // When this was last confirmed synced
    @NSManaged var locallyModifiedAt: Date?  // When the user last changed this locally
    @NSManaged var pendingSync: Bool         // True if changes haven't been pushed yet
    @NSManaged var isDeleted: Bool           // Local soft delete flag
}
```

---

## 6. Testing Strategy

### Testing Pyramid

Focus most of your testing effort on the backend, where a single bug affects all three clients.

```
            ┌─────────┐
            │   E2E   │  Few: critical user journeys only
            │  Tests  │  (sign up → add home → add item → create task)
           ┌┴─────────┴┐
           │Integration │  Moderate: API endpoints with real database
           │   Tests    │  (test each endpoint with auth, permissions, edge cases)
          ┌┴───────────┴─┐
          │   Unit Tests  │  Many: business logic, validation, utilities
          │               │  (recurrence calculation, tier limit checks, sync merge)
          └───────────────┘
```

### Backend Testing

```typescript
// Example: testing the task instance generation job
describe('generateTaskInstances', () => {
  it('creates an instance for a task due today', async () => {
    // Arrange: create a recurring task with next_due_date = today
    const task = await createTask({
      recurrence: 'monthly',
      nextDueDate: new Date(),
    });

    // Act: run the job
    await generateTaskInstances();

    // Assert: a task instance was created
    const instances = await db.taskInstance.findMany({
      where: { taskId: task.id },
    });
    expect(instances).toHaveLength(1);
    expect(instances[0].dueDate).toEqual(today());
    expect(instances[0].status).toBe('pending');
  });

  it('advances next_due_date after generating an instance', async () => {
    const task = await createTask({
      recurrence: 'monthly',
      recurrenceInterval: 1,
      nextDueDate: new Date('2026-03-15'),
    });

    await generateTaskInstances();

    const updated = await db.task.findUnique({ where: { id: task.id } });
    expect(updated.nextDueDate).toEqual(new Date('2026-04-15'));
  });

  it('does not create duplicate instances (idempotent)', async () => {
    const task = await createTask({
      recurrence: 'weekly',
      nextDueDate: new Date(),
    });

    // Run twice
    await generateTaskInstances();
    await generateTaskInstances();

    const instances = await db.taskInstance.findMany({
      where: { taskId: task.id },
    });
    expect(instances).toHaveLength(1); // Still just one
  });
});
```

### Mobile Testing

**iOS:** XCTest for unit tests (view models, sync logic, API response parsing), XCUITest for critical flows (login, add item, complete task). Do NOT try to achieve high UI test coverage — UI tests are slow and brittle. Focus on testing business logic.

**Android:** JUnit + MockK for unit tests, Espresso for critical UI flows. Same principle: test logic extensively, test UI sparingly.

### CI/CD Pipeline

```yaml
# .github/workflows/api.yml (simplified)
name: API CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: test
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx prisma migrate deploy   # Apply migrations to test DB
      - run: npm run test                 # Unit + integration tests
      - run: npm run lint
      - run: npx gitleaks detect          # Check for leaked secrets
```

---

## 7. Launch Checklist

### Before Going Live

**Security:**
- [ ] All secrets in a secret manager, none in code
- [ ] Rate limiting enabled on all endpoints
- [ ] Input validation on every endpoint (Zod schemas)
- [ ] Row-Level Security policies active in PostgreSQL
- [ ] CORS configured to allow only your domains
- [ ] File uploads validated (type, size, content)
- [ ] HTTPS enforced everywhere
- [ ] Penetration test (at minimum, run OWASP ZAP against your API)

**Reliability:**
- [ ] Sentry configured and receiving test errors
- [ ] Uptime monitoring pinging health endpoint every minute
- [ ] Database backups verified (restore tested at least once)
- [ ] Background job monitoring (BullMQ dashboard, queue depth alerts)
- [ ] Error alerting configured (Sentry → Slack/email/PagerDuty)

**Performance:**
- [ ] All database queries under 100ms at expected data volume
- [ ] N+1 queries eliminated (check with query logging)
- [ ] Images served as thumbnails in list views, full-size only on detail
- [ ] API response times under 200ms for standard operations
- [ ] WebSocket reconnection tested (kill the server, verify clients reconnect)

**Legal/Compliance:**
- [ ] Privacy policy published and accessible
- [ ] Terms of service published
- [ ] Cookie consent banner on web (if using analytics)
- [ ] GDPR compliance: ability to export and delete user data on request
- [ ] App Store privacy nutrition labels filled out accurately

**Operational:**
- [ ] Incident response documented: who gets paged, how to roll back, how to communicate to users
- [ ] Status page set up (statuspage.io or BetterUptime)
- [ ] On-call rotation defined (even if it's just you, have the alerting pipeline working)
- [ ] Runbook for common issues: database connection exhausted, worker crashed, payment webhook failing

### Post-Launch Priorities (First 30 Days)

- [ ] Monitor error rates daily
- [ ] Watch database query performance (Neon dashboard)
- [ ] Track user onboarding completion rate (PostHog funnel)
- [ ] Monitor WebSocket connection counts and stability
- [ ] Review customer support tickets for patterns
- [ ] Prepare Android development plan based on iOS launch learnings
