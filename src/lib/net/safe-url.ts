import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/*
 * Webhook delivery makes this app's server fetch a URL the user chose. With
 * one trusted user that was fine. With open signup it is a server-side request
 * forgery primitive: `http://169.254.169.254/latest/meta-data/` returns cloud
 * instance credentials, `http://metadata.google.internal` the same on GCP, and
 * anything on the deployment's private network is reachable that a browser
 * could never touch.
 *
 * So: public, http(s), standard ports, and the resolved address must not be
 * private. Checked when the workflow is saved *and* again at delivery time,
 * because DNS can change between the two (a hostname that resolved publicly at
 * save time can resolve to 127.0.0.1 later — DNS rebinding).
 */

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** RFC1918, loopback, link-local, CGNAT, and their IPv6 equivalents. */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const addr = address.toLowerCase();
    if (addr === "::" || addr === "::1") return true;
    if (addr.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(addr)) return true; // unique local
    // IPv4-mapped (::ffff:10.0.0.1) — check the embedded v4 address.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Throws unless `raw` is a URL this server may fetch on a user's behalf.
 *
 * Resolves DNS, so it is async and can fail for a hostname that simply doesn't
 * exist — which is also worth rejecting at save time.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Webhook delivery needs a valid http(s) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Webhook delivery needs an http(s) URL.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError(
      "Webhook delivery only allows the standard ports 80 and 443.",
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnsafeUrlError(
      `Webhook delivery can't reach ${url.hostname} — it isn't a public address.`,
    );
  }

  // A literal IP needs no lookup, and must not get one — resolving it would
  // just hand back the same address.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeUrlError(
        `Webhook delivery can't reach ${url.hostname} — it isn't a public address.`,
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Webhook delivery can't resolve ${url.hostname}.`);
  }

  // Every resolved address must be public: a hostname with one public and one
  // private A record is a rebinding attack with extra steps.
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError(
      `Webhook delivery can't reach ${url.hostname} — it resolves to a private address.`,
    );
  }
}
