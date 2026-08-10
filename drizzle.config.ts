import { defineConfig } from "drizzle-kit";

// Migrations require a direct (non-pooled) connection — PgBouncer transaction
// mode doesn't support the session-level statements drizzle-kit issues.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
});
