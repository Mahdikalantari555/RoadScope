import type { Language } from './i18n';

const text = {
  en: {
    title: 'Stochastic network Cox/Poisson simulator', subtitle: 'Reproducible LRS lixels and simulated VGI noise',
    showIncidents: 'Show incidents', inspectTruth: 'Inspect true λ(e,m,t)', activeSynthetic: 'Active synthetic benchmark dataset',
    activeObserved: 'Active non-synthetic dataset', configure: 'Configure a new simulated dataset', scenario: 'Spatiotemporal intensity scenario λ(e,m,t)',
    lixel: 'Lixel resolution (m)', fine: 'Fine', standard: 'Standard', coarse: 'Coarse', seed: 'Random seed', rate: 'Intensity scale λ₀',
    noiseTitle: 'VGI noise and duplicate reports', sigma: 'Position uncertainty σ (m)', duplicate: 'Duplicate rate (0–1)', falseAlarms: 'False alarms',
    generate: 'Generate and activate synthetic dataset', running: 'Generating synthetic dataset...', failed: 'Simulation failed',
    generated: 'Generated dataset', networkLength: 'Network length (km)', nodes: 'Nodes', edges: 'Road segments', lixels: 'Lixels',
    verified: 'Verified synthetic crashes', reports: 'VGI reports', bursts: 'Duplicate groups',
  },
  fa: {
    title: 'شبیه‌ساز تصادفی شبکه‌ای Cox/Poisson', subtitle: 'لیکسل‌بندی قابل بازتولید و نویز شبیه‌سازی‌شدهٔ گزارش‌های شهروندی',
    showIncidents: 'نمایش حوادث', inspectTruth: 'نمایش شدت واقعی λ(e,m,t)', activeSynthetic: 'مجموعه‌دادهٔ مصنوعی فعال',
    activeObserved: 'مجموعه‌دادهٔ غیرمصنوعی فعال', configure: 'تنظیم مجموعه‌دادهٔ مصنوعی جدید', scenario: 'سناریوی شدت فضایی‌ـ‌زمانی λ(e,m,t)',
    lixel: 'تفکیک لیکسل (متر)', fine: 'ریز', standard: 'استاندارد', coarse: 'درشت', seed: 'بذر تصادفی', rate: 'ضریب شدت λ₀',
    noiseTitle: 'نویز گزارش شهروندی و گزارش‌های تکراری', sigma: 'عدم‌قطعیت مکانی σ (متر)', duplicate: 'نرخ گزارش تکراری (۰ تا ۱)', falseAlarms: 'هشدارهای کاذب',
    generate: 'تولید و فعال‌سازی مجموعه‌دادهٔ مصنوعی', running: 'در حال تولید مجموعه‌دادهٔ مصنوعی...', failed: 'شبیه‌سازی ناموفق بود',
    generated: 'مجموعه‌دادهٔ تولیدشده', networkLength: 'طول شبکه (کیلومتر)', nodes: 'گره‌ها', edges: 'قطعات راه', lixels: 'لیکسل‌ها',
    verified: 'تصادفات مصنوعی تأییدشده', reports: 'گزارش‌های شهروندی', bursts: 'گروه‌های تکراری',
  },
} as const;
const persianScenarios: Record<string, { title: string; description: string }> = {
  MULTI_COVARIATE_URBAN: { title: 'شبکهٔ شهری چندمتغیره', description: 'شدت ناهمگن بر پایهٔ مواجهه، نزدیکی به تقاطع، هندسهٔ راه، زمان روز و هوای بارانی.' },
  INTERSECTION_CLUSTERED: { title: 'خوشه‌بندی پیرامون تقاطع‌ها', description: 'شدت در اطراف تقاطع‌های واقعی شبکه افزایش می‌یابد و تقاطع‌های غیرهمسطح به اشتباه متصل نمی‌شوند.' },
  DIURNAL_RUSH_HOUR_SHOCK: { title: 'اوج ترافیک روزانه', description: 'افزایش شدت در ساعات رفت‌وآمد صبح و عصر، به‌ویژه در شریان‌ها و پل‌ها.' },
  UNIFORM_BASELINE: { title: 'توزیع یکنواخت روی شبکه', description: 'فرآیند پواسون یک‌بعدی همگن برای مقایسه با فرض تصادفی بودن مکانی.' },
};
export const simulatorText = (language: Language) => text[language];
export function scenarioLabel(language: Language, key: string, fallback: { title: string; description: string }) {
  return language === 'fa' ? persianScenarios[key] ?? fallback : fallback;
}
