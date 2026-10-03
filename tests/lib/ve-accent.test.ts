import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VE_ACCENT,
  DELIVERABLE_ACCENT_PRESETS,
  contrastRatio,
  deliverableAccentForType,
  onAccent,
  readableAccent,
  resolveDeliverableAccent,
} from '@/lib/ve-accent';

describe('deliverable accent', () => {
  it('falls back to the player accent for missing or malformed colors', () => {
    for (const value of [undefined, null, '', 'red', '#fff', '#12345', '#1234567', 'url(x)', 42]) {
      expect(resolveDeliverableAccent(value, DEFAULT_VE_ACCENT, false)).toBe(DEFAULT_VE_ACCENT);
      expect(resolveDeliverableAccent(value, DEFAULT_VE_ACCENT, true)).toBe(DEFAULT_VE_ACCENT);
    }
  });

  it('keeps a readable author color unchanged', () => {
    expect(resolveDeliverableAccent('#3E93FF', DEFAULT_VE_ACCENT, false)).toBe('#3E93FF');
    expect(resolveDeliverableAccent('#3E93FF', DEFAULT_VE_ACCENT, true)).toBe('#3E93FF');
  });

  it('darkens white so it reads on the light card', () => {
    const shown = resolveDeliverableAccent('#ffffff', DEFAULT_VE_ACCENT, false);
    expect(contrastRatio(shown, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('lightens black so it reads on the dark card', () => {
    const shown = resolveDeliverableAccent('#000000', DEFAULT_VE_ACCENT, true);
    expect(contrastRatio(shown, '#1E1F26')).toBeGreaterThanOrEqual(3);
  });

  it('checks dark colors against the lightest dark player surface', () => {
    const shown = resolveDeliverableAccent('#000022', DEFAULT_VE_ACCENT, true);
    expect(contrastRatio(shown, '#1E1F26')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(shown, '#1a1a1a')).toBeGreaterThanOrEqual(3);
  });

  it('keeps the checkbox tick visible on any accent', () => {
    expect(onAccent(DEFAULT_VE_ACCENT)).toBe('#ffffff');
    expect(onAccent('#ffffff')).toBe('#111111');
    for (const color of ['#ffffff', '#ffe066', '#000000', '#3E93FF', DEFAULT_VE_ACCENT]) {
      for (const isDark of [false, true]) {
        const shown = resolveDeliverableAccent(color, DEFAULT_VE_ACCENT, isDark);
        expect(contrastRatio(onAccent(shown), shown)).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it('nudges pale colors while keeping the hue direction', () => {
    const shown = readableAccent('#ffe066', false);
    expect(contrastRatio(shown, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(shown).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ships presets that already meet the contrast floor in both themes', () => {
    for (const color of DELIVERABLE_ACCENT_PRESETS.filter(c => c !== DEFAULT_VE_ACCENT)) {
      expect(readableAccent(color, false)).toBe(color);
      expect(readableAccent(color, true)).toBe(color);
    }
  });

  it('drops the color when a deliverable becomes another requirement type', () => {
    expect(deliverableAccentForType('#3E93FF', 'task')).toBe('#3E93FF');
    expect(deliverableAccentForType('#3E93FF', 'deliverable')).toBe('#3E93FF');
    expect(deliverableAccentForType('#3E93FF', 'mcq')).toBeUndefined();
    expect(deliverableAccentForType('#3E93FF', 'upload')).toBeUndefined();
  });
});
