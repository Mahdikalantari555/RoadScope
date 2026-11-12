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
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(true); });
    return () => controller.abort();
  }, []);
  return <>
    <button className="px-2 py-1 border rounded text-xs" onClick={() => dialog.current?.showModal()}>{t('research')}</button>
    <dialog ref={dialog} className="rounded p-5 max-w-xl w-[95vw] max-h-[85vh] overflow-auto bg-slate-900 text-slate-100" aria-labelledby="research-title">
      <h2 id="research-title" className="font-bold">{t('research')}</h2>
      <p className="my-3 text-sm">{t('notice')}</p>
      <p className="my-3 text-sm">{t('auth')}</p>
      <form onSubmit={e => { e.preventDefault(); setApiToken(token); setToken(''); }}>
        <label className="block text-sm">{t('token')}<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" className="block w-full my-2 bg-slate-800 border rounded p-2" /></label>
        <button className="border rounded p-2 text-sm" type="submit">{t('save')}</button>{' '}
        <button className="border rounded p-2 text-sm" type="button" onClick={() => { setApiToken(''); setToken(''); }}>{t('clear')}</button>
      </form>
      {error && <p role="alert">{t('failed')}</p>}
      {data && <div className="text-sm my-4 space-y-3">
        <h3>{t('available')}</h3><p dir="ltr">{data.available.join(', ')}</p>
        <h3>{t('primitives')}</h3><p dir="ltr">{data.primitives_only.join(', ')}</p>
        <h3>{t('unavailable')}</h3><ul className="space-y-2">{Object.entries(data.unavailable).map(([key, value]: [string, any]) => <li key={key}><bdi>{key}</bdi>: {value.reason[locale]}</li>)}</ul>
      </div>}
      <button className="border rounded p-2" onClick={() => dialog.current?.close()}>{t('close')}</button>
    </dialog>
  </>;
}
