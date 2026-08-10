import type { Metadata } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppNav } from "@/components/app-nav";
import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/lib/auth/server";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import "./globals.css";

// The favicon comes from app/icon.svg (file convention) — no static favicon.ico.
export const metadata: Metadata = {
  title: { default: "my-workflows", template: "%s · my-workflows" },
  description: "Scheduled agents that read your apps and report back.",
  applicationName: "my-workflows",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The sidebar's account card needs a name/email; it's a client component, so
  // the session is read here (deduped per request by the auth client) instead of
  // re-fetching it in the browser. connection() opts every route out of
  // prerendering first — otherwise the cookie read below throws mid-build for
  // the two pages that would otherwise be static (/_not-found, /auth/forbidden).
  await connection();
  const { data: session } = await auth.getSession();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full bg-bg">
        <AuthProvider>
          <div className="flex min-h-screen flex-col">
            <AppNav user={user} />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
