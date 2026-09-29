import { describe, expect, it } from 'vitest';
import { DEFAULT_APPLICATION_STAGES } from '@/lib/application-forms';
import { applicationOverview, formatDecisionTime } from '@/lib/application-stats';

// Local-time constructors so the day buckets match regardless of the test machine's zone.
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour).toISOString();
const NOW = new Date(2026, 8, 29, 15);

function submission(day: number, stageId = 'submitted', movedAfterHours?: number) {
  const submittedAt = at(day);
  const statusHistory = [{ id: `s-${day}`, stageId: 'submitted', stageName: 'Submitted', actorEmail: 'a@example.com', occurredAt: submittedAt }];
  if (movedAfterHours !== undefined) {
    statusHistory.push({ id: `m-${day}`, stageId, stageName: stageId, actorEmail: 'r@example.com', occurredAt: new Date(new Date(submittedAt).getTime() + movedAfterHours * 3600_000).toISOString() });
  }
  return { submittedAt, stageId, statusHistory };
}

describe('application overview', () => {
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
      submission(28, 'screening', 5), submission(28, 'accepted', 30), submission(27), submission(27, 'gone-stage', 2),
    ], NOW);
    expect(overview.byStage.map(stage => stage.id)).toEqual([...DEFAULT_APPLICATION_STAGES.map(stage => stage.id), '']);
    expect(overview.byStage.find(stage => stage.id === 'screening')?.count).toBe(1);
    expect(overview.byStage.find(stage => stage.id === 'submitted')?.count).toBe(1);
    expect(overview.byStage.at(-1)).toEqual({ id: '', name: 'Other', count: 1 });
  });

  it('uses the median time to the first stage change, ignoring undecided applications', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [
      submission(20, 'screening', 2), submission(21, 'screening', 30), submission(22, 'accepted', 70), submission(23),
    ], NOW);
    expect(overview.decidedCount).toBe(3);
    expect(overview.medianHoursToFirstDecision).toBe(30);
    expect(applicationOverview(DEFAULT_APPLICATION_STAGES, [submission(23)], NOW).medianHoursToFirstDecision).toBeNull();
  });

  it('formats decision times in plain words', () => {
    expect(formatDecisionTime(null)).toBe('No decisions yet');
    expect(formatDecisionTime(0.4)).toBe('Under 1 hour');
    expect(formatDecisionTime(1)).toBe('1 hour');
    expect(formatDecisionTime(30)).toBe('30 hours');
    expect(formatDecisionTime(72)).toBe('3 days');
  });
});
