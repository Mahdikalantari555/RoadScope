// Perceptually uniform / colorblind-safe ramps (sampled control points, linearly interpolated)
const VIRIDIS = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
const INFERNO = ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"];
const RDBU = ["#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b"];
const MAGMA = ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"];

export type RampName = "viridis" | "inferno" | "rdbu" | "magma";
const RAMPS: Record<RampName, string[]> = { viridis: VIRIDIS, inferno: INFERNO, rdbu: RDBU, magma: MAGMA };

function hex2rgb(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
export function ramp(name: RampName, t: number): string {
  const c = RAMPS[name]; const x = Math.max(0, Math.min(1, isFinite(t) ? t : 0)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x)); const f = x - i;
  const a = hex2rgb(c[i]), b = hex2rgb(c[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
export function rampStops(name: RampName, n = 8) { return Array.from({ length: n }, (_, i) => ramp(name, i / (n - 1))); }

export const SEVERITY_COLORS: Record<string, string> = { pdo: "#7d8795", minor: "#fbbf24", serious: "#f97316", fatal: "#ef4444" };
export const CLASS_COLORS: Record<string, string> = { arterial: "#8b96a5", collector: "#5f6b7a", local: "#3d4654" };
export const GI_COLORS: Record<string, string> = { hot99: "#b2182b", hot95: "#ef8a62", hot_uncorrected: "#fddbc7", ns: "#4b5563", cold_uncorrected: "#d1e5f0", cold95: "#67a9cf", cold99: "#2166ac" };
export const STATUS_COLORS: Record<string, string> = { verified: "#4ade80", raw: "#5ec8f2", flagged: "#fbbf24", rejected: "#f87171", merged: "#a78bfa" };

/** Bivariate risk × uncertainty: hue from risk, desaturate/lighten by uncertainty */
export function bivariate(risk: number, uncertainty: number) {
  const base = ramp("inferno", 0.15 + 0.85 * risk);
  const m = base.match(/\d+/g)!.map(Number);
  const g = (m[0] + m[1] + m[2]) / 3;
  const u = Math.max(0, Math.min(1, uncertainty)) * 0.8;
  return `rgb(${Math.round(m[0] + (g - m[0]) * u)},${Math.round(m[1] + (g - m[1]) * u)},${Math.round(m[2] + (g - m[2]) * u)})`;
}
