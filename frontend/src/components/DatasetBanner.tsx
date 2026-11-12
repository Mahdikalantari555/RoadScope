import React from 'react';
import { AlertTriangle, Database, Info, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../i18n';
import {
  datasetStatusLabel,
  notReported,
  shortChecksum,
  syntheticTone,
  type PresentationContext,
} from '../presentation';

interface Props {
  context: PresentationContext;
  /**
   * Presentation mode collapses the banner to a single always-visible line. The required
   * elements stay in the DOM: only the verbose provenance grid is hidden.
   */
  compact?: boolean;
}

/**
 * Persistent dataset identity banner.
 *
 * These lines must remain visible in every workspace and in the presentation view, because a
 * screenshot of this application is a published artefact: a reader who sees only the image still
 * has to be able to tell which dataset, which profile, which network source and which licence
 * produced it.
 */
export const DatasetBanner: React.FC<Props> = ({ context, compact = false }) => {
  const { language } = useLanguage();
  const fa = language === 'fa';
  const tone = syntheticTone(context.syntheticIncidents);
  const statusLabel = datasetStatusLabel(language, tone, context.calibrationStatus);
  const checksum = shortChecksum(context.networkChecksum);
  // Defence in depth: a blank field is rendered as "not reported" here as well, so an empty
  // licence or attribution can never appear as an unexplained gap in a screenshot.
  const display = (value: string) => (value ?? '').trim() || notReported(language);

  const toneClass =
    tone === 'synthetic'
      ? 'border-amber-500/70 bg-amber-500/10 text-amber-200'
      : tone === 'real'
        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
        : 'border-slate-500/60 bg-slate-500/10 text-slate-200';

  const Icon = tone === 'synthetic' ? ShieldAlert : tone === 'real' ? Database : AlertTriangle;

  return (
    <section
      aria-label={fa ? 'وضعیت مجموعه‌داده' : 'Dataset status'}
      data-testid="dataset-banner"
      data-dataset-profile={display(context.datasetProfile)}
      data-synthetic={String(context.syntheticIncidents)}
      className={`border-b px-3 py-1 text-[11px] ${toneClass}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <strong data-testid="dataset-banner-status">{statusLabel}</strong>
        <span className="opacity-60" aria-hidden="true">
          ·
        </span>
        <span>
          {fa ? 'مجموعه‌داده' : 'Dataset'}: <bdi data-testid="dataset-banner-name">{display(context.datasetName)}</bdi>
        </span>
        <span className="opacity-60" aria-hidden="true">
          ·
        </span>
        <span>
          {fa ? 'پروفایل' : 'Profile'}: <bdi dir="ltr">{display(context.datasetProfile)}</bdi>
        </span>
        {compact && (
          <span className="opacity-60" aria-hidden="true">
            ·
          </span>
        )}
        {compact && (
          <span data-testid="dataset-banner-compact-source">
            {fa ? 'منبع شبکه' : 'Network'}: <bdi>{display(context.networkSource)}</bdi>
          </span>
        )}
      </div>

      {!compact && (
        <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] opacity-85">
          <div className="flex gap-1">
            <dt>{fa ? 'منبع شبکه' : 'Network source'}:</dt>
            <dd>
              <bdi>{display(context.networkSource)}</bdi>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{fa ? 'نسخهٔ استخراج' : 'Extract version'}:</dt>
            <dd>
              <bdi dir="ltr">{display(context.networkVersion)}</bdi>
              {checksum && <span className="ms-1 font-mono opacity-70">({checksum})</span>}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{fa ? 'مجوز' : 'Licence'}:</dt>
            <dd>
              <bdi>{display(context.license)}</bdi>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{fa ? 'انتساب' : 'Attribution'}:</dt>
            <dd>
              <bdi data-testid="dataset-banner-attribution">{display(context.attribution)}</bdi>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{fa ? 'CRS تحلیلی' : 'Analysis CRS'}:</dt>
            <dd>
              <bdi dir="ltr">{display(context.canonicalCrs)}</bdi>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{fa ? 'کالیبراسیون' : 'Calibration'}:</dt>
            <dd>
              <bdi dir="ltr">{display(context.calibrationStatus)}</bdi>
            </dd>
          </div>
        </dl>
      )}

      {!compact && (
        <p className="mt-0.5 flex items-start gap-1 text-[10px] opacity-80">
          <Info className="w-3 h-3 mt-[1px] shrink-0" aria-hidden="true" />
          <span data-testid="dataset-banner-legend-note">{display(context.legendNote)}</span>
        </p>
      )}
    </section>
  );
};
