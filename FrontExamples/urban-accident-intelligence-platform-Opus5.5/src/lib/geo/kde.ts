/**
 * Planar Kernel Density Estimation on a regular lattice (projected CRS, metres).
 * Output unit: events per km² (or EPDO-weighted events per km²).
 * Limitation (documented in UI): planar KDE ignores network topology and spreads density off-road;
 * a Network-KDE (Okabe et al., 2009) is the recommended future extension.
 */
import type { BBox, XY } from "./geometry";

export type Kernel = "quartic" | "epanechnikov" | "gaussian";

export interface WeightedPoint {
  x: number;
  y: number;
  w: number;
}

export interface KdeParams {
  cellSize: number;
  bandwidth: number | null; // null → Silverman-type rule
  kernel: Kernel;
}

export interface KdeCell {
  i: number;
  j: number;
  x: number; // cell centre
  y: number;
  value: number;
}

export interface KdeResult {
  cells: KdeCell[];
  bandwidth: number;
  bandwidthRule: string;
  cellSize: number;
  max: number;
  totalMass: number;
  unit: string;
}

/** Spatial-variant of Silverman's rule (as used by common GIS packages). */
export function silvermanBandwidth(points: XY[]): { h: number; sd: number; dm: number } {
  const n = points.length;
  if (n < 2) return { h: 250, sd: 0, dm: 0 };
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const sd = Math.sqrt(points.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / n);
  const d = points.map((p) => Math.hypot(p[0] - mx, p[1] - my)).sort((a, b) => a - b);
  const dm = d[Math.floor(n / 2)];
  const h = 0.9 * Math.min(sd, Math.sqrt(1 / Math.LN2) * dm) * Math.pow(n, -0.2);
  return { h, sd, dm };
}

function kernelValue(kernel: Kernel, u: number): number {
  switch (kernel) {
    case "quartic":
      return u < 1 ? (3 / Math.PI) * (1 - u * u) ** 2 : 0;
    case "epanechnikov":
      return u < 1 ? (2 / Math.PI) * (1 - u * u) : 0;
    case "gaussian":
      return u < 3 ? (1 / (2 * Math.PI)) * Math.exp((-u * u) / 2) : 0;
  }
}

export function kde(points: WeightedPoint[], extent: BBox, params: KdeParams, mask?: (x: number, y: number) => boolean): KdeResult {
  const xy: XY[] = points.map((p) => [p.x, p.y]);
  const rule = silvermanBandwidth(xy);
  const h = params.bandwidth && params.bandwidth > 0 ? params.bandwidth : Math.max(50, rule.h);
  const s = params.cellSize;
  const nx = Math.max(1, Math.ceil((extent.maxX - extent.minX) / s));
  const ny = Math.max(1, Math.ceil((extent.maxY - extent.minY) / s));
  const grid = new Float64Array(nx * ny);
  const support = params.kernel === "gaussian" ? 3 * h : h;
  for (const p of points) {
    const i0 = Math.max(0, Math.floor((p.x - support - extent.minX) / s));
    const i1 = Math.min(nx - 1, Math.floor((p.x + support - extent.minX) / s));
    const j0 = Math.max(0, Math.floor((p.y - support - extent.minY) / s));
    const j1 = Math.min(ny - 1, Math.floor((p.y + support - extent.minY) / s));
    for (let i = i0; i <= i1; i++) {
      const cx = extent.minX + (i + 0.5) * s;
      for (let j = j0; j <= j1; j++) {
        const cy = extent.minY + (j + 0.5) * s;
        const u = Math.hypot(cx - p.x, cy - p.y) / h;
        const k = kernelValue(params.kernel, u);
        if (k > 0) grid[j * nx + i] += (p.w * k) / (h * h);
      }
    }
  }
  const cells: KdeCell[] = [];
  let max = 0;
  let total = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = grid[j * nx + i] * 1e6; // per m² → per km²
      if (v <= 0) continue;
      const x = extent.minX + (i + 0.5) * s;
      const y = extent.minY + (j + 0.5) * s;
      if (mask && !mask(x, y)) continue;
      cells.push({ i, j, x, y, value: v });
      total += (v * s * s) / 1e6;
      if (v > max) max = v;
    }
  return {
    cells,
    bandwidth: h,
    bandwidthRule: params.bandwidth ? "user-defined" : `Silverman spatial rule (SD=${rule.sd.toFixed(0)} m, Dm=${rule.dm.toFixed(0)} m)`,
    cellSize: s,
    max,
    totalMass: total,
    unit: "events / km²",
  };
}
