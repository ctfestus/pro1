'use client';

// My Plan for a bootcamp or cohort learner who pays in installments: what the programme costs,
// what is paid and what is due next, the installment schedule, how to pay, a form to confirm a
// payment made outside the platform, and the payment history. Laid out like the subscriber's My
// Plan (components/student/subscription-payments.tsx): a hero, then tabs.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import { Pill, DISPLAY_FONT } from '@/components/dashboard/subscriptions/ui';
import { CreditCard, AlertCircle, Check, Copy, ExternalLink, ArrowRight, ReceiptText } from 'lucide-react';
import { DateField } from '@/components/DatePicker';

type Tone = 'good' | 'warn' | 'bad' | 'mute';
type Tab = 'schedule' | 'pay' | 'confirm' | 'history';

/** The page's money: the enrollment's currency when it has one, a bare number when not. */
function moneyIn(currency: string | null) {
  return (n: number) => `${currency ? `${currency} ` : ''}${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}
const day = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'good' }, completed: { label: 'Completed', tone: 'good' },
  overdue: { label: 'Overdue', tone: 'bad' }, pending_deposit: { label: 'Deposit due', tone: 'warn' },
  waived: { label: 'Waived', tone: 'mute' }, expired: { label: 'Expired', tone: 'mute' },
  paid: { label: 'Paid', tone: 'good' }, partial: { label: 'Part paid', tone: 'warn' }, unpaid: { label: 'Due', tone: 'mute' },
  confirmed: { label: 'Confirmed', tone: 'good' }, approved: { label: 'Approved', tone: 'good' },
  pending: { label: 'Awaiting review', tone: 'warn' }, rejected: { label: 'Rejected', tone: 'bad' },
};
const status = (s: string) => STATUS[s] ?? { label: s.replaceAll('_', ' '), tone: 'mute' as Tone };
// The hero's state pill is white with the status colour as text, readable on the blue.
const HERO_TONE: Record<Tone, string> = { good: '#12A150', warn: '#B45309', bad: '#D92D20', mute: '#475467' };

function CopyValue({ label, value, C, copyable }: { label: string; value: string; C: typeof LIGHT_C; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(value).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }).catch(() => {});
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${C.divider}` }}>
      <span className="text-sm" style={{ color: C.muted }}>{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold" style={{ color: C.text }}>{value}</span>
        {copyable && (
          <button type="button" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg transition-colors" style={{ background: C.pill, color: copied ? '#16a34a' : C.muted }}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
    </div>
  );
}

// A timeline, as on the dashboard's Upcoming: the date on the left, a ring on a dashed line for
// each entry, its colour the entry's status, and the details beside it.
function Timeline({ C, items }: {
  C: typeof LIGHT_C;
  items: { key: string; date?: string | null; tone: Tone; children: React.ReactNode }[];
}) {
  const ring: Record<Tone, string> = { good: '#12A150', warn: '#B45309', bad: '#D92D20', mute: C.faint };
  return (
    <ol className="p-5 sm:p-6">
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        const d = item.date ? new Date(item.date) : null;
        return (
          <li key={item.key} className="flex gap-3">
            <div className="w-12 flex-shrink-0 pt-0.5 text-right">
              <p className="text-base leading-5 font-bold tabular-nums" style={{ color: C.text }}>{d ? d.getDate() : '--'}</p>
              <p className="text-xs" style={{ color: C.muted }}>{d ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''}</p>
            </div>
            <div className="relative flex w-4 flex-shrink-0 justify-center">
              <span className="relative z-10 mt-1 grid h-4 w-4 place-items-center rounded-full" style={{ background: C.card, boxShadow: `inset 0 0 0 2px ${ring[item.tone]}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ring[item.tone] }} />
              </span>
              {!last && <span className="absolute bottom-[-4px] top-6 border-l-2 border-dashed opacity-50" style={{ borderColor: C.faint }} />}
            </div>
            <div className={`min-w-0 flex-1 ${last ? '' : 'pb-6'}`}>{item.children}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function PaymentsSection({ userId, C, readOnly = false }: { userId: string; C: typeof LIGHT_C; readOnly?: boolean }) {
  const dark = C.page === '#17181E';
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [enrollment, setEnrollment]     = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [payments, setPayments]         = useState<any[]>([]);
  const [confirmations, setConf]        = useState<any[]>([]);
  const [options, setOptions]           = useState<any[]>([]);
  const [tab, setTab]                   = useState<Tab>('schedule');
  const tabsRef = useRef<HTMLDivElement>(null);

  // Confirm-a-payment form
  const [amount, setAmount]     = useState('');
  const [paidAt, setPaidAt]     = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod]     = useState('');
  const [reference, setRef]     = useState('');
  const [notes, setNotes]       = useState('');
  const [receiptUrl, setReceipt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The server found this exact payment already waiting for review and did not save it again.
  const [alreadySent, setAlreadySent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = await getToken();
      const res = await fetch(`/api/student-payments?studentId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setEnrollment(res.enrollment ?? null);
      setInstallments(res.installments ?? []);
      setPayments(res.payments ?? []);
      setConf(res.confirmations ?? []);
      setOptions(res.paymentOptions ?? []);
    } catch (e: any) {
      setError(e.message ?? 'We could not load your payments');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const openTab = (next: Tab) => {
    setTab(next);
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleSubmit = async () => {
    setSubmitError(''); setSubmitSuccess(false);
    if (!amount || Number(amount) <= 0) { setSubmitError('Enter the amount you paid.'); return; }
    if (!paidAt) { setSubmitError('Enter the date you paid.'); return; }
    if (!enrollment?.id) { setSubmitError('No enrollment found.'); return; }
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/student-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enrollmentId: enrollment.id,
          amount: Number(amount),
          paidAt,
          method: method || undefined,
          reference: reference || undefined,
          notes: notes || undefined,
          receiptUrl: receiptUrl || undefined,
        }),
      }).then(r => r.json());
      if (res.error) { setSubmitError(res.error); return; }
      setAlreadySent(!!res.alreadySent);
      setSubmitSuccess(true);
      setAmount(''); setMethod(''); setRef(''); setNotes(''); setReceipt('');
      await load();
    } catch (e: any) {
      // A TypeError from fetch means the connection dropped before a response came back
      // (the browser's "Failed to fetch"). The confirmation may still have been saved, so
      // reload the history and tell the student to check it before submitting again.
      if (e instanceof TypeError) {
        setSubmitError('We could not reach the server. Check your connection, then look in History to see if your payment arrived before sending it again.');
        load().catch(() => {});
      } else {
        setSubmitError(e.message ?? 'We could not send your payment.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="space-y-4 mt-2">{[220, 56, 260].map(h => <Sk key={h} h={h} />)}</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-8 h-8 mb-3" style={{ color: '#dc2626' }}/>
        <p className="text-sm" style={{ color: C.muted }}>{error}</p>
        <button onClick={load} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Try again</button>
      </div>
    );
  }

  if (!enrollment && options.length === 0) {
    return <EmptyState icon={CreditCard} title="No payment information yet" body="Your fee and how to pay appear here once an admin confirms your enrollment." />;
  }

  const fmt = moneyIn(enrollment?.currency ?? null);
  const total = Number(enrollment?.total_fee ?? 0);
  const paid = Number(enrollment?.paid_total ?? 0);
  const paidPct = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const nextDue = installments.find((i: any) => i.status === 'unpaid' || i.status === 'partial');
  const nextAmount = nextDue ? Math.max(0, Number(nextDue.amount_due) - Number(nextDue.amount_paid ?? 0)) : 0;
    const pendingReview = confirmations.filter((c: any) => c.status === 'pending');
  const balance = Number(enrollment?.balance ?? 0);
  const accessUntil = enrollment?.access_until ? day(enrollment.access_until) : null;
  // What the hero says for each state of the enrollment.
  const st = enrollment?.access_status as string | undefined;
  const nothingToPay = st === 'waived' || st === 'completed' || balance <= 0;
  const deposit = Math.max(0, Number(enrollment?.deposit_required ?? 0) - paid);
  const hero: { pill: { label: string; tone: Tone }; line: React.ReactNode; note?: React.ReactNode; cardLabel: string; cardValue: string; cardSub: React.ReactNode; warn?: boolean } | null = !enrollment ? null
    : st === 'waived' ? {
      pill: { label: 'Fee waived', tone: 'mute' },
      line: <>Your programme fee is waived. There is nothing to pay.</>,
      cardLabel: 'Access', cardValue: accessUntil ? `Until ${accessUntil}` : 'Full access', cardSub: 'No payment needed',
    }
    : st === 'completed' || (balance <= 0 && st !== 'expired') ? {
      pill: { label: 'Paid in full', tone: 'good' },
      line: <>You have paid <b style={{ color: '#ffffff' }}>{fmt(paid)}</b>. There is nothing more to pay.</>,
      cardLabel: 'Access', cardValue: accessUntil ? `Until ${accessUntil}` : 'Full access', cardSub: 'Thank you',
    }
    : st === 'expired' ? {
      pill: { label: 'Access ended', tone: 'mute' },
      line: <>Your access after the bootcamp {accessUntil ? <>ended on <b style={{ color: '#ffffff' }}>{accessUntil}</b></> : 'has ended'}. Contact your instructor to restore it.</>,
      cardLabel: balance > 0 ? 'Balance' : 'Access', cardValue: balance > 0 ? fmt(balance) : 'Ended', cardSub: balance > 0 ? 'Still to pay' : 'Contact your instructor',
    }
    : st === 'pending_deposit' ? {
      pill: { label: 'Deposit due', tone: 'warn' },
      line: <>Pay your deposit of <b style={{ color: '#ffffff' }}>{fmt(deposit || nextAmount)}</b> to start your programme.</>,
      note: enrollment.restricted ? <>Your courses open once your deposit is confirmed.</> : undefined,
      cardLabel: 'Deposit', cardValue: fmt(deposit || nextAmount),
      cardSub: nextDue ? <>{new Date(nextDue.due_date).getTime() < Date.now() ? 'Was due' : 'Due'} <b>{day(nextDue.due_date)}</b></> : 'Due now',
    }
    : enrollment.restricted ? {
      pill: { label: 'Access paused', tone: 'bad' },
      line: <>You have paid <b style={{ color: '#ffffff' }}>{fmt(paid)}</b> of <b style={{ color: '#ffffff' }}>{fmt(total)}</b>.</>,
      note: <>A payment is overdue, so your courses are paused. They open again once your payment is confirmed.</>,
      cardLabel: 'Overdue payment', cardValue: fmt(nextDue ? nextAmount : balance), warn: true,
      cardSub: nextDue ? <>Was due <b>{day(nextDue.due_date)}</b></> : 'Pay your balance',
    }
    : enrollment.grace_active || st === 'overdue' ? {
      pill: { label: 'Payment overdue', tone: 'warn' },
      line: <>You have paid <b style={{ color: '#ffffff' }}>{fmt(paid)}</b> of <b style={{ color: '#ffffff' }}>{fmt(total)}</b>.</>,
      note: accessUntil && enrollment.grace_active ? <>Pay by <b>{accessUntil}</b> to keep your access.</> : <>Pay soon to keep your access.</>,
      cardLabel: 'Overdue payment', cardValue: fmt(nextDue ? nextAmount : balance), warn: true,
      cardSub: nextDue ? <>Was due <b>{day(nextDue.due_date)}</b></> : 'Pay your balance',
    }
    : {
      pill: { label: 'Active', tone: 'good' },
      line: <>You have paid <b style={{ color: '#ffffff' }}>{fmt(paid)}</b> of <b style={{ color: '#ffffff' }}>{fmt(total)}</b>. Balance <b style={{ color: '#ffffff' }}>{fmt(balance)}</b>.</>,
      cardLabel: nextDue ? 'Next payment' : 'Balance', cardValue: fmt(nextDue ? nextAmount : balance),
      cardSub: nextDue ? <>Due <b>{day(nextDue.due_date)}</b></> : 'Still to pay',
    };

  // The subscriber My Plan's hero: the platform colour, deepened in dark mode.
  const heroStyle = {
    background: dark
      ? `radial-gradient(circle at 85% 16%, color-mix(in srgb, ${C.cta} 46%, transparent), transparent 32%), linear-gradient(135deg, color-mix(in srgb, ${C.cta} 54%, #101218) 0%, color-mix(in srgb, ${C.cta} 28%, #101218) 54%, #17181e 100%)`
      : C.cta,
    color: '#ffffff',
  };

  const history: any[] = [
    ...payments.map((p: any) => ({ id: p.id, amount: Number(p.amount), date: p.paid_at, method: p.method, reference: p.reference, notes: p.notes, status: 'confirmed' })),
    ...confirmations.filter((c: any) => c.status !== 'approved').map((c: any) => ({
      id: c.id, amount: Number(c.amount), date: c.paid_at, method: c.method, reference: c.reference, notes: c.notes,
      receipt: c.receipt_url, adminNotes: c.admin_notes, status: c.status,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Nothing left to pay (waived, or paid in full): no payment tabs.
  const tabs: [Tab, string][] = enrollment && nothingToPay
    ? [['schedule', 'Schedule'], ['history', 'History']]
    : [
      ['schedule', 'Schedule'], ['pay', 'How to pay'],
      ...(readOnly ? [] : [['confirm', 'Confirm a payment'] as [Tab, string]]),
      ['history', 'History'],
    ];
  const card = { background: C.card, boxShadow: '0 1px 2px rgba(16,24,40,0.05)' };
  const field = 'block w-full rounded-xl px-3 py-2.5 text-sm outline-none field-focus';
  const fieldStyle = { background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.cardBorder}` };

  return (
    <div className="space-y-6 pb-10">
      {/* Hero: where the learner stands, in words for their state, and what to do next. */}
      {enrollment && hero && (
        <section className="relative isolate overflow-hidden rounded-[30px] p-5 sm:p-7 lg:p-8" style={heroStyle}>
          <div className="relative grid items-end gap-5 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl leading-8 font-bold sm:text-[28px] sm:leading-9" style={{ color: '#ffffff', fontFamily: DISPLAY_FONT }}>
                  {enrollment.cohort_name || 'Programme fee'}
                </h2>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold" style={{ color: HERO_TONE[hero.pill.tone] }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />{hero.pill.label}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(255,255,255,0.8)' }}>{hero.line}</p>
              {hero.note && <p className="mt-1 text-sm leading-6" style={{ color: '#ffffff' }}>{hero.note}</p>}
              {st !== 'waived' && total > 0 && (
                <div className="mt-5 max-w-xl">
                  <div className="mb-2 flex justify-between text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.78)' }}>
                    <span>{paidPct}% paid</span>
                    {installments.length > 0 && <span>{installments.filter((i: any) => i.status === 'paid').length} of {installments.length} installments</span>}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${paidPct}%`, background: '#ffffff' }} />
                  </div>
                </div>
              )}
            </div>
            <div className="w-full rounded-2xl p-4 sm:min-w-[230px] lg:w-auto" style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(16px)' }}>
              <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>{hero.cardLabel}</p>
              <p className="mt-1.5 text-[22px] leading-7 font-bold" style={{ color: '#ffffff' }}>{hero.cardValue}</p>
              <p className="mt-1.5 text-xs" style={{ color: hero.warn ? '#fecaca' : 'rgba(255,255,255,0.78)' }}>{hero.cardSub}</p>
              {!readOnly && !nothingToPay && st !== 'expired' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => openTab('pay')} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}>How to pay</button>
                  <button type="button" onClick={() => openTab('confirm')} className="inline-flex items-center justify-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#101828]">I have paid<ArrowRight className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {pendingReview.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: C.card, color: C.text }}>
          <Pill tone="warn" C={C}>Awaiting review</Pill>
          <span>{pendingReview.length === 1 ? 'Your payment of ' : `${pendingReview.length} payments, the latest of `}<b>{fmt(pendingReview[0].amount)}</b>{pendingReview.length === 1 ? ' is' : ','} waiting for an admin to confirm it.</span>
        </div>
      )}

      {/* Tabs: the chosen one blue on a white track. */}
      <div ref={tabsRef} role="tablist" aria-label="My plan" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1 scroll-mt-24"
        style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors"
            style={tab === id ? { background: '#3E93FF', color: '#ffffff' } : { color: C.muted }}>
            {label}
          </button>
        ))}
      </div>

      {/* Schedule: every installment, what it is and whether it is paid. */}
      {tab === 'schedule' && (
        <section className="overflow-hidden rounded-2xl" style={card}>
          {installments.length === 0 ? (
            <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
              {!enrollment ? 'Your schedule appears here once an admin confirms your enrollment.'
                : st === 'waived' ? 'Your fee is waived, so there is no schedule.'
                : 'Your fee is paid in one amount.'}
            </p>
          ) : (
            <Timeline C={C} items={installments.map((i: any, idx: number) => {
              const st = status(i.status === 'unpaid' && new Date(i.due_date).getTime() < Date.now() ? 'overdue' : i.status);
              return {
                key: i.id, date: i.due_date, tone: st.tone,
                children: (
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: C.text }}>Installment {idx + 1}, {fmt(i.amount_due)}</p>
                      <p className="mt-0.5 text-xs" style={{ color: C.muted }}>
                        Due <b style={{ color: C.text }}>{day(i.due_date)}</b>
                        {Number(i.amount_paid) > 0 && i.status !== 'paid' && <>, paid <b style={{ color: C.text }}>{fmt(i.amount_paid)}</b> so far</>}
                      </p>
                    </div>
                    <Pill tone={st.tone} dot={st.tone === 'good'} C={C}>{st.label}</Pill>
                  </div>
                ),
              };
            })} />
          )}
        </section>
      )}

      {/* How to pay: every option open, its details ready to copy. */}
      {tab === 'pay' && (
        options.length === 0 ? (
          <section className="rounded-2xl p-8 text-center text-sm" style={{ ...card, color: C.muted }}>No payment options have been set up yet. Contact your instructor.</section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {options.map((opt: any) => (
              <section key={opt.id} className="rounded-2xl p-5" style={card}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-11 w-11 flex-shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: C.pill }}>
                    {opt.logo_url ? <img src={opt.logo_url} alt="" className="h-full w-full object-contain p-1.5" /> : <CreditCard className="h-5 w-5" style={{ color: C.muted }} />}
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold" style={{ color: C.text }}>{opt.label}</span>
                    <span className="block text-xs" style={{ color: C.muted }}>
                      {opt.type === 'bank_transfer' ? 'Bank transfer' : opt.type === 'mobile_money' ? 'Mobile money' : 'Online payment'}
                    </span>
                  </span>
                </div>
                {opt.type === 'bank_transfer' && <>
                  {opt.bank_name      && <CopyValue label="Bank" value={opt.bank_name} C={C} />}
                  {opt.account_name   && <CopyValue label="Account name" value={opt.account_name} C={C} />}
                  {opt.account_number && <CopyValue label="Account number" value={opt.account_number} C={C} copyable />}
                  {opt.branch         && <CopyValue label="Branch" value={opt.branch} C={C} />}
                  {opt.country        && <CopyValue label="Country" value={opt.country} C={C} />}
                </>}
                {opt.type === 'mobile_money' && <>
                  {opt.network             && <CopyValue label="Network" value={opt.network} C={C} />}
                  {opt.mobile_money_number && <CopyValue label="Number" value={opt.mobile_money_number} C={C} copyable />}
                  {opt.account_name        && <CopyValue label="Account name" value={opt.account_name} C={C} />}
                </>}
                {opt.type === 'online' && opt.platform && <CopyValue label="Platform" value={opt.platform} C={C} />}
                {opt.instructions && <p className="pt-3 text-sm" style={{ color: C.muted, borderTop: `1px solid ${C.divider}` }}>{opt.instructions}</p>}
                {opt.type === 'online' && opt.payment_link && (
                  <a href={opt.payment_link} target="_blank" rel="noreferrer"
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{ background: '#3E93FF', color: '#ffffff' }}>
                    Pay online <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </section>
            ))}
          </div>
        )
      )}

      {/* Confirm a payment made by transfer or mobile money; an admin checks it. */}
      {tab === 'confirm' && !readOnly && (
        <section className="rounded-2xl p-5 sm:p-6" style={card}>
          {enrollment ? <>
            <p className="text-sm" style={{ color: C.muted }}>Paid by transfer or mobile money? Tell us here. Your balance updates once an admin confirms it.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>Amount</span>
                <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder={nextDue ? String(nextAmount) : '0'} className={field} style={fieldStyle} />
              </label>
              <div><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>Date paid</span>
                <DateField label="Date paid" value={paidAt} onChange={setPaidAt} clearable={false} C={C} />
              </div>
              <label className="block"><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>How you paid</span>
                <input type="text" value={method} onChange={e => setMethod(e.target.value)} placeholder="Mobile money, bank transfer" className={field} style={fieldStyle} />
              </label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>Reference or transaction ID</span>
                <input type="text" value={reference} onChange={e => setRef(e.target.value)} placeholder="From your receipt or SMS" className={field} style={fieldStyle} />
              </label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>Link to your receipt</span>
                <input type="url" value={receiptUrl} onChange={e => setReceipt(e.target.value)} placeholder="Optional" className={field} style={fieldStyle} />
              </label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-sm font-medium" style={{ color: C.text }}>Note</span>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className={field} style={fieldStyle} />
              </label>
            </div>
            {submitError && <p className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(217,45,32,0.08)', color: '#D92D20' }}>{submitError}</p>}
            {submitSuccess && <p className="mt-4 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: 'rgba(18,161,80,0.10)', color: '#12A150' }}>{alreadySent ? 'You already sent this payment. It is waiting for an admin to confirm it.' : 'Sent. An admin will confirm it, and you can follow it in History.'}</p>}
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="mt-5 inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: '#3E93FF', color: '#ffffff' }}>
              {submitting ? 'Sending' : 'Send for confirmation'}
            </button>
          </> : (
            <p className="py-6 text-center text-sm" style={{ color: C.muted }}>You can confirm a payment once an admin confirms your enrollment.</p>
          )}
        </section>
      )}

      {/* History: confirmed payments and the ones still being reviewed, newest first. */}
      {tab === 'history' && (
        <section className="overflow-hidden rounded-2xl" style={card}>
          {history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <ReceiptText className="h-7 w-7" style={{ color: C.faint }} />
              <p className="text-sm font-semibold" style={{ color: C.text }}>No payments yet</p>
              <p className="text-xs" style={{ color: C.muted }}>Payments you make and confirm appear here.</p>
            </div>
          ) : (
            <Timeline C={C} items={history.map(row => {
              const st = status(row.status);
              return {
                key: row.id, date: row.date, tone: st.tone,
                children: (
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: C.text }}>{fmt(row.amount)}</p>
                      <p className="mt-0.5 text-xs" style={{ color: C.muted }}>
                        {[row.method, row.reference && `Ref ${row.reference}`].filter(Boolean).join(', ') || 'Payment'}
                      </p>
                      {row.status === 'rejected' && row.adminNotes && <p className="mt-1 text-xs" style={{ color: '#D92D20' }}>{row.adminNotes}</p>}
                      {row.receipt && (
                        <a href={row.receipt} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline" style={{ color: C.text }}>
                          Receipt <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <Pill tone={st.tone} dot={st.tone === 'good'} C={C}>{st.label}</Pill>
                  </div>
                ),
              };
            })} />
          )}
        </section>
      )}
    </div>
  );
}
