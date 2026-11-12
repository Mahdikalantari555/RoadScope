import React, { useRef } from 'react';
import { useLanguage } from '../i18n';

export function MethodsHelp() {
  const { language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const fa = language === 'fa';
  return <>
    <button type="button" className="px-2 py-1 border border-slate-700 rounded text-xs hover:border-cyan-400/70"
      onClick={() => dialog.current?.showModal()}>{fa ? 'راهنمای کاربردی' : 'Practical guide'}</button>
    <dialog ref={dialog} aria-labelledby="methods-help-title" className="rounded-md p-5 max-w-xl w-[95vw] max-h-[85vh] overflow-auto bg-slate-900 text-slate-100 border border-slate-700">
      <h2 id="methods-help-title" className="font-bold text-base">{fa ? 'راهنمای کاربردی RoadScope' : 'Using RoadScope'}</h2>
      <div className="space-y-3 text-sm mt-3 leading-relaxed">
        <p>{fa ? 'از تحلیل هماهنگ شروع کنید: روی نقشه قطعه‌ای را انتخاب کنید یا با فیلترها بازه و نوع رخداد را محدود کنید. نقشه و نمودارها داده‌های فیلترشده را نشان می‌دهند.' : 'Start in coordinated analytics: select a road segment on the map or filter by time and incident type. The map and charts show the filtered data.'}</p>
        <p>{fa ? 'چگالی شبکه‌ای (NKDE) تجمع رخدادها را در امتداد راه‌ها نشان می‌دهد؛ مقدار آن به تنظیمات، طول راه و کیفیت داده وابسته است، نه احتمال تصادف.' : 'Network KDE (NKDE) shows the concentration of incidents along roads. Its value depends on settings, road length and data quality; it is not a crash probability.'}</p>
        <p>{fa ? 'برآورد بیز تجربی و PSI برای بررسی تفاوت بین تعداد مشاهده‌شده و تعداد مورد انتظار به کار می‌روند؛ نتیجه به کیفیت داده و مدل بستگی دارد.' : 'Empirical Bayes estimates and PSI help compare observed and expected counts; results depend on the model and data quality.'}</p>
        <p className="text-amber-300">{fa ? 'داده‌های مصنوعی برای نمایش و آزمون‌اند و محل یا میزان خطر واقعی را نشان نمی‌دهند. بدون دادهٔ معتبر تردد و اعتبارسنجی محلی، نتایج مبنای قطعی تصمیم اجرایی نیستند.' : 'Synthetic data are for demonstration and testing, not actual crash locations or risk. Without reliable exposure data and local validation, outputs are not a basis for operational decisions.'}</p>
      </div>
      <form method="dialog" className="mt-4"><button className="rounded border border-slate-600 px-3 py-1 text-sm">{fa ? 'بستن' : 'Close'}</button></form>
    </dialog>
  </>;
}
