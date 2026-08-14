import { describe, it, expect } from 'vitest';
import { fetchAllRows, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';

// The point of the helper is that a capped response never looks like the end of the data. These
// fakes stand in for PostgREST: they honour the requested range but refuse to return more than
// `cap` rows at a time, exactly as the project's "Max rows" setting does.
function pagedSource(totalRows: number, cap: number, opts: { withCount?: boolean } = {}) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const slice = all.slice(from, Math.min(to + 1, from + cap));
    return { data: slice, count: opts.withCount ? totalRows : null, error: null };
  };
  return { page, calls };
}

describe('fetchAllRows', () => {
  it('returns every row when the total sits under the cap', async () => {
    const { page, calls } = pagedSource(37, 1000, { withCount: true });
    const rows = await fetchAllRows(page);
    expect(rows).toHaveLength(37);
    expect(calls).toHaveLength(1);
  });

  it('keeps paging past a cap that is lower than the requested range', async () => {
    // The regression this guards: a 500-row cap answering a 1000-row request looks like a short
    // page, and stopping there would silently drop 1 700 rows.
    const { page } = pagedSource(2200, 500, { withCount: true });
    const rows = await fetchAllRows(page);
    expect(rows).toHaveLength(2200);
    expect(rows.map(r => r.id)).toEqual(Array.from({ length: 2200 }, (_, i) => i));
  });

  it('advances the range by what it has already collected', async () => {
    const { page, calls } = pagedSource(1200, 1000, { withCount: true });
    await fetchAllRows(page);
    expect(calls[0][0]).toBe(0);
    expect(calls[1][0]).toBe(1000);
  });

  it('stops on a short page when no count is available', async () => {
    const { page, calls } = pagedSource(1500, 1000);
    const rows = await fetchAllRows(page);
    expect(rows).toHaveLength(1500);
    // 1000, then 500 (short, and with no count to contradict it) ends the loop.
    expect(calls).toHaveLength(2);
  });

  it('stops on an empty page even when a count says otherwise', async () => {
    let served = 0;
    const rows = await fetchAllRows(async () => {
      served += 1;
      return { data: served === 1 ? [{ id: 1 }] : [], count: 99, error: null };
    });
    expect(rows).toHaveLength(1);
  });

  it('surfaces a query error instead of returning a partial set', async () => {
    await expect(fetchAllRows(async () => ({ data: null, count: null, error: { message: 'boom' } })))
      .rejects.toThrow('boom');
  });

  it('returns an empty array when nothing matches', async () => {
    const { page } = pagedSource(0, 1000, { withCount: true });
    expect(await fetchAllRows(page)).toEqual([]);
  });
});

describe('fetchAllRowsByIdPairs', () => {
  const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('bounds both id lists, not just the first', async () => {
    // The regression this guards: chunking one list while the other went out in full left the
    // request line just as long, because both filters travel in the same URL.
    const seen: Array<[number, number]> = [];
    await fetchAllRowsByIdPairs(ids(300, 's'), ids(240, 'c'), async (a, b) => {
      seen.push([a.length, b.length]);
      return { data: [], count: 0, error: null };
    });
    expect(seen.every(([a, b]) => a <= 70 && b <= 70)).toBe(true);
    expect(seen.every(([a, b]) => a + b <= 140)).toBe(true);
  });

  it('covers every combination exactly once', async () => {
    const pairs: string[] = [];
    await fetchAllRowsByIdPairs(ids(150, 's'), ids(80, 'c'), async (a, b) => {
      pairs.push(`${a[0]}|${b[0]}`);
      return { data: [], count: 0, error: null };
    });
    // 150 students over 70-id chunks is 3 chunks; 80 content ids is 2.
    expect(pairs).toHaveLength(6);
    expect(new Set(pairs).size).toBe(6);
  });

  it('lets a short second list buy a longer first one', async () => {
    // Filtering one course against thousands of students should not be split into 70-id pages on
    // the student side when the content side needs only one slot.
    const seen: Array<[number, number]> = [];
    await fetchAllRowsByIdPairs(ids(300, 's'), ids(2, 'c'), async (a, b) => {
      seen.push([a.length, b.length]);
      return { data: [], count: 0, error: null };
    });
    expect(seen).toHaveLength(3);
    expect(seen.every(([a, b]) => a + b <= 140)).toBe(true);
  });

  it('makes one request when both lists are small', async () => {
    let calls = 0;
    const rows = await fetchAllRowsByIdPairs(ids(5, 's'), ids(3, 'c'), async () => {
      calls += 1;
      return { data: [{ id: 1 }], count: 1, error: null };
    });
    expect(calls).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('caps how many requests are in flight at once', async () => {
    // Narrowing each request must not turn into a connection stampede on a large tenant.
    let inFlight = 0;
    let peak = 0;
    await fetchAllRowsByIdPairs(ids(1000, 's'), ids(300, 'c'), async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight -= 1;
      return { data: [], count: 0, error: null };
    });
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  it('skips the query entirely when either list is empty', async () => {
    let calls = 0;
    const bump = async () => { calls += 1; return { data: [], count: 0, error: null }; };
    expect(await fetchAllRowsByIdPairs([], ids(3, 'c'), bump)).toEqual([]);
    expect(await fetchAllRowsByIdPairs(ids(3, 's'), [], bump)).toEqual([]);
    expect(calls).toBe(0);
  });
});
