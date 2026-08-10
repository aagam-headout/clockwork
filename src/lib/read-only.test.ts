import { describe, expect, it } from "vitest";
import {
  buildToolFilter,
  deliverToolkits,
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
    // The whole point of the deny-wins ordering: a read verb somewhere in the
    // name used to be enough to let these through.
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

  it("allows any tool when read-only is off", () => {
    const allowed = buildToolFilter(slackDm, [], [], false);
    expect(allowed("SLACK_DELETE_MESSAGE")).toBe(true);
    expect(allowed("GITHUB_CREATE_ISSUE")).toBe(true);
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
