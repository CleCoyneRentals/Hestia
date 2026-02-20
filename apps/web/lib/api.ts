"use client";

import { authClient } from "@/lib/auth/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Authenticated fetch wrapper. Automatically retrieves a short-lived JWT
 * from Neon Auth and attaches it as a Bearer token to all API requests.
 *
 * Usage:
 *   const res = await apiFetch("/api/homes");
 *   const data = await res.json();
 */
export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const { data } = await authClient.token();

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
      ...(data?.token ? { Authorization: `Bearer ${data.token}` } : {}),
    },
  });
}
