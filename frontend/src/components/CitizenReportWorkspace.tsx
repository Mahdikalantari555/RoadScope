import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, MapPinPlus, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { domainLabel } from '../analyticsI18n';
import { getCitizenVgiText } from '../workspaceI18n';
import type { CategoryMeta, ConflationAlert, PersonaRole, SeverityMeta, SnapCandidate } from '../types/uai';

interface CitizenReportWorkspaceProps {
  darkMode: boolean;
  datasetId: number;
  activeRole: PersonaRole;
  categories: CategoryMeta[];
  severities: SeverityMeta[];
  clickedMapCoord: { lon: number; lat: number; ts: number } | null;
  onActivatePinTool: () => void;
  onUpdateVgiDraftOverlay: (overlay: {
    rawLon: number;
    rawLat: number;
    uncertaintyCircle: GeoJSON.Geometry | null;
    candidateSnaps: SnapCandidate[];
    selectedSegmentId: number | null;
  } | null) => void;
  onReportSubmittedOrCorroborated: () => void;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
}

export const CitizenReportWorkspace: React.FC<CitizenReportWorkspaceProps> = ({
  darkMode,
  datasetId,
  activeRole,
  categories,
  severities,
  clickedMapCoord,
  onActivatePinTool,
  onUpdateVgiDraftOverlay,
  onReportSubmittedOrCorroborated,
  onFlyTo,
}) => {
  const { language } = useLanguage();
  const copy = getCitizenVgiText(language);

  const [lon, setLon] = useState<number>(8.68524);
  const [lat, setLat] = useState<number>(50.11574);
  const [obsRadiusM, setObsRadiusM] = useState<number>(20);
  const [occurredUtc, setOccurredUtc] = useState<string>('2026-11-08T17:30:00Z');
  const [categoryCode, setCategoryCode] = useState<string>('PEDESTRIAN_CROSSING');
  const [severityCode, setSeverityCode] = useState<string>('MINOR_INJURY');
  const [vehicles, setVehicles] = useState<number>(1);
  const [pedestrians, setPedestrians] = useState<number>(1);
  const [cyclists, setCyclists] = useState<number>(0);
  const [emergencyPresent, setEmergencyPresent] = useState<boolean>(true);
  const [weather, setWeather] = useState<'clear' | 'rain' | 'heavy_rain' | 'fog' | 'snow_ice'>('rain');
  const [surface, setSurface] = useState<'dry' | 'wet' | 'standing_water' | 'icy'>('wet');
  const [lighting, setLighting] = useState<'daylight' | 'twilight' | 'night_lit' | 'night_unlit'>('twilight');
  const [narrative, setNarrative] = useState<string>(
    'Observed conflict near crosswalk; reporting approximate position from sidewalk.'
  );

  const [candidates, setCandidates] = useState<SnapCandidate[]>([]);
  const [selectedSegId, setSelectedSegId] = useState<number | null>(null);
  const [conflationAlerts, setConflationAlerts] = useState<ConflationAlert[]>([]);
  const [metricReadout, setMetricReadout] = useState<{ x_m: number; y_m: number } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (clickedMapCoord) {
      setLon(Number(clickedMapCoord.lon.toFixed(6)));
      setLat(Number(clickedMapCoord.lat.toFixed(6)));
    }
  }, [clickedMapCoord]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await uaiApi.previewSnapAndConflate({
          dataset_id: datasetId,
          lon,
          lat,
          observational_radius_m: obsRadiusM,
          occurred_at_utc: occurredUtc,
          category_code: categoryCode,
          max_net_dist_m: 160,
          max_time_diff_min: 90,
        });
        if (cancelled) return;
        setCandidates(res.candidate_snaps);
        setConflationAlerts(res.conflation_alerts);
        setMetricReadout({ x_m: res.raw_point.x_m, y_m: res.raw_point.y_m });
        const topSeg = res.candidate_snaps[0]?.segment_id ?? null;
        setSelectedSegId(topSeg);
        onUpdateVgiDraftOverlay({
          rawLon: res.raw_point.lon,
          rawLat: res.raw_point.lat,
          uncertaintyCircle: res.uncertainty_circle_geojson,
          candidateSnaps: res.candidate_snaps,
          selectedSegmentId: topSeg,
        });
      } catch (e) {
        if (!cancelled) {
          setFeedback({ type: 'err', msg: e instanceof Error ? e.message : 'Snap preview error' });
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [datasetId, lon, lat, obsRadiusM, occurredUtc, categoryCode]);

  useEffect(() => {
    return () => onUpdateVgiDraftOverlay(null);
  }, []);

  const loadOverpassDemoPreset = async () => {
    const res = await fetch('/api/v1/crs/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x_m: 477604.0, y_m: 5551962.0 }),
    });
    const p = await res.json();
    setLon(p.lon);
    setLat(p.lat);
    setCategoryCode('PEDESTRIAN_CROSSING');
    setObsRadiusM(22);
    onFlyTo(p.lon, p.lat, 16.2);
  };

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res: any = await uaiApi.submitVgiReport({
        dataset_id: datasetId,
        lon,
        lat,
        observational_radius_m: obsRadiusM,
        occurred_at_utc: occurredUtc,
        category_code: categoryCode,
        severity_code: severityCode,
        involved_vehicles: vehicles,
        involved_pedestrians: pedestrians,
        involved_cyclists: cyclists,
        emergency_response_present: emergencyPresent,
        weather_condition: weather,
        road_surface: surface,
        lighting_condition: lighting,
        narrative,
        attachment_filenames: [],
        selected_segment_id: selectedSegId,
        actor_role: activeRole,
      });
      setFeedback({
        type: 'ok',
        msg: `#${res.accident_id} (Credibility=${res.vgi_credibility_score})`,
      });
      onReportSubmittedOrCorroborated();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCorroborate = async (accId: number) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res: any = await uaiApi.corroborateIncident(accId, {
        witness_notes: narrative,
        observational_radius_m: obsRadiusM,
        actor_role: activeRole,
      });
      setFeedback({
        type: 'ok',
        msg: `#${accId} corroborated (Witnesses: ${res.witness_count}, Credibility: ${res.vgi_credibility_score})`,
      });
      onReportSubmittedOrCorroborated();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Corroboration failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;
  const inputCls = `w-full px-2 py-1 rounded border font-mono text-[11px] ${
    darkMode ? 'border-slate-700 bg-slate-950' : 'border-slate-300 bg-white text-slate-900'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <MapPinPlus className="w-4 h-4 text-rose-400" />
            {copy.title}
          </h2>
          <p className="text-[11px] opacity-70">{copy.subtitle}</p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onActivatePinTool}
            className="px-2 py-1 rounded bg-rose-500/20 border border-rose-400/60 text-rose-200 font-mono text-[11px]"
          >
            {copy.clickPin}
          </button>
          <button
            type="button"
            onClick={loadOverpassDemoPreset}
            className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-400/60 text-cyan-200 font-mono text-[11px] flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" /> {copy.overpassDemo}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-2.5 rounded border font-mono text-[11px] flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
              : 'border-rose-500/60 bg-rose-500/15 text-rose-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <bdi>{feedback.msg}</bdi>
        </div>
      )}

      {conflationAlerts.length > 0 && (
        <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 space-y-2">
          <div className="font-semibold text-amber-300 flex items-center justify-between">
            <span>
              {copy.conflationAlert} ({conflationAlerts.length} {copy.nearby})
            </span>
            <span className="text-[10px] font-mono" dir="ltr">
              d_net ≤ 160m · Δt ≤ 90m
            </span>
          </div>
          {conflationAlerts.slice(0, 2).map((al) => (
            <div
              key={al.accident_id}
              className="p-2 rounded bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2"
            >
              <div className="space-y-0.5">
                <div className="font-semibold">
                  <bdi>#{al.accident_id}</bdi> · {domainLabel(language, al.category_code, al.category_label)} (
                  {domainLabel(language, al.severity_code, al.severity_label)})
                </div>
                <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                  {al.segment_name} · d_net={al.network_distance_m}m · Δt={al.time_diff_min}min · W={al.witness_count}
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleCorroborate(al.accident_id)}
                className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-[11px] shrink-0 flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> {copy.corroborate}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Candidate Probabilistic Topological Snaps */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold">{copy.snapCandidates}</span>
          {metricReadout && (
            <span className="text-[10px] font-mono text-cyan-400" dir="ltr">
              E {metricReadout.x_m}m · N {metricReadout.y_m}m
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {candidates.slice(0, 3).map((c) => {
            const isSel = selectedSegId === c.segment_id;
            return (
              <div
                key={c.segment_id}
                onClick={() => {
                  setSelectedSegId(c.segment_id);
                  onUpdateVgiDraftOverlay({
                    rawLon: lon,
                    rawLat: lat,
                    uncertaintyCircle: null,
                    candidateSnaps: candidates,
                    selectedSegmentId: c.segment_id,
                  });
                }}
                className={`p-2 rounded border cursor-pointer font-mono text-[10.5px] ${
                  isSel ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 opacity-80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-sans font-semibold">
                    <bdi>
                      #{c.rank} {c.segment_name} (L{c.elevation_level})
                    </bdi>
                  </span>
                  <span className="text-emerald-400 font-bold" dir="ltr">
                    P={(c.snap_probability * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] opacity-80 mt-0.5">
                  <span dir="ltr">
                    d⊥={c.orthogonal_dist_m}m · LRS m={c.linear_offset_m}m · {c.road_class}
                  </span>
                  {c.topological_override && (
                    <span className="px-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-sans">
                      {copy.overridesNaive}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Structured Incident Attribution Form */}
      <form onSubmit={handleSubmitNew} className={`${cardCls} space-y-2.5`}>
        <div className="font-semibold">{copy.formTitle}</div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.lonLabel}</label>
            <input
              dir="ltr"
              type="number"
              step="0.00001"
              value={lon}
              onChange={(e) => setLon(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.latLabel}</label>
            <input
              dir="ltr"
              type="number"
              step="0.00001"
              value={lat}
              onChange={(e) => setLat(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between font-mono text-[11px] mb-0.5">
            <span className="font-sans">{copy.radiusLabel}</span>
            <span className="text-cyan-400 font-bold" dir="ltr">
              ±{obsRadiusM} m
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={1}
            value={obsRadiusM}
            onChange={(e) => setObsRadiusM(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.taxonomyLabel}</label>
            <select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} className={inputCls}>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {domainLabel(language, c.code, c.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.severityLabel}</label>
            <select value={severityCode} onChange={(e) => setSeverityCode(e.target.value)} className={inputCls}>
              {severities.map((s) => (
                <option key={s.code} value={s.code}>
                  {domainLabel(language, s.code, s.label)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.timestampLabel}</label>
            <input
              dir="ltr"
              type="text"
              value={occurredUtc}
              onChange={(e) => setOccurredUtc(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] opacity-70 mb-0.5">{copy.envLabel}</label>
            <div className="grid grid-cols-3 gap-1">
              <select
                value={weather}
                onChange={(e) => setWeather(e.target.value as any)}
                className="px-1 py-1 rounded border border-slate-700 bg-slate-950 text-[10px]"
              >
                <option value="clear">{copy.weatherClear}</option>
                <option value="rain">{copy.weatherRain}</option>
                <option value="heavy_rain">{copy.weatherHeavyRain}</option>
                <option value="fog">{copy.weatherFog}</option>
                <option value="snow_ice">{copy.weatherSnow}</option>
              </select>
              <select
                value={surface}
                onChange={(e) => setSurface(e.target.value as any)}
                className="px-1 py-1 rounded border border-slate-700 bg-slate-950 text-[10px]"
              >
                <option value="dry">{copy.surfDry}</option>
                <option value="wet">{copy.surfWet}</option>
                <option value="icy">{copy.surfIcy}</option>
              </select>
              <select
                value={lighting}
                onChange={(e) => setLighting(e.target.value as any)}
                className="px-1 py-1 rounded border border-slate-700 bg-slate-950 text-[10px]"
              >
                <option value="daylight">{copy.lightDay}</option>
                <option value="twilight">{copy.lightDusk}</option>
                <option value="night_lit">{copy.lightNight}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
          <div>
            <label className="block text-[9px] font-sans opacity-70">{copy.vehicles}</label>
            <input
              dir="ltr"
              type="number"
              min={0}
              max={20}
              value={vehicles}
              onChange={(e) => setVehicles(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[9px] font-sans opacity-70">{copy.pedestrians}</label>
            <input
              dir="ltr"
              type="number"
              min={0}
              max={20}
              value={pedestrians}
              onChange={(e) => setPedestrians(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[9px] font-sans opacity-70">{copy.cyclists}</label>
            <input
              dir="ltr"
              type="number"
              min={0}
              max={20}
              value={cyclists}
              onChange={(e) => setCyclists(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-1 pt-3 text-[10px] font-sans">
            <input
              type="checkbox"
              checked={emergencyPresent}
              onChange={(e) => setEmergencyPresent(e.target.checked)}
            />
            {copy.ems}
          </label>
        </div>

        <div>
          <label className="block text-[10px] opacity-70 mb-0.5">{copy.narrativeLabel}</label>
          <textarea
            rows={2}
            dir="auto"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 text-[11px]"
          />
          <p className="mt-1 text-[10px] opacity-70">
            {language === 'fa' ? 'در این نسخه بارگذاری عکس پشتیبانی نمی‌شود.' : 'Photo uploads are not supported in this version.'}
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-1.5 rounded bg-rose-500 hover:bg-rose-400 text-white font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          {copy.submitBtn}
        </button>
      </form>
    </div>
  );
};
