import { createNeonAuth } from "@neondatabase/auth/next/server";

const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL;
const NEON_AUTH_COOKIE_SECRET = process.env.NEON_AUTH_COOKIE_SECRET;

if (!NEON_AUTH_BASE_URL || !NEON_AUTH_COOKIE_SECRET) {
  throw new Error(
    "Missing required env vars: NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET"
  );
}

export const auth = createNeonAuth({
  baseUrl: NEON_AUTH_BASE_URL,
  cookies: {
    secret: NEON_AUTH_COOKIE_SECRET,
  },
});
