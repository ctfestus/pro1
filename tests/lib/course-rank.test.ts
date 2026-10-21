import { describe, expect, it } from 'vitest';
import { rankCourseAttempts, type RankAttempt } from '@/lib/course-rank';

const roster = [
  { id: 'a', full_name: 'Ama' },
  { id: 'b', full_name: 'Kojo' },
  { id: 'c', full_name: 'Esi' },
  { id: 'd', full_name: 'Yaw' },
];

const at = (student_id: string, score: number, points: number, completed_at = '2026-10-01T00:00:00Z'): RankAttempt =>
  ({ student_id, score, points, completed_at });

describe('rankCourseAttempts', () => {
  it('ranks the cohort, not just the caller', () => {
    const res = rankCourseAttempts([at('a', 90, 100), at('b', 80, 90), at('c', 70, 80)], roster, 'b');
    expect(res).toEqual({
      eligible: true,
      rank: 2,
      total: 3,
      above: { name: 'Ama', rank: 1 },
      me: { name: 'Kojo', rank: 2, score: 80, points: 90 },
      below: { name: 'Esi', rank: 3 },
    });
  });

  it('is ineligible without a completed attempt by the caller', () => {
    expect(rankCourseAttempts([at('a', 90, 100)], roster, 'b')).toEqual({ eligible: false });
    expect(rankCourseAttempts([{ ...at('b', 90, 100), completed_at: null }], roster, 'b'))
      .toEqual({ eligible: false });
  });

  it('never counts or names a student outside the roster', () => {
    const res = rankCourseAttempts([at('outsider', 100, 999), at('b', 80, 90)], roster, 'b');
    expect(res).toMatchObject({ eligible: true, rank: 1, total: 1, above: null, below: null });
    expect(JSON.stringify(res)).not.toContain('outsider');
  });

  it("uses each student's best attempt: score, then points, then earliest", () => {
    const res = rankCourseAttempts([
      at('b', 60, 200),
      at('b', 80, 50),
      at('b', 80, 70, '2026-10-02T00:00:00Z'),
      at('b', 80, 70, '2026-10-01T00:00:00Z'),
    ], roster, 'b');
    expect(res).toMatchObject({ eligible: true, total: 1, me: { score: 80, points: 70 } });
  });

  it('shares a rank on equal score and points and skips tied peers as neighbours', () => {
    // d=1, a=2, b=2, c=4
    const attempts = [at('a', 90, 100), at('b', 90, 100), at('c', 70, 80), at('d', 95, 120)];
    expect(rankCourseAttempts(attempts, roster, 'b')).toMatchObject({
      rank: 2, total: 4,
      above: { name: 'Yaw', rank: 1 },
      below: { name: 'Esi', rank: 4 },
    });
    expect(rankCourseAttempts(attempts, roster, 'a'))
      .toMatchObject({ rank: 2, above: { rank: 1 }, below: { rank: 4 } });
  });

  it('orders by score before points', () => {
    const res = rankCourseAttempts([at('a', 90, 10), at('b', 80, 500)], roster, 'b');
    expect(res).toMatchObject({ rank: 2, above: { name: 'Ama', rank: 1 } });
  });

  it('never returns emails or ids', () => {
    const res = rankCourseAttempts([at('a', 90, 100), at('b', 80, 90), at('c', 70, 80)], roster, 'b');
    expect(JSON.stringify(res)).not.toMatch(/student_id|email|"id"/);
  });
});
