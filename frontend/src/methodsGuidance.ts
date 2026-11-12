import type { Language } from './i18n';

/**
 * Bilingual method guidance (task 2.1).
 *
 * One record per supported output. Every entry must state what the number *is*, its unit, the
 * assumptions it depends on, where the underlying data came from, and how uncertain it is. The
 * synthetic caveat is derived from the active dataset rather than hard-coded per method so a
 * research-only or unvalidated dataset cannot present a method as established evidence.
 */

export interface MethodNote {
  /** Workspace/overlay key this note documents. */
  key: string;
  title: string;
  summary: string;
  unit: string;
  assumptions: string[];
  source: string;
  uncertainty: string;
}

export interface MethodsGuidance {
  title: string;
  intro: string;
  syntheticCaveat: string;
  supportedHeading: string;
  unsupportedHeading: string;
  unsupported: string[];
  close: string;
  methods: MethodNote[];
}

const GUIDANCE: Record<Language, MethodsGuidance> = {
  en: {
    title: 'Methods, units and limitations',
    intro:
      'Each output below states what is measured, the unit of the number on screen, the assumptions it relies on, where the data come from, and how uncertain the result is. Read this before using a number in a report or a decision.',
    syntheticCaveat:
      'This dataset is synthetic: incidents were generated from a documented seed on a labelled demo network. Nothing here is a real crash location, a measured exposure or validated risk.',
    supportedHeading: 'Supported outputs',
    unsupportedHeading: 'Unavailable or gated',
    unsupported: [
      'Spatially varying coefficient and deep-learning models are not enabled; no output is substituted for them.',
      'Network imports carry geometry and attributes only. They create no exposure, traffic or risk layer until observations exist.',
      'A report is never published while its cell is below the minimum cell size, or while the publication flag is closed.',
    ],
    close: 'Close',
    methods: [
      {
        key: 'incident_count',
        title: 'Incident count',
        summary:
          'Number of incidents in the current filter selection, after the verification-status filter is applied.',
        unit: 'count (incidents)',
        assumptions: [
          'Each stored incident is one event; merged duplicates are counted once.',
          'Unverified citizen reports are included only when the verification filter allows them.',
        ],
        source: 'Incident records of the active dataset.',
        uncertainty: 'Complete for the stored data, but the stored data are not a complete crash census.',
      },
      {
        key: 'epdo',
        title: 'EPDO severity sum',
        summary:
          'Equivalent property-damage-only value: each incident is weighted by its severity rank so a serious injury counts more than a fender-bender.',
        unit: 'EPDO (dimensionless severity units)',
        assumptions: [
          'The severity weights are configuration values, not estimates fitted to local crash costs.',
          'The reported severity is the observed severity; under-reporting of minor crashes biases the sum downward.',
        ],
        source: 'Severity weights from the dataset taxonomy applied to incident records.',
        uncertainty: 'Sensitive to under-reporting and to the weight vector; not a monetary value.',
      },
      {
        key: 'ksi',
        title: 'KSI share (killed or seriously injured)',
        summary: 'Share of selected incidents that are serious injuries or fatalities.',
        unit: 'percentage of selected incidents',
        assumptions: ['Severity classes are comparable across sources in the dataset.'],
        source: 'Incident severity field.',
        uncertainty: 'Wide confidence intervals at small counts; treat single-digit counts as indicative only.',
      },
      {
        key: 'snap_drift',
        title: 'Mean snap distance',
        summary:
          'Average distance between a citizen report location and the road segment it was matched to.',
        unit: 'metres',
        assumptions: [
          'The reporter states a positional uncertainty radius; candidates outside the radius are excluded.',
          'Matching prefers topological continuity over the nearest Euclidean segment.',
        ],
        source: 'Citizen reports and the dataset road network.',
        uncertainty: 'A large mean drift signals location noise or a mismatched network, not a real pattern.',
      },
      {
        key: 'nkde',
        title: 'Network KDE (NKDE)',
        summary:
          'Kernel density of incidents measured along the road network using shortest-path lixel distances.',
        unit: 'incidents per kilometre per year',
        assumptions: [
          'Density is allocated over lixels (linear pixels) with mass conservation along the network.',
          'The bandwidth is a user choice and changes both the peak value and the pattern.',
        ],
        source: 'Incident records and the dataset road network with its lixel resolution.',
        uncertainty: 'Depends on bandwidth, lixel resolution and incident allocation; it is not a crash probability.',
      },
      {
        key: 'planar_kde',
        title: 'Planar KDE and distortion bias',
        summary:
          'Euclidean density computed for comparison. The difference from NKDE shows where an as-the-crow-flies analysis would misplace mass around barriers and one-way links.',
        unit: 'incidents per square kilometre per year; bias in the same density unit',
        assumptions: ['Both surfaces use the same events and weights; only the metric changes.'],
        source: 'Same incident records, Euclidean geometry.',
        uncertainty: 'The bias is a diagnostic of the method, not an estimate of true risk.',
      },
      {
        key: 'tnkde',
        title: 'Adaptive spatiotemporal KDE (TNKDE)',
        summary: 'Density over road position and time, with a bandwidth adapted to local event density.',
        unit: 'incidents per kilometre per day',
        assumptions: [
          'Only events in the past are used at each time slice.',
          'Bandwidths are chosen by leave-one-out likelihood on the same events, so they are not independent evidence.',
        ],
        source: 'Incident records with occurrence timestamps.',
        uncertainty: 'Strongly dependent on the selected slice and bandwidths; sparse slices are unstable.',
      },
      {
        key: 'gi_star',
        title: 'Network Getis-Ord Gi* and Moran’s I',
        summary: 'Locates statistically hot and cold stretches of road under a network spatial-weights scheme.',
        unit: 'z-score and p-value per segment',
        assumptions: [
          'Weighting follows network adjacency or shortest-path distance, not planar contiguity.',
          'Multiple-testing is controlled with false-discovery rate.',
        ],
        source: 'Incident counts per segment.',
        uncertainty: 'Hotspots at low counts reflect sparse data as much as elevated risk.',
      },
      {
        key: 'ndbscan',
        title: 'Network DBSCAN',
        summary: 'Clusters incidents reachable within a network distance threshold, returning road subgraphs and hulls.',
        unit: 'cluster identifier; ε in metres, minPts in incidents',
        assumptions: ['Two incidents are neighbours only if the network path between them is within ε.'],
        source: 'Incident records and network shortest paths.',
        uncertainty: 'Cluster boundaries move with ε and minPts; a cluster is not a proven common cause.',
      },
      {
        key: 'risk_eb',
        title: 'Empirical Bayes expected crashes',
        summary:
          'Shrinks each segment’s observed count toward a safety-performance-function prior, which stabilises short segments with few crashes.',
        unit: 'expected crashes; density in crashes per kilometre',
        assumptions: [
          'A negative-binomial prior is calibrated on this dataset, whose crash counts may be synthetic.',
          'Exposure is imputed when traffic volume is missing and is flagged as such.',
        ],
        source: 'Incident counts, segment length, and AADT where available.',
        uncertainty: 'Reported per segment as a credible interval; wide intervals mean the ranking is unstable.',
      },
      {
        key: 'risk_psi',
        title: 'Potential for safety improvement (PSI)',
        summary: 'Difference between the EB expected crashes and the SPF prior: excess crashes attributable to the site.',
        unit: 'excess crashes per segment (positive = worse than similar roads)',
        assumptions: [
          'The prior is a reasonable expectation for a comparable road class.',
          'Imputed exposure propagates its error into the excess estimate.',
        ],
        source: 'EB posterior and the fitted SPF.',
        uncertainty: 'Not a causal effect of the site; a screening device for further study.',
      },
      {
        key: 'risk_mvkt',
        title: 'Exposure rate per million vehicle-kilometres',
        summary: 'Crash rate normalised by travel exposure, allowing comparison between roads of different demand.',
        unit: 'crashes per million vehicle-kilometres travelled',
        assumptions: [
          'Traffic volume is observed. Where it is imputed the row is marked and the rate is weaker.',
        ],
        source: 'Incident records and traffic-volume observations.',
        uncertainty: 'Without observed exposure this layer is disabled rather than guessed.',
      },
      {
        key: 'vgi_credibility',
        title: 'Citizen report credibility',
        summary: 'Score combining witness corroboration, positional plausibility and matching to the network.',
        unit: 'score between 0 and 1 (dimensionless)',
        assumptions: [
          'Corroboration counts are from independent reporters; coordinated false reporting is not fully detectable.',
        ],
        source: 'Citizen reports in the restricted pilot flow.',
        uncertainty: 'A heuristic triage aid; a steward decision remains authoritative.',
      },
      {
        key: 'public_aggregate',
        title: 'Public disclosure aggregate',
        summary:
          'Counts per coarse spatial cell, published only after a steward verification and a separate disclosure decision.',
        unit: 'count per cell',
        assumptions: [
          'Cells below the minimum cell size are suppressed rather than rounded.',
          'Unverified and withdrawn reports are excluded entirely.',
        ],
        source: 'Verified reports in the pilot dataset.',
        uncertainty: 'Coarse by design; small-area inference from a published cell is not supported.',
      },
    ],
  },
  fa: {
    title: 'روش‌ها، واحدها و محدودیت‌ها',
    intro:
      'برای هر خروجی در ادامه گفته شده است چه چیزی اندازه‌گیری می‌شود، واحد عدد روی صفحه چیست، بر چه فرض‌هایی تکیه دارد، داده از کجا آمده و نتیجه چقدر نامطمئن است. پیش از استفاده از هر عدد در گزارش یا تصمیم، این بخش را بخوانید.',
    syntheticCaveat:
      'این مجموعه‌داده مصنوعی است: رخدادها با بذر ثبت‌شده روی یک شبکهٔ نمایشی برچسب‌خورده تولید شده‌اند. هیچ‌کدام محل واقعی تصادف، تردد اندازه‌گیری‌شده یا ریسک اعتبارسنجی‌شده نیست.',
    supportedHeading: 'خروجی‌های پشتیبانی‌شده',
    unsupportedHeading: 'غیرفعال یا دروازه‌بندی‌شده',
    unsupported: [
      'مدل‌های ضریب متغیر مکانی و یادگیری عمیق فعال نیستند و هیچ خروجی جایگزینی برای آن‌ها نمایش داده نمی‌شود.',
      'واردسازی شبکه فقط هندسه و مشخصه‌ها را می‌آورد؛ تا وجود مشاهده، لایهٔ تردد یا ریسک ساخته نمی‌شود.',
      'گزارشی که سلول آن کوچک‌تر از حد کمینه است یا پرچم انتشار بسته است، هرگز منتشر نمی‌شود.',
    ],
    close: 'بستن',
    methods: [
      {
        key: 'incident_count',
        title: 'تعداد رخداد',
        summary: 'شمار رخدادهای انتخاب فعلی پس از اعمال فیلتر وضعیت تأیید.',
        unit: 'تعداد (رخداد)',
        assumptions: [
          'هر رکورد یک رویداد است؛ موارد تکراری ادغام‌شده یک بار شمرده می‌شوند.',
          'گزارش‌های تأییدنشده فقط وقتی فیلتر تأیید اجازه دهد وارد می‌شوند.',
        ],
        source: 'رکوردهای رخداد مجموعه‌دادهٔ فعال.',
        uncertainty: 'نسبت به دادهٔ ذخیره‌شده کامل است، اما این داده‌ها سرشماری کامل تصادف نیستند.',
      },
      {
        key: 'epdo',
        title: 'مجموع شدت EPDO',
        summary:
          'ارزش معادل فقط خسارت مالی: هر رخداد با رتبهٔ شدت خود وزن می‌گیرد تا جراحت شدید بیش از برخورد جزئی اثر بگذارد.',
        unit: 'EPDO (واحد بی‌بعد شدت)',
        assumptions: [
          'وزن‌های شدت مقادیر تنظیمات‌اند، نه برآوردهای برازش‌شده به هزینهٔ محلی تصادف.',
          'شدت گزارش‌شده همان شدت مشاهده‌شده است؛ کم‌گزارشی تصادف‌های جزئی مجموع را پایین می‌آورد.',
        ],
        source: 'وزن‌های شدت از طبقه‌بندی مجموعه‌داده روی رکوردهای رخداد.',
        uncertainty: 'به کم‌گزارشی و بردار وزن حساس است و ارزش پولی نیست.',
      },
      {
        key: 'ksi',
        title: 'سهم KSI (فوتی یا جراحت شدید)',
        summary: 'سهم رخدادهای انتخاب‌شده که جراحت شدید یا فوتی هستند.',
        unit: 'درصد رخدادهای انتخاب‌شده',
        assumptions: ['کلاس‌های شدت در منابع مجموعه‌داده قابل مقایسه‌اند.'],
        source: 'فیلد شدت رخداد.',
        uncertainty: 'در شمارش‌های کوچک بازهٔ اطمینان بسیار پهن است؛ تعداد یک‌رقمی فقط نشانه است.',
      },
      {
        key: 'snap_drift',
        title: 'میانگین فاصلهٔ نگاشت',
        summary: 'میانگین فاصلهٔ محل گزارش شهروند تا قطعهٔ راهی که به آن نسبت داده شده است.',
        unit: 'متر',
        assumptions: [
          'گزارشگر شعاع عدم‌قطعیت مکان را اعلام می‌کند و نامزدهای بیرون آن حذف می‌شوند.',
          'نگاشت، پیوستگی توپولوژیک را بر نزدیک‌ترین قطعهٔ اقلیدسی ترجیح می‌دهد.',
        ],
        source: 'گزارش‌های شهروندی و شبکهٔ راه مجموعه‌داده.',
        uncertainty: 'فاصلهٔ میانگین بزرگ نشانهٔ نوفهٔ مکان یا ناسازگاری شبکه است، نه الگوی واقعی.',
      },
      {
        key: 'nkde',
        title: 'چگالی شبکه‌ای (NKDE)',
        summary: 'چگالی هسته‌ای رخدادها در امتداد شبکهٔ راه با فاصلهٔ کوتاه‌ترین مسیر روی لیکسل‌ها.',
        unit: 'رخداد بر کیلومتر در سال',
        assumptions: [
          'چگالی روی لیکسل‌ها با بقای جرم در امتداد شبکه تخصیص می‌یابد.',
          'پهنای باند انتخابی کاربر است و هم مقدار اوج و هم الگو را تغییر می‌دهد.',
        ],
        source: 'رکوردهای رخداد و شبکهٔ راه با تفکیک لیکسل آن.',
        uncertainty: 'به پهنای باند، تفکیک لیکسل و تخصیص رخداد وابسته است و احتمال تصادف نیست.',
      },
      {
        key: 'planar_kde',
        title: 'KDE مسطح و سوگیری اعوجاج',
        summary:
          'چگالی اقلیدسی برای مقایسه محاسبه می‌شود. تفاوت آن با NKDE نشان می‌دهد تحلیل «فاصلهٔ هوایی» جرم را در کجا اشتباه می‌گذارد.',
        unit: 'رخداد بر کیلومتر مربع در سال؛ سوگیری با همان واحد چگالی',
        assumptions: ['هر دو سطح از رخدادها و وزن‌های یکسان استفاده می‌کنند و تنها متر تغییر می‌کند.'],
        source: 'همان رکوردهای رخداد با هندسهٔ اقلیدسی.',
        uncertainty: 'این سوگیری تشخیصی برای روش است، نه برآوردی از ریسک واقعی.',
      },
      {
        key: 'tnkde',
        title: 'KDE مکانی‌زمانی تطبیقی (TNKDE)',
        summary: 'چگالی بر موقعیت راه و زمان با پهنای باند سازگار با تراکم محلی رخداد.',
        unit: 'رخداد بر کیلومتر در روز',
        assumptions: [
          'در هر برش زمانی فقط رخدادهای گذشته استفاده می‌شوند.',
          'پهنای باند با درست‌نمایی حذف‌یکی روی همان رخدادها انتخاب می‌شود، پس شاهد مستقل نیست.',
        ],
        source: 'رکوردهای رخداد همراه با زمان وقوع.',
        uncertainty: 'به‌شدت وابسته به برش و پهنای باند انتخاب‌شده؛ برش‌های تنک ناپایدارند.',
      },
      {
        key: 'gi_star',
        title: 'Getis-Ord Gi* شبکه‌ای و موران',
        summary: 'پیداکردن بازه‌های آماری گرم و سرد راه زیر یک طرح وزن مکانی شبکه‌ای.',
        unit: 'z-score و p-value برای هر قطعه',
        assumptions: [
          'وزن‌دهی بر پایهٔ مجاورت شبکه یا فاصلهٔ کوتاه‌ترین مسیر است، نه پیوستگی مسطح.',
          'آزمون چندگانه با نرخ کشف نادرست کنترل می‌شود.',
        ],
        source: 'شمار رخداد در هر قطعه.',
        uncertainty: 'نقاط گرم با شمارش کم، بیشتر بازتاب دادهٔ تنک‌اند تا ریسک بالاتر.',
      },
      {
        key: 'ndbscan',
        title: 'DBSCAN شبکه‌ای',
        summary: 'خوشه‌بندی رخدادهای قابل‌دسترسی در آستانهٔ فاصلهٔ شبکه، همراه زیرگراف و پوشش راه.',
        unit: 'شناسهٔ خوشه؛ ε بر حسب متر و minPts بر حسب رخداد',
        assumptions: ['دو رخداد همسایه‌اند تنها اگر مسیر شبکه‌ای میانشان در محدودهٔ ε باشد.'],
        source: 'رکوردهای رخداد و کوتاه‌ترین مسیرهای شبکه.',
        uncertainty: 'مرز خوشه با ε و minPts جابه‌جا می‌شود؛ خوشه دلیل مشترک اثبات‌شده نیست.',
      },
      {
        key: 'risk_eb',
        title: 'امید ریاضی بیز تجربی (EB)',
        summary:
          'شمار مشاهده‌شدهٔ هر قطعه به سمت پیشین تابع عملکرد ایمنی انقباض می‌یابد و قطعات کوتاه با رخداد کم را پایدار می‌کند.',
        unit: 'رخداد مورد انتظار؛ چگالی بر حسب رخداد بر کیلومتر',
        assumptions: [
          'پیشین دوجمله‌ای منفی روی همین مجموعه‌داده کالیبره می‌شود که آمار آن ممکن است مصنوعی باشد.',
          'در نبود حجم ترافیک، مواجهه برآوردی است و همین موضوع علامت‌گذاری می‌شود.',
        ],
        source: 'شمار رخداد، طول قطعه و AADT در صورت وجود.',
        uncertainty: 'برای هر قطعه بازهٔ اطمینان داده می‌شود؛ بازهٔ پهن یعنی رتبه‌بندی ناپایدار است.',
      },
      {
        key: 'risk_psi',
        title: 'ظرفیت بهبود ایمنی (PSI)',
        summary: 'تفاوت رخداد مورد انتظار EB و پیشین SPF: رخداد مازاد قابل انتساب به محل.',
        unit: 'رخداد مازاد برای هر قطعه (مثبت = بدتر از راه‌های مشابه)',
        assumptions: [
          'پیشین انتظار معقولی برای کلاس راه مشابه است.',
          'مواجههٔ برآوردی خطای خود را به برآورد مازاد منتقل می‌کند.',
        ],
        source: 'پسین EB و SPF برازش‌شده.',
        uncertainty: 'اثر علّی محل نیست؛ ابزاری برای غربالگری و مطالعهٔ بیشتر است.',
      },
      {
        key: 'risk_mvkt',
        title: 'نرخ مواجهه بر میلیون کیلومتر وسیله',
        summary: 'نرخ تصادف نرمال‌شده با مواجههٔ سفر، برای مقایسهٔ راه‌هایی با تقاضای متفاوت.',
        unit: 'تصادف بر میلیون کیلومتر پیمایش وسیله',
        assumptions: ['حجم ترافیک مشاهده شده است؛ در حالت برآوردی سطر علامت می‌خورد و نرخ ضعیف‌تر است.'],
        source: 'رکوردهای رخداد و مشاهدات حجم ترافیک.',
        uncertainty: 'در نبود مواجههٔ مشاهده‌شده این لایه غیرفعال می‌شود، نه حدس زده.',
      },
      {
        key: 'vgi_credibility',
        title: 'اعتبار گزارش شهروندی',
        summary: 'امتیاز ترکیبی از تأیید شاهدان، پذیرفتنی‌بودن مکانی و تطبیق با شبکه.',
        unit: 'امتیاز میان ۰ و ۱ (بی‌بعد)',
        assumptions: ['شمار تأییدها از گزارشگران مستقل است؛ گزارش‌های نادرست هماهنگ‌شده به‌طور کامل قابل تشخیص نیست.'],
        source: 'گزارش‌های شهروندی در جریان پایلوت محدود.',
        uncertainty: 'ابزار کمکی غربالگری است؛ تصمیم متولی همچنان مرجع است.',
      },
      {
        key: 'public_aggregate',
        title: 'تجمیع افشای عمومی',
        summary: 'شمار رخداد در هر سلول مکانی درشت، تنها پس از تأیید متولی و تصمیم مستقل افشا.',
        unit: 'تعداد در هر سلول',
        assumptions: [
          'سلول‌های کوچک‌تر از حد کمینه پنهان می‌شوند، نه گرد.',
          'گزارش‌های تأییدنشده و پس‌گرفته‌شده کاملاً حذف می‌شوند.',
        ],
        source: 'گزارش‌های تأییدشده در مجموعه‌دادهٔ پایلوت.',
        uncertainty: 'به‌طور طراحی‌شده درشت است؛ استنباط ناحیهٔ کوچک از یک سلول منتشرشده پشتیبانی نمی‌شود.',
      },
    ],
  },
};

export function getMethodsGuidance(language: Language): MethodsGuidance {
  return GUIDANCE[language];
}
