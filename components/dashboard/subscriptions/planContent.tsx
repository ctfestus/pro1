'use client';

// Adding and removing what a plan unlocks, for both Create plan and the Plans tab, and the
// question asked before anything open to everyone is closed to the plan.

import { useCallback, useState } from 'react';
import {
  applyPlanContentChanges,
  summarizePlanContentOutcomes,
  type PlanContentChange,
  type PlanContentOutcome,
} from '@/lib/plan-content-request';
import type { ThemeColors } from '@/lib/theme';
import { accessToken } from './api';
import { BUTTON, Modal } from './Modal';

export type AskToClosePublic = (titles: string[]) => Promise<boolean>;

export function contentTitle(contentOptions: any[], contentTable: string, contentId: string) {
  return contentOptions.find((item) => item.content_table === contentTable && item.id === contentId)?.title ?? 'this item';
}

/**
 * The question, as a promise the save flows can simply await, and the pop-up that asks it.
 *
 * Asked before anything is closed, and again if the server turns something back. Closing open
 * access is not a detail of saving a plan: it takes the content away from every learner who is
 * not in a cohort and not a subscriber, part-way through included.
 */
export function useClosePublicAsk(C: ThemeColors) {
  const [ask, setAsk] = useState<{ titles: string[]; resolve: (yes: boolean) => void } | null>(null);
  const askToClosePublic = useCallback<AskToClosePublic>(
    (titles) => new Promise<boolean>((resolve) => setAsk({ titles, resolve })),
    [],
  );
  const answer = (yes: boolean) => {
    ask?.resolve(yes);
    setAsk(null);
  };
  const dialog = ask && (
    <Modal title="Some of this is open to everyone" onClose={() => answer(false)} C={C}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: C.text }}>
          {ask.titles.length === 1
            ? 'This is public. Make it available to this plan and your cohorts instead?'
            : 'These are public. Make them available to this plan and your cohorts instead?'}
        </p>
        <ul className="space-y-2">
          {ask.titles.map((title, index) => (
            <li key={`${title}-${index}`} className="text-sm font-semibold" style={{ color: C.text }}>{title}</li>
          ))}
        </ul>
        <p className="text-xs" style={{ color: C.muted }}>Everyone else loses access.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => answer(true)} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>Make plan-only</button>
          <button type="button" onClick={() => answer(false)} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
  return { askToClosePublic, dialog };
}

/**
 * Runs a set of plan-content changes, asking once about anything that would stop being open to
 * everyone. Returns null when the person said no, so nothing was sent.
 *
 * Asked twice over, deliberately. What this screen has loaded says which items are open now,
 * which is what lets it warn before anything happens. The server has the last word, and if it
 * turns something back as still public -- another tab, another person, a list loaded a while
 * ago -- that refusal becomes the same question rather than an error.
 *
 * Not all-or-nothing. Each item is its own request with its own side effects: adding to an
 * active plan emails that plan's learners, and a later failure cannot unsend that. So every
 * change comes back with what happened to it, and the caller says exactly what landed.
 */
export async function runPlanContentChanges(
  changes: PlanContentChange[],
  contentOptions: any[],
  askToClosePublic: AskToClosePublic,
): Promise<{
  summary: ReturnType<typeof summarizePlanContentOutcomes>;
  total: number;
  outcomes: PlanContentOutcome[];
} | null> {
  if (!changes.length) return { summary: summarizePlanContentOutcomes([]), total: 0, outcomes: [] };
  const token = await accessToken();
  const titleOf = (change: PlanContentChange) => contentTitle(contentOptions, change.contentTable, change.contentId);

  const knownPublic = changes.filter((change) =>
    change.add
    && contentOptions.some((item) =>
      item.content_table === change.contentTable && item.id === change.contentId && item.available_to_everyone === true));
  let clearPublicAccess = false;
  if (knownPublic.length) {
    if (!(await askToClosePublic(knownPublic.map(titleOf)))) return null;
    clearPublicAccess = true;
  }

  let outcomes: PlanContentOutcome[] = await applyPlanContentChanges(changes, { token, clearPublicAccess });

  const stale = outcomes.filter((outcome) => outcome.kind === 'needs_private');
  if (stale.length) {
    const agreed = await askToClosePublic(stale.map((outcome) => titleOf(outcome.change)));
    if (agreed) {
      const retried = await applyPlanContentChanges(stale.map((outcome) => outcome.change), { token, clearPublicAccess: true });
      outcomes = [...outcomes.filter((outcome) => outcome.kind !== 'needs_private'), ...retried];
    }
  }

  return { summary: summarizePlanContentOutcomes(outcomes), total: changes.length, outcomes };
}
