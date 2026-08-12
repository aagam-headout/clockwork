import { describeShape, previewRows, sampleOf } from "./shape";

/*
 * Payloads for one run, kept out of the model's context.
 *
 * Deliberately in memory and deliberately per-run: the payload is already
 * being fetched fresh every run, so persisting it would buy nothing and cost a
 * retention policy. The store dies when the run's promise settles.
 *
 * The ceiling exists because Fluid Compute reuses an instance across
 * concurrent requests — three runs each holding thirty payloads is real
 * memory on a shared box, not a hypothetical.
 */

/**
 * The ceiling, counted in UTF-16 characters of each payload's JSON — not in
 * heap bytes. The parsed objects behind those strings are several times
 * larger, so this bounds the *volume of data* a run may hold, not its true
 * memory footprint. It is a proportional brake, deliberately cheap: measuring
 * real retained size would mean walking every payload on every put.
 */
export const MAX_STORE_BYTES = 20_000_000;

/** Total size of a descriptor, so the thing that replaces a payload stays small. */
export const MAX_DESCRIPTOR_CHARS = 1_200;

export type Descriptor = {
  handle: string;
  tool: string;
  bytes: number;
  shape: string;
  sample: string;
  /** First few rows of the payload's main list, so routine reads need no query. */
  preview_rows?: unknown[];
  /** Present only when this run's result was byte-identical to the last one's. */
  unchanged_since?: string;
};

export type StoreLookup =
  | { ok: true; payload: unknown }
  /** `evicted` separates "we lost it" from "you asked for a handle that never existed". */
  | { ok: false; error: string; evicted: boolean };

export type ResultStore = {
  put(tool: string, payload: unknown, json: string): Descriptor;
  get(handle: string): StoreLookup;
  handles(): string[];
};

export function isDescriptor(value: unknown): value is Descriptor {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Descriptor>;
  return (
    typeof candidate.handle === "string" &&
    typeof candidate.tool === "string" &&
    typeof candidate.bytes === "number" &&
    typeof candidate.shape === "string"
  );
}

export function createResultStore(maxBytes = MAX_STORE_BYTES): ResultStore {
  // Map preserves insertion order, so deleting and re-inserting on access is
  // all the recency tracking an LRU needs here.
  const entries = new Map<string, { payload: unknown; bytes: number }>();
  const evicted = new Set<string>();
  let nextHandle = 1;
  let heldBytes = 0;

  function evictUntilUnder(limit: number, dontEvict?: string) {
    for (const [handle, entry] of entries) {
      if (heldBytes <= limit) return;
      if (handle === dontEvict) return;
      entries.delete(handle);
      evicted.add(handle);
      heldBytes -= entry.bytes;
    }
  }

  return {
    put(tool, payload, json) {
      const handle = `r${nextHandle++}`;
      const bytes = json.length;

      entries.set(handle, { payload, bytes });
      heldBytes += bytes;
      evictUntilUnder(maxBytes, handle);

      return fitDescriptor({
        handle,
        tool,
        bytes,
        shape: describeShape(payload),
        sample: sampleOf(payload),
        preview_rows: previewRows(payload),
      });
    },

    get(handle) {
      const entry = entries.get(handle);
      if (!entry) {
        if (evicted.has(handle)) {
          return {
            ok: false,
            evicted: true,
            error: `handle ${handle} was evicted — re-fetch if you still need it`,
          };
        }
        const available = [...entries.keys()].join(", ") || "none";
        return {
          ok: false,
          evicted: false,
          error: `no such handle ${handle}. available: ${available}`,
        };
      }

      // Re-insert to mark it most recently used.
      entries.delete(handle);
      entries.set(handle, entry);
      return { ok: true, payload: entry.payload };
    },

    handles() {
      return [...entries.keys()];
    },
  };
}

/**
 * Keeps a descriptor under its ceiling, shedding the least load-bearing part
 * first: the preview is an optimisation, the sample is illustrative, the shape
 * is how the agent finds field names at all. A pathological payload — hundreds
 * of top-level keys — would otherwise produce a "small" stand-in as expensive
 * as the thing it replaced.
 *
 * `unchanged_since` is stamped on afterwards by the wrapper, so a descriptor
 * can end up a few dozen characters over this bound.
 */
function fitDescriptor(descriptor: Descriptor): Descriptor {
  const size = (value: Descriptor) => (JSON.stringify(value) ?? "").length;
  if (size(descriptor) <= MAX_DESCRIPTOR_CHARS) return descriptor;

  const trimmed: Descriptor = { ...descriptor };
  delete trimmed.preview_rows;
  if (size(trimmed) <= MAX_DESCRIPTOR_CHARS) return trimmed;

  trimmed.sample = clip(trimmed.sample, size(trimmed) - MAX_DESCRIPTOR_CHARS);
  if (size(trimmed) <= MAX_DESCRIPTOR_CHARS) return trimmed;

  trimmed.shape = clip(trimmed.shape, size(trimmed) - MAX_DESCRIPTOR_CHARS);
  return trimmed;
}

function clip(text: string, by: number): string {
  const kept = Math.max(0, text.length - by - 1);
  return kept >= text.length ? text : `${text.slice(0, kept)}…`;
}
