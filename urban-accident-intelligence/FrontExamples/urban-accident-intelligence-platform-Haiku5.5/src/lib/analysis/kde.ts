/**
 * Kernel density estimation on a regular planar grid (EPSG:32633 metres).
 * Output unit: events per km². Cell values are evaluated only where `cellMask` is true.
 */

export interface KdeEvent {
  x: number;
  y: number;
  weight: number;
}

export interface KdeOptions {
  bandwidthM: number;
  cellSizeM: number;
  kernel: "quartic" | "gaussian";
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cellMask?: (cx: number, cy: number) => boolean;
}

export interface KdeGrid {
  minX: number;
  minY: number;
  cellSizeM: number;
  cols: number;
  rows: number;
  /** Events per km² at each cell centre (row-major, row 0 = south). */
  values: Float64Array;
  evaluated: Uint8Array;
}

/**
 * Quartic kernel: K(u) = 3/(π h²) (1 − u²)² for u ≤ 1 (integrates to 1).
 * Gaussian kernel: σ = h, truncated at 3h, K = 1/(2π h²) exp(−u²/2).
 */
export function kernelDensity(events: KdeEvent[], opts: KdeOptions): KdeGrid {
  const h = opts.bandwidthM;
  const cs = opts.cellSizeM;
  const { minX, minY, maxX, maxY } = opts.bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cs));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cs));
  const values = new Float64Array(cols * rows);
  const evaluated = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const cy = minY + (r + 0.5) * cs;
    for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cs;
      evaluated[r * cols + c] = !opts.cellMask || opts.cellMask(cx, cy) ? 1 : 0;
    }
  }

  const radius = opts.kernel === "quartic" ? h : 3 * h;
  const r2 = radius * radius;
  const h2 = h * h;
  const norm = opts.kernel === "quartic" ? (3 / (Math.PI * h2)) : 1 / (2 * Math.PI * h2);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  for (const e of events) {
    const c0 = clamp(Math.floor((e.x - radius - minX) / cs), 0, cols - 1);
    const c1 = clamp(Math.floor((e.x + radius - minX) / cs), 0, cols - 1);
    const r0 = clamp(Math.floor((e.y - radius - minY) / cs), 0, rows - 1);
    const r1 = clamp(Math.floor((e.y + radius - minY) / cs), 0, rows - 1);
    for (let r = r0; r <= r1; r++) {
      const dy = minY + (r + 0.5) * cs - e.y;
      const dy2 = dy * dy;
      if (dy2 > r2) continue;
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        if (!evaluated[idx]) continue;
        const dx = minX + (c + 0.5) * cs - e.x;
        const d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        const u2 = d2 / h2;
        const k = opts.kernel === "quartic" ? norm * (1 - u2) * (1 - u2) : norm * Math.exp(-0.5 * u2);
        values[idx] = values[idx]! + e.weight * k;
      }
    }
  }

  for (let i = 0; i < values.length; i++) values[i] = values[i]! * 1e6;
  return { minX, minY, cellSizeM: cs, cols, rows, values, evaluated };
}
