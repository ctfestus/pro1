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
