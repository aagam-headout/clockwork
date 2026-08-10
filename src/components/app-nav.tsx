"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Settings, LogOut, ChevronDown } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui";

/*
 * App chrome in the Vercel dashboard shape: a 64px header carrying the mark,
 * a slashed breadcrumb and the account menu, then a 48px tab strip whose
 * active item is marked by a 2px foreground underline flush with the header's
 * bottom border. Replaces the previous sidebar — the sidebar spent 248px of
 * width on four links this app can show as tabs.
 */

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/workflows", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export type NavUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

export function AppNav({ user }: { user: NavUser | null }) {
  const pathname = usePathname();

  // Sign-in/forbidden pages render their own minimal shell — no app chrome.
  if (pathname?.startsWith("/auth")) return null;

  const current = TABS.find((tab) => isActive(pathname, tab.href));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Logo size="sm" />
            <span className="heading-14 hidden text-foreground sm:block">my-workflows</span>
          </Link>
          {current && (
            <>
              <span className="select-none text-lg text-border-strong" aria-hidden>
                /
              </span>
              <span className="truncate text-sm font-medium text-foreground">
                {current.label}
              </span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* The only "new workflow" control in the chrome — pages don't repeat
              it. Collapses to the bare icon on narrow screens. */}
          <Link
            href="/workflows/new"
            title="New workflow"
            className={buttonClass("primary", "sm", "max-sm:w-8 max-sm:px-0")}
          >
            <Plus className="h-4 w-4" />
            <span className="max-sm:sr-only">New workflow</span>
          </Link>
          <ThemeToggle />
          <AccountMenu user={user} />
        </div>
      </div>

      <nav className="mx-auto max-w-6xl px-2 md:px-4">
        <ul className="-mb-px flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className="group relative flex h-12 items-center px-2"
                >
                  <span
                    className={`whitespace-nowrap rounded-control px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "text-foreground"
                        : "text-muted group-hover:bg-surface-hover group-hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </span>
                  {/* Underline sits on the header's bottom border, Vercel-style. */}
                  <span
                    className={`absolute inset-x-2 bottom-0 h-0.5 bg-foreground transition-opacity ${
                      active ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

// Replaces Neon Auth's <UserButton />: that ships its own shadcn styling, which
// doesn't read from this app's tokens. Same destinations — the account view and
// Neon Auth's /auth/sign-out screen — in this app's design language.
function AccountMenu({ user }: { user: NavUser | null }) {
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex cursor-pointer items-center gap-1 rounded-full p-0.5 pr-1 transition-colors hover:bg-surface-hover"
      >
        <Avatar user={user} label={label} />
        <ChevronDown className="h-3.5 w-3.5 text-subtle" />
      </button>

      {open && (
        <div
          role="menu"
          className="rise absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-container border border-border bg-surface shadow-pop"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
            <Avatar user={user} label={label} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
                {label}
              </span>
              {user?.email && user.email !== label && (
                <span className="block truncate text-xs leading-tight text-subtle">
                  {user.email}
                </span>
              )}
            </span>
          </div>

          <div className="p-1">
            <MenuLink href="/workflows/new" icon={Plus} onNavigate={() => setOpen(false)}>
              New workflow
            </MenuLink>
            <MenuLink href="/account/settings" icon={Settings} onNavigate={() => setOpen(false)}>
              Account settings
            </MenuLink>
            <MenuLink href="/auth/sign-out" icon={LogOut} onNavigate={() => setOpen(false)}>
              Sign out
            </MenuLink>
          </div>
        </div>
      )}
    </div>
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
      className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-2 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0 text-subtle" />
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
        className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-solid text-[11px] font-semibold text-solid-fg">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
