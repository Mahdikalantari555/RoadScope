import React, { createContext, useContext, useEffect, useState } from 'react';

export type Language = 'en' | 'fa';
const STORAGE_KEY = 'roadscope.language';

const messages = {
  en: {
    language: 'Language', english: 'English', persian: 'فارسی',
    analytics: 'CMV Analytics', spatial_lab: 'Spatial Lab', risk_eb: 'Risk & EB',
    citizen_vgi: 'Citizen VGI', stewardship: 'Stewardship QA', simulator: 'Simulator',
    analyticsDetail: 'Coordinated views', labDetail: 'NKDE · Gi* · DBSCAN', riskDetail: 'SPF · PSI · Bivariate',
    citizenDetail: 'Report & Conflate', stewardDetail: 'Snap · Merge · QA', simulatorDetail: 'Cox-Poisson LRS',
    synthetic: 'Synthetic', seed: 'Seed', dataset: 'Active spatial dataset', persona: 'Demonstration persona (not authentication)',
    themeLight: 'Switch to light theme', themeDark: 'Switch to dark theme',
    initializationError: 'Platform initialization error', initializing: 'Initializing RoadScope spatial engine (EPSG:25832)...',
    partialTranslation: 'Persian translation is in progress. Some workspace content remains in English.',
    mobility_analyst: 'Mobility analyst', gis_researcher: 'GIS researcher', safety_engineer: 'Safety engineer',
    citizen_reporter: 'Citizen reporter', data_steward: 'Data steward', simulation_scientist: 'Simulation scientist',
  },
  fa: {
    language: 'زبان', english: 'English', persian: 'فارسی',
    analytics: 'تحلیل هماهنگ', spatial_lab: 'آزمایشگاه مکانی', risk_eb: 'ریسک و بیز تجربی',
    citizen_vgi: 'گزارش شهروندی', stewardship: 'بررسی داده‌ها', simulator: 'شبیه‌ساز',
    analyticsDetail: 'نماهای هماهنگ', labDetail: 'NKDE · Gi* · DBSCAN', riskDetail: 'SPF · PSI · دومتغیره',
    citizenDetail: 'گزارش و تطبیق', stewardDetail: 'نگاشت و بررسی', simulatorDetail: 'Cox-Poisson LRS',
    synthetic: 'مصنوعی', seed: 'بذر', dataset: 'مجموعه‌دادهٔ فعال', persona: 'نقش نمایشی (بدون احراز هویت)',
    themeLight: 'تغییر به پوستهٔ روشن', themeDark: 'تغییر به پوستهٔ تیره',
    initializationError: 'خطا در راه‌اندازی سامانه', initializing: 'در حال راه‌اندازی موتور مکانی RoadScope (EPSG:25832)...',
    partialTranslation: 'ترجمهٔ فارسی در حال تکمیل است؛ بخشی از فضای کاری هنوز انگلیسی است.',
    mobility_analyst: 'تحلیلگر جابه‌جایی', gis_researcher: 'پژوهشگر GIS', safety_engineer: 'مهندس ایمنی',
    citizen_reporter: 'گزارشگر شهروند', data_steward: 'متولی داده', simulation_scientist: 'پژوهشگر شبیه‌سازی',
  },
} as const;

export type MessageKey = keyof typeof messages.en;
type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: MessageKey) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === 'fa' ? 'fa' : 'en'; }
  catch { return 'en'; }
}

export const LanguageProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* storage can be blocked */ }
  }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage, t: key => messages[language][key] }}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
