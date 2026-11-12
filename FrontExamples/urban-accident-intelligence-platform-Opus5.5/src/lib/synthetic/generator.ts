/**
 * Reproducible synthetic urban accident data generator ("Synthetica", a fictitious city).
 * Everything is driven by a single seed (mulberry32) — identical config ⇒ identical dataset.
 * Output is pure data (no DB). Ground-truth labels are attached to every record so that QA and
 * spatial-statistical methods can be evaluated against known injected effects.
 */
import { fromUtm } from "../geo/projection";
import { dist, pointAlong, polylineLength, type XY } from "../geo/geometry";
import { gaussian, mulberry32 } from "../geo/stats";
import { lightCondition, localParts, localToUtc } from "../geo/time";
import type { CategoryCode, ScenarioCode, SeverityCode } from "../domain";

export interface GeneratorConfig {
  scenario: ScenarioCode;
  seed: number;
  accidents: number;
  startYear: number;
  years: number;
  duplicateRate: number;
  grossErrorRate: number;
  gpsSigmaM: number;
  medianDelayMin: number;
  pendingShare: number;
  falseReportRate: number;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  scenario: "mixed",
  seed: 42,
  accidents: 2600,
  startYear: 2023,
  years: 2,
  duplicateRate: 0.05,
  grossErrorRate: 0.02,
  gpsSigmaM: 12,
  medianDelayMin: 90,
  pendingShare: 0.12,
  falseReportRate: 0.03,
};

export const CITY_ORIGIN: XY = [500000, 5000000];

export interface GenNode {
  idx: number;
  xy: XY;
  degree: number;
  signalized: boolean;
}
export interface GenSegment {
  idx: number;
  name: string;
  roadClass: "arterial" | "collector" | "local";
  speedLimit: number;
  lanes: number;
  lit: boolean;
  surface: string;
  from: number;
  to: number;
  coords: XY[];
  lengthM: number;
  aadt: [number, number];
}
export interface GenWeather {
  t: number;
  condition: "dry" | "rain" | "fog" | "snow";
  precipitationMm: number;
  visibilityM: number;
  temperatureC: number;
}
export interface GenAccident {
  occurredAt: number;
  reportedAt: number;
  category: CategoryCode;
  severity: SeverityCode;
  vehicles: number;
  description: string;
  emergency: boolean;
  status: "reported" | "verified" | "rejected" | "duplicate";
  trueXY: XY;
  reportedXY: XY;
  weather: string;
  light: string;
  truth: { kind: "original" | "duplicate" | "gross_error" | "false_report"; component: string; originalIndex?: number };
}
export interface GeneratedDataset {
  config: GeneratorConfig;
  nodes: GenNode[];
  segments: GenSegment[];
  basemap: { kind: string; ring: XY[] }[];
  weather: GenWeather[];
  accidents: GenAccident[];
  hotspotNodes: number[];
  injectedEffects: Record<string, unknown>;
}

const COL_NAMES = ["Linden", "Maple", "Harbor", "Mill", "Quarry", "Orchard", "Chapel", "Station", "Foundry", "Garden", "Market", "Cedar", "Willow", "Bridge", "Castle", "Meadow", "Union", "Granite", "Elm", "Tanner", "Ash", "Copper", "Forge"];
const ROW_NAMES = ["North", "Academy", "Ferry", "Lantern", "Weaver", "Brook", "Pioneer", "River", "Canal", "Hill", "Ridge", "Grove", "Spring", "Summit", "Vine", "Kiln", "Saddle", "Beacon", "Dock"];

const HOUR_PROFILES: Record<string, number[]> = {
  flat: new Array(24).fill(1),
  urban: [0.3, 0.2, 0.15, 0.15, 0.2, 0.4, 0.8, 1.5, 1.8, 1.2, 1.0, 1.1, 1.3, 1.2, 1.2, 1.4, 1.8, 2.0, 1.6, 1.1, 0.8, 0.6, 0.5, 0.4],
  rush: [0.15, 0.1, 0.08, 0.08, 0.1, 0.3, 0.9, 2.8, 3.2, 1.2, 0.7, 0.7, 0.8, 0.8, 0.9, 1.4, 2.9, 3.4, 2.2, 0.9, 0.5, 0.35, 0.25, 0.2],
};
const WEEKDAY_PROFILES: Record<string, number[]> = {
  flat: [1, 1, 1, 1, 1, 1, 1],
  urban: [1, 1, 1, 1, 1.1, 0.85, 0.7],
  rush: [1.1, 1.1, 1.1, 1.1, 1.05, 0.45, 0.35],
};
const MONTH_SEASONAL = [1.15, 1.1, 1, 0.95, 0.95, 0.9, 0.85, 0.8, 0.95, 1.05, 1.15, 1.2];

interface ScenarioSpec {
  mix: { length: number; exposure: number; hotspot: number; corridor: number };
  hotspots: number;
  hour: string;
  weekday: string;
  seasonal: boolean;
  weatherEffect: Record<string, number>;
  contextEffects: boolean;
}

const SCENARIO_SPECS: Record<ScenarioCode, ScenarioSpec> = {
  uniform: { mix: { length: 1, exposure: 0, hotspot: 0, corridor: 0 }, hotspots: 0, hour: "flat", weekday: "flat", seasonal: false, weatherEffect: { dry: 1, rain: 1, fog: 1, snow: 1 }, contextEffects: false },
  intersection: { mix: { length: 0.25, exposure: 0, hotspot: 0.75, corridor: 0 }, hotspots: 10, hour: "urban", weekday: "urban", seasonal: true, weatherEffect: { dry: 1, rain: 1.4, fog: 1.2, snow: 1.6 }, contextEffects: true },
  rushhour: { mix: { length: 0.2, exposure: 0.8, hotspot: 0, corridor: 0 }, hotspots: 0, hour: "rush", weekday: "rush", seasonal: true, weatherEffect: { dry: 1, rain: 1.3, fog: 1.2, snow: 1.5 }, contextEffects: true },
  mixed: { mix: { length: 0.15, exposure: 0.4, hotspot: 0.35, corridor: 0.1 }, hotspots: 8, hour: "urban", weekday: "urban", seasonal: true, weatherEffect: { dry: 1, rain: 1.8, fog: 1.5, snow: 2.2 }, contextEffects: true },
};

function weightedPick<T>(items: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function normalisePick<K extends string>(w: Record<K, number>, rng: () => number): K {
  const keys = Object.keys(w) as K[];
  return weightedPick(keys, keys.map((k) => w[k]), rng);
}

export function riverY(x: number): number {
  return CITY_ORIGIN[1] - 300 + 420 * Math.sin((x - CITY_ORIGIN[0]) / 1300);
}

export function generateNetwork(rng: () => number) {
  const nx = 22;
  const ny = 18;
  const sp = 280;
  const [X0, Y0] = CITY_ORIGIN;
  const colClass = (i: number) => (i % 5 === 1 ? "arterial" : i % 5 === 3 ? "collector" : "local");
  const rowClass = (j: number) => (j % 5 === 2 ? "arterial" : j % 5 === 4 ? "collector" : "local");
  const grid: (XY | null)[][] = [];
  for (let i = 0; i <= nx; i++) {
    grid[i] = [];
    for (let j = 0; j <= ny; j++) {
      let x = X0 + (i - nx / 2) * sp + 70 * Math.sin(j * 0.45) + (rng() - 0.5) * 40;
      let y = Y0 + (j - ny / 2) * sp + 55 * Math.sin(i * 0.38) + (rng() - 0.5) * 40;
      const ry = riverY(x);
      if (Math.abs(y - ry) < 90) y = ry + (y >= ry ? 90 : -90);
      // remove a few outer-corner nodes for an organic city edge
      const edge = (i === 0 || i === nx) && (j < 2 || j > ny - 2);
      grid[i][j] = edge ? null : [x, y];
    }
  }
  const nodes: GenNode[] = [];
  const nodeIdx = new Map<string, number>();
  const segs: GenSegment[] = [];
  const getNode = (i: number, j: number) => {
    const k = `${i}:${j}`;
    if (!nodeIdx.has(k)) {
      nodeIdx.set(k, nodes.length);
      nodes.push({ idx: nodes.length, xy: grid[i][j] as XY, degree: 0, signalized: false });
    }
    return nodeIdx.get(k)!;
  };
  const crossesRiver = (a: XY, b: XY) => Math.sign(a[1] - riverY(a[0])) !== Math.sign(b[1] - riverY(b[0]));
  const addSeg = (a: [number, number], b: [number, number], cls: "arterial" | "collector" | "local", name: string, bridgeAllowed: boolean) => {
    const pa = grid[a[0]][a[1]];
    const pb = grid[b[0]][b[1]];
    if (!pa || !pb) return;
    if (crossesRiver(pa, pb) && !bridgeAllowed) return;
    if (cls === "local" && rng() < 0.08) return;
    const from = getNode(a[0], a[1]);
    const to = getNode(b[0], b[1]);
    const mid: XY = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    const len = dist(pa, pb);
    const off = cls === "local" ? (rng() - 0.5) * 14 : (rng() - 0.5) * 6;
    const coords: XY[] = [pa, [mid[0] - ((pb[1] - pa[1]) / len) * off, mid[1] + ((pb[0] - pa[0]) / len) * off], pb];
    const median = cls === "arterial" ? 16000 : cls === "collector" ? 6000 : 1200;
    const aadt1 = Math.round(median * Math.exp((cls === "local" ? 0.5 : 0.35) * gaussian(rng)));
    const aadt2 = Math.round(aadt1 * (1 + 0.015 + 0.01 * gaussian(rng)));
    segs.push({
      idx: segs.length,
      name,
      roadClass: cls,
      speedLimit: cls === "arterial" ? 60 : cls === "collector" ? 50 : rng() < 0.6 ? 30 : 40,
      lanes: cls === "arterial" ? 4 : 2,
      lit: cls === "arterial" ? true : cls === "collector" ? rng() < 0.9 : rng() < 0.6,
      surface: cls === "local" && rng() < 0.12 ? "cobblestone" : "asphalt",
      from,
      to,
      coords,
      lengthM: polylineLength(coords),
      aadt: [aadt1, aadt2],
    });
    nodes[from].degree++;
    nodes[to].degree++;
  };
  const suffix = (cls: string, vertical: boolean) => (cls === "arterial" ? "Boulevard" : cls === "collector" ? (vertical ? "Avenue" : "Road") : vertical ? "Lane" : "Street");
  for (let j = 0; j <= ny; j++) {
    const cls = rowClass(j);
    for (let i = 0; i < nx; i++) addSeg([i, j], [i + 1, j], cls, `${ROW_NAMES[j % ROW_NAMES.length]} ${suffix(cls, false)}`, cls !== "local");
  }
  for (let i = 0; i <= nx; i++) {
    const cls = colClass(i);
    for (let j = 0; j < ny; j++) addSeg([i, j], [i, j + 1], cls, `${COL_NAMES[i % COL_NAMES.length]} ${suffix(cls, true)}`, cls === "arterial" || (cls === "collector" && i % 10 === 3));
  }
  // signalisation: arterial × (arterial | collector) crossings
  const touch = new Map<number, Set<string>>();
  for (const s of segs) for (const n of [s.from, s.to]) (touch.get(n) ?? touch.set(n, new Set()).get(n)!).add(s.roadClass);
  for (const n of nodes) {
    const t = touch.get(n.idx) ?? new Set();
    const arterialCount = segs.filter((s) => (s.from === n.idx || s.to === n.idx) && s.roadClass === "arterial").length;
    n.signalized = n.degree >= 3 && t.has("arterial") && (arterialCount >= 3 || t.has("collector"));
  }
  // basemap context
  const basemap: { kind: string; ring: XY[] }[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const c = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      if (c.some((p) => !p)) continue;
      const pts = c as XY[];
      const cx = pts.reduce((a, p) => a + p[0], 0) / 4;
      const cy = pts.reduce((a, p) => a + p[1], 0) / 4;
      if (Math.abs(cy - riverY(cx)) < 160) continue;
      const shrink = (p: XY): XY => {
        const d = dist(p, [cx, cy]);
        const k = Math.max(0, (d - 18) / d);
        return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
      };
      const dc = dist([cx, cy], CITY_ORIGIN);
      const r = rng();
      const kind = r < 0.08 ? "park" : dc < 900 && r < 0.7 ? "commercial" : i > nx - 6 && j < 5 ? "industrial" : "residential";
      const ring = pts.map(shrink);
      basemap.push({ kind, ring: [...ring, ring[0]] });
    }
  const minX = X0 - (nx / 2) * sp - 600;
  const maxX = X0 + (nx / 2) * sp + 600;
  const upper: XY[] = [];
  const lower: XY[] = [];
  for (let x = minX; x <= maxX; x += 60) {
    upper.push([x, riverY(x) + 55]);
    lower.push([x, riverY(x) - 55]);
  }
  const river = [...upper, ...lower.reverse()];
  basemap.push({ kind: "water", ring: [...river, river[0]] });
  return { nodes, segments: segs, basemap };
}

function generateWeather(cfg: GeneratorConfig, rng: () => number): GenWeather[] {
  const out: GenWeather[] = [];
  const start = Date.UTC(cfg.startYear, 0, 1) - 3600000 * 2;
  const end = Date.UTC(cfg.startYear + cfg.years, 0, 1) + 3600000 * 2;
  let prevRain = false;
  for (let day = start; day < end; day += 86400000) {
    const m = new Date(day).getUTCMonth();
    const winter = m === 11 || m <= 1;
    const pRain = (m >= 9 || m <= 3 ? 0.3 : 0.2) + (prevRain ? 0.25 : 0);
    const r = rng();
    let dayType: GenWeather["condition"] = "dry";
    if (winter && r < 0.07) dayType = "snow";
    else if (r < pRain) dayType = "rain";
    else if ((m >= 9 || m <= 1) && r < pRain + 0.08) dayType = "fog";
    prevRain = dayType === "rain";
    const startH = Math.floor(rng() * 20);
    const dur = 3 + Math.floor(rng() * 8);
    for (let h = 0; h < 24; h++) {
      const t = day + h * 3600000;
      let cond: GenWeather["condition"] = "dry";
      if ((dayType === "rain" || dayType === "snow") && h >= startH && h < startH + dur) cond = dayType;
      if (dayType === "fog" && h >= 3 && h <= 9) cond = "fog";
      const temp = 11 - 10 * Math.cos(((m + 0.5) / 12) * 2 * Math.PI) + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + 2 * gaussian(rng);
      out.push({
        t,
        condition: cond,
        precipitationMm: cond === "rain" ? Math.round(Math.abs(1.2 + gaussian(rng)) * 10) / 10 : cond === "snow" ? 0.8 : 0,
        visibilityM: cond === "fog" ? 200 + rng() * 600 : cond === "snow" ? 1000 + rng() * 2000 : cond === "rain" ? 4000 + rng() * 4000 : 10000 + rng() * 10000,
        temperatureC: Math.round((cond === "snow" ? Math.min(temp, 0.5) : temp) * 10) / 10,
      });
    }
  }
  return out;
}

const DESCRIPTIONS: Record<CategoryCode, string[]> = {
  rear_end: ["Vehicle failed to stop in queue and struck car ahead.", "Rear-end collision in slow-moving traffic.", "Sudden braking led to a chain collision."],
  angle: ["Vehicle entered junction and collided with crossing traffic.", "Right-of-way violation at intersection.", "Side impact while turning left across traffic."],
  head_on: ["Overtaking manoeuvre resulted in frontal collision.", "Vehicle crossed centre line.", "Head-on contact on narrow section."],
  pedestrian: ["Pedestrian struck while crossing.", "Pedestrian hit near crossing point by turning vehicle.", "Pedestrian collision at mid-block."],
  cyclist: ["Cyclist struck by turning vehicle.", "Dooring incident involving cyclist.", "Cyclist and car collided at junction."],
  single_vehicle: ["Driver lost control and hit a kerb.", "Vehicle left carriageway and struck a pole.", "Skidding on wet surface, collision with barrier."],
  sideswipe: ["Lane change sideswipe.", "Vehicles made side contact while merging.", "Sideswipe between parallel lanes."],
  other: ["Minor collision while parking.", "Collision with an animal.", "Unspecified collision reported."],
};

export function generateDataset(partial: Partial<GeneratorConfig> = {}): GeneratedDataset {
  const cfg: GeneratorConfig = { ...DEFAULT_CONFIG, ...partial };
  const spec = SCENARIO_SPECS[cfg.scenario];
  const rng = mulberry32(cfg.seed);
  const { nodes, segments, basemap } = generateNetwork(mulberry32(cfg.seed * 7 + 1));
  const weather = generateWeather(cfg, mulberry32(cfg.seed * 13 + 5));
  const weatherAt = (t: number) => {
    const first = weather[0].t;
    const i = Math.max(0, Math.min(weather.length - 1, Math.floor((t - first) / 3600000)));
    return weather[i];
  };
  const hourW = HOUR_PROFILES[spec.hour];
  const wdW = WEEKDAY_PROFILES[spec.weekday];
  const maxWeather = Math.max(...Object.values(spec.weatherEffect));
  const lengthW = segments.map((s) => s.lengthM);
  const exposureW = segments.map((s) => s.lengthM * s.aadt[0]);
  const signal = nodes.filter((n) => n.signalized).map((n) => n.idx);
  const hotspotNodes: number[] = [];
  const pool = [...signal];
  for (let k = 0; k < spec.hotspots && pool.length; k++) hotspotNodes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const hotspotW = hotspotNodes.map((_, k) => 1 / Math.pow(k + 1, 0.7));
  const arterialRow = segments.filter((s) => s.roadClass === "arterial" && s.name.startsWith(ROW_NAMES[7]));
  const corridor = arterialRow.slice(Math.max(0, Math.floor(arterialRow.length / 2) - 3), Math.floor(arterialRow.length / 2) + 3);
  const incident = new Map<number, GenSegment[]>();
  for (const s of segments) for (const n of [s.from, s.to]) (incident.get(n) ?? incident.set(n, []).get(n)!).push(s);
  const days = Math.round((Date.UTC(cfg.startYear + cfg.years, 0, 1) - Date.UTC(cfg.startYear, 0, 1)) / 86400000);
  const dayStart = Date.UTC(cfg.startYear, 0, 1);

  const sampleTime = (): { t: number; w: GenWeather } => {
    for (;;) {
      const dayMs = dayStart + Math.floor(rng() * days) * 86400000;
      const d = new Date(dayMs);
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + 1;
      const da = d.getUTCDate();
      const wd = (d.getUTCDay() + 6) % 7;
      const dayWeight = wdW[wd] * (spec.seasonal ? MONTH_SEASONAL[mo - 1] : 1);
      if (rng() > dayWeight / 1.25) continue;
      const hour = weightedPick([...Array(24).keys()], spec.hour === "rush" && wd >= 5 ? HOUR_PROFILES.urban : hourW, rng);
      const t = localToUtc(y, mo, da, hour, Math.floor(rng() * 60));
      const w = weatherAt(t);
      if (rng() > (spec.weatherEffect[w.condition] ?? 1) / maxWeather) continue;
      return { t, w };
    }
  };

  const sampleLocation = (): { xy: XY; seg: GenSegment; component: string; nearIntersection: boolean } => {
    const comp = normalisePick(spec.mix, rng);
    if (comp === "hotspot" && hotspotNodes.length) {
      const node = weightedPick(hotspotNodes, hotspotW, rng);
      const segs = incident.get(node) ?? [];
      const seg = segs[Math.floor(rng() * segs.length)];
      const along = Math.min(seg.lengthM * 0.5, Math.abs(gaussian(rng)) * 35);
      const fromStart = seg.from === node;
      const xy = pointAlong(seg.coords, fromStart ? along : seg.lengthM - along);
      return { xy, seg, component: "hotspot", nearIntersection: along < 40 };
    }
    if (comp === "corridor" && corridor.length) {
      const seg = corridor[Math.floor(rng() * corridor.length)];
      const along = rng() * seg.lengthM;
      return { xy: pointAlong(seg.coords, along), seg, component: "corridor", nearIntersection: along < 30 || seg.lengthM - along < 30 };
    }
    const seg = weightedPick(segments, comp === "exposure" ? exposureW : lengthW, rng);
    const along = rng() * seg.lengthM;
    return { xy: pointAlong(seg.coords, along), seg, component: comp, nearIntersection: along < 30 || seg.lengthM - along < 30 };
  };

  const pickCategory = (seg: GenSegment, near: boolean, hour: number, dark: boolean, weekend: boolean): CategoryCode => {
    if (!spec.contextEffects) return normalisePick({ rear_end: 1, angle: 1, head_on: 0.4, pedestrian: 0.6, cyclist: 0.6, single_vehicle: 0.8, sideswipe: 0.7, other: 0.5 }, rng);
    const w: Record<CategoryCode, number> = near
      ? { angle: 0.35, rear_end: 0.25, pedestrian: 0.12, cyclist: 0.08, sideswipe: 0.08, head_on: 0.04, single_vehicle: 0.03, other: 0.05 }
      : seg.roadClass === "local"
        ? { single_vehicle: 0.2, pedestrian: 0.15, cyclist: 0.15, angle: 0.1, rear_end: 0.15, sideswipe: 0.1, head_on: 0.05, other: 0.1 }
        : { rear_end: 0.35, sideswipe: 0.18, head_on: 0.08, single_vehicle: 0.1, pedestrian: 0.08, cyclist: 0.07, angle: 0.08, other: 0.06 };
    if ([7, 8, 16, 17, 18].includes(hour)) w.rear_end *= 1.8;
    if (dark && weekend) w.single_vehicle *= 2.5;
    return normalisePick(w, rng);
  };

  const pickSeverity = (seg: GenSegment, cat: CategoryCode, dark: boolean): SeverityCode => {
    const w: Record<SeverityCode, number> = { pdo: 0.58, slight: 0.32, serious: 0.08, fatal: 0.02 };
    if (spec.contextEffects) {
      if (seg.speedLimit >= 60) {
        w.serious *= 1.6;
        w.fatal *= 2;
      }
      if (dark) {
        w.serious *= 1.5;
        w.fatal *= 1.8;
      }
      if (cat === "pedestrian" || cat === "cyclist") {
        w.serious *= 2.5;
        w.fatal *= 3;
        w.pdo *= 0.3;
      }
    }
    return normalisePick(w, rng);
  };

  const vehiclesFor = (cat: CategoryCode) =>
    cat === "pedestrian" || cat === "cyclist" || cat === "single_vehicle" ? 1 : cat === "other" ? 1 + Math.floor(rng() * 2) : rng() < 0.15 ? 3 : 2;
  const toLonLat = (xy: XY) => fromUtm(xy[0], xy[1]);
  const delay = () => Math.max(2, cfg.medianDelayMin * Math.exp(1.1 * gaussian(rng))) * 60000;

  const accidents: GenAccident[] = [];
  for (let k = 0; k < cfg.accidents; k++) {
    const { t, w } = sampleTime();
    const loc = sampleLocation();
    const [lon, lat] = toLonLat(loc.xy);
    const light = lightCondition(t, lat, lon);
    const lp = localParts(t);
    const cat = pickCategory(loc.seg, loc.nearIntersection, lp.hour, light === "dark", lp.weekday >= 5);
    const sev = pickSeverity(loc.seg, cat, light === "dark");
    const gross = rng() < cfg.grossErrorRate;
    const sigma = gross ? 250 : cfg.gpsSigmaM;
    const reportedXY: XY = [loc.xy[0] + sigma * gaussian(rng), loc.xy[1] + sigma * gaussian(rng)];
    const r = rng();
    accidents.push({
      occurredAt: t,
      reportedAt: t + delay(),
      category: cat,
      severity: sev,
      vehicles: vehiclesFor(cat),
      description: DESCRIPTIONS[cat][Math.floor(rng() * 3)],
      emergency: sev === "fatal" || sev === "serious" ? true : sev === "slight" ? rng() < 0.5 : rng() < 0.05,
      status: gross ? "reported" : r < cfg.pendingShare ? "reported" : "verified",
      trueXY: loc.xy,
      reportedXY,
      weather: w.condition,
      light,
      truth: { kind: gross ? "gross_error" : "original", component: loc.component },
    });
  }
  // fabricated / erroneous reports (rejected)
  const nFalse = Math.round(cfg.accidents * cfg.falseReportRate);
  for (let k = 0; k < nFalse; k++) {
    const { t, w } = sampleTime();
    const loc = sampleLocation();
    const [lon, lat] = toLonLat(loc.xy);
    const cat = normalisePick({ rear_end: 1, angle: 1, other: 2, single_vehicle: 1 } as Record<CategoryCode, number>, rng);
    accidents.push({
      occurredAt: t,
      reportedAt: t + delay(),
      category: cat,
      severity: "pdo",
      vehicles: 1,
      description: "Report could not be corroborated by field or police records.",
      emergency: false,
      status: "rejected",
      trueXY: loc.xy,
      reportedXY: [loc.xy[0] + 40 * gaussian(rng), loc.xy[1] + 40 * gaussian(rng)],
      weather: w.condition,
      light: lightCondition(t, lat, lon),
      truth: { kind: "false_report", component: "noise" },
    });
  }
  // duplicate submissions of genuine events
  const originals = accidents.length - nFalse;
  const nDup = Math.round(cfg.accidents * cfg.duplicateRate);
  for (let k = 0; k < nDup; k++) {
    const oi = Math.floor(rng() * originals);
    const o = accidents[oi];
    const dt = gaussian(rng) * 20 * 60000;
    accidents.push({
      ...o,
      occurredAt: o.occurredAt + dt,
      reportedAt: Math.max(o.occurredAt + dt, o.reportedAt + Math.abs(gaussian(rng)) * 3600000),
      category: rng() < 0.8 ? o.category : "other",
      severity: rng() < 0.7 ? o.severity : o.severity === "pdo" ? "slight" : "pdo",
      description: `(second witness) ${o.description}`,
      status: rng() < 0.5 ? "duplicate" : "reported",
      reportedXY: [o.trueXY[0] + 25 * gaussian(rng), o.trueXY[1] + 25 * gaussian(rng)],
      truth: { kind: "duplicate", component: o.truth.component, originalIndex: oi },
    });
  }
  return {
    config: cfg,
    nodes,
    segments,
    basemap,
    weather,
    accidents,
    hotspotNodes,
    injectedEffects: {
      spatialMix: spec.mix,
      hotspotIntersections: hotspotNodes.length,
      weatherIncidenceMultiplier: spec.weatherEffect,
      hourProfile: spec.hour,
      weekdayProfile: spec.weekday,
      seasonal: spec.seasonal,
      severityContextEffects: spec.contextEffects,
      gpsSigmaM: cfg.gpsSigmaM,
      grossErrorRate: cfg.grossErrorRate,
      duplicateRate: cfg.duplicateRate,
      falseReportRate: cfg.falseReportRate,
    },
  };
}
