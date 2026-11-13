// Neutral theme type primitives -- pure string unions with no React/runtime dependency.
// These live here (not in a component, and not in lib/theme.ts which is a 'use client' hook
// module) so domain contracts like lib/course-schema.ts can reference them without pointing
// "up" into presentation code.

export type ThemeColor = 'forest' | 'lime' | 'emerald' | 'rose' | 'amber' | 'ocean';
export type ThemeMode = 'light' | 'dark' | 'auto';

/** The accent each theme colour stands for. Shared by both editors and the public event page. */
export const THEME_ACCENT_COLORS: Record<ThemeColor, string> = {
  forest:  '#00bf63',
  lime:    '#ADEE66',
  emerald: '#10b981',
  rose:    '#f43f5e',
  amber:   '#f59e0b',
  ocean:   '#3E93FF',
};

/**
 * Content's accent colour, by the editors' rule: its custom accent if it has a usable one, else
 * its theme's colour. Null when it has neither, so the caller can fall back to the site colour.
 */
export function accentColorFor(customAccent: unknown, theme: unknown): string | null {
  if (typeof customAccent === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(customAccent.trim())) return customAccent.trim();
  return typeof theme === 'string' && theme in THEME_ACCENT_COLORS ? THEME_ACCENT_COLORS[theme as ThemeColor] : null;
}
