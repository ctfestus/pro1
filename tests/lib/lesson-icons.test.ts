import { describe, it, expect } from 'vitest';
import { LESSON_ICONS, LESSON_ICON_GROUPS, resolveLessonIconKey } from '@/lib/lesson-icons';

describe('resolveLessonIconKey', () => {
  it('accepts every key in the set', () => {
    for (const key of Object.keys(LESSON_ICONS)) expect(resolveLessonIconKey(key)).toBe(key);
  });

  it('keeps icons on flip cards saved under their older keys', () => {
    expect(resolveLessonIconKey('lightbulb')).toBe('tip');
    expect(resolveLessonIconKey('users')).toBe('people');
    expect(resolveLessonIconKey('growth')).toBe('trend');
  });

  it('treats empty, "none" and unknown values as no icon', () => {
    expect(resolveLessonIconKey('')).toBe('');
    expect(resolveLessonIconKey('none')).toBe('');
    expect(resolveLessonIconKey('not-an-icon')).toBe('');
    expect(resolveLessonIconKey(undefined)).toBe('');
  });

  it('puts every icon in a group the picker shows', () => {
    const groups = new Set(LESSON_ICON_GROUPS.map((g) => g.id));
    for (const meta of Object.values(LESSON_ICONS)) expect(groups.has(meta.group)).toBe(true);
  });
});
