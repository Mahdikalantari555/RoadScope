import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  BoxSelect,
  Crosshair,
  Eye,
  Grid,
  Layers,
  Lasso,
  MapPin,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  MapInteractionTool,
  MapOverlayMode,
  NetworkLayersPayload,
  SnapCandidate,
} from '../types/uai';
import { BIVARIATE_3X3, wgs84ToUtm32N } from '../utils/colors';
import { escapeHtml, safeHexColor } from '../utils/html';
import { useLanguage } from '../i18n';
import { getMapChartsText } from '../workspaceI18n';

interface VgiDraftMapOverlay {
  rawLon: number;
  rawLat: number;
  uncertaintyCircle: GeoJSON.Geometry | null;
  candidateSnaps: SnapCandidate[];
  selectedSegmentId: number | null;
}

interface MapCanvasProps {
  darkMode: boolean;
  isSynthetic: boolean;
  presentation?: boolean;
  contextGeojson: GeoJSON.FeatureCollection;
  networkLayers: NetworkLayersPayload | null;
  incidentsGeojson: GeoJSON.FeatureCollection | null;
  vgiDisplacementGeojson: GeoJSON.FeatureCollection | null;
  vgiUncertaintyGeojson: GeoJSON.FeatureCollection | null;
  nkdeGeojson: GeoJSON.FeatureCollection | null;
  tnkdeGeojson?: GeoJSON.FeatureCollection | null;
  giStarGeojson: GeoJSON.FeatureCollection | null;
  ndbscanGeojson: GeoJSON.FeatureCollection | null;
  riskEbGeojson: GeoJSON.FeatureCollection | null;
  overlayMode: MapOverlayMode;
  onChangeOverlayMode: (mode: MapOverlayMode) => void;
  activeTool: MapInteractionTool;
  onChangeTool: (tool: MapInteractionTool) => void;
  selectedSegmentId: number | null;
  onSelectSegment: (segmentId: number | null) => void;
  activeBbox: [number, number, number, number] | null;
  onSelectBbox: (bbox: [number, number, number, number] | null) => void;
  activePolygon: [number, number][] | null;
  onSelectPolygon: (poly: [number, number][] | null) => void;
  onMapVgiClick: (lon: number, lat: number) => void;
  vgiDraftOverlay: VgiDraftMapOverlay | null;
  flyToTarget: { lon: number; lat: number; zoom?: number; ts: number } | null;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const OVERLAY_LABELS: { value: MapOverlayMode; label: string; group: string }[] = [
  { value: 'incidents', label: 'Incidents + Severity Clusters', group: 'Observations' },
  { value: 'true_lambda', label: 'Ground-Truth Intensity λ(e,m,t)', group: 'Simulator' },
  { value: 'nkde', label: 'Network KDE (Lixel Shortest-Path)', group: 'Spatial Lab' },
  { value: 'tnkde', label: 'Adaptive Spatiotemporal TNKDE Slice', group: 'Spatial Lab' },
  { value: 'planar_kde', label: 'Planar 2D Euclidean KDE', group: 'Spatial Lab' },
  { value: 'planar_bias', label: 'Planar − NKDE Distortion Bias (Δ)', group: 'Spatial Lab' },
  { value: 'gi_star', label: 'Network Getis-Ord Gi* (p & FDR)', group: 'Spatial Lab' },
  { value: 'ndbscan', label: 'Network DBSCAN (Hulls & Subgraphs)', group: 'Spatial Lab' },
  { value: 'risk_bivariate_uncertainty', label: '3×3 Bivariate Risk × Uncertainty', group: 'Risk & EB' },
  { value: 'risk_eb_expected', label: 'Empirical Bayes Expected (N_EB)', group: 'Risk & EB' },
  { value: 'risk_psi', label: 'Potential Safety Improvement (PSI)', group: 'Risk & EB' },
  { value: 'risk_mcda', label: 'Multi-Criteria Vulnerability (0-100)', group: 'Risk & EB' },
  { value: 'risk_raw_n', label: 'Tier 1: Raw Crash Frequency (N)', group: 'Safety Metrics' },
  { value: 'risk_linear_density', label: 'Tier 2: Linear Density (N / km)', group: 'Safety Metrics' },
  { value: 'risk_epdo', label: 'Tier 3: EPDO Severity Rate / km', group: 'Safety Metrics' },
  { value: 'risk_mvkt', label: 'Tier 4: Exposure Rate (per MVKT)', group: 'Safety Metrics' },
];

export const MapCanvas: React.FC<MapCanvasProps> = ({
  darkMode,
  isSynthetic,
  presentation = false,
  contextGeojson,
  networkLayers,
  incidentsGeojson,
  vgiDisplacementGeojson,
  vgiUncertaintyGeojson,
  nkdeGeojson,
  tnkdeGeojson,
  giStarGeojson,
  ndbscanGeojson,
  riskEbGeojson,
  overlayMode,
  onChangeOverlayMode,
  activeTool,
  onChangeTool,
  selectedSegmentId,
  onSelectSegment,
  activeBbox,
  onSelectBbox,
  activePolygon,
  onSelectPolygon,
  onMapVgiClick,
  vgiDraftOverlay,
  flyToTarget,
}) => {
  const { language, t } = useLanguage();
  const mapCopy = getMapChartsText(language);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [showBasemap, setShowBasemap] = useState(true);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [showGraticule, setShowGraticule] = useState(true);
  const [showNodes, setShowNodes] = useState(false);
  const [showVgiVectors, setShowVgiVectors] = useState(true);
  const [cursorCoord, setCursorCoord] = useState<{
    lon: number;
    lat: number;
    x_m: number;
    y_m: number;
    zoom: number;
  }>({
    lon: 8.6821,
    lat: 50.1109,
    x_m: 477274.2,
    y_m: 5551042.1,
    zoom: 13.7,
  });

  // Box-select & polygon-select interactive state
  const [dragBoxPx, setDragBoxPx] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const boxStartRef = useRef<{ x: number; y: number; lngLat: maplibregl.LngLat } | null>(null);
  const [draftPolyVertices, setDraftPolyVertices] = useState<[number, number][]>([]);

  // Refs for latest callbacks inside MapLibre event handlers
  const toolRef = useRef<MapInteractionTool>(activeTool);
  toolRef.current = activeTool;
  const onMapVgiClickRef = useRef(onMapVgiClick);
  onMapVgiClickRef.current = onMapVgiClick;
  const onSelectSegmentRef = useRef(onSelectSegment);
  onSelectSegmentRef.current = onSelectSegment;

  // Initialize MapLibre GL JS with self-contained vector cartography
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            'osm-basemap': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              maxzoom: 19,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
            },
          },
          layers: [
            {
              id: 'background-fill',
              type: 'background',
              paint: {
                'background-color': darkMode ? '#070b14' : '#f1f5f9',
              },
            },
            { id: 'osm-basemap-layer', type: 'raster', source: 'osm-basemap' },
          ],
        },
        center: [8.6885, 50.1155],
        zoom: 13.65,
        minZoom: 11.5,
        maxZoom: 18.5,
        attributionControl: { compact: false },
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

      map.on('mousemove', (e) => {
        const { x_m, y_m } = wgs84ToUtm32N(e.lngLat.lng, e.lngLat.lat);
        setCursorCoord({
          lon: Number(e.lngLat.lng.toFixed(5)),
          lat: Number(e.lngLat.lat.toFixed(5)),
          x_m,
          y_m,
          zoom: Number(map.getZoom().toFixed(2)),
        });
      });

      map.on('load', () => {
        // 1. Sources
        map.addSource('context-src', { type: 'geojson', data: contextGeojson || EMPTY_FC });
        map.addSource('segments-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('nodes-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('lixels-true-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('nkde-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('gistar-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('ndbscan-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('risk-eb-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('vgi-uncertainty-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('vgi-displacement-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('incidents-clustered-src', {
          type: 'geojson',
          data: EMPTY_FC,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 36,
        });
        map.addSource('spatial-filter-src', { type: 'geojson', data: EMPTY_FC });
        map.addSource('vgi-draft-src', { type: 'geojson', data: EMPTY_FC });

        // 2. Contextual Hydrography, Parks & Metric Graticule
        map.addLayer({
          id: 'ctx-parks',
          type: 'fill',
          source: 'context-src',
          filter: ['==', ['get', 'feature_class'], 'park'],
          paint: {
            'fill-color': '#0d291e',
            'fill-opacity': 0.55,
          },
        });
        map.addLayer({
          id: 'ctx-river',
          type: 'fill',
          source: 'context-src',
          filter: ['==', ['get', 'feature_class'], 'river'],
          paint: {
            'fill-color': '#0b2944',
            'fill-opacity': 0.85,
          },
        });
        map.addLayer({
          id: 'ctx-graticule',
          type: 'line',
          source: 'context-src',
          filter: ['==', ['get', 'feature_class'], 'graticule'],
          paint: {
            'line-color': '#334155',
            'line-width': 0.7,
            'line-dasharray': [3, 3],
            'line-opacity': 0.45,
          },
        });

        // 3. Base Road Network Surface Hierarchy + Grade-Separated Overpass Casings
        map.addLayer({
          id: 'road-base-casing',
          type: 'line',
          source: 'segments-src',
          filter: ['==', ['get', 'elevation_level'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#1e293b',
            'line-width': [
              'match',
              ['get', 'road_class'],
              'primary_arterial', 7,
              'bridge_link', 7.5,
              'secondary_corridor', 5.5,
              'collector', 4,
              3,
            ],
          },
        });
        map.addLayer({
          id: 'road-base-core',
          type: 'line',
          source: 'segments-src',
          filter: ['==', ['get', 'elevation_level'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'match',
              ['get', 'road_class'],
              'primary_arterial', '#334155',
              'bridge_link', '#38bdf8',
              'secondary_corridor', '#293548',
              '#1e293b',
            ],
            'line-width': [
              'match',
              ['get', 'road_class'],
              'primary_arterial', 4,
              'bridge_link', 4.5,
              'secondary_corridor', 3,
              'collector', 2.2,
              1.6,
            ],
            'line-opacity': 0.85,
          },
        });

        // Elevated Viaduct Overpass (elevation_level == 1) with distinct bridge deck shadow & rail
        map.addLayer({
          id: 'road-overpass-casing',
          type: 'line',
          source: 'segments-src',
          filter: ['>', ['get', 'elevation_level'], 0],
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#020617',
            'line-width': 9,
            'line-opacity': 0.95,
          },
        });
        map.addLayer({
          id: 'road-overpass-core',
          type: 'line',
          source: 'segments-src',
          filter: ['>', ['get', 'elevation_level'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#64748b',
            'line-width': 4.5,
            'line-dasharray': [2, 1.2],
          },
        });

        // Selected Segment Highlight Halo
        map.addLayer({
          id: 'road-selected-highlight',
          type: 'line',
          source: 'segments-src',
          filter: ['==', ['get', 'segment_id'], -999],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#22d3ee',
            'line-width': 9,
            'line-opacity': 0.85,
          },
        });

        // 4. Analytical Lixel & Segment Choropleth Layers (dynamically toggled)
        map.addLayer({
          id: 'layer-true-lambda',
          type: 'line',
          source: 'lixels-true-src',
          layout: { visibility: 'none', 'line-cap': 'round' },
          paint: {
            'line-width': 5.5,
            'line-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'true_lambda_norm'], 0],
              0.0, '#440154',
              0.25, '#3b528b',
              0.5, '#21918c',
              0.75, '#5ec962',
              1.0, '#fde725',
            ],
          },
        });

        map.addLayer({
          id: 'layer-nkde-surface',
          type: 'line',
          source: 'nkde-src',
          layout: { visibility: 'none', 'line-cap': 'round' },
          paint: {
            'line-width': 6,
            'line-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'nkde_norm'], 0],
              0.0, '#160b39',
              0.25, '#5c126e',
              0.5, '#b63679',
              0.75, '#fb8861',
              1.0, '#fcfdbf',
            ],
          },
        });

        map.addLayer({
          id: 'layer-gistar-surface',
          type: 'line',
          source: 'gistar-src',
          layout: { visibility: 'none', 'line-cap': 'round' },
          paint: {
            'line-width': [
              'match',
              ['get', 'significance_class'],
              'hotspot_99', 7.5,
              'hotspot_95', 6,
              'coldspot_99', 6,
              'coldspot_95', 5,
              2.5,
            ],
            'line-color': [
              'match',
              ['get', 'significance_class'],
              'hotspot_99', '#ef4444',
              'hotspot_95', '#fb923c',
              'coldspot_99', '#2563eb',
              'coldspot_95', '#60a5fa',
              '#334155',
            ],
            'line-opacity': [
              'match',
              ['get', 'significance_class'],
              'not_significant', 0.45,
              0.96,
            ],
          },
        });

        // N-DBSCAN Hulls, Topological Subgraphs & Cluster Points
        map.addLayer({
          id: 'layer-ndbscan-hulls',
          type: 'fill',
          source: 'ndbscan-src',
          filter: ['==', ['get', 'geom_role'], 'cluster_hull'],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], '#22d3ee'],
            'fill-opacity': 0.22,
          },
        });
        map.addLayer({
          id: 'layer-ndbscan-subgraphs',
          type: 'line',
          source: 'ndbscan-src',
          filter: ['==', ['get', 'geom_role'], 'cluster_subgraph'],
          layout: { visibility: 'none', 'line-cap': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#22d3ee'],
            'line-width': 6.5,
          },
        });
        map.addLayer({
          id: 'layer-ndbscan-points',
          type: 'circle',
          source: 'ndbscan-src',
          filter: ['==', ['get', 'geom_role'], 'incident_point'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['case', ['boolean', ['get', 'is_noise'], false], 3.5, 6],
            'circle-color': ['coalesce', ['get', 'color'], '#64748b'],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#0f172a',
          },
        });

        // Risk / EB / Bivariate Uncertainty Segment Choropleth
        map.addLayer({
          id: 'layer-risk-eb',
          type: 'line',
          source: 'risk-eb-src',
          layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': 6.5,
            'line-color': ['coalesce', ['get', 'bivariate_color'], '#6c83b5'],
            'line-opacity': 0.94,
          },
        });

        // Topological Junction Nodes (optional toggle)
        map.addLayer({
          id: 'layer-road-nodes',
          type: 'circle',
          source: 'nodes-src',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'degree'], 1, 3, 5, 6],
            'circle-color': [
              'match',
              ['get', 'node_type'],
              'signalized_junction', '#22d3ee',
              'roundabout', '#a855f7',
              'grade_separated_overpass', '#f59e0b',
              'bridge_abutment', '#38bdf8',
              '#94a3b8',
            ],
            'circle-stroke-width': 1.2,
            'circle-stroke-color': '#020617',
          },
        });

        // VGI Observational Uncertainty Circles & Raw->Snapped Displacement Vectors
        map.addLayer({
          id: 'layer-vgi-uncertainty',
          type: 'fill',
          source: 'vgi-uncertainty-src',
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0.08,
          },
        });
        map.addLayer({
          id: 'layer-vgi-displacement',
          type: 'line',
          source: 'vgi-displacement-src',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 1.4,
            'line-dasharray': [2, 2],
            'line-opacity': 0.75,
          },
        });

        // Pre-generate offline numeric sprites for cluster count glyphs (zero external PBF font dependency)
        const registerClusterCountSprites = () => {
          for (let n = 2; n <= 120; n++) {
            const label = n > 99 ? '99+' : String(n);
            const canvas = document.createElement('canvas');
            canvas.width = 48;
            canvas.height = 48;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, 48, 48);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 21px monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, 24, 25);
              const imgData = ctx.getImageData(0, 0, 48, 48);
              map.addImage(`cluster-num-${n}`, { width: 48, height: 48, data: imgData.data }, { pixelRatio: 2 });
            }
          }
        };
        registerClusterCountSprites();

        // Clustered Incident Glyphs + Individual Severity-Styled Points
        map.addLayer({
          id: 'incidents-clusters',
          type: 'circle',
          source: 'incidents-clustered-src',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#0284c7',
              8, '#d97706',
              20, '#dc2626',
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              14,
              8, 18,
              20, 23,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#0f172a',
            'circle-opacity': 0.92,
          },
        });
        map.addLayer({
          id: 'incidents-cluster-count',
          type: 'symbol',
          source: 'incidents-clustered-src',
          filter: ['has', 'point_count'],
          layout: {
            'icon-image': ['concat', 'cluster-num-', ['to-string', ['min', 120, ['get', 'point_count']]]],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
        map.addLayer({
          id: 'incidents-unclustered',
          type: 'circle',
          source: 'incidents-clustered-src',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['coalesce', ['get', 'color'], '#38bdf8'],
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'severity_rank'], 1],
              1, 4.5,
              2, 5.5,
              3, 7,
              4, 9,
            ],
            'circle-stroke-width': 1.3,
            'circle-stroke-color': '#020617',
          },
        });

        // Active Spatial Brush Polygon / Bounding Box
        map.addLayer({
          id: 'spatial-filter-fill',
          type: 'fill',
          source: 'spatial-filter-src',
          paint: {
            'fill-color': '#22d3ee',
            'fill-opacity': 0.12,
          },
        });
        map.addLayer({
          id: 'spatial-filter-outline',
          type: 'line',
          source: 'spatial-filter-src',
          paint: {
            'line-color': '#22d3ee',
            'line-width': 2,
            'line-dasharray': [3, 2],
          },
        });

        // Citizen VGI Live Draft Pin + Uncertainty Circle + Candidate Topological Snaps
        map.addLayer({
          id: 'vgi-draft-circle-fill',
          type: 'fill',
          source: 'vgi-draft-src',
          filter: ['==', ['get', 'role'], 'uncertainty_circle'],
          paint: {
            'fill-color': '#22d3ee',
            'fill-opacity': 0.16,
          },
        });
        map.addLayer({
          id: 'vgi-draft-connector',
          type: 'line',
          source: 'vgi-draft-src',
          filter: ['==', ['get', 'role'], 'snap_connector'],
          paint: {
            'line-color': ['case', ['boolean', ['get', 'is_primary'], false], '#10b981', '#94a3b8'],
            'line-width': ['case', ['boolean', ['get', 'is_primary'], false], 2.5, 1.3],
            'line-dasharray': [2, 2],
          },
        });
        map.addLayer({
          id: 'vgi-draft-points',
          type: 'circle',
          source: 'vgi-draft-src',
          filter: ['in', ['get', 'role'], ['literal', ['raw_pin', 'snap_point']]],
          paint: {
            'circle-radius': ['match', ['get', 'role'], 'raw_pin', 7.5, 6],
            'circle-color': [
              'match',
              ['get', 'role'],
              'raw_pin', '#f43f5e',
              '#10b981',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });

        // Click Interactions
        map.on('click', (e) => {
          const currentTool = toolRef.current;
          if (currentTool === 'vgi_pin') {
            onMapVgiClickRef.current(e.lngLat.lng, e.lngLat.lat);
            return;
          }
          if (currentTool === 'poly_select') {
            setDraftPolyVertices((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
            return;
          }
          if (currentTool !== 'inspect') return;

          // Check cluster click -> zoom in
          const clusterFeats = map.queryRenderedFeatures(e.point, { layers: ['incidents-clusters'] });
          if (clusterFeats.length > 0) {
            map.easeTo({ center: e.lngLat, zoom: map.getZoom() + 1.8 });
            return;
          }

          // Check individual incident click
          const incFeats = map.queryRenderedFeatures(e.point, { layers: ['incidents-unclustered'] });
          if (incFeats.length > 0) {
            const p = incFeats[0].properties || {};
            const html = `
              <div style="background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:6px;padding:10px 12px;font-size:11px;min-width:235px;font-family:Inter,sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                  <span style="font-weight:700;color:${safeHexColor(p.color, '#38bdf8')};">${escapeHtml(p.severity_label || p.severity_code)}</span>
                  <span style="font-family:monospace;font-size:10px;color:#94a3b8;">#${escapeHtml(p.id)} · ${escapeHtml(p.verification_status)}</span>
                </div>
                <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(p.category_label || p.category_code)}</div>
                <div style="color:#cbd5e1;margin-bottom:6px;">Corridor: <b>${escapeHtml(p.segment_name || 'N/A')}</b> (LRS m=${escapeHtml(p.linear_offset_m)}m)</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-family:monospace;font-size:10px;color:#94a3b8;border-top:1px solid #1e293b;padding-top:6px;">
                  <div>EPDO: <b style="color:#f8fafc">${escapeHtml(p.epdo_weight)}</b></div>
                  <div>Credibility: <b style="color:#10b981">${escapeHtml(p.vgi_credibility_score)}</b></div>
                  <div>Snap d⊥: <b>${escapeHtml(p.orthogonal_snap_dist_m)}m</b></div>
                  <div>Witnesses: <b>${escapeHtml(p.witness_count)}</b></div>
                  <div style="grid-column:span 2;">UTC: ${escapeHtml(p.occurred_at_utc)}</div>
                </div>
              </div>
            `;
            popupRef.current?.remove();
            popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
            return;
          }

          // Check analytical lixel / risk segment / base road segment click
          const segLayers = ['layer-risk-eb', 'layer-nkde-surface', 'layer-gistar-surface', 'road-base-casing', 'road-overpass-casing'];
          const existingLayers = segLayers.filter((lid) => map.getLayer(lid));
          const roadFeats = map.queryRenderedFeatures(e.point, { layers: existingLayers });
          if (roadFeats.length > 0) {
            const rp = roadFeats[0].properties || {};
            const sid = Number(rp.segment_id);
            if (!Number.isNaN(sid) && sid > 0) {
              onSelectSegmentRef.current(sid);
              const extraMetric =
                rp.eb_expected_crashes !== undefined
                  ? `<div>EB Expected: <b style="color:#38bdf8">${escapeHtml(rp.eb_expected_crashes)}</b> (PSI: ${escapeHtml(rp.psi_excess_crashes)})</div>
                     <div>Epistemic U: <b style="color:#f59e0b">${escapeHtml(rp.epistemic_uncertainty)}</b> [${escapeHtml(rp.bivariate_class)}]</div>`
                  : rp.tnkde_slice_km_day !== undefined
                  ? `<div>TNKDE Slice: <b style="color:#22d3ee">${escapeHtml(rp.tnkde_slice_km_day)}/km·day</b></div>`
                  : rp.nkde_density !== undefined
                  ? `<div>NKDE: <b style="color:#fca50a">${escapeHtml(rp.nkde_density)}/km</b> · Planar: ${escapeHtml(rp.planar_density)}/km</div>
                     <div>Planar Bias Δ: <b style="color:#f87171">${escapeHtml(rp.planar_bias)}</b></div>`
                  : rp.gi_star_z !== undefined
                  ? `<div>Gi* Z: <b style="color:#ef4444">${escapeHtml(rp.gi_star_z)}</b> (p=${escapeHtml(rp.pseudo_p)}, FDR q=${escapeHtml(rp.fdr_q)})</div>`
                  : '';
              const html = `
                <div style="background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:6px;padding:10px 12px;font-size:11px;min-width:230px;">
                  <div style="font-weight:700;color:#22d3ee;margin-bottom:2px;">${escapeHtml(rp.name || rp.segment_name || `Segment #${sid}`)}</div>
                  <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-bottom:6px;">
                    Class: ${escapeHtml(rp.road_class)} · Elev: L${escapeHtml(rp.elevation_level ?? 0)} · Len: ${escapeHtml(rp.length_m)}m
                  </div>
                  <div style="font-family:monospace;font-size:10px;color:#cbd5e1;display:grid;gap:3px;">
                    ${extraMetric}
                    <div style="color:#64748b;margin-top:3px;">Clicked segment cross-filtered in CMV panels.</div>
                  </div>
                </div>
              `;
              popupRef.current?.remove();
              popupRef.current = new maplibregl.Popup({ closeButton: true })
                .setLngLat(e.lngLat)
                .setHTML(html)
                .addTo(map);
            }
          }
        });

        setMapLoaded(true);
      });

      mapRef.current = map;
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL initialization unavailable');
    }

    return () => {
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Theme updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setPaintProperty('background-fill', 'background-color', darkMode ? '#070b14' : '#f1f5f9');
    map.setPaintProperty('ctx-river', 'fill-color', darkMode ? '#0b2944' : '#bae6fd');
    map.setPaintProperty('ctx-parks', 'fill-color', darkMode ? '#0d291e' : '#bbf7d0');
    map.setPaintProperty('ctx-graticule', 'line-color', darkMode ? '#334155' : '#cbd5e1');
    map.setPaintProperty('road-base-casing', 'line-color', darkMode ? '#1e293b' : '#cbd5e1');
    map.setPaintProperty(
      'road-base-core',
      'line-color',
      darkMode
        ? ['match', ['get', 'road_class'], 'primary_arterial', '#334155', 'bridge_link', '#38bdf8', 'secondary_corridor', '#293548', '#1e293b']
        : ['match', ['get', 'road_class'], 'primary_arterial', '#94a3b8', 'bridge_link', '#0284c7', 'secondary_corridor', '#cbd5e1', '#e2e8f0']
    );
  }, [darkMode, mapLoaded]);

  // Update GeoJSON sources cleanly
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource('context-src') as maplibregl.GeoJSONSource)?.setData(contextGeojson || EMPTY_FC);
  }, [contextGeojson, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !networkLayers) return;
    (map.getSource('segments-src') as maplibregl.GeoJSONSource)?.setData(networkLayers.segments_geojson);
    (map.getSource('nodes-src') as maplibregl.GeoJSONSource)?.setData(networkLayers.nodes_geojson);
    (map.getSource('lixels-true-src') as maplibregl.GeoJSONSource)?.setData(networkLayers.lixels_geojson);
  }, [networkLayers, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource('incidents-clustered-src') as maplibregl.GeoJSONSource)?.setData(incidentsGeojson || EMPTY_FC);
    (map.getSource('vgi-displacement-src') as maplibregl.GeoJSONSource)?.setData(
      showVgiVectors && vgiDisplacementGeojson ? vgiDisplacementGeojson : EMPTY_FC
    );
    (map.getSource('vgi-uncertainty-src') as maplibregl.GeoJSONSource)?.setData(
      showVgiVectors && vgiUncertaintyGeojson ? vgiUncertaintyGeojson : EMPTY_FC
    );
  }, [incidentsGeojson, vgiDisplacementGeojson, vgiUncertaintyGeojson, showVgiVectors, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const activeSurface = overlayMode === 'tnkde' ? tnkdeGeojson : nkdeGeojson;
    (map.getSource('nkde-src') as maplibregl.GeoJSONSource)?.setData(activeSurface || EMPTY_FC);
  }, [nkdeGeojson, tnkdeGeojson, overlayMode, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource('gistar-src') as maplibregl.GeoJSONSource)?.setData(giStarGeojson || EMPTY_FC);
  }, [giStarGeojson, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource('ndbscan-src') as maplibregl.GeoJSONSource)?.setData(ndbscanGeojson || EMPTY_FC);
  }, [ndbscanGeojson, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource('risk-eb-src') as maplibregl.GeoJSONSource)?.setData(riskEbGeojson || EMPTY_FC);
  }, [riskEbGeojson, mapLoaded]);

  // Toggle Graticule & Nodes & Selected Segment
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setLayoutProperty('ctx-graticule', 'visibility', showGraticule ? 'visible' : 'none');
    map.setLayoutProperty('layer-road-nodes', 'visibility', showNodes ? 'visible' : 'none');
    map.setFilter('road-selected-highlight', ['==', ['get', 'segment_id'], selectedSegmentId ?? -999]);
  }, [showGraticule, showNodes, selectedSegmentId, mapLoaded]);

  // FlyTo handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !flyToTarget) return;
    map.flyTo({ center: [flyToTarget.lon, flyToTarget.lat], zoom: flyToTarget.zoom ?? 15.6, duration: 900 });
  }, [flyToTarget, mapLoaded]);

  // Update Active Spatial Brush Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const feats: GeoJSON.Feature[] = [];
    if (activeBbox) {
      const [minLon, minLat, maxLon, maxLat] = activeBbox;
      feats.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
        },
      });
    }
    const polyPts = draftPolyVertices.length >= 2 ? draftPolyVertices : activePolygon;
    if (polyPts && polyPts.length >= 2) {
      if (polyPts.length >= 3) {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[...polyPts, polyPts[0]]],
          },
        });
      } else {
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: polyPts },
        });
      }
    }
    (map.getSource('spatial-filter-src') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: feats,
    });
  }, [activeBbox, activePolygon, draftPolyVertices, mapLoaded]);

  // Update Citizen VGI Live Draft Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!vgiDraftOverlay) {
      (map.getSource('vgi-draft-src') as maplibregl.GeoJSONSource)?.setData(EMPTY_FC);
      return;
    }
    const feats: GeoJSON.Feature[] = [];
    if (vgiDraftOverlay.uncertaintyCircle) {
      feats.push({
        type: 'Feature',
        properties: { role: 'uncertainty_circle' },
        geometry: vgiDraftOverlay.uncertaintyCircle,
      });
    }
    feats.push({
      type: 'Feature',
      properties: { role: 'raw_pin' },
      geometry: { type: 'Point', coordinates: [vgiDraftOverlay.rawLon, vgiDraftOverlay.rawLat] },
    });
    vgiDraftOverlay.candidateSnaps.forEach((c, idx) => {
      const isPrimary = vgiDraftOverlay.selectedSegmentId
        ? c.segment_id === vgiDraftOverlay.selectedSegmentId
        : idx === 0;
      feats.push({
        type: 'Feature',
        properties: { role: 'snap_connector', is_primary: isPrimary },
        geometry: {
          type: 'LineString',
          coordinates: [
            [vgiDraftOverlay.rawLon, vgiDraftOverlay.rawLat],
            [c.snapped_lon, c.snapped_lat],
          ],
        },
      });
      if (isPrimary || idx < 2) {
        feats.push({
          type: 'Feature',
          properties: { role: 'snap_point', is_primary: isPrimary },
          geometry: { type: 'Point', coordinates: [c.snapped_lon, c.snapped_lat] },
        });
      }
    });
    (map.getSource('vgi-draft-src') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: feats,
    });
  }, [vgiDraftOverlay, mapLoaded]);

  // Dynamic Layer Styling for Overlay Mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const showIncidents = overlayMode === 'incidents';
    map.setLayoutProperty('incidents-clusters', 'visibility', showIncidents ? 'visible' : 'none');
    map.setLayoutProperty('incidents-cluster-count', 'visibility', showIncidents ? 'visible' : 'none');
    map.setLayoutProperty('incidents-unclustered', 'visibility', showIncidents ? 'visible' : 'none');
    map.setLayoutProperty('layer-true-lambda', 'visibility', overlayMode === 'true_lambda' ? 'visible' : 'none');

    const isNkdeFamily =
      overlayMode === 'nkde' ||
      overlayMode === 'tnkde' ||
      overlayMode === 'planar_kde' ||
      overlayMode === 'planar_bias';
    map.setLayoutProperty('layer-nkde-surface', 'visibility', isNkdeFamily ? 'visible' : 'none');
    if (overlayMode === 'nkde') {
      map.setPaintProperty('layer-nkde-surface', 'line-color', [
        'interpolate', ['linear'], ['coalesce', ['get', 'nkde_norm'], 0],
        0.0, '#160b39', 0.25, '#5c126e', 0.5, '#b63679', 0.75, '#fb8861', 1.0, '#fcfdbf',
      ]);
    } else if (overlayMode === 'tnkde') {
      map.setPaintProperty('layer-nkde-surface', 'line-color', [
        'interpolate', ['linear'], ['coalesce', ['get', 'tnkde_norm'], 0],
        0.0, '#0f172a', 0.25, '#0369a1', 0.5, '#06b6d4', 0.75, '#f59e0b', 1.0, '#f43f5e',
      ]);
    } else if (overlayMode === 'planar_kde') {
      map.setPaintProperty('layer-nkde-surface', 'line-color', [
        'interpolate', ['linear'], ['min', 1, ['/', ['coalesce', ['get', 'planar_density'], 0], 35]],
        0.0, '#160b39', 0.25, '#5c126e', 0.5, '#b63679', 0.75, '#fb8861', 1.0, '#fcfdbf',
      ]);
    } else if (overlayMode === 'planar_bias') {
      map.setPaintProperty('layer-nkde-surface', 'line-color', [
        'interpolate', ['linear'], ['coalesce', ['get', 'bias_norm'], 0],
        -1.0, '#2563eb',
        -0.3, '#60a5fa',
        0.0, '#334155',
        0.3, '#fb923c',
        1.0, '#ef4444',
      ]);
    }

    map.setLayoutProperty('layer-gistar-surface', 'visibility', overlayMode === 'gi_star' ? 'visible' : 'none');

    const isDbscan = overlayMode === 'ndbscan';
    map.setLayoutProperty('layer-ndbscan-hulls', 'visibility', isDbscan ? 'visible' : 'none');
    map.setLayoutProperty('layer-ndbscan-subgraphs', 'visibility', isDbscan ? 'visible' : 'none');
    map.setLayoutProperty('layer-ndbscan-points', 'visibility', isDbscan ? 'visible' : 'none');

    const isRiskFamily = overlayMode.startsWith('risk_');
    map.setLayoutProperty('layer-risk-eb', 'visibility', isRiskFamily ? 'visible' : 'none');
    if (isRiskFamily) {
      if (overlayMode === 'risk_bivariate_uncertainty') {
        map.setPaintProperty('layer-risk-eb', 'line-color', ['coalesce', ['get', 'bivariate_color'], '#6c83b5']);
        map.setPaintProperty('layer-risk-eb', 'line-opacity', 0.96);
      } else if (overlayMode === 'risk_psi') {
        map.setPaintProperty('layer-risk-eb', 'line-color', [
          'interpolate', ['linear'], ['coalesce', ['get', 'psi_excess_crashes'], 0],
          -4.0, '#2563eb',
          0.0, '#475569',
          2.5, '#f97316',
          6.0, '#ef4444',
        ]);
      } else {
        const propMap: Record<string, [string, number]> = {
          risk_eb_expected: ['eb_density_per_km', 30],
          risk_mcda: ['mcda_vulnerability_index', 85],
          risk_raw_n: ['raw_crash_frequency', 14],
          risk_linear_density: ['linear_crash_density_per_km', 32],
          risk_epdo: ['epdo_per_km', 140],
          risk_mvkt: ['exposure_mvkt_rate', 6],
        };
        const [field, maxScale] = propMap[overlayMode] || ['eb_density_per_km', 30];
        map.setPaintProperty('layer-risk-eb', 'line-color', [
          'interpolate',
          ['linear'],
          ['min', 1, ['/', ['coalesce', ['get', field], 0], maxScale]],
          0.0, '#440154',
          0.25, '#3b528b',
          0.5, '#21918c',
          0.75, '#5ec962',
          1.0, '#fde725',
        ]);
        // Modulate opacity slightly by exposure confidence when viewing MVKT rate
        map.setPaintProperty(
          'layer-risk-eb',
          'line-opacity',
          overlayMode === 'risk_mvkt'
            ? ['interpolate', ['linear'], ['coalesce', ['get', 'exposure_confidence'], 0.8], 0.4, 0.55, 1.0, 0.98]
            : 0.94
        );
      }
    }
  }, [overlayMode, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setLayoutProperty('osm-basemap-layer', 'visibility', showBasemap ? 'visible' : 'none');
  }, [showBasemap, mapLoaded]);

  // Enable/Disable Map Pan during Box Select Drag
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (activeTool === 'box_select') {
      map.dragPan.disable();
    } else {
      map.dragPan.enable();
      setDragBoxPx(null);
    }
  }, [activeTool]);

  const handleMouseDownBox = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'box_select' || !mapRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lngLat = mapRef.current.unproject([x, y]);
    boxStartRef.current = { x, y, lngLat };
    setDragBoxPx({ x0: x, y0: y, x1: x, y1: y });
  };

  const handleMouseMoveBox = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'box_select' || !boxStartRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDragBoxPx({ x0: boxStartRef.current.x, y0: boxStartRef.current.y, x1: x, y1: y });
  };

  const handleMouseUpBox = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'box_select' || !boxStartRef.current || !mapRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const endLL = mapRef.current.unproject([x, y]);
    const startLL = boxStartRef.current.lngLat;
    boxStartRef.current = null;
    setDragBoxPx(null);

    if (Math.abs(x - (dragBoxPx?.x0 ?? x)) > 6 && Math.abs(y - (dragBoxPx?.y0 ?? y)) > 6) {
      const bbox: [number, number, number, number] = [
        Math.min(startLL.lng, endLL.lng),
        Math.min(startLL.lat, endLL.lat),
        Math.max(startLL.lng, endLL.lng),
        Math.max(startLL.lat, endLL.lat),
      ];
      onSelectBbox(bbox);
      onChangeTool('inspect');
    }
  };

  const finishPolygonBrush = () => {
    if (draftPolyVertices.length >= 3) {
      onSelectPolygon(draftPolyVertices);
    }
    setDraftPolyVertices([]);
    onChangeTool('inspect');
  };

  const clearSpatialFilters = () => {
    setDraftPolyVertices([]);
    onSelectBbox(null);
    onSelectPolygon(null);
    onSelectSegment(null);
  };

  const resetCamera = () => {
    mapRef.current?.flyTo({ center: [8.6885, 50.1155], zoom: 13.65, bearing: 0, pitch: 0 });
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Main WebGL Map Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDownBox}
        onMouseMove={handleMouseMoveBox}
        onMouseUp={handleMouseUpBox}
        className={`w-full h-full ${
          activeTool === 'vgi_pin' || activeTool === 'box_select' || activeTool === 'poly_select'
            ? 'cursor-crosshair'
            : 'cursor-grab'
        }`}
      />

      {/* Fallback SVG Vector Canvas if WebGL context unavailable */}
      {webglError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300 p-6 text-center">
          <p className="text-sm font-mono text-amber-400 mb-2">
            {t('noWebgl')} ({webglError})
          </p>
          <p className="text-xs text-slate-400 max-w-md">{mapCopy.fallbackSubtitle}</p>
        </div>
      )}

      {/* Dragging Box Selection Rectangle */}
      {dragBoxPx && (
        <div
          className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-400/15 z-20"
          style={{
            left: Math.min(dragBoxPx.x0, dragBoxPx.x1),
            top: Math.min(dragBoxPx.y0, dragBoxPx.y1),
            width: Math.abs(dragBoxPx.x1 - dragBoxPx.x0),
            height: Math.abs(dragBoxPx.y1 - dragBoxPx.y0),
          }}
        />
      )}

      {/* Top-Start: Multi-Scale Cartographic Layer Switcher & Spatial Selection Toolbar */}
      <div
        className={`${presentation ? 'hidden' : 'flex'} absolute top-3 start-3 z-10 flex-col gap-2 max-w-[330px] ${
          darkMode ? 'text-slate-100' : 'text-slate-900'
        }`}
      >
        <div
          className={`rounded-md border p-2 shadow-lg backdrop-blur-md ${
            darkMode ? 'bg-slate-950/90 border-slate-800' : 'bg-white/95 border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
              {mapCopy.layerTitle}
            </span>
          </div>
          <select
            value={overlayMode}
            onChange={(e) => onChangeOverlayMode(e.target.value as MapOverlayMode)}
            className={`w-full text-xs font-mono px-2 py-1.5 rounded border focus:outline-none ${
              darkMode
                ? 'bg-slate-900 border-slate-700 text-cyan-200'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          >
            {OVERLAY_LABELS.map((item) => (
              <option key={item.value} value={item.value} className="bg-slate-900 text-slate-100">
                [{item.group}] {item.label}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
            <input type="checkbox" checked={showBasemap} onChange={(e) => setShowBasemap(e.target.checked)} />
            {language === 'fa' ? 'نقشهٔ پایه OpenStreetMap' : 'OpenStreetMap basemap'}
          </label>
          {showBasemap && (
            <p className="mt-1 text-[10px] opacity-75" role="note">
              {language === 'fa'
                ? 'نقشهٔ پایه آنلاین است و درخواست کاشی‌ها به OpenStreetMap ارسال می‌شود.'
                : 'Online basemap: tile requests are sent to OpenStreetMap.'}
              {isSynthetic && (language === 'fa'
                ? ' شبکه و رخدادهای مصنوعی ممکن است با خیابان‌های واقعی منطبق نباشند.'
                : ' Synthetic roads and incidents may not align with real streets.')}
            </p>
          )}

          <label className="block mt-2 text-[10px] opacity-80" htmlFor="segment-search">
            {language === 'fa' ? 'جست‌وجو در شبکهٔ مجموعه‌داده' : 'Search dataset road network'}
          </label>
          <input id="segment-search" type="search" value={segmentSearch} onChange={(e) => setSegmentSearch(e.target.value)}
            placeholder={language === 'fa' ? 'نام یا شناسهٔ قطعه' : 'Road name or segment ID'}
            className={`w-full mt-1 px-2 py-1 rounded border text-xs ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`} />
          {segmentSearch.trim() && (
            <div className="mt-1 max-h-28 overflow-y-auto" aria-label={language === 'fa' ? 'نتایج جست‌وجو' : 'Search results'}>
              {(networkLayers?.segments_geojson.features ?? []).filter((feature) =>
                `${feature.properties?.name ?? ''} ${feature.properties?.segment_id ?? ''}`.toLowerCase().includes(segmentSearch.trim().toLowerCase())
              ).slice(0, 5).map((feature) => (
                <button key={String(feature.properties?.segment_id)} type="button" className="block w-full text-start px-2 py-1 text-xs hover:bg-cyan-500/20 rounded"
                  onClick={() => {
                    if (feature.geometry.type !== 'LineString') return;
                    const coords = feature.geometry.coordinates;
                    const midpoint = coords[Math.floor(coords.length / 2)];
                    if (midpoint) mapRef.current?.flyTo({ center: [midpoint[0], midpoint[1]], zoom: 15.5 });
                    onSelectSegment(Number(feature.properties?.segment_id));
                    setSegmentSearch('');
                  }}>
                  {feature.properties?.name || 'Segment'} · #{feature.properties?.segment_id}
                </button>
              ))}
              {!(networkLayers?.segments_geojson.features ?? []).some((feature) =>
                `${feature.properties?.name ?? ''} ${feature.properties?.segment_id ?? ''}`.toLowerCase().includes(segmentSearch.trim().toLowerCase())
              ) && <p className="px-2 py-1 text-xs opacity-70">{language === 'fa' ? 'قطعه‌ای پیدا نشد.' : 'No segments found.'}</p>}
            </div>
          )}

          {/* Map Interaction Tools */}
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-800/60 flex-wrap">
            <button
              type="button"
              onClick={() => onChangeTool('inspect')}
              title="Inspect Incidents, Lixels & Road Segments"
              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 border ${
                activeTool === 'inspect'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'border-transparent hover:bg-slate-800/60 opacity-80'
              }`}
            >
              <Eye className="w-3 h-3" /> {mapCopy.toolInspect}
            </button>
            <button
              type="button"
              onClick={() => onChangeTool('box_select')}
              title="Drag Bounding-Box Spatial Brush"
              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 border ${
                activeTool === 'box_select'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'border-transparent hover:bg-slate-800/60 opacity-80'
              }`}
            >
              <BoxSelect className="w-3 h-3" /> {mapCopy.toolBox}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftPolyVertices([]);
                onChangeTool('poly_select');
              }}
              title="Draw Custom Polygon Spatial Brush"
              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 border ${
                activeTool === 'poly_select'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'border-transparent hover:bg-slate-800/60 opacity-80'
              }`}
            >
              <Lasso className="w-3 h-3" /> {mapCopy.toolPoly}
            </button>
            <button
              type="button"
              onClick={() => onChangeTool('vgi_pin')}
              title="Place Citizen VGI Incident Pin on Map"
              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 border ${
                activeTool === 'vgi_pin'
                  ? 'bg-rose-500/20 border-rose-400 text-rose-300'
                  : 'border-transparent hover:bg-slate-800/60 opacity-80'
              }`}
            >
              <MapPin className="w-3 h-3" /> {mapCopy.toolPin}
            </button>
          </div>

          {/* Toggles: Graticule, Nodes, VGI Displacement, Reset */}
          <div className="flex items-center justify-between gap-1 mt-1.5 text-[10px] font-mono opacity-85">
            <button
              type="button"
              onClick={() => setShowGraticule((v) => !v)}
              className={`px-1.5 py-0.5 rounded border ${
                showGraticule ? 'border-cyan-500/50 text-cyan-400' : 'border-slate-700 text-slate-400'
              }`}
            >
              <Grid className="w-2.5 h-2.5 inline me-1" />
              {mapCopy.utmGrid}
            </button>
            <button
              type="button"
              onClick={() => setShowNodes((v) => !v)}
              className={`px-1.5 py-0.5 rounded border ${
                showNodes ? 'border-cyan-500/50 text-cyan-400' : 'border-slate-700 text-slate-400'
              }`}
            >
              {mapCopy.nodes}
            </button>
            <button
              type="button"
              onClick={() => setShowVgiVectors((v) => !v)}
              className={`px-1.5 py-0.5 rounded border ${
                showVgiVectors ? 'border-amber-500/50 text-amber-400' : 'border-slate-700 text-slate-400'
              }`}
            >
              {mapCopy.vgiDrift}
            </button>
            <button
              type="button"
              onClick={resetCamera}
              title="Reset Map Extent"
              className="px-1.5 py-0.5 rounded border border-slate-700 hover:border-slate-500"
            >
              <RotateCcw className="w-2.5 h-2.5 inline" />
            </button>
          </div>
        </div>

        {/* Polygon Drawing Action Banner */}
        {activeTool === 'poly_select' && (
          <div className="rounded border border-cyan-400/60 bg-slate-950/95 text-cyan-200 px-3 py-2 text-xs flex items-center justify-between gap-2 shadow-lg">
            <span>
              {mapCopy.clickVertices} ({draftPolyVertices.length})
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={draftPolyVertices.length < 3}
                onClick={finishPolygonBrush}
                className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-semibold disabled:opacity-40"
              >
                {mapCopy.apply}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftPolyVertices([]);
                  onChangeTool('inspect');
                }}
                className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
              >
                {mapCopy.cancel}
              </button>
            </div>
          </div>
        )}

        {/* Active Spatial Selection Pill */}
        {(activeBbox || activePolygon || selectedSegmentId !== null) && (
          <div className="rounded border border-emerald-500/50 bg-slate-950/90 text-emerald-300 px-2.5 py-1.5 text-[11px] font-mono flex items-center justify-between gap-2">
            <span>
              {mapCopy.spatialFilter}:{' '}
              {activeBbox
                ? 'Bounding Box'
                : activePolygon
                ? `Polygon (${activePolygon.length}v)`
                : `Seg #${selectedSegmentId}`}
            </span>
            <button type="button" onClick={clearSpatialFilters} className="hover:text-white flex items-center gap-0.5">
              <X className="w-3 h-3" /> {mapCopy.clear}
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Start: Publication-Grade Dynamic Cartographic Legend */}
      <div
        className={`absolute bottom-9 start-3 z-10 rounded-md border p-2.5 shadow-lg backdrop-blur-md text-[11px] max-w-[275px] ${
          darkMode ? 'bg-slate-950/90 border-slate-800 text-slate-200' : 'bg-white/95 border-slate-300 text-slate-800'
        }`}
      >
        {overlayMode === 'incidents' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider opacity-80">
              Incident Severity &amp; VGI Topology
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] inline-block" /> PDO (w=1.0)
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-full bg-[#facc15] inline-block" /> Minor (w=3.5)
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-3 h-3 rounded-full bg-[#f97316] inline-block" /> Serious (w=12)
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-3.5 h-3.5 rounded-full bg-[#ef4444] inline-block" /> Fatal (w=45)
              </span>
            </div>
            <div className="mt-1.5 pt-1 border-t border-slate-800/60 text-[10px] font-mono opacity-80 flex items-center justify-between">
              <span>--- Elevated Overpass (L1)</span>
              <span className="text-amber-400">- - VGI Snap Drift</span>
            </div>
          </div>
        )}

        {(overlayMode === 'nkde' || overlayMode === 'planar_kde') && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              {overlayMode === 'nkde' ? 'Lixel NKDE Intensity (crashes/km·yr)' : 'Planar 2D KDE Intensity'}
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background: 'linear-gradient(to right, #160b39, #5c126e, #b63679, #fb8861, #fcfdbf)',
              }}
            />
            <div className="flex justify-between text-[10px] font-mono mt-1 opacity-80">
              <span>0.0 (Low)</span>
              <span>Median</span>
              <span>99th Pct (Peak)</span>
            </div>
          </div>
        )}

        {overlayMode === 'tnkde' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              Adaptive Spatiotemporal TNKDE Slice (/km·day)
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background: 'linear-gradient(to right, #0f172a, #0369a1, #06b6d4, #f59e0b, #f43f5e)',
              }}
            />
            <div className="flex justify-between text-[10px] font-mono mt-1 opacity-80">
              <span>0.0</span>
              <span>Moderate</span>
              <span>Slice Peak</span>
            </div>
          </div>
        )}

        {overlayMode === 'planar_bias' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              Planar Distortion Bias (λ_Planar − λ_NKDE)
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background: 'linear-gradient(to right, #2563eb, #60a5fa, #334155, #fb923c, #ef4444)',
              }}
            />
            <div className="flex justify-between text-[10px] font-mono mt-1 opacity-85">
              <span className="text-blue-400">− Underest.</span>
              <span>0</span>
              <span className="text-red-400">+ Planar Spillover</span>
            </div>
          </div>
        )}

        {overlayMode === 'gi_star' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              Network Getis-Ord Gi* Significance
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
              <span className="flex items-center gap-1"><i className="w-3 h-1.5 bg-[#ef4444] inline-block" /> Hotspot p&lt;0.01</span>
              <span className="flex items-center gap-1"><i className="w-3 h-1.5 bg-[#fb923c] inline-block" /> Hotspot p&lt;0.05</span>
              <span className="flex items-center gap-1"><i className="w-3 h-1.5 bg-[#2563eb] inline-block" /> Coldspot p&lt;0.01</span>
              <span className="flex items-center gap-1"><i className="w-3 h-1.5 bg-[#60a5fa] inline-block" /> Coldspot p&lt;0.05</span>
            </div>
          </div>
        )}

        {overlayMode === 'risk_bivariate_uncertainty' && (
          <div>
            <div className="font-semibold mb-1.5 text-[10px] uppercase tracking-wider">
              3×3 Bivariate: EB Risk (→) × Uncertainty (↑)
            </div>
            <div className="flex items-center gap-2.5">
              <div className="grid grid-cols-3 gap-0.5 border border-slate-700 p-0.5 rounded">
                {['1-3', '2-3', '3-3', '1-2', '2-2', '3-2', '1-1', '2-1', '3-1'].map((code) => (
                  <div
                    key={code}
                    title={`Risk-Uncertainty Class ${code}`}
                    className="w-5 h-5"
                    style={{ backgroundColor: BIVARIATE_3X3[code] }}
                  />
                ))}
              </div>
              <div className="text-[10px] font-mono leading-tight space-y-1 opacity-85">
                <div><b className="text-[#6c83b5]">■ 3-1</b> High Risk · High Conf</div>
                <div><b className="text-[#2a5a5b]">■ 3-3</b> High Risk · High Uncert</div>
                <div><b className="text-[#73ae80]">■ 1-3</b> Low Risk · Sparse/VGI</div>
              </div>
            </div>
          </div>
        )}

        {(overlayMode === 'true_lambda' ||
          (overlayMode.startsWith('risk_') &&
            overlayMode !== 'risk_bivariate_uncertainty' &&
            overlayMode !== 'risk_psi')) && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              {OVERLAY_LABELS.find((o) => o.value === overlayMode)?.label}
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background: 'linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)',
              }}
            />
            <div className="flex justify-between text-[10px] font-mono mt-1 opacity-80">
              <span>Low</span>
              <span>Moderate</span>
              <span>High Priority</span>
            </div>
          </div>
        )}

        {overlayMode === 'risk_psi' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              PSI Excess Crash Frequency (N_EB − μ_SPF)
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background: 'linear-gradient(to right, #2563eb, #475569, #f97316, #ef4444)',
              }}
            />
            <div className="flex justify-between text-[10px] font-mono mt-1 opacity-80">
              <span>Below SPF Prior</span>
              <span>0</span>
              <span>Excess Risk (+)</span>
            </div>
          </div>
        )}

        {overlayMode === 'ndbscan' && (
          <div>
            <div className="font-semibold mb-1 text-[10px] uppercase tracking-wider">
              Network DBSCAN Subgraphs &amp; Metric Hulls
            </div>
            <div className="text-[10px] font-mono opacity-85">
              Shortest-path ε_net traversal · Shaded 18m metric hulls + exact road subgraphs · Grey = Noise
            </div>
          </div>
        )}
      </div>

      {/* Bottom Telemetry Bar: Live Dual-CRS Metric + Geographic Coordinate Readout */}
      <div
        className={`absolute bottom-0 inset-x-0 z-10 px-3 py-1 border-t text-[11px] font-mono tabular-nums flex items-center justify-between gap-2 ${
          darkMode
            ? 'bg-slate-950/95 border-slate-800 text-slate-400'
            : 'bg-white/95 border-slate-300 text-slate-600'
        }`}
      >
        <div className="flex items-center gap-3 truncate">
          <span className="flex items-center gap-1 text-cyan-400">
            <Crosshair className="w-3 h-3" />
            EPSG:25832 E {cursorCoord.x_m.toLocaleString('en-US', { minimumFractionDigits: 1 })}m · N{' '}
            {cursorCoord.y_m.toLocaleString('en-US', { minimumFractionDigits: 1 })}m
          </span>
          <span className="hidden sm:inline">
            | WGS84 {cursorCoord.lon.toFixed(5)}°E, {cursorCoord.lat.toFixed(5)}°N
          </span>
        </div>
        <div className="shrink-0">Zoom {cursorCoord.zoom}</div>
      </div>
    </div>
  );
};
