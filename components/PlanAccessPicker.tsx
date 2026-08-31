'use client';

/**
 * Which subscription plans include this piece of content, shown in the editor that made it.
 *
 * Access used to be split across two screens: the cohort picker here, and the plan's content
 * list in the Subscriptions section. Nobody writing a course opens a finance screen, so content
 * got a cohort, no plan, and quietly never appeared anywhere the public could find it.
 *
 * Changes apply as they are made rather than on the parent's save. Each editor saves differently
 * and some create the row only at the end, and threading an ordering through all of them would
 * put the same bug in seven places. The picker asks for an id and stays disabled, with the
 * reason, until there is one.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/lib/theme';
import {
  needsPrivacyChange,
  planAttachmentDiff,
  planPickerState,
  plansThatWillNotify,
  type PlanContentTable,
} from '@/lib/plan-attachments';

interface Plan { id: string; name: string; status?: string | null }

export interface PlanAccessPickerProps {
  contentTable: PlanContentTable;
  /** Absent until the item has been saved once. */
  contentId?: string | null;
  /**
   * Only where the editor holds a fresher value than the saved row -- a course whose
   * "available to everyone" switch has been flipped but not saved yet. Otherwise the server's
   * answer is used, so six other editors need pass nothing.
   */
  availableToEveryone?: boolean | null;
  /**
   * Called after open access has been closed here, so the editor can drop its own copy of that
   * switch. Without it the editor still shows Everyone selected and its next save writes the
   * flag straight back on -- silently undoing the change and leaving the content in a plan it
   * contradicts.
   */
  onPublicAccessClosed?: () => void;
}

export function PlanAccessPicker({
  contentTable, contentId, availableToEveryone, onPublicAccessClosed,
}: PlanAccessPickerProps) {
  const C = useC();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [attached, setAttached] = useState<string[]>([]);
  const [notified, setNotified] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  /** A ticked plan waiting on a yes, with what saying yes would do. */
  const [confirming, setConfirming] = useState<
    { plan: Plan; willEmail: boolean; willClosePublic: boolean } | null
  >(null);
  /** The saved row's own state, which is what the API will judge the request against. */
  const [subject, setSubject] = useState<{ status: string | null; free: boolean | null }>({
    status: null, free: null,
  });

  const gate = planPickerState({
    contentTable,
    contentId,
    status: subject.status,
    availableToEveryone: availableToEveryone ?? subject.free,
  });

  const load = useCallback(async () => {
    if (!contentId) { setLoading(false); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session?.access_token}` };
      const [planRes, mineRes] = await Promise.all([
        fetch('/api/payments?action=subscription-plans', { headers }),
        fetch(
          `/api/payments?action=content-plans&contentTable=${encodeURIComponent(contentTable)}`
          + `&contentId=${encodeURIComponent(contentId)}`,
          { headers },
        ),
      ]);
      const planBody = await planRes.json().catch(() => ({}));
      const mineBody = await mineRes.json().catch(() => ({}));
      if (!planRes.ok) throw new Error(planBody.error || 'Could not load plans.');
      if (!mineRes.ok) throw new Error(mineBody.error || 'Could not load plans for this content.');
      setPlans(planBody.plans ?? []);
      setAttached(mineBody.planIds ?? []);
      setNotified(mineBody.notifiedPlanIds ?? []);
      setSubject({ status: mineBody.contentStatus ?? null, free: mineBody.availableToEveryone ?? null });
    } catch (e: any) {
      setError(e?.message || 'Could not load plans.');
    } finally {
      setLoading(false);
    }
  }, [contentTable, contentId]);

  useEffect(() => { void load(); }, [load]);

  const apply = async (plan: Plan, add: boolean, clearPublicAccess = false) => {
    setBusyId(plan.id); setError(''); setConfirming(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: add ? 'add-subscription-plan-content' : 'remove-subscription-plan-content',
          planId: plan.id,
          contentTable,
          contentId,
          // Only ever sent after the author has been shown who loses access and said yes.
          ...(clearPublicAccess ? { clearPublicAccess: true } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update the plan.');
      if (clearPublicAccess) onPublicAccessClosed?.();
      // Re-read rather than assume: the server decides whether an email went, and the stamp it
      // sets is what stops this warning appearing again.
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not update the plan.');
    } finally {
      setBusyId('');
    }
  };

  const toggle = (plan: Plan) => {
    const adding = !attached.includes(plan.id);
    if (!adding) return apply(plan, false);

    const diff = planAttachmentDiff(attached, [...attached, plan.id]);
    const willEmail = plansThatWillNotify(
      diff,
      plans.map(row => ({
        ...row,
        notifiedContentIds: notified.includes(row.id) ? [String(contentId)] : [],
      })),
      String(contentId),
    ).includes(plan.id);
    const willClosePublic = needsPrivacyChange({
      contentTable,
      contentId,
      availableToEveryone: availableToEveryone ?? subject.free,
    });

    // Anything with a consequence somebody would want to know about first gets asked.
    if (willEmail || willClosePublic) {
      setConfirming({ plan, willEmail, willClosePublic });
      return;
    }
    return apply(plan, true);
  };

  return (
    <div>
      <p className="text-xs font-bold mb-1" style={{ color: C.muted }}>Subscription plans</p>
      <p className="text-xs mb-3" style={{ color: C.faint }}>
        Cohorts decide who is assigned this. Plans decide who can buy it. Content in no plan and
        not open to everyone is invisible to visitors.
      </p>

      {/* Loading wins over the gate. The saved status arrives with the plans, so judging
          eligibility first would flash "publish this first" at an already published item. */}
      {loading && contentId && (
        <p className="text-xs flex items-center gap-2" style={{ color: C.faint }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading plans
        </p>
      )}

      {!loading && !gate.enabled && (
        <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: C.page, color: C.muted }}>
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{gate.reason}</span>
        </div>
      )}

      {gate.enabled && !loading && !plans.length && (
        <p className="text-xs" style={{ color: C.faint }}>No subscription plans exist yet.</p>
      )}

      {gate.enabled && !loading && plans.map(plan => {
        const on = attached.includes(plan.id);
        return (
          <div key={plan.id}>
            <label className="flex items-center gap-2 py-1.5 text-sm cursor-pointer" style={{ color: C.text }}>
              <input
                type="checkbox"
                checked={on}
                disabled={!!busyId}
                onChange={() => toggle(plan)}
              />
              <span className="font-semibold">{plan.name}</span>
              {plan.status !== 'active' && (
                <span className="text-[11px]" style={{ color: C.faint }}>inactive</span>
              )}
              {busyId === plan.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {on && busyId !== plan.id && <Check className="w-3.5 h-3.5" style={{ color: C.cta }} />}
            </label>

            {confirming?.plan.id === plan.id && (
              // Said before it happens, not after. Both consequences are real and neither is
              // obvious from a checkbox: an active plan emails its learners, and closing open
              // access takes the content away from anyone outside a cohort or a plan.
              <div className="rounded-xl p-3 my-1 text-xs" style={{ background: C.page }}>
                {confirming.willClosePublic && (
                  <p className="flex items-start gap-2 font-semibold mb-2" style={{ color: C.text }}>
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    This is open to every signed-in learner. Adding it to {plan.name} closes that,
                    so only {plan.name} subscribers and the cohorts you have chosen keep access.
                    Anyone else loses it, including learners part-way through.
                  </p>
                )}
                {confirming.willEmail && (
                  <p className="flex items-start gap-2 font-semibold" style={{ color: C.text }}>
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Everyone on {plan.name} will be emailed once about this.
                  </p>
                )}
                <div className="flex gap-2 mt-2.5">
                  <button
                    type="button"
                    onClick={() => apply(plan, true, confirming.willClosePublic)}
                    className="rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{ background: C.cta, color: '#ffffff' }}
                  >
                    {confirming.willClosePublic ? 'Close open access and add' : 'Add and notify'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{ background: C.card, color: C.text }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && <p className="text-xs mt-2" style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
