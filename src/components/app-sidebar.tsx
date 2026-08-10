"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  Workflow,
  History,
  Plug,
  Plus,
  Menu,
  X,
  Settings,
  LogOut,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from "lucide-react";
import { toggleTheme, useTheme } from "@/components/theme";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui";
import { SIDEBAR_KEY } from "@/lib/pre-paint";

/*
 * Left rail chrome. A horizontal tab bar cost 112px of every viewport's height
 * — expensive on a screen whose main jobs (a chat column, a long form, a run
 * trace) are all vertical. The rail spends horizontal space instead, and can
 * collapse to a 60px icon strip when the content wants that back.
 *
 * Below `md` it collapses to a 56px top bar plus a slide-in drawer; the
 * expand/collapse state is desktop-only.
 */

const LINKS = [
  { href: "/", label: "Overview", icon: CalendarDays },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/runs", label: "Runs", icon: History },
  { href: "/connections", label: "Connections", icon: Plug },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/* ---------- collapsed state ----------
 * Kept on <html data-sidebar> so CSS alone sizes the rail (see globals.css) and
 * nothing flashes at the wrong width. localStorage is the external store, read
 * the same way the theme toggle reads its own. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/*
 * Between 768px and 1000px the rail is collapsed no matter what's stored (see
 * globals.css) — this mirrors that breakpoint so the JS-side bits that care
 * (which icon the toggle shows, where the account menu hangs) agree with it.
 */
const NARROW_QUERY = "(min-width: 768px) and (max-width: 999.98px)";

function subscribeNarrow(onChange: () => void) {
  const mql = window.matchMedia(NARROW_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getNarrow() {
  return window.matchMedia(NARROW_QUERY).matches;
}

function setCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Non-persistent is still better than not toggling at all.
  }
  const root = document.documentElement;
  if (collapsed) root.setAttribute("data-sidebar", "collapsed");
  else root.removeAttribute("data-sidebar");
  for (const listener of listeners) listener();
}

export type NavUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

export function AppSidebar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, () => false);
  const collapsed = stored || narrow;

  // Sign-in/forbidden pages render their own minimal shell — no app chrome.
  if (pathname?.startsWith("/auth")) return null;

  const close = () => setDrawer(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="border-border bg-bg/80 sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 backdrop-blur-md md:hidden">
        <Brand />
        <IconButton
          label={drawer ? "Close navigation" : "Open navigation"}
          onClick={() => setDrawer((v) => !v)}
        >
          {drawer ? (
            <X className="h-4.5 w-4.5" />
          ) : (
            <Menu className="h-4.5 w-4.5" />
          )}
        </IconButton>
      </div>

      {drawer && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={close}
          className="bg-bg/60 fixed inset-0 top-14 z-30 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`sidebar border-border bg-bg-subtle max-md:shadow-pop z-40 flex w-[240px] shrink-0 flex-col max-md:fixed max-md:inset-y-14 max-md:left-0 max-md:border-r max-md:transition-transform ${drawer ? "max-md:translate-x-0" : "max-md:-translate-x-full"} md:sticky md:top-0 md:h-screen md:translate-x-0 md:border-r`}
      >
        {/* Top row: brand while expanded, and the rail toggle — which takes the
            brand's place once collapsed so it stays in the same spot. */}
        <div className="sidebar-row hidden h-14 shrink-0 items-center gap-2 px-3 md:flex">
          <span className="sidebar-label min-w-0 flex-1">
            <Brand />
          </span>
          <IconButton
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </IconButton>
        </div>

        <div className="px-2.5 py-3 md:pt-1">
          <Link
            href="/workflows/new"
            onClick={close}
            title="New workflow"
            className={buttonClass(
              "primary",
              "sm",
              "sidebar-row w-full gap-1.5",
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="sidebar-label">New workflow</span>
          </Link>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-1">
          <p className="sidebar-label text-subtle mb-1 px-2.5 text-[11px] font-medium tracking-wider uppercase">
            Workspace
          </p>
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                title={label}
                aria-current={active ? "page" : undefined}
                className={`sidebar-row group rounded-control flex h-9 items-center gap-2.5 px-2.5 text-[13px] transition-colors ${
                  active
                    ? "bg-surface text-foreground ring-border font-medium ring-1"
                    : "text-muted hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-foreground" : "text-subtle group-hover:text-muted"}`}
                />
                <span className="sidebar-label truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        <AccountBlock user={user} collapsed={collapsed} onNavigate={close} />
      </aside>
    </>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-control text-muted hover:bg-surface-hover hover:text-foreground flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center transition-colors"
    >
      {children}
    </button>
  );
}

// Replaces Neon Auth's <UserButton />: that ships its own shadcn styling, which
// doesn't read from this app's tokens. Same destinations — the account view and
// Neon Auth's /auth/sign-out screen — in this app's design language.
function AccountBlock({
  user,
  collapsed,
  onNavigate,
}: {
  user: NavUser | null;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = user?.name?.trim() || user?.email || "Account";
  const dismiss = () => {
    setOpen(false);
    onNavigate();
  };

  return (
    <div ref={ref} className="border-border relative shrink-0 border-t p-2">
      {open && (
        <div
          role="menu"
          className={`rise rounded-container border-border bg-surface shadow-pop absolute bottom-full z-50 mb-1 overflow-hidden border p-1 ${
            // Collapsed, there's no room to sit inside the rail — hang it off
            // the right edge instead.
            collapsed ? "left-1 w-56" : "inset-x-2"
          }`}
        >
          {collapsed && (
            <p className="text-foreground truncate px-2 py-1.5 text-[13px] font-medium">
              {label}
            </p>
          )}
          <MenuLink
            href="/account/settings"
            icon={Settings}
            onNavigate={dismiss}
          >
            Account settings
          </MenuLink>
          <AppearanceRow />
          <MenuLink href="/auth/sign-out" icon={LogOut} onNavigate={dismiss}>
            Sign out
          </MenuLink>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className="sidebar-row rounded-control hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2.5 px-1.5 py-1.5 text-left transition-colors"
      >
        <Avatar user={user} label={label} />
        <span className="sidebar-label min-w-0 flex-1">
          <span className="text-foreground block truncate text-[13px] leading-tight font-medium">
            {label}
          </span>
          {user?.email && user.email !== label && (
            <span className="text-subtle block truncate text-xs leading-tight">
              {user.email}
            </span>
          )}
        </span>
        <ChevronsUpDown className="sidebar-label text-subtle h-3.5 w-3.5 shrink-0" />
      </button>
    </div>
  );
}

/**
 * Theme control, as a menu row rather than a lone icon in the chrome: it's a
 * preference, and preferences live with the account. Clicking flips light ⇄
 * dark and leaves the menu open so the change is visible in place.
 */
function AppearanceRow() {
  const theme = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="menuitem"
      onClick={toggleTheme}
      aria-label={`Appearance: ${dark ? "dark" : "light"} — switch to ${dark ? "light" : "dark"}`}
      className="rounded-control text-muted hover:bg-surface-hover hover:text-foreground flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-[13px] transition-colors"
    >
      {dark ? (
        <Moon className="text-subtle h-4 w-4 shrink-0" />
      ) : (
        <Sun className="text-subtle h-4 w-4 shrink-0" />
      )}
      Appearance
      <span className="text-subtle ml-auto text-xs capitalize">
        {dark ? "dark" : "light"}
      </span>
    </button>
  );
}

function MenuLink({
  href,
  icon: Icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="rounded-control text-muted hover:bg-surface-hover hover:text-foreground flex cursor-pointer items-center gap-2 px-2 py-2 text-[13px] transition-colors"
    >
      <Icon className="text-subtle h-4 w-4 shrink-0" />
      {children}
    </Link>
  );
}

function Avatar({ user, label }: { user: NavUser | null; label: string }) {
  if (user?.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar host is arbitrary
      <img
        src={user.image}
        alt=""
        className="ring-border h-7 w-7 shrink-0 rounded-full object-cover ring-1"
      />
    );
  }
  return (
    <span className="bg-solid text-solid-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      title="Clockwork"
      className="flex min-w-0 items-center gap-2"
    >
      <Logo size="sm" />
      <span className="sidebar-label heading-14 text-foreground truncate">
        Clockwork
      </span>
    </Link>
  );
}
