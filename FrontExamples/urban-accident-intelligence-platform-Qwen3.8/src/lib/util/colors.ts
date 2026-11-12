/**
 * Colourblind-safe perceptual ramps (Viridis family, matplotlib) plus
 * ColorBrewer sequential / diverging schemes and a bivariate
 * uncertainty-modulated scheme. All colours are authored as sRGB hex stops and
 * interpolated in sRGB (documented approximation; stop spacing is perceptually
 * near-uniform by construction of the source ramps).
 */

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

function toRgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function ramp(stops: string[]) {
  const rgb = stops.map(toRgb);
  return (t: number): string => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
    const scaled = clamped * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const a = rgb[i];
    const b = rgb[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(
      a[2] + (b[2] - a[2]) * f,
    )})`;
  };
}

export const RAMPS: Record<string, (t: number) => string> = {
  viridis: ramp(["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"]),
  inferno: ramp(["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"]),
  magma: ramp(["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"]),
  plasma: ramp(["#0d0887", "#41049d", "#6a00a8", "#8f0da4", "#b12a90", "#cc4778", "#e16462", "#f2844b", "#fca636", "#fcce25"]),
  cividis: ramp(["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"]),
  // ColorBrewer
  ylorrd: ramp(["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"]),
  rdpu: ramp(["#fff7f3", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177", "#49006a"]),
  blues: ramp(["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"]),
  greens: ramp(["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"]),
  purples: ramp(["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"]),
  orrd: ramp(["#fff7ec", "#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"]),
  rdbu: ramp(["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"]),
  puor: ramp(["#7f3b08", "#b35806", "#e08214", "#fdb863", "#fee0b6", "#d8daeb", "#b2abd2", "#8073ac", "#542788", "#2d004b"]),
  spectral: ramp(["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"]),
  greys: ramp(["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"]),
};

export type RampName = keyof typeof RAMPS;

export function rampNames(): string[] {
  return Object.keys(RAMPS);
}

export function colorFor(rampName: string, t: number): string {
  const fn = RAMPS[rampName] ?? RAMPS.viridis;
  return fn(t);
}

export function rgba(rampName: string, t: number, alpha: number): string {
  const c = colorFor(rampName, t);
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
  if (!m) return c;
  return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
}

/** Discrete class breaks for legends (quantile or equal interval). */
export function classBreaks(values: number[], n: number, mode: "quantile" | "equal" = "quantile"): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return Array.from({ length: n + 1 }, (_, i) => i / n);
  if (mode === "equal") {
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    return Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
  }
  const sorted = finite.slice().sort((a, b) => a - b);
  return Array.from({ length: n + 1 }, (_, i) => sorted[Math.min(sorted.length - 1, Math.floor((i / n) * sorted.length))]);
}

export function normalizeWithBreaks(value: number, breaks: number[]): number {
  if (!Number.isFinite(value)) return 0;
  const min = breaks[0];
  const max = breaks[breaks.length - 1];
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Diverging scale centred on zero (for NKDE − planar KDE difference maps). */
export function divergingFromZero(value: number, absMax: number, rampName = "rdbu"): string {
  const m = Math.max(1e-12, absMax);
  return colorFor(rampName, 0.5 + Math.min(1, Math.max(-1, value / m)) * 0.5);
}

export const SEVERITY_COLORS: Record<string, string> = {
  fatal: "#d81b60",
  serious_injury: "#fb8c00",
  minor_injury: "#fdd835",
  property_damage: "#42a5f5",
  near_miss: "#78909c",
};

export const ROAD_CLASS_COLORS: Record<string, string> = {
  motorway: "#f97316",
  primary: "#eab308",
  secondary: "#38bdf8",
  tertiary: "#a78bfa",
  residential: "#94a3b8",
  service: "#64748b",
};

/** Bivariate legend swatch matrix: risk (x) × uncertainty (y). */
export function bivariateColor(riskT: number, uncertaintyT: number): string {
  // Dark-purple (low risk / low uncertainty) -> magenta (high risk) -> pale blue (high uncertainty)
  const base = toRgb(RAMPS.inferno(Math.min(1, riskT)).replace("rgb(", "#").length ? "#000000" : "#000000");
  void base;
  const r = Math.round(30 + riskT * 190 + uncertaintyT * 20);
  const g = Math.round(30 + (1 - riskT) * 60 + uncertaintyT * 130);
  const b = Math.round(60 + (1 - riskT) * 150 + uncertaintyT * 40);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}
