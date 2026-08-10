"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "default",
  icon: Icon,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "default" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
        variant === "danger"
          ? "text-danger hover:border-danger"
          : "text-foreground hover:border-foreground"
      }`}
    >
      {Icon && !pending && <Icon className="h-3 w-3" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
