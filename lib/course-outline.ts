// A course's outline is stored as one flat list in which a module is a heading item
// (isSection) followed by its lessons and questions until the next heading. The learner
// player reads that list directly, so it stays as it is; these helpers let the editor treat
// a module as a container that holds, moves and deletes with its content.

export interface OutlineGroup<T> {
  /** The module heading, or null for content placed before the first module. */
  section: T | null;
  /** The lessons and questions in the module, in order. */
  items: T[];
  /** Index in the flat list of the heading (or of the first item, for the loose group). */
  start: number;
}

type Item = { id: string; isSection?: boolean };

/** Split the flat list into modules. A leading group with no heading holds loose content. */
export function groupOutline<T extends Item>(questions: T[]): OutlineGroup<T>[] {
  const groups: OutlineGroup<T>[] = [];
  (questions || []).forEach((q, i) => {
    if (q.isSection) groups.push({ section: q, items: [], start: i });
    else if (groups.length === 0) groups.push({ section: null, items: [q], start: i });
    else groups[groups.length - 1].items.push(q);
  });
  return groups;
}

const flatten = <T extends Item>(groups: OutlineGroup<T>[]): T[] =>
  groups.flatMap(g => (g.section ? [g.section, ...g.items] : g.items));

/**
 * Move a whole module (heading and content) to where `targetId` sits: before the target's
 * module when moving up, after it when moving down. A target inside a module counts as that
 * module. Loose content before the first module always stays first.
 */
export function moveModule<T extends Item>(questions: T[], sectionId: string, targetId: string): T[] {
  const groups = groupOutline(questions);
  const from = groups.findIndex(g => g.section?.id === sectionId);
  let to = groups.findIndex(g => g.section?.id === targetId || g.items.some(i => i.id === targetId));
  if (from < 0 || to < 0 || from === to) return questions;
  if (to === 0 && groups[0].section === null) to = 1; // never above the loose group
  if (from === to) return questions;
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  return flatten(groups);
}

/** Ids that go when a module is deleted: just the heading, or the heading and its content. */
export function moduleIds<T extends Item>(questions: T[], sectionId: string, withContent: boolean): string[] {
  const group = groupOutline(questions).find(g => g.section?.id === sectionId);
  if (!group) return [];
  return withContent ? [sectionId, ...group.items.map(i => i.id)] : [sectionId];
}
