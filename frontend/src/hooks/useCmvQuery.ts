import { useCallback, useEffect, useState } from 'react';
import { uaiApi } from '../api/client';
import type { CmvFilterState, CmvStatePayload } from '../types/uai';

type QueryState = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  data: CmvStatePayload | null;
  error: string | null;
};

/** Never present a response for a previous dataset or filter selection as current. */
export function useCmvQuery(datasetId: number | undefined, filters: CmvFilterState) {
  const key = JSON.stringify([datasetId ?? null, filters]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<QueryState>({ key: '', status: 'loading', data: null, error: null });
  const refresh = useCallback(() => setRevision(current => current + 1), []);

  useEffect(() => {
    let current = true;
    setState({ key, status: 'loading', data: null, error: null });
    if (datasetId === undefined) return () => { current = false; };
    uaiApi.queryCmv(datasetId, filters).then(
      data => { if (current) setState({ key, status: 'ready', data, error: null }); },
      error => { if (current) setState({ key, status: 'error', data: null, error: error instanceof Error ? error.message : 'Request failed' }); },
    );
    return () => { current = false; };
    // key captures the complete filter values without re-querying for equivalent object identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, key, revision]);

  const visible = state.key === key ? state : { key, status: 'loading' as const, data: null, error: null };
  return { ...visible, refresh };
}
