"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "mw-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/*
 * The pinned theme lives in localStorage (an external store), so it's read via
 * useSyncExternalStore rather than an effect: cross-tab changes sync for free
 * through the `storage` event, and an unpinned tab follows the OS through the
 * matchMedia subscription below.
 *
 * The snapshot is the *resolved* theme, never "system" — the toggle has to know
 * which palette is actually on screen. Reporting "system" made the first click a
 * no-op whenever the OS already matched the next theme in the cycle.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

function getSnapshot(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private-mode / disabled storage — fall through to the OS preference.
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-persistent is still better than not switching at all.
  }
  document.documentElement.setAttribute("data-theme", theme);
  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  // Server snapshot is "light"; the pre-paint script has already applied the
  // pinned palette, and suppressHydrationWarning on <html> covers the mismatch.
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

/** Inlined before paint so a pinned theme never flashes the wrong palette. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
