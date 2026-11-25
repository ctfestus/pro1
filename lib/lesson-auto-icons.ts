// "Add icons": give an existing lesson's blocks icons in one step, from the words already in them.
//
// Each item that can carry an icon (a step, a timeline event, a tab, a section, a flip card, an
// icon grid item) and has none yet gets one: a tool's logo when its title names a built-in tool
// ("Excel" -> the Excel logo), otherwise the icon that best matches its words. Inside one block
// the items either all get an icon or none do -- the platform's own rule -- so an item that
// matches nothing takes a plain icon for that block type, and a block where nothing matches is
// left as it is. Icons the author already chose are never changed.

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { matchLessonIcon, resolveLessonIconKey, toolIconValue, type LessonIconKey, type LessonIconValue } from '@/lib/lesson-icons';
import { DEFAULT_TOOL_ICONS } from '@/lib/tool-icons';

// The items that take an icon: the attr their name is in, the icon for an item that matches
// nothing, and whether the item already shows something else in that place.
const ITEMS: Record<string, { text: string; fallback: LessonIconKey; hasOther?: (attrs: Record<string, unknown>) => boolean }> = {
  stepCard: { text: 'title', fallback: 'checklist' },
  step: { text: 'title', fallback: 'checklist' },
  timelineEntry: { text: 'title', fallback: 'flag' },
  tabPanel: { text: 'label', fallback: 'note' },
  accordionItem: { text: 'title', fallback: 'info', hasOther: (attrs) => !!attrs.logoUrl },
  flipCard: { text: 'front', fallback: 'tip', hasOther: (attrs) => !!attrs.iconUrl },
  iconGridItem: { text: 'title', fallback: 'target' },
};

// Longest names first, so "power bi" wins over a shorter name inside it.
const TOOL_NAMES = Object.keys(DEFAULT_TOOL_ICONS).sort((a, b) => b.length - a.length);

/** A tool logo when the text names a built-in tool, else the best icon, else ''. */
export function iconForText(text: string): LessonIconValue | '' {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const tool = TOOL_NAMES.find((name) => lower.includes(` ${name} `));
  return tool ? toolIconValue(tool) : matchLessonIcon(text);
}

/** The icons to set, as document positions; nothing for a lesson with nothing to add. */
export function suggestLessonIcons(doc: ProseMirrorNode): { pos: number; icon: LessonIconValue }[] {
  const byBlock = new Map<number, { pos: number; icon: LessonIconValue | ''; fallback: LessonIconKey; empty: boolean }[]>();
  doc.descendants((node, pos, parent) => {
    const item = ITEMS[node.type.name];
    if (!item || !parent) return true;
    const blockPos = doc.resolve(pos).before();
    const empty = !resolveLessonIconKey(node.attrs.icon) && !item.hasOther?.(node.attrs);
    const words = String(node.attrs[item.text] ?? '').trim() || node.textContent.slice(0, 200);
    const list = byBlock.get(blockPos) ?? [];
    list.push({ pos, icon: empty ? iconForText(words) : '', fallback: item.fallback, empty });
    byBlock.set(blockPos, list);
    return true;
  });

  const changes: { pos: number; icon: LessonIconValue }[] = [];
  for (const items of byBlock.values()) {
    // Worth doing when an empty item matched, or the block already has icons to complete.
    const matched = items.some((item) => item.empty && item.icon);
    const started = items.some((item) => !item.empty);
    if (!matched && !started) continue;
    for (const item of items) if (item.empty) changes.push({ pos: item.pos, icon: item.icon || item.fallback });
  }
  return changes;
}
