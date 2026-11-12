import type { AccidentPoint } from "@/lib/domain";

/** Length of the observed accident window in years (≥ 1) for annualised exposure rates. */
export function observationYears(points: AccidentPoint[]): number {
  if (points.length < 2) return 1;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.tMs);
    max = Math.max(max, p.tMs);
  }
  return Math.max(1, (max - min) / (365.25 * 24 * 3600 * 1000));
}
