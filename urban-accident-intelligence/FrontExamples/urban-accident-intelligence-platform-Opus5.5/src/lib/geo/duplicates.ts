/**
 * Spatio-temporal duplicate report detection.
 * Hard gates: distance ≤ radius (m) and |Δt| ≤ window (min). Soft similarity score in [0,1]:
 *   S = 0.40·exp(−d/60) + 0.35·exp(−|Δt|/45) + 0.15·[same category] + 0.10·(1 − |Δseverity|/3)
 */
export interface DupRecord {
  id: number;
  x: number;
  y: number;
  t: number; // epoch ms
  category: string;
  severityRank: number;
}

export interface DupOptions {
  radius: number;
  windowMin: number;
  threshold: number;
}

export const DEFAULT_DUP_OPTIONS: DupOptions = { radius: 150, windowMin: 180, threshold: 0.6 };

export function duplicateScore(a: DupRecord, b: DupRecord) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const dtMin = Math.abs(a.t - b.t) / 60000;
  const score =
    0.4 * Math.exp(-d / 60) + 0.35 * Math.exp(-dtMin / 45) + 0.15 * (a.category === b.category ? 1 : 0) + 0.1 * (1 - Math.min(3, Math.abs(a.severityRank - b.severityRank)) / 3);
  return { score, distanceM: d, dtMin };
}

export function findDuplicateCandidates(target: DupRecord, pool: DupRecord[], opts: DupOptions = DEFAULT_DUP_OPTIONS) {
  return pool
    .filter((p) => p.id !== target.id)
    .map((p) => ({ id: p.id, ...duplicateScore(target, p) }))
    .filter((c) => c.distanceM <= opts.radius && c.dtMin <= opts.windowMin)
    .sort((a, b) => b.score - a.score);
}

/** Precision / recall of the detector against generator ground truth. */
export function evaluateDetector(pairs: { predicted: boolean; actual: boolean }[]) {
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (const p of pairs) {
    if (p.predicted && p.actual) tp++;
    else if (p.predicted && !p.actual) fp++;
    else if (!p.predicted && p.actual) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : NaN;
  const recall = tp + fn ? tp / (tp + fn) : NaN;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : NaN;
  return { tp, fp, fn, tn, precision, recall, f1 };
}
