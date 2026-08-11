import { describe, expect, it } from "vitest";
import { appUserIdFromComposio, composioUserId } from "./identity";

const USER = "9f1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

describe("composio identity", () => {
  it("round-trips a user id", () => {
    expect(appUserIdFromComposio(composioUserId(USER))).toBe(USER);
  });

  it("rejects ids from another namespace", () => {
    // A preview deploy sharing COMPOSIO_API_KEY, or the fixed id this app used
    // while it was single-user. Both must resolve to null so the webhook fails
    // closed rather than fanning an event out to the wrong account.
    expect(appUserIdFromComposio(`other_${USER}`)).toBeNull();
    expect(appUserIdFromComposio("aagam")).toBeNull();
  });

  it("rejects a well-namespaced id that isn't a uuid", () => {
    expect(appUserIdFromComposio("cw_not-a-uuid")).toBeNull();
    expect(appUserIdFromComposio("cw_")).toBeNull();
  });
});
