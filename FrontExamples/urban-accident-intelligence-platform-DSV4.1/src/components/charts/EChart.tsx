"use client";

import { useEffect, useRef } from "react";
import type { EChartsCoreOption } from "echarts/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, HeatmapChart, ScatterChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  DatasetComponent,
  MarkLineComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  ScatterChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  DatasetComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

let themeVersion = 0;

export type ChartClickEvent = { name?: string; data?: unknown; value?: unknown; seriesName?: string };

export function EChart({
  option,
  height = 200,
  onChartClick,
  className = "",
}: {
  option: EChartsCoreOption;
  height?: number | string;
  onChartClick?: (event: ChartClickEvent) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onChartClick);
  clickRef.current = onChartClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const handleClick = (params: unknown) => {
      clickRef.current?.(params as ChartClickEvent);
    };
    chart.on("click", handleClick);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    const themeHandler = () => {
      themeVersion += 1;
      chart.resize();
    };
    window.addEventListener("uai-theme-change", themeHandler);
    return () => {
      window.removeEventListener("uai-theme-change", themeHandler);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const css = getComputedStyle(document.documentElement);
    const theme = {
      ink: css.getPropertyValue("--ink").trim() || "#e7eef6",
      muted: css.getPropertyValue("--muted").trim() || "#93a5b8",
      faint: css.getPropertyValue("--faint").trim() || "#63788e",
      line: css.getPropertyValue("--line").trim() || "#1a2634",
      panel: css.getPropertyValue("--panel").trim() || "#0b131c",
      accent: css.getPropertyValue("--accent").trim() || "#2dd4bf",
    };
    chart.setOption(
      {
        backgroundColor: "transparent",
        textStyle: { color: theme.ink, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
        tooltip: {
          backgroundColor: theme.panel,
          borderColor: theme.line,
          borderWidth: 1,
          textStyle: { color: theme.ink, fontSize: 11 },
          extraCssText: "box-shadow:0 10px 24px rgba(0,0,0,.35);border-radius:3px;",
        },
        animationDuration: 260,
        ...option,
      } as EChartsCoreOption,
      true,
    );
  }, [option]);

  return <div ref={containerRef} className={className} style={{ width: "100%", height }} />;
}
