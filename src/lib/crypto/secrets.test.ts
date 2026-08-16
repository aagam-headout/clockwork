import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// Set before the module reads it — resolution is lazy, but the test needs a
// deterministic key regardless of environment.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

const { encryptSecret, decryptSecret, last4, redactSecrets } =
  await import("./secrets");

const AAD = "user-1:anthropic";
const SECRET = "sk-ant-api03-abcdefghijklmnop1234";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret(SECRET, AAD), AAD)).toBe(SECRET);
  });

  it("uses a fresh IV per call, so identical plaintexts differ", () => {
    const a = encryptSecret(SECRET, AAD);
    const b = encryptSecret(SECRET, AAD);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("refuses a row moved to another user", () => {
    // The point of binding AAD to (userId, provider): a copied row must fail,
    // not hand over a working key.
    const sealed = encryptSecret(SECRET, AAD);
    expect(() => decryptSecret(sealed, "user-2:anthropic")).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const sealed = encryptSecret(SECRET, AAD);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptSecret({ ...sealed, ciphertext: flipped.toString("base64") }, AAD),
    ).toThrow();
  });

  it("refuses a swapped auth tag", () => {
    const sealed = encryptSecret(SECRET, AAD);
    const other = encryptSecret("sk-ant-api03-zzzzzzzzzzzzzzzz9999", AAD);
    expect(() =>
      decryptSecret({ ...sealed, authTag: other.authTag }, AAD),
    ).toThrow();
  });
});

describe("last4", () => {
  it("returns only the tail", () => {
    expect(last4(SECRET)).toBe("1234");
  });
});

describe("redactSecrets", () => {
  it("scrubs keys out of text that reaches a user", () => {
    expect(redactSecrets(`401 from ${SECRET}`)).not.toContain(SECRET);
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrst")).toBe(
      "Authorization: Bearer ***",
    );
  });

  it("leaves ordinary text alone", () => {
    const message = "Model anthropic/claude-sonnet-5 is not available.";
    expect(redactSecrets(message)).toBe(message);
  });
});
