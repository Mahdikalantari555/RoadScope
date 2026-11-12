# RoadScope OpenSpec

این پوشه مشخصات **پیشنهادی** پروژه را نگه می‌دارد. برنامهٔ کلی، وابستگی‌ها و تطبیق شکاف‌های مرور ادبیات در [برنامهٔ جامع](../IMPLEMENTATION_PLAN_FA.md) است. فایل‌های `specs/` داخل هر change «delta» هستند؛ تا زمان پیاده‌سازی، آزمون و archive، ادعای قابلیت فعلی نیستند. پوشهٔ اصلی `specs/` عمداً برای مشخصات پذیرفته‌شده پس از archive خالی است.

## تغییرات پیشنهادی

| Change | موضوع |
|---|---|
| [roadscope-foundation](changes/roadscope-foundation/) | ایمنی داده، امنیت، برند و زیرساخت |
| [roadscope-experience](changes/roadscope-experience/) | تجربهٔ نقشه‌محور دوزبانهٔ فارسی/انگلیسی |
| [directed-network-diffusion](changes/directed-network-diffusion/) | شبکهٔ جهت‌دار و پخش حرارتی |
| [spatiotemporal-adaptive-tnkde](changes/spatiotemporal-adaptive-tnkde/) | چگالی فضایی–زمانی و LOO-LCV |
| [vgi-bias-and-uncertainty](changes/vgi-bias-and-uncertainty/) | سوگیری گزارش و تخصیص احتمالی |
| [network-hawkes-cascades](changes/network-hawkes-cascades/) | تصادفات ثانویه و هاوکس |
| [safety-bayes-and-decisions](changes/safety-bayes-and-decisions/) | EB، CURE، BYM2 و ارزش اطلاعات |
| [surrogate-safety-fusion](changes/surrogate-safety-fusion/) | شاخص‌های جایگزین ایمنی |
| [reproducible-research-benchmarks](changes/reproducible-research-benchmarks/) | محک‌زنی چندبذری، چندمقیاسه و PAI |
| [advanced-network-research](changes/advanced-network-research/) | روش‌های تکمیلی Voronoi، link–node، HMM و GNN |
| [generalized-study-areas](changes/generalized-study-areas/) | مناطق مطالعاتی و درون‌ریزی شبکه؛ نیازمند بررسی ایمنی |
| [tehran-synthetic-demo](changes/tehran-synthetic-demo/) | شبکهٔ واقعی مرکز تهران و تصادفات مصنوعی برای ارائه |
| [tehran-citizen-reporting](changes/tehran-citizen-reporting/) | گزارش واقعی شهروندی، بازبینی و حریم خصوصی؛ مستقل از دادهٔ مصنوعی |
| [frontend-experience-improvements](changes/frontend-experience-improvements/) | راهنما، جزئیات، فیلترها و نمای ارائه با الگوهای منتخب نمونه‌ها |

هر change شامل `proposal.md`، `design.md`، `tasks.md` و یک delta spec با سناریوهای پذیرش است. چک‌باکس‌های باز به معنای کارهای انجام‌نشده هستند. نام، وابستگی و ترتیب را با برنامه تطبیق دهید؛ اجرای یک change نباید قابلیت change دیگر را به‌طور ضمنی تکمیل فرض کند.

## ابزار و گردش کار

با Node.js و دسترسی به npm، نسخهٔ بررسی‌شدهٔ CLI را بدون نصب سراسری اجرا کنید:

```bash
OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@2.0.0 list
OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@2.0.0 status --change roadscope-foundation
OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@2.0.0 validate --all --strict --no-interactive
```

پس از پیاده‌سازی، تکمیل آزمون‌ها و چک‌لیست و تأیید تغییر، آن را با CLI به archive منتقل کنید تا دلتا به مشخصات اصلی اعمال شود. به‌خاطر وابستگی‌های بین تغییرات، پیش از شروع هر change، طرح و قراردادهای پیش‌نیاز را بررسی کنید.
