import { describe, expect, it } from 'vitest';
import { hasPublishedStudentContentAccess } from '@/lib/student-content-access';

function pathDb(path: object | null) {
  const calls: string[] = [];
  const query: any = {
    select() { return query; },
    eq(column: string, value: unknown) { calls.push(`eq:${column}:${String(value)}`); return query; },
    contains(column: string, value: unknown) { calls.push(`contains:${column}:${JSON.stringify(value)}`); return query; },
    or(value: string) { calls.push(`or:${value}`); return query; },
    limit() { return query; },
    async maybeSingle() { return { data: path, error: null }; },
  };
  return {
    calls,
    db: { from(table: string) { calls.push(`from:${table}`); return query; } },
  };
}

const base = {
  contentId: 'content-1',
  status: 'published',
  cohortId: null,
  cohortIds: [],
  availableToEveryone: false,
};

describe('published student content access', () => {
  it('allows content offered to everyone without querying paths', async () => {
    const { db, calls } = pathDb(null);
    await expect(hasPublishedStudentContentAccess(db, { ...base, availableToEveryone: true })).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it('allows a standard or subscription cohort attached directly to content', async () => {
    const { db, calls } = pathDb(null);
    await expect(hasPublishedStudentContentAccess(db, {
      ...base,
      cohortId: 'plan-cohort',
      cohortIds: ['plan-cohort'],
    })).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it('allows content inherited from a public path for a learner with no cohort', async () => {
    const { db, calls } = pathDb({ id: 'path-1' });
    await expect(hasPublishedStudentContentAccess(db, base)).resolves.toBe(true);
    expect(calls).toContain('eq:available_to_everyone:true');
  });

  it('checks both public and matching-cohort paths for a learner with a cohort', async () => {
    const { db, calls } = pathDb({ id: 'path-1' });
    await expect(hasPublishedStudentContentAccess(db, { ...base, cohortId: 'cohort-1' })).resolves.toBe(true);
    expect(calls).toContain('or:available_to_everyone.eq.true,cohort_ids.cs.{cohort-1}');
  });

  it('denies unpublished content and unrelated published content', async () => {
    const unpublished = pathDb({ id: 'path-1' });
    await expect(hasPublishedStudentContentAccess(unpublished.db, { ...base, status: 'draft' })).resolves.toBe(false);
    expect(unpublished.calls).toEqual([]);

    const unrelated = pathDb(null);
    await expect(hasPublishedStudentContentAccess(unrelated.db, base)).resolves.toBe(false);
  });
});
