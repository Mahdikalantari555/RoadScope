import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { seedReferenceData } from "@/lib/bootstrap";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Network-Constrained Spatiotemporal Analysis",
  description:
    "Web-GIS research platform for crowdsourced road-accident intelligence: lixel-based network KDE, Network Getis-Ord G*, N-DBSCAN, VGI conflation, Empirical Bayes exposure adjustment and stochastic ground-truth benchmarking.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reference vocabularies + persona accounts are materialised on boot so the
  // platform is scientifically usable with zero external data.
  await seedReferenceData();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
