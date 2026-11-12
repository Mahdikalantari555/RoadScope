import React, { useMemo } from 'react';
import { useLanguage } from '../i18n';
import type { NetworkLayersPayload } from '../types/uai';

interface Props {
  network: NetworkLayersPayload | null;
  incidents: GeoJSON.FeatureCollection | null;
  /** Fallback extent when the network is empty. */
  center4326?: [number, number] | null;
  networkBbox4326?: { min_lon: number; min_lat: number; max_lon: number; max_lat: number } | null;
  darkMode: boolean;
  /** Why WebGL is unavailable, shown verbatim so the user can act on it. */
  reason?: string | null;
  isSynthetic?: boolean;
}

const WIDTH = 1000;
const HEIGHT = 640;
const PAD = 40;

/**
 * Non-WebGL vector fallback (task 2.6).
 *
 * WebGL is unavailable in some managed browsers, in remote desktops and when hardware
 * acceleration is disabled. Showing a bare error leaves the user with no map at all, so this
 * renders the *same* GeoJSON as a plain SVG: road network plus incidents, projected into the
 * viewport. It deliberately keeps the cartography simple (no shading, no basemap tiles) and is
 * explicitly labelled as a reduced view so it can never be mistaken for the full map.
 *
 * The SVG is exposed as `role="img"` with a descriptive label rather than as thousands of
 * individual shapes, so screen-reader navigation stays usable.
 */
export const OfflineMapFallback: React.FC<Props> = ({
  network,
  incidents,
  center4326,
  networkBbox4326,
  darkMode,
  reason,
  isSynthetic,
}) => {
  const { language } = useLanguage();
  const fa = language === 'fa';

  const bounds = useMemo(() => {
    if (networkBbox4326) {
      return {
        minLon: networkBbox4326.min_lon,
        minLat: networkBbox4326.min_lat,
        maxLon: networkBbox4326.max_lon,
        maxLat: networkBbox4326.max_lat,
      };
    }
    // Derive the extent from the features themselves before falling back to the study centre.
    let minLon = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    const visit = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        minLon = Math.min(minLon, coords[0]);
        maxLon = Math.max(maxLon, coords[0]);
        minLat = Math.min(minLat, coords[1]);
        maxLat = Math.max(maxLat, coords[1]);
        return;
      }
      coords.forEach(visit);
    };
    for (const feature of network?.segments_geojson.features ?? []) {
      const geometry = feature.geometry as GeoJSON.Geometry | null | undefined;
      if (geometry && 'coordinates' in geometry) visit(geometry.coordinates);
    }
    if (!Number.isFinite(minLon) && center4326) {
      minLon = center4326[0] - 0.01;
      maxLon = center4326[0] + 0.01;
      minLat = center4326[1] - 0.01;
      maxLat = center4326[1] + 0.01;
    }
    if (!Number.isFinite(minLon)) return null;
    return { minLon, minLat, maxLon, maxLat };
  }, [network, networkBbox4326, center4326]);

  const project = useMemo(() => {
    if (!bounds) return null;
    const spanLon = Math.max(1e-9, bounds.maxLon - bounds.minLon);
    const spanLat = Math.max(1e-9, bounds.maxLat - bounds.minLat);
    // Preserve aspect ratio so the geometry is not stretched: a distorted network would mislead
    // about the very thing the map is for.
    const scale = Math.min((WIDTH - 2 * PAD) / spanLon, (HEIGHT - 2 * PAD) / spanLat);
    const offsetX = (WIDTH - spanLon * scale) / 2;
    const offsetY = (HEIGHT - spanLat * scale) / 2;
    return (lon: number, lat: number): [number, number] => [
      offsetX + (lon - bounds.minLon) * scale,
      // Web Mercator is unnecessary at this zoom; a latitude flip is enough for a fallback.
      HEIGHT - offsetY - (lat - bounds.minLat) * scale,
    ];
  }, [bounds]);

  const paths = useMemo(() => {
    if (!project || !network) return [];
    const out: { key: string; d: string; elevated: boolean }[] = [];
    network.segments_geojson.features.forEach((feature, index) => {
      if (feature.geometry?.type !== 'LineString') return;
      const points = feature.geometry.coordinates
        .map((coord) => {
          if (!Array.isArray(coord) || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') return null;
          return project(coord[0], coord[1]);
        })
        .filter((p): p is [number, number] => p !== null);
      if (points.length < 2) return;
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
      out.push({
        key: String(feature.properties?.segment_id ?? index),
        d,
        elevated: Number(feature.properties?.elevation_level ?? 0) > 0,
      });
    });
    return out;
  }, [network, project]);

  const points = useMemo(() => {
    if (!project || !incidents) return [];
    return incidents.features
      .map((feature, index) => {
        const geometry = feature.geometry;
        if (geometry?.type !== 'Point') return null;
        const [lon, lat] = geometry.coordinates;
        if (typeof lon !== 'number' || typeof lat !== 'number') return null;
        const [x, y] = project(lon, lat);
        return {
          key: String(feature.properties?.id ?? index),
          x,
          y,
          color: typeof feature.properties?.color === 'string' ? feature.properties.color : '#38bdf8',
          label: String(feature.properties?.severity_label ?? feature.properties?.severity_code ?? ''),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [incidents, project]);

  const background = darkMode ? '#070b14' : '#f8fafc';
  const road = darkMode ? '#334155' : '#cbd5e1';
  const roadElevated = darkMode ? '#64748b' : '#94a3b8';

  const summary = fa
    ? `نمای برداری جایگزین (بدون WebGL): ${paths.length} قطعهٔ راه و ${points.length} رخداد.`
    : `Reduced vector view (WebGL unavailable): ${paths.length} road segments and ${points.length} incidents.`;

  return (
    <div className="absolute inset-0 flex flex-col bg-slate-950 text-slate-200" data-testid="offline-map-fallback">
      <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
        <p className="font-semibold">
          {fa ? 'نمای برداری سادهٔ جایگزین (WebGL در دسترس نیست)' : 'Reduced vector view (WebGL unavailable)'}
        </p>
        <p className="opacity-90">
          {fa
            ? 'شبکه و رخدادها رسم می‌شوند اما نقشهٔ پایه، سایه‌زنی و تعامل کامل وجود ندارد.'
            : 'The network and incidents are drawn, but there is no basemap, no shading and no full interaction.'}
          {reason ? (
            <>
              {' '}
              <bdi dir="ltr" className="font-mono opacity-80">
                ({reason})
              </bdi>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex-1 min-h-0 p-2">
        {!project || paths.length === 0 ? (
          <p className="p-3 text-xs" role="status" data-testid="offline-map-empty">
            {fa
              ? 'دادهٔ شبکه‌ای برای رسم در دسترس نیست. سایر بخش‌های تحلیلی همچنان کار می‌کنند.'
              : 'No network geometry is available to draw. The analytical workspaces remain usable.'}
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-full"
            role="img"
            aria-label={summary}
            data-testid="offline-map-svg"
          >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={background} />
            <g stroke={road} strokeWidth={1.6} fill="none" strokeLinecap="round">
              {paths
                .filter((p) => !p.elevated)
                .map((p) => (
                  <path key={p.key} d={p.d} />
                ))}
            </g>
            <g stroke={roadElevated} strokeWidth={1.6} fill="none" strokeDasharray="6 4" strokeLinecap="round">
              {paths
                .filter((p) => p.elevated)
                .map((p) => (
                  <path key={p.key} d={p.d} />
                ))}
            </g>
            <g>
              {points.map((p) => (
                <circle key={p.key} cx={p.x} cy={p.y} r={3.2} fill={p.color} stroke="#020617" strokeWidth={0.8}>
                  <title>{p.label}</title>
                </circle>
              ))}
            </g>
          </svg>
        )}
      </div>
      {isSynthetic && (
        <p className="shrink-0 px-3 pb-2 text-[10px] text-amber-300" role="note">
          {fa
            ? 'رخدادهای مصنوعی؛ خطر دنیای واقعی نیست.'
            : 'Synthetic incidents; not real-world risk.'}
        </p>
      )}
    </div>
  );
};
