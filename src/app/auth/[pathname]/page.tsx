import { AuthView } from "@neondatabase/auth-ui";
import { Logo } from "@/components/logo";

// Catch-all for every Neon Auth screen: sign-in, sign-up, forgot-password,
// reset-password, etc. AuthView switches on `pathname` — a single
// `/auth/sign-in` page 404s the moment its "sign up" link is clicked,
// since that navigates to /auth/sign-up.
export default async function AuthPage({
  params,
}: {
  params: Promise<{ pathname: string }>;
}) {
  const { pathname } = await params;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="rise relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size="md" />
          <div>
            <h1 className="heading-24 text-foreground">my-workflows</h1>
            <p className="mt-1 text-sm text-muted">
              Scheduled agents that read your apps and report back.
            </p>
          </div>
        </div>

        <div className="rounded-container border border-border bg-surface p-6">
          <AuthView pathname={pathname} redirectTo="/" />
        </div>
      </div>
    </main>
  );
}
