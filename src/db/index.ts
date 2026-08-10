import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Pooled connection — correct for serverless/Fluid Compute app traffic.
// Migrations use DATABASE_URL_UNPOOLED instead (see drizzle.config.ts).
const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
