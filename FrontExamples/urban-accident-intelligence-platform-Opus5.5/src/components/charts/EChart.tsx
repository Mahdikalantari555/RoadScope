"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useApp } from "../providers";

export type ChartOption = echarts.EChartsOption;
export interface ChartEvent {
  name?: string;
  dataIndex?: number;
  value?: unknown;
  seriesName?: string;
  data?: unknown;
  batch?: { startValue?: number; endValue?: number; start?: number; end?: number }[];
  startValue?: number;
  endValue?: number;
  start?: number;
  end?: number;
}

export function chartTheme(theme: "dark" | "light") {
  const dark = theme === "dark";
  return {
    text: dark ? "#9aa3b2" : "#5d6675",
    faint: dark ? "#6b7483" : "#8d95a3",
    grid: dark ? "#1f2630" : "#eceef2",
    axis: dark ? "#303947" : "#cdd2da",
    accent: dark ? "#4fd1c5" : "#0e7c74",
    tooltipBg: dark ? "#1a2029" : "#ffffff",
    tooltipBorder: dark ? "#303947" : "#cdd2da",
    fg: dark ? "#e6e9ee" : "#121620",
  };
}

/** Common axis/grid styling for analytical charts. */
export function baseOption(theme: "dark" | "light"): ChartOption {
  const t = chartTheme(theme);
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.text, fontFamily: "ui-sans-serif, system-ui", fontSize: 11 },
    grid: { left: 40, right: 12, top: 18, bottom: 26, containLabel: false },
    tooltip: { backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, textStyle: { color: t.fg, fontSize: 11 }, confine: true },
  };
}

export function axisStyle(theme: "dark" | "light") {
  const t = chartTheme(theme);
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.faint, fontSize: 10 },
    splitLine: { lineStyle: { color: t.grid } },
  };
}

export function EChart({ option, height = 200, onEvents, className }: { option: ChartOption; height?: number | string; onEvents?: Record<string, (e: ChartEvent) => void>; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { theme } = useApp();
  const handlers = useRef(onEvents);
  handlers.current = onEvents;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    const names = ["click", "datazoom", "brushSelected", "legendselectchanged"];
    names.forEach((n) => c.on(n, (e: unknown) => handlers.current?.[n]?.(e as ChartEvent)));
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [theme]);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option, theme]);

  return <div ref={el} className={className} style={{ height, width: "100%" }} />;
}
