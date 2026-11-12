"use client";

/**
 * Hardware-composited vector map engine.
 *
 * Renders GeoJSON (CRS84) through an internal Web-Mercator view transform onto a
 * devicePixelRatio-scaled canvas: no external tile service is required, so the
 * platform runs air-gapped. Supports pan/zoom, hover picking with property
 * readout, feature selection, bounding-box brush selection, zoom-dependent
 * point clustering, a metric scale bar and dual geographic/projected coordinate
 * readouts (the projected readout uses the dataset's own UTM CRS).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GeoCollection, GeoFeature } from "@/lib/clientApi";
import { crsForOrigin, toUtm } from "@/lib/geo/projection";

const R = 6378137;
const MAX_LAT = 85.05112878;

function mercX(lon: number): number {
  return (lon * Math.PI * R) / 180;
}
function mercY(lat: number): number {
  const c = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return R * Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360));
}
function invMercX(x: number): number {
  return (x * 180) / (Math.PI * R);
}
function invMercY(y: number): number {
  return ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI;
}

export interface MapLayerSpec {
  id: string;
  label?: string;
  data?: GeoCollection | null;
  visible?: boolean;
  zIndex?: number;
  opacity?: number;
  stroke?: (props: any, index: number) => string;
  width?: (props: any, pixelsPerMetre: number) => number;
  fill?: (props: any) => string | null;
  radius?: (props: any) => number;
  dashed?: boolean;
  pickable?: boolean;
  clusterRadiusPx?: number;
}

interface View {
  cx: number;
  cy: number;
  scale: number;
}

interface Props {
  layers: MapLayerSpec[];
  origin?: { lon: number; lat: number };
  fitKey?: string | number;
  selectedId?: string | null;
  brush?: [number, number, number, number] | null;
  brushMode?: boolean;
  onBrush?: (bbox: [number, number, number, number] | null) => void;
  onHover?: (feature: GeoFeature | null, layerId: string | null) => void;
  onSelect?: (feature: GeoFeature | null, layerId: string | null) => void;
  onMapClick?: (lonLat: [number, number]) => void;
  className?: string;
  overlay?: ReactNode;
  legend?: ReactNode;
  minScale?: number;
  maxScale?: number;
}

interface FlatLine {
  coords: number[];
  index: number;
  layer: string;
}
interface FlatPoint {
  x: number;
  y: number;
  index: number;
  layer: string;
}
interface FlatPolygon {
  rings: number[][];
  index: number;
  layer: string;
}

export function MapCanvas(props: Props) {
  const { layers, origin, fitKey, selectedId, brush, brushMode, onBrush, onHover, onSelect, onMapClick, className, overlay, legend } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ cx: mercX(13.4049), cy: mercY(52.5201), scale: 0.9 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<{ x: number; y: number; lon: number; lat: number } | null>(null);
  const [hovered, setHovered] = useState<{ feature: GeoFeature; layerId: string; sx: number; sy: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<{ mode: "none" | "pan" | "brush"; x: number; y: number; moved: boolean }>({ mode: "none", x: 0, y: 0, moved: false });
  const viewRef = useRef(view);
  viewRef.current = view;

  const crs = useMemo(() => (origin ? crsForOrigin(origin.lon, origin.lat) : null), [origin?.lon, origin?.lat]);

  /* ---------------- flatten geometry to mercator ---------------- */
  const flat = useMemo(() => {
    const lines: FlatLine[] = [];
    const points: FlatPoint[] = [];
    const polygons: FlatPolygon[] = [];
    const perLayer = new Map<string, { lines: FlatLine[]; points: FlatPoint[]; polygons: FlatPolygon[]; data: GeoCollection }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const layer of layers) {
      const data = layer.data;
      if (!data?.features?.length) continue;
      const bucket = { lines: [] as FlatLine[], points: [] as FlatPoint[], polygons: [] as FlatPolygon[], data };
      data.features.forEach((f, i) => {
        const g = f.geometry;
        if (!g) return;
        if (g.type === "Point") {
          const [lon, lat] = g.coordinates as [number, number];
          const x = mercX(lon);
          const y = mercY(lat);
          const rec = { x, y, index: i, layer: layer.id };
          points.push(rec);
          bucket.points.push(rec);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        } else if (g.type === "LineString") {
          const coords: number[] = [];
          for (const [lon, lat] of g.coordinates as Array<[number, number]>) {
            const x = mercX(lon);
            const y = mercY(lat);
            coords.push(x, y);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          const rec = { coords, index: i, layer: layer.id };
          lines.push(rec);
          bucket.lines.push(rec);
        } else if (g.type === "Polygon") {
          const rings: number[][] = [];
          for (const ring of g.coordinates as Array<Array<[number, number]>>) {
            const rc: number[] = [];
            for (const [lon, lat] of ring) {
              const x = mercX(lon);
              const y = mercY(lat);
              rc.push(x, y);
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
            rings.push(rc);
          }
          const rec = { rings, index: i, layer: layer.id };
          polygons.push(rec);
          bucket.polygons.push(rec);
        }
      });
      perLayer.set(layer.id, bucket);
    }
    return { lines, points, polygons, perLayer, extent: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null };
  }, [layers]);

  /* ---------------- resize observer ---------------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(120, r.width), h: Math.max(120, r.height) });
    });
    ro.observe(el);
    setSize({ w: Math.max(120, el.clientWidth), h: Math.max(120, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  /* ---------------- fit to data extent ---------------- */
  const fitToExtent = useCallback(
    (extent: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number) => {
      const pad = 34;
      const dx = Math.max(1e-6, extent.maxX - extent.minX);
      const dy = Math.max(1e-6, extent.maxY - extent.minY);
      const scale = Math.min((w - pad * 2) / dx, (h - pad * 2) / dy);
      setView({ cx: (extent.minX + extent.maxX) / 2, cy: (extent.minY + extent.maxY) / 2, scale });
    },
    [],
  );

  const fittedFor = useRef<string>("");
  useEffect(() => {
    if (!flat.extent || size.w < 50) return;
    const key = `${fitKey ?? ""}|${flat.points.length}|${flat.lines.length}|${flat.polygons.length}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fitToExtent(flat.extent, size.w, size.h);
  }, [flat, size.w, size.h, fitKey, fitToExtent]);

  /* ---------------- transforms ---------------- */
  const toScreen = useCallback((x: number, y: number, v: View, w: number, h: number): [number, number] => [(x - v.cx) * v.scale + w / 2, h / 2 - (y - v.cy) * v.scale], []);
  const toWorld = useCallback((sx: number, sy: number, v: View, w: number, h: number): [number, number] => [(sx - w / 2) / v.scale + v.cx, (h / 2 - sy) / v.scale + v.cy], []);

  /* ---------------- draw ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = size.w;
    const h = size.h;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const isLight = document.documentElement.classList.contains("light");
    ctx.fillStyle = isLight ? "#eef2f7" : "#070a0f";
    ctx.fillRect(0, 0, w, h);

    // graticule
    const metresPerPx = 1 / view.scale;
    const step = niceStep(metresPerPx * 90);
    const [wx0, wy1] = toWorld(0, 0, view, w, h);
    const [wx1, wy0] = toWorld(w, h, view, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = isLight ? "rgba(20,40,70,0.07)" : "rgba(120,160,210,0.06)";
    ctx.beginPath();
    for (let gx = Math.floor(wx0 / step) * step; gx <= wx1; gx += step) {
      const [sx] = toScreen(gx, 0, view, w, h);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, h);
    }
    for (let gy = Math.floor(wy0 / step) * step; gy <= wy1; gy += step) {
      const [, sy] = toScreen(0, gy, view, w, h);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(w, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    const sorted = layers.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    for (const layer of sorted) {
      if (layer.visible === false) continue;
      const bucket = flat.perLayer.get(layer.id);
      if (!bucket) continue;
      const data = bucket.data;
      ctx.globalAlpha = layer.opacity ?? 1;

      // polygons
      if (bucket.polygons.length) {
        for (const poly of bucket.polygons) {
          const f = data.features[poly.index];
          const fill = layer.fill?.(f.properties) ?? null;
          const stroke = layer.stroke?.(f.properties, poly.index) ?? fill ?? "#4cc9f0";
          ctx.beginPath();
          for (const ring of poly.rings) {
            for (let i = 0; i < ring.length; i += 2) {
              const [sx, sy] = toScreen(ring[i], ring[i + 1], view, w, h);
              if (i === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            }
            ctx.closePath();
          }
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
          }
          ctx.strokeStyle = stroke;
          ctx.lineWidth = layer.width?.(f.properties, view.scale) ?? 1.2;
          ctx.stroke();
        }
      }

      // lines
      if (bucket.lines.length) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const line of bucket.lines) {
          const f = data.features[line.index];
          const color = layer.stroke?.(f.properties, line.index) ?? "#8fa3bd";
          const lw = layer.width?.(f.properties, view.scale) ?? 1;
          const isSel = selectedId && String(f.id ?? f.properties?.unitId ?? f.properties?.lixelId ?? "") === String(selectedId);
          ctx.beginPath();
          for (let i = 0; i < line.coords.length; i += 2) {
            const [sx, sy] = toScreen(line.coords[i], line.coords[i + 1], view, w, h);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          if (layer.dashed) ctx.setLineDash([4, 3]);
          if (isSel) {
            ctx.strokeStyle = isLight ? "#0d1420" : "#ffffff";
            ctx.lineWidth = lw + 3;
            ctx.stroke();
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // points (with optional zoom-dependent clustering)
      if (bucket.points.length) {
        const clusterR = layer.clusterRadiusPx ?? 0;
        if (clusterR > 0 && bucket.points.length > 40) {
          const cells = new Map<string, { sx: number; sy: number; n: number; members: FlatPoint[] }>();
          for (const p of bucket.points) {
            const [sx, sy] = toScreen(p.x, p.y, view, w, h);
            if (sx < -50 || sy < -50 || sx > w + 50 || sy > h + 50) continue;
            const key = `${Math.floor(sx / clusterR)}:${Math.floor(sy / clusterR)}`;
            const cur = cells.get(key);
            if (cur) {
              cur.n++;
              cur.sx += sx;
              cur.sy += sy;
              cur.members.push(p);
            } else cells.set(key, { sx, sy, n: 1, members: [p] });
          }
          for (const cell of cells.values()) {
            const cx = cell.sx / cell.n;
            const cy = cell.sy / cell.n;
            if (cell.n === 1) {
              drawPoint(ctx, cx, cy, cell.members[0], data, layer, selectedId, isLight);
            } else {
              const r = Math.min(22, 5 + Math.log2(cell.n) * 3.1);
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.fillStyle = isLight ? "rgba(11,111,164,0.20)" : "rgba(76,201,240,0.16)";
              ctx.fill();
              ctx.strokeStyle = isLight ? "rgba(11,111,164,0.85)" : "rgba(76,201,240,0.85)";
              ctx.lineWidth = 1.1;
              ctx.stroke();
              ctx.fillStyle = isLight ? "#0d1420" : "#e7eef8";
              ctx.font = "600 10px ui-monospace, Menlo, monospace";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(cell.n), cx, cy + 0.5);
            }
          }
        } else {
          for (const p of bucket.points) {
            const [sx, sy] = toScreen(p.x, p.y, view, w, h);
            if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
            drawPoint(ctx, sx, sy, p, data, layer, selectedId, isLight);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    // brush rectangle
    const rect = dragRect ?? (brush ? brushToScreen(brush, view, w, h, toScreen) : null);
    if (rect) {
      ctx.save();
      ctx.strokeStyle = isLight ? "#0b6fa4" : "#4cc9f0";
      ctx.fillStyle = isLight ? "rgba(11,111,164,0.10)" : "rgba(76,201,240,0.10)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      const x = Math.min(rect.x0, rect.x1);
      const y = Math.min(rect.y0, rect.y1);
      const rw = Math.abs(rect.x1 - rect.x0);
      const rh = Math.abs(rect.y1 - rect.y0);
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x + 0.5, y + 0.5, rw, rh);
      ctx.restore();
    }

    // hovered feature marker
    if (hovered) {
      ctx.save();
      ctx.strokeStyle = isLight ? "#0d1420" : "#ffffff";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(hovered.sx, hovered.sy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }, [layers, flat, view, size, selectedId, brush, dragRect, hovered, toScreen, toWorld]);

  /* ---------------- interaction ---------------- */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      setView((v) => {
        const nextScale = Math.min(props.maxScale ?? 60, Math.max(props.minScale ?? 0.02, v.scale * factor));
        const [wx, wy] = toWorld(sx, sy, v, size.w, size.h);
        const cx = wx - (sx - size.w / 2) / nextScale;
        const cy = wy + (sy - size.h / 2) / nextScale;
        return { cx, cy, scale: nextScale };
      });
    },
    [size.w, size.h, toWorld, props.maxScale, props.minScale],
  );

  const pick = useCallback(
    (sx: number, sy: number): { feature: GeoFeature; layerId: string; sx: number; sy: number } | null => {
      const tolerance = 6;
      let best: { feature: GeoFeature; layerId: string; sx: number; sy: number; d: number } | null = null;
      const ordered = layers.slice().sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
      for (const layer of ordered) {
        if (layer.visible === false || layer.pickable === false) continue;
        const bucket = flat.perLayer.get(layer.id);
        if (!bucket) continue;
        const data = bucket.data;
        for (const p of bucket.points) {
          const [px, py] = toScreen(p.x, p.y, view, size.w, size.h);
          const d = Math.hypot(px - sx, py - sy);
          const r = layer.radius?.(data.features[p.index].properties) ?? 4;
          if (d <= r + tolerance && (!best || d < best.d)) best = { feature: data.features[p.index], layerId: layer.id, sx: px, sy: py, d };
        }
        for (const line of bucket.lines) {
          const coords = line.coords;
          for (let i = 0; i < coords.length - 2; i += 2) {
            const [ax, ay] = toScreen(coords[i], coords[i + 1], view, size.w, size.h);
            const [bx, by] = toScreen(coords[i + 2], coords[i + 3], view, size.w, size.h);
            const d = distToSegment(sx, sy, ax, ay, bx, by);
            const lw = layer.width?.(data.features[line.index].properties, view.scale) ?? 1;
            if (d <= lw / 2 + tolerance && (!best || d < best.d)) {
              best = { feature: data.features[line.index], layerId: layer.id, sx, sy, d };
            }
          }
        }
        for (const poly of bucket.polygons) {
          const ring = poly.rings[0];
          if (!ring) continue;
          let inside = false;
          for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
            const [xi, yi] = toScreen(ring[i], ring[i + 1], view, size.w, size.h);
            const [xj, yj] = toScreen(ring[j], ring[j + 1], view, size.w, size.h);
            if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
          }
          if (inside && (!best || best.d > 0)) best = { feature: data.features[poly.index], layerId: layer.id, sx, sy, d: 0 };
        }
        if (best && best.d <= tolerance / 2) break;
      }
      return best ? { feature: best.feature, layerId: best.layerId, sx: best.sx, sy: best.sy } : null;
    },
    [layers, flat, view, size.w, size.h, toScreen],
  );

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { mode: brushMode ? "brush" : "pan", x: e.clientX - rect.left, y: e.clientY - rect.top, moved: false };
    if (brushMode) setDragRect({ x0: e.clientX - rect.left, y0: e.clientY - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
  }, [brushMode]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = toWorld(sx, sy, view, size.w, size.h);
      setCursor({ x: sx, y: sy, lon: invMercX(wx), lat: invMercY(wy) });
      if (drag.current.mode === "pan") {
        const dx = sx - drag.current.x;
        const dy = sy - drag.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
        setView((v) => ({ ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale }));
        drag.current.x = sx;
        drag.current.y = sy;
        return;
      }
      if (drag.current.mode === "brush") {
        drag.current.moved = true;
        setDragRect({ x0: drag.current.x, y0: drag.current.y, x1: sx, y1: sy });
        return;
      }
      const hit = pick(sx, sy);
      setHovered(hit);
      onHover?.(hit?.feature ?? null, hit?.layerId ?? null);
    },
    [view, size.w, size.h, toWorld, pick, onHover],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const mode = drag.current.mode;
      const moved = drag.current.moved;
      drag.current = { mode: "none", x: 0, y: 0, moved: false };
      if (!rect) return;
      if (mode === "brush" && dragRect) {
        const x0 = Math.min(dragRect.x0, dragRect.x1);
        const x1 = Math.max(dragRect.x0, dragRect.x1);
        const y0 = Math.min(dragRect.y0, dragRect.y1);
        const y1 = Math.max(dragRect.y0, dragRect.y1);
        setDragRect(null);
        if (x1 - x0 > 6 && y1 - y0 > 6) {
          const [wxA, wyA] = toWorld(x0, y1, view, size.w, size.h);
          const [wxB, wyB] = toWorld(x1, y0, view, size.w, size.h);
          onBrush?.([invMercX(wxA), invMercY(wyA), invMercX(wxB), invMercY(wyB)]);
        } else {
          onBrush?.(null);
        }
        return;
      }
      if (mode === "pan" && !moved) {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const hit = pick(sx, sy);
        setHovered(hit);
        onSelect?.(hit?.feature ?? null, hit?.layerId ?? null);
        if (!hit && onMapClick) {
          const [wx, wy] = toWorld(sx, sy, view, size.w, size.h);
          onMapClick([invMercX(wx), invMercY(wy)]);
        }
      }
    },
    [dragRect, view, size.w, size.h, toWorld, pick, onSelect, onBrush, onMapClick],
  );

  const zoomBy = useCallback((factor: number) => {
    setView((v) => ({ ...v, scale: Math.min(props.maxScale ?? 60, Math.max(props.minScale ?? 0.02, v.scale * factor)) }));
  }, [props.maxScale, props.minScale]);

  /* ---------------- scale bar ---------------- */
  const scaleBar = useMemo(() => {
    const lat = cursor ? cursor.lat : invMercY(view.cy);
    const metresPerPx = (1 / view.scale) * Math.cos((lat * Math.PI) / 180);
    const targetPx = 110;
    const raw = metresPerPx * targetPx;
    const nice = niceStep(raw);
    return { metres: nice, px: nice / metresPerPx, metresPerPx };
  }, [view.scale, cursor]);

  const projected = useMemo(() => {
    if (!cursor || !crs) return null;
    const p = toUtm(cursor.lon, cursor.lat, crs);
    return { x: p.x, y: p.y, srid: crs.srid, zone: crs.zone };
  }, [cursor, crs]);

  return (
    <div ref={wrapRef} className={`relative min-h-0 overflow-hidden ${className ?? ""}`} style={{ background: "var(--map-bg)" }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: brushMode ? "crosshair" : drag.current.mode === "pan" ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setCursor(null);
          setHovered(null);
          onHover?.(null, null);
        }}
      />
      {/* top-left controls */}
      <div className="pointer-events-auto absolute left-2 top-2 flex flex-col gap-1">
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}>
          <button type="button" className="px-2 py-0.5 text-[12px] leading-none hover:bg-[var(--panel-2)]" onClick={() => zoomBy(1.5)} title="Zoom in">
            +
          </button>
          <button type="button" className="border-l px-2 py-0.5 text-[12px] leading-none hover:bg-[var(--panel-2)]" style={{ borderColor: "var(--border)" }} onClick={() => zoomBy(1 / 1.5)} title="Zoom out">
            −
          </button>
          <button
            type="button"
            className="border-l px-2 py-0.5 text-[11px] leading-none hover:bg-[var(--panel-2)]"
            style={{ borderColor: "var(--border)" }}
            onClick={() => flat.extent && fitToExtent(flat.extent, size.w, size.h)}
            title="Fit to network extent"
          >
            ⤢
          </button>
        </div>
      </div>
      {overlay && <div className="pointer-events-none absolute left-2 top-12 max-w-[62%]">{overlay}</div>}
      {legend && <div className="pointer-events-auto absolute bottom-2 left-2 max-w-[46%]">{legend}</div>}
      {/* readouts */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col items-end gap-1">
        <div className="mono rounded-[3px] border px-2 py-1 text-[10px]" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 88%, transparent)" }}>
          <div className="flex items-center gap-2">
            <div style={{ width: scaleBar.px, height: 4, borderLeft: "1px solid var(--text-dim)", borderRight: "1px solid var(--text-dim)", borderBottom: "1px solid var(--text-dim)" }} />
            <span style={{ color: "var(--text-dim)" }}>{scaleBar.metres >= 1000 ? `${scaleBar.metres / 1000} km` : `${Math.round(scaleBar.metres)} m`}</span>
          </div>
          {cursor && (
            <div className="mt-1 flex gap-3" style={{ color: "var(--text-dim)" }}>
              <span>
                {cursor.lat.toFixed(6)}° {cursor.lon.toFixed(6)}°
              </span>
              {projected && (
                <span style={{ color: "var(--text-mute)" }}>
                  EPSG:{projected.srid} E {projected.x.toFixed(1)} N {projected.y.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {/* tooltip */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-20 max-w-[300px] rounded-[3px] border px-2 py-1.5 text-[10.5px] shadow-lg"
          style={{
            left: Math.min(size.w - 310, hovered.sx + 12),
            top: Math.min(size.h - 130, hovered.sy + 12),
            borderColor: "var(--border-strong)",
            background: "color-mix(in srgb, var(--panel) 96%, transparent)",
          }}
        >
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--accent)" }}>
            {hovered.layerId}
          </div>
          <table className="w-full">
            <tbody>
              {Object.entries(hovered.feature.properties)
                .filter(([k, v]) => v !== null && v !== undefined && !["kind"].includes(k))
                .slice(0, 12)
                .map(([k, v]) => (
                  <tr key={k}>
                    <td className="pr-2 align-top" style={{ color: "var(--text-mute)" }}>
                      {k}
                    </td>
                    <td className="mono text-right align-top" style={{ color: "var(--text)" }}>
                      {typeof v === "number" ? (Math.abs(v) < 0.001 && v !== 0 ? v.toExponential(2) : Number(v.toFixed(4)).toString()) : String(v).slice(0, 46)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function drawPoint(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  p: FlatPoint,
  data: GeoCollection,
  layer: MapLayerSpec,
  selectedId?: string | null,
  isLight?: boolean,
) {
  const f = data.features[p.index];
  const r = layer.radius?.(f.properties) ?? 3.5;
  const color = layer.stroke?.(f.properties, p.index) ?? (isLight ? "#0b6fa4" : "#4cc9f0");
  const fill = layer.fill?.(f.properties);
  const isSel = selectedId && String(f.id ?? "") === String(selectedId);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill ?? color;
  ctx.fill();
  if (isSel) {
    ctx.strokeStyle = isLight ? "#0d1420" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (layer.width) {
    ctx.strokeStyle = isLight ? "rgba(13,20,32,0.55)" : "rgba(6,10,16,0.65)";
    ctx.lineWidth = layer.width(f.properties, 1);
    ctx.stroke();
  }
}

function brushToScreen(
  brush: [number, number, number, number],
  view: View,
  w: number,
  h: number,
  toScreen: (x: number, y: number, v: View, w: number, h: number) => [number, number],
) {
  const [ax, ay] = toScreen(mercX(brush[0]), mercY(brush[1]), view, w, h);
  const [bx, by] = toScreen(mercX(brush[2]), mercY(brush[3]), view, w, h);
  return { x0: ax, y0: ay, x1: bx, y1: by };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const n = raw / pow;
  const mult = n >= 5 ? 5 : n >= 2 ? 2 : n >= 1 ? 1 : 0.5;
  return mult * pow;
}
