# Auth Provider Comparison for Home Inventory SaaS

## Pricing Comparison

### At Launch (0-10K users)

| Provider | Monthly Cost | What You Get |
|----------|-------------|-------------|
| **Neon Auth** | $0 (included with Neon Free plan) | 60K MAU, auth data lives in your Postgres, branches with your DB |
| **Firebase Auth** | $0 | 50K MAU, email/social login, no RBAC, no advanced MFA |
| **Clerk** | $0 | 10K MAU, pre-built web components, social login |
| **Auth0** | $0 | 25K MAU, but NO MFA, NO RBAC, no separate environments |

### At 25K users (Year 1 target)

| Provider | Monthly Cost | Notes |
|----------|-------------|-------|
| **Neon Auth** | $0 (still included) | Included up to 1M MAU on paid Neon plans |
| **Firebase Auth** | $0 | Still under 50K free tier |
| **Clerk** | $25 + $300 ($0.02 × 15K overage) = ~$325/mo | Plus $100/mo for MFA add-on if needed |
| **Auth0** | $35-240/mo (Essentials/Professional) | Free tier lacks MFA and RBAC, must upgrade for production features |

### At 100K users (Growth stage)

| Provider | Monthly Cost | Notes |
|----------|-------------|-------|
| **Neon Auth** | $0 (still included) | Auth is bundled with your Neon database cost |
| **Firebase Auth** | ~$275/mo | Tiered MAU pricing kicks in above 50K |
| **Clerk** | $25 + $1,800 = ~$1,825/mo | $0.02 × 90K overage users |
| **Auth0** | $240-800+/mo | Professional tier, costs escalate aggressively |

**Neon Auth's pricing is remarkable.** Auth is included at no additional cost
for all Neon databases up to 1 million MAU. Since you're already using Neon
for your database, auth is essentially free until you hit massive scale.

---

## Feature Comparison (What Actually Matters for Your App)

### Authentication Methods

| Feature | Neon Auth | Firebase Auth | Clerk | Auth0 |
|---------|-----------|---------------|-------|-------|
| Email/password | ✅ | ✅ | ✅ | ✅ |
| Social login (Google, Apple, GitHub) | ✅ | ✅ | ✅ | ✅ |
| Magic links | ✅ | ✅ (email link) | ✅ | ✅ |
| Phone/SMS | ✅ (via plugin) | ✅ ($0.01-0.34/SMS) | ✅ | ✅ |
| Apple Sign-In (required for iOS) | ✅ | ✅ | ✅ | ✅ |
| Passkeys/WebAuthn | ✅ | ✅ (Identity Platform) | ✅ | ✅ |

All four support the auth methods you need. No meaningful difference here.

### Features Critical for Your SaaS

| Feature | Neon Auth | Firebase Auth | Clerk | Auth0 |
|---------|-----------|---------------|-------|-------|
| **MFA/2FA** | ✅ (TOTP, via plugin) | ⚠️ Paid only (Identity Platform) | ⚠️ $100/mo add-on | ⚠️ Paid plans only |
| **RBAC (role-based access)** | ✅ (built-in) | ❌ (build yourself) | ✅ (Pro plan) | ⚠️ Paid plans only |
| **Organizations/teams** | ✅ (via plugin) | ❌ (build yourself) | ✅ ($1/MAO after 100) | ✅ (B2B plans, expensive) |
| **User data in your DB** | ✅ Native — it IS your DB | ❌ Locked in Firebase | ❌ Stored in Clerk's cloud | ❌ Stored in Auth0's cloud |
| **DB branching for auth** | ✅ Auth branches with DB | ❌ | ❌ | ❌ (separate dev/prod tenants) |
| **Row-Level Security** | ✅ Native JWT + RLS | ❌ (no Postgres) | ❌ (separate system) | ❌ (separate system) |
| **Webhook sync needed** | ❌ Not needed — already in DB | ✅ Yes | ✅ Yes | ✅ Yes |
| **Pre-built web UI** | ⚠️ Basic (React SDK) | ⚠️ Firebase UI (dated) | ✅ Excellent | ✅ Good (Universal Login) |
| **Native iOS SDK** | ⚠️ REST API (no native SDK yet) | ✅ Mature Firebase iOS SDK | ✅ Clerk iOS SDK | ✅ Auth0.swift SDK |
| **Native Android SDK** | ⚠️ REST API (no native SDK yet) | ✅ Mature Firebase Android SDK | ✅ Clerk Android SDK | ✅ Auth0 Android SDK |

### The Key Differences That Matter for YOU

**Neon Auth's killer advantage: auth data lives in your database.**

With Clerk, Auth0, or Firebase, your user records live in THEIR system. You
need to sync that data into your Neon database via webhooks. This means:

1. When a user signs up in Clerk, Clerk sends a webhook to your API
2. Your API receives the webhook and creates a user record in your DB
3. If the webhook fails (network issue, your server is down), your DB and
   Clerk are out of sync
4. You need retry logic, deduplication, and a reconciliation process
5. You can't JOIN user data with your app data in a single query without
   first syncing it

With Neon Auth, the user table IS in your Postgres database. You can do:

```sql
-- Direct join: get all items with their owner's name
-- No webhook sync needed, no eventual consistency concerns
SELECT i.name, i.category, u.display_name as owner
FROM items i
JOIN rooms r ON i.room_id = r.id
JOIN homes h ON r.home_id = h.id
JOIN neon_auth.users u ON h.owner_id = u.id
WHERE h.id = 'abc123';
```

This also means when you create a Neon branch for testing, your auth data
branches with it. You can test signup flows, role changes, and permission
logic on a branch without touching production auth state. No other provider
offers this.

**Clerk's killer advantage: pre-built UI components.**

Clerk gives you beautiful, customizable sign-in/sign-up components for React
and Next.js that you drop into your web app and they just work:

```jsx
// This renders a complete sign-in form with social buttons,
// email/password, MFA — all handled by Clerk
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return <SignIn />;
}
```

But you're building native iOS. In SwiftUI, you'd build your own login screens
regardless of which provider you use. Clerk's pre-built components don't help
on native mobile. You'd use Clerk's API to verify credentials, which is the
same thing you'd do with any provider.

**Firebase Auth's killer advantage: mature mobile SDKs.**

Firebase has the most battle-tested iOS and Android SDKs, period. Millions of
apps use them. The integration with Apple Sign-In, Google Sign-In, and phone
auth is seamless. If you've used Firebase before, the SDK is familiar and
well-documented.

But Firebase Auth is authentication-only. It doesn't manage authorization
(roles, permissions, organizations). You'd build all of that yourself. And
your user data lives in Firebase's system, not in your Postgres database,
meaning you need the same webhook sync pattern as Clerk.

**Auth0's killer advantage: enterprise features.**

Auth0 has the deepest enterprise feature set: SAML SSO, HIPAA compliance,
advanced attack protection, and the most granular customization of auth flows
(Actions). If you were selling to enterprises that require SSO with their
corporate identity provider, Auth0 would be the clear choice.

But for a consumer home inventory app, you don't need enterprise SSO. And
Auth0's pricing escalates aggressively — a 1.67x user growth can cause a
15x cost increase due to tier jumps. Multiple reports call this a "growth
penalty."

---

## Neon Auth: Honest Assessment of the Downsides

Neon Auth is newer and less mature than the other options. Here's what you
need to know:

### 1. No Native Mobile SDKs (Yet)

Neon Auth is built on Better Auth, which provides JavaScript/TypeScript SDKs
for web frameworks (Next.js, React, etc.). There is no official Swift SDK or
Kotlin SDK.

For your native iOS app, you would:
- Call Neon Auth's REST API directly from Swift
- Handle token storage in Keychain yourself
- Build your own login/signup screens (you'd do this with any provider)
- Manage session refresh yourself

This is more work than using Firebase's or Clerk's native SDKs, where the
SDK handles most of this. However, the auth flow itself is standard OAuth —
you're exchanging credentials for a JWT, storing it, and sending it with
requests. The pattern is the same regardless of provider.

Example of what the Swift auth code looks like with Neon Auth:

```swift
// NeonAuthClient.swift — custom client for Neon Auth REST API
class NeonAuthClient {
    private let baseURL: String  // Your Neon Auth endpoint

    func signIn(email: String, password: String) async throws -> AuthSession {
        let url = URL(string: "\(baseURL)/api/auth/sign-in/email")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "email": email,
            "password": password
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        // Parse session, store tokens in Keychain
        let session = try JSONDecoder().decode(AuthSession.self, from: data)
        try KeychainHelper.store(session.token, forKey: "auth_token")
        return session
    }

    func signInWithApple(identityToken: Data) async throws -> AuthSession {
        // Similar pattern: send Apple's identity token to your backend,
        // Neon Auth validates it and returns a session
    }
}
```

Compare with Clerk's iOS SDK:

```swift
// Clerk provides a pre-built SDK that handles more of this
import ClerkSDK

let clerk = Clerk.shared
try await clerk.signIn.create(strategy: .identifier("user@email.com", password: "..."))
// Token management is handled by the SDK
```

The Clerk version is less code, but the Neon Auth version isn't dramatically
more complex. You're writing a thin HTTP client wrapper that you'll build once
and reuse everywhere.

### 2. Newer, Smaller Community

Neon Auth was rebuilt on Better Auth in late 2025. It's actively developed and
Neon is investing heavily in it, but:
- Fewer Stack Overflow answers and tutorials compared to Clerk, Auth0, Firebase
- The SDK API has changed (they just released a major update in January 2026)
- Edge cases and bugs are more likely in newer software
- Better Auth itself has a growing community (9K+ GitHub stars) but is smaller
  than Firebase or Auth0's ecosystems

### 3. Tied to Neon

If you ever wanted to leave Neon for a different database host (RDS, Supabase,
self-hosted), you'd need to migrate auth too. With Clerk, Auth0, or Firebase,
auth is independent of your database.

However, since your architecture already depends on Neon and you'd need to
migrate the database regardless, this is less of an issue. Auth migration
would be part of the database migration.

### 4. Less Customizable Auth Flows (For Now)

Auth0's "Actions" and Clerk's "Hooks" let you run custom code during the auth
flow (e.g., block signups from certain email domains, enrich user profiles
on first login, trigger workflows on password reset). Neon Auth / Better Auth
has hooks and middleware, but the ecosystem of pre-built integrations is
smaller.

---

## Migration: Can You Switch Providers Later?

Yes, but it's painful. Here's why and how.

### What Makes Auth Migration Hard

**The core problem: user passwords.**

When a user creates an account with a password, the provider stores a hash
of that password (a one-way mathematical transformation). You can never get
the original password back — that's the whole point of hashing.

When you migrate to a new auth provider, you can transfer email addresses,
names, and profile data. But you CANNOT transfer password hashes between
providers because each provider uses different hashing algorithms, salts,
and configurations.

This means: after migration, every user who signed up with email/password
needs to reset their password. Users who signed up with social login (Google,
Apple) are unaffected — they just re-authorize with the social provider on
the new system.

### Migration Strategy (Works for Any Provider Switch)

1. **Set up the new auth provider alongside the old one.**
2. **Migrate user records** (email, name, profile data) to the new system.
   Mark these as "migrated, needs password reset."
3. **Update your API** to accept tokens from both providers during transition.
4. **On next login attempt:**
   - If user has a social login → redirect to the new provider's social
     login flow. Seamless, user notices nothing.
   - If user has email/password → try the new provider first. If it fails
     (because the password hash wasn't migrated), fall back to the old
     provider. If the old provider succeeds, immediately create the account
     on the new provider with the same password, then invalidate the old one.
   - This is called "lazy migration" — users are migrated one by one as
     they log in naturally.
5. **After 90 days**, most active users will have been lazily migrated. Send
   a password reset email to remaining users who haven't logged in.
6. **Shut down the old provider.**

### Migration Difficulty by Provider

| From → To | Difficulty | Notes |
|-----------|-----------|-------|
| Clerk → Neon Auth | Medium | Export user data via Clerk API, import into Postgres. Lazy migration for passwords. |
| Auth0 → Neon Auth | Medium | Auth0 has a user export feature. Same lazy migration pattern. |
| Firebase → Neon Auth | Medium-Hard | Firebase allows password hash export (scrypt format), which Better Auth may be able to import directly. |
| Neon Auth → Clerk | Easy | User data is already in your Postgres DB, export and import via Clerk API. |
| Neon Auth → Auth0 | Easy | Same as above. Better Auth uses bcrypt hashing, which Auth0 supports for import. |
| Any → Any | Medium | The pattern is always the same: export records, lazy migration for passwords. |

**The key insight: migration is always possible but always painful.** The best
strategy is to choose well upfront and minimize the chance of needing to
migrate. That said, none of these providers will lock you in permanently.
The user data is yours; the migration work is in the password hash handling
and updating your API middleware.

---

## Recommendation

### If You Want Maximum Long-Term Value: Neon Auth

**Why:** Auth data in your database eliminates an entire category of problems
(webhook sync, eventual consistency, cross-system joins). It's included free
with Neon up to 1M MAU, saving you $300-1,800/month compared to Clerk at
scale. It branches with your database for testing. It works naturally with
Row-Level Security.

**The tradeoff:** More upfront work on the iOS side (build your own auth
client ~200 lines of Swift), smaller community, newer product. You're betting
that Neon Auth matures well over the next 1-2 years. Given Neon's investment
(Databricks acquisition) and Better Auth's growth trajectory, this is a
reasonable bet.

**Best for:** Developers who want full control, are comfortable building a
thin auth client for mobile, and value having auth data in their database.

### If You Want Fastest iOS Development: Clerk

**Why:** Best mobile SDKs of the realistic options (Auth0 has good SDKs too
but costs more). Pre-built web components speed up the Next.js side. Good
documentation, active community. 10K MAU free tier is enough for launch.

**The tradeoff:** Gets expensive at scale ($325/mo at 25K users, $1,825/mo
at 100K users). Webhook sync adds complexity. User data lives outside your
database. MFA is an extra $100/mo add-on.

**Best for:** Developers who want to move fast and are comfortable paying
more as the product grows.

### If You Want the Safest Bet: Firebase Auth

**Why:** Most mature mobile SDKs, backed by Google, used by millions of apps.
50K MAU free tier is the most generous for launch. Rock-solid reliability.

**The tradeoff:** No RBAC, no organization management, no advanced MFA in the
free tier. You build authorization yourself. User data is in Firebase, not
your Postgres DB. Tight coupling to Google ecosystem makes future migration
harder. The Identity Platform upgrade (needed for advanced features) has
confusing pricing.

**Best for:** Developers who want proven reliability and don't need built-in
RBAC or organizations.

### My Updated Recommendation: Neon Auth

For your specific situation — already on Neon, building native iOS (so pre-built
web components are less valuable), planning for tens of thousands of users
(where Clerk/Auth0 costs become significant), and building a multi-tenant SaaS
(where having auth data in the database simplifies everything) — **Neon Auth
is the strongest choice.**

The cost savings alone are dramatic: $0/month for auth vs. $325-1,825/month
for Clerk at your target scale. And the architectural benefit of auth data
living in your Postgres database is genuinely significant for a multi-tenant
app with sharing and collaboration features.

The main risk is maturity. Neon Auth is newer. If you're uncomfortable with
that, Clerk is the next best option — just budget for the costs at scale.

Either way, build your API's auth middleware as a thin abstraction layer:

```typescript
// middleware/authenticate.ts — provider-agnostic

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return reply.status(401).send({ code: 'UNAUTHORIZED' });
  }

  // This is the ONLY place that knows about your auth provider.
  // Swap Neon Auth for Clerk by changing only this function.
  const user = await verifyToken(token);
  // With Neon Auth: decode JWT, verify signature against Neon Auth JWKS
  // With Clerk: call Clerk's verifyToken() SDK function
  // With Auth0: verify JWT against Auth0 JWKS endpoint

  if (!user) {
    return reply.status(401).send({ code: 'TOKEN_EXPIRED' });
  }

  req.user = user;
}
```

If you isolate the provider-specific code behind this abstraction, switching
providers later means changing one file, not refactoring your entire API.
