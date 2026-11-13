import type { ThemeMode } from '@/lib/theme-types';

/**
 * The public event page's colours for the event's mode (its editor's Appearance step): light,
 * dark, or auto (the visitor's device setting). Set as CSS variables on the page's wrapper; every
 * event component reads them with its light colour as the fallback, so the same components still
 * render normally anywhere outside an event page (the /events list, the products store).
 */
const LIGHT = {
  bg: '#F9FAFB', surface: '#ffffff', text: '#0f172a', body: '#334155', body2: '#475569',
  muted: '#64748b', faint: '#94a3b8', soft: '#f1f5f9', line: '#e2e8f0',
};
const DARK = {
  bg: '#0f141c', surface: '#171d27', text: '#f1f5f9', body: '#cbd5e1', body2: '#a9b4c4',
  muted: '#94a3b8', faint: '#64748b', soft: '#232b37', line: '#2a3341',
};

const vars = (t: typeof LIGHT) => Object.entries(t).map(([k, v]) => `--ev-${k}:${v};`).join('');

/** The stylesheet for .event-theme wrappers, keyed by data-mode. */
export const EVENT_THEME_CSS = [
  `.event-theme{${vars(LIGHT)}}`,
  `.event-theme[data-mode="dark"]{${vars(DARK)}color-scheme:dark;}`,
  `@media (prefers-color-scheme: dark){.event-theme[data-mode="auto"]{${vars(DARK)}color-scheme:dark;}}`,
].join('\n');

export function toThemeMode(value: unknown): ThemeMode {
  return value === 'dark' || value === 'auto' ? value : 'light';
}

/** Black or white, whichever reads better on the given #rgb or #rrggbb colour. */
export function textOn(hex: string): string {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#0f172a' : '#ffffff';
}
