import { describe, expect, it } from 'vitest';
import { normalizeTracks, needsTrack, requiredItemIds, isPathComplete, trackOptOuts, tracksError, changedRequirements, validTrackId, trackLabel, CORE_ONLY_TRACK } from '@/lib/learning-path-tracks';

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

describe('tracksError', () => {
  it('accepts no tracks, and tracks naming items no longer in the path', () => {
    expect(tracksError(undefined)).toBeNull();
    expect(tracksError([])).toBeNull();
    expect(tracksError([{ id: 'a', name: 'Finance', item_ids: ['removed'] }, { id: 'b', name: 'HR' }])).toBeNull();
  });

  it('rejects what normalizeTracks would silently drop', () => {
    expect(tracksError('x')).toMatch(/list/);
    expect(tracksError(['junk'])).toMatch(/object/);
    expect(tracksError([{ name: 'Finance' }])).toMatch(/id/);
    expect(tracksError([{ id: 'a', name: ' ' }])).toMatch(/name/);
    expect(tracksError([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }])).toMatch(/same id/);
    expect(tracksError([{ id: 'a', name: 'A', item_ids: [1] }])).toMatch(/ids/);
  });
});

describe('changedRequirements', () => {
  it('names the tracks whose required items change, and the core when tracks first appear', () => {
    expect(changedRequirements(path, path)).toEqual({ trackIds: [], core: false });
    // fin1 leaves Finance and becomes core: HR learners now need it; Finance learners already did.
    const cleared = { ...path, tracks: [{ ...path.tracks[0], item_ids: [] }, path.tracks[1]] };
    // It is also new core for a Core only learner.
    expect(changedRequirements(path, cleared)).toEqual({ trackIds: ['hr', CORE_ONLY_TRACK], core: false });
    // Renaming changes nobody's requirements.
    const renamed = { ...path, tracks: [path.tracks[0], { ...path.tracks[1], name: 'People' }] };
    expect(changedRequirements(path, renamed)).toEqual({ trackIds: [], core: false });
    const plain = { item_ids: path.item_ids, tracks: [] };
    expect(changedRequirements(plain, path)).toEqual({ trackIds: [], core: true });
    expect(changedRequirements(path, plain)).toEqual({ trackIds: ['fin', 'hr', CORE_ONLY_TRACK], core: false });
  });

  it('leaves Core only learners alone when only a track changes', () => {
    const grown = { item_ids: [...path.item_ids, 'hr3'], tracks: [path.tracks[0], { ...path.tracks[1], item_ids: ['hr1', 'hr2', 'hr3'] }] };
    expect(changedRequirements(path, grown)).toEqual({ trackIds: ['hr'], core: false });
  });
});

describe('core only', () => {
  it('is a made choice that completes on the core alone', () => {
    expect(needsTrack(path, CORE_ONLY_TRACK)).toBe(false);
    expect(requiredItemIds(path, CORE_ONLY_TRACK)).toEqual(['core1', 'core2']);
    expect(isPathComplete(path, CORE_ONLY_TRACK, ['core1', 'core2'])).toBe(true);
  });

  it('opts a Core only learner out of every track item', () => {
    const out = trackOptOuts([{ ...path, id: 'lp1', cohort_ids: ['co1'] }], [{ id: 's1', cohort_id: 'co1' }],
      new Map([['s1|lp1', CORE_ONLY_TRACK]]));
    expect([...out].sort()).toEqual(['s1|fin1', 's1|hr1', 's1|hr2']);
  });

  it('keeps the choice and labels it, but treats a removed track as none', () => {
    expect(validTrackId(path, CORE_ONLY_TRACK)).toBe(CORE_ONLY_TRACK);
    expect(validTrackId(path, 'gone')).toBeNull();
    expect(trackLabel(path, CORE_ONLY_TRACK)).toBe('Core only');
    expect(trackLabel(path, 'hr')).toBe('HR');
    expect(trackLabel(path, null)).toBeNull();
  });

  it('can never be a real track id', () => {
    expect(tracksError([{ id: CORE_ONLY_TRACK, name: 'Sneaky' }])).toMatch(/reserved/);
    expect(normalizeTracks([{ id: CORE_ONLY_TRACK, name: 'Sneaky' }], [])).toEqual([]);
  });
});

describe('trackOptOuts', () => {
  const tracked = { id: 'lp', cohort_ids: ['co1'], ...path };

  it('opts a student out of the other tracks, and out of every track before they pick', () => {
    const out = trackOptOuts([tracked], [{ id: 's1', cohort_id: 'co1' }, { id: 's2', cohort_id: 'co1' }],
      new Map([['s1|lp', 'fin']]));
    expect([...out].sort()).toEqual(['s1|hr1', 's1|hr2', 's2|fin1', 's2|hr1', 's2|hr2']);
  });

  it('keeps an item another reaching path requires, and ignores other cohorts', () => {
    const other = { id: 'lp2', cohort_ids: ['co1'], item_ids: ['hr1'], tracks: [] };
    const out = trackOptOuts([tracked, other], [{ id: 's1', cohort_id: 'co1' }, { id: 's3', cohort_id: 'co2' }],
      new Map([['s1|lp', 'fin']]));
    expect([...out].sort()).toEqual(['s1|hr2']);
  });
});
