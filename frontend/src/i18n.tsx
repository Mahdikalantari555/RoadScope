import React, { createContext, useContext, useEffect, useState } from 'react';
export const en = {
  analytics: 'CMV Analytics', spatial_lab: 'Spatial Lab', risk_eb: 'Risk & EB',
  citizen_vgi: 'Citizen VGI', stewardship: 'Stewardship QA', simulator: 'Simulator',
  language: 'Language', synthetic: 'Synthetic · Seed', dataset: 'Active spatial dataset',
  persona: 'Preview persona (does not grant permissions)', theme: 'Toggle theme',
  loading: 'Initializing RoadScope spatial engine…', error: 'Platform initialization failed',
  noWebgl: 'WebGL is unavailable. The non-map workspaces remain accessible.',
  research: 'Research availability & access', close: 'Close', available: 'Available research APIs',
  unavailable: 'Unavailable models', primitives: 'Library primitives only (no workspace integration)',
  notice: 'Research prototype. Synthetic results are not evidence of real-world safety. Some workspace content is still English.',
  token: 'API bearer token (kept in memory only)', save: 'Use token', clear: 'Clear token',
  auth: 'The server determines permissions. Selecting a persona does not authenticate you.',
  failed: 'Could not load research availability.',
};
export const fa: Record<keyof typeof en, string> = {
  analytics: 'تحلیل هماهنگ', spatial_lab: 'آزمایشگاه مکانی', risk_eb: 'ریسک و بیز تجربی',
  citizen_vgi: 'گزارش مردمی', stewardship: 'کنترل کیفیت', simulator: 'شبیه‌ساز',
  language: 'زبان', synthetic: 'دادهٔ مصنوعی · بذر', dataset: 'مجموعه‌دادهٔ مکانی فعال',
  persona: 'نقش نمایشی (مجوز دسترسی نمی‌دهد)', theme: 'تغییر پوسته',
  loading: 'در حال راه‌اندازی موتور مکانی رودسکوپ…', error: 'راه‌اندازی سامانه ناموفق بود',
  noWebgl: 'نمایش نقشه در دسترس نیست. بخش‌های غیرنقشه‌ای همچنان قابل استفاده‌اند.',
  research: 'دسترسی و وضعیت پژوهش', close: 'بستن', available: 'رابط‌های پژوهشی در دسترس',
  unavailable: 'مدل‌های غیرقابل استفاده', primitives: 'فقط توابع کتابخانه‌ای (بدون اتصال به فضای کاری)',
  notice: 'نمونهٔ پژوهشی؛ نتایج مصنوعی شواهد ایمنی دنیای واقعی نیستند. بخشی از محتوای محیط کار هنوز انگلیسی است.',
  token: 'توکن دسترسی (فقط در حافظه نگهداری می‌شود)', save: 'استفاده از توکن', clear: 'پاک کردن توکن',
  auth: 'مجوزها در سرور تعیین می‌شوند. انتخاب نقش نمایشی به معنی احراز هویت نیست.',
  failed: 'دریافت وضعیت پژوهش ناموفق بود.',
};
type Locale = 'en' | 'fa';
const Context = createContext({ locale: 'en' as Locale, setLocale: (_: Locale) => {}, t: (key: keyof typeof en) => en[key] });
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try { return localStorage.getItem('roadscope.language') === 'fa' ? 'fa' : 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    try { localStorage.setItem('roadscope.language', locale); } catch { /* storage is optional */ }
  }, [locale]);
  return <Context.Provider value={{ locale, setLocale, t: key => (locale === 'fa' ? fa : en)[key] }}>{children}</Context.Provider>;
}
export const useLocale = () => useContext(Context);
