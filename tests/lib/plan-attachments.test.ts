// Putting content into a subscription plan from the editor that made it.
//
// Two things here can hurt someone. Getting the diff wrong re-adds content that was already
// attached, which resets the notification stamp and emails every subscriber a second time about
// something they already have. Getting the gate wrong lets an author tick a box that the API
// will refuse on save, which is the dead end this feature exists to remove.
import { describe, expect, it } from 'vitest';
import { planAttachmentDiff, planPickerState, plansThatWillNotify } from '@/lib/plan-attachments';

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

  it('explains that free content cannot be sold, and what to do about it', () => {
    const state = planPickerState({
      contentTable: 'courses', contentId: 'c1', status: 'published', availableToEveryone: true,
    });
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/restrict it to a cohort/i);
  });

  it('applies the free rule only to the types that carry the flag', () => {
    // The API checks available_to_everyone for courses and certifications only. Blocking the
    // others here would disable a control the server would have accepted.
    expect(planPickerState({
      contentTable: 'virtual_experiences', contentId: 'v1', status: 'published', availableToEveryone: true,
    })).toEqual({ enabled: true });
    expect(planPickerState({
      contentTable: 'certifications', contentId: 'x1', status: 'published', availableToEveryone: true,
    }).enabled).toBe(false);
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
