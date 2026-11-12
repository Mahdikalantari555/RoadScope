import { describe, expect, it } from 'vitest';
import { escapeHtml, safeHexColor } from './html';

describe('untrusted map popup data', () => {
  it('escapes HTML including attribute delimiters and ampersands', () => {
    expect(escapeHtml(`<img src=x onerror="alert('XSS')"> &`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;XSS&#39;)&quot;&gt; &amp;'
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
  it('only permits short and long hex colors in inline CSS', () => {
    expect(safeHexColor('#ABC')).toBe('#ABC');
    expect(safeHexColor('#123abc')).toBe('#123abc');
    expect(safeHexColor('red; background:url(https://example.com)')).toBe('#38bdf8');
    expect(safeHexColor('#fff" onmouseover="alert(1)')).toBe('#38bdf8');
  });
});
