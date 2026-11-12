import type { Language } from './i18n';

/**
 * Bilingual copy for the restricted pilot surfaces.
 *
 * Every string here is about *what the pilot does and does not do*. The wording is deliberately
 * conservative: it never implies that a submitted report is verified, that a status is a legal
 * decision, or that a publication exists before its separate disclosure decision.
 */
const PILOT = {
  en: {
    // Gate states
    disabledTitle: 'Restricted pilot — closed on this deployment',
    disabledBody:
      'Real citizen reporting is disabled. It requires a recorded owner, an approved consent and privacy review, and a server-side feature flag. Until then the platform is synthetic-data only.',
    intakeClosed: 'Report intake is closed.',
    trackingClosed: 'Status tracking is closed.',
    notPilotProfile: 'The active dataset is not a pilot dataset, so no real report can be stored in it.',
    gatesHeading: 'Why it is closed',
    gateFlag: 'feature flag',
    gateProfile: 'pilot dataset profile',
    gateApproval: 'recorded approval reference',
    reload: 'Check again',

    // Form
    formTitle: 'Report a road traffic crash',
    formIntro:
      'This form records a crash you witnessed. It is a pilot: reports are reviewed by a steward and are not official crash statistics.',
    purposeHeading: 'Why we ask',
    purposeBody:
      'Your report helps evaluate whether citizen reports can fill gaps in crash data. We collect the minimum needed: time, location, an uncertainty radius, the crash category and the severity you observed.',
    notCollectedHeading: 'What we never collect',
    notCollected: [
      'Photos or video',
      'Free-text description or names',
      'Licence plates or vehicle identifiers',
      'Identity documents or contact details',
      'Patient or victim information',
    ],
    consentHeading: 'Consent',
    consentCheckbox:
      'I understand this is a voluntary pilot report, that it will be reviewed, and that it is not an official record. I consent to storing this report under the pilot policy.',
    consentRequired: 'Explicit consent is required before a report can be submitted.',
    consentVersion: 'Consent policy version',
    timezoneLabel: 'Your time zone',
    occurredLabel: 'When did it happen (local time)?',
    occurredHint: 'Local time in your own time zone. We store the UTC equivalent.',
    locationHeading: 'Where did it happen?',
    locationHint: 'Pick the point on the map, or type the coordinates you can read from the map.',
    lonLabel: 'Longitude',
    latLabel: 'Latitude',
    uncertaintyLabel: 'How sure are you about the location?',
    uncertaintyHint: 'Drag to set a radius between 3 and 500 metres. A larger radius is safer than a false precision.',
    categoryLabel: 'What happened?',
    severityLabel: 'How severe was it?',
    severityUnknown: 'Unknown / cannot tell',
    segmentLabel: 'Which road? (optional)',
    segmentNone: 'Not sure — leave unmatched',
    matchHeading: 'Matching preview',
    matchConfident: 'One road clearly matches your point.',
    matchUncertain: 'Several roads are plausible. Your report stays unmatched until a steward reviews it.',
    matchUnmatched: 'No road is within your uncertainty radius. The report is kept unmatched.',
    matchCandidates: 'candidate roads',
    submit: 'Submit report',
    submitting: 'Submitting…',
    submitted: 'Report received',
    submittedUnverified: 'Saved as an unverified report. A steward reviews it before it can appear anywhere.',
    receiptHeading: 'Your tracking credential',
    receiptWarning:
      'Write this down now. It is shown only once, and it is the only way to check your report or withdraw consent.',
    receiptCopy: 'Copy credential',
    receiptCopied: 'Copied',
    receiptNoUrl:
      'Never share it in a message or a URL. Anyone who has it can see your report status and withdraw your consent.',
    receiptRetention: 'Scheduled deletion',
    duplicatesHeading: 'Possibly the same event',
    duplicatesBody:
      'These existing reports look close in space and time. Nothing has been merged: a steward decides, and the decision can be reversed.',
    duplicateItem: 'Possible duplicate',
    duplicateDistance: 'distance',
    duplicateTime: 'time difference',
    errorHeading: 'The report was not saved',
    errorConsent: 'Consent is required.',
    errorRate: 'Too many reports from this device recently. Try again later.',
    errorClosed: 'Reporting is currently closed.',
    errorGeneric: 'Submission failed',
    offline: 'You appear to be offline. Nothing was sent; your input is still here.',
    requiredMark: 'required',

    // Tracking
    trackingTitle: 'Check your report',
    trackingIntro: 'Enter the credential you saved when you submitted the report.',
    trackingCredentialLabel: 'Tracking credential',
    trackingCheck: 'Check status',
    trackingChecking: 'Checking…',
    trackingStatusHeading: 'Current status',
    trackingOnlyStatus:
      'This view returns only the status, the coarse area and the retention date. Exact coordinates and other reporters’ details are never shown.',
    trackingNotFound: 'That credential is not recognised. Check it and try again.',
    trackingRateLimited: 'Too many attempts. Wait a minute and try again.',
    trackingPublished: 'Included in the published aggregate',
    trackingNotPublished: 'Not published. Publication needs a separate approval and a minimum cell size.',
    trackingCanWithdraw: 'Request deletion',
    trackingWithdrawTitle: 'Delete my report and withdraw consent',
    trackingWithdrawReason: 'Reason (optional)',
    trackingWithdrawConfirm: 'Withdraw consent and delete',
    trackingWithdrawCancel: 'Keep my report',
    trackingWithdrawn: 'Consent withdrawn. The report is no longer readable and a deletion request is recorded.',
    trackingMergedInto: 'Merged into',
    close: 'Close',
    back: 'Back',
  },
  fa: {
    disabledTitle: 'پایلوت محدود — در این استقرار بسته است',
    disabledBody:
      'ثبت گزارش واقعی شهروندان غیرفعال است. فعال‌سازی آن نیازمند ثبت مالک، تأیید رضایت و بررسی حریم خصوصی و یک پرچم سمت سرور است. تا آن زمان سامانه فقط برای دادهٔ مصنوعی به کار می‌رود.',
    intakeClosed: 'پذیرش گزارش بسته است.',
    trackingClosed: 'پیگیری وضعیت بسته است.',
    notPilotProfile: 'مجموعه‌دادهٔ فعال یک مجموعهٔ پایلوت نیست، بنابراین گزارش واقعی در آن ذخیره نمی‌شود.',
    gatesHeading: 'دلیل بسته بودن',
    gateFlag: 'پرچم قابلیت',
    gateProfile: 'پروفایل مجموعه‌دادهٔ پایلوت',
    gateApproval: 'مرجع تأیید ثبت‌شده',
    reload: 'بررسی دوباره',

    formTitle: 'ثبت گزارش تصادف جاده‌ای',
    formIntro:
      'این فرم برای ثبت تصادفی است که شاهد آن بوده‌اید. پایلوت است: گزارش‌ها توسط متولی بررسی می‌شوند و آمار رسمی تصادف نیستند.',
    purposeHeading: 'چرا می‌پرسیم',
    purposeBody:
      'گزارش شما به ارزیابی این کمک می‌کند که آیا گزارش‌های شهروندی می‌توانند خلأ دادهٔ تصادف را پر کنند. کمترین دادهٔ لازم را می‌گیریم: زمان، مکان، شعاع عدم‌قطعیت، نوع تصادف و شدتی که دیده‌اید.',
    notCollectedHeading: 'چه چیزی هرگز نمی‌گیریم',
    notCollected: [
      'عکس یا ویدئو',
      'متن آزاد یا نام افراد',
      'پلاک خودرو یا شناسهٔ وسیله',
      'مدرک هویت یا اطلاعات تماس',
      'اطلاعات بیمار یا آسیب‌دیده',
    ],
    consentHeading: 'رضایت',
    consentCheckbox:
      'می‌دانم این یک گزارش داوطلبانهٔ پایلوت است، بررسی می‌شود و سابقهٔ رسمی نیست. با ذخیرهٔ این گزارش بر پایهٔ سیاست پایلوت موافقم.',
    consentRequired: 'پیش از ارسال، رضایت صریح لازم است.',
    consentVersion: 'نسخهٔ سیاست رضایت',
    timezoneLabel: 'منطقهٔ زمانی شما',
    occurredLabel: 'چه زمانی رخ داد (به وقت محلی)؟',
    occurredHint: 'به وقت محلی خودتان. معادل UTC ذخیره می‌شود.',
    locationHeading: 'کجا رخ داد؟',
    locationHint: 'نقطه را روی نقشه انتخاب کنید یا مختصاتی را که از نقشه می‌خوانید وارد کنید.',
    lonLabel: 'طول جغرافیایی',
    latLabel: 'عرض جغرافیایی',
    uncertaintyLabel: 'چقدر از مکان مطمئن هستید؟',
    uncertaintyHint: 'شعاعی بین ۳ تا ۵۰۰ متر تعیین کنید. شعاع بزرگ‌تر از دقت کاذب بهتر است.',
    categoryLabel: 'چه اتفاقی افتاد؟',
    severityLabel: 'شدت آن چقدر بود؟',
    severityUnknown: 'نامشخص / نمی‌دانم',
    segmentLabel: 'کدام راه؟ (اختیاری)',
    segmentNone: 'مطمئن نیستم — بدون تطبیق بماند',
    matchHeading: 'پیش‌نمایش تطبیق',
    matchConfident: 'یک راه به‌وضوح با نقطهٔ شما منطبق است.',
    matchUncertain: 'چند راه محتمل است. گزارش شما تا بررسی متولی بدون تطبیق می‌ماند.',
    matchUnmatched: 'هیچ راهی در شعاع عدم‌قطعیت شما نیست. گزارش بدون تطبیق نگه داشته می‌شود.',
    matchCandidates: 'راه نامزد',
    submit: 'ارسال گزارش',
    submitting: 'در حال ارسال…',
    submitted: 'گزارش دریافت شد',
    submittedUnverified: 'به‌عنوان گزارش تأییدنشده ذخیره شد. پیش از نمایش در هر جا، متولی آن را بررسی می‌کند.',
    receiptHeading: 'اعتبارنامهٔ پیگیری شما',
    receiptWarning:
      'همین حالا یادداشت کنید. فقط یک بار نمایش داده می‌شود و تنها راه بررسی گزارش یا پس‌گرفتن رضایت است.',
    receiptCopy: 'رونوشت اعتبارنامه',
    receiptCopied: 'رونوشت شد',
    receiptNoUrl:
      'آن را در پیام یا نشانی اینترنتی قرار ندهید. هر کس آن را داشته باشد می‌تواند وضعیت گزارش شما را ببیند و رضایت را پس بگیرد.',
    receiptRetention: 'حذف زمان‌بندی‌شده',
    duplicatesHeading: 'احتمالاً همان رویداد',
    duplicatesBody:
      'این گزارش‌ها از نظر مکان و زمان نزدیک به‌نظر می‌رسند. چیزی ادغام نشده است: متولی تصمیم می‌گیرد و تصمیم قابل بازگشت است.',
    duplicateItem: 'تکراری احتمالی',
    duplicateDistance: 'فاصله',
    duplicateTime: 'اختلاف زمان',
    errorHeading: 'گزارش ذخیره نشد',
    errorConsent: 'رضایت لازم است.',
    errorRate: 'در بازهٔ اخیر گزارش‌های زیادی از این دستگاه ثبت شده است. بعداً تلاش کنید.',
    errorClosed: 'ثبت گزارش در حال حاضر بسته است.',
    errorGeneric: 'ارسال ناموفق بود',
    offline: 'به‌نظر می‌رسد اتصال ندارید. چیزی ارسال نشد و ورودی شما باقی مانده است.',
    requiredMark: 'الزامی',

    trackingTitle: 'بررسی گزارش شما',
    trackingIntro: 'اعتبارنامه‌ای را که هنگام ارسال ذخیره کرده‌اید وارد کنید.',
    trackingCredentialLabel: 'اعتبارنامهٔ پیگیری',
    trackingCheck: 'بررسی وضعیت',
    trackingChecking: 'در حال بررسی…',
    trackingStatusHeading: 'وضعیت فعلی',
    trackingOnlyStatus:
      'این نما فقط وضعیت، ناحیهٔ درشت و تاریخ نگهداری را برمی‌گرداند. مختصات دقیق و اطلاعات دیگر گزارشگران هرگز نمایش داده نمی‌شود.',
    trackingNotFound: 'این اعتبارنامه شناخته نشد. آن را بررسی کنید و دوباره تلاش کنید.',
    trackingRateLimited: 'تلاش‌های زیاد. یک دقیقه صبر کنید و دوباره تلاش کنید.',
    trackingPublished: 'در تجمیع منتشرشده گنجانده شده است',
    trackingNotPublished: 'منتشر نشده است. انتشار نیازمند تأیید جداگانه و حد کمینهٔ سلول است.',
    trackingCanWithdraw: 'درخواست حذف',
    trackingWithdrawTitle: 'حذف گزارش و پس‌گرفتن رضایت',
    trackingWithdrawReason: 'دلیل (اختیاری)',
    trackingWithdrawConfirm: 'پس‌گرفتن رضایت و حذف',
    trackingWithdrawCancel: 'گزارش بماند',
    trackingWithdrawn: 'رضایت پس گرفته شد. گزارش دیگر قابل خواندن نیست و درخواست حذف ثبت شد.',
    trackingMergedInto: 'ادغام‌شده در',
    close: 'بستن',
    back: 'بازگشت',
  },
} as const;

export function getPilotText(language: Language) {
  return PILOT[language];
}

export type PilotText = ReturnType<typeof getPilotText>;
