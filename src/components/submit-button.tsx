"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { buttonClass, BUTTON_SIZES, BUTTON_VARIANTS } from "@/components/ui";

/**
 * Form-aware button. `iconOnly` collapses to a square icon control while
 * keeping the label as the accessible name — used for the dense row actions.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "outline",
  size = "sm",
  icon: Icon,
  iconOnly = false,
  danger = false,
  title,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  icon?: React.ComponentType<{ className?: string }>;
  iconOnly?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title={title ?? (typeof children === "string" ? children : undefined)}
      aria-label={
        iconOnly && typeof children === "string" ? children : undefined
      }
      className={buttonClass(
        variant,
        size,
        `disabled:cursor-wait ${iconOnly ? "w-8 px-0" : ""} ${
          danger
            ? "text-danger-text hover:bg-danger-soft hover:text-danger-text"
            : ""
        }`,
      )}
    >
      {pending ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="h-3.5 w-3.5" />
      )}
      {!iconOnly && (pending ? pendingLabel : children)}
    </button>
  );
}
