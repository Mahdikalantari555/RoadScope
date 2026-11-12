import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, RefreshCw, ShieldCheck } from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { getPilotText } from '../pilotI18n';
import type { PilotStatus } from '../types/uai';

interface Props {
  darkMode: boolean;
  datasetId: number;
  /** Server-side role as decided by the API, not the persona picker. */
  activeRole: string;
  onFlyTo?: (lon: number, lat: number, zoom?: number) => void;
}

const FLAG_KEYS = ['pilot_intake', 'pilot_tracking', 'pilot_publication', 'pilot_corrections'] as const;

const COPY = {
  en: {
    title: 'Restricted pilot console',
    subtitle: 'Feature flags, publication gate and retention — steward only',
    notSteward:
      'This console requires the data_steward role on the server. Changing the persona selector does not grant it.',
    flagsHeading: 'Capability flags',
    flagIntake: 'Report intake',
    flagTracking: 'Reporter status tracking',
    flagPublication: 'Public aggregate publication',
    flagCorrections: 'Corrections and deletion requests',
    enabled: 'enabled',
    disabled: 'disabled',
    owner: 'Owner',
    approval: 'Approval reference',
    ownerPlaceholder: 'Named accountable person',
    approvalPlaceholder: 'Institutional approval id',
    enable: 'Enable',
    disable: 'Disable',
    needsOwner: 'An enable requires a named owner and an approval reference. Both are stored with the flag.',
    realDatasetOnly:
      'Intake and publication require a dataset in the pilot profile. A synthetic or demo dataset cannot be enabled.',
    syntheticBadge: 'Synthetic dataset — real-report flags are refused by the server',
    aggregateHeading: 'Public aggregates',
    aggregateClosed: 'Publication is closed. The public aggregate endpoint returns nothing.',
    rebuild: 'Rebuild published aggregates',
    policyRef: 'Disclosure policy reference',
    rebuilt: 'Rebuilt',
    cellsPublished: 'published cells',
    cellsSuppressed: 'suppressed cells',
    minCell: 'Minimum cell size',
    retentionHeading: 'Retention',
    retentionBody:
      'Applying retention deletes reports whose retained window has expired and records the deletion. It never deletes inside the approved window.',
    applyRetention: 'Apply retention policy',
    retentionResult: 'eligible',
    retentionDeleted: 'deleted',
    extractHeading: 'Active network extract',
    extractNone: 'No versioned extract was imported for this dataset.',
    ambiguousCrossings: 'ambiguous crossings',
    warningHeading: 'Before enabling anything',
    warnings: [
      'Real-data collection needs institutional, privacy and legal sign-off that this console cannot grant.',
      'Publication is a separate decision from intake, and needs its own approval reference.',
      'Every enable is audited with your server-side identity; a persona selection is not identity.',
    ],
    error: 'The action failed',
    retry: 'Retry',
    loading: 'Loading pilot state…',
    statusOnly: 'Status only. No report content is displayed in this console.',
  },
  fa: {
    title: 'کنسول پایلوت محدود',
    subtitle: 'پرچم‌های قابلیت، دروازهٔ انتشار و نگهداری — فقط متولی',
    notSteward: 'این کنسول به نقش data_steward در سرور نیاز دارد. تغییر انتخابگر نقش، آن را نمی‌دهد.',
    flagsHeading: 'پرچم‌های قابلیت',
    flagIntake: 'پذیرش گزارش',
    flagTracking: 'پیگیری وضعیت گزارشگر',
    flagPublication: 'انتشار تجمیع عمومی',
    flagCorrections: 'اصلاح و درخواست حذف',
    enabled: 'فعال',
    disabled: 'غیرفعال',
    owner: 'مالک',
    approval: 'مرجع تأیید',
    ownerPlaceholder: 'شخص پاسخگوی مشخص',
    approvalPlaceholder: 'شناسهٔ تأیید نهادی',
    enable: 'فعال‌سازی',
    disable: 'غیرفعال‌سازی',
    needsOwner: 'فعال‌سازی نیازمند مالک مشخص و مرجع تأیید است؛ هر دو همراه پرچم ذخیره می‌شوند.',
    realDatasetOnly:
      'پذیرش و انتشار نیازمند مجموعه‌داده در پروفایل پایلوت است. مجموعهٔ مصنوعی یا نمایشی قابل فعال‌سازی نیست.',
    syntheticBadge: 'مجموعه‌دادهٔ مصنوعی — پرچم‌های گزارش واقعی توسط سرور رد می‌شوند',
    aggregateHeading: 'تجمیع‌های عمومی',
    aggregateClosed: 'انتشار بسته است. نقطهٔ تجمیع عمومی چیزی برنمی‌گرداند.',
    rebuild: 'بازسازی تجمیع‌های منتشرشده',
    policyRef: 'مرجع سیاست افشا',
    rebuilt: 'بازسازی شد',
    cellsPublished: 'سلول منتشرشده',
    cellsSuppressed: 'سلول پنهان‌شده',
    minCell: 'حد کمینهٔ سلول',
    retentionHeading: 'نگهداری',
    retentionBody:
      'اجرای نگهداری گزارش‌هایی را که پنجرهٔ نگهداری آن‌ها گذشته حذف می‌کند و حذف را ثبت می‌کند. هرگز داخل پنجرهٔ تأییدشده حذف نمی‌کند.',
    applyRetention: 'اجرای سیاست نگهداری',
    retentionResult: 'واجد شرط',
    retentionDeleted: 'حذف‌شده',
    extractHeading: 'استخراج فعال شبکه',
    extractNone: 'هیچ استخراج نسخه‌دار برای این مجموعه‌داده وارد نشده است.',
    ambiguousCrossings: 'تقاطع مبهم',
    warningHeading: 'پیش از فعال‌سازی',
    warnings: [
      'جمع‌آوری دادهٔ واقعی نیازمند تأیید نهادی، حریم خصوصی و حقوقی است و این کنسول آن را نمی‌دهد.',
      'انتشار تصمیمی جدا از پذیرش است و مرجع تأیید خودش را می‌خواهد.',
      'هر فعال‌سازی با هویت سمت سرور شما ممیزی می‌شود؛ نقش نمایشی هویت نیست.',
    ],
    error: 'عملیات ناموفق بود',
    retry: 'تلاش دوباره',
    loading: 'در حال بارگذاری وضعیت پایلوت…',
    statusOnly: 'فقط وضعیت. هیچ محتوای گزارشی در این کنسول نمایش داده نمی‌شود.',
  },
} as const;

/**
 * Steward console for the restricted pilot (task 3.2).
 *
 * It renders flag state, the publication gate and retention — and **no report content**. The
 * console is a control surface, not a reading surface: a steward who needs individual reports uses
 * the moderation flow, which is audited. Enabling a capability always requires an owner and an
 * approval reference, and the server refuses one for a synthetic dataset regardless of what this
 * component submits.
 */
export const PilotStewardConsole: React.FC<Props> = ({ darkMode, datasetId, activeRole, onFlyTo }) => {
  void onFlyTo;
  const { language } = useLanguage();
  const copy = COPY[language];
  const pilotCopy = getPilotText(language);
  const fa = language === 'fa';

  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState('');
  const [approval, setApproval] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [policyRef, setPolicyRef] = useState('');
  const [aggregate, setAggregate] = useState<{
    enabled: boolean;
    aggregates: Record<string, any>[];
    minimum_cell_size: number;
    disclosure_policy_reference: string;
  } | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [extract, setExtract] = useState<Record<string, any> | null>(null);

  const isSteward = activeRole === 'data_steward';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await uaiApi.getPilotStatus());
      try {
        setAggregate(await uaiApi.getPilotAggregates(datasetId));
      } catch {
        setAggregate(null);
      }
      try {
        const extracts = await uaiApi.getNetworkExtracts(datasetId);
        setExtract(extracts.extracts?.[0] ?? null);
      } catch {
        setExtract(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.error);
    } finally {
      setLoading(false);
    }
  }, [datasetId, copy.error]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFlag = async (key: string, enabled: boolean) => {
    setBusyKey(key);
    setError(null);
    setResolution(null);
    try {
      await uaiApi.setPilotFlag({
        key,
        enabled,
        owner: owner.trim(),
        approval_reference: approval.trim(),
        dataset_id: datasetId,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.error);
    } finally {
      setBusyKey(null);
    }
  };

  const rebuild = async () => {
    setBusyKey('publication');
    setError(null);
    setResolution(null);
    try {
      const result = await uaiApi.rebuildPublicAggregates(datasetId, policyRef.trim());
      setResolution(
        `${copy.rebuilt}: ${result.published_cells ?? 0} ${copy.cellsPublished}, ${result.suppressed_cells ?? 0} ${copy.cellsSuppressed}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.error);
    } finally {
      setBusyKey(null);
    }
  };

  const applyRetention = async () => {
    setBusyKey('retention');
    setError(null);
    setResolution(null);
    try {
      const result = await uaiApi.applyPilotRetention(datasetId);
      setResolution(
        `${copy.retentionResult}: ${result.eligible ?? 0} · ${copy.retentionDeleted}: ${result.deleted ?? 0}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.error);
    } finally {
      setBusyKey(null);
    }
  };

  const cardCls = `rounded-md border p-3 text-xs ${darkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`;
  const inputCls = `w-full px-2 py-1 rounded border text-[11px] ${darkMode ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900'}`;

  if (!isSteward) {
    return (
      <div className={cardCls} role="note">
        <p className="font-semibold flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-amber-400" aria-hidden="true" />
          {copy.title}
        </p>
        <p className="mt-1 text-amber-300" data-testid="pilot-console-not-steward">
          {copy.notSteward}
        </p>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className={cardCls} role="status">
        {copy.loading}
      </div>
    );
  }

  const isPilotDataset = status?.dataset?.profile_key === 'pilot';

  return (
    <div className="space-y-3 text-xs">
      <div className={cardCls}>
        <h2 className="font-semibold flex items-center gap-1.5">
          <Flag className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          {copy.title}
        </h2>
        <p className="opacity-70">{copy.subtitle}</p>
        {!isPilotDataset && (
          <p className="mt-1 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-amber-200" role="note">
            {copy.syntheticBadge} · {copy.realDatasetOnly}
          </p>
        )}
      </div>

      <div className={cardCls}>
        <p className="font-semibold mb-1">{copy.warningHeading}</p>
        <ul className="list-disc ms-4 space-y-0.5 opacity-90">
          {copy.warnings.map((warning) => (
            <li key={warning}>
              <bdi>{warning}</bdi>
            </li>
          ))}
        </ul>
      </div>

      <div className={cardCls}>
        <p className="font-semibold mb-1">{copy.flagsHeading}</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="block text-[10px] opacity-70" htmlFor="pilot-flag-owner">
              {copy.owner}
            </label>
            <input
              id="pilot-flag-owner"
              className={inputCls}
              value={owner}
              placeholder={copy.ownerPlaceholder}
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] opacity-70" htmlFor="pilot-flag-approval">
              {copy.approval}
            </label>
            <input
              id="pilot-flag-approval"
              className={inputCls}
              value={approval}
              placeholder={copy.approvalPlaceholder}
              onChange={(e) => setApproval(e.target.value)}
            />
          </div>
        </div>
        <p className="text-[10px] opacity-70 mb-2">{copy.needsOwner}</p>
        <ul className="space-y-1.5">
          {FLAG_KEYS.map((key) => {
            const flag = status?.flags?.[key];
            const enabled = Boolean(flag?.enabled);
            const label =
              key === 'pilot_intake'
                ? copy.flagIntake
                : key === 'pilot_tracking'
                  ? copy.flagTracking
                  : key === 'pilot_publication'
                    ? copy.flagPublication
                    : copy.flagCorrections;
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-2 border-t border-slate-700/50 pt-1.5"
                data-testid={`pilot-flag-${key}`}
              >
                <div>
                  <p className="font-semibold">
                    <bdi>{label}</bdi>{' '}
                    <span className={enabled ? 'text-emerald-400' : 'text-slate-400'}>
                      ({enabled ? copy.enabled : copy.disabled})
                    </span>
                  </p>
                  <p className="font-mono text-[10px] opacity-70" dir="ltr">
                    {key} · {flag?.owner || '—'} · {flag?.approval_reference || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyKey === key || (!enabled && (!owner.trim() || !approval.trim()))}
                  onClick={() => void toggleFlag(key, !enabled)}
                  className={`shrink-0 rounded border px-2 py-0.5 disabled:opacity-40 ${
                    enabled ? 'border-rose-500/60 text-rose-300' : 'border-emerald-500/60 text-emerald-300'
                  }`}
                >
                  {enabled ? copy.disable : copy.enable}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={cardCls}>
        <p className="font-semibold mb-1">{copy.aggregateHeading}</p>
        {!aggregate?.enabled ? (
          <p className="text-amber-300" data-testid="pilot-aggregate-closed">
            {copy.aggregateClosed}
          </p>
        ) : (
          <p>
            {copy.minCell}: <bdi dir="ltr">{aggregate.minimum_cell_size}</bdi> ·{' '}
            {aggregate.aggregates.length} {copy.cellsPublished}
          </p>
        )}
        <div className="flex gap-2 mt-2 items-end">
          <div className="flex-1">
            <label className="block text-[10px] opacity-70" htmlFor="pilot-policy-ref">
              {copy.policyRef}
            </label>
            <input
              id="pilot-policy-ref"
              className={inputCls}
              value={policyRef}
              onChange={(e) => setPolicyRef(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busyKey === 'publication' || !policyRef.trim()}
            onClick={() => void rebuild()}
            className="rounded border border-cyan-500/60 px-2 py-1 disabled:opacity-40 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            {copy.rebuild}
          </button>
        </div>
      </div>

      <div className={cardCls}>
        <p className="font-semibold">{copy.retentionHeading}</p>
        <p className="opacity-85 mt-0.5">{copy.retentionBody}</p>
        <button
          type="button"
          disabled={busyKey === 'retention'}
          onClick={() => void applyRetention()}
          className="mt-1 rounded border border-slate-600 px-2 py-1 disabled:opacity-40"
        >
          {copy.applyRetention}
        </button>
      </div>

      <div className={cardCls}>
        <p className="font-semibold">{copy.extractHeading}</p>
        {extract ? (
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]" data-testid="pilot-extract-summary">
            <div className="col-span-2">
              <dt className="inline opacity-70">{fa ? 'نسخه' : 'version'}: </dt>
              <dd className="inline" dir="ltr">{String(extract.extract_version ?? '—')}</dd>
            </div>
            <div className="col-span-2">
              <dt className="inline opacity-70">{fa ? 'مجوز' : 'licence'}: </dt>
              <dd className="inline"><bdi>{String(extract.license || '—')}</bdi></dd>
            </div>
            <div>
              <dt className="inline opacity-70">{fa ? 'قطعه' : 'segments'}: </dt>
              <dd className="inline" dir="ltr">{String(extract.segment_count ?? '—')}</dd>
            </div>
            <div>
              <dt className="inline opacity-70">{copy.ambiguousCrossings}: </dt>
              <dd className="inline" dir="ltr">{String(extract.ambiguous_crossing_count ?? 0)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="inline opacity-70">sha256: </dt>
              <dd className="inline" dir="ltr">{String(extract.checksum_sha256 ?? '').slice(0, 16)}</dd>
            </div>
          </dl>
        ) : (
          <p className="opacity-80 mt-0.5" data-testid="pilot-extract-summary">
            {copy.extractNone}
          </p>
        )}
      </div>

      {resolution && (
        <p role="status" className="text-emerald-300 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          <bdi>{resolution}</bdi>
        </p>
      )}

      {error && (
        <div role="alert" className="rounded border border-rose-500/60 bg-rose-500/10 p-2 text-rose-200">
          <p className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {copy.error}
          </p>
          <p data-testid="pilot-console-error">
            <bdi>{error}</bdi>
          </p>
          <button type="button" className="underline mt-1" onClick={() => void load()}>
            {copy.retry}
          </button>
        </div>
      )}

      <p className="text-[10px] opacity-60">{copy.statusOnly}</p>
    </div>
  );
};

export default PilotStewardConsole;
