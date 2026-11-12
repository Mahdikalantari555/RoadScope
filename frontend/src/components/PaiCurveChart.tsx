import React from 'react';
import { useLanguage } from '../i18n';
import { getMapChartsText } from '../workspaceI18n';

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
  const { language } = useLanguage();
  const copy = getMapChartsText(language);

  if (network.status !== 'ok' || planar.status !== 'ok') {
    return <p className="mt-3 text-xs opacity-75">{copy.paiUnavailable}</p>;
  }
  const all = [...network.points, ...planar.points].filter((p) => p.pai !== null);
  const ymax = Math.max(1, ...all.map((p) => p.pai ?? 0));
  const x = (a: number) => 35 + a * 350;
  const y = (v: number) => 120 - (v / ymax) * 100;
  const path = (points: CurvePoint[]) =>
    points
      .filter((p) => p.pai !== null)
      .map((p, i) => `${i ? 'L' : 'M'} ${x(p.coverage).toFixed(2)} ${y(p.pai!).toFixed(2)}`)
      .join(' ');

  return (
    <div className="mt-4 border-t border-slate-700 pt-3">
      <h4 className="font-semibold">{copy.paiTitle}</h4>
      <p className="mt-1 text-[11px] opacity-75">{copy.paiSubtitle}</p>
      <div dir="ltr">
        <svg
          viewBox="0 0 400 145"
          className="mt-2 w-full"
          role="img"
          aria-label={copy.paiTitle}
        >
          <line x1="35" y1="120" x2="385" y2="120" stroke="currentColor" opacity="0.4" />
          <line x1="35" y1={y(1)} x2="385" y2={y(1)} stroke="currentColor" opacity="0.4" strokeDasharray="4 3" />
          <path d={path(network.points)} fill="none" stroke="#22d3ee" strokeWidth="2" />
          <path d={path(planar.points)} fill="none" stroke="#fbbf24" strokeWidth="2" />
          <text x="35" y="138" fill="currentColor" fontSize="10">
            0%
          </text>
          <text x="356" y="138" fill="currentColor" fontSize="10">
            100%
          </text>
          <text x="2" y={y(1) + 3} fill="currentColor" fontSize="10">
            1
          </text>
        </svg>
      </div>
      <p className="text-[11px]" dir="ltr">
        AU-PAI (baseline = 1): <span className="text-cyan-400">NKDE {network.au_pai?.toFixed(3)}</span> ·{' '}
        <span className="text-amber-400">Planar {planar.au_pai?.toFixed(3)}</span>
      </p>
      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer">{copy.paiViewValues}</summary>
        <table dir="ltr" className="w-full mt-1 tabular-nums font-mono">
          <thead>
            <tr>
              <th className="text-left">{copy.coverage}</th>
              <th className="text-right">NKDE PAI / Capture</th>
              <th className="text-right">Planar PAI / Capture</th>
            </tr>
          </thead>
          <tbody>
            {network.points.map((point, i) => {
              const other = planar.points[i];
              return (
                <tr key={point.coverage}>
                  <td>{(point.coverage * 100).toFixed(0)}%</td>
                  <td className="text-right">
                    {point.pai?.toFixed(2) ?? '—'} / {((point.capture ?? 0) * 100).toFixed(1)}%
                  </td>
                  <td className="text-right">
                    {other?.pai?.toFixed(2) ?? '—'} / {((other?.capture ?? 0) * 100).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
};
