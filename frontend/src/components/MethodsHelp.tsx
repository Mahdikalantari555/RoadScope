import React, { useEffect, useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { useLanguage } from '../i18n';
import { getMethodsGuidance } from '../methodsGuidance';
import type { PresentationContext } from '../presentation';

interface Props {
  /** Dataset context, so the caveat reflects the *active* dataset rather than being hard-coded. */
  context?: PresentationContext | null;
  /** Optional method key to scroll to when the dialog opens. */
  focusKey?: string | null;
  buttonLabel?: string;
  className?: string;
}

export function MethodsHelp({ context, focusKey, buttonLabel, className }: Props) {
  const { language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const guidance = getMethodsGuidance(language);
  const fa = language === 'fa';

  // A synthetic dataset always shows the synthetic caveat; a real one shows the research caveat.
  const showSyntheticCaveat = context ? context.syntheticIncidents !== false : true;
  const researchOnly = context
    ? context.calibrationStatus === 'research_only' || context.calibrationStatus === 'uncalibrated'
    : true;

  useEffect(() => {
    const element = dialog.current;
    if (!element || !element.open || !focusKey) return;
    const target = element.querySelector<HTMLElement>(`[data-method-key="${focusKey}"]`);
    target?.scrollIntoView({ block: 'start' });
  }, [focusKey]);

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'px-2 py-1 border border-slate-700 rounded text-xs hover:border-cyan-400/70 flex items-center gap-1'
        }
        onClick={() => dialog.current?.showModal()}
      >
        <BookOpen className="w-3 h-3" aria-hidden="true" />
        {buttonLabel ?? (fa ? 'روش‌ها و واحدها' : 'Methods & units')}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="methods-help-title"
        className="rounded-md p-5 max-w-2xl w-[95vw] max-h-[85vh] overflow-auto bg-slate-900 text-slate-100 border border-slate-700"
      >
        <h2 id="methods-help-title" className="font-bold text-base">
          {guidance.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed opacity-90">{guidance.intro}</p>

        <div
          role="note"
          className="mt-3 rounded border border-amber-500/60 bg-amber-500/10 p-2.5 text-xs text-amber-200 leading-relaxed"
          data-testid="methods-synthetic-caveat"
        >
          {showSyntheticCaveat
            ? guidance.syntheticCaveat
            : fa
              ? 'این مجموعه‌داده واقعی است، اما تا تأیید کالیبراسیون و حریم خصوصی، خروجی‌ها پژوهشی‌اند و مبنای تصمیم عملیاتی نیستند.'
              : 'This dataset contains real reports, but until calibration and privacy approvals are recorded the outputs remain research-only and are not a basis for operational decisions.'}
          {showSyntheticCaveat && researchOnly && context && (
            <>
              {' '}
              <span dir="ltr" className="font-mono opacity-80">
                (calibration: {context.calibrationStatus})
              </span>
            </>
          )}
        </div>

        <h3 className="mt-4 text-sm font-semibold">{guidance.supportedHeading}</h3>
        <dl className="mt-1.5 space-y-3">
          {guidance.methods.map((method) => (
            <div
              key={method.key}
              data-method-key={method.key}
              className={`rounded border p-2.5 ${
                focusKey === method.key ? 'border-cyan-400/70 bg-cyan-500/5' : 'border-slate-700'
              }`}
            >
              <dt className="font-semibold text-sm">{method.title}</dt>
              <dd className="text-xs space-y-1 mt-1">
                <p className="opacity-90">{method.summary}</p>
                <p>
                  <span className="opacity-70">{fa ? 'واحد' : 'Unit'}: </span>
                  <bdi>{method.unit}</bdi>
                </p>
                <p>
                  <span className="opacity-70">{fa ? 'منبع داده' : 'Data source'}: </span>
                  <bdi>{method.source}</bdi>
                </p>
                <div>
                  <span className="opacity-70">{fa ? 'فرض‌ها' : 'Assumptions'}:</span>
                  <ul className="list-disc ms-5 mt-0.5 space-y-0.5">
                    {method.assumptions.map((assumption) => (
                      <li key={assumption}>
                        <bdi>{assumption}</bdi>
                      </li>
                    ))}
                  </ul>
                </div>
                <p>
                  <span className="opacity-70">{fa ? 'عدم‌قطعیت' : 'Uncertainty'}: </span>
                  <bdi>{method.uncertainty}</bdi>
                </p>
              </dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-4 text-sm font-semibold">{guidance.unsupportedHeading}</h3>
        <ul className="mt-1 list-disc ms-5 space-y-1 text-xs opacity-90">
          {guidance.unsupported.map((item) => (
            <li key={item}>
              <bdi>{item}</bdi>
            </li>
          ))}
        </ul>

        <form method="dialog" className="mt-4">
          <button className="rounded border border-slate-600 px-3 py-1 text-sm">{guidance.close}</button>
        </form>
      </dialog>
    </>
  );
}
