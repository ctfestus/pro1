'use client';

import { useState } from 'react';
import { CheckCircle2, CreditCard, XCircle } from 'lucide-react';
import { durationLabel } from '@/lib/pricing-offer';
import type { ThemeColors } from '@/lib/theme';
import { postPayments } from './api';
import { BUTTON, FIELD, Modal, inputStyle } from './Modal';
import { learnerName, money } from './ui';

export type ReviewTarget = { request: any; decision: 'approve' | 'reject' };

/** Approve or reject the payment a learner says they made. */
export function ReviewModal({ target, onClose, onDone, C }: {
  target: ReviewTarget;
  onClose: () => void;
  onDone: (message: string) => void;
  C: ThemeColors;
}) {
  const { request, decision } = target;
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const confirmation = request.subscription_payment_confirmations?.find((row: any) => row.status === 'pending');
    if (!confirmation) {
      setError('This payment has no confirmation waiting for review. Reload the page to see its current state.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await postPayments({
        action: `${decision}-subscription-confirmation`,
        confirmationId: confirmation.id,
        adminNotes: notes || null,
      }, 'Failed to review confirmation');
      onDone(decision === 'approve'
        ? 'Payment approved. Subscription access is now updated.'
        : 'Confirmation rejected. The student can submit again.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={decision === 'approve' ? 'Approve payment confirmation' : 'Reject payment confirmation'}
      eyebrow={learnerName(request.students)}
      onClose={onClose}
      C={C}
      error={error}
    >
      <div className="space-y-5">
        <div className="rounded-2xl p-5" style={{ background: C.page }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs" style={{ color: C.faint }}>{request.students?.full_name || request.students?.email}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: C.text }}>{money(request.currency, request.amount)}</p>
            </div>
            <CreditCard className="w-7 h-7" style={{ color: C.muted }} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 text-xs" style={{ borderTop: `1px solid ${C.divider}`, color: C.muted }}>
            <span>{request.plan_name}</span>
            <span className="text-right">{durationLabel(Number(request.duration_months))}</span>
          </div>
        </div>
        <label className="text-xs font-semibold" style={{ color: C.muted }}>
          {decision === 'reject' ? 'Reason for rejection' : 'Optional message to learner'}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${FIELD} mt-2 min-h-24`}
            style={inputStyle(C)}
            placeholder={decision === 'reject' ? 'Explain what needs to be corrected' : 'Add a short confirmation note'}
          />
        </label>
        <button
          onClick={submit}
          disabled={busy || (decision === 'reject' && !notes.trim())}
          className={`${BUTTON} w-full`}
          style={{ background: decision === 'approve' ? C.cta : C.deleteText, color: '#fff' }}
        >
          {decision === 'approve' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {decision === 'approve' ? 'Approve and activate access' : 'Reject confirmation'}
        </button>
      </div>
    </Modal>
  );
}
