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
  // The API refuses this for the two types that carry the flag: something already open to
  // everyone is not access a plan can grant.
  if (
    subject.availableToEveryone === true
    && (subject.contentTable === 'courses' || subject.contentTable === 'certifications')
  ) {
    return {
      enabled: false,
      reason: 'This is already available to everyone, so a plan cannot grant it. Restrict it to a cohort first.',
    };
  }
  return { enabled: true };
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
