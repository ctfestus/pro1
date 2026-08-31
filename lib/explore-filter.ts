/**
 * Which catalogue items a learner sees in Explore, and in which rows.
 *
 * Pure, and kept out of the component so the rule can be tested: the harness here is node-env
 * and never renders, and this is the part where a mistake quietly hides content from people.
 *
 * There is no unlocked-first ordering. Explore shows eight cards per row before "show more", and
 * sorting locked items last meant a learner with eight free courses saw no paid ones at all --
 * not further down, clipped out of the row. The sort did nothing for a subscriber, who has
 * everything unlocked already, and hid the catalogue from everyone else. The access filter is
 * the deliberate version of the same intent, and a learner can see it and turn it off.
 */

export type ExploreAccess = 'all' | 'free' | 'paid';

export interface ExploreItem {
  type: string;
  locked: boolean;
}

export function matchesAccess(item: ExploreItem, access: ExploreAccess): boolean {
  if (access === 'all') return true;
  return access === 'free' ? !item.locked : item.locked;
}

/**
 * Groups into rows, one per type, in the order given. A type with nothing left after filtering
 * is dropped rather than shown as an empty row.
 */
export function groupCatalogue<T extends ExploreItem>(
  items: readonly T[],
  order: readonly string[],
  filter: string,
  access: ExploreAccess,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const type of order) {
    if (filter !== 'all' && filter !== type) continue;
    const list = items.filter(item => item.type === type && matchesAccess(item, access));
    if (list.length) out.set(type, list);
  }
  return out;
}
