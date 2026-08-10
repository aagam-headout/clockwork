import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

// Single-user personal tool: one Composio account, one logical "user".
// Every connected account, run, and tool call in this app is scoped to
// this fixed id — there is no multi-tenant user system to plumb through.
export const COMPOSIO_USER_ID = "aagam";

export const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider(),
});

export { TOOLKITS, type Toolkit } from "@/lib/toolkits";

/**
 * Finds an existing Composio-managed auth config for a toolkit, or creates
 * one. `link()` (not the deprecated `initiate()`) is used for the actual
 * OAuth redirect — see https://docs.composio.dev/docs/changelog/2026/04/24.
 */
async function getOrCreateAuthConfigId(toolkit: string): Promise<string> {
  const existing = await composio.authConfigs.list({ toolkit });
  if (existing.items[0]?.id) return existing.items[0].id;

  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
    name: `${toolkit} (my-workflows)`,
  });
  return created.id;
}

/**
 * Starts a connection for `toolkit` and returns the URL to redirect the
 * browser to. Composio redirects back to `callbackUrl` once the user
 * finishes OAuth on their hosted page.
 */
export async function initiateConnection(toolkit: string, callbackUrl: string) {
  const authConfigId = await getOrCreateAuthConfigId(toolkit);
  const connectionRequest = await composio.connectedAccounts.link(
    COMPOSIO_USER_ID,
    authConfigId,
    { callbackUrl, allowMultiple: true }
  );
  return {
    connectedAccountId: connectionRequest.id,
    redirectUrl: connectionRequest.redirectUrl,
  };
}

export async function listConnectedAccounts() {
  const res = await composio.connectedAccounts.list({ userIds: [COMPOSIO_USER_ID] });
  return res.items;
}
