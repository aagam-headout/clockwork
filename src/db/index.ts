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
 * - Neon (production, any `*.neon.tech` URL) uses neon-http — no socket to
 *   keep alive between invocations. Pooled URL for app traffic; migrations
 *   use DATABASE_URL_UNPOOLED (see drizzle.config.ts).
 * - Anything else (a local Postgres container) uses a normal TCP pool — no
 *   Neon service needed locally.
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
 * Both drivers expose the same query builders; the cast keeps one static
 * type per call site instead of an unusable union.
 */
export const db = (
  isNeon
    ? drizzleNeon(neon(url), { schema })
    : drizzlePg(localPool(), { schema })
) as NeonHttpDatabase<typeof schema>;
