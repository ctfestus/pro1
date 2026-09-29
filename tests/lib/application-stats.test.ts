import { describe, expect, it } from 'vitest';
import { DEFAULT_APPLICATION_STAGES } from '@/lib/application-forms';
import { applicationOverview } from '@/lib/application-stats';

// Local-time constructors so the day buckets match regardless of the test machine's zone.
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour).toISOString();
const NOW = new Date(2026, 8, 29, 15);
const submission = (day: number, stageId = 'submitted') => ({ submittedAt: at(day), stageId });

describe('application insights', () => {
  it('counts totals, today, the last 7 days, and 30 local-day buckets ending today', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [
      // Day -10 is 21 August: before the 30-day window (31 Aug to 29 Sep).
      submission(29), submission(29), submission(25), submission(23), submission(22), submission(-10),
    ], NOW);
    expect(overview.total).toBe(6);
    expect(overview.today).toBe(2);
    expect(overview.last7Days).toBe(4);
    expect(overview.daily).toHaveLength(30);
    expect(overview.daily[29]).toEqual({ date: '2026-09-29', count: 2 });
    expect(overview.daily[0].date).toBe('2026-08-31');
    expect(overview.daily.reduce((sum, day) => sum + day.count, 0)).toBe(5);
  });

  it('lists every stage in order and groups applicants in removed stages as Other', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [
      submission(28, 'screening'), submission(28, 'accepted'), submission(27), submission(27, 'gone-stage'),
    ], NOW);
    expect(overview.byStage.map(stage => stage.id)).toEqual([...DEFAULT_APPLICATION_STAGES.map(stage => stage.id), '']);
    expect(overview.byStage.find(stage => stage.id === 'screening')?.count).toBe(1);
    expect(overview.byStage.find(stage => stage.id === 'submitted')?.count).toBe(1);
    expect(overview.byStage.at(-1)).toEqual({ id: '', name: 'Other', count: 1 });
  });

  it('returns zeros and an empty chart for a form with no applications', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [], NOW);
    expect(overview).toMatchObject({ total: 0, today: 0, last7Days: 0 });
    expect(overview.daily.every(day => day.count === 0)).toBe(true);
    expect(overview.byStage.every(stage => stage.count === 0)).toBe(true);
  });
});
