// The languages the code review screen offers, in the order it shows them. One list, shared by
// the review screen and the editors that let an instructor fix a task's language, so a language
// an instructor can pick is always one the screen can lock to.
export const CODE_REVIEW_LANGUAGES = ['Python', 'SQL', 'JavaScript', 'TypeScript', 'R', 'Java', 'C#', 'Other'] as const;

/** The languages an instructor can fix a task to. "Other" is the learner's catch-all, not a choice to lock. */
export const LOCKABLE_CODE_REVIEW_LANGUAGES = CODE_REVIEW_LANGUAGES.filter(l => l !== 'Other');
