import type { Statistics } from "./analytics";

export type ChartOption = Record<string, unknown>;

const tooltip = { trigger: "axis", axisPointer: { type: "shadow" } };
const axisLabel = { color: "#8b9bad", fontSize: 10 };
const axisLine = { lineStyle: { color: "rgba(139,155,173,0.35)" } };
const splitLine = { lineStyle: { color: "rgba(139,155,173,0.18)", type: "dashed" } };

const AXIS_X = { axisLabel, axisLine, axisTick: { show: false }, splitLine: { show: false } };
const AXIS_Y = { axisLabel, axisLine: { show: false }, axisTick: { show: false }, splitLine };

export function severityOption(stats: Statistics): ChartOption {
  const items = [...stats.bySeverity].reverse();
  return {
    tooltip: { ...tooltip, formatter: (params: { name: string; value: number }[]) => `${params[0].name}<br/><b>${params[0].value}</b> incidents` },
    grid: { left: 6, right: 34, top: 10, bottom: 4, containLabel: true },
    xAxis: { type: "value", ...AXIS_X },
    yAxis: { type: "category", data: items.map((i) => i.label), ...AXIS_X, axisLabel: { ...axisLabel, width: 92, overflow: "truncate" } },
    series: [
      {
        type: "bar",
        data: items.map((i) => ({ value: i.count, itemStyle: { color: i.color ?? "#7d8fa3" } })),
        barWidth: "58%",
        label: { show: true, position: "right", color: "#8b9bad", fontSize: 10, formatter: (p: { value: number }) => String(p.value) },
      },
    ],
  };
}

export function categoryOption(stats: Statistics): ChartOption {
  const items = stats.byCategory.slice(0, 8).reverse();
  return {
    tooltip: { ...tooltip, formatter: (p: { name: string; value: number }[]) => `${p[0].name}<br/><b>${p[0].value}</b> incidents` },
    grid: { left: 6, right: 30, top: 8, bottom: 4, containLabel: true },
    xAxis: { type: "value", ...AXIS_X },
    yAxis: { type: "category", data: items.map((i) => i.label), ...AXIS_X, axisLabel: { ...axisLabel, width: 106, overflow: "truncate" } },
    series: [
      {
        type: "bar",
        data: items.map((i) => ({ value: i.count, itemStyle: { color: i.color ?? "#2dd4bf" } })),
        barWidth: "58%",
        label: { show: true, position: "right", color: "#8b9bad", fontSize: 10 },
      },
    ],
  };
}

export function hourlyOption(stats: Statistics): ChartOption {
  return {
    tooltip,
    legend: { show: true, bottom: 0, textStyle: { color: "#8b9bad", fontSize: 9 }, itemWidth: 8, itemHeight: 8 },
    grid: { left: 6, right: 8, top: 10, bottom: 26, containLabel: true },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")), ...AXIS_X },
    yAxis: { type: "value", ...AXIS_Y },
    series: [
      { name: "PDO", type: "bar", stack: "s", data: stats.bySeverityAndHour.map((h) => h.pdo), itemStyle: { color: "#64748b" }, barWidth: "82%" },
      { name: "Slight", type: "bar", stack: "s", data: stats.bySeverityAndHour.map((h) => h.slight), itemStyle: { color: "#e3b341" } },
      { name: "Serious", type: "bar", stack: "s", data: stats.bySeverityAndHour.map((h) => h.serious), itemStyle: { color: "#f2762e" } },
      { name: "Fatal", type: "bar", stack: "s", data: stats.bySeverityAndHour.map((h) => h.fatal), itemStyle: { color: "#e5402a" } },
    ],
  };
}

export function dowOption(stats: Statistics): ChartOption {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    tooltip,
    grid: { left: 6, right: 8, top: 10, bottom: 4, containLabel: true },
    xAxis: { type: "category", data: labels, ...AXIS_X },
    yAxis: { type: "value", ...AXIS_Y },
    series: [
      {
        type: "bar",
        data: stats.byDow.map((value, index) => ({
          value,
          itemStyle: { color: index === 0 || index === 6 ? "#0e7490" : "#22d3ee" },
        })),
        barWidth: "55%",
      },
    ],
  };
}

export function monthlyOption(stats: Statistics): ChartOption {
  return {
    tooltip,
    legend: { show: true, top: 0, right: 0, textStyle: { color: "#8b9bad", fontSize: 9 }, itemWidth: 8, itemHeight: 8 },
    grid: { left: 4, right: 8, top: 22, bottom: 4, containLabel: true },
    xAxis: { type: "category", data: stats.byMonth.map((m) => m.label), ...AXIS_X, axisLabel: { ...axisLabel, interval: 3 } },
    yAxis: { type: "value", ...AXIS_Y },
    series: [
      {
        name: "Incidents",
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { color: "#22d3ee", width: 1.6 },
        areaStyle: { color: "rgba(34,211,238,0.14)" },
        data: stats.byMonth.map((m) => m.total),
      },
      {
        name: "KSI",
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { color: "#f2762e", width: 1.4, type: "dashed" },
        data: stats.byMonth.map((m) => m.ksi),
      },
    ],
  };
}

export function topSegmentsOption(stats: Statistics): ChartOption {
  const items = [...stats.topSegments].reverse();
  return {
    tooltip: {
      ...tooltip,
      formatter: (p: { dataIndex: number; value: number }[]) =>
        `${items[p[0].dataIndex]?.name ?? ""}<br/>Severity-weighted: <b>${p[0].value}</b><br/>Events: ${items[p[0].dataIndex]?.count ?? 0} · KSI ${items[p[0].dataIndex]?.ksi ?? 0}`,
    },
    grid: { left: 6, right: 30, top: 8, bottom: 4, containLabel: true },
    xAxis: { type: "value", ...AXIS_X },
    yAxis: { type: "category", data: items.map((s) => `${s.segmentId.replace("SEG-", "")} · ${s.name}`), ...AXIS_X, axisLabel: { ...axisLabel, width: 110, overflow: "truncate" } },
    series: [
      {
        type: "bar",
        data: items.map((s) => ({ value: Number(s.severityWeighted.toFixed(1)), itemStyle: { color: s.count >= 8 ? "#f2762e" : "#22d3ee" } })),
        barWidth: "62%",
      },
    ],
  };
}

export function environmentOption(stats: Statistics): ChartOption {
  const items = stats.environment.filter((e) => e.condition !== "unknown");
  return {
    tooltip,
    grid: { left: 6, right: 8, top: 10, bottom: 4, containLabel: true },
    xAxis: { type: "category", data: items.map((e) => e.label), ...AXIS_X, axisLabel: { ...axisLabel, interval: 0, rotate: 20 } },
    yAxis: { type: "value", ...AXIS_Y },
    series: [
      {
        type: "bar",
        data: items.map((e) => ({ value: e.count, itemStyle: { color: e.condition === "clear" ? "#e3b341" : e.condition === "cloudy" ? "#94a3b8" : "#3b82f6" } })),
        barWidth: "58%",
      },
    ],
  };
}

export function segmentDensityOption(stats: Statistics): ChartOption {
  const items = [...stats.topSegments].slice(0, 10).reverse();
  return {
    tooltip,
    grid: { left: 6, right: 10, top: 8, bottom: 4, containLabel: true },
    xAxis: { type: "value", ...AXIS_X },
    yAxis: { type: "category", data: items.map((s) => s.segmentId.replace("SEG-", "")), ...AXIS_X },
    series: [
      {
        type: "bar",
        data: items.map((s) => ({ value: Number(s.densityPerKm.toFixed(2)), itemStyle: { color: "#a78bfa" } })),
        barWidth: "55%",
      },
    ],
  };
}

export function comparisonOption(labels: string[], series: { name: string; data: number[]; color: string }[]): ChartOption {
  return {
    tooltip,
    legend: { show: true, bottom: 0, textStyle: { color: "#8b9bad", fontSize: 9 }, itemWidth: 8, itemHeight: 8 },
    grid: { left: 6, right: 8, top: 10, bottom: 24, containLabel: true },
    xAxis: { type: "category", data: labels, ...AXIS_X },
    yAxis: { type: "value", ...AXIS_Y },
    series: series.map((s) => ({ name: s.name, type: "bar", data: s.data, itemStyle: { color: s.color }, barWidth: "46%" })),
  };
}

export function heatMatrixOption(
  rows: string[],
  cols: string[],
  values: [number, number, number][],
  max: number,
): ChartOption {
  return {
    tooltip: { position: "top" },
    grid: { left: 6, right: 8, top: 6, bottom: 24, containLabel: true },
    xAxis: { type: "category", data: cols, ...AXIS_X, axisLabel: { ...axisLabel, interval: 1 } },
    yAxis: { type: "category", data: rows, ...AXIS_X },
    visualMap: {
      min: 0,
      max: Math.max(1, max),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 70,
      textStyle: { color: "#8b9bad", fontSize: 9 },
      inRange: { color: ["#0b1c2e", "#0e7490", "#22d3ee", "#e3b341", "#e5402a"] },
    },
    series: [{ type: "heatmap", data: values, progressive: 2000, itemStyle: { borderColor: "rgba(4,10,16,0.55)", borderWidth: 1 } }],
  };
}
