import React, { useEffect, useState } from 'react';
import {
  Check,
  Flag,
  GitMerge,
  Lock,
  Navigation,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { uaiApi } from '../api/client';
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
  const [subTab, setSubTab] = useState<'clusters' | 'queue' | 'diagnostics' | 'audit'>('clusters');
  const [data, setData] = useState<{
    triage_queue: Record<string, any>[];
    duplicate_clusters: Record<string, any>[];
    diagnostics: Record<string, any>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadWorkspace = async () => {
    const res = await uaiApi.getStewardWorkspace(datasetId);
    setData(res);
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
        text: `Merged ${childIds.length} duplicate reports into Canonical #${res.canonical_id} (Witnesses=${res.total_witnesses}, Credibility=${res.vgi_credibility_score}).`,
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
      setMsg({ ok: true, text: `Report #${accId} updated to '${newStatus}'.` });
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
          VGI Quality Assurance &amp; Topological Stewardship
        </h2>
        <p className="text-[11px] opacity-70">
          Probabilistic edge-snapping verification, duplicate witness conflation &amp; immutable audit log
        </p>
      </div>

      {/* RBAC Enforcement Banner (US-3.3) */}
      {activeRole !== 'data_steward' && (
        <div className="p-2.5 rounded border border-amber-500/60 bg-amber-500/10 text-amber-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Lock className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              Active role is <b className="font-mono">{activeRole}</b> (Read-Only QA). Mutating verification states requires <b>data_steward</b> RBAC.
            </span>
          </div>
          <button
            onClick={onSwitchToStewardRole}
            className="px-2 py-1 rounded bg-amber-400 text-slate-950 font-semibold text-[11px] shrink-0"
          >
            Assume Steward Role
          </button>
        </div>
      )}

      {msg && (
        <div
          className={`p-2 rounded border font-mono text-[11px] ${
            msg.ok
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
              : 'border-rose-500/50 bg-rose-500/15 text-rose-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {data && (
        <>
          {/* Sub-Tabs */}
          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
            {[
              { id: 'clusters', label: `Duplicate Clusters (${data.duplicate_clusters.length})` },
              { id: 'queue', label: `VGI Queue (${data.triage_queue.length})` },
              { id: 'diagnostics', label: 'QA Diagnostics' },
              { id: 'audit', label: `Audit Trail (${data.diagnostics.audit_logs.length})` },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id as any)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
                  subTab === t.id
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'border-slate-800 opacity-75 hover:opacity-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 1. Automated Spatiotemporal Duplicate Clusters (US-3.2) */}
          {subTab === 'clusters' && (
            <div className="space-y-2.5">
              {data.duplicate_clusters.length === 0 && (
                <div className={cardCls}>No unmerged duplicate VGI clusters remaining in active threshold.</div>
              )}
              {data.duplicate_clusters.map((cl) => (
                <div key={cl.cluster_key} className={`${cardCls} space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-emerald-400">{cl.primary_segment_name}</span>
                      <div className="text-[10px] font-mono opacity-75">
                        {cl.member_count} Reports · {cl.total_witnesses} Witnesses · Spread d_net={cl.max_network_spread_m}m, Δt={cl.max_temporal_spread_min}m
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs font-bold text-cyan-300">
                        Credibility {(cl.composite_credibility_score * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] opacity-70">Agreement {(cl.attribute_consistency * 100).toFixed(0)}%</div>
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
                          #{m.id} · {m.category_code} ({m.severity_code}) · d⊥={Number(m.orthogonal_snap_dist_m).toFixed(1)}m
                        </span>
                        <span className="opacity-75">{m.occurred_at_utc.slice(11, 16)} UTC</span>
                      </div>
                    ))}
                  </div>

                  <button
                    disabled={busy}
                    onClick={() => handleMergeCluster(cl.recommended_canonical_id, cl.member_ids)}
                    className="w-full py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    Merge into Canonical #{cl.recommended_canonical_id} &amp; Verify
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 2. Individual VGI Triage & Topological Map-Matching Queue */}
          {subTab === 'queue' && (
            <div className="space-y-2.5">
              {data.triage_queue.slice(0, 25).map((item) => {
                const topCand = item.snap_candidates?.[0];
                const altCand = item.snap_candidates?.[1];
                return (
                  <div key={item.id} className={`${cardCls} space-y-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-cyan-400">#{item.id}</span>
                          <span className="font-semibold">{item.category_label}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10px]">
                            {item.verification_status}
                          </span>
                        </div>
                        <div className="text-[10.5px] font-mono opacity-80 mt-0.5">
                          Snapped: <b>{item.segment_name}</b> (L{item.elevation_level}, LRS m={Number(item.linear_offset_m).toFixed(1)}m, d⊥={Number(item.orthogonal_snap_dist_m).toFixed(1)}m)
                        </div>
                      </div>
                      <button
                        onClick={() => onFlyTo(item.raw_lon, item.raw_lat, 16.3)}
                        className="px-2 py-1 rounded border border-slate-700 hover:border-cyan-400 text-[10px] font-mono flex items-center gap-1"
                      >
                        <Navigation className="w-3 h-3 text-cyan-400" /> Inspect
                      </button>
                    </div>

                    {topCand?.topological_override && (
                      <div className="p-1.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 font-mono text-[10px]">
                        Topological Override Active: Assigned to surface street (P={(topCand.snap_probability * 100).toFixed(1)}%) instead of naive nearest overpass!
                      </div>
                    )}

                    <p className="text-[11px] opacity-80">{item.narrative}</p>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'verified_canonical')}
                        className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 font-mono text-[10px] flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> Verify Canonical
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'rejected_false_alarm')}
                        className="px-2 py-1 rounded bg-rose-500/20 border border-rose-500/60 text-rose-300 font-mono text-[10px] flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" /> Reject False Alarm
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => handleReviewDecision(item.id, 'flagged_review')}
                        className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/60 text-amber-300 font-mono text-[10px] flex items-center gap-1"
                      >
                        <Flag className="w-3 h-3" /> Flag
                      </button>
                      {altCand && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            handleReviewDecision(
                              item.id,
                              item.verification_status,
                              altCand.segment_id,
                              altCand.linear_offset_m
                            )
                          }
                          className="px-2 py-1 rounded border border-slate-700 font-mono text-[10px] opacity-85 hover:opacity-100"
                        >
                          Snap Alt: {altCand.segment_name}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. Macro VGI Quality Diagnostics (US-3.3) */}
          {subTab === 'diagnostics' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 font-mono">
                <div className={cardCls}>
                  <div className="text-[10px] opacity-70">Mean Snap Drift</div>
                  <div className="text-base font-bold text-amber-400">{data.diagnostics.mean_positional_drift_m} m</div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] opacity-70">Median Lag</div>
                  <div className="text-base font-bold text-cyan-400">{data.diagnostics.median_reporting_lag_min} min</div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] opacity-70">Topo Overrides</div>
                  <div className="text-base font-bold text-emerald-400">{data.diagnostics.topological_override_count}</div>
                </div>
              </div>

              <div className={cardCls}>
                <div className="font-semibold mb-2">Positional Drift Distribution d⊥ (VGI Subset)</div>
                <div className="space-y-1.5 font-mono text-[11px]">
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
                <div className="font-semibold mb-2">Reporting Time Lag Histogram (Δt_lag)</div>
                <div className="space-y-1.5 font-mono text-[11px]">
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
                <div className="font-semibold mb-1.5">Dataset Provenance Separation</div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  {Object.entries(data.diagnostics.source_breakdown).map(([k, v]) => (
                    <div key={k} className="p-1.5 rounded bg-slate-950/60 border border-slate-800 flex justify-between">
                      <span>{k}</span>
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
              <div className="font-semibold">Immutable Stewardship &amp; Geocomputation Audit Trail</div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto font-mono text-[10.5px]">
                {data.diagnostics.audit_logs.map((log: any) => (
                  <div key={log.id} className="p-2 rounded bg-slate-950/70 border border-slate-800">
                    <div className="flex justify-between text-cyan-300">
                      <span>#{log.id} · {log.action_type}</span>
                      <span className="opacity-70">{log.created_at_utc}</span>
                    </div>
                    <div className="opacity-80">
                      Actor: {log.actor_name} ({log.actor_role}) → {log.entity_type} #{log.entity_id}
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
