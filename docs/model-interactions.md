# Model Interactions (Mermaid)

This document describes how the current data models interact in the implemented backend.

## Entity Relationships

```mermaid
erDiagram
    USER ||--o| SUBSCRIPTION : has
    USER ||--o{ HOME : owns

    USER {
      string id PK
      string clerk_user_id UK "nullable"
      string email UK
      string display_name
      string avatar_url "nullable"
      boolean email_verified
      boolean is_active
      datetime created_at
      datetime updated_at
      datetime last_login_at "nullable"
      datetime deleted_at "nullable"
    }

    SUBSCRIPTION {
      string id PK
      string user_id FK "unique"
      enum tier "free|basic|premium"
      enum status "active|past_due|canceled|trialing"
      string stripe_customer_id "nullable"
      string stripe_subscription_id "nullable"
      datetime current_period_start "nullable"
      datetime current_period_end "nullable"
      boolean cancel_at_period_end
      datetime created_at
      datetime updated_at
    }

    HOME {
      string id PK
      string owner_id FK
      string name
      string address "nullable"
      enum home_type "nullable"
      int year_built "nullable"
      int square_feet "nullable"
      string photo_url "nullable"
      datetime created_at
      datetime updated_at
    }
```

## Runtime Interaction Flow

```mermaid
flowchart TD
    A[Clerk Sign In / JWT] --> B[Auth Middleware]
    B --> C{User exists by clerk_user_id?}
    C -- Yes --> D[Attach req.user]
    C -- No --> E[Fetch Clerk user or claims fallback]
    E --> F[Upsert USER record]
    F --> D

    G[POST /webhooks/clerk] --> H[Verify Svix signature]
    H --> I{Event type supported?}
    I -- No --> J[Return ok]
    I -- Yes --> K[Idempotency key in Redis]
    K --> L[Upsert or soft-delete USER]

    M[GET /api/users/me] --> N[Read USER by req.user.id]
    O[PATCH /api/users/me] --> P[Validate payload]
    P --> Q[Update USER.display_name/avatar_url]
```

## Notes

- `SUBSCRIPTION` and `HOME` are modeled in Prisma but do not yet have CRUD endpoints in the API.
- `USER` is the model currently mutated by auth sync, Clerk webhooks, and profile endpoints.
- Soft-delete behavior currently applies at the `USER` level (`is_active`, `deleted_at`).
