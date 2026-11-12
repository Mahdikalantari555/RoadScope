import React, { createContext, useContext, useEffect, useState } from 'react';

export type Language = 'en' | 'fa';
export type Locale = Language;
const STORAGE_KEY = 'roadscope.language';

export const en = {
  language: 'Language',
  english: 'English',
  persian: 'فارسی',
  analytics: 'CMV Analytics',
  spatial_lab: 'Spatial Lab',
  risk_eb: 'Risk & EB',
  citizen_vgi: 'Citizen VGI',
  stewardship: 'Stewardship QA',
  simulator: 'Simulator',
  analyticsDetail: 'Coordinated views',
  labDetail: 'NKDE · TNKDE · Gi*',
  riskDetail: 'SPF · PSI · EVPI',
  citizenDetail: 'Report & Conflate',
  stewardDetail: 'Snap · Merge · QA',
  simulatorDetail: 'Cox-Poisson · Hawkes',
  synthetic: 'Synthetic',
  seed: 'Seed',
  dataset: 'Active spatial dataset',
  persona: 'Demonstration persona (not authentication)',
  theme: 'Toggle theme',
  themeLight: 'Switch to light theme',
  themeDark: 'Switch to dark theme',
  loading: 'Initializing RoadScope spatial engine…',
  initializing: 'Initializing RoadScope spatial engine...',
  error: 'Platform initialization failed',
  initializationError: 'Platform initialization error',
  retry: 'Try again',
  analyticsLoadError: 'Could not load analytics',
  noWebgl: 'WebGL is unavailable. The non-map workspaces remain accessible.',
  research: 'Research availability & access',
  close: 'Close',
  available: 'Available research APIs',
  unavailable: 'Unavailable models',
  primitives: 'Library primitives only (no workspace integration)',
  notice:
    'Research prototype. Synthetic benchmark outputs are not evidence of real-world crash risk; unvalidated spatial random-effect and deep models remain gated.',
  token: 'API bearer token (kept in memory only)',
  save: 'Use token',
  clear: 'Clear token',
  auth: 'The server determines permissions. Selecting a persona does not authenticate you.',
  failed: 'Could not load research availability.',
  mobility_analyst: 'Mobility analyst',
  gis_researcher: 'GIS researcher',
  safety_engineer: 'Safety engineer',
  citizen_reporter: 'Citizen reporter',
  data_steward: 'Data steward',
  simulation_scientist: 'Simulation scientist',
};

export const fa: Record<keyof typeof en, string> = {
  language: 'زبان',
  english: 'English',
  persian: 'فارسی',
  analytics: 'تحلیل هماهنگ',
  spatial_lab: 'آزمایشگاه مکانی',
  risk_eb: 'ریسک و بیز تجربی',
  citizen_vgi: 'گزارش شهروندی',
  stewardship: 'کنترل کیفیت داده‌ها',
  simulator: 'شبیه‌ساز',
  analyticsDetail: 'نماهای هماهنگ',
  labDetail: 'NKDE · TNKDE · Gi*',
  riskDetail: 'SPF · PSI · EVPI',
  citizenDetail: 'گزارش و تطبیق',
  stewardDetail: 'نگاشت و بازبینی',
  simulatorDetail: 'Cox-Poisson · هاکس',
  synthetic: 'مصنوعی',
  seed: 'بذر',
  dataset: 'مجموعه‌دادهٔ مکانی فعال',
  persona: 'نقش نمایشی (بدون احراز هویت)',
  theme: 'تغییر پوسته',
  themeLight: 'تغییر به پوستهٔ روشن',
  themeDark: 'تغییر به پوستهٔ تیره',
  loading: 'در حال راه‌اندازی موتور مکانی RoadScope…',
  initializing: 'در حال راه‌اندازی موتور مکانی RoadScope...',
  error: 'راه‌اندازی سامانه ناموفق بود',
  initializationError: 'خطا در راه‌اندازی سامانه',
  retry: 'تلاش دوباره',
  analyticsLoadError: 'دریافت تحلیل ناموفق بود',
  noWebgl: 'نمایش نقشهٔ WebGL در دسترس نیست؛ بخش‌های تحلیلی همچنان قابل استفاده‌اند.',
  research: 'دسترسی و وضعیت پژوهش',
  close: 'بستن',
  available: 'رابط‌های پژوهشی فعال',
  unavailable: 'مدل‌های دروازه‌بندی‌شده (غیرفعال)',
  primitives: 'توابع کتابخانه‌ای پایه',
  notice:
    'نمونهٔ پژوهشی؛ خروجی‌های مصنوعی شواهد ایمنی دنیای واقعی نیستند و مدل‌های تصادفی مکانی یا یادگیری عمیقِ اعتبارسنجی‌نشده دروازه‌بندی شده‌اند.',
  token: 'توکن دسترسی API (فقط در حافظهٔ موقت نگهداری می‌شود)',
  save: 'اعمال توکن',
  clear: 'پاک‌کردن توکن',
  auth: 'مجوزها در سرور بررسی می‌شوند؛ تغییر نقش نمایشی به معنی احراز هویت نیست.',
  failed: 'دریافت وضعیت پژوهش ناموفق بود.',
  mobility_analyst: 'تحلیلگر جابه‌جایی',
  gis_researcher: 'پژوهشگر GIS',
  safety_engineer: 'مهندس ایمنی',
  citizen_reporter: 'گزارشگر شهروند',
  data_steward: 'متولی داده',
  simulation_scientist: 'پژوهشگر شبیه‌سازی',
};

export type MessageKey = keyof typeof en;

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  locale: Language;
  setLocale: (locale: Language) => void;
  t: (key: MessageKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'fa' ? 'fa' : 'en';
  } catch {
    return 'en';
  }
}

export const LanguageProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* storage can be blocked */
    }
  }, [language]);

  const value: LanguageContextValue = {
    language,
    setLanguage,
    locale: language,
    setLocale: setLanguage,
    t: (key) => (language === 'fa' ? fa : en)[key],
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const LocaleProvider = LanguageProvider;

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }
  return value;
}

export const useLocale = useLanguage;
