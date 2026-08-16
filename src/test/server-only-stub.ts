/**
 * Stands in for the `server-only` package under vitest.
 *
 * `server-only` exists to fail a client bundle at build time if it imports a
 * server module; it has no runtime behaviour, and Next resolves it itself.
 * Vitest doesn't, so without this stub any module carrying the marker is
 * unimportable in tests. Wired up in `vitest.config.mts`.
 */
export {};
