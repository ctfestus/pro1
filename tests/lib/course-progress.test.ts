import { describe, it, expect } from 'vitest';

import {
  courseProgressCounts, courseProgressPct, answeredScorableCount, courseContentCounts, courseXpOnOffer,
  isCountableSlide,
} from '@/lib/course-progress';
import { DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';

const q        = (id: string) => ({ id, type: 'multiple_choice' });
const section  = (id: string) => ({ id, isSection: true });
const lesson   = (id: string) => ({ id, lessonOnly: true });
const download = (id: string) => ({ id, isDownloads: true });
const shareBase = (id: string, points?: number) => ({ id, isLinkedInShare: true, ...(points === undefined ? {} : { linkedInSharePoints: points }) });
/** Gating requires a deliberate `true` -- see unsetShare for what an untouched toggle produces. */
const share    = (id: string, points?: number) => ({ ...shareBase(id, points), linkedInShareRequired: true });
const optionalShare = (id: string, points?: number) => ({ ...shareBase(id, points), linkedInShareRequired: false });
/** The flag never written: an author who added a share slide and left the toggle alone. */
const unsetShare = (id: string, points?: number) => shareBase(id, points);

const answered = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, 'x']));

describe('progress denominator', () => {
  it('counts every slide the student moves through, including lessons and downloads', () => {
    const questions = [q('a'), lesson('l'), download('d')];
    expect(courseProgressCounts(questions, answered('a', 'l'))).toEqual({ total: 3, done: 2, authored: 3 });
  });

  it('never counts section dividers', () => {
    expect(courseProgressCounts([section('s'), q('a')], answered('a')))
      .toEqual({ total: 1, done: 1, authored: 1 });
  });

  it('counts a REQUIRED share slide whether or not it is claimed', () => {
    expect(courseProgressCounts([q('a'), share('s1')], answered('a')))
      .toEqual({ total: 2, done: 1, authored: 2 });
    expect(courseProgressCounts([q('a'), share('s1')], answered('a', 's1')))
      .toEqual({ total: 2, done: 2, authored: 2 });
  });
});

// The reported bug: one completed lesson plus one skipped optional share displayed 50%.
describe('optional share slides', () => {
  it('leaves the denominator while unclaimed, so the course reads 100%', () => {
    const questions = [lesson('l'), optionalShare('s1')];
    expect(courseProgressCounts(questions, answered('l'))).toEqual({ total: 1, done: 1, authored: 2 });
    expect(courseProgressPct(questions, answered('l'))).toBe(100);
  });

  it('counts once claimed, so choosing to share is still credited', () => {
    const questions = [lesson('l'), optionalShare('s1')];
    expect(courseProgressCounts(questions, answered('l', 's1'))).toEqual({ total: 2, done: 2, authored: 2 });
    expect(courseProgressPct(questions, answered('l', 's1'))).toBe(100);
  });

  it('does not mask genuinely outstanding work', () => {
    const questions = [q('a'), q('b'), optionalShare('s1')];
    expect(courseProgressPct(questions, answered('a'))).toBe(50);
  });

  it('reads 100% for a course whose only slide is a skipped optional share', () => {
    expect(courseProgressCounts([optionalShare('s1')], {})).toEqual({ total: 0, done: 0, authored: 1 });
    expect(courseProgressPct([optionalShare('s1')], {})).toBe(100);
  });

  it('reads 0% for a course with no slides at all', () => {
    expect(courseProgressPct([], {})).toBe(0);
    expect(courseProgressPct([section('s')], {})).toBe(0);
  });

  it('exposes the same rule per slide for callers that need it', () => {
    expect(isCountableSlide(optionalShare('s1'), {})).toBe(false);
    expect(isCountableSlide(optionalShare('s1'), answered('s1'))).toBe(true);
    expect(isCountableSlide(share('s1'), {})).toBe(true);
    // An untouched toggle behaves as optional, not required.
    expect(isCountableSlide(unsetShare('s1'), {})).toBe(false);
    expect(isCountableSlide(unsetShare('s1'), answered('s1'))).toBe(true);
    expect(isCountableSlide(section('s'), {})).toBe(false);
    expect(isCountableSlide(q('a'), {})).toBe(true);
  });
});

// "You answered X of Y": Y is the SCORABLE count, so X has to be measured over the same set.
describe('answeredScorableCount', () => {
  it('ignores lessons, downloads, sections and share slides', () => {
    const questions = [q('a'), lesson('l'), download('d'), section('s'), share('s1')];
    expect(answeredScorableCount(questions, answered('a', 'l', 'd', 's1'))).toBe(1);
  });

  // The bug this replaces: counting answer keys pulled in __meta_/__review_ entries and a claimed
  // share URL, so X could exceed Y.
  it('is not inflated by internal answer keys or a claimed share', () => {
    const questions = [q('a'), share('s1')];
    const answers = { a: 'A', __meta_a: '{}', __review_a: '{}', s1: 'https://www.linkedin.com/posts/x' };
    expect(answeredScorableCount(questions, answers)).toBe(1);
  });

  it('counts nothing when nothing scorable is answered', () => {
    expect(answeredScorableCount([lesson('l')], answered('l'))).toBe(0);
  });
});

describe('courseContentCounts', () => {
  it('splits teaching slides from exercises', () => {
    expect(courseContentCounts([lesson('l1'), lesson('l2'), q('a')])).toEqual({ lessons: 2, exercises: 1 });
  });

  it('counts SQL and Python exercises as exercises, not lessons', () => {
    const questions = [{ id: 's', type: 'sql_exercise' }, { id: 'p', type: 'python_exercise' }];
    expect(courseContentCounts(questions)).toEqual({ lessons: 0, exercises: 2 });
  });

  // Nobody enrols because a course has a section divider, a downloads block or a share slide, and
  // counting them as exercises would advertise practice the course does not contain.
  it('counts sections, downloads and share slides as neither', () => {
    const questions = [section('s'), download('d'), share('sh'), optionalShare('sh2')];
    expect(courseContentCounts(questions)).toEqual({ lessons: 0, exercises: 0 });
  });

  it('reads an empty or missing course as zero of each', () => {
    expect(courseContentCounts([])).toEqual({ lessons: 0, exercises: 0 });
    expect(courseContentCounts(undefined as any)).toEqual({ lessons: 0, exercises: 0 });
  });
});

describe('courseXpOnOffer', () => {
  const ps = (over: any = {}) => ({ enabled: true, basePoints: 50, ...over });

  it('prices questions at basePoints', () => {
    expect(courseXpOnOffer([q('a'), q('b')], ps())).toBe(100);
  });

  it('awards nothing for lessons, downloads and sections', () => {
    expect(courseXpOnOffer([q('a'), lesson('l'), download('d'), section('s')], ps())).toBe(50);
  });

  it('prices a share slide at its own bonus, not basePoints', () => {
    expect(courseXpOnOffer([q('a'), share('s1', 200)], ps())).toBe(250);
  });

  it('falls back to the default bonus when the slide sets none', () => {
    expect(courseXpOnOffer([share('s1')], ps())).toBe(DEFAULT_LINKEDIN_SHARE_POINTS);
  });

  // An UNSET amount means "use the default"; an explicit 0 means zero. Conflating them advertised
  // 50 XP for a slide the server awards nothing for.
  it('advertises nothing for a share deliberately set to 0 XP', () => {
    expect(courseXpOnOffer([share('s1', 0)], ps())).toBe(0);
    expect(courseXpOnOffer([q('a'), share('s1', 0)], ps())).toBe(50);
  });

  it('caps an over-configured bonus', () => {
    expect(courseXpOnOffer([share('s1', 99999)], ps())).toBe(MAX_LINKEDIN_SHARE_POINTS);
  });

  it('is zero when the points system is off or absent', () => {
    expect(courseXpOnOffer([q('a')], ps({ enabled: false }))).toBe(0);
    expect(courseXpOnOffer([q('a')], null)).toBe(0);
  });
});
