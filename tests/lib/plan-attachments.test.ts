// Putting content into a subscription plan from the editor that made it.
//
// Two things here can hurt someone. Getting the diff wrong re-adds content that was already
// attached, which resets the notification stamp and emails every subscriber a second time about
// something they already have. Getting the gate wrong lets an author tick a box that the API
// will refuse on save, which is the dead end this feature exists to remove.
import { describe, expect, it } from 'vitest';
import {
  needsPrivacyChange,
  planAttachmentDiff,
  planPickerState,
  plansThatWillNotify,
} from '@/lib/plan-attachments';

describe('planPickerState', () => {
  it('is available for published content that is not already free', () => {
    expect(planPickerState({ contentTable: 'courses', contentId: 'c1', status: 'published' }))
      .toEqual({ enabled: true });
  });

  it('says to save first while the item does not exist yet', () => {
    const state = planPickerState({ contentTable: 'courses', status: 'published' });
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/save this first/i);
  });

  it('says to publish first, because the API refuses draft content', () => {
    const state = planPickerState({ contentTable: 'courses', contentId: 'c1', status: 'draft' });
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/publish this first/i);
  });

  it('stays usable on content that is open to everyone', () => {
    // That is a contradiction the author can resolve here, having been told what it costs --
    // not a dead end that sends them to another screen and back.
    expect(planPickerState({
      contentTable: 'courses', contentId: 'c1', status: 'published', availableToEveryone: true,
    })).toEqual({ enabled: true });
  });

  it('reports the missing item before the draft status, since saving comes first', () => {
    const state = planPickerState({ contentTable: 'courses', status: 'draft' });
    expect(state.enabled === false && state.reason).toMatch(/save this first/i);
  });
});

describe('planAttachmentDiff', () => {
  it('sends only what changed', () => {
    expect(planAttachmentDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });

  it('sends nothing when nothing changed, whatever the order', () => {
    expect(planAttachmentDiff(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [] });
  });

  it('handles the empty cases', () => {
    expect(planAttachmentDiff([], ['a'])).toEqual({ add: ['a'], remove: [] });
    expect(planAttachmentDiff(['a'], [])).toEqual({ add: [], remove: ['a'] });
    expect(planAttachmentDiff([], [])).toEqual({ add: [], remove: [] });
  });
});

describe('plansThatWillNotify', () => {
  const active = { id: 'p1', status: 'active' };
  const inactive = { id: 'p2', status: 'inactive' };

  it('names an active plan gaining this content for the first time', () => {
    const diff = planAttachmentDiff([], ['p1']);
    expect(plansThatWillNotify(diff, [active], 'c1')).toEqual(['p1']);
  });

  it('stays quiet about an inactive plan, which sends nothing', () => {
    const diff = planAttachmentDiff([], ['p2']);
    expect(plansThatWillNotify(diff, [inactive], 'c1')).toEqual([]);
  });

  it('stays quiet when this plan already emailed about this content', () => {
    // Removing and re-adding must not promise a second email: the stamp survives, so the API
    // sends nothing, and warning about it would be a lie.
    const diff = planAttachmentDiff([], ['p1']);
    const plans = [{ ...active, notifiedContentIds: ['c1'] }];
    expect(plansThatWillNotify(diff, plans, 'c1')).toEqual([]);
  });

  it('says nothing about plans being removed', () => {
    const diff = planAttachmentDiff(['p1'], []);
    expect(plansThatWillNotify(diff, [active], 'c1')).toEqual([]);
  });
});

describe('needsPrivacyChange', () => {
  it('is true for content still open to everyone', () => {
    expect(needsPrivacyChange({ contentTable: 'courses', availableToEveryone: true })).toBe(true);
    expect(needsPrivacyChange({ contentTable: 'certifications', availableToEveryone: true })).toBe(true);
  });

  it('is false once it is not', () => {
    expect(needsPrivacyChange({ contentTable: 'courses', availableToEveryone: false })).toBe(false);
    expect(needsPrivacyChange({ contentTable: 'courses' })).toBe(false);
    expect(needsPrivacyChange({ contentTable: 'courses', availableToEveryone: null })).toBe(false);
  });

  it('only applies to the types that carry the flag', () => {
    // Claiming a change is needed where the server needs none would put a warning about losing
    // access in front of someone whose learners lose nothing.
    expect(needsPrivacyChange({ contentTable: 'virtual_experiences', availableToEveryone: true })).toBe(false);
    expect(needsPrivacyChange({ contentTable: 'learning_paths', availableToEveryone: true })).toBe(false);
  });
});
