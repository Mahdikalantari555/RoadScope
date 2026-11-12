import type { StyleSpecification } from "maplibre-gl";

export type BasemapVariant = "night" | "day" | "minimal";

export const BASEMAP_OPTIONS: { value: BasemapVariant; label: string; description: string }[] = [
  { value: "night", label: "Vantia night", description: "High-contrast cartography for analytical overlays" },
  { value: "day", label: "Vantia daylight", description: "Light cartography for print and bright rooms" },
  { value: "minimal", label: "Analytical minimal", description: "Roads only, maximum overlay contrast" },
];

export type BasemapColors = {
  background: string;
  districtFill: string;
  districtLine: string;
  waterFill: string;
  waterLine: string;
  parkFill: string;
  parkLine: string;
  roadLocal: string;
  roadSecondary: string;
  roadArterial: string;
  roadRing: string;
  intersection: string;
};

export function basemapColors(variant: BasemapVariant): BasemapColors {
  switch (variant) {
    case "day":
      return {
        background: "#eef1f4",
        districtFill: "#ffffff",
        districtLine: "#d6dee6",
        waterFill: "#cfe2ee",
        waterLine: "#a9c5d8",
        parkFill: "#e2eede",
        parkLine: "#c3d8bf",
        roadLocal: "#ffffff",
        roadSecondary: "#f4f7fa",
        roadArterial: "#e4eaf1",
        roadRing: "#d3dde7",
        intersection: "#8fa2b5",
      };
    case "minimal":
      return {
        background: "#060a10",
        districtFill: "#070c12",
        districtLine: "#141f2b",
        waterFill: "#0a1620",
        waterLine: "#10222f",
        parkFill: "#0a1218",
        parkLine: "#12202a",
        roadLocal: "#1a2430",
        roadSecondary: "#223040",
        roadArterial: "#2e4054",
        roadRing: "#3c526a",
        intersection: "#4a5f74",
      };
    default:
      return {
        background: "#070c12",
        districtFill: "#0a1119",
        districtLine: "#182634",
        waterFill: "#0a1d2b",
        waterLine: "#15364a",
        parkFill: "#0b1a14",
        parkLine: "#1a3a2a",
        roadLocal: "#1e2b3a",
        roadSecondary: "#283848",
        roadArterial: "#3a4e63",
        roadRing: "#506478",
        intersection: "#5c7288",
      };
  }
}

/** Empty MapLibre style; all data layers are attached after the map loads. */
export function baseStyle(variant: BasemapVariant): StyleSpecification {
  const colors = basemapColors(variant);
  return {
    version: 8,
    name: `Vantia ${variant}`,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": colors.background },
      },
    ],
  };
}

export const SEVERITY_COLORS: Record<number, string> = {
  1: "#7d8fa3",
  2: "#e3b341",
  3: "#f2762e",
  4: "#e5402a",
};

export const STATUS_COLORS: Record<string, string> = {
  verified: "#2dd4bf",
  reported: "#e3b341",
  rejected: "#7d8fa3",
  duplicate: "#a78bfa",
};

export const HOTSPOT_COLORS: Record<string, string> = {
  hot_99: "#e5402a",
  hot_95: "#f2762e",
  hot_90: "#e3b341",
  cold_99: "#1d4ed8",
  cold_95: "#3b82f6",
  cold_90: "#93c5fd",
  not_significant: "#64748b",
  isolated: "#cbd5e1",
};

export const RISK_RAMP: [number, string][] = [
  [0, "#164e63"],
  [0.28, "#0e7490"],
  [0.5, "#22d3ee"],
  [0.68, "#e3b341"],
  [0.84, "#f2762e"],
  [1, "#e5402a"],
];
