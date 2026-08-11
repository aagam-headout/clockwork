import Link from "next/link";
import { Check, KeyRound, Plug, Workflow } from "lucide-react";
import { Card } from "@/components/ui";
import type { OnboardingState } from "@/lib/onboarding";

type Step = {
  done: boolean;
  icon: typeof KeyRound;
  title: string;
  body: string;
  href: string;
  cta: string;
};

/**
 * The three things a new account needs, shown until they're done.
 *
 * The first step carries an explanation rather than just a label: "bring your
 * own API key" is the unusual part of this app, and someone who hits a settings
 * page cold and finds a password field with no context assumes something has
 * gone wrong.
 */
export function SetupChecklist({ state }: { state: OnboardingState }) {
  const steps: Step[] = [
    {
      done: state.hasProviderKey,
      icon: KeyRound,
      title: "Add a model provider key",
      body: "Clockwork runs on your own Anthropic, OpenAI or AI Gateway key, so you control the spend and can revoke it whenever you like. It's encrypted before it's stored.",
      href: "/account/model-provider",
      cta: "Add a key",
    },
    {
      done: state.hasConnection,
      icon: Plug,
      title: "Connect an app",
      body: "Slack, Gmail, GitHub, Notion — anything in the Composio catalog. Whatever you connect becomes available to every workflow you write.",
      href: "/connections",
      cta: "Browse connectors",
    },
    {
      done: state.workflowCount > 0,
      icon: Workflow,
      title: "Create your first workflow",
      body: "Describe what you want checked and when. The builder drafts it with you, then it runs on a schedule and reports back.",
      href: "/workflows/new",
      cta: "Start building",
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;

  return (
    <Card className="rise p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading-16 text-foreground">Set up Clockwork</h2>
        <span className="text-subtle text-xs">
          {steps.length - remaining} of {steps.length} done
        </span>
      </div>

      <ol className="mt-4 grid gap-3">
        {steps.map((step) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              className={`rounded-control mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border ${
                step.done
                  ? "border-success-line bg-success-soft text-success-text"
                  : "border-border bg-surface-2 text-subtle"
              }`}
            >
              {step.done ? (
                <Check className="h-4 w-4" />
              ) : (
                <step.icon className="h-4 w-4" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  step.done ? "text-subtle line-through" : "text-foreground"
                }`}
              >
                {step.title}
              </div>
              {!step.done && (
                <>
                  <p className="text-muted mt-1 text-[13px] leading-relaxed">
                    {step.body}
                  </p>
                  <Link
                    href={step.href}
                    className="text-accent-text mt-1.5 inline-block text-[13px] underline underline-offset-2"
                  >
                    {step.cta}
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
