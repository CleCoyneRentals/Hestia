import type { UserJSON } from '@clerk/backend';
import type { WebhookEvent } from '@clerk/fastify/webhooks';

export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
  email?: string;
}

export interface RequestClaims {
  email?: unknown;
  email_address?: unknown;
  [key: string]: unknown;
}

export interface ClerkIdentity {
  clerkUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  lastLoginAt: Date | null;
}

export interface AuthSyncResult {
  id: string;
  clerkUserId: string;
  email: string;
}

export type ClerkWebhookEvent = Extract<
  WebhookEvent,
  { type: 'user.created' | 'user.updated' | 'user.deleted' }
>;

export type ClerkUserWebhookData = UserJSON;
