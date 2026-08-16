import { ChevronRight } from "lucide-react";
import { Mono } from "@/components/ui";

/**
 * The one panel behind every dead end — 404, a thrown server error, a failed
 * root layout. Two rules it exists to enforce:
 *
 *  - Plain English first. A stack trace or `digest` string answers "what do
 *    I paste to whoever fixes this", not "what happened" — so it starts
 *    collapsed.
 *  - `<details>`, not state — this renders inside `global-error`, where the
 *    app's providers may be what broke, so it must work with no JS beyond
 *    React itself.
 */
export function ErrorState({
  code,
  title,
  description,
  details,
  actions,
  icon: Icon,
}: {
  /** "404", "500" — shown as a chip, not as the headline. */
  code: string;
  title: string;
  description: React.ReactNode;
  /** Raw diagnostics. Omitted entirely when there's nothing worth showing. */
  details?: Array<{ label: string; value: string }>;
  actions?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const shown = (details ?? []).filter((d) => d.value);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-5 py-16">
      <div className="rise w-full max-w-md text-center">
        <div className="rounded-control border-border bg-surface text-subtle mx-auto flex h-11 w-11 items-center justify-center border">
          <Icon className="h-5 w-5" />
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <Mono>{code}</Mono>
          <h1 className="heading-24 text-foreground">{title}</h1>
        </div>

        <p className="text-muted mx-auto mt-2.5 max-w-sm text-sm leading-relaxed">
          {description}
        </p>

        {actions && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        )}

        {shown.length > 0 && (
          <details className="group mt-8 text-left">
            <summary className="text-subtle hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1.5 text-xs transition-colors">
              <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
              Technical details
            </summary>
            <dl className="rounded-container border-border bg-bg-subtle mt-2.5 divide-y divide-[var(--border)] border">
              {shown.map((row) => (
                <div key={row.label} className="px-3.5 py-2.5">
                  <dt className="text-subtle text-[11px] font-medium">
                    {row.label}
                  </dt>
                  {/* Long messages wrap instead of forcing the page sideways. */}
                  <dd className="text-muted mt-1 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </div>
  );
}
