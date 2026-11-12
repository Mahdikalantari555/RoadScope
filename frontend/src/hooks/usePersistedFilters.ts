import { useCallback, useEffect, useRef, useState } from 'react';
import type { CmvFilterState } from '../types/uai';

const STORAGE_KEY = 'roadscope.filters.v1';

export const EMPTY_FILTERS: CmvFilterState = {
  verification_mode: 'verified_only',
  start_utc: null,
  end_utc: null,
  severity_codes: [],
  category_codes: [],
  dow_filter: null,
  hour_filter: null,
  segment_id: null,
  bbox_4326: null,
  polygon_4326: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a stored filter object.
 *
 * Persisted state is user-controlled input: a corrupted or older entry must degrade to "no
 * filters" rather than producing a query for a shape the API would reject. Every field is
 * therefore type-checked and anything unrecognised is dropped.
 */
export function parseStoredFilters(raw: string | null): CmvFilterState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const mode = parsed.verification_mode;
  const out: CmvFilterState = {
    ...EMPTY_FILTERS,
    verification_mode:
      mode === 'verified_only' || mode === 'all_active' || mode === 'vgi_queue'
        ? mode
        : EMPTY_FILTERS.verification_mode,
    start_utc: typeof parsed.start_utc === 'string' ? parsed.start_utc : null,
    end_utc: typeof parsed.end_utc === 'string' ? parsed.end_utc : null,
    severity_codes: Array.isArray(parsed.severity_codes)
      ? parsed.severity_codes.filter((c): c is string => typeof c === 'string')
      : [],
    category_codes: Array.isArray(parsed.category_codes)
      ? parsed.category_codes.filter((c): c is string => typeof c === 'string')
      : [],
    dow_filter: typeof parsed.dow_filter === 'number' ? parsed.dow_filter : null,
    hour_filter: typeof parsed.hour_filter === 'number' ? parsed.hour_filter : null,
    segment_id: typeof parsed.segment_id === 'number' ? parsed.segment_id : null,
    bbox_4326:
      Array.isArray(parsed.bbox_4326) &&
      parsed.bbox_4326.length === 4 &&
      parsed.bbox_4326.every((n) => typeof n === 'number')
        ? (parsed.bbox_4326 as [number, number, number, number])
        : null,
    polygon_4326:
      Array.isArray(parsed.polygon_4326) &&
      parsed.polygon_4326.length >= 3 &&
      parsed.polygon_4326.every(
        (pair) => Array.isArray(pair) && pair.length === 2 && pair.every((n) => typeof n === 'number')
      )
        ? (parsed.polygon_4326 as [number, number][])
        : null,
  };
  return out;
}

/**
 * Filter state that survives a reload (task 2.3 / contract `filters_persisted`).
 *
 * Only *filters* are persisted — never a dataset selection, a credential or a token. A stored
 * filter is additionally scoped to the dataset it was recorded for, so switching from the Tehran
 * demo to a legacy Frankfurt dataset cannot silently apply Tehran categories to it.
 */
export function usePersistedFilters(scope: string | number | null) {
  const scopeKey = scope === null ? 'none' : String(scope);
  const [filters, setFilters] = useState<CmvFilterState>(() => {
    try {
      const stored = parseStoredFilters(localStorage.getItem(STORAGE_KEY));
      if (!stored) return EMPTY_FILTERS;
      const storedScope = localStorage.getItem(`${STORAGE_KEY}.scope`);
      return storedScope === scopeKey ? stored : EMPTY_FILTERS;
    } catch {
      return EMPTY_FILTERS;
    }
  });
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const restoredRef = useRef(false);

  useEffect(() => {
    // Storage can be blocked (private mode, embedded webview). Persistence is a convenience, not
    // a requirement, so a failure is silent.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
      localStorage.setItem(`${STORAGE_KEY}.scope`, scopeKey);
    } catch {
      /* storage unavailable */
    }
    restoredRef.current = true;
  }, [filters, scopeKey]);

  /** Drop filters that belong to a different dataset (called on an explicit dataset switch). */
  const resetForScope = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  return { filters, setFilters, resetForScope };
}
