/*
 * Scripts that must run before first paint, plus the storage keys they share
 * with the components that write them.
 *
 * They live in a plain module on purpose: exporting them from a "use client"
 * file turns them into client references when the server layout imports
 * them, so nothing was emitted into the HTML — the theme flashed and the
 * sidebar rail snapped from expanded to collapsed on every load.
 */

export const THEME_KEY = "mw-theme";
export const SIDEBAR_KEY = "mw-sidebar";

/**
 * next-themes' storage key. auth-ui mounts its own ThemeProvider (attribute
 * "class", enableSystem), which owns the `.dark` class and the inline
 * color-scheme on <html> — a style our `[data-theme]` rule can't win against.
 * So the pin is written to both keys and both DOM markers, keeping the auth
 * screens on the same palette as the page they sit in.
 */
export const NEXT_THEMES_KEY = "theme";

/** Applies a pinned palette so the wrong theme never paints. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){var e=document.documentElement;e.setAttribute("data-theme",t);e.classList.toggle("dark",t==="dark");e.style.colorScheme=t}}catch(e){}`;

/** Applies the collapsed rail width so it never renders expanded first. */
export const SIDEBAR_SCRIPT = `try{if(localStorage.getItem("${SIDEBAR_KEY}")==="collapsed")document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){}`;
