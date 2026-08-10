"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@neondatabase/auth-ui";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/workflows", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
];

export function Nav() {
  const pathname = usePathname();

  // Sign-in/forbidden pages render their own minimal shell — no app chrome.
  if (pathname?.startsWith("/auth")) return null;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium tracking-tight text-foreground">
            my-workflows
          </span>
          <nav className="flex gap-4">
            {LINKS.map((link) => {
              const active =
                link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm transition-colors ${
                    active ? "font-medium text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <UserButton />
      </div>
    </header>
  );
}
