import type { Language } from './i18n';

const text = {
  en: {
    loading: 'Synchronizing coordinated views...', title: 'Coordinated Geovisual Analytics (CMV)',
    subtitle: 'Linked filters across the map, timeline, hourly matrix and corridors', verification: 'Verification status',
    verified: 'Confirmed canonical only', all: 'Confirmed and unverified VGI', queue: 'Unverified VGI triage only',
    reset: 'Reset filters', incidents: 'Active incidents', credibility: 'Mean credibility', severitySum: 'EPDO severity sum',
    weightedIndex: 'HSM weighted index', ksi: 'KSI (serious / fatal)', drift: 'Mean snap distance', meters: 'm',
    timeline: 'Weekly timeline and time-window filter', chooseEnd: 'Select the ending week', chooseWeeks: 'Select two weeks to filter',
    weekOf: 'Week of', selected: 'selected', baseline: 'baseline', studyHorizon: 'Study period (UTC)',
    matrix: 'Day-of-week × hour matrix (UTC)', clearCell: 'Clear time cell', crashes: 'crashes', rush: 'rush',
    severity: 'Severity breakdown (select to filter)', taxonomy: 'Collision category (select to filter)',
    corridors: 'Highest-count corridors (current selection)', corridorHint: 'Select a corridor to zoom and filter', corridor: 'Corridor',
    emptyWeeks: 'No weekly observations for this selection.', emptySeverity: 'No severity data for this selection.',
    emptyCategories: 'No collision categories for this selection.', emptyCorridors: 'No corridors for this selection.',
  },
  fa: {
    loading: 'در حال همگام‌سازی نماهای تحلیلی...', title: 'تحلیل بصری مکانی هماهنگ (CMV)',
    subtitle: 'فیلترهای پیوندی میان نقشه، خط زمان، ماتریس ساعتی و معابر', verification: 'وضعیت تأیید',
    verified: 'فقط موارد اصلی تأییدشده', all: 'موارد تأییدشده و گزارش‌های تأییدنشده', queue: 'فقط صف بررسی گزارش‌ها',
    reset: 'پاک‌کردن فیلترها', incidents: 'حوادث انتخاب‌شده', credibility: 'میانگین اعتبار', severitySum: 'مجموع شدت EPDO',
    weightedIndex: 'شاخص وزنی HSM', ksi: 'جراحت شدید یا فوتی (KSI)', drift: 'میانگین فاصلهٔ نگاشت', meters: 'متر',
    timeline: 'خط زمان هفتگی و فیلتر بازهٔ زمانی', chooseEnd: 'هفتهٔ پایانی را انتخاب کنید', chooseWeeks: 'برای فیلتر دو هفته را انتخاب کنید',
    weekOf: 'هفتهٔ', selected: 'انتخاب‌شده', baseline: 'کل مبنا', studyHorizon: 'بازهٔ مطالعه (UTC)',
    matrix: 'ماتریس روز هفته و ساعت (UTC)', clearCell: 'پاک‌کردن سلول زمانی', crashes: 'تصادف', rush: 'اوج ترافیک',
    severity: 'تفکیک شدت (برای فیلتر انتخاب کنید)', taxonomy: 'دسته‌بندی تصادف (برای فیلتر انتخاب کنید)',
    corridors: 'معابر با بیشترین تعداد حادثه (انتخاب فعلی)', corridorHint: 'برای بزرگ‌نمایی و فیلتر، معبر را انتخاب کنید', corridor: 'معبر',
    emptyWeeks: 'برای این انتخاب دادهٔ هفتگی وجود ندارد.', emptySeverity: 'برای این انتخاب دادهٔ شدت وجود ندارد.',
    emptyCategories: 'برای این انتخاب دسته‌بندی تصادف وجود ندارد.', emptyCorridors: 'برای این انتخاب معبری وجود ندارد.',
  },
} as const;

const days: Record<Language, readonly string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  fa: ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'],
};
const labels: Record<string, string> = {
  PDO: 'فقط خسارت مالی', MINOR_INJURY: 'جراحت جزئی', SERIOUS_INJURY: 'جراحت شدید', FATAL: 'فوتی',
  REAR_END: 'برخورد از عقب', ANGLE_INTERSECTION: 'برخورد زاویه‌ای در تقاطع', PEDESTRIAN_CROSSING: 'برخورد با عابر پیاده',
  CYCLIST_CONFLICT: 'برخورد با دوچرخه‌سوار', SIDESWIPE: 'برخورد جانبی', RUN_OFF_ROAD: 'خروج از راه',
  MULTI_VEHICLE_PILEUP: 'برخورد زنجیره‌ای چند خودرو',
};

export function analyticsText(language: Language) { return text[language]; }
export function dayLabels(language: Language) { return days[language]; }
export function domainLabel(language: Language, code: string, fallback: string) {
  return language === 'fa' ? (labels[code] ?? fallback) : fallback;
}
export function formatNumber(language: Language, value: number) {
  return new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(value);
}
