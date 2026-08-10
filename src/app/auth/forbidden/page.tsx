"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/ui";

export default function ForbiddenPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="rise w-full max-w-sm rounded-container border border-border bg-surface p-6 text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-container border border-warn-line bg-warn-soft text-warn-text">
          <TriangleAlert className="h-5 w-5" />
        </span>
        <h1 className="heading-16 mt-4 text-foreground">Not your app</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          This account isn&apos;t authorized. This is a personal automation tool with exactly one
          allowed user.
        </p>
        <button
          onClick={async () => {
            await authClient.signOut();
            router.push("/auth/sign-in");
            router.refresh();
          }}
          className={buttonClass("outline", "md", "mt-5 w-full")}
        >
          Sign out and try a different account
        </button>
      </div>
    </main>
  );
}
