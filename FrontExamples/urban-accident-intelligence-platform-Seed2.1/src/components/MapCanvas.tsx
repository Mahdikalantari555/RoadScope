"use client";
import dynamicNext from "next/dynamic";

// Completely isolate Leaflet from the SSR bundle
const LeafletMap = dynamicNext(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-[var(--bg-secondary)]">
      <div className="spinner" />
    </div>
  ),
});

// Re-export the MapLegend from the leaflet module too, it needs the map context
const Legend = dynamicNext(
  () => import("./LeafletMap").then(m => ({ default: m.MapLegend })),
  { ssr: false }
);

export default function MapCanvas() {
  return <LeafletMap />;
}

export { Legend as MapLegend };
