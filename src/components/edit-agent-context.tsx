"use client";

import { createContext, useContext, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { buttonClass } from "@/components/ui";

/*
 * The toggle button lives in the page header, beside "Run now", but what it
 * toggles (the agent chat pane) renders inside `EditWorkflowClient` — outside
 * the header's tree. Context is the shortest path between the two, avoiding
 * threading state through the server-rendered page as props.
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
 * are the same element with label and icon swapped, not two buttons.
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
