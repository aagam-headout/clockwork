"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/ui";

export default function ForbiddenPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="rise rounded-container border-border bg-surface w-full max-w-sm border p-6 text-center">
        <span className="rounded-container border-warn-soft bg-warn-soft text-warn-text mx-auto flex h-10 w-10 items-center justify-center border">
          <TriangleAlert className="h-5 w-5" />
        </span>
        <h1 className="heading-16 text-foreground mt-4">Not your app</h1>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">
          This account isn&apos;t authorized. This is a personal automation tool
          with exactly one allowed user.
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
