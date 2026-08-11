import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The delete half of `syncEventTriggers` is the part that never existed, and
 * the case it has to get right is the one a refcount would get wrong: two
 * workflows listening to the same trigger, one of them removed.
 *
 * Everything below the function is stubbed — this is about the reconciliation
 * decision, not about Drizzle or Composio.
 */

type WorkflowRow = { slugs: string[] };
type InstanceRow = {
  id: string;
  triggerSlug: string;
  composioTriggerId: string | null;
};

const state = {
  workflows: [] as WorkflowRow[],
  instances: [] as InstanceRow[],
};

const created: string[] = [];
const deleted: string[] = [];
const dbDeleted: string[] = [];

/**
 * Minimal stand-in for the two shapes `syncEventTriggers` uses: a select that
 * resolves to rows, and a delete that records what it removed.
 */
vi.mock("@/db", () => {
  const selectResult = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => Promise.resolve(rows),
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    };
    return chain;
  };

  return {
    db: {
      select: (columns?: Record<string, unknown>) =>
        // The instances query selects everything; the workflow query projects
        // a single `slugs` column.
        selectResult(
          columns && "slugs" in columns ? state.workflows : state.instances,
        ),
      delete: () => ({
        where: (predicate: { __id?: string }) => {
          dbDeleted.push(predicate?.__id ?? "?");
          return Promise.resolve();
        },
      }),
      insert: () => ({
        values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
      }),
    },
  };
});

vi.mock("@/db/schema", () => ({
  triggerInstances: {
    userId: "user_id",
    triggerSlug: "trigger_slug",
    id: "id",
  },
  workflows: {
    userId: "user_id",
    enabled: "enabled",
    triggerType: "trigger_type",
    eventTriggers: "event_triggers",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (column: unknown, value: unknown) =>
    // The only predicate the assertions care about is the delete's row id.
    column === "id" ? { __id: String(value) } : { eq: [column, value] },
}));

vi.mock("@/lib/composio", () => ({
  composio: {
    triggers: {
      setWebhookSubscription: async () => undefined,
      listTypes: async () => ({ items: [] }),
      create: async (_user: string, slug: string) => {
        created.push(slug);
        return { triggerId: `ti_${slug}` };
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  },
  composioUserId: (id: string) => `cw_${id}`,
  composioErrorMessage: (err: unknown) => String(err),
}));

vi.mock("@/lib/data/connections", () => ({
  activeToolkitSlugs: async () => new Set<string>(),
  getUserConnection: async () => null,
}));

const { syncEventTriggers } = await import("./triggers");

const USER = "9f1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

beforeEach(() => {
  // `ensureWebhookSubscription` reads this and throws without it.
  process.env.APP_URL = "https://clockwork.test";
  state.workflows = [];
  state.instances = [];
  created.length = 0;
  deleted.length = 0;
  dbDeleted.length = 0;
});

describe("syncEventTriggers", () => {
  it("deletes a trigger once no workflow wants it", async () => {
    state.workflows = [];
    state.instances = [
      {
        id: "row-1",
        triggerSlug: "SLACK_NEW_MESSAGE",
        composioTriggerId: "ti_slack",
      },
    ];

    await syncEventTriggers(USER);

    expect(deleted).toEqual(["ti_slack"]);
    expect(dbDeleted).toEqual(["row-1"]);
  });

  it("keeps a trigger a second workflow still uses", async () => {
    // The case a naive "delete when this workflow stops using it" would break.
    state.workflows = [
      { slugs: ["SLACK_NEW_MESSAGE"] },
      { slugs: ["SLACK_NEW_MESSAGE", "GITHUB_ISSUE"] },
    ];
    state.instances = [
      {
        id: "row-1",
        triggerSlug: "SLACK_NEW_MESSAGE",
        composioTriggerId: "ti_slack",
      },
    ];

    await syncEventTriggers(USER);

    expect(deleted).toEqual([]);
    expect(dbDeleted).toEqual([]);
  });

  it("creates what is wanted and not yet registered", async () => {
    state.workflows = [{ slugs: ["GITHUB_ISSUE"] }];
    state.instances = [];

    await syncEventTriggers(USER);

    expect(created).toEqual(["GITHUB_ISSUE"]);
  });

  it("does nothing at all when there is nothing on either side", async () => {
    await syncEventTriggers(USER);
    expect(created).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
