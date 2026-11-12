import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { useLanguage } from '../i18n';

type Bundle = {
  manifest: { network_source: string; graph_created_date: string | null; graph_sha256: string; seed: number; incident_count: number; street_count: number };
  streets: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  incidents: GeoJSON.FeatureCollection<GeoJSON.Point>;
};

export function TehranPreview({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const fa = language === 'fa';
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [showBase, setShowBase] = useState(true);
  const [severity, setSeverity] = useState('all');
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/tehran-preview', { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error('unavailable'); return res.json(); })
      .then(setBundle)
      .catch(e => { if (e.name !== 'AbortError') setError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!bundle || !container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        center: [51.42, 35.70], zoom: 13.8,
        attributionControl: { compact: false },
        style: {
          version: 8,
          sources: {
            osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' },
            streets: { type: 'geojson', data: bundle.streets },
            incidents: { type: 'geojson', data: bundle.incidents },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } },
            { id: 'basemap', type: 'raster', source: 'osm' },
            { id: 'streets', type: 'line', source: 'streets', paint: { 'line-color': '#0891b2', 'line-width': 2.5, 'line-opacity': 0.85 } },
            { id: 'incidents', type: 'circle', source: 'incidents', paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'severity'], 'PDO', '#38bdf8', 'MINOR_INJURY', '#facc15', '#f97316'], 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 1.5 } },
          ],
        },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.on('load', () => {
        const bounds = new maplibregl.LngLatBounds();
        bundle.streets.features.forEach(f => f.geometry.coordinates.forEach(c => bounds.extend([c[0], c[1]])));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 0 });
      });
      map.on('error', e => { if ((e as any).sourceId === 'osm') setMapError(true); });
    } catch {
      setMapError(true);
      return;
    }
    return () => { map.remove(); mapRef.current = null; };
  }, [bundle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getLayer('basemap')) map.setLayoutProperty('basemap', 'visibility', showBase ? 'visible' : 'none');
      if (map.getLayer('incidents')) map.setFilter('incidents', severity === 'all' ? null : ['==', ['get', 'severity'], severity]);
    };
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
    return () => { map.off('load', apply); };
  }, [bundle, showBase, severity]);

  return <div className="h-screen flex flex-col bg-slate-950 text-slate-100" dir={fa ? 'rtl' : 'ltr'}>
    <header className="px-4 py-3 border-b border-slate-700 flex flex-wrap gap-3 items-center justify-between">
      <div><h1 className="font-bold">RoadScope · {fa ? 'نمونهٔ نقشهٔ تهران' : 'Tehran map sample'}</h1>
        <p className="text-amber-300 text-xs mt-1">{fa ? 'خیابان‌ها از OpenStreetMap؛ همهٔ رخدادها مصنوعی‌اند و تصادف واقعی یا خطر واقعی نیستند.' : 'Streets from OpenStreetMap; all incidents are synthetic, not actual crashes or real-world risk.'}</p></div>
      <button type="button" onClick={onClose} className="border rounded px-3 py-2 text-xs border-slate-600 hover:border-cyan-400">{fa ? 'بازگشت به سامانه' : 'Back to platform'}</button>
    </header>
    {error ? <p role="alert" className="p-6">{fa ? 'نمونهٔ تهران پیکربندی نشده یا در دسترس نیست. راهنمای آماده‌سازی را در مستندات ببینید.' : 'The Tehran sample is not configured or is unavailable. See the preparation guide.'}</p> : !bundle ? <p className="p-6">{fa ? 'در حال بارگذاری…' : 'Loading…'}</p> : <>
      <div className="px-4 py-2 flex flex-wrap gap-4 items-center text-xs bg-slate-900">
        <span>{fa ? 'نمونهٔ محدود تهران، نه کل شهر؛ محدوده به بستهٔ انتخاب‌شده بستگی دارد' : 'Limited Tehran sample, not the whole city; extent depends on the selected bundle'}</span>
        <span><bdi>{bundle.manifest.street_count}</bdi> {fa ? 'قطعهٔ راه' : 'street segments'} · <bdi>{bundle.manifest.incident_count}</bdi> {fa ? 'رخداد مصنوعی' : 'synthetic incidents'} · Seed <bdi>{bundle.manifest.seed}</bdi></span>
        <label><input type="checkbox" checked={showBase} onChange={e => setShowBase(e.target.checked)} /> {fa ? 'نقشهٔ پایهٔ آنلاین' : 'Online basemap'}</label>
        <label>{fa ? 'شدت نمایشی' : 'Illustrative severity'} <select className="bg-slate-800 rounded p-1" value={severity} onChange={e => setSeverity(e.target.value)}><option value="all">{fa ? 'همه' : 'All'}</option><option value="PDO">{fa ? 'خسارت مالی' : 'Property damage'}</option><option value="MINOR_INJURY">{fa ? 'جراحت خفیف' : 'Minor injury'}</option><option value="SERIOUS_INJURY">{fa ? 'جراحت شدید' : 'Serious injury'}</option></select></label>
      </div>
      <div className="px-4 py-1 text-[11px] text-slate-300">{fa ? 'این نقشه فقط برای نمایش است؛ تحلیل، تطبیق و گزارش شهروندی به آن متصل نیستند. بارگذاری نقشهٔ پایه به اینترنت نیاز دارد.' : 'Visual preview only; analytics, map matching and citizen reporting are not connected. The basemap requires internet.'}</div>
      {mapError && <div role="alert" className="px-4 py-2 bg-amber-950 text-amber-200 text-xs">{fa ? 'نقشه یا کاشی‌های پایه در دسترس نیستند؛ شبکهٔ نمونه ممکن است همچنان نمایش داده شود.' : 'Map or basemap tiles are unavailable; the sample network may still be displayed.'}</div>}
      <div ref={container} aria-label={fa ? 'نقشهٔ خیابان‌های نمونهٔ تهران' : 'Tehran sample street map'} className="flex-1 min-h-0 relative" />
      <footer className="px-4 py-2 text-[10px] bg-slate-900 text-slate-300 flex flex-wrap gap-x-4 gap-y-1"><span>© <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL</span><span dir="auto">{bundle.manifest.network_source}</span><span dir="ltr">Graph: {bundle.manifest.graph_created_date ?? 'unknown'} · SHA-256: {bundle.manifest.graph_sha256.slice(0, 12)}…</span><span>{fa ? 'آبی: مالی · زرد: خفیف · نارنجی: شدید (همه مصنوعی)' : 'Blue: property · yellow: minor · orange: serious (all synthetic)'}</span></footer>
    </>}
  </div>;
}
