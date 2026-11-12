import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Network-Constrained Spatiotemporal Analysis",
  description: "Web-GIS platform for crowdsourced road accident intelligence: lixel NKDE, network Gi*, N-DBSCAN, Empirical Bayes, VGI conflation and ground-truth benchmarking.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><Shell>{children}</Shell></body>
    </html>
  );
}
