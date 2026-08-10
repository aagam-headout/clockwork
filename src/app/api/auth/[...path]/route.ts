import { auth } from "@/lib/auth/server";

// Proxies Managed Better Auth (sign-in, sign-up, session, sign-out, etc.)
// through this Next.js app.
export const { GET, POST } = auth.handler();
