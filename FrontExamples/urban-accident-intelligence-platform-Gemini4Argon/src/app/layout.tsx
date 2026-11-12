import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title:
    "Urban Accident Intelligence | Network-Constrained Spatiotemporal Geocomputation & VGI Platform",
  description:
    "Production-grade Web-GIS platform for crowdsourced road accident intelligence, Lixel Linear Referencing, Okabe-Sugihara Network KDE, Network Getis-Ord Gi*, N-DBSCAN, Probabilistic Topological Map-Matching, and Empirical Bayes RTM risk modeling.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-teal-500/30 selection:text-teal-200">
        {children}
      </body>
    </html>
  );
}
