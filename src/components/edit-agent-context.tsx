"use client";

import { createContext, useContext, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { buttonClass } from "@/components/ui";

/*
 * The toggle button lives in the page header, beside "Run now" — but the
 * thing it toggles (the agent chat pane) renders inside `EditWorkflowClient`,
 * further down the page and outside the header's own component tree. A
 * context is the shortest path between the two without threading the state
 * through the server-rendered page as props.
 */
const EditAgentContext = createContext<{
  open: boolean;
  toggle: () => void;
} | null>(null);

export function EditAgentProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <EditAgentContext.Provider
      value={{ open, toggle: () => setOpen((v) => !v) }}
    >
      {children}
    </EditAgentContext.Provider>
  );
}

export function useEditAgent() {
  const ctx = useContext(EditAgentContext);
  if (!ctx) {
    throw new Error("useEditAgent must be used within EditAgentProvider");
  }
  return ctx;
}

/**
 * One button, one style, both states — "Edit with agent" and "Close agent"
 * are the same element with its label and icon swapped, not two differently
 * styled buttons standing in for each other.
 */
export function EditAgentButton() {
  const { open, toggle } = useEditAgent();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      className={buttonClass("outline", "sm", "gap-1.5")}
    >
      {open ? (
        <X className="h-3.5 w-3.5" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {open ? "Close agent" : "Edit with agent"}
    </button>
  );
}
