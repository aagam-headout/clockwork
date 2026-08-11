/**
 * Stands in for the `server-only` package under vitest.
 *
 * `server-only` exists to make a client bundle fail at build time if it
 * imports a server module; it has no runtime behaviour and Next resolves it
 * itself. Vitest doesn't, so without this stub every module carrying the
 * marker is unimportable in a test. Wired up in `vitest.config.mts`.
 */
export {};
