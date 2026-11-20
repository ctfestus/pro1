'use client';

import { useState } from 'react';
import { ArrowRight, BadgeCheck, Clock3, UserPlus, Users } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { postPayments, recordPayment, requestPayment } from './api';
import { freshPayment, type PaymentDraft } from './drafts';
import { BUTTON, FIELD, Modal, inputStyle } from './Modal';
import { ReferenceFields, TermsFields, paymentReady } from './PaymentFields';
import type { SubsTab } from './types';
import { OptionCard } from './ui';

/** Give one learner a plan: an existing learner or a new account, paid now or by request. */
export function AssignModal({ eligibleStudents, activePlans, currency, onClose, onDone, C }: {
  eligibleStudents: any[];
  activePlans: any[];
  currency: string;
  onClose: () => void;
  /** After it is saved: the message to show, the tab that now holds it and the plan to select. */
  onDone: (message: string, tab: SubsTab, planId: string) => void;
  C: ThemeColors;
}) {
  const [learnerMode, setLearnerMode] = useState<'existing' | 'new'>('existing');
  const [mode, setMode] = useState<'request' | 'paid'>('request');
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState<string>(activePlans[0]?.id ?? '');
  const [payment, setPayment] = useState(() => freshPayment(currency));
  // One key per attempt at a paid save, so a retried click records the payment once. Any change
  // to what is being saved makes it a new attempt.
  const [attemptKey, setAttemptKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const newAttempt = () => setAttemptKey('');
  const update = (change: Partial<PaymentDraft>) => { setPayment((value) => ({ ...value, ...change })); newAttempt(); };

  async function save() {
    setBusy(true);
    setError('');
    const key = attemptKey || crypto.randomUUID();
    if (mode === 'paid') setAttemptKey(key);
    try {
      if (learnerMode === 'new') {
        const data = await postPayments({
          action: 'assign-new-subscription-student',
          mode,
          fullName: name,
          email,
          planId,
          durationMonths: Number(payment.durationMonths),
          amount: Number(payment.amount),
          currency: payment.currency,
          dueDate: payment.dueDate,
          paymentMethod: payment.paymentMethod || null,
          paymentReference: payment.paymentReference || null,
          notes: payment.notes || null,
          idempotencyKey: mode === 'paid' ? key : undefined,
        }, 'Failed to create and assign learner');
        const warnings = [data.notificationWarning, data.activationWarning].filter(Boolean).join(' ');
        onDone(
          `${mode === 'paid' ? 'Account ready and subscription activated.' : 'Account ready and plan assigned. Access begins after payment approval.'}${warnings ? ` ${warnings}` : ''}`,
          mode === 'request' ? 'payments' : 'subscribers',
          planId,
        );
      } else if (mode === 'request') {
        const data = await requestPayment(studentId, planId, payment);
        onDone(
          data.notificationWarning
            ? `Payment request created, but the learner email could not be sent: ${data.notificationWarning}`
            : 'Payment request assigned. Access begins after approval.',
          'payments',
          planId,
        );
      } else {
        const data = await recordPayment(false, studentId, planId, payment, key);
        onDone(
          `Payment recorded and access activated.${data.activationWarning ? ` The learner email could not be sent: ${data.activationWarning}` : ''}`,
          'subscribers',
          planId,
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const learnerChosen = learnerMode === 'existing' ? Boolean(studentId) : Boolean(name.trim()) && /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <Modal title="Assign a subscription" eyebrow="Give access now or send a payment request" onClose={onClose} C={C} error={error} wide>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Learner account</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {([
              ['existing', 'Existing learner', 'Choose an unassigned student', Users],
              ['new', 'New learner', 'Create the account and assign the plan', UserPlus],
            ] as const).map(([id, title, body, Icon]) => (
              <OptionCard
                key={id}
                selected={learnerMode === id}
                onClick={() => { setLearnerMode(id); newAttempt(); setError(''); }}
                icon={<Icon className="w-4 h-4" />}
                title={title}
                sub={body}
                C={C}
              />
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {learnerMode === 'existing' ? (
            <label className="text-xs font-semibold" style={{ color: C.muted }}>
              Learner
              <div className="mt-2">
                <MenuSelect
                  field
                  label="Learner"
                  searchable
                  placeholder="Choose an eligible student"
                  value={studentId}
                  options={eligibleStudents.map((s) => ({ value: s.id as string, label: `${s.full_name || s.email} (${s.email})` }))}
                  onChange={(id) => { setStudentId(id); newAttempt(); }}
                  C={C}
                />
              </div>
            </label>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 sm:col-span-2">
              <label className="text-xs font-semibold" style={{ color: C.muted }}>
                Full name
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Learner's full name" className={`${FIELD} mt-2`} style={inputStyle(C)} />
              </label>
              <label className="text-xs font-semibold" style={{ color: C.muted }}>
                Email address
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="learner@example.com" className={`${FIELD} mt-2`} style={inputStyle(C)} />
              </label>
            </div>
          )}
          <label className="text-xs font-semibold" style={{ color: C.muted }}>
            Access plan
            <div className="mt-2">
              <MenuSelect
                field
                label="Access plan"
                placeholder="Choose an active plan"
                value={planId}
                options={activePlans.map((p) => ({ value: p.id as string, label: p.name as string }))}
                onChange={(id) => { setPlanId(id); newAttempt(); }}
                C={C}
              />
            </div>
          </label>
        </div>
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Payment workflow</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {([
              ['request', 'Request payment', 'Student submits confirmation before access starts', Clock3],
              ['paid', 'Already paid', 'Record verified payment and activate now', BadgeCheck],
            ] as const).map(([id, title, body, Icon]) => (
              <OptionCard key={id} selected={mode === id} onClick={() => { setMode(id); newAttempt(); }} icon={<Icon className="w-4 h-4" />} title={title} sub={body} C={C} />
            ))}
          </div>
        </div>
        <TermsFields payment={payment} update={update} showDeadline={mode === 'request'} C={C} />
        {mode === 'paid' && <ReferenceFields payment={payment} update={update} C={C} />}
        {learnerMode === 'existing' && eligibleStudents.length === 0 && (
          <p className="rounded-xl p-3 text-xs" style={{ background: C.page, color: C.muted }}>
            No eligible students. The student must be unassigned from any bootcamp cohort first.
          </p>
        )}
        <button
          onClick={save}
          disabled={busy || !learnerChosen || !planId || !paymentReady(payment, mode === 'request')}
          className={`${BUTTON} w-full`}
          style={{ background: C.cta, color: C.ctaText }}
        >
          {busy
            ? 'Saving...'
            : learnerMode === 'new'
              ? mode === 'request' ? 'Create account and assign plan' : 'Create account and activate'
              : mode === 'request' ? 'Assign payment request' : 'Activate subscription'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </Modal>
  );
}
