import React, { useCallback, useEffect, useRef, useState } from 'react';
import { uaiApi } from './api/client';
import { AnalyticsWorkspace } from './components/AnalyticsWorkspace';
import { ActiveFilters } from './components/ActiveFilters';
import { CitizenReportWorkspace } from './components/CitizenReportWorkspace';
import { HeaderBar } from './components/HeaderBar';
import { MapCanvas } from './components/MapCanvas';
import { TehranPreview } from './components/TehranPreview';
import { RiskEbWorkspace } from './components/RiskEbWorkspace';
import { SimulatorWorkspace } from './components/SimulatorWorkspace';
import { SpatialLabWorkspace } from './components/SpatialLabWorkspace';
import { StewardWorkspace } from './components/StewardWorkspace';
import { useLanguage } from './i18n';
import type {
  CmvFilterState,
  CmvStatePayload,
  MapInteractionTool,
  MapOverlayMode,
  NetworkLayersPayload,
  PersonaRole,
  PlatformMeta,
  RiskEbPayload,
  SnapCandidate,
  WorkspaceMode,
} from './types/uai';

const INITIAL_FILTERS: CmvFilterState = {
  verification_mode: 'verified_only',
  start_utc: null,
  end_utc: null,
  severity_codes: [],
  category_codes: [],
  dow_filter: null,
  hour_filter: null,
  segment_id: null,
  bbox_4326: null,
  polygon_4326: null,
};

export const App: React.FC = () => {
  const { t, language } = useLanguage();
  const [presentation, setPresentation] = useState(false);
  const [tehranPreview, setTehranPreview] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [meta, setMeta] = useState<PlatformMeta | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>('analytics');
  const [activeRole, setActiveRole] = useState<PersonaRole>('mobility_analyst');
  const [overlayMode, setOverlayMode] = useState<MapOverlayMode>('incidents');
  const [activeTool, setActiveTool] = useState<MapInteractionTool>('inspect');

  const [networkLayers, setNetworkLayers] = useState<NetworkLayersPayload | null>(null);
  const [filters, setFilters] = useState<CmvFilterState>(INITIAL_FILTERS);
  const [cmvData, setCmvData] = useState<CmvStatePayload | null>(null);
  const [cmvError, setCmvError] = useState<string | null>(null);
  const cmvRequest = useRef(0);

  // Cached analytical results across workspaces
  const [nkdeResult, setNkdeResult] = useState<Record<string, any> | null>(null);
  const [tnkdeGeojson, setTnkdeGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [giStarResult, setGiStarResult] = useState<Record<string, any> | null>(null);
  const [ndbscanResult, setNdbscanResult] = useState<Record<string, any> | null>(null);
  const [riskData, setRiskData] = useState<RiskEbPayload | null>(null);

  // Map VGI draft & flyTo state
  const [clickedMapCoord, setClickedMapCoord] = useState<{ lon: number; lat: number; ts: number } | null>(null);
  const [vgiDraftOverlay, setVgiDraftOverlay] = useState<{
    rawLon: number;
    rawLat: number;
    uncertaintyCircle: GeoJSON.Geometry | null;
    candidateSnaps: SnapCandidate[];
    selectedSegmentId: number | null;
  } | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{ lon: number; lat: number; zoom?: number; ts: number } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const loadDatasetContext = useCallback(async (dsId?: number) => {
    try {
      const m = await uaiApi.getMeta();
      const targetId = dsId ?? m.active_dataset.id;
      const [net, eb] = await Promise.all([
        uaiApi.getNetworkLayers(targetId, true),
        uaiApi.evaluateRiskEb({
          dataset_id: targetId,
          w_eb_risk: 0.4,
          w_epdo_severity: 0.3,
          w_geometric_hazard: 0.15,
          w_environmental_cov: 0.15,
        }),
      ]);
      setMeta(m);
      setNetworkLayers(net);
      setRiskData(eb);
      setBootError(null);
      setNkdeResult(null);
      setTnkdeGeojson(null);
      setGiStarResult(null);
      setNdbscanResult(null);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'Failed to initialize platform metadata');
    }
  }, []);

  useEffect(() => {
    loadDatasetContext();
  }, [loadDatasetContext]);

  const refreshCmv = useCallback(async () => {
    if (!meta?.active_dataset) return;
    const request = ++cmvRequest.current;
    setCmvError(null);
    setCmvData(null);
    try {
      const cmv = await uaiApi.queryCmv(meta.active_dataset.id, filters);
      if (request === cmvRequest.current) setCmvData(cmv);
    } catch (error) {
      if (request === cmvRequest.current) setCmvError(error instanceof Error ? error.message : 'Request failed');
    }
  }, [meta?.active_dataset?.id, filters]);

  useEffect(() => {
    refreshCmv();
  }, [refreshCmv]);

  const handleSelectWorkspace = (mode: WorkspaceMode) => {
    setActiveWorkspace(mode);
    if (mode === 'citizen_vgi') {
      setActiveRole('citizen_reporter');
      setActiveTool('vgi_pin');
      setOverlayMode('incidents');
    } else {
      if (activeTool === 'vgi_pin') setActiveTool('inspect');
      if (mode === 'stewardship') {
        setActiveRole('data_steward');
        setFilters((prev) => ({ ...prev, verification_mode: 'all_active' }));
        setOverlayMode('incidents');
      } else if (mode === 'spatial_lab') {
        setActiveRole('gis_researcher');
        if (nkdeResult) setOverlayMode('nkde');
      } else if (mode === 'risk_eb') {
        setActiveRole('safety_engineer');
        setOverlayMode('risk_bivariate_uncertainty');
      } else if (mode === 'simulator') {
        setActiveRole('simulation_scientist');
        setOverlayMode('true_lambda');
      } else if (mode === 'analytics') {
        setActiveRole('mobility_analyst');
        setOverlayMode('incidents');
      }
    }
  };

  const handleSwitchDataset = async (datasetId: number) => {
    await uaiApi.activateDataset(datasetId);
    setFilters(INITIAL_FILTERS);
    await loadDatasetContext(datasetId);
  };

  const handleFlyToSegment = (segmentId: number) => {
    const feat = networkLayers?.segments_geojson.features.find(
      (f) => Number(f.properties?.segment_id) === segmentId
    );
    if (feat && feat.geometry.type === 'LineString') {
      const coords = feat.geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      if (mid) {
        setFlyToTarget({ lon: mid[0], lat: mid[1], zoom: 15.5, ts: Date.now() });
      }
    }
  };

  if (tehranPreview) return <TehranPreview onClose={() => setTehranPreview(false)} />;

  if (bootError) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-8 font-mono text-sm">
        <div className="text-center space-y-4" role="alert">
          <p>{t('initializationError')}: <bdi>{bootError}</bdi></p>
          <button type="button" onClick={() => { setBootError(null); void loadDatasetContext(); }} className="rounded bg-cyan-600 px-4 py-2 font-sans text-white hover:bg-cyan-500">
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="min-h-screen bg-slate-950 text-cyan-300 flex items-center justify-center p-8 font-mono text-sm">
        {t('initializing')}
      </div>
    );
  }

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col ${
        darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      <HeaderBar
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        activeDataset={meta.active_dataset}
        datasets={meta.datasets}
        onSwitchDataset={handleSwitchDataset}
        activeRole={activeRole}
        personas={meta.personas}
        onSwitchRole={setActiveRole}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
      />

      <div className="flex items-center justify-between gap-3 px-3 py-1 border-b border-slate-700 text-xs">
        <span>{meta.study_area} · <bdi>{meta.active_dataset.name}</bdi> {meta.active_dataset.is_synthetic && <strong className="text-amber-400"> · {language === 'fa' ? 'رخدادهای مصنوعی؛ نه خطر واقعی' : 'Synthetic incidents; not real-world risk'}</strong>}</span>
        <button type="button" onClick={() => setTehranPreview(true)} className="shrink-0 rounded border border-amber-500/60 px-2 py-1 hover:bg-amber-500/20">{language === 'fa' ? 'نمونهٔ تهران' : 'Tehran sample'}</button>
        <button type="button" aria-pressed={presentation} onClick={() => setPresentation(v => !v)} className="shrink-0 rounded border border-cyan-500/60 px-2 py-1 hover:bg-cyan-500/20">
          {presentation ? (language === 'fa' ? 'خروج از نمای ارائه' : 'Exit presentation') : (language === 'fa' ? 'نمای ارائه' : 'Presentation view')}
        </button>
      </div>
      {presentation && <ActiveFilters filters={filters} onUpdate={(patch) => setFilters(prev => ({ ...prev, ...patch }))} onReset={() => setFilters(INITIAL_FILTERS)} />}
      {cmvError && <div role="alert" className="bg-rose-950 text-rose-100 px-3 py-2 text-xs flex gap-3 items-center">
        <span>{t('analyticsLoadError')}: <bdi>{cmvError}</bdi></span>
        <button type="button" className="underline" onClick={() => void refreshCmv()}>{t('retry')}</button>
      </div>}

      {/* Split Geovisual Analytics Canvas + Scientific Control & Statistical Workspace */}
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        {/* Start: Persistent Multi-Scale WebGL Cartographic Canvas */}
        <section className={`${presentation ? 'lg:col-span-12 h-full' : 'lg:col-span-7 xl:col-span-7 h-[46vh] lg:h-full'} border-b lg:border-b-0 lg:border-e border-slate-800 relative`}>
          <MapCanvas
            darkMode={darkMode}
            isSynthetic={meta.active_dataset.is_synthetic}
            presentation={presentation}
            contextGeojson={meta.context_geojson}
            networkLayers={networkLayers}
            incidentsGeojson={cmvData?.incidents_geojson ?? null}
            vgiDisplacementGeojson={cmvData?.vgi_displacement_geojson ?? null}
            vgiUncertaintyGeojson={cmvData?.vgi_uncertainty_geojson ?? null}
            nkdeGeojson={nkdeResult?.layer_geojson ?? null}
            tnkdeGeojson={tnkdeGeojson}
            giStarGeojson={giStarResult?.layer_geojson ?? null}
            ndbscanGeojson={ndbscanResult?.layer_geojson ?? null}
            riskEbGeojson={riskData?.layer_geojson ?? null}
            overlayMode={overlayMode}
            onChangeOverlayMode={setOverlayMode}
            activeTool={activeTool}
            onChangeTool={setActiveTool}
            selectedSegmentId={filters.segment_id}
            onSelectSegment={(sid) => setFilters((prev) => ({ ...prev, segment_id: sid }))}
            activeBbox={filters.bbox_4326}
            onSelectBbox={(bbox) => setFilters((prev) => ({ ...prev, bbox_4326: bbox }))}
            activePolygon={filters.polygon_4326}
            onSelectPolygon={(poly) => setFilters((prev) => ({ ...prev, polygon_4326: poly }))}
            onMapVgiClick={(lon, lat) => {
              setClickedMapCoord({ lon, lat, ts: Date.now() });
              if (activeWorkspace !== 'citizen_vgi') {
                setActiveWorkspace('citizen_vgi');
              }
            }}
            center4326={meta.center_4326}
            networkBbox4326={meta.network_bbox_4326 ?? null}
            canonicalEpsg={meta.active_dataset?.crs_epsg ?? Number(meta.canonical_crs.split(':')[1])}
            vgiDraftOverlay={activeWorkspace === 'citizen_vgi' ? vgiDraftOverlay : null}
            flyToTarget={flyToTarget}
          />
        </section>

        {/* End: Active Scientific Persona Workspace */}
        <section className={`${presentation ? 'hidden' : 'lg:col-span-5 xl:col-span-5 h-[54vh] lg:h-full'} min-h-0 overflow-hidden`}>
          {activeWorkspace === 'analytics' && (
            <AnalyticsWorkspace
              darkMode={darkMode}
              cmvData={cmvData}
              networkLayers={networkLayers}
              filters={filters}
              onUpdateFilters={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
              onResetAllFilters={() => setFilters(INITIAL_FILTERS)}
              onFlyToSegment={handleFlyToSegment}
            />
          )}

          {activeWorkspace === 'spatial_lab' && (
            <SpatialLabWorkspace
              darkMode={darkMode}
              datasetId={meta.active_dataset.id}
              activeRole={activeRole}
              onChangeOverlay={setOverlayMode}
              onNkdeResult={setNkdeResult}
              onGiStarResult={setGiStarResult}
              onNdbscanResult={setNdbscanResult}
              onTnkdeGeojson={setTnkdeGeojson}
              nkdeResult={nkdeResult}
              giStarResult={giStarResult}
              ndbscanResult={ndbscanResult}
            />
          )}

          {activeWorkspace === 'risk_eb' && (
            <RiskEbWorkspace
              darkMode={darkMode}
              datasetId={meta.active_dataset.id}
              overlayMode={overlayMode}
              onChangeOverlay={setOverlayMode}
              riskData={riskData}
              onRiskDataLoaded={setRiskData}
              onFlyToSegment={handleFlyToSegment}
            />
          )}

          {activeWorkspace === 'citizen_vgi' && (
            <CitizenReportWorkspace
              darkMode={darkMode}
              datasetId={meta.active_dataset.id}
              activeRole={activeRole}
              categories={meta.categories}
              severities={meta.severities}
              clickedMapCoord={clickedMapCoord}
              suggestedPreset4326={
                meta.network_bbox_4326
                  ? [
                      (meta.network_bbox_4326.min_lon + meta.network_bbox_4326.max_lon) / 2,
                      (meta.network_bbox_4326.min_lat + meta.network_bbox_4326.max_lat) / 2,
                    ]
                  : meta.center_4326
              }
              studyAreaLabel={
                language === 'fa' ? meta.study_area_fa ?? meta.study_area : meta.study_area
              }
              ingestionScope={meta.ingestion_scope ?? null}
              onActivatePinTool={() => setActiveTool('vgi_pin')}
              onUpdateVgiDraftOverlay={setVgiDraftOverlay}
              onReportSubmittedOrCorroborated={() => {
                setFilters((prev) => ({ ...prev, verification_mode: 'all_active' }));
                refreshCmv();
              }}
              onFlyTo={(lon, lat, zoom) => setFlyToTarget({ lon, lat, zoom, ts: Date.now() })}
            />
          )}

          {activeWorkspace === 'stewardship' && (
            <StewardWorkspace
              darkMode={darkMode}
              datasetId={meta.active_dataset.id}
              activeRole={activeRole}
              onSwitchToStewardRole={() => setActiveRole('data_steward')}
              onDataMutated={() => {
                refreshCmv();
                loadDatasetContext(meta.active_dataset.id);
              }}
              onFlyTo={(lon, lat, zoom) => setFlyToTarget({ lon, lat, zoom, ts: Date.now() })}
            />
          )}

          {activeWorkspace === 'simulator' && (
            <SimulatorWorkspace
              darkMode={darkMode}
              scenarios={meta.scenarios}
              activeDataset={meta.active_dataset}
              activeRole={activeRole}
              overlayMode={overlayMode}
              onChangeOverlay={setOverlayMode}
              onSimulationCompleted={() => {
                setFilters(INITIAL_FILTERS);
                loadDatasetContext();
              }}
            />
          )}
        </section>
      </main>
    </div>
  );
};
