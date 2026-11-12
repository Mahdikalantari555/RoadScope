import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urban Accident Intelligence — Meridian District Console",
  description:
    "Crowdsourced road accident reporting, spatiotemporal analysis and transparent urban road-safety risk assessment. All data served by this build is synthetic.",
  keywords: [
    "road safety",
    "Web-GIS",
    "spatial analysis",
    "kernel density",
    "Getis-Ord Gi*",
    "DBSCAN",
    "crowdsourced reporting",
  ],
};

export const viewport: Viewport = {
  themeColor: "#0b0e11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
