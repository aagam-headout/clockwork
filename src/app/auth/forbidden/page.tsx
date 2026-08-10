"use client";

import { authClient } from "@/lib/auth/client";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-medium text-foreground">Not your app</h1>
      <p className="text-sm text-muted">
        This account isn&apos;t authorized. This is a personal automation tool with exactly one
        allowed user.
      </p>
      <button
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/auth/sign-in";
        }}
        className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground"
      >
        Sign out and try a different account
      </button>
    </main>
  );
}
