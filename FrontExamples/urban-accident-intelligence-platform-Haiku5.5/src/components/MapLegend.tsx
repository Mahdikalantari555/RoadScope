"use client";

import type { LegendSpec } from "./map-style";

/** Compact map legend rendered as an overlay card. */
export function MapLegend({ spec }: { spec: LegendSpec }) {
  return (
    <div className="pointer-events-auto w-64 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel/95 p-2.5 shadow-xl backdrop-blur">
      <div className="text-[11px] font-semibold tracking-tight">{spec.title}</div>
      {spec.items ? (
        <ul className="mt-1.5 grid gap-1">
          {spec.items.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-[11px] text-muted">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
              <span className="truncate">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {spec.gradient ? (
        <div className="mt-1.5">
          <div className="h-2 rounded-sm" style={{ background: `linear-gradient(90deg, ${spec.gradient.from}, ${spec.gradient.to})` }} />
          <div className="mt-0.5 text-[10.5px] text-muted">{spec.gradient.caption}</div>
        </div>
      ) : null}
      {spec.note ? <p className="mt-2 border-t border-line pt-1.5 text-[10.5px] leading-snug text-faint">{spec.note}</p> : null}
    </div>
  );
}
