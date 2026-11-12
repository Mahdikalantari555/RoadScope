/**
 * Data-quality rules: duplicate detection heuristics and quality flags.
 * Heuristics are transparent and tunable; they flag candidates for human review and never
 * change a report's status on their own.
 */
import { quantile } from "./stats";

export const DUPLICATE_RADIUS_M = 120;
export const DUPLICATE_WINDOW_MS = 2 * 3600 * 1000;
export const DUPLICATE_THRESHOLD = 0.5;
export const OFF_NETWORK_M = 40;
export const DELAYED_REPORT_MIN = 24 * 60;

export interface DuplicateProbe {
  x: number;
  y: number;
  tMs: number;
  categoryCode: string;
}

/** Score in [0, 1]: 0.6 spatial closeness + 0.4 temporal closeness, zero if category differs or outside bounds. */
export function duplicateScore(a: DuplicateProbe, b: DuplicateProbe, radiusM = DUPLICATE_RADIUS_M, windowMs = DUPLICATE_WINDOW_MS): number {
  if (a.categoryCode !== b.categoryCode) return 0;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const dt = Math.abs(a.tMs - b.tMs);
  if (d > radiusM || dt > windowMs) return 0;
  return 0.6 * (1 - d / radiusM) + 0.4 * (1 - dt / windowMs);
}

export interface DuplicateHit {
  id: number;
  score: number;
  distanceM: number;
  deltaMinutes: number;
}

export function findDuplicateCandidates<T extends DuplicateProbe & { id: number }>(
  probe: DuplicateProbe,
  pool: T[],
  threshold = DUPLICATE_THRESHOLD,
  limit = 5,
): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  for (const candidate of pool) {
    const score = duplicateScore(probe, candidate);
    if (score >= threshold) {
      hits.push({
        id: candidate.id,
        score: Math.round(score * 1000) / 1000,
        distanceM: Math.round(Math.hypot(probe.x - candidate.x, probe.y - candidate.y)),
        deltaMinutes: Math.round(Math.abs(probe.tMs - candidate.tMs) / 60000),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function computeQualityFlags(input: {
  snapDistanceM: number | null;
  reportingDelayMin: number;
  hasDuplicateCandidate: boolean;
  coordinateMoved: boolean;
}): string[] {
  const flags: string[] = [];
  if (input.snapDistanceM !== null && input.snapDistanceM > OFF_NETWORK_M) flags.push("off_network");
  if (input.hasDuplicateCandidate) flags.push("possible_duplicate");
  if (input.reportingDelayMin > DELAYED_REPORT_MIN) flags.push("delayed_report");
  if (input.coordinateMoved) flags.push("coordinate_moved");
  return flags;
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function p90(values: number[]): number | null {
  return quantile(values, 0.9);
}
