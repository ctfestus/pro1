/**
 * Putting a piece of content into a subscription plan, from the editor that made it.
 *
 * Until now the only way was the Subscriptions section: open a plan, tick the content. An
 * instructor writing a course has no reason to go there, so they would choose a cohort, believe
 * they had answered "who gets this", and publish something no visitor could ever find or buy.
 *
 * The rules here mirror what the API enforces rather than inventing a second set. The API is
 * still the authority -- this exists so the editor can say why a control is unavailable instead
 * of letting someone tick a box and meet an error on save.
 */

/** The content types a plan can include. Mirrors the API's own list. */
export type PlanContentTable = 'courses' | 'virtual_experiences' | 'certifications' | 'learning_paths';

export interface PlanPickerSubject {
  contentTable: PlanContentTable;
  /** Draft content cannot be sold, so it cannot be added. */
  status?: string | null;
  /** Content already open to everyone is not something a plan can grant. */
  availableToEveryone?: boolean | null;
  /** Absent while a new item is still being created and has no row yet. */
  contentId?: string | null;
}

export type PlanPickerState =
  | { enabled: true }
  | { enabled: false; reason: string };

/**
 * Whether the picker can be used, and the sentence to show when it cannot.
 *
 * Each reason names the thing to do next. "Unavailable" on its own would leave someone staring
 * at exactly the dead end this feature exists to remove.
 */
export function planPickerState(subject: PlanPickerSubject): PlanPickerState {
  if (!subject.contentId) {
    return { enabled: false, reason: 'Save this first, then choose which plans include it.' };
  }
  if (subject.status !== 'published') {
    return { enabled: false, reason: 'Publish this first. A plan can only include published content.' };
  }
  // Being open to everyone no longer blocks the picker. It is a contradiction rather than an
  // error -- a plan grants access through its cohort, and open-to-everyone bypasses cohorts
  // entirely -- and it is one the author can resolve here, having been told what it costs.
  return { enabled: true };
}

/**
 * Whether adding this content to a plan also has to close its open access first.
 *
 * Only two types carry the flag. Adding while it is on cannot work: the plan grants access by
 * tagging the content with the plan's cohort, and open-to-everyone ignores cohorts, so the two
 * are contradictory answers to the same question.
 *
 * This is never silent. Closing it takes the content away from every signed-in learner who is
 * not in one of its cohorts and not a subscriber, including anyone part-way through it, so the
 * caller has to say so and be told yes.
 */
export function needsPrivacyChange(subject: PlanPickerSubject): boolean {
  if (subject.availableToEveryone !== true) return false;
  return subject.contentTable === 'courses' || subject.contentTable === 'certifications';
}

export interface PlanAttachmentDiff {
  add: string[];
  remove: string[];
}

/**
 * What to send on save. Only the difference: re-adding something already attached would be
 * harmless but re-sending nothing is cheaper, and removing then re-adding would reset the
 * notification stamp and email everyone a second time about content they already have.
 */
export function planAttachmentDiff(
  current: readonly string[],
  selected: readonly string[],
): PlanAttachmentDiff {
  const before = new Set(current);
  const after = new Set(selected);
  return {
    add: [...after].filter(id => !before.has(id)),
    remove: [...before].filter(id => !after.has(id)),
  };
}

/**
 * Which of the chosen plans will email their learners on save, and so what the confirm has to
 * warn about. Only active plans notify, and only the first time a plan gains this content --
 * so re-ticking something that was removed and put back does not promise a second email.
 */
export function plansThatWillNotify(
  diff: PlanAttachmentDiff,
  plans: readonly { id: string; status?: string | null; notifiedContentIds?: readonly string[] }[],
  contentId: string,
): string[] {
  return diff.add.filter(id => {
    const plan = plans.find(row => row.id === id);
    if (!plan || plan.status !== 'active') return false;
    return !(plan.notifiedContentIds ?? []).includes(contentId);
  });
}
