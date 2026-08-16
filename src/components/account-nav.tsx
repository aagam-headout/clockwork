"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account/settings", label: "Profile & security" },
  { href: "/account/model-provider", label: "Model provider" },
  { href: "/account/workflow-defaults", label: "Workflow defaults" },
];

/**
 * Account section's own tab nav — sibling to Neon Auth's `AccountView`, not
 * part of it (its nav only lists its own views, and "Model provider" isn't
 * one). Rendered here once so all three tabs share one bar instead of
 * Auth-UI's nav plus a second one for the tab it can't hold.
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
