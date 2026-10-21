import { describe, expect, it } from 'vitest';
import { normalizeTracks, needsTrack, requiredItemIds, isPathComplete } from '@/lib/learning-path-tracks';

const path = {
  item_ids: ['core1', 'fin1', 'core2', 'hr1', 'hr2'],
  tracks: [
    { id: 'fin', name: 'Finance', item_ids: ['fin1'] },
    { id: 'hr', name: 'HR', item_ids: ['hr1', 'hr2'] },
  ],
};

describe('learning path tracks', () => {
  it('leaves a path without tracks unchanged', () => {
    const plain = { item_ids: ['a', 'b'], tracks: [] };
    expect(requiredItemIds(plain, null)).toEqual(['a', 'b']);
    expect(needsTrack(plain, null)).toBe(false);
    expect(isPathComplete(plain, null, ['a', 'b'])).toBe(true);
  });

  it('requires core + the chosen track, in path order', () => {
    expect(requiredItemIds(path, 'fin')).toEqual(['core1', 'fin1', 'core2']);
    expect(requiredItemIds(path, 'hr')).toEqual(['core1', 'core2', 'hr1', 'hr2']);
  });

  it('never completes before a track is chosen, even with every core item done', () => {
    expect(requiredItemIds(path, null)).toEqual(['core1', 'core2']);
    expect(needsTrack(path, null)).toBe(true);
    expect(isPathComplete(path, null, ['core1', 'core2'])).toBe(false);
  });

  it('completes on core + track, ignoring the other track', () => {
    expect(isPathComplete(path, 'fin', ['core1', 'core2'])).toBe(false);
    expect(isPathComplete(path, 'fin', ['core1', 'core2', 'fin1'])).toBe(true);
  });

  it('treats a stored track that no longer exists as no choice', () => {
    expect(needsTrack(path, 'gone')).toBe(true);
    expect(isPathComplete(path, 'gone', path.item_ids)).toBe(false);
  });

  it('drops unnamed tracks, duplicate ids and items no longer in the path', () => {
    expect(normalizeTracks([
      { id: 'a', name: ' Finance ', item_ids: ['x', 'removed', 'x'] },
      { id: 'a', name: 'Duplicate', item_ids: [] },
      { id: 'b', name: '  ', item_ids: ['x'] },
      'junk',
    ], ['x'])).toEqual([{ id: 'a', name: 'Finance', item_ids: ['x'] }]);
  });
});
