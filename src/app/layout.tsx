import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Nav } from "@/components/nav";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "my-workflows",
  description: "Personal agentic workflow runner",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
