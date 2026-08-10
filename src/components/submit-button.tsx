"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import {
  buttonClass,
  iconButtonClass,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
} from "@/components/ui";

/**
 * Form-aware button. `iconOnly` collapses to a square icon control while
 * keeping the label as the accessible name — used for the dense row actions.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "outline",
  size = "sm",
  icon,
  iconOnly = false,
  danger = false,
  title,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  icon?: React.ReactNode;
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
      className={(iconOnly ? iconButtonClass : buttonClass)(
        variant,
        // Icon-only has its own padding-free size scale; cancelling the text
        // size's px-* with a later utility does not work (see ui.tsx).
        size,
        `disabled:cursor-wait ${
          danger
            ? "text-danger-text hover:bg-danger-soft hover:text-danger-text"
            : ""
        }`,
      )}
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {!iconOnly && (pending ? pendingLabel : children)}
    </button>
  );
}
