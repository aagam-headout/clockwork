import { describe, expect, it, vi } from "vitest";

// The gate's pure helpers are what these cover. `requiredToolkits` and
// `checkConnections` reach the catalog and the database respectively; the
// classification logic below is where the interesting mistakes live.
vi.mock("@/lib/composio", () => ({
  noAuthToolkitSlugs: async () => new Set(["composio_search"]),
}));
vi.mock("@/lib/data/connections", () => ({
  activeToolkitSlugs: async () => new Set<string>(),
}));

const { isAuthError, toolkitForSlug, checkConnectionsWith, requiredToolkits } =
  await import("./connection-gate");

describe("isAuthError", () => {
  it("recognises how providers actually phrase it", () => {
    for (const message of [
      "Request failed with status 401",
      "403 Forbidden",
      "invalid_grant",
      "Invalid API key provided",
      "The access token expired",
      "No active connection found for this user",
      "Please re-authenticate the connected account",
      "permission denied",
    ]) {
      expect(isAuthError(message), message).toBe(true);
    }
  });

  it("does not claim ordinary failures are auth failures", () => {
    for (const message of [
      "429 Too Many Requests",
      "channel_not_found",
      "500 Internal Server Error",
      "socket hang up",
      null,
      undefined,
      "",
    ]) {
      expect(isAuthError(message), String(message)).toBe(false);
    }
  });
});

describe("toolkitForSlug", () => {
  it("attributes a tool to its toolkit", () => {
    expect(toolkitForSlug("SLACK_SEND_MESSAGE", ["slack"])).toBe("slack");
  });

  it("prefers the longest match", () => {
    // The reason this sorts: a plain scan would attribute a Calendar tool to
    // `google` and mark the wrong connection expired.
    expect(
      toolkitForSlug("GOOGLE_CALENDAR_LIST_EVENTS", [
        "google",
        "google_calendar",
      ]),
    ).toBe("google_calendar");
  });

  it("returns null for a tool from a toolkit the run didn't request", () => {
    expect(toolkitForSlug("NOTION_SEARCH", ["slack", "gmail"])).toBeNull();
  });
});

describe("checkConnectionsWith", () => {
  it("passes when everything required is active", () => {
    expect(
      checkConnectionsWith(new Set(["slack", "gmail"]), ["slack"]),
    ).toEqual({ ok: true });
  });

  it("passes when nothing is required", () => {
    expect(checkConnectionsWith(new Set(), [])).toEqual({ ok: true });
  });

  it("names exactly what is missing", () => {
    const result = checkConnectionsWith(new Set(["slack"]), [
      "slack",
      "notion",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked).toEqual(["notion"]);
      expect(result.reason).toContain("notion");
    }
  });
});

describe("requiredToolkits", () => {
  it("excludes no-auth toolkits", () => {
    // Web search needs no connected account; requiring one would block every
    // workflow that uses it.
    return expect(
      requiredToolkits({ toolkits: ["composio_search", "slack"], deliver: [] }),
    ).resolves.toEqual(["slack"]);
  });

  it("includes toolkits implied by delivery targets", () => {
    // `slack` is not in `toolkits`, but a Slack DM still needs it — this is
    // exactly the case the old code missed.
    return expect(
      requiredToolkits({
        toolkits: ["composio_search"],
        deliver: [{ type: "dashboard" }, { type: "slack_dm" }],
      }),
    ).resolves.toEqual(["slack"]);
  });
});
