"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/ui";

/*
 * Signup is open, so this page is no longer "you are not the one allowed
 * user" — it is one of a small set of specific reasons an otherwise valid
 * account can't proceed. Each gets its own wording, because "not authorized"
 * with no explanation is the kind of dead end people mail you about.
 */
const REASONS: Record<string, { title: string; body: string }> = {
  suspended: {
    title: "Account suspended",
    body: "This account has been suspended. If you think that's a mistake, get in touch with whoever runs this instance.",
  },
  email_taken: {
    title: "That email is already in use",
    body: "An account already exists for this email address and is signed in with a different provider. Sign in with the original method instead.",
  },
};

const FALLBACK = {
  title: "Not available",
  body: "This account can't access Clockwork right now.",
};

export default function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const router = useRouter();
  const { reason } = use(searchParams);
  const { title, body } = (reason && REASONS[reason]) || FALLBACK;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="rise rounded-container border-border bg-surface w-full max-w-sm border p-6 text-center">
        <span className="rounded-container border-warn-soft bg-warn-soft text-warn-text mx-auto flex h-10 w-10 items-center justify-center border">
          <TriangleAlert className="h-5 w-5" />
        </span>
        <h1 className="heading-16 text-foreground mt-4">{title}</h1>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">{body}</p>
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
