/*
 * The Composio surface, in one import.
 *
 * Split by concern, not kept in one file, because scopes differ: the catalog
 * is app-wide and cached globally, accounts and triggers are per user, and
 * tool schemas are global data reached through a per-user call. Keeping that
 * boundary visible in the file layout stops a per-user value from being
 * cached in a global map by accident.
 */
export { composio, composioErrorMessage } from "./client";
export { composioUserId, appUserIdFromComposio } from "./identity";
export {
  getToolkitCatalog,
  invalidateToolkitCatalog,
  searchToolkits,
  toolkitIsNoAuth,
  toolkitManagedAuthScheme,
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
