# Hestia - Home Inventory & Maintenance Platform

Hestia is a comprehensive SaaS platform designed to help homeowners track their property's inventory, schedule maintenance tasks, and manage their home efficiently.

## Documentation

For detailed information about the project's architecture, implementation plan, and backend guide, please refer to the documentation in the `docs` folder:

*   [**Implementation Plan**](docs/implementation-plan.md): Detailed roadmap, phases, and launch checklist.
*   [**Architecture Design**](docs/saas-architecture-v2.md): High-level architecture, database design, tech stack choices, and real-time synchronization strategy.
*   [**Backend Implementation Guide**](docs/phase0-backend-guide.md): Detailed guide for the backend setup, shared packages, and third-party service integration.

## Tech Stack Overview

### Backend & Web Monorepo (`home-app`)
*   **Monorepo Tool:** Turborepo
*   **API Server:** Node.js with Fastify
*   **Web App:** Next.js (React)
*   **Shared Code:** TypeScript (`packages/shared` for schemas, types, constants)
*   **Database:** PostgreSQL (Neon)
*   **Caching & Pub/Sub:** Redis (Upstash)
*   **ORM:** Prisma
*   **Validation:** Zod

### Mobile Apps
*   **iOS:** Swift + SwiftUI (`home-app-ios`)
*   **Android:** Kotlin + Jetpack Compose (`home-app-android`)

### Infrastructure & Services
*   **Authentication:** Clerk / Auth0
*   **Payments:** Stripe
*   **File Storage:** Cloudflare R2 / AWS S3
*   **Push Notifications:** OneSignal
*   **Background Jobs:** BullMQ
*   **Error Tracking:** Sentry

## Repository Structure

The repository is organized as a monorepo containing the backend API and the web application.

```
Hestia/
├── .github/                        # GitHub Actions and configurations
├── .husky/                         # Git hooks
├── apps/
│   ├── api/                        # Fastify API server
│   └── web/                        # Next.js web application
├── docs/                           # Project documentation
│   ├── implementation-plan.md
│   ├── phase0-backend-guide.md
│   └── saas-architecture-v2.md
├── packages/
│   └── shared/                     # Shared TypeScript code (schemas, types, constants)
├── .gitignore
├── docker-compose.yml              # Local development setup (Postgres + Redis)
├── eslint.config.mjs
├── package-lock.json
├── package.json                    # Root package configuration
├── tsconfig.json
└── turbo.json                      # Turborepo configuration
```

## Getting Started

To get started with development, please refer to the [Backend Implementation Guide](docs/phase0-backend-guide.md) for detailed instructions on setting up the environment, installing dependencies, and running the application locally.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm
*   Docker (optional, for local database/redis)

### Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/Hestia.git
    cd Hestia
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Copy `apps/api/.env.example` to `apps/api/.env` and fill in the required values. See [Backend Guide](docs/phase0-backend-guide.md#environment-file-template) for details.

4.  **Run development server:**
    ```bash
    npm run dev
    ```

This command will start both the API and the web application in development mode.
