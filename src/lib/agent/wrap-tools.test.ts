import { describe, expect, it, vi, beforeEach } from "vitest";

const readToolHash = vi.fn();
const writeToolHash = vi.fn();

vi.mock("@/lib/data/tool-hashes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/tool-hashes")>(
    "@/lib/data/tool-hashes",
  );
  return {
    canonicalHash: actual.canonicalHash,
    readToolHash: (...args: unknown[]) => readToolHash(...args),
    writeToolHash: (...args: unknown[]) => writeToolHash(...args),
  };
});

import type { ToolSet } from "ai";
import { createResultStore, isDescriptor } from "./result-store";
import {
  countExternalSteps,
  createHarnessState,
  flushToolHashes,
  loopBoundHit,
  resolveForTrace,
  runLoopExhausted,
  wrapToolsWithHandles,
  HANDLE_PROMPT,
  MAX_QUERIES_PER_RUN,
  MAX_STRING_SLICE_CHARS,
} from "./wrap-tools";

/** A tool set with one tool returning whatever the test hands it. */
function toolsReturning(output: unknown): ToolSet {
  return {
    GMAIL_FETCH_EMAILS: {
      description: "fetch",
      inputSchema: { type: "object" },
      execute: async () => output,
    },
  } as unknown as ToolSet;
}

const big = {
  items: Array.from({ length: 200 }, (_, i) => ({
    id: `${i}`,
    body: "y".repeat(50),
  })),
};

/** The wrapper plus the two pieces of state the executor owns. */
function harnessFor(output: unknown) {
  const store = createResultStore();
  const state = createHarnessState();
  const wrapped = wrapToolsWithHandles(toolsReturning(output), {
    workflowId: "w1",
    store,
    state,
  });
  return { wrapped, store, state };
}

async function call(tools: ToolSet, name: string, args: unknown) {
  const tool = tools[name] as unknown as {
    execute: (args: unknown, ctx: unknown) => Promise<unknown>;
  };
  return tool.execute(args, {});
}

beforeEach(() => {
  readToolHash.mockReset().mockResolvedValue(null);
  writeToolHash.mockReset().mockResolvedValue(undefined);
  delete process.env.HANDLES_ENABLED;
});

describe("wrapToolsWithHandles", () => {
  it("passes a small result through untouched", async () => {
    const { wrapped, store } = harnessFor({ ok: true });
    await expect(call(wrapped, "GMAIL_FETCH_EMAILS", {})).resolves.toEqual({
      ok: true,
    });
    expect(store.handles()).toEqual([]);
  });

  it("returns a descriptor for a large result and stores the payload", async () => {
    const { wrapped, store } = harnessFor(big);

    const out = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    expect(isDescriptor(out)).toBe(true);
    if (!isDescriptor(out)) return;
    expect(out.tool).toBe("GMAIL_FETCH_EMAILS");
    expect(out.shape).toContain("items");
    expect(store.get(out.handle)).toEqual({ ok: true, payload: big });
  });

  it("never handle-ifies a failed result, however large", async () => {
    const failure = { successful: false, error: "auth failed", data: big };
    const { wrapped, store } = harnessFor(failure);

    const out = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    expect(out).toEqual(failure);
    expect(store.handles()).toEqual([]);
  });

  it("marks a byte-identical result as unchanged", async () => {
    const { wrapped } = harnessFor(big);

    const seenAt = new Date("2026-08-11T06:00:00Z");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(JSON.stringify(big)).digest("hex");
    readToolHash.mockResolvedValue({ resultHash: hash, seenAt });

    const out = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    expect(isDescriptor(out)).toBe(true);
    if (!isDescriptor(out)) return;
    expect(out.unchanged_since).toBe(seenAt.toISOString());
  });

  it("omits unchanged_since when the hash differs", async () => {
    readToolHash.mockResolvedValue({
      resultHash: "something-else",
      seenAt: new Date(),
    });
    const { wrapped } = harnessFor(big);

    const out = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(out)) throw new Error("expected a descriptor");
    expect(out.unchanged_since).toBeUndefined();
  });

  it("is an identity function when disabled", async () => {
    process.env.HANDLES_ENABLED = "false";
    const { wrapped } = harnessFor(big);

    expect(Object.keys(wrapped)).toEqual(["GMAIL_FETCH_EMAILS"]);
    await expect(call(wrapped, "GMAIL_FETCH_EMAILS", {})).resolves.toEqual(big);
  });

  it("adds query and inspect tools", () => {
    const { wrapped } = harnessFor({});
    expect(Object.keys(wrapped).sort()).toEqual([
      "GMAIL_FETCH_EMAILS",
      "inspect",
      "query",
    ]);
  });
});

/*
 * The failure this guards: a hash written for a run that then died means the
 * next run sees identical bytes, is told `unchanged_since`, and reports
 * nothing — content that no digest ever carried is lost silently.
 */
describe("hash buffering", () => {
  it("writes no hash during the tool call itself", async () => {
    const { wrapped, state } = harnessFor(big);
    await call(wrapped, "GMAIL_FETCH_EMAILS", {});

    expect(writeToolHash).not.toHaveBeenCalled();
    expect(state.pendingHashes).toHaveLength(1);
    expect(state.pendingHashes[0].toolSlug).toBe("GMAIL_FETCH_EMAILS");
  });

  it("writes the buffered hash only when the run flushes it", async () => {
    const { wrapped, state } = harnessFor(big);
    await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    await flushToolHashes("w1", state);

    expect(writeToolHash).toHaveBeenCalledWith(
      "w1",
      "GMAIL_FETCH_EMAILS",
      expect.any(String),
      expect.any(String),
    );
  });

  it("writes nothing when a run ends without flushing", async () => {
    const { wrapped } = harnessFor(big);
    await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    // The run threw, timed out, or was recorded as truncated: no flush.
    expect(writeToolHash).not.toHaveBeenCalled();
  });

  it("cannot write the same hash twice", async () => {
    const { wrapped, state } = harnessFor(big);
    await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    await flushToolHashes("w1", state);
    await flushToolHashes("w1", state);
    expect(writeToolHash).toHaveBeenCalledTimes(1);
  });
});

describe("degraded reads", () => {
  it("counts a spent query budget", async () => {
    const { wrapped, state } = harnessFor(big);
    const descriptor = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(descriptor)) throw new Error("expected a descriptor");

    for (let i = 0; i < MAX_QUERIES_PER_RUN + 2; i++) {
      await call(wrapped, "query", {
        handle: descriptor.handle,
        path: "items",
        count: true,
      });
    }
    expect(state.degradedReads).toBe(2);
  });

  it("counts an evicted handle", async () => {
    const store = createResultStore(10);
    const state = createHarnessState();
    const wrapped = wrapToolsWithHandles(toolsReturning({}), {
      workflowId: "w1",
      store,
      state,
    });
    store.put("A", { a: 1 }, "x".repeat(20));
    store.put("B", { b: 2 }, "x".repeat(20));

    const out = (await call(wrapped, "query", { handle: "r1" })) as {
      error: string;
    };
    expect(out.error).toContain("evicted");
    expect(state.degradedReads).toBe(1);
  });

  it("does not count a handle the model simply invented", async () => {
    const { wrapped, state } = harnessFor(big);
    await call(wrapped, "query", { handle: "r99" });
    expect(state.degradedReads).toBe(0);
  });

  it("is zero for a run that read everything it asked for", async () => {
    const { wrapped, state } = harnessFor(big);
    const descriptor = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(descriptor)) throw new Error("expected a descriptor");
    await call(wrapped, "query", {
      handle: descriptor.handle,
      path: "items",
      pick: ["id"],
      take: 2,
    });
    expect(state.degradedReads).toBe(0);
  });
});

describe("the query tool", () => {
  async function wrappedWithBigResult() {
    const { wrapped, state } = harnessFor(big);
    const descriptor = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(descriptor)) throw new Error("expected a descriptor");
    return { wrapped, state, handle: descriptor.handle };
  }

  it("narrows a stored payload", async () => {
    const { wrapped, handle } = await wrappedWithBigResult();
    const out = await call(wrapped, "query", {
      handle,
      path: "items",
      pick: ["id"],
      take: 2,
    });
    expect(out).toEqual({ value: [{ id: "0" }, { id: "1" }] });
  });

  it("returns a new handle when its own result is still large", async () => {
    const { wrapped, handle } = await wrappedWithBigResult();
    const out = await call(wrapped, "query", { handle, path: "items" });
    expect(isDescriptor(out)).toBe(true);
  });

  it("reports an unknown handle without throwing", async () => {
    const { wrapped } = await wrappedWithBigResult();
    const out = (await call(wrapped, "query", { handle: "r99" })) as {
      error: string;
    };
    expect(out.error).toContain("no such handle r99");
  });

  it("reports a bad path with the shape that was there", async () => {
    const { wrapped, handle } = await wrappedWithBigResult();
    const out = (await call(wrapped, "query", {
      handle,
      path: "messages",
    })) as {
      error: string;
      shape_at_path?: string;
    };
    expect(out.error).toContain("messages");
    expect(out.shape_at_path).toContain("items");
  });

  it("refuses past the query budget instead of throwing", async () => {
    const { wrapped, handle } = await wrappedWithBigResult();
    for (let i = 0; i < MAX_QUERIES_PER_RUN; i++) {
      await call(wrapped, "query", { handle, path: "items", count: true });
    }
    const out = (await call(wrapped, "query", {
      handle,
      path: "items",
      count: true,
    })) as { error: string };
    expect(out.error).toContain("query budget exhausted");
    expect(out.error).toContain("could not be read");
  });

  it("returns shape and sample from inspect, without rows", async () => {
    const { wrapped, handle } = await wrappedWithBigResult();
    const out = (await call(wrapped, "inspect", { handle, path: "items" })) as {
      shape: string;
      sample: string;
    };
    expect(out.shape).toContain("200 ×");
    expect(out.sample.length).toBeLessThanOrEqual(401);
  });
});

/*
 * A 60KB article body reached through `path` used to come back as another
 * descriptor, which the agent could only re-query into another descriptor —
 * the budget goes, and not one character of the text is ever read.
 */
describe("long text values", () => {
  const article = { data: { content: "z".repeat(60_000) } };

  async function wrappedWithArticle() {
    const { wrapped } = harnessFor(article);
    const descriptor = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(descriptor)) throw new Error("expected a descriptor");
    return { wrapped, handle: descriptor.handle };
  }

  it("returns a bounded slice rather than another descriptor", async () => {
    const { wrapped, handle } = await wrappedWithArticle();
    const out = (await call(wrapped, "query", {
      handle,
      path: "data.content",
    })) as { value: string; truncated: boolean; offset: number; total: number };

    expect(isDescriptor(out)).toBe(false);
    expect(typeof out.value).toBe("string");
    expect(out.value).toHaveLength(MAX_STRING_SLICE_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.offset).toBe(0);
    expect(out.total).toBe(60_000);
  });

  it("pages through the text with offset", async () => {
    const { wrapped, handle } = await wrappedWithArticle();
    const first = (await call(wrapped, "query", {
      handle,
      path: "data.content",
    })) as { value: string };
    const second = (await call(wrapped, "query", {
      handle,
      path: "data.content",
      offset: MAX_STRING_SLICE_CHARS,
    })) as { value: string; offset: number; truncated: boolean };

    expect(second.offset).toBe(MAX_STRING_SLICE_CHARS);
    expect(second.value).toHaveLength(MAX_STRING_SLICE_CHARS);
    expect(second.truncated).toBe(true);
    // Two different windows onto the same text, not the same slice twice.
    expect(first.value + second.value).toBe(
      article.data.content.slice(0, MAX_STRING_SLICE_CHARS * 2),
    );
  });

  it("says truncated: false on the last page", async () => {
    const { wrapped, handle } = await wrappedWithArticle();
    const out = (await call(wrapped, "query", {
      handle,
      path: "data.content",
      offset: 60_000 - 10,
    })) as { value: string; truncated: boolean };
    expect(out.value).toHaveLength(10);
    expect(out.truncated).toBe(false);
  });

  it("hands back a short string whole", async () => {
    const { wrapped } = harnessFor({
      data: { content: "short", filler: "f".repeat(3_000) },
    });
    const descriptor = await call(wrapped, "GMAIL_FETCH_EMAILS", {});
    if (!isDescriptor(descriptor)) throw new Error("expected a descriptor");
    const out = await call(wrapped, "query", {
      handle: descriptor.handle,
      path: "data.content",
    });
    expect(out).toEqual({ value: "short" });
  });
});

describe("HANDLE_PROMPT", () => {
  it("does not claim local calls are free of cost", () => {
    expect(HANDLE_PROMPT).not.toMatch(/cost no money/i);
    expect(HANDLE_PROMPT).not.toMatch(/use them freely/i);
  });

  it("says they are still round trips, and names the preview", () => {
    expect(HANDLE_PROMPT).toMatch(/round trip/i);
    expect(HANDLE_PROMPT).toContain("preview_rows");
  });
});

describe("countExternalSteps", () => {
  it("ignores steps that only called local tools", () => {
    const steps = [
      { toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS" }] },
      { toolCalls: [{ toolName: "query" }] },
      { toolCalls: [{ toolName: "inspect" }] },
      { toolCalls: [{ toolName: "SLACK_SEND_MESSAGE" }] },
    ];
    expect(countExternalSteps(steps)).toBe(2);
  });

  it("counts a step that mixes local and external calls", () => {
    expect(
      countExternalSteps([
        {
          toolCalls: [{ toolName: "query" }, { toolName: "GITHUB_LIST_REPOS" }],
        },
      ]),
    ).toBe(1);
  });

  it("ignores text-only steps", () => {
    expect(countExternalSteps([{}, { toolCalls: [] }])).toBe(0);
  });
});

describe("runLoopExhausted", () => {
  it("is false under both the external-step and absolute bounds", () => {
    const steps = [
      { toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS" }] },
      { toolCalls: [{ toolName: "query" }] },
    ];
    expect(runLoopExhausted(steps, 8)).toBe(false);
  });

  it("is true once external steps reach maxSteps", () => {
    const steps = Array.from({ length: 8 }, () => ({
      toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS" }],
    }));
    expect(runLoopExhausted(steps, 8)).toBe(true);
  });

  it("is true when local-only calls push total steps to the absolute bound, even under the external budget", () => {
    const maxSteps = 5;
    // All local calls: countExternalSteps is 0, well under maxSteps, but the
    // total step count has run past the absolute ceiling — a model looping
    // on `query`/`inspect` past their own budget must still be stopped.
    const steps = Array.from(
      { length: maxSteps + MAX_QUERIES_PER_RUN + 2 },
      () => ({ toolCalls: [{ toolName: "query" }] }),
    );
    expect(runLoopExhausted(steps, maxSteps)).toBe(true);
  });

  it("is false for a long local-only run that has not yet reached the absolute bound", () => {
    const maxSteps = 5;
    const steps = Array.from(
      { length: maxSteps + MAX_QUERIES_PER_RUN },
      () => ({ toolCalls: [{ toolName: "inspect" }] }),
    );
    expect(runLoopExhausted(steps, maxSteps)).toBe(false);
  });
});

describe("loopBoundHit", () => {
  it("names the external-step budget when that is what ran out", () => {
    const steps = Array.from({ length: 5 }, () => ({
      toolCalls: [{ toolName: "GMAIL_FETCH_EMAILS" }],
    }));
    expect(loopBoundHit(steps, 5)).toBe("external-steps");
  });

  it("names the total-step bound when local calls looped", () => {
    const maxSteps = 5;
    const steps = Array.from(
      { length: maxSteps + MAX_QUERIES_PER_RUN + 2 },
      () => ({ toolCalls: [{ toolName: "query" }] }),
    );
    expect(loopBoundHit(steps, maxSteps)).toBe("total-steps");
  });

  it("is null while neither bound is reached", () => {
    expect(loopBoundHit([{ toolCalls: [{ toolName: "A" }] }], 5)).toBeNull();
  });
});

describe("resolveForTrace", () => {
  it("swaps a descriptor for the payload it stands in for", () => {
    const store = createResultStore();
    const descriptor = store.put(
      "A",
      { real: "payload" },
      '{"real":"payload"}',
    );
    expect(resolveForTrace(descriptor, store)).toEqual({ real: "payload" });
  });

  it("leaves ordinary output alone", () => {
    const store = createResultStore();
    expect(resolveForTrace({ successful: true }, store)).toEqual({
      successful: true,
    });
  });

  it("falls back to the descriptor when the payload was evicted", () => {
    const store = createResultStore(10);
    const first = store.put("A", { a: 1 }, "x".repeat(20));
    store.put("B", { b: 2 }, "x".repeat(20));
    expect(resolveForTrace(first, store)).toEqual(first);
  });
});
