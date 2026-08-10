import type { Metadata } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/lib/auth/server";
import { SIDEBAR_SCRIPT, THEME_SCRIPT } from "@/lib/pre-paint";
import "./globals.css";

// The favicon comes from app/icon.svg (file convention) — no static favicon.ico.
export const metadata: Metadata = {
  title: { default: "Clockwork", template: "%s · Clockwork" },
  description: "Scheduled agents that read your apps and report back.",
  applicationName: "Clockwork",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The sidebar's account block needs a name/email; it's a client component, so
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
      <body className="bg-bg min-h-full">
        {/* First thing in <body>, not in <head>: this Next version drops a raw
            <script> placed inside a layout's <head>, which silently killed both
            pre-paint scripts (the theme flashed, the rail snapped). Running here
            still beats first paint. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + SIDEBAR_SCRIPT }}
        />
        <AuthProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <AppSidebar user={user} />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
