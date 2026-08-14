import { afterEach, describe, expect, it } from "vitest";
import { resolveBaseUrl } from "./base-url";

const original = process.env.VERCEL_PROJECT_PRODUCTION_URL;

afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = original;
});

describe("resolveBaseUrl", () => {
  it("prefers the explicit value", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.vercel.app";
    expect(resolveBaseUrl("https://clockwork.test")).toBe(
      "https://clockwork.test",
    );
  });

  it("strips a trailing slash from the explicit value", () => {
    expect(resolveBaseUrl("https://clockwork.test/")).toBe(
      "https://clockwork.test",
    );
  });

  it("falls back to the Vercel production URL", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "clockwork.vercel.app";
    expect(resolveBaseUrl(undefined)).toBe("https://clockwork.vercel.app");
  });

  it("ignores an empty explicit value", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "clockwork.vercel.app";
    expect(resolveBaseUrl("")).toBe("https://clockwork.vercel.app");
  });

  it("is undefined when neither source is set", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(resolveBaseUrl(undefined)).toBeUndefined();
  });
});
