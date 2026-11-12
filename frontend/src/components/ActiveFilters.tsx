import React from 'react';
import { X } from 'lucide-react';
import type { CmvFilterState } from '../types/uai';
import { useLanguage } from '../i18n';
import { domainLabel } from '../analyticsI18n';

interface FilterChip {
  key: string;
  label: string;
  clear: () => void;
}

/**
 * Single source of truth for "which filters are active".
 *
 * The chips, the presentation-mode summary line and the screen-reader announcement all read from
 * this one function, so a filter can never be visible in one place and invisible in another.
 */
export function activeFilterChips(
  language: 'en' | 'fa',
  filters: CmvFilterState,
  onUpdate: (patch: Partial<CmvFilterState>) => void
): FilterChip[] {
  const fa = language === 'fa';
  const items: FilterChip[] = [];

  if (filters.verification_mode !== 'verified_only') {
    items.push({
      key: 'verification',
      label:
        filters.verification_mode === 'all_active'
          ? fa
            ? 'وضعیت: تأییدشده و تأییدنشده'
            : 'Status: confirmed and unverified'
          : fa
            ? 'وضعیت: صف گزارش‌های تأییدنشده'
            : 'Status: unverified queue only',
      clear: () => onUpdate({ verification_mode: 'verified_only' }),
    });
  }
  if (filters.start_utc || filters.end_utc) {
    items.push({
      key: 'date',
      label: `${fa ? 'بازه' : 'Dates'}: ${filters.start_utc?.slice(0, 10) ?? '…'} → ${filters.end_utc?.slice(0, 10) ?? '…'}`,
      clear: () => onUpdate({ start_utc: null, end_utc: null }),
    });
  }
  filters.severity_codes.forEach((code) =>
    items.push({
      key: `severity-${code}`,
      label: `${fa ? 'شدت' : 'Severity'}: ${domainLabel(language, code, code)}`,
      clear: () => onUpdate({ severity_codes: filters.severity_codes.filter((c) => c !== code) }),
    })
  );
  filters.category_codes.forEach((code) =>
    items.push({
      key: `category-${code}`,
      label: `${fa ? 'نوع' : 'Type'}: ${domainLabel(language, code, code)}`,
      clear: () => onUpdate({ category_codes: filters.category_codes.filter((c) => c !== code) }),
    })
  );
  if (filters.dow_filter !== null) {
    items.push({
      key: 'day',
      label: `${fa ? 'روز هفته' : 'Weekday'}: ${filters.dow_filter}`,
      clear: () => onUpdate({ dow_filter: null }),
    });
  }
  if (filters.hour_filter !== null) {
    items.push({
      key: 'hour',
      label: `${fa ? 'ساعت' : 'Hour'}: ${String(filters.hour_filter).padStart(2, '0')}:00`,
      clear: () => onUpdate({ hour_filter: null }),
    });
  }
  if (filters.segment_id !== null) {
    items.push({
      key: 'segment',
      label: `${fa ? 'قطعه' : 'Segment'} #${filters.segment_id}`,
      clear: () => onUpdate({ segment_id: null }),
    });
  }
  if (filters.bbox_4326) {
    items.push({
      key: 'bbox',
      label: fa ? 'محدودهٔ مستطیلی' : 'Bounding box',
      clear: () => onUpdate({ bbox_4326: null }),
    });
  }
  if (filters.polygon_4326) {
    items.push({
      key: 'polygon',
      label: fa ? 'محدودهٔ چندضلعی' : 'Polygon',
      clear: () => onUpdate({ polygon_4326: null }),
    });
  }
  return items;
}

/** One-line human summary used by the presentation frame and the screen-reader status. */
export function describeFilters(language: 'en' | 'fa', filters: CmvFilterState): string {
  const labels = activeFilterChips(language, filters, () => {}).map((chip) => chip.label);
  return labels.join(', ');
}

interface Props {
  filters: CmvFilterState;
  onUpdate: (patch: Partial<CmvFilterState>) => void;
  onReset: () => void;
  /** Optional: scroll/focus the map when the user asks to clear a spatial filter. */
  compact?: boolean;
}

export function ActiveFilters({ filters, onUpdate, onReset, compact = false }: Props) {
  const { language } = useLanguage();
  const fa = language === 'fa';
  const items = activeFilterChips(language, filters, onUpdate);

  return (
    <section
      aria-label={fa ? 'فیلترهای فعال' : 'Active filters'}
      className={`${
        compact ? 'flex flex-wrap items-center gap-1.5 text-[10px]' : 'flex flex-wrap items-center gap-1.5 text-xs border rounded-md p-2 border-slate-500/40'
      }`}
    >
      <strong>{fa ? 'فیلترهای فعال:' : 'Active filters:'}</strong>
      {items.length === 0 && <span className="opacity-70">{fa ? 'هیچ‌کدام' : 'None'}</span>}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.clear}
          aria-label={`${fa ? 'حذف فیلتر' : 'Remove filter'}: ${item.label}`}
          className="rounded border border-cyan-500/40 px-2 py-1 hover:bg-cyan-500/20 flex items-center gap-1"
        >
          <bdi>{item.label}</bdi>
          <X className="w-2.5 h-2.5" aria-hidden="true" />
        </button>
      ))}
      {items.length > 0 && (
        <button
          type="button"
          className="underline px-1"
          onClick={onReset}
          aria-label={fa ? 'پاک‌کردن همهٔ فیلترها' : 'Clear all filters'}
        >
          {fa ? 'پاک‌کردن همه' : 'Clear all'}
        </button>
      )}
    </section>
  );
}
