import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../i18n';
import { isMissingValue, pickAllowed, SEGMENT_DETAIL_FIELDS } from '../types/featureDetails';
import type { NetworkLayersPayload } from '../types/uai';

type Props = { segmentId: number | null; network: NetworkLayersPayload | null; onClose: () => void };

/**
 * Accessible selected-segment detail panel (task 2.2).
 *
 * Only allow-listed fields are rendered, missing values are labelled as "not reported" rather
 * than shown as zero or blank, provenance (grade/direction source, ambiguous topology) is shown
 * next to the value it qualifies, and focus moves to the panel heading when it opens so a
 * keyboard user is not dropped to the top of the document.
 */
export function SegmentDetails({ segmentId, network, onClose }: Props) {
  const { language } = useLanguage();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const fa = language === 'fa';
  const missing = fa ? 'ثبت نشده' : 'Not reported';

  useEffect(() => {
    if (segmentId !== null) headingRef.current?.focus();
  }, [segmentId]);

  if (segmentId === null) return null;
  const segment = network?.segments_geojson.features.find(
    (f) => Number(f.properties?.segment_id) === segmentId
  );
  const p = pickAllowed(segment?.properties as Record<string, unknown> | undefined, SEGMENT_DETAIL_FIELDS);

  const value = (key: keyof typeof p, unit = '') => {
    const raw = p[key];
    if (isMissingValue(raw)) return missing;
    if (typeof raw === 'boolean') return raw ? (fa ? 'بله' : 'Yes') : (fa ? 'خیر' : 'No');
    return `${String(raw)}${unit}`;
  };

  const elevation = p.elevation_level;
  const elevationNote =
    typeof elevation === 'number' && elevation > 0
      ? fa
        ? 'سطح مرتفع (روگذر/پل)؛ تقاطع با راه زیرین فرض نشده است'
        : 'Elevated level (overpass/bridge); no junction with the road below is assumed'
      : null;

  const directionSource =
    p.direction_source_detail ?? p.direction_source ?? undefined;
  const gradeSource = p.grade_source;

  return (
    <section
      aria-labelledby="segment-details-title"
      aria-describedby="segment-details-provenance"
      data-testid="segment-details"
      className="rounded border border-cyan-500/40 p-3 text-xs space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="segment-details-title" ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
          {fa ? 'قطعهٔ انتخاب‌شده' : 'Selected segment'} <bdi>#{segmentId}</bdi>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="underline flex items-center gap-1"
          aria-label={fa ? 'پاک‌کردن انتخاب قطعه' : 'Clear segment selection'}
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {fa ? 'پاک‌کردن انتخاب' : 'Clear selection'}
        </button>
      </div>

      {!segment ? (
        <p role="status">{fa ? 'جزئیات این قطعه در دسترس نیست.' : 'Details for this segment are unavailable.'}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <dt className="opacity-70">{fa ? 'نام' : 'Name'}</dt>
              <dd dir="auto">{value('name')}</dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'شناسهٔ معبر' : 'Edge code'}</dt>
              <dd dir="ltr">{value('edge_code')}</dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'نوع راه' : 'Road class'}</dt>
              <dd dir="auto">{value('road_class')}</dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'طول' : 'Length'}</dt>
              <dd>
                <bdi dir="ltr">{isMissingValue(p.length_m) ? missing : `${value('length_m')} m`}</bdi>
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'محدودیت سرعت' : 'Speed limit'}</dt>
              <dd>
                <bdi dir="ltr">
                  {isMissingValue(p.speed_limit_kmh) ? missing : `${value('speed_limit_kmh')} km/h`}
                </bdi>
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'تعداد خط' : 'Lanes'}</dt>
              <dd>
                <bdi dir="ltr">{value('lanes')}</bdi>
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'طبقهٔ ارتفاعی' : 'Elevation level'}</dt>
              <dd>
                <bdi dir="ltr">{value('elevation_level')}</bdi>
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'جهت' : 'Direction'}</dt>
              <dd>
                <bdi dir="ltr">
                  {isMissingValue(p.oneway_direction)
                    ? missing
                    : Number(p.oneway_direction) === 0
                      ? fa
                        ? 'دوطرفه'
                        : 'both directions'
                      : `${Number(p.oneway_direction) > 0 ? '+' : '−'}1`}
                </bdi>
                {!isMissingValue(directionSource) && (
                  <span className="opacity-70 text-[10px]"> · <bdi dir="ltr">{String(directionSource)}</bdi></span>
                )}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'ترافیک روزانه (AADT)' : 'Traffic (AADT)'}</dt>
              <dd>
                <bdi dir="ltr">{isMissingValue(p.aadt) ? missing : Number(p.aadt).toLocaleString('en-US')}</bdi>
                {p.aadt_is_imputed === true && (
                  <span className="ms-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300" title={
                    fa ? 'مقدار برآوردی است، نه مشاهده‌شده' : 'Imputed value, not an observation'
                  }>
                    {fa ? 'برآوردی' : 'imputed'}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">{fa ? 'شیب' : 'Slope'}</dt>
              <dd>
                <bdi dir="ltr">{isMissingValue(p.slope_pct) ? missing : `${value('slope_pct')} %`}</bdi>
              </dd>
            </div>
          </dl>

          <div id="segment-details-provenance" className="space-y-1 border-t border-slate-700/60 pt-1.5 text-[10px] opacity-80">
            <p>
              {fa ? 'منبع هندسی' : 'Geometry source'}:{' '}
              <bdi dir="ltr">{value('source_feature_id')}</bdi>
              {!isMissingValue(p.source_version) && (
                <span className="ms-1 font-mono opacity-70">v{String(p.source_version)}</span>
              )}
            </p>
            <p>
              {fa ? 'منبع تراز' : 'Grade source'}: <bdi dir="ltr">{isMissingValue(gradeSource) ? missing : String(gradeSource)}</bdi>
            </p>
            {p.topology_ambiguous === true && (
              <p role="note" className="text-amber-300">
                {fa
                  ? 'توپولوژی این قطعه مبهم است: تقاطع هندسی بدون گره مشترک دیده شده و اتصال ساخته نشده است.'
                  : 'Topology is ambiguous: a geometric crossing without a shared node was observed and no connection was created.'}
              </p>
            )}
            {elevationNote && (
              <p role="note" className="text-amber-300">
                {elevationNote}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
