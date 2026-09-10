/**
 * What the shared nav's Learn menu offers, built once for every page that wears the chrome.
 *
 * The landing page had this inline, so the pricing page fell back to a flat list of section links
 * and the two public pages disagreed about their own navigation. Building it here means a page
 * only has to supply the programmes.
 *
 * The grouping is deliberately the same helper the landing page's own content rows use -- courses
 * by tool, experiences by industry, certifications by Career or Technology -- so the menu and the
 * sections it points at cannot drift apart.
 */

import type { ProgrammeItem } from './get-landing-page-data';
import { landingHref } from './landing-href';

/** One item row in the menu's item panel. */
export type NavMenuItem = { id: string; title: string; imageUrl?: string; href: string };

/**
 * A content type's own grouping. An empty label means the type has none, and the menu then skips
 * the grouping column entirely.
 */
export type NavSubGroup = { label: string; items: NavMenuItem[] };

/** One content type: its section anchor and its groupings. */
export type NavGroup = { label: string; anchor: string; subGroups: NavSubGroup[] };

/** How many items a single grouping offers. Enough to fill the panel without it scrolling. */
const ITEMS_PER_GROUP = 8;

/**
 * Group items by a field, with anything missing one collected under General and sorted last.
 * Shared with the landing page's content rows.
 */
export function groupByField(items: ProgrammeItem[], field: 'category'): [string, ProgrammeItem[]][] {
  const map = new Map<string, ProgrammeItem[]>();
  for (const item of items) {
    const key = (item[field] || '').trim() || 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 'General') return 1;
    if (b[0] === 'General') return -1;
    return a[0].localeCompare(b[0]);
  });
}

function navItems(items: ProgrammeItem[], user: unknown): NavMenuItem[] {
  return items.slice(0, ITEMS_PER_GROUP).map(item => ({
    id: item.id,
    title: item.title,
    imageUrl: item.imageUrl,
    href: landingHref(item, user),
  }));
}

/**
 * A type whose items carry no category at all (learning paths) yields one unlabelled group, which
 * the menu reads as "no grouping".
 *
 * When only SOME items lack a category, groupByField collects them under General and that group is
 * kept: dropping it would leave those items with no route through the menu at all, and the content
 * rows show a General heading in exactly the same situation.
 */
function subGroupsFor(items: ProgrammeItem[], user: unknown): NavSubGroup[] {
  const grouped = groupByField(items, 'category');
  const ungroupable = grouped.length === 1 && grouped[0][0] === 'General';
  if (ungroupable) return [{ label: '', items: navItems(items, user) }];
  return grouped.map(([label, group]) => ({ label, items: navItems(group, user) }));
}

/**
 * The Learn menu's contents. A type with nothing published is left out rather than offered as an
 * empty row, which also keeps the nav from linking to a section the page will not render.
 */
export function buildNavGroups(programmes: ProgrammeItem[], user: unknown): NavGroup[] {
  const byType = (type: ProgrammeItem['type']) => programmes.filter(item => item.type === type);
  const groups: Array<NavGroup | null> = [
    { label: 'Courses',             anchor: 'section-courses',        items: byType('course') },
    { label: 'Learning Paths',      anchor: 'section-paths',          items: byType('path') },
    { label: 'Virtual Experiences', anchor: 'section-ves',            items: byType('ve') },
    { label: 'Certifications',      anchor: 'section-certifications', items: byType('certification') },
  ].map(({ label, anchor, items }) => (
    items.length ? { label, anchor, subGroups: subGroupsFor(items, user) } : null
  ));
  return groups.filter((group): group is NavGroup => group !== null);
}
