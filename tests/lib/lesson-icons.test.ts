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

describe('icons saved before the shared set', () => {
  it('still map to the same Phosphor icon', async () => {
    const { LESSON_ICON_COMPONENTS: map } = await import('@/components/lesson/lessonIconMap');
    const ph = await import('@phosphor-icons/react');
    // Callout keys, then flip card keys (lightbulb, users and growth are aliases of tip, people, trend).
    const expected = {
      note: ph.FileText, tip: ph.Lightbulb, warning: ph.Warning, info: ph.Info, success: ph.CheckCircle,
      star: ph.Star, flag: ph.Flag, quote: ph.Quotes, book: ph.BookOpen, target: ph.Target, zap: ph.Lightning,
      clock: ph.Clock, question: ph.Question, sparkles: ph.Sparkle, tool: ph.Wrench, shield: ph.ShieldCheck,
      bookmark: ph.BookmarkSimple, announce: ph.Megaphone, checklist: ph.ListChecks, trend: ph.TrendUp,
      people: ph.Users, avoid: ph.Prohibit, watch: ph.Eye,
      brain: ph.Brain, rocket: ph.Rocket, globe: ph.Globe, calendar: ph.CalendarDots, message: ph.ChatCircle,
      code: ph.Code, puzzle: ph.PuzzlePiece, magic: ph.MagicWand,
      lightbulb: ph.Lightbulb, users: ph.Users, growth: ph.TrendUp,
    };
    for (const [stored, Icon] of Object.entries(expected)) {
      const key = resolveLessonIconKey(stored);
      expect(key, stored).not.toBe('');
      expect(map[key as keyof typeof map], stored).toBe(Icon);
    }
  });
});
