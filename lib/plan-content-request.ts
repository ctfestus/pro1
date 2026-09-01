'use client';

/**
 * The one place the browser asks to put content into a subscription plan, or take it out.
 *
 * There are three callers -- the picker inside each content editor, the dashboard's new-plan
 * flow, and the dashboard's "included content" save. The first was taught to close open access
 * on request and the other two were not, so the same action worked from a course editor and was
 * refused from the Subscriptions screen. Writing that rule a second and third time is how it
 * would drift again, so it is written here once and the callers decide only what to say to the
 * person in front of them.
 *
 * Nothing here decides to remove anyone's access. `clearPublicAccess` is passed through from a
 * caller that has asked and been told yes; this module's job is to make sure the answer reaches
 * the server and that a refusal comes back as a question rather than an error.
 */
import type { PlanContentTable } from '@/lib/plan-attachments';

export interface PlanContentChange {
  planId: string;
  contentTable: PlanContentTable;
  contentId: string;
  /** True to put it in the plan, false to take it out. */
  add: boolean;
}

export type PlanContentOutcome =
  /** Committed. `notificationWarning` means the change landed but the email did not. */
  | { kind: 'applied'; change: PlanContentChange; notificationWarning?: string }
  /** Refused because the content is open to everyone and nobody has agreed to close that. */
  | { kind: 'needs_private'; change: PlanContentChange; error: string }
  | { kind: 'failed'; change: PlanContentChange; error: string };

export interface PlanContentRequestOptions {
  token?: string;
  /** Only ever true when a person has been shown who loses access and said yes. */
  clearPublicAccess?: boolean;
}

export async function applyPlanContentChange(
  change: PlanContentChange,
  options: PlanContentRequestOptions = {},
): Promise<PlanContentOutcome> {
  try {
    const res = await fetch('/api/admissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify({
        action: change.add ? 'add-subscription-plan-content' : 'remove-subscription-plan-content',
        planId: change.planId,
        contentTable: change.contentTable,
        contentId: change.contentId,
        ...(options.clearPublicAccess && change.add ? { clearPublicAccess: true } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));

    // Asked for before it is refused. A caller whose picture of the content is out of date --
    // another tab, another person, a form that has not finished loading -- gets the question
    // rather than a dead end.
    if (!res.ok && body.code === 'needs_private') {
      return { kind: 'needs_private', change, error: String(body.error || '') };
    }
    // The access change commits before anyone is emailed, so a failed send is not a failed
    // attachment. The server says which happened; nothing here infers it from a status code.
    if (body.applied === true) {
      return { kind: 'applied', change, notificationWarning: body.notificationWarning };
    }
    if (!res.ok) return { kind: 'failed', change, error: String(body.error || 'Could not update the plan.') };
    return { kind: 'applied', change };
  } catch (err: any) {
    return { kind: 'failed', change, error: err?.message || 'Could not reach the server.' };
  }
}

/**
 * Several changes at once, as the dashboard saves them.
 *
 * Deliberately not all-or-nothing. Each item is its own request with its own side effects --
 * adding to an active plan emails that plan's learners -- so an early failure must not undo
 * sends that already went out. What it guarantees instead is an honest account: every change
 * comes back with what happened to it, so the caller can say which items landed rather than
 * reporting one error and leaving the rest unexplained.
 */
export async function applyPlanContentChanges(
  changes: readonly PlanContentChange[],
  options: PlanContentRequestOptions = {},
): Promise<PlanContentOutcome[]> {
  const outcomes: PlanContentOutcome[] = [];
  for (const change of changes) {
    outcomes.push(await applyPlanContentChange(change, options));
  }
  return outcomes;
}

export interface PlanContentSummary {
  applied: PlanContentOutcome[];
  needsPrivate: PlanContentOutcome[];
  failed: PlanContentOutcome[];
  warnings: string[];
}

export function summarizePlanContentOutcomes(outcomes: readonly PlanContentOutcome[]): PlanContentSummary {
  return {
    applied: outcomes.filter(o => o.kind === 'applied'),
    needsPrivate: outcomes.filter(o => o.kind === 'needs_private'),
    failed: outcomes.filter(o => o.kind === 'failed'),
    warnings: outcomes
      .map(o => (o.kind === 'applied' ? o.notificationWarning : undefined))
      .filter((w): w is string => !!w),
  };
}

/**
 * What to tell someone after a batch. Never "saved" when part of it did not save: a partial
 * result reported as success is how a plan ends up quietly missing content nobody rechecks.
 */
export function describePlanContentResult(summary: PlanContentSummary, total: number): string {
  const done = summary.applied.length;
  if (!summary.failed.length && !summary.needsPrivate.length) {
    return total === 1 ? 'Saved.' : `Saved all ${total} changes.`;
  }
  const parts = [`${done} of ${total} saved`];
  if (summary.needsPrivate.length) {
    parts.push(`${summary.needsPrivate.length} still open to everyone`);
  }
  if (summary.failed.length) parts.push(`${summary.failed.length} failed`);
  return `${parts.join(', ')}.`;
}

export interface NewPlanDecision {
  /** Whether the plan may be switched on. */
  activate: boolean;
  message: string;
  tone: 'success' | 'error';
  /** Titles of content that did not make it in, for the message. */
  unresolved: string[];
}

/**
 * Whether a newly created plan may go on sale, and what to tell the person.
 *
 * A plan is put on sale by activating it, and the public pricing view asks for an active plan
 * with a live price -- not for any content behind it. So activating a plan whose content did not
 * attach publishes something buyable and empty.
 *
 * `outcomes` is null when the person cancelled the open-access confirmation, in which case
 * nothing was attached at all.
 */
export function decideNewPlanActivation(input: {
  /** What the person chose to include. */
  requested: readonly { contentTable: PlanContentTable; contentId: string; title: string }[];
  /** Null when the confirmation was cancelled, so no request was made. */
  outcomes: readonly PlanContentOutcome[] | null;
  /** Whether they asked for the plan to go live. */
  wantActive: boolean;
}): NewPlanDecision {
  const titleOf = (contentTable: string, contentId: string) =>
    input.requested.find(r => r.contentTable === contentTable && r.contentId === contentId)?.title
      ?? 'one item';

  const unresolved = input.outcomes === null
    // Cancelled: nothing was attached, so everything asked for is outstanding.
    ? input.requested.map(r => r.title)
    : input.outcomes
      .filter(o => o.kind !== 'applied')
      .map(o => titleOf(o.change.contentTable, o.change.contentId));

  if (!unresolved.length) {
    return {
      activate: input.wantActive,
      message: input.wantActive ? 'Plan created and ready for learners.' : 'Plan saved as a draft.',
      tone: 'success',
      unresolved: [],
    };
  }

  // Kept off sale. The plan itself exists and is worth keeping -- the prices and the name are
  // real work -- but it is not something anyone should be able to buy yet.
  const named = unresolved.join(', ');
  return {
    activate: false,
    tone: 'error',
    unresolved,
    message: input.wantActive
      ? `Plan saved as a draft rather than put on sale: ${named} could not be added. Add the missing content, then activate it.`
      : `Plan saved as a draft. ${named} could not be added.`,
  };
}
