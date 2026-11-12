import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n';
import { setApiToken } from '../api/client';

export function ResearchAccess() {
  const { t, locale } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/research/capabilities', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <button
        type="button"
        className="px-2 py-1 border border-slate-700 rounded text-xs hover:border-cyan-400/70"
        onClick={() => {
          if (typeof dialog.current?.showModal === 'function') {
            dialog.current.showModal();
          } else {
            dialog.current?.setAttribute('open', '');
          }
        }}
      >
        {t('research')}
      </button>
      <dialog
        ref={dialog}
        className="rounded-md p-5 max-w-xl w-[95vw] max-h-[85vh] overflow-auto bg-slate-900 text-slate-100 border border-slate-700"
        aria-labelledby="research-title"
      >
        <h2 id="research-title" className="font-bold text-base">
          {t('research')}
        </h2>
        <p className="my-2.5 text-xs opacity-90">{t('notice')}</p>
        <p className="my-2.5 text-xs text-amber-300">{t('auth')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApiToken(token);
            setToken('');
          }}
          className="space-y-2"
        >
          <label className="block text-xs">
            {t('token')}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className="block w-full mt-1 bg-slate-950 border border-slate-700 rounded p-2 font-mono text-xs"
            />
          </label>
          <div className="flex gap-2">
            <button className="border border-cyan-500/60 bg-cyan-500/20 rounded px-3 py-1.5 text-xs" type="submit">
              {t('save')}
            </button>
            <button
              className="border border-slate-700 rounded px-3 py-1.5 text-xs"
              type="button"
              onClick={() => {
                setApiToken('');
                setToken('');
              }}
            >
              {t('clear')}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="text-rose-400 text-xs mt-3">
            {t('failed')}
          </p>
        )}
        {data && (
          <div className="text-xs my-4 space-y-3">
            <div>
              <h3 className="font-semibold text-cyan-300">{t('available')}</h3>
              <p dir="ltr" className="font-mono text-[11px] opacity-90 mt-0.5">
                {(data.available || []).join(', ')}
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-slate-300">{t('primitives')}</h3>
              <p dir="ltr" className="font-mono text-[11px] opacity-80 mt-0.5">
                {(data.primitives_only || []).join(', ')}
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-amber-300">{t('unavailable')}</h3>
              <ul className="space-y-1.5 mt-1">
                {Object.entries(data.unavailable || {}).map(([key, value]: [string, any]) => (
                  <li key={key}>
                    <bdi className="font-mono text-amber-200">{key}</bdi>:{' '}
                    {value?.reason?.[locale] ?? String(value)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <button
          type="button"
          className="border border-slate-600 rounded px-3 py-1.5 text-xs"
          onClick={() => dialog.current?.close()}
        >
          {t('close')}
        </button>
      </dialog>
    </>
  );
}
