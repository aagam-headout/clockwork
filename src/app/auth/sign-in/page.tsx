import { AuthView } from "@neondatabase/auth-ui";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <AuthView pathname="sign-in" redirectTo="/" />
    </main>
  );
}
