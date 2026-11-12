import React from 'react';

interface CurvePoint {
  coverage: number;
  realized_coverage: number;
  capture: number | null;
  pai: number | null;
}
interface PaiCurve {
  status: string;
  au_pai: number | null;
  points: CurvePoint[];
}

/** Synthetic expected-intensity diagnostic, not a held-out model comparison. */
export const PaiCurveChart: React.FC<{ network: PaiCurve; planar: PaiCurve }> = ({ network, planar }) => {
  if (network.status !== 'ok' || planar.status !== 'ok') {
    return <p className="mt-3 text-xs opacity-75">PAI curve unavailable: synthetic ground truth has no event mass.</p>;
  }
  const all = [...network.points, ...planar.points].filter(p => p.pai !== null);
  const ymax = Math.max(1, ...all.map(p => p.pai ?? 0));
  const x = (a: number) => 35 + a * 350;
  const y = (v: number) => 120 - (v / ymax) * 100;
  const path = (points: CurvePoint[]) => points.filter(p => p.pai !== null)
    .map((p, i) => `${i ? 'L' : 'M'} ${x(p.coverage).toFixed(2)} ${y(p.pai!).toFixed(2)}`).join(' ');
  return (
    <div className="mt-4 border-t border-slate-700 pt-3">
      <h4 className="font-semibold">PAI by network-length coverage</h4>
      <p className="mt-1 text-[11px] opacity-75">Synthetic expected intensity, evaluated in-sample; not held-out predictive performance. Equal scores and boundary lixels are allocated fractionally by length.</p>
      <svg viewBox="0 0 400 145" className="mt-2 w-full" role="img" aria-label="PAI versus network-length coverage, comparing network and planar KDE">
        <line x1="35" y1="120" x2="385" y2="120" stroke="currentColor" opacity="0.4" />
        <line x1="35" y1={y(1)} x2="385" y2={y(1)} stroke="currentColor" opacity="0.4" strokeDasharray="4 3" />
        <path d={path(network.points)} fill="none" stroke="#22d3ee" strokeWidth="2" />
        <path d={path(planar.points)} fill="none" stroke="#fbbf24" strokeWidth="2" />
        <text x="35" y="138" fill="currentColor" fontSize="10">0%</text>
        <text x="356" y="138" fill="currentColor" fontSize="10">100%</text>
        <text x="2" y={y(1) + 3} fill="currentColor" fontSize="10">1</text>
      </svg>
      <p className="text-[11px]">AU-PAI (random-ranking baseline = 1): <span className="text-cyan-400">network {network.au_pai?.toFixed(3)}</span> · <span className="text-amber-400">planar {planar.au_pai?.toFixed(3)}</span></p>
      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer">View curve values</summary>
        <table className="w-full mt-1 tabular-nums">
          <thead><tr><th className="text-left">Coverage</th><th className="text-right">Network PAI / capture</th><th className="text-right">Planar PAI / capture</th></tr></thead>
          <tbody>{network.points.map((point, i) => {
            const other = planar.points[i];
            return <tr key={point.coverage}><td>{(point.coverage * 100).toFixed(0)}%</td><td className="text-right">{point.pai?.toFixed(2) ?? '—'} / {((point.capture ?? 0) * 100).toFixed(1)}%</td><td className="text-right">{other?.pai?.toFixed(2) ?? '—'} / {((other?.capture ?? 0) * 100).toFixed(1)}%</td></tr>;
          })}</tbody>
        </table>
      </details>
    </div>
  );
};
