import { AuthView } from "@neondatabase/auth-ui";
import { Logo } from "@/components/logo";

// Catch-all for every Neon Auth screen: sign-in, sign-up, forgot-password,
// reset-password, etc. AuthView switches on `pathname` — a single
// `/auth/sign-in` page would 404 the moment its "sign up" link is clicked.
export default async function AuthPage({
  params,
}: {
  params: Promise<{ pathname: string }>;
}) {
  const { pathname } = await params;

  /*
   * The sign-out view is the one screen AuthView renders without a card —
   * just a bare `<Loader2 className="animate-spin" />`. Dropped into the same
   * `max-w-sm` column as the forms, that spinner sat hard against the left
   * edge with no heading explaining what was happening. It gets its own
   * frame — centered, sized, labelled — while the mounted AuthView still does
   * the actual sign-out in its effect.
   */
  if (pathname === "sign-out") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <div className="rise rounded-container border-border bg-surface flex w-full max-w-sm flex-col items-center gap-4 border px-6 py-12 text-center">
          <Logo size="md" />
          <div
            className="auth-surface text-muted flex items-center justify-center [&_svg]:h-5 [&_svg]:w-5"
            aria-hidden
          >
            <AuthView pathname={pathname} redirectTo="/auth/sign-in" />
          </div>
          <div>
            <p className="heading-16 text-foreground">Signing you out</p>
            <p className="text-muted mt-1 text-sm">
              One moment — we&apos;ll take you back to sign-in.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="rise relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size="md" />
          <div>
            <h1 className="heading-24 text-foreground">Clockwork</h1>
            <p className="text-muted mt-1 text-sm">
              Scheduled agents that read your apps and report back.
            </p>
          </div>
        </div>

        {/* AuthView brings its own card; `auth-surface` makes it read as
            ours — see the Neon Auth bridge in globals.css. A second bordered
            box just drew a box inside a box. */}
        <div className="auth-surface">
          <AuthView pathname={pathname} redirectTo="/" />
        </div>
      </div>
    </main>
  );
}
