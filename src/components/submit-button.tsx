"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Trash2, X } from "lucide-react";
import {
  buttonClass,
  iconButtonClass,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  ICON_BUTTON_SIZES,
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

/**
 * Submit that arms before it fires. Deleting a workflow takes its whole run
 * history with it and there was nothing between a mis-aimed click on a 32px
 * trash glyph and that happening.
 *
 * Two clicks on the same control rather than a modal: the row the user is
 * aiming at stays on screen, there's no focus trap to escape, and the armed
 * state says what it will do ("Delete workflow?") instead of asking them to
 * read a dialog about it. It disarms itself after `DISARM_MS` so a page left
 * open doesn't keep a live delete under the cursor.
 */
const DISARM_MS = 4000;

export function ConfirmSubmitButton({
  children,
  confirmLabel,
  pendingLabel,
  icon,
  title,
  size = "sm",
  variant = "ghost",
}: {
  /** Accessible name in the resting state; also the tooltip. */
  children: string;
  /** What the armed button says — phrase it as the question. */
  confirmLabel: string;
  pendingLabel: string;
  icon?: React.ReactNode;
  title?: string;
  /** Resting-state icon button size. The armed (labelled) state stays "sm". */
  size?: keyof typeof ICON_BUTTON_SIZES;
  /** Resting-state icon button variant. The armed (labelled) state stays "danger". */
  variant?: keyof typeof BUTTON_VARIANTS;
}) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), DISARM_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  /*
   * The two states are separate elements by `key`, and the resting one cancels
   * its own click — both are load-bearing, and the first version had neither.
   *
   * Without the keys, React sees a <button> in the same slot before and after
   * and *updates that DOM node in place*, flipping `type="button"` to
   * `type="submit"` while the click that armed it is still being dispatched.
   * The browser resolves a click's activation behaviour after the handlers
   * run, reads the type it finds *then* — submit — and posted the form. One
   * click deleted the thing the confirmation exists to protect.
   */
  if (armed) {
    return (
      <span key="armed" className="inline-flex items-center gap-1.5">
        <button
          type="submit"
          disabled={pending}
          // Focused so Enter confirms and Escape cancels. Deliberately *not*
          // disarmed on blur: in a browser window that doesn't hold OS focus the
          // element blurs the instant it mounts, which cancelled the confirm
          // before it could be read. The timeout is the only auto-cancel.
          autoFocus
          onKeyDown={(e) => e.key === "Escape" && setArmed(false)}
          className={buttonClass(
            "danger",
            "sm",
            "border-danger-line bg-danger-soft disabled:cursor-wait",
          )}
        >
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {pending ? pendingLabel : confirmLabel}
        </button>
        {/* Escape and the auto-disarm timeout both cancel already, but
            neither is discoverable — a visible close button is. */}
        {!pending && (
          <button
            type="button"
            onClick={() => setArmed(false)}
            aria-label="Cancel"
            title="Cancel"
            className={iconButtonClass("ghost", "sm")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      key="resting"
      type="button"
      // Belt and braces with the keys above: an explicitly cancelled click has
      // no activation behaviour left to run, whatever the element becomes.
      onClick={(e) => {
        e.preventDefault();
        setArmed(true);
      }}
      title={title ?? children}
      aria-label={children}
      className={iconButtonClass(
        variant,
        size,
        // "ghost" carries no color of its own; every other variant already
        // sets one (danger's red, outline's neutral foreground, etc).
        variant === "ghost" ? "text-danger-text" : "",
      )}
    >
      {icon ?? <Trash2 className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} />}
    </button>
  );
}
