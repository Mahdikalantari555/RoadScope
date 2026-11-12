"use client";

/** Legend + methodological disclosure shared by every analytical view. */

import React from "react";
import type { MapLayerPayload } from "@/lib/appState";
import { MicroLabel, Badge } from "@/components/ui";

export function Legend({ layer }: { layer: MapLayerPayload | null }) {
  if (!layer) return null;
  const { legend } = layer;
  return (
    <div className="border border-[var(--rule)] bg-[var(--panel)]/92 px-2.5 py-2 backdrop-blur-sm">
      <div className="micro mb-1.5 text-[var(--text-2)]">{legend.title}</div>
      {legend.ramp === "categorical" ? (
        <div className="flex flex-col gap-1">
          {legend.stops.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5" style={{ background: s.colour }} />
              <span className="text-[10px] text-[var(--text-2)]">{s.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            className="h-2 w-full border border-[var(--rule)]"
            style={{
              background: `linear-gradient(90deg, ${legend.stops.map((s) => s.colour).join(",")})`,
            }}
          />
          <div className="mt-1 flex justify-between">
            <span className="tnum text-[9px] text-[var(--text-3)]">{legend.stops[0]?.label}</span>
            <span className="tnum text-[9px] text-[var(--text-3)]">
              {legend.stops[legend.stops.length - 1]?.label}
            </span>
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[var(--text-3)]">{legend.unit}</div>
        </>
      )}
      {legend.note && (
        <p className="mt-1.5 border-t border-[var(--rule)] pt-1.5 text-[9px] leading-[1.5] text-[var(--text-3)]">
          {legend.note}
        </p>
      )}
    </div>
  );
}

export function MethodPanel({ layer }: { layer: MapLayerPayload | null }) {
  if (!layer) return null;
  const m = layer.method;
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Badge tone="cyan">Method</Badge>
        <span className="text-[11px] font-semibold text-[var(--text)]">{m.name}</span>
      </div>
      <div className="border border-[var(--rule)] bg-[var(--panel-2)] px-2 py-1.5">
        <div className="micro mb-1">Definition</div>
        <code className="font-[IBM_Plex_Mono,monospace] text-[10px] leading-relaxed break-words text-[var(--cyan)]">
          {m.formula}
        </code>
      </div>
      <p className="text-[10.5px] leading-[1.65] text-[var(--text-2)]">{m.explanation}</p>
      <div className="border-l-2 border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-2 py-1.5">
        <div className="micro mb-1 text-[var(--warn)]">Limitations</div>
        <p className="text-[10px] leading-[1.6] text-[var(--text-2)]">{m.caveat}</p>
      </div>
      <div>
        <MicroLabel>Parameters</MicroLabel>
        <div className="tnum mt-1 text-[9.5px] leading-relaxed text-[var(--text-3)]">{m.params}</div>
      </div>
    </div>
  );
}

export function DownloadButton({
  layer,
  filename,
}: {
  layer: MapLayerPayload | null;
  filename: string;
}) {
  if (!layer?.data) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob([JSON.stringify(layer.data, null, 2)], {
          type: "application/geo+json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="inline-flex h-7 items-center gap-1.5 border border-[var(--rule-strong)] px-2 text-[10px] uppercase tracking-[0.1em] text-[var(--text-2)] transition-colors hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
    >
      ↓ GeoJSON
    </button>
  );
}

export function StatRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--rule)] py-1">
      <span className="text-[10px] text-[var(--text-3)]">{label}</span>
      <span className="tnum text-[11px]" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}
