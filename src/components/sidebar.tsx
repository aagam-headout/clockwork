"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@neondatabase/auth-ui";
import { TodayIcon, WorkflowsIcon, RunsIcon, ConnectionsIcon } from "@/components/icons";

const LINKS = [
  { href: "/", label: "Today", icon: TodayIcon },
  { href: "/workflows", label: "Workflows", icon: WorkflowsIcon },
  { href: "/runs", label: "Runs", icon: RunsIcon },
  { href: "/connections", label: "Connections", icon: ConnectionsIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  // Sign-in/forbidden pages render their own minimal shell — no app chrome.
  if (pathname?.startsWith("/auth")) return null;

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col justify-between border-r border-border px-3 py-5">
      <div>
        <div className="px-2 text-sm font-medium tracking-tight text-foreground">
          my-workflows
        </div>
        <nav className="mt-8 flex flex-col gap-0.5">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? "bg-card font-medium text-foreground"
                    : "text-muted hover:bg-card hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="px-1">
        <UserButton />
      </div>
    </aside>
  );
}
