import React, { useCallback, useEffect, useState } from 'react';
import { uaiApi } from './api/client';
import { AnalyticsWorkspace } from './components/AnalyticsWorkspace';
import { CitizenReportWorkspace } from './components/CitizenReportWorkspace';
import { HeaderBar } from './components/HeaderBar';
import { MapCanvas } from './components/MapCanvas';
import { RiskEbWorkspace } from './components/RiskEbWorkspace';
import { SimulatorWorkspace } from './components/SimulatorWorkspace';
import { SpatialLabWorkspace } from './components/SpatialLabWorkspace';
import { StewardWorkspace } from './components/StewardWorkspace';
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
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [meta, setMeta] = useState<PlatformMeta | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>('analytics');
  const [activeRole, setActiveRole] = useState<PersonaRole>('mobility_analyst');
  const [overlayMode, setOverlayMode] = useState<MapOverlayMode>('incidents');
  const [activeTool, setActiveTool] = useState<MapInteractionTool>('inspect');

  const [networkLayers, setNetworkLayers] = useState<NetworkLayersPayload | null>(null);
  const [filters, setFilters] = useState<CmvFilterState>(INITIAL_FILTERS);
  const [cmvData, setCmvData] = useState<CmvStatePayload | null>(null);

  // Cached analytical results across workspaces
  const [nkdeResult, setNkdeResult] = useState<Record<string, any> | null>(null);
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

  // Toggle HTML root class
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const loadDatasetContext = useCallback(async (dsId?: number) => {
    try {
      const m = await uaiApi.getMeta();
      setMeta(m);
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
      setNetworkLayers(net);
      setRiskData(eb);
      setNkdeResult(null);
      setGiStarResult(null);
      setNdbscanResult(null);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'Failed to initialize platform metadata');
    }
  }, []);

  useEffect(() => {
    loadDatasetContext();
  }, [loadDatasetContext]);

  // Synchronize CMV state whenever dataset or cross-filters change
  const refreshCmv = useCallback(async () => {
    if (!meta?.active_dataset) return;
    const cmv = await uaiApi.queryCmv(meta.active_dataset.id, filters);
    setCmvData(cmv);
  }, [meta?.active_dataset?.id, filters]);

  useEffect(() => {
    refreshCmv();
  }, [refreshCmv]);

  const handleSelectWorkspace = (mode: WorkspaceMode) => {
    setActiveWorkspace(mode);
    // Align default role & map overlay thoughtfully when entering specialized workspaces
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

  if (bootError) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-300 flex items-center justify-center p-8 font-mono text-sm">
        Platform Initialization Error: {bootError}
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="min-h-screen bg-slate-950 text-cyan-300 flex items-center justify-center p-8 font-mono text-sm">
        Initializing RoadScope Spatial Engine (EPSG:25832)...
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

      {/* Split Geovisual Analytics Canvas + Scientific Control & Statistical Workspace */}
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        {/* Left/Center: Persistent Multi-Scale WebGL Cartographic Canvas */}
        <section className="lg:col-span-7 xl:col-span-7 h-[46vh] lg:h-full border-b lg:border-b-0 lg:border-r border-slate-800 relative">
          <MapCanvas
            darkMode={darkMode}
            contextGeojson={meta.context_geojson}
            networkLayers={networkLayers}
            incidentsGeojson={cmvData?.incidents_geojson ?? null}
            vgiDisplacementGeojson={cmvData?.vgi_displacement_geojson ?? null}
            vgiUncertaintyGeojson={cmvData?.vgi_uncertainty_geojson ?? null}
            nkdeGeojson={nkdeResult?.layer_geojson ?? null}
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
            vgiDraftOverlay={activeWorkspace === 'citizen_vgi' ? vgiDraftOverlay : null}
            flyToTarget={flyToTarget}
          />
        </section>

        {/* Right: Active Scientific Persona Workspace */}
        <section className="lg:col-span-5 xl:col-span-5 h-[54vh] lg:h-full min-h-0 overflow-hidden">
          {activeWorkspace === 'analytics' && (
            <AnalyticsWorkspace
              darkMode={darkMode}
              cmvData={cmvData}
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
