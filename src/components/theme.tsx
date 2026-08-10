"use client";

import { useSyncExternalStore } from "react";
import { NEXT_THEMES_KEY, THEME_KEY } from "@/lib/pre-paint";

type Theme = "light" | "dark";

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
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private-mode / disabled storage — fall through to the OS preference.
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    // auth-ui's next-themes provider reads this on mount; without it the auth
    // and account screens follow the OS while the rest of the app is pinned.
    localStorage.setItem(NEXT_THEMES_KEY, theme);
  } catch {
    // Non-persistent is still better than not switching at all.
  }
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // next-themes only re-reads storage on mount and on cross-tab events, so its
  // two markers are flipped here directly.
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  for (const listener of listeners) listener();
}

/**
 * Current palette, for the chrome that renders the control — the sidebar's
 * Appearance row is the only one. Server snapshot
 * is "light"; the pre-paint script has already applied the pinned palette, and
 * suppressHydrationWarning on <html> covers the mismatch.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);
}

/** Flip light ⇄ dark. */
export function toggleTheme() {
  setTheme(getSnapshot() === "dark" ? "light" : "dark");
}
