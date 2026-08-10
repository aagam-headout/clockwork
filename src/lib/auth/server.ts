import { createNeonAuth } from "@neondatabase/auth/next/server";

// Single entry point for all server-side auth: API handler, middleware, and
// getSession() in server components/actions all go through this instance.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
