import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Network-Constrained Spatiotemporal Geocomputation",
  description: "A Web-GIS platform for crowdsourced road accident intelligence and network-constrained spatiotemporal analysis.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
