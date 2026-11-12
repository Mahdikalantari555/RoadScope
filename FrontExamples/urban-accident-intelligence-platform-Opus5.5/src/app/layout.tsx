import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Crowdsourced Web-GIS for Road Safety",
  description: "Crowdsourced road accident reporting, spatiotemporal analysis and transparent road-segment risk assessment. Demonstrated on synthetic data.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0e13" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased font-sans text-[13px]">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
