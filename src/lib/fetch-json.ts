/**
 * `fetch` + JSON, with the two failure modes the app actually hits.
 *
 * Every caller used to do `const data = await res.json()` *before* checking
 * `res.ok`. That works right up until the response isn't JSON — an expired
 * session redirecting to the sign-in HTML page, a platform 502, a dev-server
 * error page — and then the user is told "Unexpected token '<', "<!DOCTYPE"…",
 * which describes the parser's problem rather than theirs.
 *
 * Rejects with an Error whose message is fit to render: the API's own
 * `{ error }` when there is one, otherwise a plain sentence about the status.
 */
export async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    // An aborted request is the caller's own doing — it must stay
    // distinguishable so `AbortError` handling upstream still works.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("Couldn't reach the server. Check your connection.");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  const apiMessage = (data as { error?: unknown } | null)?.error;

  if (!res.ok) {
    if (typeof apiMessage === "string" && apiMessage)
      throw new Error(apiMessage);
    if (res.status === 403)
      throw new Error("You're not signed in as the owner of this app.");
    throw new Error(`Request failed (HTTP ${res.status}).`);
  }

  if (data === null) {
    throw new Error("The server returned an unexpected response.");
  }

  return data as T;
}
