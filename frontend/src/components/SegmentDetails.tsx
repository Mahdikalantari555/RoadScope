import React from 'react';
import { useLanguage } from '../i18n';
import type { NetworkLayersPayload } from '../types/uai';

type Props = { segmentId: number | null; network: NetworkLayersPayload | null; onClose: () => void };

export function SegmentDetails({ segmentId, network, onClose }: Props) {
  const { language } = useLanguage();
  if (segmentId === null) return null;
  const fa = language === 'fa';
  const segment = network?.segments_geojson.features.find(f => Number(f.properties?.segment_id) === segmentId);
  const p = segment?.properties;
  const missing = fa ? 'نامشخص' : 'Unknown';
  return <section aria-label={fa ? 'جزئیات قطعهٔ انتخاب‌شده' : 'Selected segment details'} className="rounded border border-cyan-500/40 p-3 text-xs space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">{fa ? 'قطعهٔ انتخاب‌شده' : 'Selected segment'} <bdi>#{segmentId}</bdi></h3>
      <button type="button" onClick={onClose} className="underline">{fa ? 'پاک‌کردن انتخاب' : 'Clear selection'}</button>
    </div>
    {!p ? <p>{fa ? 'جزئیات این قطعه در دسترس نیست.' : 'Details for this segment are unavailable.'}</p> : <dl className="grid grid-cols-2 gap-2">
      <div><dt className="opacity-70">{fa ? 'نام' : 'Name'}</dt><dd dir="auto">{p.name || missing}</dd></div>
      <div><dt className="opacity-70">{fa ? 'نوع راه' : 'Road class'}</dt><dd dir="auto">{p.road_class || missing}</dd></div>
      <div><dt className="opacity-70">{fa ? 'طول' : 'Length'}</dt><dd><bdi>{p.length_m != null ? `${p.length_m} m` : missing}</bdi></dd></div>
      <div><dt className="opacity-70">{fa ? 'طبقهٔ ارتفاعی' : 'Elevation level'}</dt><dd><bdi>{p.elevation_level ?? missing}</bdi></dd></div>
    </dl>}
  </section>;
}
