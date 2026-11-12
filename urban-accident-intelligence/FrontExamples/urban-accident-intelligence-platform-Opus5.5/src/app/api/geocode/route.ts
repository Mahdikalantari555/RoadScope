import { getNetwork, networkNodes } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/geocode?q= — offline gazetteer over the synthetic network (streets, intersections, coordinates). */
export const GET = handle(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ items: [] });
  const coord = q.match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
  if (coord) {
    const a = Number(coord[1]);
    const b = Number(coord[2]);
    const [lat, lon] = Math.abs(a) <= 90 ? [a, b] : [b, a];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return Response.json({ items: [{ label: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, kind: "coordinate", lon, lat }] });
  }
  const net = await getNetwork();
  if (!net) return Response.json({ items: [] });
  const ql = q.toLowerCase();
  const streets = new Map<string, { lon: number; lat: number; n: number }>();
  for (const s of net.segments) {
    if (!s.name.toLowerCase().includes(ql.split("&")[0].trim())) continue;
    const mid = s.geom[1] ?? s.geom[0];
    const e = streets.get(s.name) ?? { lon: 0, lat: 0, n: 0 };
    e.lon += mid[0];
    e.lat += mid[1];
    e.n++;
    streets.set(s.name, e);
  }
  const items: { label: string; kind: string; lon: number; lat: number }[] = [...streets.entries()].slice(0, 6).map(([name, e]) => ({ label: name, kind: "street", lon: e.lon / e.n, lat: e.lat / e.n }));
  const nodes = await networkNodes();
  const names = new Map<number, Set<string>>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const s of net.segments) for (const nid of [s.fromNodeId, s.toNodeId]) if (nid) (names.get(nid) ?? names.set(nid, new Set()).get(nid)!).add(s.name);
  const parts = ql.split("&").map((p) => p.trim()).filter(Boolean);
  for (const [nid, set] of names) {
    if (items.length >= 12) break;
    const arr = [...set];
    if (arr.length < 2) continue;
    if (!parts.every((p) => arr.some((a) => a.toLowerCase().includes(p)))) continue;
    const node = nodeById.get(nid);
    if (node) items.push({ label: `${arr[0]} & ${arr[1]}`, kind: "intersection", lon: node.lon, lat: node.lat });
  }
  return Response.json({ items });
});
