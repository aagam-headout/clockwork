import { FileQuestion } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { ButtonLink } from "@/components/ui";

/**
 * Reached by an unknown URL and by every `notFound()` call — most often a
 * workflow or run id that was deleted, which is why the copy names that case
 * rather than saying "page not found" and stopping there.
 */
export default function NotFound() {
  return (
    <ErrorState
      icon={FileQuestion}
      code="404"
      title="Not found"
      description="This page doesn't exist. If you followed a link from somewhere in the app, the workflow or run it pointed at was probably deleted."
      actions={
        <>
          <ButtonLink href="/workflows" variant="primary" size="sm">
            Go to workflows
          </ButtonLink>
          <ButtonLink href="/" variant="outline" size="sm">
            Overview
          </ButtonLink>
        </>
      }
    />
  );
}
