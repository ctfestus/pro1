import { describe, it, expect } from 'vitest';
import { loadTrackedContent } from '@/lib/tracking-report';

// Which content a caller may report on is two independent questions -- whose, and in what state --
// and they were once answered by a single either/or. Asking for the owner's content therefore
// silently asked for their drafts too, so bulk messaging counted students against a course they
// cannot open and offered to email them about it. These assert the filters that actually reach the
// query, which a stub that ignores its arguments cannot show.

/** Records every .eq(column, value) per table; every query resolves empty. */
function recordingDb() {
  const calls: Record<string, Array<[string, unknown]>> = {};
  return {
    calls,
    columnsFiltered: (table: string) => (calls[table] ?? []).map(([col]) => col),
    from(table: string) {
      calls[table] ??= [];
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { calls[table].push([col, val]); return chain; },
        order: () => chain,
        range: () => chain,
        then: (onFulfilled: any, onRejected: any) =>
          Promise.resolve({ data: [], count: 0, error: null }).then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
}

describe('loadTrackedContent scoping', () => {
  it('gives admins all published content and no owner filter', async () => {
    const db = recordingDb();
    await loadTrackedContent(db, { userId: 'u1', role: 'admin' });
    expect(db.calls.courses).toContainEqual(['status', 'published']);
    expect(db.columnsFiltered('courses')).not.toContain('user_id');
    expect(db.calls.virtual_experiences).toContainEqual(['status', 'published']);
    expect(db.columnsFiltered('virtual_experiences')).not.toContain('user_id');
  });

  it('keeps an instructor owner-scoped, drafts included, as the tracking table always did', async () => {
    const db = recordingDb();
    await loadTrackedContent(db, { userId: 'u1', role: 'instructor' });
    expect(db.calls.courses).toContainEqual(['user_id', 'u1']);
    expect(db.columnsFiltered('courses')).not.toContain('status');
  });

  it('applies both filters when a caller asks for owner-scoped published content', async () => {
    const db = recordingDb();
    await loadTrackedContent(db, { userId: 'u1', role: 'instructor', ownerScoped: true, publishedOnly: true });
    expect(db.calls.courses).toEqual(expect.arrayContaining([['status', 'published'], ['user_id', 'u1']]));
    expect(db.calls.virtual_experiences).toEqual(expect.arrayContaining([['status', 'published'], ['user_id', 'u1']]));
  });

  it('holds for an admin too, so ownerScoped is not quietly ignored for them', async () => {
    const db = recordingDb();
    await loadTrackedContent(db, { userId: 'u1', role: 'admin', ownerScoped: true, publishedOnly: true });
    expect(db.calls.courses).toEqual(expect.arrayContaining([['status', 'published'], ['user_id', 'u1']]));
  });

  it('only ever considers published learning paths for the cohort grant', async () => {
    const db = recordingDb();
    await loadTrackedContent(db, { userId: 'u1', role: 'instructor' });
    expect(db.calls.learning_paths).toContainEqual(['status', 'published']);
  });

  it('always restricts assignments to published, whoever is asking', async () => {
    for (const role of ['admin', 'instructor', 'staff']) {
      const db = recordingDb();
      await loadTrackedContent(db, { userId: 'u1', role });
      expect(db.calls.assignments).toContainEqual(['status', 'published']);
    }
  });
});
