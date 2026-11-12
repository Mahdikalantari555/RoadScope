# تصاویر ارائهٔ فارسی RoadScope

این پوشه تصاویر شش پنل ارائه را نگه می‌دارد:

| فایل | پنل برنامه | منبع داده |
| --- | --- | --- |
| `01_analytics_cmv_fa.png` | تحلیل هماهنگ چندنمایه | `POST /analytics/cmv` + `GET /network/layers` |
| `02_spatial_lab_nkde_fa.png` | آزمایشگاه مکانی (NKDE) | `POST /lab/nkde` |
| `03_spatial_lab_maup_fa.png` | حساسیت MAUP | `POST /research/maup-sensitivity` + لایهٔ لیکسل `/lab/nkde` |
| `04_risk_eb_bym2_surrogate_fa.png` | ریسک و استنباط بیزی (BYM2) | `POST /research/bym2` |
| `05_stewardship_vgi_fa.png` | تولی‌گری VGI | `POST /analytics/cmv` + `POST /research/bym2` |
| `06_simulator_hawkes_fa.png` | شبیه‌ساز هاکس | `POST /research/hawkes` |

`tehran-synthetic-preview.png` جدا از این شش تصویر است و نمای محدودهٔ نمونهٔ تهران را نشان می‌دهد.

## چرا تصویر «بازسازی‌شده» است و نه «عکس مرورگر»

تصاویر قبلی این ارائه از اجرای قدیمی فرانکفورت (`EPSG:25832`) گرفته شده بودند و پس از تغییر
پیش‌فرض برنامه به نمونهٔ مصنوعی تهران (`EPSG:32639`) دیگر با وضعیت فعلی برنامه نمی‌خواندند.

در محیط ساخت این مخزن هیچ مرورگر headless در دسترس نیست
(`playwright install chromium`، `@sparticuz/chromium` و Electron هر سه ناموفق بودند)، بنابراین
عکس تازه از رابط کاربری ممکن نبود. در نتیجه به‌جای ویرایش دستی یک تصویر قدیمی — که رابطی را
نشان می‌داد که هرگز رندر نشده است — همان پنل‌ها از **پاسخ‌های ثبت‌شدهٔ API** بازکشیده می‌شوند:

* هر عدد داخل تصویر مستقیماً از پاسخ API خوانده می‌شود؛ هیچ عددی در اسکریپت نوشته نشده است.
* هر تصویر در پانویس خود اعلام می‌کند که «بازسازی داده‌محور» است و عکس مرورگر نیست.
* برچسب «دادهٔ مصنوعی» روی هر شش تصویر کشیده می‌شود.
* قلم فارسی `Vazirmatn` (مجوز SIL OFL، در `docs/presentation/fonts/`) همان قلم برنامه است و
  متن فارسی با شکل‌دهی و ترتیب دوجهته درست رسم می‌شود؛ اصطلاحات فنی لاتین ترتیب خود را نگه می‌دارند.

## بازتولید

پیش‌نیاز (فقط برای همین اسکریپت؛ CI به آن نیاز ندارد):

```bash
.venv/bin/pip install pillow arabic-reshaper python-bidi
```

```bash
# ۱) ثبت پاسخ‌های API از پایگاه دادهٔ نمونهٔ تهران (نه از فایل ردیابی‌شدهٔ data/uai.sqlite)
ROADSCOPE_SQLITE_PATH=/tmp/rs_cold/uai.sqlite ROADSCOPE_DEMO_MODE=true \
PYTHONPATH=backend .venv/bin/python - <<'PY'
import json
from fastapi.testclient import TestClient
from app.main import app
out = {}
with TestClient(app) as c:                     # اولین اجرا، نمونهٔ مصنوعی تهران را seed می‌کند
    out["cmv"] = c.post("/api/v1/analytics/cmv", json={"verified_only": True}).json()
    out["nkde"] = c.post("/api/v1/lab/nkde", json={}).json()
    out["bym2"] = c.post("/api/v1/research/bym2", json={}).json()
    out["hawkes"] = c.post("/api/v1/research/hawkes", json={}).json()
    out["maup"] = c.post("/api/v1/research/maup-sensitivity", json={}).json()
    net = c.get("/api/v1/network/layers?include_lixels=false").json()
    meta = c.get("/api/v1/meta").json()
json.dump(out, open("/tmp/tehran_api_out.json", "w"))
json.dump({"network": net, "meta_presentation": meta["presentation"]},
          open("/tmp/tehran_net.json", "w"))
PY

# ۲) کشیدن تصاویر
.venv/bin/python scripts/render_presentation_figures.py \
    --payloads /tmp/tehran_api_out.json \
    --network  /tmp/tehran_net.json \
    --out      docs/presentation/screenshots

# ۳) جای‌گذاری تصاویر داخل ارائه (۶ تصویر base64)
.venv/bin/python - <<'PY'
import base64, re, pathlib
html = pathlib.Path("docs/presentation/roadscope_presentation_fa.html")
s = html.read_text(encoding="utf-8")
names = ["01_analytics_cmv_fa.png", "02_spatial_lab_nkde_fa.png", "03_spatial_lab_maup_fa.png",
         "04_risk_eb_bym2_surrogate_fa.png", "05_stewardship_vgi_fa.png", "06_simulator_hawkes_fa.png"]
tags = list(re.finditer(r"<img\b[^>]*base64[^>]*>", s, re.S))
parts, last = [], 0
for tag, name in zip(tags, names):
    blob = base64.b64encode(pathlib.Path("docs/presentation/screenshots", name).read_bytes()).decode()
    parts += [s[last:tag.start()], f'<img src="data:image/png;base64,{blob}" alt="بازسازی داده‌محور پنل فارسی RoadScope از دادهٔ مصنوعی تهران" />']
    last = tag.end()
html.write_text("".join(parts) + s[last:], encoding="utf-8")
PY
```

## محدودیت‌ها

* تصاویر **رندر داده‌محور** هستند، نه عکس واقعی از مرورگر: چیدمان دقیق DOM، پویانمایی‌ها و
  حالت‌های تعاملی (هاور، دیالوگ جزئیات معبر) در آن‌ها نیست.
* اعداد از دادهٔ مصنوعی تهران می‌آیند و هیچ‌کدام اندازه‌گیری خطر واقعی نیستند.
* `POST /research/tnkde` با `slice_count` پیش‌فرض ۱۲ خطای محدودیت بار محاسباتی می‌دهد؛ برای همین
  در اسلایدهای تخصصی از پنل NKDE (نه TNKDE) استفاده شده است.
* در کلون تازه ۱۲۲ تست بک‌اند قابل اجراست؛ یکی از آن‌ها (`test_security.py`، سرو استاتیک) تا
  زمانی که بستهٔ فرانت‌اند ساخته نشده باشد skip می‌شود.
* هدف‌گیری دقیق برای داوری این است که هر عدد تصویر با فیلد هم‌نام خود در پاسخ API قابل
  راستی‌آزمایی باشد؛ اگر مدل یا بذر تغییر کرد، تصاویر باید با همین اسکریپت دوباره ساخته شوند.
