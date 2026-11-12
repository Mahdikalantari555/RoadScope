import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uaiApi } from '../api/client';
import type { CmvFilterState, CmvStatePayload } from '../types/uai';
import { useCmvQuery } from './useCmvQuery';

const filters: CmvFilterState = { verification_mode: 'verified_only', start_utc: null, end_utc: null,
  severity_codes: [], category_codes: [], dow_filter: null, hour_filter: null,
  segment_id: null, bbox_4326: null, polygon_4326: null };
const result = (n: number) => ({ kpis: { filtered_incidents: n } }) as CmvStatePayload;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(() => vi.restoreAllMocks());

describe('useCmvQuery', () => {
  it('shows only the latest filter or dataset response, even if older requests finish last', async () => {
    const old = deferred<CmvStatePayload>(), next = deferred<CmvStatePayload>();
    vi.spyOn(uaiApi, 'queryCmv').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const hook = renderHook(({ id, selection }) => useCmvQuery(id, selection), { initialProps: { id: 1, selection: filters } });
    hook.rerender({ id: 2, selection: { ...filters, severity_codes: ['FATAL'] } });
    expect(hook.result.current.status).toBe('loading');
    await act(async () => { next.resolve(result(2)); await next.promise; });
    expect(hook.result.current.data?.kpis.filtered_incidents).toBe(2);
    await act(async () => { old.resolve(result(1)); await old.promise; });
    expect(hook.result.current.data?.kpis.filtered_incidents).toBe(2);
  });

  it('clears stale data on error and supports retry', async () => {
    const retry = deferred<CmvStatePayload>();
    vi.spyOn(uaiApi, 'queryCmv').mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise);
    const hook = renderHook(() => useCmvQuery(1, filters));
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBe('offline');
    expect(hook.result.current.data).toBeNull();
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.status).toBe('loading'));
    await act(async () => { retry.resolve(result(3)); await retry.promise; });
    expect(hook.result.current.data?.kpis.filtered_incidents).toBe(3);
  });

  it('does not refetch for an equivalent filter object', async () => {
    const query = vi.spyOn(uaiApi, 'queryCmv').mockResolvedValue(result(1));
    const hook = renderHook(({ selection }) => useCmvQuery(1, selection), { initialProps: { selection: filters } });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    hook.rerender({ selection: { ...filters, severity_codes: [] } });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
