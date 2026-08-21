import { describe, it, expect, vi, afterEach } from 'vitest';
import { countPathLearners } from '@/lib/learning-path-learners';

// The learner count decorates both the instructor path list and the student dashboard, so it
// must be exact (one head count per cohort, never per path) and it must never throw: a failed
// count degrades that path to 0 rather than breaking the page.

type Call = { filters: Record<string, string>; head: boolean };

function stub(countsByCohort: Record<string, number | { error: unknown }>) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      if (table !== 'students') throw new Error(`unexpected table "${table}"`);
      const filters: Record<string, string> = {};
      let head = false;
      const builder: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) { head = !!opts?.head; return builder; },
        eq(col: string, val: string) { filters[col] = val; return builder; },
        then(resolve: (r: any) => any) {
          calls.push({ filters, head });
          const configured = countsByCohort[filters.cohort_id];
          const result = typeof configured === 'object' && configured !== null && 'error' in configured
            ? { count: null, error: configured.error }
            : { count: configured ?? 0, error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
  return { supabase, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('countPathLearners', () => {
  it('sums the active learners of every cohort the path is assigned to', async () => {
    const { supabase } = stub({ co1: 12, co2: 7 });
    const counts = await countPathLearners(supabase, [{ id: 'lp1', cohort_ids: ['co1', 'co2'] }]);
    expect(counts).toEqual({ lp1: 19 });
  });

  it('counts only active students, excluding instructors, admins and inactive accounts', async () => {
    const { supabase, calls } = stub({ co1: 5 });
    await countPathLearners(supabase, [{ id: 'lp1', cohort_ids: ['co1'] }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual({ cohort_id: 'co1', role: 'student', status: 'active' });
    // head request: the count comes back without transferring a single student row.
    expect(calls[0].head).toBe(true);
  });

  it('queries each cohort once even when several paths share it', async () => {
    const { supabase, calls } = stub({ co1: 4, co2: 6 });
    const counts = await countPathLearners(supabase, [
      { id: 'lp1', cohort_ids: ['co1', 'co2'] },
      { id: 'lp2', cohort_ids: ['co1'] },
    ]);
    expect(counts).toEqual({ lp1: 10, lp2: 4 });
    expect(calls.map(c => c.filters.cohort_id).sort()).toEqual(['co1', 'co2']);
  });

  it('never double-counts a cohort listed twice on one path', async () => {
    const { supabase } = stub({ co1: 9 });
    const counts = await countPathLearners(supabase, [{ id: 'lp1', cohort_ids: ['co1', 'co1'] }]);
    expect(counts).toEqual({ lp1: 9 });
  });

  it('reports 0 for a path with no cohorts and issues no query', async () => {
    const { supabase, calls } = stub({});
    const counts = await countPathLearners(supabase, [{ id: 'lp1', cohort_ids: [] }, { id: 'lp2' }]);
    expect(counts).toEqual({ lp1: 0, lp2: 0 });
    expect(calls).toHaveLength(0);
  });

  it('degrades a failed count to 0 instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = stub({ co1: { error: { message: 'boom' } }, co2: 3 });
    const counts = await countPathLearners(supabase, [{ id: 'lp1', cohort_ids: ['co1', 'co2'] }]);
    expect(counts).toEqual({ lp1: 3 });
  });
});
