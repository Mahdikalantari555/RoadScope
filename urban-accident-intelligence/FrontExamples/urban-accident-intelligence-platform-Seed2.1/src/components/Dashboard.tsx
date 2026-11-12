"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell,
  Legend, ScatterChart, Scatter, ZAxis,
} from "recharts";
import { useAppStore } from "@/lib/store";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Dashboard() {
  const summary = useAppStore(s => s.summary);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!summary) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Run a simulation to populate the analytics dashboard.
      </div>
    );
  }

  const hourData = Array.from({ length: 24 }, (_, h) => {
    const found = summary.byHour.find(r => r.hour === h);
    return { hour: h, count: found?.count ?? 0 };
  });

  const dowData = DOW_LABELS.map((label, dow) => {
    const found = summary.byDow.find(r => r.dow === dow);
    return { dow: label, count: found?.count ?? 0 };
  });

  const weatherData = summary.byWeather.map(w => ({ name: w.label, value: w.count }));
  const roadClassData = summary.byRoadClass.map(r => ({
    name: r.label,
    count: r.count,
    density: r.totalKm > 0 ? +(r.count / r.totalKm).toFixed(2) : 0,
  }));

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] border-l border-[var(--border)] overflow-y-auto">
      <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
        <div>
          <div className="text-xs font-bold tracking-wide text-cyan-400 uppercase">
            Coordinated Analytics
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Brushing + cross-filtering (select on map → filters charts)
          </div>
        </div>
        <div className="flex gap-1">
          <div className="badge badge-accent">
            {summary.dataset?.scenario ?? "synthetic"}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2">
          <MiniKPI label="Verified" value={summary.totals.verified} color="#10b981" />
          <MiniKPI label="Raw VGI" value={summary.totals.rawVgi} color="#f97316" />
          <MiniKPI label="False Alarms" value={summary.totals.falseAlarms} color="#ef4444" />
          <MiniKPI label="Total Records" value={summary.totals.total} color="#38bdf8" />
        </div>

        <DashSection title="Diurnal Distribution (Hour of Day)" collapsed={collapsed.hour} onToggle={() => setCollapsed(p => ({ ...p, hour: !p.hour }))}>
          {!collapsed.hour && (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={hourData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="2,4" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Line type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </DashSection>

        <DashSection title="Day-of-Week Distribution" collapsed={collapsed.dow} onToggle={() => setCollapsed(p => ({ ...p, dow: !p.dow }))}>
          {!collapsed.dow && (
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={dowData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="2,4" />
                <XAxis dataKey="dow" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Bar dataKey="count" fill="#0ea5e9" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </DashSection>

        <div className="grid grid-cols-2 gap-2">
          <DashSection title="Weather">
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie data={weatherData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={35} innerRadius={18} fontSize={9}>
                  {weatherData.map((_, i) => (
                    <Cell key={i} fill={["#38bdf8", "#64748b", "#a78bfa", "#f3f4f6"][i % 4]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
              </PieChart>
            </ResponsiveContainer>
          </DashSection>

          <DashSection title="Road Class Density">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={roadClassData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }} layout="vertical">
                <CartesianGrid stroke="#334155" strokeDasharray="2,4" />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} width={60} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Bar dataKey="density" fill="#f97316" radius={[0,2,2,0]} />
              </BarChart>
            </ResponsiveContainer>
          </DashSection>
        </div>

        <DashSection title="Reporting Lag Histogram (minutes)" collapsed={collapsed.lag} onToggle={() => setCollapsed(p => ({ ...p, lag: !p.lag }))}>
          {!collapsed.lag && (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={summary.lagHistogram.map(l => ({ bin: l.bucket * 10, count: l.count }))} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="2,4" />
                <XAxis dataKey="bin" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Bar dataKey="count" fill="#a78bfa" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </DashSection>

        <DashSection title="Snap Distance Distribution (meters)" collapsed={collapsed.snap} onToggle={() => setCollapsed(p => ({ ...p, snap: !p.snap }))}>
          {!collapsed.snap && (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={summary.snapHistogram.map(l => ({ bin: l.bucket * 10, count: l.count }))} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="2,4" />
                <XAxis dataKey="bin" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", fontSize: 11 }} />
                <Bar dataKey="count" fill="#10b981" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </DashSection>
      </div>
    </div>
  );
}

function DashSection({ title, children, collapsed, onToggle }: {
  title: string; children?: React.ReactNode; collapsed?: boolean; onToggle?: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel-header cursor-pointer" onClick={onToggle}>
        <span>{title}</span>
        <span className="text-slate-500">{collapsed ? "+" : "−"}</span>
      </div>
      {children && <div className="p-1">{children}</div>}
    </div>
  );
}

function MiniKPI({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel p-2 text-center">
      <div className="text-lg font-bold" style={{ color }}>{value.toLocaleString()}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
