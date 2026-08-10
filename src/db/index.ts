import {
  drizzle as drizzleNeon,
  type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

/*
 * Two drivers, one `db`:
 *
 * - Neon (production, and any `*.neon.tech` URL) goes over neon-http, which
 *   is the right shape for serverless — no socket to keep alive between
 *   invocations. Pooled URL for app traffic; migrations use
 *   DATABASE_URL_UNPOOLED (see drizzle.config.ts).
 * - Anything else — a Postgres container on your laptop — goes over a normal
 *   TCP pool. Local development doesn't need the Neon service at all.
 */
const url = process.env.DATABASE_URL!;
const isNeon =
  /neon\.(tech|build)/i.test(url) || url.startsWith("postgres://neon");

declare global {
  // Next dev reloads modules on every edit; without this the pool is
  // recreated each time and Postgres runs out of connections.
  var __clockworkPool: Pool | undefined;
}

function localPool(): Pool {
  globalThis.__clockworkPool ??= new Pool({ connectionString: url, max: 5 });
  return globalThis.__clockworkPool;
}

/*
 * The two drivers expose the same query builders; the cast keeps one static
 * type for every call site instead of a union nobody can call.
 */
export const db = (
  isNeon
    ? drizzleNeon(neon(url), { schema })
    : drizzlePg(localPool(), { schema })
) as NeonHttpDatabase<typeof schema>;
