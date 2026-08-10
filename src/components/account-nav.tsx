"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account/settings", label: "Profile" },
  { href: "/account/security", label: "Security" },
  { href: "/account/model-provider", label: "Model provider" },
];

/**
 * The account section's own tab nav — sibling to, not part of, Neon Auth's
 * `AccountView` (its nav only ever lists that component's own views, and
 * "Model provider" isn't one of them). Rendering it here, once, keeps all
 * three tabs on one bar instead of Auth-UI's nav plus a second, unrelated
 * one for the tab it can't hold.
 */
export function AccountNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: horizontal scroller, same row the desktop rail collapses from. */}
      <nav className="border-border -mx-5 flex gap-1 overflow-x-auto border-b px-5 pb-3 md:hidden">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-control shrink-0 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
              pathname?.startsWith(tab.href)
                ? "bg-surface text-foreground ring-border ring-1"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <nav className="hidden w-48 shrink-0 flex-col gap-1 md:flex lg:w-60">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-control px-4 py-2.5 text-sm font-medium transition-colors ${
              pathname?.startsWith(tab.href)
                ? "bg-surface text-foreground ring-border ring-1"
                : "text-foreground/70 hover:bg-surface-hover"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
