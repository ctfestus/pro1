import { describe, it, expect } from 'vitest';

import { groupOutline, moveModule, moduleIds } from '@/lib/course-outline';

const s = (id: string) => ({ id, isSection: true });
const q = (id: string) => ({ id });
const ids = (list: { id: string }[]) => list.map(x => x.id).join(' ');

// loose: a | module A: a1 a2 | module B: b1 | module C: (empty)
const outline = [q('a'), s('A'), q('a1'), q('a2'), s('B'), q('b1'), s('C')];

describe('course outline', () => {
  it('groups content under its module, with loose content first', () => {
    const g = groupOutline(outline);
    expect(g.map(x => x.section?.id ?? 'loose')).toEqual(['loose', 'A', 'B', 'C']);
    expect(ids(g[1].items)).toBe('a1 a2');
    expect(g[3].items).toEqual([]);
    expect(groupOutline([])).toEqual([]);
  });

  it('moves a whole module, content included, up or down', () => {
    expect(ids(moveModule(outline, 'A', 'B'))).toBe('a B b1 A a1 a2 C');
    expect(ids(moveModule(outline, 'C', 'A'))).toBe('a C A a1 a2 B b1');
  });

  it('treats a target inside a module as that module', () => {
    expect(ids(moveModule(outline, 'B', 'a2'))).toBe('a B b1 A a1 a2 C');
  });

  it('keeps loose content first', () => {
    expect(ids(moveModule(outline, 'B', 'a'))).toBe('a B b1 A a1 a2 C');
  });

  it('leaves the outline unchanged for an unknown or same target', () => {
    expect(moveModule(outline, 'A', 'a1')).toBe(outline);
    expect(moveModule(outline, 'X', 'A')).toBe(outline);
  });

  it('deletes just the heading, or the heading with its content', () => {
    expect(moduleIds(outline, 'A', false)).toEqual(['A']);
    expect(moduleIds(outline, 'A', true)).toEqual(['A', 'a1', 'a2']);
  });
});
