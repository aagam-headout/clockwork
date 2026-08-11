"use client";

import { useState } from "react";
import { Check, ChevronDown, KeyRound, Plug, Workflow } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";
import type { OnboardingState } from "@/lib/onboarding";

type Step = {
  done: boolean;
  title: string;
  note: string;
  href: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * The three things a new account needs, as an accordion.
 *
 * Only one panel is open at a time — a checklist that explains all three at
 * once is three paragraphs asking to be skipped. It opens on the first
 * unfinished step, but every row is clickable, so someone who wants to re-read
 * a finished step (or read ahead) can, without leaving the page.
 */
export function SetupChecklist({ state }: { state: OnboardingState }) {
  const steps: Step[] = [
    {
      done: state.hasProviderKey,
      title: "Bring your own model key",
      note: "Clockwork runs on your Anthropic, OpenAI or AI Gateway key — the spend, the limits and the revoke button all stay yours. The key is encrypted before it's stored and never leaves your account.",
      href: "/account/model-provider",
      cta: "Add a key",
      icon: KeyRound,
    },
    {
      done: state.hasConnection,
      title: "Connect an app",
      note: "Connections are what a workflow can reach: inboxes, calendars, issue trackers, docs. Connect one to start with — you can add more later, and every workflow sees whatever is connected at the time it runs.",
      href: "/connections",
      cta: "Browse connectors",
      icon: Plug,
    },
    {
      done: state.workflowCount > 0,
      title: "Build your first workflow",
      note: 'Say what should happen and how often — "every weekday at 8am, summarise yesterday\'s issues". Clockwork turns that into steps, runs them on schedule, and keeps every run in the log so you can see what it did.',
      href: "/workflows/new",
      cta: "Start building",
      icon: Workflow,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const currentIndex = steps.findIndex((s) => !s.done);
  const [openIndex, setOpenIndex] = useState(
    currentIndex === -1 ? 0 : currentIndex,
  );

  return (
    <Card className="rise overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h2 className="heading-16 text-foreground">Get started</h2>
        <span className="text-subtle text-xs tabular-nums">
          {doneCount} of {steps.length}
        </span>
      </div>

      <p className="text-muted mt-1 max-w-prose px-5 text-[13px] leading-relaxed">
        Three steps to your first automated run. Takes about five minutes.
      </p>

      <ol className="mt-4 grid">
        {steps.map((step, i) => {
          const open = i === openIndex;
          const current = i === currentIndex;
          const Icon = step.icon;
          // The live step also carries an accent rail down its left edge, so
          // the row reads as current even when its panel is collapsed.
          return (
            <li
              key={step.title}
              className={`border-border relative border-t ${
                current
                  ? "before:bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-['']"
                  : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenIndex(open ? -1 : i)}
                aria-expanded={open}
                className="hover:bg-surface-2 flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-[background] duration-150"
              >
                {/* Same 24px box in all three states, so the titles share one
                    left edge instead of stepping in and out with the marker. */}
                <span
                  className={`rounded-control flex h-6 w-6 shrink-0 items-center justify-center border text-[11px] font-medium tabular-nums ${
                    step.done
                      ? "border-success-line bg-success-soft text-success-text"
                      : current
                        ? "border-accent-line bg-accent-soft text-accent-text"
                        : "border-border bg-surface-2 text-subtle"
                  }`}
                >
                  {step.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>

                <span
                  className={`min-w-0 flex-1 text-sm ${
                    step.done
                      ? "text-subtle line-through"
                      : current
                        ? "text-accent-text font-medium"
                        : "text-muted"
                  }`}
                >
                  {step.title}
                </span>

                <ChevronDown
                  className={`text-subtle h-4 w-4 shrink-0 transition-transform duration-200 ${
                    open ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Grid-rows trick: the panel animates from its own height with
                  no measurement and no fixed max-height guess. */}
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  open
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="pt-0.5 pr-5 pb-4 pl-14">
                    <p className="text-muted max-w-prose text-[13px] leading-relaxed">
                      {step.note}
                    </p>
                    <ButtonLink
                      href={step.href}
                      variant={step.done ? "outline" : "primary"}
                      size="sm"
                      className="mt-2.5"
                    >
                      {step.done ? "Review" : step.cta}
                    </ButtonLink>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
