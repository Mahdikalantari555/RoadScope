"use client";

/** Apache ECharts wrappers. Canvas renderer, theme-aware, click-linked. */

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";

export interface ChartTheme {
  text: string;
  textDim: string;
  rule: string;
  panel: string;
  amber: string;
  cyan: string;
  fatal: string;
  serious: string;
  slight: string;
  damage: string;
}

export const chartTheme = (dark: boolean): ChartTheme =>
  dark
    ? {
        text: "#e6edf2",
        textDim: "#8fa3af",
        rule: "#1d252c",
        panel: "#12171c",
        amber: "#f2a03d",
        cyan: "#4fd1c5",
        fatal: "#e5484d",
        serious: "#f2762e",
        slight: "#f2a03d",
        damage: "#6e9bc5",
      }
    : {
        text: "#16191c",
        textDim: "#5c6670",
        rule: "#dcd5c8",
        panel: "#ffffff",
        amber: "#b9722a",
        cyan: "#1f8f86",
        fatal: "#c62c30",
        serious: "#d1611f",
        slight: "#b9722a",
        damage: "#3c6fa5",
      };

export function Chart({
  option,
  height = 180,
  onEvents,
}: {
  option: echarts.EChartsOption;
  height?: number;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inst.current) return;
    inst.current.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = inst.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents).map(([k, fn]) => {
      const handler = fn as (p: unknown) => void;
      chart.on(k, handler);
      return [k, handler] as const;
    });
    return () => entries.forEach(([k, h]) => chart.off(k, h));
  }, [onEvents]);

  return <div ref={ref} style={{ height, width: "100%" }} />;
}

// --- option builders -------------------------------------------------------

const axisBase = (t: ChartTheme) => ({
  axisLine: { lineStyle: { color: t.rule } },
  axisTick: { show: false },
  axisLabel: { color: t.textDim, fontSize: 9, fontFamily: "IBM Plex Mono" },
  splitLine: { lineStyle: { color: t.rule, type: "dashed" as const } },
});

export function severityDonut(
  data: { name: string; value: number; colour: string }[],
  t: ChartTheme,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
      formatter: (p: unknown) => {
        const d = p as { name: string; value: number; percent?: number };
        return `${d.name}<br/><b>${d.value}</b> reports · ${d.percent ?? 0}%`;
      },
    },
    legend: {
      orient: "vertical",
      right: 4,
      top: "center",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: t.textDim, fontSize: 10, fontFamily: "IBM Plex Mono" },
    },
    series: [
      {
        type: "pie",
        radius: ["52%", "78%"],
        center: ["32%", "50%"],
        avoidLabelOverlap: true,
        label: { show: false },
        itemStyle: { borderColor: t.panel, borderWidth: 1 },
        emphasis: { scaleSize: 4 },
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.colour },
        })),
      },
    ],
  };
}

export function hourlyBars(
  hours: { hour: number; count: number; verified: number }[],
  t: ChartTheme,
  onHour?: (h: number) => void,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    grid: { left: 32, right: 8, top: 12, bottom: 22 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: hours.map((h) => String(h.hour).padStart(2, "0")),
      ...axisBase(t),
      axisLabel: { color: t.textDim, fontSize: 8, fontFamily: "IBM Plex Mono", interval: 2 },
    },
    yAxis: { type: "value", ...axisBase(t) },
    series: [
      {
        name: "All reports",
        type: "bar",
        data: hours.map((h) => h.count),
        itemStyle: { color: t.amber, opacity: 0.42 },
        barWidth: "68%",
      },
      {
        name: "Verified",
        type: "bar",
        data: hours.map((h) => h.verified),
        itemStyle: { color: t.amber },
        barWidth: "68%",
      },
    ],
  };
}

export function dayOfWeekBars(
  days: { label: string; count: number }[],
  t: ChartTheme,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    grid: { left: 32, right: 8, top: 12, bottom: 20 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: { type: "category", data: days.map((d) => d.label), ...axisBase(t) },
    yAxis: { type: "value", ...axisBase(t) },
    series: [
      {
        type: "bar",
        data: days.map((d) => d.count),
        itemStyle: { color: t.cyan, opacity: 0.85 },
        barWidth: "58%",
      },
    ],
  };
}

export function monthlyTrend(
  months: { month: string; count: number; verified: number; serious: number }[],
  t: ChartTheme,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    grid: { left: 34, right: 10, top: 16, bottom: 24 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: { type: "category", data: months.map((m) => m.month), ...axisBase(t) },
    yAxis: { type: "value", ...axisBase(t) },
    series: [
      {
        name: "All reports",
        type: "line",
        data: months.map((m) => m.count),
        smooth: 0.25,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: t.amber, width: 1.6 },
        itemStyle: { color: t.amber },
        areaStyle: { color: t.amber, opacity: 0.1 },
      },
      {
        name: "Verified",
        type: "line",
        data: months.map((m) => m.verified),
        smooth: 0.25,
        symbol: "none",
        lineStyle: { color: t.cyan, width: 1.2, type: "dashed" },
      },
      {
        name: "Killed or seriously injured",
        type: "line",
        data: months.map((m) => m.serious),
        smooth: 0.25,
        symbol: "none",
        lineStyle: { color: t.fatal, width: 1.2 },
      },
    ],
  };
}

export function categoryBars(
  data: { label: string; count: number; group: string }[],
  t: ChartTheme,
  onCategory?: (code: string) => void,
): echarts.EChartsOption {
  const sorted = [...data].reverse();
  return {
    backgroundColor: "transparent",
    grid: { left: 108, right: 26, top: 6, bottom: 18 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: { type: "value", ...axisBase(t), splitLine: { lineStyle: { color: t.rule, type: "dashed" } } },
    yAxis: {
      type: "category",
      data: sorted.map((d) => d.label),
      ...axisBase(t),
      axisLabel: { color: t.textDim, fontSize: 9, fontFamily: "IBM Plex Mono" },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((d) => d.count),
        barWidth: "62%",
        itemStyle: { color: t.amber, opacity: 0.82 },
        label: {
          show: true,
          position: "right",
          color: t.textDim,
          fontSize: 9,
          fontFamily: "IBM Plex Mono",
        },
      },
    ],
  };
}

export function simpleBars(
  data: { label: string; value: number }[],
  t: ChartTheme,
  colour: string,
  horizontal = false,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    grid: { left: horizontal ? 74 : 30, right: 22, top: 8, bottom: 18 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.panel,
      borderColor: t.rule,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: horizontal
      ? { type: "value", ...axisBase(t) }
      : { type: "category", data: data.map((d) => d.label), ...axisBase(t) },
    yAxis: horizontal
      ? {
          type: "category",
          data: data.map((d) => d.label),
          ...axisBase(t),
          splitLine: { show: false },
        }
      : { type: "value", ...axisBase(t) },
    series: [
      {
        type: "bar",
        data: data.map((d) => d.value),
        barWidth: horizontal ? "58%" : "62%",
        itemStyle: { color: colour, opacity: 0.85 },
        label: horizontal
          ? { show: true, position: "right", color: t.textDim, fontSize: 9, fontFamily: "IBM Plex Mono" }
          : { show: false },
      },
    ],
  };
}
