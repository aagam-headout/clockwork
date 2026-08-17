import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTableName } from "drizzle-orm";

/*
 * Executor tests with a fake `db` and a stub model.
 *
 * The thing under test is not the agent loop — it's what the executor writes
 * down about a run, the only record anyone ever sees. The cross-run hash is
 * the sharpest case: committing one for a run that never delivered a digest
 * makes the *next* run report "unchanged" and silently drop real items, at
 * 6am.
 */

type ChainState = {
  op: "select" | "insert" | "update";
  table?: string;
  values?: unknown;
};

const calls: ChainState[] = [];
/** Rows the fake db hands back, keyed "op:table", consumed in order. */
const queued = new Map<string, unknown[][]>();

function queue(key: string, rows: unknown[]) {
  const list = queued.get(key) ?? [];
  list.push(rows);
  queued.set(key, list);
}

function nextRows(state: ChainState): unknown[] {
  const list = queued.get(`${state.op}:${state.table}`);
  return list?.shift() ?? [];
}

function makeChain(state: ChainState) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const rows = nextRows(state);
          return (
            onOk: (v: unknown) => unknown,
            onErr?: (e: unknown) => unknown,
          ) => Promise.resolve(rows).then(onOk, onErr);
        }
        return (...args: unknown[]) => {
          if (prop === "from" || prop === "into") {
            state.table = getTableName(args[0] as never);
          }
          if (prop === "values" || prop === "set") state.values = args[0];
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function start(op: ChainState["op"], table?: unknown) {
  const state: ChainState = {
    op,
    table: table ? getTableName(table as never) : undefined,
  };
  calls.push(state);
  return makeChain(state);
}

vi.mock("@/db", () => ({
  db: {
    select: () => start("select"),
    insert: (table: unknown) => start("insert", table),
    update: (table: unknown) => start("update", table),
  },
}));

const generateText = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateText(...args),
  };
});

const writeToolHash = vi.fn();
vi.mock("@/lib/data/tool-hashes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/tool-hashes")>(
    "@/lib/data/tool-hashes",
  );
  return {
    canonicalHash: actual.canonicalHash,
    readToolHash: async () => null,
    writeToolHash: (...args: unknown[]) => writeToolHash(...args),
  };
});

const getToolsFor = vi.fn();
vi.mock("@/lib/composio", () => ({
  getToolsFor: (...args: unknown[]) => getToolsFor(...args),
}));

vi.mock("@/lib/provider", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/provider")>("@/lib/provider");
  return { ...actual, resolveModelForUser: async () => ({}) };
});

vi.mock("@/lib/run-cost", () => ({
  runCostUsd: async () => 0,
  toCostColumn: () => null,
}));

const isAuthError = vi.fn(() => false);
vi.mock("@/lib/connection-gate", async () => {
  /*
   * `isFailure` comes from the real module, not a stub.
   *
   * It decides whether a tool result counts as a failure — the thing these
   * tests are about — so a hand-written stand-in would test the stub. It's
   * also imported by `wrap-tools.ts`, so omitting it here makes it
   * `undefined` at every call site and every run dies in the outer catch as
   * a bare `error`, which is how this suite silently broke.
   */
  const actual = await vi.importActual<typeof import("@/lib/connection-gate")>(
    "@/lib/connection-gate",
  );
  return {
    checkConnections: async () => ({ ok: true }),
    requiredToolkits: async () => [],
    isAuthError: (...args: unknown[]) => isAuthError(...(args as [])),
    toolkitForSlug: () => "gmail",
    isFailure: actual.isFailure,
  };
});

vi.mock("@/lib/data/connections", () => ({
  markConnectionStatus: async () => undefined,
}));

import {
  deliveryStatusFrom,
  executeRun,
  NO_UPDATES,
  retryPendingDeliveries,
} from "./executor";
import { outputs, runs, runSteps, workflows } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { MAX_QUERIES_PER_RUN } from "@/lib/agent/wrap-tools";

/** Overrides the queued workflow row a test's `executeRun` will read back. */
function queueWorkflow(overrides: Record<string, unknown>) {
  queued.set(`select:${getTableName(workflows)}`, [
    [{ ...workflow, ...overrides }],
  ]);
}

const RUN_ID = "00000000-0000-0000-0000-0000000000aa";

const workflow = {
  id: "00000000-0000-0000-0000-0000000000bb",
  userId: "user-1",
  slug: "digest",
  name: "Digest",
  goal: "summarise my mail",
  cron: "0 6 * * *",
  timezone: "UTC",
  model: "claude-sonnet-4",
  maxSteps: 5,
  toolkits: ["gmail"],
  deliver: [],
  allowTools: [],
  denyTools: [],
  readOnly: true,
  enabled: true,
  connectionFailures: 0,
};

/** A payload comfortably over the handle threshold. */
const bigPayload = {
  items: Array.from({ length: 200 }, (_, i) => ({
    id: `${i}`,
    body: "y".repeat(50),
  })),
};

function externalSteps(count: number) {
  return Array.from({ length: count }, () => ({
    toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS" }],
  }));
}

/** The values written by the last `update(runs)` — the run's verdict. */
function runVerdict() {
  const updates = calls.filter((c) => c.op === "update" && c.table === "runs");
  return updates.at(-1)?.values as {
    status?: string;
    error?: string | null;
    errorCode?: string | null;
  };
}

/** The values written by the last `update(workflows)` call. */
function workflowUpdate() {
  const updates = calls.filter(
    (c) => c.op === "update" && c.table === getTableName(workflows),
  );
  return updates.at(-1)?.values as
    { lastRunAt?: Date; connectionFailures?: number } | undefined;
}

/** Drives a degraded run: fetches, then exhausts the local query budget. */
async function driveDegraded(
  tools: Record<
    string,
    { execute: (a: unknown, c: unknown) => Promise<unknown> }
  >,
) {
  const descriptor = (await tools.GMAIL_FETCH_EMAILS.execute({}, {})) as {
    handle: string;
  };
  for (let i = 0; i < MAX_QUERIES_PER_RUN + 1; i++) {
    await tools.query.execute(
      { handle: descriptor.handle, path: "items", count: true },
      {},
    );
  }
}

/**
 * The per-run prompt, sent as the user message. The system message carries
 * the static prefix and cache breakpoint, so a test asking "what was this
 * run told" wants this one.
 */
function userMessageOf(options: Record<string, unknown>): string {
  const messages = options.messages as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === "user")?.content ?? "";
}

function savedOutput() {
  const insert = calls.find((c) => c.op === "insert" && c.table === "outputs");
  return insert?.values as { body: string; unchanged: boolean } | undefined;
}

beforeEach(() => {
  calls.length = 0;
  queued.clear();
  generateText.mockReset();
  writeToolHash.mockReset().mockResolvedValue(undefined);
  isAuthError.mockReset().mockReturnValue(false);
  getToolsFor.mockReset().mockResolvedValue({
    GMAIL_FETCH_EMAILS: {
      description: "fetch",
      inputSchema: { type: "object" },
      execute: async () => bigPayload,
    },
  });
  delete process.env.HANDLES_ENABLED;

  // The claim update, then the workflow lookup. Everything else defaults to
  // "no rows" — a first run.
  queue(`update:${getTableName(runs)}`, [
    {
      id: RUN_ID,
      workflowId: workflow.id,
      trigger: "cron",
      triggerPayload: null,
    },
  ]);
  queue(`select:${getTableName(workflows)}`, [workflow]);
  queue(`update:${getTableName(workflows)}`, [{ failures: 1 }]);
});

// A stub left behind by a failed assertion must not leak into the next
// test's `fetch`.
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs the loop with a stub model that calls the fetch tool once (populating
 * the buffered hash), then finishes however the test says.
 */
/**
 * @param finish.report set false for a run that ends without calling report.
 *
 * A real run ends by calling `report`, so the stub does too: unless the test
 * drives it itself, the final text is reported as the digest. Tests that care
 * about a *missing* report opt out rather than relying on a text fallback the
 * executor no longer has.
 */
function stubModel(
  finish: {
    text?: string;
    finishReason?: string;
    steps?: unknown[];
    report?: boolean;
  },
  duringRun?: (
    tools: Record<
      string,
      { execute: (a: unknown, c: unknown) => Promise<unknown> }
    >,
  ) => Promise<void>,
) {
  generateText.mockImplementation(async (options: Record<string, unknown>) => {
    const tools = options.tools as Record<
      string,
      { execute: (a: unknown, c: unknown) => Promise<unknown> }
    >;
    const report = tools.report.execute.bind(tools.report);
    let reported = false;
    tools.report.execute = async (args: unknown, ctx: unknown) => {
      reported = true;
      return report(args, ctx);
    };

    await tools.GMAIL_FETCH_EMAILS.execute({}, {});
    await duringRun?.(tools);

    const text = finish.text ?? "## Digest\n- one thing";
    // Empty text is a model that said nothing — it has no report to make.
    if (finish.report !== false && !reported && text) {
      await report(
        text === NO_UPDATES ? { no_updates: true } : { digest: text },
        {},
      );
    }
    return {
      text,
      finishReason: finish.finishReason ?? "stop",
      steps: finish.steps ?? externalSteps(1),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  });
}

describe("cross-run hashes", () => {
  it("commits a hash on a clean run", async () => {
    stubModel({});
    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(writeToolHash).toHaveBeenCalledWith(
      workflow.id,
      "GMAIL_FETCH_EMAILS",
      expect.any(String),
      expect.any(String),
    );
  });

  it("commits nothing when the run is truncated", async () => {
    stubModel({ finishReason: "tool-calls", steps: externalSteps(5) });
    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("truncated");
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("commits nothing when the run throws", async () => {
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        throw new Error("provider exploded");
      },
    );

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("error");
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("commits nothing when a credential was rejected mid-run", async () => {
    isAuthError.mockReturnValue(true);
    getToolsFor.mockResolvedValue({
      GMAIL_FETCH_EMAILS: {
        description: "fetch",
        inputSchema: { type: "object" },
        execute: async () => bigPayload,
      },
      SLACK_FETCH: {
        description: "fetch",
        inputSchema: { type: "object" },
        execute: async () => ({ successful: false, error: "invalid_auth" }),
      },
    });

    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        const failed = await tools.SLACK_FETCH.execute({}, {});
        const onStepFinish = options.onStepFinish as (
          s: unknown,
        ) => Promise<void>;
        await onStepFinish({
          toolCalls: [{ toolCallId: "c1", toolName: "SLACK_FETCH", input: {} }],
          toolResults: [{ toolCallId: "c1", output: failed }],
        });
        return {
          text: "could not read slack",
          finishReason: "stop",
          steps: externalSteps(2),
          toolCalls: [],
          usage: {},
        };
      },
    );

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("error");
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("commits nothing when reads were degraded, even though the run is ok", async () => {
    stubModel({}, async (tools) => {
      const descriptor = (await tools.GMAIL_FETCH_EMAILS.execute({}, {})) as {
        handle: string;
      };
      for (let i = 0; i < MAX_QUERIES_PER_RUN + 1; i++) {
        await tools.query.execute(
          { handle: descriptor.handle, path: "items", count: true },
          {},
        );
      }
    });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("ok");
    expect(writeToolHash).not.toHaveBeenCalled();
  });
});

describe("degraded reads", () => {
  it("says so in the digest of an otherwise clean run", async () => {
    stubModel({}, async (tools) => {
      const descriptor = (await tools.GMAIL_FETCH_EMAILS.execute({}, {})) as {
        handle: string;
      };
      for (let i = 0; i < MAX_QUERIES_PER_RUN + 1; i++) {
        await tools.query.execute(
          { handle: descriptor.handle, path: "items", count: true },
          {},
        );
      }
    });

    await executeRun(RUN_ID);
    expect(savedOutput()?.body).toContain("could not be read this run");
    // Still honestly `ok`, with no error text — the run page renders any
    // error on a non-truncated run as "Run failed".
    expect(runVerdict().status).toBe("ok");
    expect(runVerdict().error).toBeNull();
  });

  it("leaves a clean run's digest exactly as the model wrote it", async () => {
    stubModel({ text: "## Digest\n- one thing" });
    await executeRun(RUN_ID);
    expect(savedOutput()?.body).toBe("## Digest\n- one thing");
  });

  // R1: a degraded run with no digest used to record as an ordinary clean
  // `ok` — the note had nowhere to land. It must come back `truncated`.
  it("records a degraded run that emits NO_UPDATES as truncated, naming the degradation, and flushes nothing", async () => {
    stubModel({ text: NO_UPDATES }, async (tools) => {
      const descriptor = (await tools.GMAIL_FETCH_EMAILS.execute({}, {})) as {
        handle: string;
      };
      for (let i = 0; i < MAX_QUERIES_PER_RUN + 1; i++) {
        await tools.query.execute(
          { handle: descriptor.handle, path: "items", count: true },
          {},
        );
      }
    });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().status).toBe("truncated");
    expect(runVerdict().error).toContain("could not be read this run");
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  // R1 (companion): a degraded run that DID produce a digest keeps the
  // existing behaviour — note in the body, run stays `ok`, hashes still
  // don't flush.
  it("keeps a degraded run that produced a digest as ok, with the note in the body, and still flushes nothing", async () => {
    stubModel({}, async (tools) => {
      const descriptor = (await tools.GMAIL_FETCH_EMAILS.execute({}, {})) as {
        handle: string;
      };
      for (let i = 0; i < MAX_QUERIES_PER_RUN + 1; i++) {
        await tools.query.execute(
          { handle: descriptor.handle, path: "items", count: true },
          {},
        );
      }
    });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("ok");
    expect(savedOutput()?.body).toContain("could not be read this run");
    expect(writeToolHash).not.toHaveBeenCalled();
  });
});

describe("delivery-gated flush", () => {
  it("flushes no hashes when a webhook delivery actually failed", async () => {
    queueWorkflow({
      deliver: [{ type: "webhook", url: "https://x.test/hook" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    stubModel({});
    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(writeToolHash).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("still flushes when the only non-ok delivery entries are skipped (nothing new to send)", async () => {
    queueWorkflow({
      deliver: [{ type: "webhook", url: "https://x.test/hook" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // NO_UPDATES makes the run "unchanged", so the webhook is skipped rather
    // than attempted — the design working, not a failure.
    stubModel({ text: NO_UPDATES });
    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeToolHash).toHaveBeenCalledWith(
      workflow.id,
      "GMAIL_FETCH_EMAILS",
      expect.any(String),
      expect.any(String),
    );
    vi.unstubAllGlobals();
  });

  // R3: `writeToolHash` already swallows its own errors — this is defence
  // in depth, so a throw here must not fall through to the outer `catch`
  // and overwrite an already successful, delivered run as `error`.
  it("keeps a run recorded as ok/delivered even when the flush itself throws", async () => {
    writeToolHash.mockRejectedValueOnce(new Error("hash table unavailable"));
    stubModel({});

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(runVerdict().status).toBe("ok");
    expect(runVerdict().error).toBeNull();
    expect(
      calls.some(
        (c) =>
          c.op === "update" &&
          c.table === getTableName(workflows) &&
          (c.values as { lastRunAt?: Date } | undefined)?.lastRunAt,
      ),
    ).toBe(true);
  });
});

describe("FINDING 1: degraded-blind error code and next-run advice", () => {
  it("marks a degraded-blind run with its own error code, not a bare `truncated`", async () => {
    stubModel({ text: NO_UPDATES }, driveDegraded);

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().errorCode).toBe("degraded_reads");
  });

  it("gives the NEXT run the read-budget advice, not the step-cap fetch-less advice", async () => {
    // Simulate `previousFailure`'s read of the prior (degraded-blind) run.
    queue(`select:${getTableName(runs)}`, [
      {
        status: "truncated",
        error:
          "Some fetched data could not be read this run (16 reads unavailable), so this digest may be incomplete.",
        errorCode: "degraded_reads",
        at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);

    let capturedPrompt = "";
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        capturedPrompt = userMessageOf(options);
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        return {
          text: "## Digest\n- ok",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    );

    await executeRun(RUN_ID);

    expect(capturedPrompt).toContain("ran out of budget to finish reading");
    expect(capturedPrompt).not.toContain("ran out of steps before finishing");
    expect(capturedPrompt).not.toContain(
      "fewer, more targeted tool calls, and write the digest",
    );
  });
});

describe("FINDING 2: empty response vs explicit NO_UPDATES", () => {
  it("records an empty response as an honest anomaly and flushes no hashes", async () => {
    stubModel({ text: "" });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("error");
    expect(runVerdict().status).toBe("error");
    expect(runVerdict().errorCode).toBe("empty_response");
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("does not send the next run the degraded-reads advice for a plain empty response", async () => {
    queue(`select:${getTableName(runs)}`, [
      {
        status: "error",
        error:
          "the model returned no text this run — nothing to report or deliver",
        errorCode: "empty_response",
        at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);

    let capturedPrompt = "";
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        capturedPrompt = userMessageOf(options);
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        return {
          text: "## Digest\n- ok",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    );

    await executeRun(RUN_ID);
    expect(capturedPrompt).not.toContain("ran out of budget to finish reading");
    expect(capturedPrompt).toContain("failed with");
  });

  it("still flushes hashes for an explicit NO_UPDATES on an otherwise healthy run", async () => {
    stubModel({ text: NO_UPDATES });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("ok");
    expect(writeToolHash).toHaveBeenCalled();
  });
});

describe("MINOR 3: degraded-blind error text has no markdown markers", () => {
  it("writes the degraded-blind error as plain text", async () => {
    stubModel({ text: NO_UPDATES }, driveDegraded);

    await executeRun(RUN_ID);
    expect(runVerdict().error).not.toMatch(/[_*]/);
    expect(runVerdict().error).toContain("could not be read this run");
  });
});

describe("MINOR 4: degraded-blind clears connectionFailures", () => {
  it("resets connectionFailures even though the run is recorded as truncated", async () => {
    stubModel({ text: NO_UPDATES }, driveDegraded);

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(workflowUpdate()?.connectionFailures).toBe(0);
    // `lastRunAt` means "last time this workflow completed with output" —
    // a degraded-blind run didn't, so it's deliberately left untouched.
    expect(workflowUpdate()?.lastRunAt).toBeUndefined();
  });
});

describe("truncation messages", () => {
  it("names the step budget when the external budget ran out", async () => {
    stubModel({ finishReason: "tool-calls", steps: externalSteps(5) });
    await executeRun(RUN_ID);

    expect(runVerdict().status).toBe("truncated");
    expect(runVerdict().error).toContain("stopped after 5 steps");
  });

  it("names local looping when the absolute bound tripped instead", async () => {
    const localSteps = Array.from(
      { length: workflow.maxSteps + MAX_QUERIES_PER_RUN + 2 },
      () => ({ toolCalls: [{ toolName: "query" }] }),
    );
    stubModel({ finishReason: "tool-calls", steps: localSteps });
    await executeRun(RUN_ID);

    expect(runVerdict().status).toBe("truncated");
    // The old message blamed the fetch budget, which was never spent — and
    // that message is fed to the next run as "plan fewer tool calls".
    expect(runVerdict().error).not.toContain(
      `stopped after ${workflow.maxSteps} steps`,
    );
    expect(runVerdict().error).toContain("query/inspect");
  });

  it("names the output limit when the model's reply was cut off", async () => {
    stubModel({ finishReason: "length" });
    await executeRun(RUN_ID);
    expect(runVerdict().error).toContain("output length limit");
  });
});

/** Steps that trip the absolute local bound (total-steps), not the workflow's own cap. */
function localSteps(count: number) {
  return Array.from({ length: count }, () => ({
    toolCalls: [{ toolName: "query" }],
  }));
}

const TOTAL_STEPS_BOUND = workflow.maxSteps + MAX_QUERIES_PER_RUN + 2;

describe("FINDING A: degraded_reads on a total-steps truncation", () => {
  it("a run truncated by the absolute local bound while degraded carries degraded_reads", async () => {
    stubModel(
      { finishReason: "tool-calls", steps: localSteps(TOTAL_STEPS_BOUND) },
      driveDegraded,
    );

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().errorCode).toBe("degraded_reads");
  });

  it("gives the NEXT run the read-budget advice, not fetch-less, after a degraded total-steps truncation", async () => {
    // Simulate `previousFailure`'s read of a prior total-steps-truncated,
    // degraded run.
    queue(`select:${getTableName(runs)}`, [
      {
        status: "truncated",
        error:
          "stopped after 23 steps: too many local query/inspect calls, without spending the 5-step tool budget — the digest may be incomplete Some fetched data could not be read this run (16 reads unavailable), so this digest may be incomplete.",
        errorCode: "degraded_reads",
        at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);

    let capturedPrompt = "";
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        capturedPrompt = userMessageOf(options);
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        return {
          text: "## Digest\n- ok",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    );

    await executeRun(RUN_ID);
    expect(capturedPrompt).toContain("ran out of budget to finish reading");
    expect(capturedPrompt).not.toContain(
      "fewer, more targeted tool calls, and write the digest",
    );
  });

  it("an ordinary external-step-cap truncation with NO degradation still carries no degraded_reads", async () => {
    stubModel({ finishReason: "tool-calls", steps: externalSteps(5) });

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().errorCode).toBeNull();
  });

  it("still gives the fetch-less/plan-tighter advice for an ordinary (non-degraded) step-cap truncation", async () => {
    queue(`select:${getTableName(runs)}`, [
      {
        status: "truncated",
        error: "stopped after 5 steps — the digest may be incomplete",
        errorCode: null,
        at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);

    let capturedPrompt = "";
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        capturedPrompt = userMessageOf(options);
        const tools = options.tools as Record<
          string,
          { execute: (a: unknown, c: unknown) => Promise<unknown> }
        >;
        await tools.GMAIL_FETCH_EMAILS.execute({}, {});
        return {
          text: "## Digest\n- ok",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    );

    await executeRun(RUN_ID);
    expect(capturedPrompt).toContain(
      "fewer, more targeted tool calls, and write the digest",
    );
    expect(capturedPrompt).not.toContain("ran out of budget to finish reading");
  });
});

describe("FINDING B: the degraded note lives in the digest, not runs.error, when a digest exists", () => {
  it("a truncated-and-degraded run that produced a digest has the note in the digest body and NOT in runs.error", async () => {
    stubModel(
      { finishReason: "tool-calls", steps: localSteps(TOTAL_STEPS_BOUND) },
      driveDegraded,
    );

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(savedOutput()?.body).toContain("could not be read this run");
    expect(runVerdict().error).not.toContain("could not be read this run");
    // The error keeps naming the truncation itself.
    expect(runVerdict().error).toContain("too many local query/inspect calls");
  });

  it("a degraded-blind run still has the note in runs.error", async () => {
    stubModel({ text: NO_UPDATES }, driveDegraded);

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().error).toContain("could not be read this run");
    // There is no digest here to carry the note — the body is the bare
    // NO_UPDATES sentinel, never delivered.
    expect(savedOutput()?.body).toBe(NO_UPDATES);
  });

  // Mutant: a run that hits the total-steps bound AND is blind (model's own
  // final word was NO_UPDATES) must keep BOTH the truncation reason and the
  // degraded note in `runs.error` — dropping the note is a silent
  // regression, since there's no digest for it to live in instead.
  it("a run that is both total-steps-truncated and blind keeps both the truncation reason and the note in runs.error", async () => {
    stubModel(
      {
        text: NO_UPDATES,
        finishReason: "tool-calls",
        steps: localSteps(TOTAL_STEPS_BOUND),
      },
      driveDegraded,
    );

    const result = await executeRun(RUN_ID);
    expect(result.status).toBe("truncated");
    expect(runVerdict().error).toContain("too many local query/inspect calls");
    expect(runVerdict().error).toContain("could not be read this run");
  });
});

describe("prompt cache breakpoint", () => {
  /** The system message the run actually sent, as the provider would see it. */
  function sentSystemMessage() {
    const options = generateText.mock.calls[0][0] as {
      messages: Array<{
        role: string;
        content: string;
        providerOptions?: Record<string, unknown>;
      }>;
      system?: string;
      allowSystemInMessages?: boolean;
    };
    return {
      message: options.messages.find((m) => m.role === "system"),
      legacySystem: options.system,
      allowed: options.allowSystemInMessages,
    };
  }

  afterEach(() => {
    delete process.env.PROMPT_CACHE_ENABLED;
  });

  // Mutant: dropping the breakpoint costs the discount on every step of every
  // run, silently — nothing else in the system would notice.
  it("marks the system message as the end of the cacheable prefix", async () => {
    stubModel({});
    await executeRun(RUN_ID);

    const { message, allowed } = sentSystemMessage();
    expect(allowed).toBe(true);
    expect(message?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("omits the breakpoint when PROMPT_CACHE_ENABLED is false", async () => {
    process.env.PROMPT_CACHE_ENABLED = "false";
    stubModel({});
    await executeRun(RUN_ID);

    expect(sentSystemMessage().message?.providerOptions).toBeUndefined();
  });

  // The breakpoint may change how the prefix is billed; it must never change
  // what the agent is told.
  it("sends the same system text either way, and no stray `system` option", async () => {
    stubModel({});
    await executeRun(RUN_ID);
    const withCache = sentSystemMessage();

    generateText.mockReset();
    calls.length = 0;
    queued.clear();
    queue(`update:${getTableName(runs)}`, [
      {
        id: RUN_ID,
        workflowId: workflow.id,
        trigger: "cron",
        triggerPayload: null,
      },
    ]);
    queue(`select:${getTableName(workflows)}`, [workflow]);
    queue(`update:${getTableName(workflows)}`, [{ failures: 1 }]);
    process.env.PROMPT_CACHE_ENABLED = "false";
    stubModel({});
    await executeRun(RUN_ID);
    const withoutCache = sentSystemMessage();

    expect(withCache.message?.content).toBe(withoutCache.message?.content);
    expect(withCache.legacySystem).toBeUndefined();
    expect(withCache.message?.content).toContain("personal automation agent");
  });

  // The prefix is only cacheable because it is identical across steps. A
  // per-run fact leaking in here would make every step a cache miss.
  it("keeps per-run facts out of the system message and in the user message", async () => {
    stubModel({});
    await executeRun(RUN_ID);

    const options = generateText.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = options.messages.find((m) => m.role === "system")!.content;
    const user = options.messages.find((m) => m.role === "user")!.content;

    expect(system).not.toMatch(/Right now it is/);
    expect(user).toMatch(/Right now it is/);
  });
});

describe("dynamic tool results reach the trace and the auth check", () => {
  /**
   * Composio's tools arrive as *dynamic* tools, so the SDK files results
   * under `dynamicToolResults`. Shaped the way the SDK really shapes it.
   */
  function dynamicStep(output: unknown) {
    return [
      {
        toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS", toolCallId: "c1" }],
        toolResults: [],
        dynamicToolResults: [{ toolCallId: "c1", output }],
      },
    ];
  }

  // Mutant: reading only `step.toolResults` records null for every Composio
  // call — the only calls a trace exists to explain.
  it("records the real payload from a dynamic tool result", async () => {
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        const onStepFinish = options.onStepFinish as (
          s: unknown,
        ) => Promise<void>;
        await onStepFinish(dynamicStep({ successful: true, data: "hello" })[0]);
        return {
          text: "## Digest\n- one thing",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    );

    await executeRun(RUN_ID);

    const step = calls.find(
      (c) => c.op === "insert" && c.table === getTableName(runSteps),
    )?.values as { resultJson: unknown } | undefined;
    expect(step?.resultJson).toEqual({ successful: true, data: "hello" });
  });

  // The dead-connection-looks-green bug: a rejected credential arrives as an
  // ordinary value, on the dynamic list.
  it("detects a credential rejection carried on a dynamic result", async () => {
    isAuthError.mockReturnValue(true);
    generateText.mockImplementation(
      async (options: Record<string, unknown>) => {
        const onStepFinish = options.onStepFinish as (
          s: unknown,
        ) => Promise<void>;
        await onStepFinish(
          dynamicStep({ successful: false, error: "invalid credentials" })[0],
        );
        return {
          text: "## Digest\n- looked fine",
          finishReason: "stop",
          steps: externalSteps(1),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    );

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("needs_reconnect");
  });
});

/*
 * Outcome routing.
 *
 * These tests use `stubModel`'s `duringRun` hook, which hands over the very
 * ToolSet the run was built with — so `tools.report.execute` here is the
 * same call the model would make, validation and all.
 */

/** The full outputs row, including the envelope columns. */
function outputRow() {
  const insert = calls.find((c) => c.op === "insert" && c.table === "outputs");
  return insert?.values as
    | {
        body: string;
        unchanged: boolean;
        signals: Record<string, unknown> | null;
        severity: string | null;
        suppressed: boolean;
        suppressedReason: string | null;
        deliveryStatus: string;
      }
    | undefined;
}

/** Every run row inserted during the call — a chained child is one of these. */
function insertedRuns() {
  return calls
    .filter((c) => c.op === "insert" && c.table === getTableName(runs))
    .map((c) => c.values as Record<string, unknown>);
}

/** Queues the rows `enqueueChildRuns` reads back as this workflow's children. */
function queueChildren(children: unknown[]) {
  const key = `select:${getTableName(workflows)}`;
  queued.set(key, [...(queued.get(key) ?? []), children]);
}

const NUMERIC_SIGNAL = [{ key: "n", type: "number" }];

describe("outcome envelope", () => {
  it("persists the reported signals and severity", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 9 }, severity: "warn" },
        {},
      );
    });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(outputRow()?.signals).toEqual({ n: 9 });
    expect(outputRow()?.severity).toBe("warn");
    expect(outputRow()?.body).toBe("## Digest");
  });

  it("prefers the reported digest over the model's final text", async () => {
    stubModel({ text: "stray thinking out loud" }, async (tools) => {
      await tools.report.execute({ digest: "## The real digest" }, {});
    });

    await executeRun(RUN_ID);

    expect(outputRow()?.body).toBe("## The real digest");
  });

  it("treats a reported no_updates as unchanged", async () => {
    stubModel({ text: "" }, async (tools) => {
      await tools.report.execute({ no_updates: true }, {});
    });

    const result = await executeRun(RUN_ID);

    // Not an empty response: the agent looked, found nothing, and said so.
    expect(result.status).toBe("ok");
    expect(outputRow()?.unchanged).toBe(true);
  });

  it("keeps the last report when the model corrects itself", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    stubModel({}, async (tools) => {
      const bad = (await tools.report.execute(
        { digest: "d", signals: { n: "nine" } },
        {},
      )) as { error?: string };
      expect(bad.error).toMatch(/must be a number/);
      await tools.report.execute({ digest: "d", signals: { n: 9 } }, {});
    });

    await executeRun(RUN_ID);

    expect(outputRow()?.signals).toEqual({ n: 9 });
  });
});

describe("alert conditions", () => {
  it("suppresses a digest that does not clear the threshold", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 1 } },
        {},
      );
    });

    const result = await executeRun(RUN_ID);

    // The run itself succeeded — the agent did its job and the threshold said
    // this was not worth anyone's morning.
    expect(result.status).toBe("ok");
    expect(outputRow()?.suppressed).toBe(true);
    expect(outputRow()?.suppressedReason).toBe(
      "alert condition not met: n > 3",
    );
    // The digest is still stored, so a human can see what was withheld.
    expect(outputRow()?.body).toBe("## Digest");
  });

  it("delivers a digest that clears the threshold", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 9 } },
        {},
      );
    });

    await executeRun(RUN_ID);

    expect(outputRow()?.suppressed).toBe(false);
    expect(outputRow()?.suppressedReason).toBe(null);
  });

  it("delivers and flags when the threshold could not be evaluated", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute({ digest: "## Digest" }, {});
    });

    await executeRun(RUN_ID);

    // Silence on an unevaluable alert is the dangerous outcome.
    expect(outputRow()?.suppressed).toBe(false);
    expect(outputRow()?.suppressedReason).toBe("condition_indeterminate");
  });

  it("suppression does not mark the run unchanged", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 1 } },
        {},
      );
    });

    await executeRun(RUN_ID);

    // "Found nothing" and "found something below the bar" must stay distinct.
    expect(outputRow()?.unchanged).toBe(false);
  });

  it("flushes no hashes for a digest a threshold withheld", async () => {
    // An empty delivery log isn't "everything succeeded" here — nobody read
    // these bytes. Recording the hashes would tell the next run the payload
    // was already reported, so a later value crossing the line arrives
    // marked unchanged.
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 1 } },
        {},
      );
    });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(outputRow()?.suppressed).toBe(true);
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("still flushes for a digest the threshold let through", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Digest", signals: { n: 9 } },
        {},
      );
    });

    await executeRun(RUN_ID);

    expect(writeToolHash).toHaveBeenCalled();
  });
});

describe("a run that never calls report", () => {
  it("errors rather than publishing the final text as the digest", async () => {
    // The transcript is thinking narration, not a digest — publishing it is
    // how raw reasoning reached the reader.
    stubModel({ text: "I now have confirmation of 18 emails.", report: false });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("no_report");
    // The text is still written down, undelivered, so the run isn't a mystery.
    expect(outputRow()?.body).toBe("I now have confirmation of 18 emails.");
    expect(outputRow()?.deliveryStatus).toBe("skipped");
  });

  it("errors when a workflow declaring signals gets no report", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    stubModel({ text: "## Digest with no signals", report: false });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("no_report");
  });

  it("errors when a workflow with an alert condition gets no report", async () => {
    queueWorkflow({ alertCondition: "n > 3", signalSchema: NUMERIC_SIGNAL });
    stubModel({ text: "## Digest", report: false });

    const result = await executeRun(RUN_ID);

    // Delivering here would silently skip the threshold the user configured.
    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("no_report");
  });
});

describe("a report written as text instead of called", () => {
  it("salvages the digest out of a <report> block", async () => {
    stubModel({
      text: 'Compiling now.\n\n<report> { "digest": "## 18 emails", "severity": "info" } </report>',
      report: false,
    });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    // The narration around the block never reaches the reader.
    expect(outputRow()?.body).toBe("## 18 emails");
  });

  it("salvages signals, so thresholds are still evaluated", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL, alertCondition: "n > 3" });
    stubModel({
      text: '<report>{"digest": "## Digest", "signals": {"n": 9}}</report>',
      report: false,
    });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(outputRow()?.signals).toEqual({ n: 9 });
  });

  it("still fails when the block is not a valid report", async () => {
    stubModel({ text: "<report>{ not json }</report>", report: false });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("no_report");
  });
});

describe("chained children", () => {
  it("enqueues a child with the parent's digest and signals", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    queueChildren([{ id: "child-1", parentCondition: null }]);
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Parent", signals: { n: 9 } },
        {},
      );
    });

    await executeRun(RUN_ID);

    const child = insertedRuns().find((r) => r.workflowId === "child-1");
    expect(child).toBeDefined();
    expect(child?.status).toBe("queued");
    expect(child?.trigger).toBe("workflow");
    expect(child?.parentRunId).toBe(RUN_ID);
    expect(child?.triggerPayload).toMatchObject({
      digest: "## Parent",
      signals: { n: 9 },
      parentSlug: "digest",
    });
  });

  it("does not enqueue a child whose condition is not met", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    queueChildren([{ id: "child-1", parentCondition: "n > 3" }]);
    stubModel({}, async (tools) => {
      await tools.report.execute(
        { digest: "## Parent", signals: { n: 1 } },
        {},
      );
    });

    await executeRun(RUN_ID);

    expect(
      insertedRuns().find((r) => r.workflowId === "child-1"),
    ).toBeUndefined();
  });

  it("enqueues no children when the parent reported no updates", async () => {
    queueChildren([{ id: "child-1", parentCondition: null }]);
    stubModel({}, async (tools) => {
      await tools.report.execute({ no_updates: true }, {});
    });

    await executeRun(RUN_ID);

    expect(
      insertedRuns().find((r) => r.workflowId === "child-1"),
    ).toBeUndefined();
  });

  it("enqueues no children from a truncated run", async () => {
    queueChildren([{ id: "child-1", parentCondition: null }]);
    stubModel(
      { finishReason: "tool-calls", steps: externalSteps(5) },
      async (tools) => {
        await tools.report.execute({ digest: "## Fragment" }, {});
      },
    );

    const result = await executeRun(RUN_ID);

    // A fragment is not a premise to spend a model call on downstream.
    expect(result.status).toBe("truncated");
    expect(
      insertedRuns().find((r) => r.workflowId === "child-1"),
    ).toBeUndefined();
  });
});

describe("cost cap", () => {
  /** Queues the month-to-date spend row `checkCostCap` reads back. */
  function queueSpend(total: string) {
    queue(`select:${getTableName(runs)}`, [{ total }]);
  }

  it("blocks the run and pauses the workflow when the cap is reached", async () => {
    queueWorkflow({ monthlyCostCapUsd: "5.00", timezone: "UTC" });
    queueSpend("5.20");
    stubModel({});

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    expect(runVerdict().errorCode).toBe("cost_cap");
    // No model call at all — the point is to stop spending.
    expect(generateText).not.toHaveBeenCalled();

    const paused = calls.find(
      (c) =>
        c.op === "update" &&
        c.table === getTableName(workflows) &&
        (c.values as { pausedReason?: string })?.pausedReason === "cost_cap",
    );
    expect(paused).toBeDefined();
    expect((paused?.values as { enabled?: boolean }).enabled).toBe(false);
  });

  it("runs normally below the cap", async () => {
    queueWorkflow({ monthlyCostCapUsd: "5.00", timezone: "UTC" });
    queueSpend("1.00");
    stubModel({});

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
    expect(generateText).toHaveBeenCalled();
  });

  it("blocks at exactly the cap", async () => {
    queueWorkflow({ monthlyCostCapUsd: "5.00", timezone: "UTC" });
    queueSpend("5.00");
    stubModel({});

    expect((await executeRun(RUN_ID)).status).toBe("error");
    expect(runVerdict().errorCode).toBe("cost_cap");
  });

  it("issues no spend query at all for an uncapped workflow", async () => {
    // The fixture carries no cap. A pointless query here would run before
    // every run of every uncapped workflow — nearly all of them.
    stubModel({});
    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("ok");
  });

  it("treats a zero cap as uncapped rather than blocking forever", async () => {
    queueWorkflow({ monthlyCostCapUsd: "0.00", timezone: "UTC" });
    stubModel({});

    expect((await executeRun(RUN_ID)).status).toBe("ok");
  });
});

describe("deliveryStatusFrom", () => {
  it("is skipped when nothing was attempted", () => {
    expect(deliveryStatusFrom([], false)).toBe("skipped");
  });

  it("is skipped when every target was deliberately skipped", () => {
    expect(
      deliveryStatusFrom([{ type: "slack_dm", ok: true, skipped: true }], true),
    ).toBe("skipped");
  });

  it("is delivered when every attempted target succeeded", () => {
    expect(
      deliveryStatusFrom(
        [
          { type: "slack_dm", ok: true },
          { type: "dashboard", ok: true },
        ],
        true,
      ),
    ).toBe("delivered");
  });

  it("is partial when one of two failed", () => {
    expect(
      deliveryStatusFrom(
        [
          { type: "slack_dm", ok: false, error: "token expired" },
          { type: "dashboard", ok: true },
        ],
        true,
      ),
    ).toBe("partial");
  });

  it("is failed when every attempted target failed", () => {
    expect(
      deliveryStatusFrom(
        [{ type: "slack_dm", ok: false, error: "token expired" }],
        true,
      ),
    ).toBe("failed");
  });

  it("does not count a skipped target as a failure", () => {
    expect(
      deliveryStatusFrom(
        [
          { type: "slack_dm", ok: true, skipped: true },
          { type: "dashboard", ok: true },
        ],
        true,
      ),
    ).toBe("delivered");
  });
});

describe("delivery status on the output row", () => {
  it("records a suppressed run as skipped, having attempted nothing", async () => {
    queueWorkflow({
      signalSchema: [{ key: "n", type: "number" }],
      alertCondition: "n > 3",
    });
    stubModel({}, async (tools) => {
      await tools.report.execute({ digest: "## D", signals: { n: 1 } }, {});
    });

    await executeRun(RUN_ID);

    const row = outputRow() as unknown as { deliveryStatus: string };
    expect(row.deliveryStatus).toBe("skipped");
  });

  it("counts the first attempt on a delivered run", async () => {
    stubModel({}, async (tools) => {
      await tools.report.execute({ digest: "## D" }, {});
    });

    await executeRun(RUN_ID);

    const row = outputRow() as unknown as { deliveryAttempts: number };
    expect(row.deliveryAttempts).toBe(1);
  });
});

describe("chained runs go through the quota path", () => {
  it("enqueues a child the same way every other trigger does", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    queueChildren([{ id: "child-1", parentCondition: null }]);
    stubModel({}, async (tools) => {
      await tools.report.execute({ digest: "## P", signals: { n: 9 } }, {});
    });

    await executeRun(RUN_ID);

    // `enqueueRun` stamps `lastAttemptAt` on the workflow it queues, and a
    // bare insert doesn't — the observable difference between going through
    // the quota checks and walking past them.
    const stamped = calls.some(
      (c) =>
        c.op === "update" &&
        c.table === getTableName(workflows) &&
        (c.values as { lastAttemptAt?: Date })?.lastAttemptAt instanceof Date,
    );
    expect(stamped).toBe(true);
  });
});

describe("delivery status on runs that never delivered", () => {
  it("records an empty response as skipped, not delivered", async () => {
    stubModel({ text: "" });

    const result = await executeRun(RUN_ID);

    expect(result.status).toBe("error");
    const row = outputRow() as unknown as { deliveryStatus: string };
    expect(row.deliveryStatus).toBe("skipped");
  });

  it("records a no_report failure as skipped, not delivered", async () => {
    queueWorkflow({ signalSchema: NUMERIC_SIGNAL });
    stubModel({ text: "## digest but no report call" });

    await executeRun(RUN_ID);

    const row = outputRow() as unknown as { deliveryStatus: string };
    expect(row.deliveryStatus).toBe("skipped");
  });
});

describe("what a chained child is told", () => {
  it("presents the parent's digest as prose, not as an event payload", async () => {
    queued.set(`update:${getTableName(runs)}`, [
      [
        {
          id: RUN_ID,
          workflowId: workflow.id,
          trigger: "workflow",
          triggerPayload: {
            parentSlug: "morning-brief",
            parentName: "Morning brief",
            digest: "## Deploys\n- api v2.4 shipped",
            signals: { failures: 2 },
          },
        },
      ],
    ]);
    queue(`select:${getTableName(workflows)}`, [workflow]);
    queue(`update:${getTableName(workflows)}`, [{ failures: 1 }]);
    stubModel({});

    await executeRun(RUN_ID);

    const prompt = userMessageOf(generateText.mock.calls[0][0]);
    // The digest is markdown a model wrote for a human. Sent through
    // JSON.stringify it arrived escaped, cost tokens on the escapes, and
    // could be cut mid-string into something that doesn't parse.
    expect(prompt).toContain("## Deploys\n- api v2.4 shipped");
    expect(prompt).toContain("Morning brief");
    expect(prompt).toContain("failures: 2");
    expect(prompt).not.toContain("started by an event");
    expect(prompt).not.toContain("\\n- api v2.4");
  });

  it("still labels a real event payload as an event", async () => {
    queued.set(`update:${getTableName(runs)}`, [
      [
        {
          id: RUN_ID,
          workflowId: workflow.id,
          trigger: "event",
          triggerPayload: { message: "hello", channel: "#general" },
        },
      ],
    ]);
    queue(`select:${getTableName(workflows)}`, [workflow]);
    queue(`update:${getTableName(workflows)}`, [{ failures: 1 }]);
    stubModel({});

    await executeRun(RUN_ID);

    const prompt = userMessageOf(generateText.mock.calls[0][0]);
    expect(prompt).toContain("started by an event");
  });
});

describe("a retry sweep that has nothing left to retry", () => {
  /** A row the sweep will pick up, with `previous` as its delivery log. */
  function queueRetryRow(previous: unknown[], deliver: unknown[]) {
    queue(`select:${getTableName(outputs)}`, [
      {
        outputId: "output-1",
        body: "## Digest",
        log: previous,
        attempts: 1,
        workflow: { ...workflow, deliver },
      },
    ]);
    // Second pass finds nothing, which ends the sweep.
    queue(`select:${getTableName(outputs)}`, []);
  }

  /** The values written by the last `update(outputs)` call. */
  function settled() {
    const updates = calls.filter(
      (c) => c.op === "update" && c.table === getTableName(outputs),
    );
    return updates.at(-1)?.values as {
      deliveryStatus?: string;
      deliveryAttempts?: number;
    };
  }

  it("settles a part-delivered digest as partial, not failed", async () => {
    // The webhook reached its endpoint; the Slack send didn't and can't be
    // retried — `deliverOutput` only verifies tool-based targets, it doesn't
    // perform them. Writing `failed` here would misreport a digest a reader
    // did receive as one that never arrived.
    queueRetryRow(
      [
        { type: "webhook", ok: true },
        { type: "slack_dm", ok: false, error: "agent never called SLACK_DM" },
      ],
      [{ type: "slack_dm" }],
    );

    await retryPendingDeliveries(() => true);

    expect(settled().deliveryStatus).toBe("partial");
    expect(settled().deliveryAttempts).toBe(LIMITS.maxDeliveryAttempts);
  });

  it("still settles a wholly failed digest as failed", async () => {
    queueRetryRow(
      [{ type: "slack_dm", ok: false, error: "agent never called SLACK_DM" }],
      [{ type: "slack_dm" }],
    );

    await retryPendingDeliveries(() => true);

    expect(settled().deliveryStatus).toBe("failed");
  });
});
