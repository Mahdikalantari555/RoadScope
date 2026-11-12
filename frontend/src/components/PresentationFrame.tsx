import React from 'react';
import { Camera } from 'lucide-react';
import { useLanguage } from '../i18n';
import { datasetStatusLabel, notReported, syntheticTone, type PresentationContext } from '../presentation';
import type { CmvFilterState } from '../types/uai';

interface Props {
  context: PresentationContext;
  filters: CmvFilterState;
  /** One-line filter summary supplied by the same component the workspace uses. */
  filterSummary: string;
  hasFilters: boolean;
  children: React.ReactNode;
}

/**
 * Presentation view (task 2.5).
 *
 * Everything a reader needs in order to interpret a screenshot is rendered as **DOM text**, not
 * painted into the WebGL canvas: dataset identity, synthetic/real status, network source and
 * licence, attribution, legend note, the active filter summary and the research-only caveat. A
 * browser screenshot therefore always contains them, and they are also exposed to assistive
 * technology — which a canvas raster would not be.
 *
 * The map stays interactive but the chrome around it is reduced to this frame.
 */
export const PresentationFrame: React.FC<Props> = ({
  context,
  filters,
  filterSummary,
  hasFilters,
  children,
}) => {
  const { language } = useLanguage();
  const fa = language === 'fa';
  const tone = syntheticTone(context.syntheticIncidents);
  const statusLabel = datasetStatusLabel(language, tone, context.calibrationStatus);
  const display = (value: string) => (value ?? '').trim() || notReported(language);

  return (
    <div className="h-full min-h-0 flex flex-col" data-testid="presentation-frame">
      <header
        className="shrink-0 border-b border-slate-700 bg-slate-950/95 px-3 py-1.5 text-[11px] text-slate-100 space-y-0.5"
        aria-label={fa ? 'چارچوب ارائه' : 'Presentation frame'}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-sm" data-testid="presentation-dataset">
            <bdi>{display(context.datasetName)}</bdi>
          </strong>
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
          <span data-testid="presentation-study-area">
            <bdi>{display(context.studyAreaLabel)}</bdi>
          </span>
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
          <span className="font-mono opacity-80" dir="ltr" data-testid="presentation-crs">
            {display(context.canonicalCrs)}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={
              tone === 'synthetic'
                ? 'font-semibold text-amber-300'
                : tone === 'real'
                  ? 'font-semibold text-emerald-300'
                  : 'font-semibold text-slate-300'
            }
            data-testid="presentation-status"
          >
            {statusLabel}
          </span>
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
          <span data-testid="presentation-network">
            {fa ? 'شبکه' : 'Network'}: <bdi>{display(context.networkSource)}</bdi>
            <span className="ms-1 font-mono opacity-70" dir="ltr">
              {display(context.networkVersion)}
            </span>
          </span>
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
          <span data-testid="presentation-license">
            {fa ? 'مجوز' : 'Licence'}: <bdi>{display(context.license)}</bdi>
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 text-[10px] opacity-85">
          <span data-testid="presentation-attribution">
            {fa ? 'انتساب' : 'Attribution'}: <bdi>{display(context.attribution)}</bdi>
          </span>
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
          <span data-testid="presentation-legend-note">
            {fa ? 'راهنما' : 'Legend'}: <bdi>{display(context.legendNote)}</bdi>
          </span>
        </div>
        <div
          className="flex flex-wrap items-baseline gap-x-2 text-[10px] opacity-85"
          data-testid="presentation-filters"
        >
          <span>
            {fa ? 'فیلترهای فعال' : 'Active filters'}: <bdi>{hasFilters ? filterSummary : fa ? 'هیچ‌کدام' : 'none'}</bdi>
          </span>
          {filters.verification_mode !== 'verified_only' && (
            <span className="font-mono" dir="ltr">
              ({filters.verification_mode})
            </span>
          )}
        </div>
        <p className="text-[10px] text-amber-300/90" data-testid="presentation-caveat">
          {fa
            ? 'نمونهٔ پژوهشی؛ خروجی‌ها برای ارزیابی نیستند. تصویر بدون این خطوط نباید منتشر شود.'
            : 'Research prototype; outputs are not validated evidence. Do not publish a screenshot that omits these lines.'}
        </p>
        {context.screenshotGuidance && (
          <p className="text-[10px] opacity-70 flex items-start gap-1" role="note">
            <Camera className="w-3 h-3 mt-[1px] shrink-0" aria-hidden="true" />
            <bdi>{context.screenshotGuidance}</bdi>
          </p>
        )}
      </header>
      <div className="flex-1 min-h-0 relative">{children}</div>
    </div>
  );
};
