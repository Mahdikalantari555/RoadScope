"use client";

import { useEffect, useRef } from "react";
import type { EChartsOption, ECharts } from "echarts";

export interface ChartClick {
  name?: string;
  dataIndex?: number;
  seriesName?: string;
  value?: unknown;
}

/** Thin ECharts wrapper: lazy-loads the library, keeps the chart responsive, disposes on unmount. */
export default function EChart({ option, height = 220, onClick }: { option: EChartsOption; height?: number; onClick?: (p: ChartClick) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const clickRef = useRef(onClick);

  useEffect(() => {
    optionRef.current = option;
    clickRef.current = onClick;
    chartRef.current?.setOption(option, { notMerge: true });
  });

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      const echarts = await import("echarts");
      if (disposed || !ref.current) return;
      const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      chart.on("click", (p) => clickRef.current?.(p as unknown as ChartClick));
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(ref.current);
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={ref} style={{ height }} className="w-full min-w-0" />;
}

export const CHART_TEXT = "#8a96a8";
export const CHART_GRID = "rgba(138,150,168,0.14)";
export const CHART_AXIS = { axisLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_TEXT, fontSize: 10 }, splitLine: { lineStyle: { color: CHART_GRID } } };
export const CHART_TOOLTIP = {
  backgroundColor: "rgba(15,20,27,0.96)",
  borderColor: "#1f2834",
  textStyle: { color: "#e6ebf2", fontSize: 11 },
};
