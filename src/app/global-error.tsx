"use client";

import { useEffect } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { OctagonAlert, RotateCw } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { buttonClass } from "@/components/ui";
import { THEME_SCRIPT } from "@/lib/pre-paint";
import "./globals.css";

/**
 * The root layout itself failed, so `app/error.tsx` never mounts and neither
 * does the sidebar — this file has to supply its own `<html>`/`<body>` and
 * re-import the stylesheet. The theme pre-paint script comes along too, so the
 * failure screen doesn't flash white on a dark install.
 *
 * There is no "go to workflows" link here: navigation is what just failed, and
 * a full reload is the honest way out.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="bg-bg min-h-full">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ErrorState
          icon={OctagonAlert}
          code={error.digest ? "500" : "Error"}
          title="Clockwork failed to load"
          description="The app couldn't start rendering at all. Reloading clears the transient causes; if it keeps happening, the details below are what to report."
          actions={
            <button
              type="button"
              onClick={reset}
              className={buttonClass("primary", "sm")}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Reload
            </button>
          }
          details={[
            { label: "Digest", value: error.digest ?? "" },
            { label: "Message", value: error.message ?? "" },
          ]}
        />
      </body>
    </html>
  );
}
