import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, parseStoredFilters, usePersistedFilters } from './usePersistedFilters';

afterEach(() => localStorage.clear());

describe('parseStoredFilters', () => {
  it('returns null for absent, malformed or non-object payloads', () => {
    expect(parseStoredFilters(null)).toBeNull();
    expect(parseStoredFilters('{not json')).toBeNull();
    expect(parseStoredFilters('"a string"')).toBeNull();
    expect(parseStoredFilters('[1,2,3]')).toBeNull();
  });

  it('drops fields whose type or shape the API would reject', () => {
    const parsed = parseStoredFilters(
      JSON.stringify({
        verification_mode: 'not_a_mode',
        severity_codes: ['FATAL', 7, null],
        hour_filter: 'noon',
        bbox_4326: [1, 2, 3],
        polygon_4326: [[1, 2]],
        segment_id: 'twelve',
      })
    );
    expect(parsed?.verification_mode).toBe('verified_only');
    expect(parsed?.severity_codes).toEqual(['FATAL']);
    expect(parsed?.hour_filter).toBeNull();
    expect(parsed?.bbox_4326).toBeNull();
    expect(parsed?.polygon_4326).toBeNull();
    expect(parsed?.segment_id).toBeNull();
  });

  it('keeps a valid polygon and bounding box', () => {
    const parsed = parseStoredFilters(
      JSON.stringify({ bbox_4326: [51.3, 35.6, 51.5, 35.8], polygon_4326: [[1, 2], [3, 4], [5, 6]] })
    );
    expect(parsed?.bbox_4326).toEqual([51.3, 35.6, 51.5, 35.8]);
    expect(parsed?.polygon_4326).toEqual([[1, 2], [3, 4], [5, 6]]);
  });
});

describe('usePersistedFilters', () => {
  it('round-trips filters inside the same dataset scope', () => {
    const first = renderHook(() => usePersistedFilters(1));
    act(() => first.result.current.setFilters({ ...EMPTY_FILTERS, hour_filter: 8, severity_codes: ['FATAL'] }));
    first.unmount();

    const second = renderHook(() => usePersistedFilters(1));
    expect(second.result.current.filters.hour_filter).toBe(8);
    expect(second.result.current.filters.severity_codes).toEqual(['FATAL']);
  });

  it('does not carry one dataset’s filters into another', () => {
    const first = renderHook(() => usePersistedFilters(1));
    act(() => first.result.current.setFilters({ ...EMPTY_FILTERS, category_codes: ['REAR_END'] }));
    first.unmount();

    const other = renderHook(() => usePersistedFilters(2));
    expect(other.result.current.filters).toEqual(EMPTY_FILTERS);
  });

  it('clears everything on resetForScope while keeping the scope', () => {
    const hook = renderHook(() => usePersistedFilters(3));
    act(() => hook.result.current.setFilters({ ...EMPTY_FILTERS, segment_id: 12, verification_mode: 'all_active' }));
    act(() => hook.result.current.resetForScope());
    expect(hook.result.current.filters).toEqual(EMPTY_FILTERS);
  });

  it('survives a storage failure without losing in-memory filters', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };
    try {
      const hook = renderHook(() => usePersistedFilters(4));
      act(() => hook.result.current.setFilters({ ...EMPTY_FILTERS, hour_filter: 5 }));
      expect(hook.result.current.filters.hour_filter).toBe(5);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
