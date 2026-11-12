/**
 * Local and global spatial autocorrelation.
 *  - Getis–Ord Gi* (Getis & Ord 1992; Ord & Getis 1995), fixed distance-band binary weights incl. self.
 *  - Benjamini–Hochberg FDR correction for multiple testing (Caldas de Castro & Singer 2006).
 *  - Global Moran's I (normality + conditional permutation inference).
 * Units of analysis: regular lattice cells (study area masked to the road network buffer) or road segments.
 */
import { PointGrid, type XY } from "./geometry";
import { benjaminiHochberg, mean, mulberry32, twoSidedP } from "./stats";

export interface AreaUnit {
  id: string | number;
  x: number;
  y: number;
  value: number;
}

export type GiClass = "hot99" | "hot95" | "hot90" | "ns" | "cold90" | "cold95" | "cold99";

export interface GiResult {
  id: string | number;
  value: number;
  z: number;
  p: number;
  q: number;
  neighbours: number;
  cls: GiClass;
}

export interface AssumptionCheck {
  name: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
}

export function neighbourLists(units: AreaUnit[], band: number, includeSelf: boolean): number[][] {
  const pts: XY[] = units.map((u) => [u.x, u.y]);
  const grid = new PointGrid(pts, Math.max(band, 1));
  return pts.map((p, i) => grid.within(p, band).filter((j) => includeSelf || j !== i));
}

export function getisOrdGiStar(units: AreaUnit[], band: number, useFdr: boolean): GiResult[] {
  const n = units.length;
  const x = units.map((u) => u.value);
  const xbar = mean(x);
  const s = Math.sqrt(x.reduce((acc, v) => acc + v * v, 0) / n - xbar * xbar);
  const nb = neighbourLists(units, band, true);
  const raw = units.map((u, i) => {
    const W = nb[i].length; // binary weights → Σw = Σw² = |N_i|
    const sumWx = nb[i].reduce((acc, j) => acc + x[j], 0);
    const denom = s * Math.sqrt((n * W - W * W) / (n - 1));
    const z = denom > 0 ? (sumWx - xbar * W) / denom : 0;
    return { id: u.id, value: u.value, z, p: twoSidedP(z), neighbours: W - 1 };
  });
  const q = useFdr ? benjaminiHochberg(raw.map((r) => r.p)) : raw.map((r) => r.p);
  return raw.map((r, i) => ({ ...r, q: q[i], cls: classify(r.z, q[i]) }));
}

function classify(z: number, p: number): GiClass {
  if (p < 0.01) return z > 0 ? "hot99" : "cold99";
  if (p < 0.05) return z > 0 ? "hot95" : "cold95";
  if (p < 0.1) return z > 0 ? "hot90" : "cold90";
  return "ns";
}

export interface MoranResult {
  I: number;
  expected: number;
  zNormal: number;
  pNormal: number;
  pPermutation: number;
  permutations: number;
}

export function globalMoransI(units: AreaUnit[], band: number, permutations = 499, seed = 7): MoranResult {
  const n = units.length;
  const x = units.map((u) => u.value);
  const nb = neighbourLists(units, band, false);
  const S0 = nb.reduce((acc, l) => acc + l.length, 0);
  const stat = (vals: number[]) => {
    const m = mean(vals);
    const z = vals.map((v) => v - m);
    const den = z.reduce((acc, v) => acc + v * v, 0);
    let num = 0;
    for (let i = 0; i < n; i++) for (const j of nb[i]) num += z[i] * z[j];
    return den === 0 || S0 === 0 ? 0 : (n / S0) * (num / den);
  };
  const I = stat(x);
  const E = -1 / (n - 1);
  const S1 = 2 * S0; // symmetric binary weights
  const S2 = nb.reduce((acc, l) => acc + (2 * l.length) ** 2, 0);
  const varI = (n * n * S1 - n * S2 + 3 * S0 * S0) / ((n * n - 1) * S0 * S0) - E * E;
  const zN = varI > 0 ? (I - E) / Math.sqrt(varI) : 0;
  const rng = mulberry32(seed);
  const perm = [...x];
  let extreme = 0;
  for (let k = 0; k < permutations; k++) {
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    if (stat(perm) >= I) extreme++;
  }
  return { I, expected: E, zNormal: zN, pNormal: twoSidedP(zN), pPermutation: (extreme + 1) / (permutations + 1), permutations };
}

/** Pre-conditions for a defensible Gi* analysis. */
export function giAssumptions(units: AreaUnit[], band: number, totalEvents: number, moran: MoranResult | null): AssumptionCheck[] {
  const nb = neighbourLists(units, band, false);
  const counts = nb.map((l) => l.length);
  const minNb = counts.length ? Math.min(...counts) : 0;
  const meanNb = counts.length ? mean(counts) : 0;
  const checks: AssumptionCheck[] = [
    { name: "Number of analysis units ≥ 30", passed: units.length >= 30, detail: `${units.length} units`, blocking: true },
    { name: "Number of events ≥ 30", passed: totalEvents >= 30, detail: `${totalEvents} events`, blocking: true },
    { name: "Every unit has ≥ 1 neighbour", passed: minNb >= 1, detail: `min neighbours = ${minNb}`, blocking: true },
    {
      name: "Mean neighbours ≥ 8 (normal approximation of Gi*)",
      passed: meanNb >= 8,
      detail: `mean neighbours = ${meanNb.toFixed(1)}`,
      blocking: false,
    },
  ];
  if (moran)
    checks.push({
      name: "Global spatial autocorrelation present (Moran's I, permutation p < 0.05)",
      passed: moran.pPermutation < 0.05 && moran.I > moran.expected,
      detail: `I = ${moran.I.toFixed(3)}, pseudo-p = ${moran.pPermutation.toFixed(3)}`,
      blocking: false,
    });
  return checks;
}
