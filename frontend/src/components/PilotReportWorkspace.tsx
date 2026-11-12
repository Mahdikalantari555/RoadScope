import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Lock,
  MapPin,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { uaiApi } from '../api/client';
import { taxonomyLabel } from '../analyticsI18n';
import { useLanguage } from '../i18n';
import { getPilotText } from '../pilotI18n';
import type {
  CategoryMeta,
  PilotBootstrap,
  PilotReportReceipt,
  PilotStatus,
  PilotTracking,
  SeverityMeta,
} from '../types/uai';

interface Props {
  darkMode: boolean;
  datasetId: number;
  /** Study-area centre from /meta, so no city is hard-coded here. */
  suggestedPreset4326?: [number, number] | null;
  studyAreaLabel?: string | null;
  /** Point chosen on the map, if the user clicked one. */
  clickedMapCoord?: { lon: number; lat: number; ts: number } | null;
  onFlyTo?: (lon: number, lat: number, zoom?: number) => void;
  onSubmitted?: () => void;
}

type Gate = 'loading' | 'open' | 'closed' | 'error';

const TIMEZONES: { value: string; labelEn: string; labelFa: string }[] = [
  { value: 'Asia/Tehran', labelEn: 'Iran (Asia/Tehran)', labelFa: 'ایران (Asia/Tehran)' },
  { value: 'UTC', labelEn: 'UTC', labelFa: 'UTC' },
  { value: 'Europe/Berlin', labelEn: 'Central Europe (Berlin)', labelFa: 'اروپای مرکزی (برلین)' },
];

/**
 * Restricted pilot report form (task 3.1).
 *
 * The form is *closed by default*: it renders the server's gate state and explains why, rather
 * than showing inputs that can only fail. That is the honest presentation of a capability that
 * requires institutional approval. When intake is open the form still collects nothing beyond
 * enumerated categories, a time, a point and an uncertainty radius — there is no input field for
 * a narrative, a photo or a name, so those can never be typed into a request by accident.
 */
export const PilotReportWorkspace: React.FC<Props> = ({
  darkMode,
  datasetId,
  suggestedPreset4326,
  studyAreaLabel,
  clickedMapCoord,
  onFlyTo,
  onSubmitted,
}) => {
  const { language } = useLanguage();
  const copy = getPilotText(language);
  const fa = language === 'fa';

  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [bootstrap, setBootstrap] = useState<PilotBootstrap | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [gateError, setGateError] = useState<string | null>(null);

  const [timezone, setTimezone] = useState('Asia/Tehran');
  const [occurredLocal, setOccurredLocal] = useState('');
  const [lon, setLon] = useState<number>(suggestedPreset4326?.[0] ?? 0);
  const [lat, setLat] = useState<number>(suggestedPreset4326?.[1] ?? 0);
  const [uncertainty, setUncertainty] = useState(25);
  const [categoryCode, setCategoryCode] = useState('REAR_END');
  const [severityCode, setSeverityCode] = useState('MINOR_INJURY');
  const [severityUnknown, setSeverityUnknown] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<
    { segment_id: number; segment_name: string; snap_probability: number }[]
  >([]);
  const [matchState, setMatchState] = useState<'confident' | 'uncertain' | 'unmatched'>('unmatched');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PilotReportReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  const idempotencyKey = useRef<string>('');
  const previewSequence = useRef(0);

  const load = useCallback(async () => {
    setGate('loading');
    setGateError(null);
    try {
      const [s, b] = await Promise.all([uaiApi.getPilotStatus(), uaiApi.getPilotBootstrap()]);
      setStatus(s);
      setBootstrap(b);
      // Two independent gates must both be open: the server-side gate on the pilot status and
      // the sanitized bootstrap the participant actually sees.
      setGate(s.release_gates?.intake_enabled === true && b.intake_enabled === true ? 'open' : 'closed');
    } catch (e) {
      setGate('error');
      setGateError(e instanceof Error ? e.message : 'Pilot status unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (suggestedPreset4326) {
      setLon(Number(suggestedPreset4326[0].toFixed(6)));
      setLat(Number(suggestedPreset4326[1].toFixed(6)));
    }
  }, [suggestedPreset4326?.[0], suggestedPreset4326?.[1]]);

  useEffect(() => {
    if (clickedMapCoord) {
      setLon(Number(clickedMapCoord.lon.toFixed(6)));
      setLat(Number(clickedMapCoord.lat.toFixed(6)));
    }
  }, [clickedMapCoord]);

  // Matching preview. Each request carries a sequence number so a slow, older response can never
  // overwrite the result for the point the user is looking at now.
  useEffect(() => {
    if (gate !== 'open') return;
    const sequence = ++previewSequence.current;
    const timer = setTimeout(async () => {
      try {
        const res = await uaiApi.previewSnapAndConflate({
          dataset_id: datasetId,
          lon,
          lat,
          observational_radius_m: uncertainty,
          occurred_at_utc: occurredUtcIso(),
          category_code: categoryCode,
          max_net_dist_m: Math.max(160, uncertainty * 2),
          max_time_diff_min: 90,
        });
        if (sequence !== previewSequence.current) return;
        const list = (res.candidate_snaps ?? []).map((c) => ({
          segment_id: c.segment_id,
          segment_name: c.segment_name,
          snap_probability: c.snap_probability,
        }));
        setCandidates(list);
        const top = res.candidate_snaps?.[0];
        const second = res.candidate_snaps?.[1];
        if (!top) {
          setMatchState('unmatched');
          setSelectedSegmentId(null);
        } else if (
          top.snap_probability < 0.55 ||
          (second && top.snap_probability - second.snap_probability < 0.12)
        ) {
          setMatchState('uncertain');
          setSelectedSegmentId(null);
        } else {
          setMatchState('confident');
          setSelectedSegmentId(top.segment_id);
        }
      } catch {
        if (sequence === previewSequence.current) {
          // A failed preview never blocks submission: the report is stored unmatched and a
          // steward resolves it. Silently inventing a match would be worse.
          setCandidates([]);
          setMatchState('unmatched');
        }
      }
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, datasetId, lon, lat, uncertainty, categoryCode]);

  function occurredUtcIso(): string {
    return occurredLocal ? new Date(occurredLocal).toISOString() : new Date().toISOString();
  }

  const categories: CategoryMeta[] = bootstrap?.categories?.length ? bootstrap.categories : [];
  const severities: SeverityMeta[] = bootstrap?.severities?.length ? bootstrap.severities : [];

  // Tracking has its own flag: opening intake must never implicitly open the status endpoint.
  const trackingOpen = Boolean(
    status?.flags?.pilot_tracking?.enabled && status?.release_gates?.intake_enabled
  );

  const gates = useMemo(() => {
    const rows: { key: string; ok: boolean; label: string }[] = [];
    rows.push({
      key: 'flag',
      ok: Boolean(status?.release_gates?.intake_enabled),
      label: `${copy.gateFlag}: pilot_intake`,
    });
    rows.push({
      key: 'profile',
      ok: status?.dataset?.profile_key === 'pilot',
      label: `${copy.gateProfile}: ${status?.dataset?.profile_key ?? '—'}`,
    });
    rows.push({
      key: 'approval',
      ok: Boolean(status?.flags?.pilot_intake?.approval_reference),
      label: `${copy.gateApproval}: ${status?.flags?.pilot_intake?.approval_reference || '—'}`,
    });
    return rows;
  }, [status, copy]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!consent) {
      setError(copy.consentRequired);
      return;
    }
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setSubmitting(true);
    try {
      const result = await uaiApi.submitPilotReport(
        {
          dataset_id: datasetId,
          occurred_at_local: occurredLocal || new Date().toISOString(),
          timezone,
          category_code: categoryCode,
          severity_code: severityCode,
          location_uncertainty_m: uncertainty,
          lon,
          lat,
          selected_segment_id: matchState === 'confident' ? selectedSegmentId : null,
          consent_given: true,
          consent_locale: language,
          transport_mode: 'vehicle_occupant',
          reporter_identity_hint: '',
        },
        idempotencyKey.current
      );
      setReceipt(result);
      setConsent(false);
      onSubmitted?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : copy.errorGeneric;
      if (/rate limit/i.test(message)) setError(copy.errorRate);
      else if (/consent/i.test(message)) setError(copy.errorConsent);
      else if (/disabled|closed/i.test(message)) setError(copy.errorClosed);
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${darkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`;
  const inputCls = `w-full px-2 py-1 rounded border font-mono text-[11px] ${darkMode ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900'}`;
  const labelCls = 'block text-[10px] opacity-70 mb-0.5';

  if (gate === 'loading') {
    return (
      <div className="h-full overflow-y-auto p-3 text-xs" role="status">
        {fa ? 'در حال بررسی وضعیت پایلوت…' : 'Checking the pilot gate…'}
      </div>
    );
  }

  if (gate === 'error') {
    return (
      <div className="h-full overflow-y-auto p-3 space-y-2 text-xs">
        <div role="alert" className="rounded border border-rose-500/60 bg-rose-500/10 p-3 text-rose-200">
          <bdi>{gateError}</bdi>
        </div>
        <button type="button" onClick={() => void load()} className="rounded border border-slate-600 px-2 py-1">
          {copy.reload}
        </button>
      </div>
    );
  }

  // Closed gate: explain, and do not offer inputs that cannot work.
  if (gate !== 'open') {
    return (
      <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
        <div className={`${cardCls} space-y-2`}>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-amber-400" aria-hidden="true" />
            {copy.disabledTitle}
          </h2>
          <p className="leading-relaxed" data-testid="pilot-closed-body">
            {copy.disabledBody}
          </p>
          <p className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-200">
            {status?.dataset?.profile_key !== 'pilot' ? copy.notPilotProfile : copy.intakeClosed}
          </p>
          <div>
            <p className="font-semibold mb-1">{copy.gatesHeading}</p>
            <ul className="space-y-0.5" data-testid="pilot-gates">
              {gates.map((g) => (
                <li key={g.key} className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className={g.ok ? 'text-emerald-400' : 'text-rose-400'}>{g.ok ? '✓' : '✗'}</span>
                  <bdi>{g.label}</bdi>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => void load()} className="rounded border border-slate-600 px-2 py-1">
            {copy.reload}
          </button>
        </div>
        <TrackingPanel datasetId={datasetId} trackingEnabled={false} />
      </div>
    );
  }

  // Receipt view: the credential is shown exactly once and is never placed in a URL or a log.
  if (receipt) {
    return (
      <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
        <div className={`${cardCls} space-y-2`} role="status">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            {copy.submitted}
          </h2>
          <p>
            {fa ? 'شناسهٔ گزارش' : 'Report ID'}: <bdi dir="ltr" className="font-mono">{receipt.report_public_id}</bdi>
          </p>
          <p className="opacity-80">{copy.submittedUnverified}</p>
          <div className="rounded border border-amber-500/60 bg-amber-500/10 p-2 space-y-1">
            <p className="font-semibold text-amber-200">{copy.receiptHeading}</p>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 rounded bg-slate-950/70 px-2 py-1 font-mono text-sm tracking-wider" data-testid="pilot-credential">
                {receipt.tracking_credential}
              </code>
              <button
                type="button"
                className="rounded border border-amber-400/60 px-2 py-1 flex items-center gap-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(receipt.tracking_credential);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <Copy className="w-3 h-3" aria-hidden="true" />
                {copied ? copy.receiptCopied : copy.receiptCopy}
              </button>
            </div>
            <p className="text-[10px] text-amber-200/90">{copy.receiptWarning}</p>
            <p className="text-[10px] opacity-80">{copy.receiptNoUrl}</p>
          </div>
          {receipt.duplicate_suggestion && (
            <div className="rounded border border-slate-600 bg-slate-800/40 p-2">
              <p className="font-semibold">{copy.duplicatesHeading}</p>
              <p className="text-[10px] opacity-80">{copy.duplicatesBody}</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                <li>
                  {copy.duplicateItem} #{receipt.duplicate_suggestion.accident_id} ·{' '}
                  {copy.duplicateDistance} {receipt.duplicate_suggestion.distance_m} m ·{' '}
                  <bdi dir="ltr">{receipt.duplicate_suggestion.occurred_at_utc}</bdi>
                </li>
              </ul>
            </div>
          )}
        </div>
        <TrackingPanel datasetId={datasetId} trackingEnabled={trackingOpen} />
        <button
          type="button"
          onClick={() => {
            setReceipt(null);
            idempotencyKey.current = '';
          }}
          className="rounded border border-slate-600 px-2 py-1"
        >
          {copy.back}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      {offline && (
        <div role="alert" className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-amber-200">
          {copy.offline}
        </div>
      )}

      <div className={cardCls}>
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-rose-400" aria-hidden="true" />
          {copy.formTitle}
        </h2>
        <p className="mt-1 leading-relaxed opacity-90">{copy.formIntro}</p>
        {studyAreaLabel && (
          <p className="mt-1 text-[10px] opacity-70">
            {fa ? 'منطقهٔ مطالعاتی' : 'Study area'}: <bdi>{studyAreaLabel}</bdi>
          </p>
        )}
      </div>

      <div className={cardCls}>
        <p className="font-semibold">{copy.purposeHeading}</p>
        <p className="mt-0.5 leading-relaxed opacity-90">{copy.purposeBody}</p>
        <p className="mt-2 font-semibold">{copy.notCollectedHeading}</p>
        <ul className="mt-0.5 list-disc ms-4 space-y-0.5 opacity-90">
          {copy.notCollected.map((item) => (
            <li key={item}>
              <bdi>{item}</bdi>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={submit} className={`${cardCls} space-y-2.5`} noValidate>
        <div>
          <label className={labelCls} htmlFor="pilot-occurred">
            {copy.occurredLabel}{' '}
            <span className="text-rose-400" aria-hidden="true">
              *
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              id="pilot-occurred"
              dir="ltr"
              type="datetime-local"
              required
              aria-describedby="pilot-occurred-hint"
              value={occurredLocal}
              onChange={(e) => setOccurredLocal(e.target.value)}
              className={inputCls}
            />
            <select
              aria-label={copy.timezoneLabel}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={inputCls}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {fa ? tz.labelFa : tz.labelEn}
                </option>
              ))}
            </select>
          </div>
          <p id="pilot-occurred-hint" className="mt-0.5 text-[10px] opacity-70">
            {copy.occurredHint}
          </p>
        </div>

        <fieldset>
          <legend className="text-[10px] opacity-70">{copy.locationHeading}</legend>
          <div className="grid grid-cols-2 gap-2 mt-0.5">
            <div>
              <label className={labelCls} htmlFor="pilot-lon">
                {copy.lonLabel}
              </label>
              <input
                id="pilot-lon"
                dir="ltr"
                type="number"
                step="0.000001"
                required
                value={lon}
                onChange={(e) => setLon(Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="pilot-lat">
                {copy.latLabel}
              </label>
              <input
                id="pilot-lat"
                dir="ltr"
                type="number"
                step="0.000001"
                required
                value={lat}
                onChange={(e) => setLat(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-0.5 text-[10px] opacity-70">{copy.locationHint}</p>
          {onFlyTo && (
            <button
              type="button"
              className="mt-1 rounded border border-cyan-500/50 px-2 py-0.5 text-[10px]"
              onClick={() => onFlyTo(lon, lat, 16)}
            >
              {fa ? 'نمایش روی نقشه' : 'Show on map'}
            </button>
          )}
        </fieldset>

        <div>
          <div className="flex justify-between font-mono text-[11px] mb-0.5">
            <label htmlFor="pilot-uncertainty" className="font-sans">
              {copy.uncertaintyLabel}
            </label>
            <span className="text-cyan-400 font-bold" dir="ltr">
              ±{uncertainty} m
            </span>
          </div>
          <input
            id="pilot-uncertainty"
            type="range"
            min={3}
            max={500}
            step={1}
            value={uncertainty}
            aria-describedby="pilot-uncertainty-hint"
            onChange={(e) => setUncertainty(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <p id="pilot-uncertainty-hint" className="text-[10px] opacity-70">
            {copy.uncertaintyHint}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="pilot-category">
              {copy.categoryLabel}
            </label>
            <select
              id="pilot-category"
              value={categoryCode}
              onChange={(e) => setCategoryCode(e.target.value)}
              className={inputCls}
            >
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {taxonomyLabel(language, c.code, c.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="pilot-severity">
              {copy.severityLabel}
            </label>
            <select
              id="pilot-severity"
              value={severityUnknown ? '__unknown' : severityCode}
              onChange={(e) => {
                const value = e.target.value;
                setSeverityUnknown(value === '__unknown');
                if (value !== '__unknown') setSeverityCode(value);
              }}
              className={inputCls}
            >
              {severities.map((s) => (
                <option key={s.code} value={s.code}>
                  {taxonomyLabel(language, s.code, s.label)}
                </option>
              ))}
              {/* "Unknown" is a real answer, not a missing one. */}
              <option value="__unknown">{copy.severityUnknown}</option>
            </select>
          </div>
        </div>

        <div aria-live="polite" className="rounded border border-slate-700/70 p-2 text-[10px]">
          <p className="font-semibold mb-0.5">{copy.matchHeading}</p>
          <p
            className={
              matchState === 'confident'
                ? 'text-emerald-300'
                : matchState === 'uncertain'
                  ? 'text-amber-300'
                  : 'text-slate-300'
            }
            data-testid="pilot-match-state"
          >
            {matchState === 'confident'
              ? copy.matchConfident
              : matchState === 'uncertain'
                ? copy.matchUncertain
                : copy.matchUnmatched}
          </p>
          {candidates.length > 0 && (
            <>
              <p className="mt-1 opacity-70">
                {candidates.length} {copy.matchCandidates}
              </p>
              <ul className="space-y-0.5 font-mono">
                {candidates.slice(0, 3).map((c) => (
                  <li key={c.segment_id} className="flex items-center justify-between gap-2">
                    <bdi>
                      #{c.segment_id} {c.segment_name}
                    </bdi>
                    <span dir="ltr">{(c.snap_probability * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="rounded border border-cyan-500/40 bg-cyan-500/5 p-2">
          <p className="font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
            {copy.consentHeading}
          </p>
          <label className="flex items-start gap-2 mt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-describedby="pilot-consent-version"
              className="mt-0.5"
            />
            <span className="leading-relaxed">
              <bdi>{copy.consentCheckbox}</bdi>
            </span>
          </label>
          <p id="pilot-consent-version" className="mt-1 text-[10px] opacity-70">
            {copy.consentVersion}: <bdi dir="ltr">{bootstrap?.consent_version ?? '—'}</bdi>
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded border border-rose-500/60 bg-rose-500/10 p-2 text-rose-200 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" aria-hidden="true" />
            <span data-testid="pilot-error">
              <bdi>{error}</bdi>
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !consent}
          className="w-full py-1.5 rounded bg-rose-500 hover:bg-rose-400 text-white font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {submitting ? <Clock className="w-3.5 h-3.5" aria-hidden="true" /> : <MapPin className="w-3.5 h-3.5" aria-hidden="true" />}
          {submitting ? copy.submitting : copy.submit}
        </button>
      </form>

      <TrackingPanel datasetId={datasetId} trackingEnabled={Boolean(status?.release_gates?.tracking_enabled)} />
    </div>
  );
};

/** Reporter status view: credential in a POST body, never in a URL or a log. */
function TrackingPanel({ datasetId, trackingEnabled }: { datasetId: number; trackingEnabled: boolean }) {
  const { language } = useLanguage();
  const copy = getPilotText(language);
  const [credential, setCredential] = useState('');
  const [result, setResult] = useState<PilotTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [reason, setReason] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);

  const check = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(await uaiApi.trackPilotReport(datasetId, credential));
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(/429|rate limit/i.test(message) ? copy.trackingRateLimited : copy.trackingNotFound);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      // The reporter sees `RS-000042`, not an internal row id; the endpoint resolves either form.
      await uaiApi.withdrawPilotConsent(result.report_public_id, datasetId, credential, reason);
      setWithdrawn(true);
      setResult(null);
      setConfirmWithdraw(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-slate-700 p-3 space-y-2 text-xs" aria-labelledby="pilot-tracking-title">
      <h3 id="pilot-tracking-title" className="font-semibold">
        {copy.trackingTitle}
      </h3>
      {!trackingEnabled ? (
        <p className="text-amber-300" data-testid="pilot-tracking-closed">
          {copy.trackingClosed}
        </p>
      ) : (
        <>
          <p className="opacity-80">{copy.trackingIntro}</p>
          <form onSubmit={check} className="flex gap-2">
            <label className="sr-only" htmlFor="pilot-tracking-credential">
              {copy.trackingCredentialLabel}
            </label>
            <input
              id="pilot-tracking-credential"
              dir="ltr"
              className="flex-1 px-2 py-1 rounded border border-slate-700 bg-slate-950 font-mono text-[11px] tracking-wider"
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
            <button type="submit" disabled={busy || credential.trim().length < 8} className="rounded border border-slate-600 px-2 py-1 disabled:opacity-50">
              {busy ? copy.trackingChecking : copy.trackingCheck}
            </button>
          </form>
          <p className="text-[10px] opacity-70">{copy.trackingOnlyStatus}</p>

          {error && (
            <p role="alert" className="text-rose-300" data-testid="pilot-tracking-error">
              <bdi>{error}</bdi>
            </p>
          )}

          {withdrawn && (
            <p role="status" className="text-emerald-300" data-testid="pilot-withdrawn">
              {copy.trackingWithdrawn}
            </p>
          )}

          {result && (
            <div className="rounded border border-slate-700 p-2 space-y-1" data-testid="pilot-tracking-result">
              <p>
                {copy.trackingStatusHeading}:{' '}
                <strong data-testid="pilot-status-label">
                  <bdi>{language === 'fa' ? result.status_label_fa : result.status_label}</bdi>
                </strong>
              </p>
              <p className="font-mono text-[10px] opacity-80" dir="ltr">
                {result.report_public_id} · {result.coarse_cell_key ?? '—'} · {result.retention_until_utc ?? '—'}
              </p>
              {result.merged_into && (
                <p className="text-[10px]">
                  {copy.trackingMergedInto} <bdi dir="ltr">{result.merged_into}</bdi>
                </p>
              )}
              <p className="text-[10px] opacity-80">
                {result.publication_note === 'published' ? copy.trackingPublished : copy.trackingNotPublished}
              </p>
              {result.can_withdraw_consent && !confirmWithdraw && (
                <button type="button" onClick={() => setConfirmWithdraw(true)} className="rounded border border-rose-500/60 px-2 py-0.5 text-rose-300 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {copy.trackingCanWithdraw}
                </button>
              )}
              {confirmWithdraw && (
                <div className="rounded border border-rose-500/60 bg-rose-500/10 p-2 space-y-1">
                  <p className="font-semibold text-rose-200">{copy.trackingWithdrawTitle}</p>
                  <label className="block text-[10px] opacity-80" htmlFor="pilot-withdraw-reason">
                    {copy.trackingWithdrawReason}
                  </label>
                  <input
                    id="pilot-withdraw-reason"
                    className="w-full px-2 py-1 rounded border border-slate-700 bg-slate-950 text-[11px]"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex gap-1.5">
                    <button type="button" disabled={busy} onClick={() => void withdraw()} className="rounded bg-rose-500 px-2 py-0.5 text-white">
                      {copy.trackingWithdrawConfirm}
                    </button>
                    <button type="button" onClick={() => setConfirmWithdraw(false)} className="rounded border border-slate-600 px-2 py-0.5">
                      {copy.trackingWithdrawCancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default PilotReportWorkspace;
