// What Explore shows, and what it must stop hiding.
//
// Explore renders eight cards per row before "show more". Locked items used to be sorted to the
// end of every row, so a learner with eight free courses saw no paid ones at all -- clipped out,
// not merely further down. These tests hold the rule that replaced it.
import { describe, expect, it } from 'vitest';
import { groupCatalogue, matchesAccess } from '@/lib/explore-filter';

const ORDER = ['course', 'learning_path'];
const item = (type: string, locked: boolean, id: string) => ({ type, locked, id });

// A paid course sitting fifth, as the catalogue API returns them: ordered by id, which has
// nothing to do with whether an item is locked, so the two are mixed.
const mixedRow = [
  item('course', false, 'free-1'),
  item('course', false, 'free-2'),
  item('course', true, 'paid-1'),
  item('course', false, 'free-3'),
  item('course', true, 'paid-2'),
];

describe('matchesAccess', () => {
  it('splits on whether the learner can open it', () => {
    expect(matchesAccess(item('course', false, 'a'), 'free')).toBe(true);
    expect(matchesAccess(item('course', true, 'a'), 'free')).toBe(false);
    expect(matchesAccess(item('course', true, 'a'), 'paid')).toBe(true);
    expect(matchesAccess(item('course', false, 'a'), 'paid')).toBe(false);
  });

  it('keeps everything when no access filter is chosen', () => {
    expect(matchesAccess(item('course', true, 'a'), 'all')).toBe(true);
    expect(matchesAccess(item('course', false, 'a'), 'all')).toBe(true);
  });
});

describe('groupCatalogue', () => {
  it('does not push paid content to the end of the row', () => {
    // The regression this exists for. Sorting locked last put every paid item behind every free
    // one, and with eight cards shown before "show more" that clipped them out of view for
    // anyone with enough free content. The row must come back exactly as it arrived.
    const row = groupCatalogue(mixedRow, ORDER, 'all', 'all').get('course')!;
    expect(row.map(entry => entry.id)).toEqual(mixedRow.map(entry => entry.id));
    expect(row.findIndex(entry => entry.locked)).toBe(2);
  });

  it('would fail if locked items were sorted last again', () => {
    // Stated as the property rather than the implementation: no arrangement where every free
    // item precedes every paid one.
    const row = groupCatalogue(mixedRow, ORDER, 'all', 'all').get('course')!;
    const lastFree = row.map(entry => entry.locked).lastIndexOf(false);
    const firstPaid = row.findIndex(entry => entry.locked);
    expect(firstPaid).toBeLessThan(lastFree);
  });

  it('shows only what a plan would open when Paid is chosen', () => {
    const row = groupCatalogue(mixedRow, ORDER, 'all', 'paid').get('course')!;
    expect(row.map(entry => entry.id)).toEqual(['paid-1', 'paid-2']);
  });

  it('shows only what can be started now when Free is chosen', () => {
    const row = groupCatalogue(mixedRow, ORDER, 'all', 'free').get('course')!;
    expect(row).toHaveLength(3);
    expect(row.every(entry => !entry.locked)).toBe(true);
  });

  it('applies both filters together', () => {
    const mixed = [item('course', true, 'c1'), item('learning_path', true, 'p1')];
    const grouped = groupCatalogue(mixed, ORDER, 'learning_path', 'paid');
    expect([...grouped.keys()]).toEqual(['learning_path']);
    expect(grouped.get('learning_path')!.map(entry => entry.id)).toEqual(['p1']);
  });

  it('drops a row rather than showing an empty one', () => {
    // A subscriber has nothing locked, so Paid must leave no rows at all rather than headings
    // above nothing.
    const allFree = [item('course', false, 'c1'), item('learning_path', false, 'p1')];
    expect(groupCatalogue(allFree, ORDER, 'all', 'paid').size).toBe(0);
  });

  it('keeps the rows in the order given, not the order items arrived in', () => {
    const shuffled = [item('learning_path', false, 'p1'), item('course', false, 'c1')];
    expect([...groupCatalogue(shuffled, ORDER, 'all', 'all').keys()]).toEqual(ORDER);
  });
});
