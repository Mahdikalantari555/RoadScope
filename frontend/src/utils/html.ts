/** Escape untrusted GeoJSON properties before inserting into markup. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]!
  );
}

/** Inline style accepts only hexadecimal colors, never arbitrary CSS. */
export function safeHexColor(value: unknown, fallback = '#38bdf8'): string {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value : fallback;
}
