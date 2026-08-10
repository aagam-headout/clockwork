import { AuthView } from "@neondatabase/auth-ui";

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
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <AuthView pathname={pathname} redirectTo="/" />
    </main>
  );
}
