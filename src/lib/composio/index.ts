/*
 * The Composio surface, in one import.
 *
 * Split by concern rather than kept in one file because the pieces have very
 * different scopes: the catalog is app-wide and cached globally, accounts and
 * triggers are per user, and tool schemas are global data reached through a
 * per-user call. Keeping that boundary visible in the file layout is what
 * stops a per-user value being cached in a global map by accident.
 */
export { composio, composioErrorMessage } from "./client";
export { composioUserId, appUserIdFromComposio } from "./identity";
export {
  getToolkitCatalog,
  invalidateToolkitCatalog,
  searchToolkits,
  toolkitIsNoAuth,
  toolkitExists,
  noAuthToolkitSlugs,
  type ToolkitSummary,
} from "./catalog";
export {
  getOrCreateAuthConfigId,
  initiateConnection,
  listConnectedAccounts,
  getConnectedAccount,
  refreshConnectedAccount,
  waitForActiveAccount,
  deleteConnectedAccount,
} from "./accounts";
export { getToolsFor, clearToolCache } from "./tools";
