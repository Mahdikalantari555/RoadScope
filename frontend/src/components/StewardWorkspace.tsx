import React, { useEffect, useState } from 'react';
import { Check, Flag, GitMerge, Lock, Navigation, ShieldCheck, XCircle } from 'lucide-react';
import { uaiApi } from '../api/client';
import { useLanguage } from '../i18n';
import { domainLabel } from '../analyticsI18n';
import { getStewardText } from '../workspaceI18n';
import type { PersonaRole } from '../types/uai';

interface StewardWorkspaceProps {
  darkMode: boolean;
  datasetId: number;
  activeRole: PersonaRole;
  onSwitchToStewardRole: () => void;
  onDataMutated: () => void;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
}

export const StewardWorkspace: React.FC<StewardWorkspaceProps> = ({
  darkMode,
  datasetId,
  activeRole,
  onSwitchToStewardRole,
  onDataMutated,
  onFlyTo,
}) => {
  const { language, t } = useLanguage();
  const copy = getStewardText(language);

  const [subTab, setSubTab] = useState<'clusters' | 'queue' | 'diagnostics' | 'audit'>('clusters');
  const [data, setData] = useState<{
    triage_queue: Record<string, any>[];
    duplicate_clusters: Record<string, any>[];
    diagnostics: Record<string, any>;
  } | null>(null);
  const [vgiResearchDiag, setVgiResearchDiag] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadWorkspace = async () => {
    const [res, rDiag] = await Promise.all([
      uaiApi.getStewardWorkspace(datasetId),
      uaiApi.getVgiDiagnostics(datasetId).catch(() => null),
    ]);
    setData(res);
    setVgiResearchDiag(rDiag);
  };

  useEffect(() => {
    loadWorkspace();
  }, [datasetId]);

  const handleMergeCluster = async (canonicalId: number, memberIds: number[]) => {
    setBusy(true);
    setMsg(null);
    try {
      const childIds = memberIds.filter((id) => id !== canonicalId);
      const res: any = await uaiApi.stewardMergeCluster({
        canonical_id: canonicalId,
        duplicate_ids: childIds,
        verify_canonical: true,
        review_notes: 'Merged multi-witness spatiotemporal cluster via Steward Triage.',
        actor_role: activeRole,
      });
      setMsg({
        ok: true,
        text: `Merged ${childIds.length} → #${res.canonical_id} (Witnesses=${res.total_witnesses}, Credibility=${res.vgi_credibility_score}).`,
      });
      await loadWorkspace();
      onDataMutated();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Merge failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleReviewDecision = async (
    accId: number,
    newStatus: string,
    overrideSegId?: number,
    overrideOffsetM?: number
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      await uaiApi.stewardReview({
        accident_id: accId,
        new_status: newStatus,
        override_segment_id: overrideSegId ?? null,
        override_offset_m: overrideOffsetM ?? null,
        review_notes: `Steward status -> ${newStatus}`,
        actor_role: activeRole,
      });
      setMsg({ ok: true, text: `#${accId} → '${newStatus}'` });
      await loadWorkspace();
      onDataMutated();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Decision failed' });
    } finally {
      setBusy(false);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <div>
        <h2 className="font-semibold text-sm flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          {copy.title}
        </h2>
        <p className="text-[11px] opacity-70">{copy.subtitle}</p>
      </div>

      {activeRole !== 'data_steward' && (
        <div className="p-2.5 rounded border border-amber-500/60 bg-amber-500/10 text-amber-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Lock className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <b>{t(activeRole)}</b> — {copy.rbacReadOnly}
            </span>
          </div>
          <button
            type="button"
            onClick={onSwitchToStewardRole}
            className="px-2 py-1 rounded bg-amber-400 text-slate-950 font-semibold text-[11px] shrink-0"
          >
            {copy.assumeSteward}
          </button>
        </div>
      )}

      {msg && (
        <div
          role="status"
          className={`p-2 rounded border font-mono text-[11px] ${
            msg.ok
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
              : 'border-rose-500/50 bg-rose-500/15 text-rose-200'
          }`}
        >
          <bdi>{msg.text}</bdi>
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
            {[
              { id: 'clusters', label: `${copy.tabClusters} (${data.duplicate_clusters.length})` },
              { id: 'queue', label: `${copy.tabQueue} (${data.triage_queue.length})` },
              { id: 'diagnostics', label: copy.tabDiagnostics },
              { id: 'audit', label: `${copy.tabAudit} (${data.diagnostics.audit_logs.length})` },
            ].map((tb) => (
              <button
                type="button"
                key={tb.id}
                onClick={() => setSubTab(tb.id as any)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
                  subTab === tb.id
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'border-slate-800 opacity-75 hover:opacity-100'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {/* 1. Automated Spatiotemporal Duplicate Clusters */}
          {subTab === 'clusters' && (
            <div className="space-y-2.5">
              {data.duplicate_clusters.length === 0 && <div className={cardCls}>{copy.noClusters}</div>}
              {data.duplicate_clusters.map((cl) => (
                <div key={cl.cluster_key} className={`${cardCls} space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-emerald-400">
                        <bdi>{cl.primary_segment_name}</bdi>
                      </span>
                      <div className="text-[10px] font-mono opacity-75" dir="ltr">
                        {cl.member_count} Reports · {cl.total_witnesses} W · d_net={cl.max_network_spread_m}m, Δt=
                        {cl.max_temporal_spread_min}m
                      </div>
                    </div>
                    <div className="text-end font-mono">
                      <div className="text-xs font-bold text-cyan-300">
                        {copy.credibility} {(cl.composite_credibility_score * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] opacity-70">
                        {copy.agreement} {(cl.attribute_consistency * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {cl.members.map((m: any) => (
                      <div
                        key={m.id}
                        onClick={() => onFlyTo(m.snapped_lon, m.snapped_lat, 16)}
                        className="p-1.5 rounded bg-slate-950/70 border border-slate-800/80 font-mono text-[10px] flex items-center justify-between cursor-pointer hover:border-cyan-500/50"
                      >
                        <span>
                          <bdi>#{m.id}</bdi> · {domainLabel(language, m.category_code, m.category_code)} (
                          {domainLabel(language, m.severity_code, m.severity_code)}) · d⊥=
                          {Number(m.orthogonal_snap_dist_m).toFixed(1)}m
                        </span>
                        <span className="opacity-75" dir="ltr">
                          {m.occurred_at_utc.slice(11, 16)} UTC
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleMergeCluster(cl.recommended_canonical_id, cl.member_ids)}
                    className="w-full py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {copy.mergeVerify} (#{cl.recommended_canonical_id})
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 2. Individual VGI Triage Queue */}
          {subTab === 'queue' && (
            <div className="space-y-2.5">
              {data.triage_queue.slice(0, 25).map((item) => {
                const topCand = item.snap_candidates?.[0];
                const altCand = item.snap_candidates?.[1];
                return (
                  <div key={item.id} className={`${cardCls} space-y-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-cyan-400">
                            <bdi>#{item.id}</bdi>
                          </span>
                          <span className="font-semibold">
                            {domainLabel(language, item.category_code, item.category_label)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10px]">
                            <bdi>{item.verification_status}</bdi>
                          </span>
                        </div>
                        <div className="text-[10.5px] font-mono opacity-80 mt-0.5" dir="ltr">
                          <b>{item.segment_name}</b> (L{item.elevation_level}, LRS m=
                          {Number(item.linear_offset_m).toFixed(1)}m, d⊥=
                          {Number(item.orthogonal_snap_dist_m).toFixed(1)}m)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onFlyTo(item.raw_lon, item.raw_lat, 16.3)}
                        className="px-2 py-1 rounded border border-slate-700 hover:border-cyan-400 text-[10px] font-mono flex items-center gap-1"
                      >
                        <Navigation className="w-3 h-3 text-cyan-400" /> {copy.inspect}
                      </button>
                    </div>

                    {topCand?.topological_override && (
                      <div className="p-1.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-[10px]">
                        {copy.topoOverrideBanner}
                      </div>
                    )}

                    <p className="text-[11px] opacity-80" dir="auto">
                      {item.narrative}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'verified_canonical')}
                        className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 text-[10px] flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> {copy.verifyCanonical}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'rejected_false_alarm')}
                        className="px-2 py-1 rounded bg-rose-500/20 border border-rose-500/60 text-rose-300 text-[10px] flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" /> {copy.rejectFalse}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'flagged_review')}
                        className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/60 text-amber-300 text-[10px] flex items-center gap-1"
                      >
                        <Flag className="w-3 h-3" /> {copy.flagReview}
                      </button>
                      {altCand && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleReviewDecision(
                              item.id,
                              item.verification_status,
                              altCand.segment_id,
                              altCand.linear_offset_m
                            )
                          }
                          className="px-2 py-1 rounded border border-slate-700 text-[10px] opacity-85 hover:opacity-100"
                        >
                          {copy.snapAlt}: <bdi>{altCand.segment_name}</bdi>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. Macro VGI Quality & Allocation Ambiguity Diagnostics */}
          {subTab === 'diagnostics' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 font-mono">
                <div className={cardCls}>
                  <div className="text-[10px] font-sans opacity-70">{copy.meanSnapDrift}</div>
                  <div className="text-base font-bold text-amber-400" dir="ltr">
                    {data.diagnostics.mean_positional_drift_m} m
                  </div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] font-sans opacity-70">{copy.medianLag}</div>
                  <div className="text-base font-bold text-cyan-400" dir="ltr">
                    {data.diagnostics.median_reporting_lag_min} min
                  </div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] font-sans opacity-70">{copy.topoOverrides}</div>
                  <div className="text-base font-bold text-emerald-400">
                    {data.diagnostics.topological_override_count}
                  </div>
                </div>
              </div>

              {vgiResearchDiag && (
                <div className={`${cardCls} space-y-2`}>
                  <div className="font-semibold text-cyan-300">{copy.vgiAllocTitle}</div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[10.5px]">
                    <div>
                      <div className="text-[9.5px] font-sans opacity-70">{copy.ambiguousShare}</div>
                      <b className="text-amber-300">{vgiResearchDiag.ambiguous_share_pct}%</b>
                    </div>
                    <div>
                      <div className="text-[9.5px] font-sans opacity-70">{copy.witnessRatio}</div>
                      <b className="text-cyan-300">{vgiResearchDiag.witness_inflation_ratio}×</b>
                    </div>
                    <div>
                      <div className="text-[9.5px] font-sans opacity-70">{copy.meanEntropy}</div>
                      <b className="text-emerald-300">{vgiResearchDiag.mean_allocation_entropy_nats}</b>
                    </div>
                  </div>
                </div>
              )}

              <div className={cardCls}>
                <div className="font-semibold mb-2">{copy.driftDist}</div>
                <div className="space-y-1.5 font-mono text-[11px]" dir="ltr">
                  {data.diagnostics.positional_drift_histogram.map((b: any) => (
                    <div key={b.bin} className="flex items-center gap-2">
                      <span className="w-14">{b.bin}</span>
                      <div className="flex-1 h-2.5 bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-amber-400"
                          style={{
                            width: `${(b.count / Math.max(1, data.diagnostics.vgi_subset_count)) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right">{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={cardCls}>
                <div className="font-semibold mb-2">{copy.lagHist}</div>
                <div className="space-y-1.5 font-mono text-[11px]" dir="ltr">
                  {data.diagnostics.reporting_lag_histogram.map((b: any) => (
                    <div key={b.bin} className="flex items-center gap-2">
                      <span className="w-16">{b.bin}</span>
                      <div className="flex-1 h-2.5 bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-cyan-400"
                          style={{
                            width: `${(b.count / Math.max(1, data.diagnostics.vgi_subset_count)) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right">{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={cardCls}>
                <div className="font-semibold mb-1.5">{copy.provenanceSep}</div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  {Object.entries(data.diagnostics.source_breakdown).map(([k, v]) => (
                    <div
                      key={k}
                      className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex justify-between"
                    >
                      <bdi>{k}</bdi>
                      <b>{String(v)}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. Immutable Audit Log */}
          {subTab === 'audit' && (
            <div className={`${cardCls} space-y-2`}>
              <div className="font-semibold">{copy.auditTitle}</div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto font-mono text-[10.5px]" dir="ltr">
                {data.diagnostics.audit_logs.map((log: any) => (
                  <div key={log.id} className="p-2 rounded bg-slate-950/70 border border-slate-800">
                    <div className="flex justify-between text-cyan-300">
                      <span>
                        #{log.id} · {log.action_type}
                      </span>
                      <span className="opacity-70">{log.created_at_utc}</span>
                    </div>
                    <div className="opacity-80">
                      {log.actor_name} ({log.actor_role}) → {log.entity_type} #{log.entity_id}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
