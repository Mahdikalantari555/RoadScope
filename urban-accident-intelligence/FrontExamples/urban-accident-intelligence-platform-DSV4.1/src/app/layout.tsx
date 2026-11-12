import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Vantia",
  description:
    "Crowdsourced road-accident reporting and spatiotemporal road-safety intelligence for the synthetic city of Vantia. Web-GIS demonstration platform.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('uai-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <AppShell session={session}>{children}</AppShell>
      </body>
    </html>
  );
}
