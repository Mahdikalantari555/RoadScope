import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../i18n';
import { taxonomyLabel } from '../analyticsI18n';
import { INCIDENT_DETAIL_FIELDS, isMissingValue, pickAllowed } from '../types/featureDetails';

type Props = {
  /** Properties of the selected incident feature, straight from the CMV GeoJSON payload. */
  properties: Record<string, unknown> | null;
  onClose: () => void;
  /** True when the active dataset's incidents are synthetic. */
  synthetic?: boolean | null;
  onFlyToSegment?: (segmentId: number) => void;
};

/**
 * Accessible selected-incident detail panel (task 2.2).
 *
 * Renders an explicit allow-list only. Restricted pilot material — reporter identity, tracking
 * credentials, raw coordinates of an unverified report and free-text narrative — never appears
 * here, and the server does not send it in this payload either. Missing values are labelled
 * rather than rendered as zeros or empty cells, because "0 witnesses" and "witnesses unknown"
 * mean different things on a verification screen.
 */
export function IncidentDetails({ properties, onClose, synthetic, onFlyToSegment }: Props) {
  const { language } = useLanguage();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const fa = language === 'fa';
  const missing = fa ? 'ثبت نشده' : 'Not reported';

  useEffect(() => {
    if (properties) headingRef.current?.focus();
  }, [properties]);

  if (!properties) return null;
  const p = pickAllowed(properties, INCIDENT_DETAIL_FIELDS);

  const text = (value: unknown) => (isMissingValue(value) ? missing : String(value));
  /**
   * First *reported* value among equivalent field names. A payload may carry `id` or the legacy
   * `accident_id`; showing "Not reported" for a value the server did send would be a lie.
   */
  const either = (...values: unknown[]) => values.find((value) => !isMissingValue(value));

  const incidentId = either(p.id, p.accident_id);
  const snapDistance = either(p.orthogonal_snap_dist_m, p.network_distance_m);
  const metric = (value: unknown, unit: string) =>
    isMissingValue(value) ? missing : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;

  const severityCode = typeof p.severity_code === 'string' ? p.severity_code : null;
  const categoryCode = typeof p.category_code === 'string' ? p.category_code : null;
  const status = typeof p.verification_status === 'string' ? p.verification_status : null;
  const segmentId = p.segment_id;

  return (
    <section
      aria-labelledby="incident-details-title"
      data-testid="incident-details"
      className="rounded border border-rose-500/40 p-3 text-xs space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="incident-details-title" ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
          {fa ? 'رخداد انتخاب‌شده' : 'Selected incident'}{' '}
          <bdi>#{text(incidentId)}</bdi>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="underline flex items-center gap-1"
          aria-label={fa ? 'پاک‌کردن انتخاب رخداد' : 'Clear incident selection'}
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {fa ? 'پاک‌کردن انتخاب' : 'Clear selection'}
        </button>
      </div>

      {synthetic && (
        <p role="note" className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          {fa
            ? 'این رخداد مصنوعی است و محل واقعی تصادف نیست.'
            : 'This incident is synthetic and is not a real crash location.'}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div>
          <dt className="opacity-70">{fa ? 'زمان (UTC)' : 'Occurred (UTC)'}</dt>
          <dd>
            <bdi dir="ltr">{text(p.occurred_at_utc)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'وضعیت تأیید' : 'Verification'}</dt>
          <dd>
            <bdi dir="ltr">{text(status)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'نوع' : 'Category'}</dt>
          <dd dir="auto">{categoryCode ? taxonomyLabel(language, categoryCode, categoryCode) : missing}</dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'شدت' : 'Severity'}</dt>
          <dd dir="auto">{severityCode ? taxonomyLabel(language, severityCode, severityCode) : missing}</dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'منبع' : 'Source'}</dt>
          <dd>
            <bdi dir="ltr">{text(p.source_type)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'قطعه' : 'Segment'}</dt>
          <dd>
            {isMissingValue(segmentId) ? (
              missing
            ) : onFlyToSegment ? (
              <button
                type="button"
                className="underline"
                onClick={() => onFlyToSegment(Number(segmentId))}
                aria-label={
                  fa ? `نمایش قطعهٔ ${String(segmentId)} روی نقشه` : `Show segment ${String(segmentId)} on the map`
                }
              >
                <bdi dir="ltr">#{String(segmentId)}</bdi>
              </button>
            ) : (
              <bdi dir="ltr">#{String(segmentId)}</bdi>
            )}
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'فاصله از قطعه' : 'Distance to segment'}</dt>
          <dd>
            <bdi dir="ltr">{metric(snapDistance, 'm')}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'جابه‌جایی خطی' : 'Linear offset'}</dt>
          <dd>
            <bdi dir="ltr">{metric(p.linear_offset_m, 'm')}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'شاهدان' : 'Witnesses'}</dt>
          <dd>
            <bdi dir="ltr">{text(p.witness_count)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'عدم قطعیت مکان' : 'Location uncertainty'}</dt>
          <dd>
            <bdi dir="ltr">{metric(p.observational_radius_m, 'm')}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'احتمال اتصال' : 'Snap probability'}</dt>
          <dd>
            <bdi dir="ltr">
              {isMissingValue(p.snap_probability)
                ? missing
                : `${(Number(p.snap_probability) * 100).toLocaleString('en-US', {
                    maximumFractionDigits: 1,
                  })}%`}
            </bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'تأخیر گزارش' : 'Report latency'}</dt>
          <dd>
            <bdi dir="ltr">{metric(p.reporting_lag_min, fa ? 'دقیقه' : 'min')}</bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'وزن EPDO' : 'EPDO weight'}</dt>
          <dd>
            <bdi dir="ltr">
              {isMissingValue(p.epdo_weight)
                ? missing
                : Number(p.epdo_weight).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </bdi>
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{fa ? 'اعتبار گزارش' : 'Credibility'}</dt>
          <dd>
            <bdi dir="ltr">
              {isMissingValue(p.vgi_credibility_score) ? missing : Number(p.vgi_credibility_score).toFixed(3)}
            </bdi>
          </dd>
        </div>
      </dl>

      <details className="text-[10px] opacity-90">
        <summary className="cursor-pointer">{fa ? 'شرایط محیطی و درگیرشدگان' : 'Environment and involved parties'}</summary>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
          <div>
            <dt className="opacity-70">{fa ? 'آب‌وهوا' : 'Weather'}</dt>
            <dd>
              <bdi dir="ltr">{text(p.weather_condition)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="opacity-70">{fa ? 'سطح راه' : 'Road surface'}</dt>
            <dd>
              <bdi dir="ltr">{text(p.road_surface)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="opacity-70">{fa ? 'روشنایی' : 'Lighting'}</dt>
            <dd>
              <bdi dir="ltr">{text(p.lighting_condition)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="opacity-70">{fa ? 'خدمات اضطراری' : 'Emergency response'}</dt>
            <dd>
              <bdi dir="ltr">
                {isMissingValue(p.emergency_response_present)
                  ? missing
                  : p.emergency_response_present
                    ? fa
                      ? 'حاضر'
                      : 'present'
                    : fa
                      ? 'غایب'
                      : 'absent'}
              </bdi>
            </dd>
          </div>
          <div>
            <dt className="opacity-70">{fa ? 'وسیله/عابر/دوچرخه' : 'Vehicles / pedestrians / cyclists'}</dt>
            <dd>
              <bdi dir="ltr">
                {[p.involved_vehicles, p.involved_pedestrians, p.involved_cyclists]
                  .map((v) => (isMissingValue(v) ? '–' : String(v)))
                  .join(' / ')}
              </bdi>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
