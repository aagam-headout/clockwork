import Link from "next/link";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/workflows", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
];

export function Nav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center gap-6 px-6 py-4">
        <span className="text-sm font-medium tracking-tight text-foreground">
          my-workflows
        </span>
        <nav className="flex gap-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
