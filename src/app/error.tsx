"use client";

import { useEffect } from "react";
import { TriangleAlert, RotateCw } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { ButtonLink, buttonClass } from "@/components/ui";

/**
 * Anything that throws while rendering a page lands here — a Postgres blip, a
 * Composio 5xx, a bad cron expression. Before this, Next's stock screen
 * showed "Application error: a client-side exception has occurred", saying
 * nothing and offering nothing to do next.
 *
 * In production `message` is scrubbed and only `digest` survives — that's
 * the string worth quoting in a bug report, so it leads the collapsed
 * details. `reset()` re-renders the segment, a real fix for the transient
 * half of these failures.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side trace is already in platform logs; this is the only record
    // of the failure on the client.
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <ErrorState
      icon={TriangleAlert}
      code={error.digest ? "500" : "Error"}
      title="Something broke on our side"
      description="The page couldn't finish loading. It's usually a hiccup talking to the database or to Composio — trying again is worth a shot."
      actions={
        <>
          <button
            type="button"
            onClick={reset}
            className={buttonClass("primary", "sm")}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Try again
          </button>
          <ButtonLink href="/workflows" variant="outline" size="sm">
            Go to workflows
          </ButtonLink>
        </>
      }
      details={[
        { label: "Digest", value: error.digest ?? "" },
        { label: "Message", value: error.message ?? "" },
      ]}
    />
  );
}
