// One path for putting content into a plan, used by all three callers.
//
// The bug this exists for: the rule about closing open access was taught to the content-editor
// picker and to nothing else, so the same action worked from a course editor and was refused
// from the Subscriptions screen. The rule now lives here, and these tests hold both the request
// contract and the fact that every caller goes through it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPlanContentChange,
  applyPlanContentChanges,
  decideNewPlanActivation,
  describePlanContentResult,
  summarizePlanContentOutcomes,
  type PlanContentChange,
} from '@/lib/plan-content-request';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const change: PlanContentChange = {
  planId: 'plan-1', contentTable: 'certifications', contentId: 'cert-1', add: true,
};

function mockFetch(response: { ok: boolean; body: any }) {
  const spy = vi.fn().mockResolvedValue({
    ok: response.ok,
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('applyPlanContentChange', () => {
  it('does not ask to close open access unless told to', () => {
    const spy = mockFetch({ ok: true, body: { ok: true, applied: true } });
    return applyPlanContentChange(change, { token: 't' }).then(() => {
      const sent = JSON.parse(spy.mock.calls[0][1].body);
      expect(sent).not.toHaveProperty('clearPublicAccess');
    });
  });

  it('sends the flag only for an addition, never for a removal', async () => {
    // Removing content from a plan has nothing to do with open access, and asking to clear it
    // there would close something nobody was asked about.
    const spy = mockFetch({ ok: true, body: { ok: true, applied: true } });
    await applyPlanContentChange({ ...change, add: false }, { token: 't', clearPublicAccess: true });
    expect(JSON.parse(spy.mock.calls[0][1].body)).not.toHaveProperty('clearPublicAccess');

    const spy2 = mockFetch({ ok: true, body: { ok: true, applied: true } });
    await applyPlanContentChange(change, { token: 't', clearPublicAccess: true });
    expect(JSON.parse(spy2.mock.calls[0][1].body).clearPublicAccess).toBe(true);
  });

  it('reports a refusal for open access as a question, not a failure', async () => {
    mockFetch({ ok: false, body: { error: 'already available to everyone', code: 'needs_private' } });
    const outcome = await applyPlanContentChange(change, { token: 't' });
    expect(outcome.kind).toBe('needs_private');
  });

  it('treats a committed change with a failed email as applied', async () => {
    // The access change commits before anyone is emailed. Reporting the send as the outcome
    // would tell the caller nothing happened when everything did.
    mockFetch({ ok: true, body: { ok: true, applied: true, notificationWarning: 'not sent' } });
    const outcome = await applyPlanContentChange(change, { token: 't' });
    expect(outcome.kind).toBe('applied');
    expect(outcome.kind === 'applied' && outcome.notificationWarning).toBe('not sent');
  });

  it('reports a real failure as a failure, with the reason', async () => {
    mockFetch({ ok: false, body: { error: 'Subscription plan not found' } });
    const outcome = await applyPlanContentChange(change, { token: 't' });
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toContain('not found');
  });

  it('survives a network error rather than throwing into the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const outcome = await applyPlanContentChange(change, { token: 't' });
    expect(outcome.kind).toBe('failed');
  });
});

describe('batches', () => {
  it('returns one outcome per change, whatever happened to each', async () => {
    // Each item is its own request with its own side effects -- adding to an active plan emails
    // its learners -- so a failure cannot undo what already went out. The account has to be
    // complete instead.
    const spy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ applied: true }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) });
    vi.stubGlobal('fetch', spy);
    const outcomes = await applyPlanContentChanges(
      [change, { ...change, contentId: 'cert-2' }],
      { token: 't' },
    );
    expect(outcomes.map(o => o.kind)).toEqual(['applied', 'failed']);
  });

  it('never calls a partial result a success', () => {
    const summary = summarizePlanContentOutcomes([
      { kind: 'applied', change },
      { kind: 'failed', change, error: 'nope' },
    ]);
    const message = describePlanContentResult(summary, 2);
    expect(message).toContain('1 of 2');
    expect(message).toContain('failed');
  });

  it('says plainly when everything landed', () => {
    const summary = summarizePlanContentOutcomes([{ kind: 'applied', change }]);
    expect(describePlanContentResult(summary, 1)).toBe('Saved.');
  });

  it('counts what is still open to everyone separately from what failed', () => {
    const summary = summarizePlanContentOutcomes([
      { kind: 'needs_private', change, error: 'x' },
      { kind: 'failed', change, error: 'y' },
    ]);
    expect(summary.needsPrivate).toHaveLength(1);
    expect(summary.failed).toHaveLength(1);
    expect(describePlanContentResult(summary, 2)).toContain('still open to everyone');
  });
});

describe('every caller goes through this module', () => {
  const dashboard = read('components/dashboard/SubscriptionsSection.tsx');
  const picker = read('components/PlanAccessPicker.tsx');

  it('leaves no caller posting the action by hand', () => {
    // A second hand-rolled request is exactly how the dashboard came to be missing the rule the
    // picker had.
    for (const source of [dashboard, picker]) {
      expect(source).not.toMatch(/action:\s*["']add-subscription-plan-content["']/);
      expect(source).not.toMatch(/action:\s*["']remove-subscription-plan-content["']/);
    }
    expect(picker).toContain('applyPlanContentChange');
    expect(dashboard).toContain('applyPlanContentChanges');
  });

  it('covers the new-plan flow and the existing-plan flow', () => {
    // Both dashboard workflows, which had a request each and a rule in neither.
    const runner = dashboard.indexOf('async function runPlanContentChanges');
    expect(runner).toBeGreaterThan(-1);
    expect(dashboard.match(/runPlanContentChanges\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('loads the flag it needs to warn with, for every content type', () => {
    // Selecting id and title only is why this screen could not tell which items were public.
    expect(dashboard).toContain('"id,title,available_to_everyone"');
  });

  it('asks before closing, and again if the server turns something back', () => {
    expect(dashboard).toContain('askToClosePublic');
    expect(dashboard).toMatch(/needs_private[\s\S]{0,400}askToClosePublic/);
    expect(dashboard).toContain('Close open access and save');
  });

  it('re-reads stored content before reporting a batch', () => {
    // Each change was its own request, so the stored answer is the only honest account of where
    // the plan ended up.
    expect(dashboard).toMatch(/await loadPlanContent\(selectedPlan\.id\)[\s\S]{0,400}describePlanContentResult/);
  });
});

// A plan goes on sale by being activated, and the public pricing view asks for an active plan
// with a live price -- not for any content behind it. So activating a plan whose content did not
// attach publishes something buyable and empty. These are the three ways that used to happen.
describe('activating a newly created plan', () => {
  const requested = [
    { contentTable: 'courses' as const, contentId: 'c1', title: 'Excel Basics' },
    { contentTable: 'certifications' as const, contentId: 'x1', title: 'Data Certificate' },
  ];
  const applied = (contentId: string) => ({
    kind: 'applied' as const,
    change: { planId: 'p', contentTable: 'courses' as const, contentId, add: true },
  });

  it('goes on sale when every item asked for was attached', () => {
    const decision = decideNewPlanActivation({
      requested,
      outcomes: [applied('c1'), { ...applied('x1'), change: { planId: 'p', contentTable: 'certifications', contentId: 'x1', add: true } }],
      wantActive: true,
    });
    expect(decision.activate).toBe(true);
    expect(decision.tone).toBe('success');
    expect(decision.message).toContain('ready for learners');
  });

  it('stays a draft when the open-access warning was cancelled', () => {
    // Cancelled means no request was made at all, so the plan would have gone on sale with none
    // of the content its buyer is being shown.
    const decision = decideNewPlanActivation({ requested, outcomes: null, wantActive: true });
    expect(decision.activate).toBe(false);
    expect(decision.tone).toBe('error');
    expect(decision.message).toContain('draft');
    expect(decision.unresolved).toEqual(['Excel Basics', 'Data Certificate']);
  });

  it('stays a draft when only some of the content attached', () => {
    const decision = decideNewPlanActivation({
      requested,
      outcomes: [
        applied('c1'),
        { kind: 'failed', change: { planId: 'p', contentTable: 'certifications', contentId: 'x1', add: true }, error: 'nope' },
      ],
      wantActive: true,
    });
    expect(decision.activate).toBe(false);
    expect(decision.unresolved).toEqual(['Data Certificate']);
  });

  it('stays a draft when something is still open to everyone', () => {
    const decision = decideNewPlanActivation({
      requested,
      outcomes: [
        applied('c1'),
        { kind: 'needs_private', change: { planId: 'p', contentTable: 'certifications', contentId: 'x1', add: true }, error: 'open' },
      ],
      wantActive: true,
    });
    expect(decision.activate).toBe(false);
    expect(decision.message).toContain('Data Certificate');
  });

  it('names what is missing, so somebody can finish the job', () => {
    const decision = decideNewPlanActivation({ requested, outcomes: null, wantActive: true });
    expect(decision.message).toContain('Excel Basics');
    expect(decision.message).toContain('Data Certificate');
    expect(decision.message).toMatch(/then activate it/i);
  });

  it('never says ready for learners when something is missing', () => {
    // The old flow set an error and then a success line after it, so a partial result read as a
    // finished one.
    const decision = decideNewPlanActivation({ requested, outcomes: null, wantActive: true });
    expect(decision.message).not.toContain('ready for learners');
  });

  it('leaves a deliberate draft a draft, and calls it a success', () => {
    const decision = decideNewPlanActivation({
      requested: [], outcomes: [], wantActive: false,
    });
    expect(decision.activate).toBe(false);
    expect(decision.tone).toBe('success');
    expect(decision.message).toContain('draft');
  });

  it('is what the dashboard actually gates activation on', () => {
    const dashboard = read('components/dashboard/SubscriptionsSection.tsx');
    expect(dashboard).toContain('decideNewPlanActivation');
    expect(dashboard).toContain('if (decision.activate) {');
    // One message from one decision, rather than an error followed by a success.
    expect(dashboard).not.toMatch(/setSuccess\(status === "active"/);
  });
});
