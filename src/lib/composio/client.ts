import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

/*
 * Constructed on first use, not at import. The SDK throws when
 * COMPOSIO_API_KEY is missing, and eagerly constructing it meant that a
 * missing key took down every page that transitively imports this module —
 * including ones that never touch Composio. Lazily, a missing key fails only
 * the call that actually needed it.
 */
let client: Composio<VercelProvider> | null = null;

function getClient(): Composio<VercelProvider> {
  client ??= new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    provider: new VercelProvider(),
  });
  return client;
}

export const composio = new Proxy({} as Composio<VercelProvider>, {
  get(_target, prop, receiver) {
    const instance = getClient();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Digs the human-readable message out of a Composio SDK error. */
export function composioErrorMessage(err: unknown): string {
  const body = (err as { error?: { error?: { message?: string } } })?.error
    ?.error;
  if (body?.message) return body.message;
  return err instanceof Error ? err.message : String(err);
}
