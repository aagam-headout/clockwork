import { describe, expect, it } from "vitest";
import {
  buildToolFilter,
  deliverToolkits,
  isDestructiveToolSlug,
  isReadOnlyToolSlug,
  type DeliverTarget,
} from "./read-only";

describe("isReadOnlyToolSlug", () => {
  it("allows read verbs", () => {
    for (const slug of [
      "GITHUB_LIST_REPOS",
      "GMAIL_FETCH_EMAILS",
      "SLACK_LIST_CHANNELS",
      "NOTION_SEARCH",
      "GOOGLECALENDAR_GET_EVENT",
    ]) {
      expect(isReadOnlyToolSlug(slug), slug).toBe(true);
    }
  });

  it("blocks write verbs", () => {
    for (const slug of [
      "SLACK_SEND_MESSAGE",
      "GITHUB_CREATE_ISSUE",
      "NOTION_UPDATE_PAGE",
      "GMAIL_DELETE_DRAFT",
    ]) {
      expect(isReadOnlyToolSlug(slug), slug).toBe(false);
    }
  });

  it("treats a mixed read/write slug as a write", () => {
    // The whole point of deny-wins: a read verb anywhere in the name used to
    // be enough to let these through.
    expect(isReadOnlyToolSlug("GITHUB_GET_OR_CREATE_LABEL")).toBe(false);
    expect(isReadOnlyToolSlug("NOTION_SEARCH_AND_UPDATE_PAGE")).toBe(false);
  });

  it("always allows the no-auth search toolkit", () => {
    expect(isReadOnlyToolSlug("COMPOSIO_SEARCH_TAVILY_SEARCH")).toBe(true);
  });

  it("blocks slugs with no recognised verb at all", () => {
    expect(isReadOnlyToolSlug("GITHUB_ISSUES")).toBe(false);
  });
});

describe("isDestructiveToolSlug", () => {
  it("flags irreversible verbs", () => {
    for (const slug of [
      "SLACK_DELETE_MESSAGE",
      "GMAIL_TRASH_MESSAGE",
      "GITHUB_REMOVE_COLLABORATOR",
      "NOTION_ARCHIVE_AND_DELETE_PAGE",
    ]) {
      expect(isDestructiveToolSlug(slug), slug).toBe(true);
    }
  });

  it("leaves ordinary writes and reads alone", () => {
    for (const slug of [
      "GITHUB_CREATE_ISSUE",
      "NOTION_UPDATE_PAGE",
      "SLACK_SEND_MESSAGE",
      "GMAIL_FETCH_EMAILS",
      "COMPOSIO_SEARCH_TAVILY_SEARCH",
    ]) {
      expect(isDestructiveToolSlug(slug), slug).toBe(false);
    }
  });
});

describe("buildToolFilter", () => {
  const slackDm: DeliverTarget[] = [
    { type: "dashboard" },
    { type: "slack_dm" },
  ];

  it("grants exactly the write tool a delivery target needs", () => {
    const allowed = buildToolFilter(slackDm);
    expect(allowed("SLACK_SEND_MESSAGE")).toBe(true);
    expect(allowed("SLACK_DELETE_MESSAGE")).toBe(false);
  });

  it("grants no write tools without a delivery target", () => {
    const allowed = buildToolFilter([{ type: "dashboard" }]);
    expect(allowed("SLACK_SEND_MESSAGE")).toBe(false);
  });

  it("narrows to the allow list when one is given", () => {
    const allowed = buildToolFilter([], ["GITHUB_LIST_*"]);
    expect(allowed("GITHUB_LIST_REPOS")).toBe(true);
    expect(allowed("GITHUB_GET_REPO")).toBe(false);
  });

  it("allows non-destructive writes when read-only is off", () => {
    const allowed = buildToolFilter(slackDm, [], [], false);
    expect(allowed("GITHUB_CREATE_ISSUE")).toBe(true);
    expect(allowed("NOTION_UPDATE_PAGE")).toBe(true);
  });

  it("still blocks destructive tools with read-only off", () => {
    const allowed = buildToolFilter(slackDm, [], [], false);
    expect(allowed("SLACK_DELETE_MESSAGE")).toBe(false);
    expect(allowed("GMAIL_TRASH_MESSAGE")).toBe(false);
  });

  it("takes an exact allow-list entry as the opt-in for a destructive tool", () => {
    const allowed = buildToolFilter(
      slackDm,
      ["SLACK_DELETE_MESSAGE", "SLACK_*"],
      [],
      false,
    );
    expect(allowed("SLACK_DELETE_MESSAGE")).toBe(true);
    // Swept in by the wildcard, but never named — a broad grant isn't consent
    // to an unattended delete.
    expect(allowed("SLACK_REMOVE_REACTION")).toBe(false);
    expect(allowed("SLACK_SEND_MESSAGE")).toBe(true);
  });

  it("keeps the deny list ahead of an exact destructive opt-in", () => {
    const allowed = buildToolFilter(
      [],
      ["GMAIL_DELETE_DRAFT"],
      ["GMAIL_DELETE_DRAFT"],
      false,
    );
    expect(allowed("GMAIL_DELETE_DRAFT")).toBe(false);
  });

  it("still honours the deny list with read-only off", () => {
    const allowed = buildToolFilter([], [], ["SLACK_*"], false);
    expect(allowed("SLACK_DELETE_MESSAGE")).toBe(false);
    expect(allowed("GITHUB_CREATE_ISSUE")).toBe(true);
  });

  it("lets the deny list win over everything", () => {
    const allowed = buildToolFilter(
      slackDm,
      [],
      ["SLACK_SEND_MESSAGE", "GITHUB_LIST_*"],
    );
    expect(allowed("SLACK_SEND_MESSAGE")).toBe(false);
    expect(allowed("GITHUB_LIST_REPOS")).toBe(false);
    expect(allowed("GMAIL_FETCH_EMAILS")).toBe(true);
  });
});

describe("deliverToolkits", () => {
  it("pulls in the toolkits its targets need, once each", () => {
    expect(
      deliverToolkits([
        { type: "dashboard" },
        { type: "slack_dm" },
        { type: "slack_channel", channel: "#ops" },
        { type: "email", to: "a@b.c" },
        { type: "webhook", url: "https://example.com" },
      ]),
    ).toEqual(["slack", "gmail"]);
  });
});
