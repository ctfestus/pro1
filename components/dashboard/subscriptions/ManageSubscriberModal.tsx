'use client';

import { useState } from 'react';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { postPayments, recordPayment, requestPayment } from './api';
import { freshPayment, type PaymentDraft } from './drafts';
import { BUTTON, Modal } from './Modal';
import { ReferenceFields, TermsFields, paymentReady } from './PaymentFields';
import type { SubsTab } from './types';
import { Pill, dateLabel, learnerName, subscriberBucket } from './ui';

export type SubscriberAction = 'change-plan' | 'request-payment' | 'extend-access';

/** Change a subscriber's plan, ask them to renew, or record a renewal they already paid for. */
export function ManageSubscriberModal({ sub, action, activePlans, currency, onClose, onDone, C }: {
  sub: any;
  action: SubscriberAction;
  activePlans: any[];
  currency: string;
  onClose: () => void;
  onDone: (message: string, tab?: SubsTab) => void;
  C: ThemeColors;
}) {
  const [newPlanId, setNewPlanId] = useState('');
  const [payment, setPayment] = useState(() => freshPayment(currency));
  const [attemptKey, setAttemptKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (change: Partial<PaymentDraft>) => { setPayment((value) => ({ ...value, ...change })); setAttemptKey(''); };
  const bucket = subscriberBucket(sub);

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (action === 'change-plan') {
        await postPayments({ action: 'change-subscription-plan', subscriptionId: sub.id, planId: newPlanId }, 'Failed to change plan');
        onDone('Access plan changed. Billing terms and deadline were preserved.');
      } else if (action === 'request-payment') {
        const data = await requestPayment(sub.student_id, sub.plan_id, payment);
        onDone(
          data.notificationWarning
            ? `Payment request created, but the learner email could not be sent: ${data.notificationWarning}`
            : 'Renewal request sent to the student.',
          'payments',
        );
      } else {
        const key = attemptKey || crypto.randomUUID();
        setAttemptKey(key);
        const data = await recordPayment(true, sub.student_id, sub.plan_id, payment, key);
        onDone(`Renewal recorded and access extended.${data.activationWarning ? ` The learner email could not be sent: ${data.activationWarning}` : ''}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const title = action === 'change-plan' ? 'Change plan' : action === 'request-payment' ? 'Request renewal payment' : 'Record payment and extend';

  return (
    <Modal title={title} eyebrow={learnerName(sub.students)} onClose={onClose} C={C} error={error}>
      {action === 'change-plan' ? (
        <div className="space-y-5">
          <div className="rounded-2xl p-4" style={{ background: C.page }}>
            <p className="text-xs" style={{ color: C.faint }}>Current plan</p>
            <p className="font-semibold mt-1" style={{ color: C.text }}>{sub.subscription_plans?.name}</p>
          </div>
          <div>
            <p className="font-semibold" style={{ color: C.text }}>Select the new plan</p>
            <p className="text-xs mt-1" style={{ color: C.faint }}>Price, duration and expiry remain unchanged.</p>
          </div>
          <MenuSelect
            field
            label="New plan"
            placeholder={`Choose a plan (now on ${sub.subscription_plans?.name || 'another plan'})`}
            value={newPlanId}
            options={activePlans.filter((p) => p.id !== sub.plan_id).map((p) => ({ value: p.id as string, label: p.name as string }))}
            onChange={setNewPlanId}
            C={C}
          />
          <button onClick={save} disabled={busy || !newPlanId} className={`${BUTTON} w-full`} style={{ background: C.cta, color: C.ctaText }}>
            {busy ? 'Saving...' : 'Apply plan'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl p-4 flex items-center justify-between gap-3" style={{ background: C.page }}>
            <div>
              <p className="text-xs" style={{ color: C.faint }}>Current expiry</p>
              <p className="font-semibold mt-1" style={{ color: C.text }}>{dateLabel(sub.current_period_end)}</p>
            </div>
            {bucket === 'cancelled'
              ? <Pill tone="bad" dot C={C}>Cancelled</Pill>
              : bucket === 'ended' ? <Pill tone="mute" dot C={C}>Ended</Pill> : <Pill tone="good" dot C={C}>Active</Pill>}
          </div>
          <TermsFields payment={payment} update={update} showDeadline={action === 'request-payment'} C={C} />
          {action === 'extend-access' && <ReferenceFields payment={payment} update={update} C={C} />}
          <p className="text-xs" style={{ color: C.faint }}>
            {action === 'request-payment'
              ? 'Access extends only after the learner submits payment confirmation and it is approved.'
              : 'This records a verified payment and extends access immediately.'}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button onClick={onClose} disabled={busy} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
            <button
              onClick={save}
              disabled={busy || !paymentReady(payment, action === 'request-payment')}
              className={BUTTON}
              style={{ background: C.cta, color: C.ctaText }}
            >
              {busy ? 'Saving...' : action === 'request-payment' ? 'Send payment request' : 'Record and extend'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
