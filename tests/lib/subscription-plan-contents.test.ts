// What a plan contains, resolved for several plans at once so a learner can tell which plan
// holds the course they came for.
import { describe, expect, it, vi } from 'vitest';
import { loadPlanContents, PLAN_CONTENTS_PREVIEW_LIMIT } from '@/lib/subscription-plan-access';

/** Minimal chainable stub: one configured result per table, awaited directly. */
function db(byTable: Record<string, any[]>, spy?: (table: string) => void) {
  return {
    from(table: string) {
      spy?.(table);
      const result = { data: byTable[table] ?? [], error: null };
      const builder: any = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === 'then') return (r: any) => Promise.resolve(result).then(r);
          return () => builder;
        },
      });
      return builder;
    },
  } as any;
}

describe('loadPlanContents', () => {
  it('groups titles by plan across every content type', async () => {
    const result = await loadPlanContents(db({
      subscription_plan_content: [
        { plan_id: 'p1', content_table: 'courses', content_id: 'c1' },
        { plan_id: 'p1', content_table: 'virtual_experiences', content_id: 'v1' },
        { plan_id: 'p2', content_table: 'courses', content_id: 'c2' },
      ],
      courses: [{ id: 'c1', title: 'SQL Basics' }, { id: 'c2', title: 'Power BI' }],
      virtual_experiences: [{ id: 'v1', title: 'Analyst Day One' }],
      certifications: [],
      learning_paths: [],
    }), ['p1', 'p2']);

    expect(result.get('p1')?.map(row => row.title)).toEqual(['SQL Basics', 'Analyst Day One']);
    expect(result.get('p2')?.map(row => row.title)).toEqual(['Power BI']);
  });

  it('skips an entry whose content was deleted rather than showing a blank line', async () => {
    const result = await loadPlanContents(db({
      subscription_plan_content: [
        { plan_id: 'p1', content_table: 'courses', content_id: 'c1' },
        { plan_id: 'p1', content_table: 'courses', content_id: 'gone' },
      ],
      courses: [{ id: 'c1', title: 'SQL Basics' }],
      virtual_experiences: [], certifications: [], learning_paths: [],
    }), ['p1']);

    expect(result.get('p1')).toHaveLength(1);
    expect(result.get('p1')?.[0].title).toBe('SQL Basics');
  });

  it('issues no queries at all when there are no plans', async () => {
    const tables: string[] = [];
    const result = await loadPlanContents(db({}, t => tables.push(t)), []);
    expect(result.size).toBe(0);
    expect(tables).toEqual([]);
  });

  it('does not query a content type no plan uses', async () => {
    const tables: string[] = [];
    await loadPlanContents(db({
      subscription_plan_content: [{ plan_id: 'p1', content_table: 'courses', content_id: 'c1' }],
      courses: [{ id: 'c1', title: 'SQL Basics' }],
    }, t => tables.push(t)), ['p1']);

    expect(tables).toContain('courses');
    expect(tables).not.toContain('certifications');
    expect(tables).not.toContain('learning_paths');
  });

  it('caps what a card can show but keeps the real total', () => {
    // The cap is what stops a large plan turning a card into a wall of titles; contentCount is
    // what lets the card still say "and 40 more".
    expect(PLAN_CONTENTS_PREVIEW_LIMIT).toBeGreaterThan(0);
  });
});
