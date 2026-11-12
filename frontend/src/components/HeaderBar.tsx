import React from 'react';
import { useLocale } from '../i18n';
import { ResearchAccess } from './ResearchAccess';
import {
  Activity,
  Compass,
  Database,
  FlaskConical,
  MapPinPlus,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  UserCheck,
} from 'lucide-react';
import type { DatasetSource, PersonaRole, PersonaUser, WorkspaceMode } from '../types/uai';

interface HeaderBarProps {
  activeWorkspace: WorkspaceMode;
  onSelectWorkspace: (mode: WorkspaceMode) => void;
  activeDataset: DatasetSource;
  datasets: DatasetSource[];
  onSwitchDataset: (id: number) => void;
  activeRole: PersonaRole;
  personas: PersonaUser[];
  onSwitchRole: (role: PersonaRole) => void;
  darkMode: boolean;
  onToggleTheme: () => void;
}

const WORKSPACE_TABS: { mode: WorkspaceMode; label: string; short: string; icon: React.ReactNode }[] = [
  { mode: 'analytics', label: 'CMV Analytics', short: 'Epic 6', icon: <Activity className="w-3.5 h-3.5" /> },
  { mode: 'spatial_lab', label: 'Spatial Lab', short: 'NKDE · Gi* · DBSCAN', icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { mode: 'risk_eb', label: 'Risk & EB', short: 'SPF · PSI · Bivariate', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { mode: 'citizen_vgi', label: 'Citizen VGI', short: 'Report & Conflate', icon: <MapPinPlus className="w-3.5 h-3.5" /> },
  { mode: 'stewardship', label: 'Stewardship QA', short: 'Snap · Merge · RBAC', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  { mode: 'simulator', label: 'Simulator', short: 'Cox-Poisson LRS', icon: <Sparkles className="w-3.5 h-3.5" /> },
];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeWorkspace,
  onSelectWorkspace,
  activeDataset,
  datasets,
  onSwitchDataset,
  activeRole,
  personas,
  onSwitchRole,
  darkMode,
  onToggleTheme,
}) => {
  const { t, locale, setLocale } = useLocale();
  return (
    <header
      className={`border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2 select-none ${
        darkMode
          ? 'bg-slate-950/95 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      {/* Left: Brand + CRS + Synthetic Badge */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
          <Compass className="w-4 h-4" />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-xs sm:text-sm">
              RoadScope
            </span>
            {activeDataset.is_synthetic && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                {t('synthetic')} <bdi>{new Intl.NumberFormat(locale).format(activeDataset.random_seed)}</bdi>
              </span>
            )}
            <span
              className={`hidden 2xl:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border ${
                darkMode
                  ? 'bg-slate-900 border-slate-700 text-cyan-300'
                  : 'bg-slate-100 border-slate-300 text-cyan-800'
              }`}
            >
              EPSG:{activeDataset.crs_epsg} · Lixel {activeDataset.lixel_resolution_m}m
            </span>
          </div>
        </div>
      </div>

      {/* Center: 6 Scientific Workspaces */}
      <nav className="flex items-center gap-1 flex-wrap">
        {WORKSPACE_TABS.map((tab) => {
          const active = activeWorkspace === tab.mode;
          return (
            <button
              key={tab.mode}
              onClick={() => onSelectWorkspace(tab.mode)}
              aria-pressed={active}
              className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 border ${
                active
                  ? darkMode
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-sm'
                    : 'bg-cyan-600 border-cyan-700 text-white shadow-sm'
                  : darkMode
                  ? 'bg-slate-900/70 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.icon}
              <span>{t(tab.mode)}</span>
              <span
                className={`hidden 2xl:inline text-[10px] font-mono ${
                  active ? (darkMode ? 'text-cyan-300/80' : 'text-cyan-100') : 'opacity-60'
                }`}
              >
                · {tab.short}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Right: Dataset Selector + Persona RBAC + Theme Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <select aria-label={t('language')} value={locale} onChange={e => setLocale(e.target.value as 'en' | 'fa')} className="bg-slate-900 text-white border rounded p-1 text-xs">
          <option value="en">English</option><option value="fa">فارسی</option>
        </select>
        <ResearchAccess />
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded border text-xs ${
            darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-300'
          }`}
          title={t('dataset')}
        >
          <Database className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <select
            aria-label={t('dataset')}
            value={activeDataset.id}
            onChange={(e) => onSwitchDataset(Number(e.target.value))}
            className={`bg-transparent text-xs font-mono max-w-[190px] truncate focus:outline-none ${
              darkMode ? 'text-slate-200' : 'text-slate-800'
            }`}
          >
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id} className="bg-slate-900 text-slate-100">
                #{ds.id} {ds.scenario_key} ({ds.lixel_resolution_m}m)
              </option>
            ))}
          </select>
        </div>

        <div
          className={`flex items-center gap-1 px-2 py-1 rounded border text-xs ${
            darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-300'
          }`}
          title={t('persona')}
        >
          <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <select
            aria-label={t('persona')}
            value={activeRole}
            onChange={(e) => onSwitchRole(e.target.value as PersonaRole)}
            className={`bg-transparent text-xs font-mono max-w-[165px] truncate focus:outline-none ${
              darkMode ? 'text-slate-200' : 'text-slate-800'
            }`}
          >
            {personas.map((p) => (
              <option key={p.role + p.id} value={p.role} className="bg-slate-900 text-slate-100">
                Role: {p.role.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={onToggleTheme}
          title={t('theme')} aria-label={t('theme')}
          className={`p-1.5 rounded border transition-colors ${
            darkMode
              ? 'bg-slate-900 border-slate-800 text-amber-300 hover:bg-slate-800'
              : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};
