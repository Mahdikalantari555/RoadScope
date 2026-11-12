import React from 'react';
import type { CureDiagnostic } from '../types/uai';

export const CureChart: React.FC<{ diagnostic: CureDiagnostic }> = ({ diagnostic }) => {
  const points = diagnostic.points;
  if (diagnostic.status !== 'ok' || points.length < 2) {
    return <p className="text-xs opacity-75">CURE unavailable: at least two distinct AADT values are required.</p>;
  }
  const xmin = points[0].aadt, xmax = points[points.length - 1].aadt;
  const absMax = Math.max(1, ...points.map(p => Math.max(Math.abs(p.lower), Math.abs(p.upper), Math.abs(p.cumulative_residual))));
  const x = (a: number) => 42 + ((a - xmin) / (xmax - xmin)) * 330;
  const y = (v: number) => 75 - (v / absMax) * 60;
  const path = (field: 'upper' | 'lower' | 'cumulative_residual') => points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.aadt).toFixed(2)} ${y(p[field]).toFixed(2)}`).join(' ');
  return (
    <div>
      <h4 className="font-semibold">CURE diagnostic by AADT</h4>
      <p className="text-[11px] opacity-75 mt-1">Legacy SPF; cumulative observed minus expected crashes. {diagnostic.imputed_aadt_count} of {diagnostic.sample_size} segments use imputed or fallback AADT.</p>
      <svg viewBox="0 0 400 155" className="w-full mt-2" role="img" aria-label="Cumulative residual by AADT with approximate pointwise envelope">
        <line x1="42" x2="372" y1="75" y2="75" stroke="currentColor" opacity="0.4" />
        <path d={path('upper')} stroke="#fbbf24" strokeDasharray="4 3" fill="none" />
        <path d={path('lower')} stroke="#fbbf24" strokeDasharray="4 3" fill="none" />
        <path d={path('cumulative_residual')} stroke="#22d3ee" strokeWidth="2" fill="none" />
        <text x="42" y="150" fill="currentColor" fontSize="10">{xmin.toLocaleString()} AADT</text>
        <text x="290" y="150" fill="currentColor" fontSize="10">{xmax.toLocaleString()} AADT</text>
        <text x="5" y="78" fill="currentColor" fontSize="10">0</text>
      </svg>
      <p className="text-[11px] opacity-75">Dashed: {diagnostic.envelope}. {diagnostic.assumptions}</p>
      <details className="mt-2 text-[11px]"><summary className="cursor-pointer">View diagnostic values</summary>
        <div className="overflow-auto max-h-48"><table className="w-full tabular-nums text-left"><thead><tr><th>AADT</th><th>Segments</th><th>Residual</th><th>Lower</th><th>Upper</th></tr></thead><tbody>
          {points.map(p => <tr key={p.aadt}><td>{p.aadt.toLocaleString()}</td><td>{p.segment_count}</td><td>{p.cumulative_residual.toFixed(2)}</td><td>{p.lower.toFixed(2)}</td><td>{p.upper.toFixed(2)}</td></tr>)}
        </tbody></table></div>
      </details>
    </div>
  );
};
