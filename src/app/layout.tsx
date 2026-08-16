import type { Metadata } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider } from "@/components/auth-provider";
import { auth } from "@/lib/auth/server";
import { LOCAL_AUTH_BYPASS, LOCAL_OWNER_EMAIL } from "@/lib/auth/local";
import { SIDEBAR_SCRIPT, THEME_SCRIPT } from "@/lib/pre-paint";
import "./globals.css";

// The favicon comes from app/icon.svg (file convention) — no static favicon.ico.
export const metadata: Metadata = {
  title: { default: "Clockwork", template: "%s · Clockwork" },
  description: "Scheduled agents that read your apps and report back.",
  applicationName: "Clockwork",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sidebar's account block needs name/email, but it's a client component, so
  // the session is read here (deduped per request by the auth client). connection()
  // opts every route out of prerendering first — otherwise the cookie read below
  // throws mid-build for the two pages that would otherwise be static
  // (/_not-found, /auth/forbidden).
  await connection();
  const user = LOCAL_AUTH_BYPASS
    ? { name: null, email: LOCAL_OWNER_EMAIL, image: null }
    : await (async () => {
        const { data: session } = await auth.getSession();
        return session?.user
          ? {
              name: session.user.name ?? null,
              email: session.user.email ?? null,
              image: session.user.image ?? null,
            }
          : null;
      })();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="bg-bg min-h-full">
        {/* In <body>, not <head>: this Next version drops a raw <script> in a
            layout's <head>, which silently killed both pre-paint scripts (theme
            flashed, rail snapped). Still beats first paint here. */}
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
