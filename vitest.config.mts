import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Same `@/*` alias as tsconfig, so tests import modules the way the app does.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /*
       * `server-only` is a build-time guard Next resolves itself — it has no
       * runtime implementation to import, so under vitest it's an unresolvable
       * bare specifier. Every server module that carries the marker would
       * otherwise be untestable.
       */
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
