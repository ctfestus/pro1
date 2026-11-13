// The public event page follows the event's Appearance settings: colour, mode and font.
import { describe, expect, it } from 'vitest';
import { accentColorFor } from '@/lib/theme-types';
import { EVENT_THEME_CSS, textOn, toThemeMode } from '@/lib/events/page-theme';
import { toPublicEvent } from '@/lib/events/public-event';

const ROW = { id: 'ev1', slug: 'meetup', title: 'Meetup', status: 'published', public_registration: true, event_type: 'virtual' };

describe('event appearance on the public page', () => {
  it('uses the custom accent, else the theme colour, as the editor does', () => {
    expect(accentColorFor('#123abc', 'rose')).toBe('#123abc');
    expect(accentColorFor(null, 'ocean')).toBe('#3E93FF');
    expect(accentColorFor('red;}', 'rose')).toBe('#f43f5e');
    expect(accentColorFor(null, null)).toBeNull();
    expect(toPublicEvent({ ...ROW, theme: 'amber', mode: 'dark', font: 'lora' }, 0)).toMatchObject({ accent: '#f59e0b', mode: 'dark', font: 'lora' });
    expect(toPublicEvent(ROW, 0)).toMatchObject({ accent: null, mode: 'light', font: null });
  });

  it('reads the mode as light, dark or auto', () => {
    expect(toThemeMode('dark')).toBe('dark');
    expect(toThemeMode('auto')).toBe('auto');
    expect(toThemeMode('neon')).toBe('light');
    expect(EVENT_THEME_CSS).toContain('prefers-color-scheme: dark');
  });

  it('puts dark text on a light accent and white on a dark one', () => {
    expect(textOn('#ADEE66')).toBe('#0f172a'); // lime
    expect(textOn('#00bf63')).toBe('#ffffff'); // forest
    expect(textOn('#3E93FF')).toBe('#ffffff'); // ocean
    expect(textOn('nonsense')).toBe('#ffffff');
  });
});
