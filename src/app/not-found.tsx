import { FileQuestion } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { ButtonLink } from "@/components/ui";

/**
 * Reached by an unknown URL and by every `notFound()` call — usually a
 * deleted workflow or run id, which is why the copy names that case instead
 * of just saying "page not found".
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
