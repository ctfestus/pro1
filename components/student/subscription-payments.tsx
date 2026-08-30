'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowRight, BadgeCheck, Banknote, CalendarClock, Check, CheckCircle2,
  Clock3, Copy, CreditCard, ExternalLink, ReceiptText, Send,
  ShieldCheck, Smartphone, WalletCards, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { PaymentsSection } from '@/components/student/payments';
import { Sk } from '@/components/student/shared';
import { comparePlanPrice } from '@/lib/plan-price-comparison';

type Tab = 'pay' | 'confirm' | 'history';
const PAYSTACK_RETURN_REFERENCE_KEY = 'paystack:return-reference';

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';
}

function money(currency: string, amount: number | string) {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function durationLabel(months: number) {
  if (months === 12) return '1 year';
  return `${months} month${months === 1 ? '' : 's'}`;
}

function renewalCopy(status?: string) {
  if (status === 'active') return { heading: 'Extend your access', action: 'Add more time' };
  if (status === 'cancelled') return { heading: 'Reactivate your plan', action: 'Reactivate plan' };
  return { heading: 'Renew your plan', action: 'Renew plan' };
}

/** The plan length picked on the pricing page, carried here so it is not chosen twice. */
function chosenPriceId(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('priceId') ?? '';
}

function contentTarget() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const contentTable = params.get('contentTable');
  const contentId = params.get('contentId');
  return contentTable && contentId ? { contentTable, contentId } : null;
}

function CopyValue({ value, C }: { value: string; C: typeof LIGHT_C }) {
  const [copied, setCopied] = useState(false);
  return <button onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="inline-flex items-center gap-1.5 font-bold" style={{ color: C.text }}>{value}{copied ? <Check className="w-3.5 h-3.5" style={{ color: '#16a34a' }}/> : <Copy className="w-3.5 h-3.5" style={{ color: C.faint }}/>}</button>;
}

function StatePill({ status, C, inverse = false }: { status: string; C: typeof LIGHT_C; inverse?: boolean }) {
  const tone = ['active', 'approved', 'paid'].includes(status) ? '#16a34a' : ['rejected', 'failed', 'cancelled'].includes(status) ? '#dc2626' : status === 'expired' ? C.muted : '#d97706';
  return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold capitalize" style={{ background: inverse ? 'rgba(255,255,255,0.12)' : `${tone}18`, color: inverse ? '#ffffff' : tone }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: inverse ? '#ffffff' : tone }}/>{status.replaceAll('_', ' ')}</span>;
}

export function StudentPaymentsSection({ userId, C, readOnly = false }: { userId: string; C: typeof LIGHT_C; readOnly?: boolean }) {
  const dark = C.page === '#17181E';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failureEnrollmentModel, setFailureEnrollmentModel] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('history');
  const [selectedOption, setSelectedOption] = useState('');
  const [form, setForm] = useState({ paidAt: new Date().toISOString().slice(0, 10), method: '', reference: '', notes: '', receiptUrl: '' });
  const [busy, setBusy] = useState(false);
  const [paystackBusy, setPaystackBusy] = useState(false);
  const [planBusyId, setPlanBusyId] = useState('');
  // Paying by transfer used to be unreachable whenever Paystack was configured: the button always
  // went straight to the card page. This is the learner saying they would rather not.
  const [payManually, setPayManually] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [message, setMessage] = useState('');
  const returnVerificationStarted = useRef(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Switching tabs from a button somewhere else on the page changes content the learner cannot see.
  // Pressing "I have paid" swapped the panel underneath and left the viewport, and the focus ring,
  // sitting on the button -- so on a phone, where the panel is well below the fold, the tap looked
  // like it had done nothing. Anything that moves the learner to another tab brings them with it.
  const goToTab = useCallback((next: Tab) => {
    setTab(next);
    requestAnimationFrame(() => {
      const tabs = tabsRef.current;
      if (!tabs) return;
      const still = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      tabs.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      // Keyboard and screen reader users continue from the tab strip rather than from a button that
      // is now off screen.
      tabs.focus({ preventScroll: true });
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setFailureEnrollmentModel(null);
    let enrollmentModel: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: student, error: studentError } = await supabase
        .from('students').select('enrollment_model').eq('id', userId).maybeSingle();
      if (studentError) throw studentError;
      enrollmentModel = student?.enrollment_model ?? null;
      const target = contentTarget();
      const targetQuery = target
        ? `&contentTable=${encodeURIComponent(target.contentTable)}&contentId=${encodeURIComponent(target.contentId)}`
        : '';
      const res = await fetch(`/api/student-subscriptions?studentId=${encodeURIComponent(userId)}${targetQuery}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'We could not load your payments');
      setData(body);
    } catch (err: any) { setFailureEnrollmentModel(enrollmentModel); setError(err.message); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Kept in state rather than only in the URL. Stripping the reference on the way out meant a
  // learner whose verification timed out, or whose payment was still settling after four checks,
  // had no way to ask again -- their only route was contacting support about money they had
  // already paid. The reference survives for payment states that are actually settling. An open
  // checkout session is handled by the cart instead, so it is removed from this retry loop.
  const [returnReference, setReturnReference] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnResolved, setReturnResolved] = useState(false);
  // Only a real activation, not a rejection or a review -- this is what earns the moment below.
  const [justPurchased, setJustPurchased] = useState(false);

  const verifyReturn = useCallback(async (reference: string, poll: boolean) => {
    if (!reference) return;
    setReturnBusy(true);
    setMessage('Checking your payment with Paystack...');
    const inFlight = new Set(['pending', 'processing', 'queued', 'initialized']);
    try {
      const attempts = poll ? 4 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 10_000));
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/student-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: 'verify-paystack-return', reference }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Payment verification is temporarily unavailable');
        if (result.status === 'success') {
          window.sessionStorage.removeItem(PAYSTACK_RETURN_REFERENCE_KEY);
          setMessage('Payment confirmed. Your access has been updated.');
          setReturnResolved(true);
          setJustPurchased(true);
          await load();
          return;
        }
        if (result.status === 'needs_review') {
          window.sessionStorage.removeItem(PAYSTACK_RETURN_REFERENCE_KEY);
          setMessage('Your payment was received and is being reviewed by our team. You do not need to pay again.');
          setReturnResolved(true);
          await load();
          return;
        }
        if (result.status === 'ongoing') {
          // `ongoing` describes an open checkout session, not money being settled. Polling it four
          // times only delays the useful answer and then mislabels the checkout as a payment in
          // progress. The cart owns this state and gives the learner Continue and Remove actions.
          window.sessionStorage.removeItem(PAYSTACK_RETURN_REFERENCE_KEY);
          setMessage('Your checkout is still open at Paystack. Use Continue below to return to it, or Remove if you no longer want it.');
          setReturnResolved(true);
          await load();
          return;
        }
        if (!inFlight.has(result.status)) {
          window.sessionStorage.removeItem(PAYSTACK_RETURN_REFERENCE_KEY);
          setMessage(`Payment ${String(result.status || 'was not completed').replaceAll('_', ' ')}.`);
          setReturnResolved(true);
          await load();
          return;
        }
      }
      // Still settling. Bank transfer and mobile money can take a while, so this is not a
      // failure -- it just means the answer has not arrived yet.
      setMessage('Your payment is still being processed. Use Check payment status below in a few minutes; there is no need to pay again.');
    } catch (err: any) {
      setMessage(err.message || 'We could not reach Paystack just now. Use Check payment status to try again.');
    } finally {
      setReturnBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (returnVerificationStarted.current || readOnly) return;
    const returnParams = new URLSearchParams(window.location.search);
    const reference = returnParams.get('paystack_reference')
      || returnParams.get('reference')
      || returnParams.get('trxref')
      || window.sessionStorage.getItem(PAYSTACK_RETURN_REFERENCE_KEY);
    if (!reference) return;
    returnVerificationStarted.current = true;
    setReturnReference(reference);
    window.sessionStorage.setItem(PAYSTACK_RETURN_REFERENCE_KEY, reference);
    // The reference leaves the address bar so a refresh or a shared link does not replay it, but
    // it stays in state so the learner can still ask again.
    const url = new URL(window.location.href);
    url.searchParams.delete('paystack_reference');
    url.searchParams.delete('reference');
    url.searchParams.delete('trxref');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    void verifyReturn(reference, true);
  }, [readOnly, verifyReturn]);

  const requests = useMemo(() => data?.requests ?? [], [data?.requests]);
  const subscription = data?.subscription;
  const openRequest = requests.find((request: any) => ['pending', 'confirmation_submitted'].includes(request.status));
  const pendingConfirmation = openRequest?.subscription_payment_confirmations?.find((row: any) => row.status === 'pending');
  // The learner's own unpaid invoice: raised by them when they chose bank transfer, rather than
  // assigned by the learning team. Only that one is theirs to withdraw, and only while nothing
  // has been submitted against it -- once they have said they paid, it is with staff to review.
  const ownRequest = openRequest && openRequest.status === 'pending' && openRequest.created_by === userId ? openRequest : null;
  const options = data?.paymentOptions ?? [];
  const option = options.find((row: any) => row.id === selectedOption);
  const plan = subscription?.subscription_plans;
  const planName = plan?.name ?? openRequest?.plan_name ?? 'Your plan';
  const overdue = Boolean(openRequest && new Date(`${openRequest.due_date}T23:59:59`).getTime() < Date.now());
  const hasActiveAccess = subscription?.status === 'active' && new Date(subscription.current_period_end).getTime() > Date.now();
  const daysLeft = hasActiveAccess ? Math.max(0, Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / 86_400_000)) : null;
  const periodDays = subscription ? Math.max(1, Math.ceil((new Date(subscription.current_period_end).getTime() - new Date(subscription.current_period_start).getTime()) / 86_400_000)) : 1;
  const accessProgress = daysLeft === null ? 0 : Math.max(0, Math.min(100, ((periodDays - daysLeft) / periodDays) * 100));
  const selectedMethod = option?.label || form.method;
  // A learner may hold one plan at a time. Listing every other plan under "Renew your access"
  // offered a purchase the database will always refuse, so once they have a subscription the
  // only thing on offer is their own plan. Switching is a conversation, not a button.
  const purchasablePlans = useMemo(() => {
    const all = data?.plans ?? [];
    return subscription?.plan_id ? all.filter((row: any) => row.id === subscription.plan_id) : all;
  }, [data?.plans, subscription?.plan_id]);
  const timeline = useMemo(() => [
    ...(data?.payments ?? []).map((row: any) => ({ ...row, displayStatus: 'paid', date: row.paid_at })),
    ...requests.flatMap((request: any) => (request.subscription_payment_confirmations ?? [])
      .filter((row: any) => row.status !== 'approved')
      .map((row: any) => ({ ...row, plan_name: request.plan_name, duration_months: request.duration_months, currency: request.currency, displayStatus: row.status === 'rejected' ? 'failed' : row.status, date: row.paid_at }))),
  ].sort((a: any, b: any) => +new Date(b.date) - +new Date(a.date)), [data?.payments, requests]);
  const showPaymentWorkspace = Boolean(subscription || openRequest || timeline.length);

  if (loading) return <div className="space-y-4"><Sk h={220}/><div className="grid sm:grid-cols-3 gap-3">{[1,2,3].map(i => <Sk key={i} h={110}/>)}</div></div>;
  // Only an actual bootcamp learner gets the installment screen. Testing for "not individual" sent
  // every learner with no model set -- which is every new account -- to a payments page for a
  // bootcamp they never joined, and hid the request failure that caused it.
  if (error && failureEnrollmentModel === 'bootcamp') return <PaymentsSection userId={userId} C={C} readOnly={readOnly}/>;
  if (error) return <div className="rounded-3xl py-20 text-center" style={cardStyle(C)}><AlertCircle className="w-9 h-9 mx-auto mb-3" style={{ color: '#dc2626' }}/><p className="text-sm font-bold" style={{ color: C.text }}>We could not load your subscription</p><p className="text-xs mt-1" style={{ color: C.muted }}>{error}</p><button onClick={load} className="mt-4 rounded-xl px-4 py-2 text-sm font-bold" style={{ background: C.cta, color: C.ctaText }}>Try again</button></div>;
  if (data?.subscriptionEligible === false) return <PaymentsSection userId={userId} C={C} readOnly={readOnly}/>;
  if (data?.purchaseTarget && !data?.plans?.length && !subscription && requests.length === 0) return <div className="py-20 text-center" style={cardStyle(C)}><AlertCircle className="w-9 h-9 mx-auto mb-3" style={{ color: C.faint }}/><p className="text-sm font-bold" style={{ color: C.text }}>No subscription plan is available for this content</p><p className="text-xs mt-1" style={{ color: C.muted }}>Contact the learning team to ask about enrollment.</p></div>;
  // The bootcamp payments screen is for learners who actually owe installments. It used to appear
  // whenever no plans were on sale, so an admin forgetting to price a plan showed every learner an
  // installment page for a bootcamp they had never joined -- and made the real cause invisible.
  if (!subscription && requests.length === 0 && !data?.plans?.length) {
    if (data?.hasBootcampPayments) return <PaymentsSection userId={userId} C={C} readOnly={readOnly}/>;
    return <div className="rounded-3xl py-20 text-center" style={cardStyle(C)}><WalletCards className="w-9 h-9 mx-auto mb-3" style={{ color: C.faint }}/><p className="text-sm font-bold" style={{ color: C.text }}>No plans are on sale yet</p><p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: C.muted }}>There is nothing to buy at the moment. Check back soon, or contact the learning team about getting access.</p></div>;
  }

  const inputStyle = { background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` };
  const inputClass = 'w-full mt-1.5 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2';
  const heroStyle = {
    background: dark
      ? `radial-gradient(circle at 85% 16%, color-mix(in srgb, ${C.cta} 46%, transparent), transparent 32%), linear-gradient(135deg, color-mix(in srgb, ${C.cta} 54%, #101218) 0%, color-mix(in srgb, ${C.cta} 28%, #101218) 54%, #17181e 100%)`
      : C.cta,
    color: '#ffffff',
  };

  async function submit() {
    if (!openRequest || pendingConfirmation) return;
    setBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/student-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({
        action: 'submit-confirmation', requestId: openRequest.id, amount: Number(openRequest.amount), ...form,
        method: selectedMethod,
      }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Failed to submit confirmation');
      setMessage('Payment confirmation submitted. We will notify you after review.');
      setForm({ paidAt: new Date().toISOString().slice(0, 10), method: '', reference: '', notes: '', receiptUrl: '' });
      await load(); goToTab('history');
    } catch (err: any) { setMessage(err.message); } finally { setBusy(false); }
  }

  async function startPaystackCheckout() {
    if (!openRequest || pendingConfirmation) return;
    setPaystackBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/student-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'start-paystack-checkout', requestId: openRequest.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to start online payment');
      if (!body.authorizationUrl) throw new Error('Paystack did not return a checkout link');
      window.location.href = body.authorizationUrl;
    } catch (err: any) {
      setMessage(err.message || 'Failed to start online payment');
      setPaystackBusy(false);
    }
  }

  async function resumeCart(reference: string) {
    setCartBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/student-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'resume-cart', reference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not reopen that checkout');
      if (body.checkout?.authorizationUrl) {
        window.location.href = body.checkout.authorizationUrl;
        return;
      }
      if (body.settled) {
        setMessage(body.settled === 'success'
          ? 'You had already paid for this. Your access is up to date.'
          : 'You had already paid for this. Our team is confirming it and will update your access.');
      }
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Could not reopen that checkout');
    } finally {
      setCartBusy(false);
    }
  }

  async function dismissCart(reference: string) {
    setCartBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/student-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'dismiss-cart', reference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not clear that checkout');
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Could not clear that checkout');
    } finally {
      setCartBusy(false);
    }
  }

  // Withdrawing an invoice the learner raised for themselves. Choosing bank transfer blocks every
  // other way of paying until the request closes, so without this a wrong plan or a change of mind
  // meant waiting for staff to notice. The server re-checks whose it is and asks Paystack whether
  // anything was collected before it closes anything.
  async function cancelOwnRequest(requestId: string) {
    if (!window.confirm('Cancel this payment request? You can choose a plan again afterwards.')) return;
    setRequestBusy(true); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/student-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'cancel-my-request', requestId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not cancel that payment request');
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Could not cancel that payment request');
    } finally {
      setRequestBusy(false);
    }
  }

  async function purchasePlan(priceId: string) {
    setPlanBusyId(priceId); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const target = contentTarget();
      const res = await fetch('/api/student-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'purchase-plan', priceId, paystack: data?.paystackEnabled === true && !payManually, ...(target ?? {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'We could not start your purchase');
      if (body.checkout?.authorizationUrl) {
        window.location.href = body.checkout.authorizationUrl;
        return;
      }
      // A checkout that could not be resumed turned out to be already paid. Reload so they see the
      // access they bought, rather than an error that would have them pay for it twice.
      if (body.settled) {
        setMessage(body.settled === 'success'
          ? 'You had already paid for this. Your access is up to date.'
          : 'You had already paid for this. Our team is confirming it and will update your access.');
        await load();
        return;
      }
      setMessage('Payment request created. Choose a payment method and submit your confirmation.');
      await load();
      setTab('pay');
    } catch (err: any) {
      setMessage(err.message || 'We could not start your purchase');
    } finally {
      setPlanBusyId('');
    }
  }

  return <div className="subscription-typography space-y-5 pb-12">
    <style>{`.subscription-typography .font-black{font-weight:700!important}.subscription-typography .font-bold{font-weight:600!important}`}</style>
    {justPurchased && <PurchaseSuccess planName={planName} until={subscription?.current_period_end} contents={data?.content ?? []} C={C}/>}
    {message && !justPurchased && <div className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3" style={{ background: message.includes('confirmed') ? C.successBg : C.pill, color: message.includes('confirmed') ? C.successText : C.text }}><Clock3 className="w-5 h-5 flex-shrink-0"/><p className="text-sm font-bold flex-1">{message}</p>{returnReference && !returnResolved && !readOnly && <button onClick={() => verifyReturn(returnReference, false)} disabled={returnBusy} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black flex-shrink-0 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{returnBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}Check payment status</button>}</div>}
    <AccessHero
      C={C}
      heroStyle={heroStyle}
      subscription={subscription}
      plan={plan}
      planName={planName}
      openRequest={openRequest}
      pendingConfirmation={pendingConfirmation}
      hasActiveAccess={hasActiveAccess}
      daysLeft={daysLeft}
      accessProgress={accessProgress}
      overdue={overdue}
      onConfirm={() => goToTab('confirm')}
    />

    {overdue && <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.errorBg, border: `1px solid ${C.errorBorder}`, color: C.errorText }}><AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5"/><div><p className="text-sm font-bold">Your payment deadline has passed</p><p className="text-xs mt-1 opacity-80">You can still send your confirmation. Contact support if your payment terms need to be updated.</p></div></div>}
    {pendingConfirmation && <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.18)', color: '#b45309' }}><Clock3 className="w-5 h-5 flex-shrink-0 mt-0.5"/><div className="flex-1"><p className="text-sm font-bold">Payment review in progress</p><p className="text-xs mt-1 opacity-80">Submitted {fmtDate(pendingConfirmation.created_at)}. Your access updates automatically after approval.</p></div><span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Pending</span></div>}

    {/* Filtering to the learner's own plan can legitimately leave nothing to show: they followed
        a locked-content link covered only by some other plan. Silently dropping the whole section
        left them on a page with no plans and no reason why, which reads as a bug. */}
    {!purchasablePlans.length && !pendingConfirmation && subscription && <section className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}><div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.cta }}/><div><p className="font-black" style={{ color: C.text }}>{data?.purchaseTarget ? 'This content needs a different plan' : 'No plan is available to renew right now'}</p><p className="text-xs mt-1" style={{ color: C.faint }}>{data?.purchaseTarget ? `Your plan is ${planName}, which does not include this content. Moving to another plan needs the learning team, so please contact them to ask about access.` : `Your plan is ${planName}. Contact the learning team to ask about renewing it.`}</p></div></div></section>}

    {/* An unfinished checkout, offered back rather than left as a dead end. Not a debt and not a
        deadline: nothing is owed, the learner simply started something. Continue goes back through
        the reservation path rather than a stored link, since a checkout session can expire.

        Shown to renewing subscribers too. Gating it on not having access looked sensible and was
        exactly backwards: a renewal creates a checkout like any other, so the people most likely
        to abandon one were the only people the card refused to appear for -- blocked by their own
        cart, with no way to see or clear it. */}
    {data?.cart && !openRequest && !readOnly && <section className="relative overflow-hidden rounded-2xl p-3 sm:p-4" style={{ background: dark ? 'linear-gradient(135deg, #101820 0%, #0f2a2a 52%, #10201c 100%)' : 'linear-gradient(135deg, #f8ffff 0%, #ecfeff 54%, #f0fdf4 100%)', boxShadow: dark ? '0 18px 44px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.08)' : '0 16px 44px rgba(15,118,110,0.11), inset 0 1px 0 rgba(255,255,255,0.92)' }}>
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: dark ? 'radial-gradient(circle at 18% 12%, rgba(34,211,238,0.24), transparent 31%), radial-gradient(circle at 90% 105%, rgba(20,184,166,0.22), transparent 34%)' : 'radial-gradient(circle at 18% 12%, rgba(6,182,212,0.20), transparent 31%), radial-gradient(circle at 90% 105%, rgba(20,184,166,0.18), transparent 34%)' }}/>
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.74), rgba(20,184,166,0.62), transparent)' }}/>
      <div className="relative grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ background: dark ? 'rgba(34,211,238,0.13)' : 'rgba(6,182,212,0.12)', color: dark ? '#a5f3fc' : '#0e7490' }}>
              {hasActiveAccess ? 'Complete your renewal' : 'Complete your checkout'}
            </span>
            <span className="text-xs font-bold" style={{ color: dark ? 'rgba(255,255,255,0.68)' : C.faint }}>Your checkout is paused, not lost</span>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="max-w-3xl truncate text-lg font-black leading-tight sm:text-xl" style={{ color: dark ? '#fff7ed' : C.text }}>
              {data.cart.plan_name}
            </p>
            <span className="text-sm font-bold" style={{ color: dark ? 'rgba(255,255,255,0.76)' : C.muted }}>{data.cart.duration_months === 12 ? '1 year' : `${data.cart.duration_months} month${data.cart.duration_months > 1 ? 's' : ''}`}</span>
            <span className="text-sm font-black" style={{ color: dark ? '#a5f3fc' : '#0f766e' }}>{money(data.cart.currency, data.cart.amount)}</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: dark ? 'rgba(255,255,255,0.70)' : C.muted }}>
            {hasActiveAccess ? 'Your renewal is waiting where you left it.' : 'You started enrollment and can finish it now.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:w-64">
          <button onClick={() => dismissCart(data.cart.reference)} disabled={cartBusy} className="inline-flex items-center justify-center rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors disabled:opacity-50" style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.70)', color: dark ? 'rgba(255,255,255,0.74)' : C.muted, border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(14,116,144,0.14)'}` }}>Remove</button>
          <button onClick={() => resumeCart(data.cart.reference)} disabled={cartBusy} className="inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-black transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0" style={{ background: dark ? 'linear-gradient(135deg, #22d3ee, #14b8a6)' : 'linear-gradient(135deg, #06b6d4, #10b981)', color: '#ffffff', boxShadow: '0 12px 24px rgba(15,118,110,0.22)' }}>Continue{cartBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4"/>}</button>
        </div>
      </div>
    </section>}

    {/* The learner's own unpaid invoice, in the same slot the cart uses -- the two cannot both be
        open. Bank transfer raises a request, and a request blocks every other way of paying until
        it closes, so the way out has to be on the screen rather than in a message to staff. */}
    {ownRequest && !readOnly && <section className="rounded-2xl p-4 sm:p-5" style={{ background: `${C.cta}0D`, border: `1px solid ${C.cardBorder}` }}><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: C.faint }}>You chose to pay by transfer</p><p className="font-black mt-1 truncate" style={{ color: C.text }}>{ownRequest.plan_name}</p><p className="text-xs mt-1" style={{ color: C.muted }}>{ownRequest.duration_months === 12 ? '1 year' : `${ownRequest.duration_months} month${ownRequest.duration_months > 1 ? 's' : ''}`} &middot; {money(ownRequest.currency, ownRequest.amount)} &middot; by {fmtDate(ownRequest.due_date)}</p></div><div className="grid grid-cols-2 gap-2 sm:flex sm:flex-shrink-0"><button onClick={() => cancelOwnRequest(ownRequest.id)} disabled={requestBusy} className="min-h-11 rounded-xl px-3.5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: C.card, color: C.muted }}>{requestBusy ? 'Cancelling...' : 'Cancel'}</button><button onClick={() => goToTab('confirm')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black" style={{ background: C.cta, color: C.ctaText }}>I have paid<ArrowRight className="w-4 h-4"/></button></div></div></section>}

    {/* Not gated on holding a subscription. It was, and a learner who had never bought anything
        saw only the banner offering an upgrade -- with no plans under it and no way to buy one.
        The pricing page sent them here to choose and this screen sent them back there, so a new
        account could not purchase at all. */}
    {!!purchasablePlans.length && !pendingConfirmation && <PricingStage
      plans={purchasablePlans}
      subscription={subscription}
      openRequest={openRequest}
      planBusyId={planBusyId}
      paystackEnabled={data?.paystackEnabled === true}
      payManually={payManually}
      readOnly={readOnly}
      C={C}
      onPurchase={purchasePlan}
      onToggleManual={() => setPayManually(value => !value)}
      chosenPriceId={chosenPriceId()}
    />}

    {showPaymentWorkspace && <div ref={tabsRef} tabIndex={-1} className="space-y-5 outline-none scroll-mt-20">
    {tab === 'pay' && openRequest && <section className="grid lg:grid-cols-[1fr_320px] gap-5">
      <div className="rounded-2xl p-4 sm:p-6" style={cardStyle(C)}><div className="flex items-center justify-between gap-4 mb-5"><div><p className="font-black" style={{ color: C.text }}>Choose how to pay</p><p className="text-xs mt-1" style={{ color: C.faint }}>Pay online or use the verified manual details below.</p></div><CreditCard className="w-5 h-5" style={{ color: C.cta }}/></div>{data?.paystackEnabled && openRequest && !pendingConfirmation && !readOnly && <div className="mb-5 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: `${C.cta}10`, border: `1px solid ${C.cardBorder}` }}><div className="flex-1"><p className="text-sm font-black" style={{ color: C.text }}>Pay online with Paystack</p><p className="text-xs mt-1" style={{ color: C.faint }}>Card, bank, and mobile money options are confirmed automatically after payment.</p></div><button onClick={startPaystackCheckout} disabled={paystackBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{paystackBusy ? 'Opening...' : `Pay ${money(openRequest.currency, openRequest.amount)}`}<ExternalLink className="w-4 h-4"/></button></div>}{options.length ? <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-3">{options.map((row: any) => { const Icon = row.type === 'mobile_money' ? Smartphone : row.type === 'bank_transfer' ? Banknote : CreditCard; return <button key={row.id} onClick={() => { setSelectedOption(row.id); setForm(v => ({ ...v, method: row.label })); }} className="relative rounded-2xl p-4 text-left min-h-28 transition-all hover:-translate-y-0.5" style={{ background: selectedOption === row.id ? `${C.cta}10` : C.page, outline: selectedOption === row.id ? `2px solid ${C.cta}` : '2px solid transparent' }}>{selectedOption === row.id && <span className="absolute top-3 right-3 w-5 h-5 rounded-full grid place-items-center" style={{ background: C.cta, color: C.ctaText }}><Check className="w-3 h-3"/></span>}{row.logo_url ? <img src={row.logo_url} alt="" className="h-8 max-w-20 object-contain mb-4"/> : <div className="w-9 h-9 rounded-xl grid place-items-center mb-4" style={{ background: C.card, color: C.cta }}><Icon className="w-4 h-4"/></div>}<p className="text-sm font-bold" style={{ color: C.text }}>{row.label}</p><p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: C.faint }}>{row.type?.replaceAll('_',' ') || 'Payment option'}</p></button>; })}</div> : <div className="rounded-2xl py-14 text-center" style={{ background: C.page }}><WalletCards className="w-8 h-8 mx-auto" style={{ color: C.faint }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>No payment options yet</p><p className="text-xs mt-1" style={{ color: C.faint }}>Contact your administrator for payment instructions.</p></div>}</div>
      <aside className="rounded-2xl p-5 min-h-64" style={cardStyle(C)}>{option ? <div><div className="flex items-center gap-3 pb-4" style={{ borderBottom: `1px solid ${C.divider}` }}><div className="w-11 h-11 rounded-xl grid place-items-center" style={{ background: `${C.cta}12`, color: C.cta }}><ShieldCheck className="w-5 h-5"/></div><div><p className="font-black" style={{ color: C.text }}>{option.label}</p><p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: C.faint }}>Verified details</p></div></div><div className="space-y-3 py-5 text-sm">{option.bank_name && <Detail label="Bank" value={option.bank_name} C={C}/>} {option.network && <Detail label="Network" value={option.network} C={C}/>} {option.account_name && <Detail label="Account name" value={option.account_name} C={C}/>} {option.account_number && <div><p className="text-[10px] uppercase font-bold" style={{ color: C.faint }}>Account number</p><div className="mt-1"><CopyValue value={option.account_number} C={C}/></div></div>} {option.mobile_money_number && <div><p className="text-[10px] uppercase font-bold" style={{ color: C.faint }}>Mobile number</p><div className="mt-1"><CopyValue value={option.mobile_money_number} C={C}/></div></div>}{option.instructions && <p className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: C.page, color: C.muted }}>{option.instructions}</p>}{option.payment_link && <a href={option.payment_link} target="_blank" rel="noreferrer" className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: C.cta, color: C.ctaText }}>Open secure payment<ExternalLink className="w-4 h-4"/></a>}</div>{openRequest && <button onClick={() => goToTab('confirm')} className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: C.pill, color: C.cta }}>I have paid<ArrowRight className="w-4 h-4"/></button>}</div> : <div className="h-full min-h-60 grid place-items-center text-center"><div><CreditCard className="w-8 h-8 mx-auto" style={{ color: C.faint }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>Select a payment option</p><p className="text-xs mt-1" style={{ color: C.faint }}>Account details will appear here.</p></div></div>}</aside>
    </section>}

    {tab === 'confirm' && <section className="grid lg:grid-cols-[320px_1fr] gap-5">
      <aside className="rounded-2xl p-5 h-fit" style={cardStyle(C)}><p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: C.faint }}>Assigned payment</p>{openRequest ? <><p className="text-3xl font-black mt-3" style={{ color: C.text }}>{money(openRequest.currency,openRequest.amount)}</p><div className="space-y-3 mt-6 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}><Detail label="Access plan" value={openRequest.plan_name} C={C}/><Detail label="Duration" value={`${openRequest.duration_months} months`} C={C}/><Detail label="Deadline" value={fmtDate(openRequest.due_date)} C={C}/></div><div className="mt-5 rounded-xl p-3 flex gap-2" style={{ background: `${C.cta}0f` }}><ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: C.cta }}/><p className="text-[11px] leading-relaxed" style={{ color: C.muted }}>Your amount is locked to the terms assigned by the administrator.</p></div></> : <div className="py-12 text-center"><CheckCircle2 className="w-8 h-8 mx-auto" style={{ color: C.green }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>Nothing is due</p></div>}</aside>
      <div className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}>{!openRequest ? <EmptyMessage icon={BadgeCheck} title="No payment awaiting confirmation" body="When a renewal or a new plan is assigned, it will appear here." C={C}/> : pendingConfirmation ? <EmptyMessage icon={Clock3} title="Confirmation under review" body="You have already submitted this payment. We will notify you when the review is complete." C={C}/> : readOnly ? <EmptyMessage icon={ShieldCheck} title="Read-only preview" body="Payment submission is disabled while an administrator is viewing as this student." C={C}/> : <div><div className="mb-6"><p className="font-black" style={{ color: C.text }}>Tell us how you paid</p><p className="text-xs mt-1" style={{ color: C.faint }}>This does not grant access immediately. An administrator verifies the details first.</p></div><div className="grid sm:grid-cols-2 gap-4"><label className="text-xs font-bold" style={{ color: C.muted }}>Date paid<input type="date" max={new Date().toISOString().slice(0,10)} value={form.paidAt} onChange={e => setForm(v => ({ ...v, paidAt: e.target.value }))} className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Payment method<input value={form.method} onChange={e => setForm(v => ({ ...v, method: e.target.value }))} placeholder="Mobile Money or bank transfer" className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Transaction reference<input value={form.reference} onChange={e => setForm(v => ({ ...v, reference: e.target.value }))} placeholder="Transaction ID" className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Receipt link <span className="font-normal" style={{ color: C.faint }}>(optional)</span><input type="url" value={form.receiptUrl} onChange={e => setForm(v => ({ ...v, receiptUrl: e.target.value }))} placeholder="https://..." className={inputClass} style={inputStyle}/></label><label className="sm:col-span-2 text-xs font-bold" style={{ color: C.muted }}>Anything else we should know? <span className="font-normal" style={{ color: C.faint }}>(optional)</span><textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} className={`${inputClass} min-h-24`} style={inputStyle} placeholder="Add a short note"/></label></div>{message && <div className="rounded-xl p-3 text-xs mt-4" style={{ background: message.startsWith('Payment') ? C.successBg : C.errorBg, color: message.startsWith('Payment') ? C.successText : C.errorText }}>{message}</div>}<button onClick={submit} disabled={busy || !form.paidAt || !form.reference.trim()} className="mt-5 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition-transform hover:-translate-y-0.5 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Sending...' : 'Submit for verification'}<Send className="w-4 h-4"/></button></div>}</div>
    </section>}

    <PaymentHistoryTable timeline={timeline} C={C}/>
    </div>}
  </div>;
}

function AccessHero({
  C, heroStyle, subscription, plan, planName, openRequest, pendingConfirmation,
  hasActiveAccess, daysLeft, accessProgress, overdue, onConfirm,
}: {
  C: typeof LIGHT_C;
  heroStyle: React.CSSProperties;
  subscription: any;
  plan: any;
  planName: string;
  openRequest: any;
  pendingConfirmation: any;
  hasActiveAccess: boolean;
  daysLeft: number | null;
  accessProgress: number;
  overdue: boolean;
  onConfirm: () => void;
}) {
  const choosingPlan = !subscription && !openRequest;
  const dark = C.page === '#17181E';

  return <section className="relative isolate overflow-hidden rounded-[30px] p-5 sm:p-7 lg:p-8" style={{ ...heroStyle, color: '#ffffff' }}>
    <div className="pointer-events-none absolute inset-0 opacity-35" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)', backgroundSize: '42px 42px', maskImage: 'linear-gradient(to right, transparent, black 48%, black)' }}/>
    {dark && <>
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: `color-mix(in srgb, ${C.cta} 32%, transparent)` }}/>
      <div className="pointer-events-none absolute bottom-7 right-16 h-28 w-28 rounded-full opacity-40" style={{ background: `radial-gradient(circle, transparent 44%, color-mix(in srgb, ${C.cta} 48%, transparent) 45%, transparent 48%)` }}/>
    </>}

    {choosingPlan ? <div className="relative flex w-full flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.64)' }}>Your current plan</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.025em] sm:text-3xl" style={{ color: '#ffffff' }}>Starter plan</h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.72)' }}>Upgrade to Pro to unlock the complete learning experience and accelerate your progress.</p>
      </div>
      <Link href="/pricing" className="inline-flex min-h-12 w-full flex-shrink-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-black transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:brightness-110 active:translate-y-0 active:scale-[0.98] sm:w-fit" style={{ background: '#10b981', color: '#ffffff' }}>Upgrade to Pro</Link>
    </div> : <div className="relative grid items-end gap-5 lg:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: '#ffffff' }}>{planName}</h2>
          <StatePill status={subscription?.status || 'awaiting payment'} C={C} inverse/>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.72)' }}>
          {plan?.description || (subscription ? `Your access runs until ${fmtDate(subscription.current_period_end)}. It does not renew automatically.` : 'Complete your assigned payment to unlock this learning plan.')}
        </p>
        {hasActiveAccess ? <div className="mt-5 max-w-xl">
          <div className="mb-2 flex justify-between text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.72)' }}><span>Access started {fmtDate(subscription.current_period_start)}</span><span>{daysLeft} days remaining</span></div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }}><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${accessProgress}%`, background: C.cta }}/></div>
        </div> : subscription && <p className="mt-4 text-xs font-bold" style={{ color: 'rgba(255,255,255,0.72)' }}>{subscription.status === 'cancelled' ? 'Your access was cancelled. Contact the learning team if that is not right.' : `Your access ended on ${fmtDate(subscription.current_period_end)}. Renew below to continue.`}</p>}
      </div>
      <div className="relative w-full rounded-2xl p-4 sm:min-w-[210px] lg:w-auto" style={{ background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(16px)' }}>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.55)' }}>{openRequest ? 'Payment due' : hasActiveAccess ? 'Access until' : 'Access status'}</p>
        <p className="mt-1.5 text-xl font-black" style={{ color: '#ffffff' }}>{openRequest ? money(openRequest.currency, openRequest.amount) : hasActiveAccess ? fmtDate(subscription?.current_period_end) : subscription?.status === 'cancelled' ? 'Cancelled' : 'Ended'}</p>
        <p className="mt-1.5 text-xs" style={{ color: overdue ? '#fca5a5' : 'rgba(255,255,255,0.68)' }}>{openRequest ? `${overdue ? 'Past due' : 'Due'} ${fmtDate(openRequest.due_date)}` : hasActiveAccess ? `${daysLeft} days remaining` : 'Renew below to continue'}</p>
        {openRequest && !pendingConfirmation && <button onClick={onConfirm} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-[#101828]">Confirm payment<ArrowRight className="h-3.5 w-3.5"/></button>}
      </div>
    </div>}
  </section>;
}

function PricingStage({
  plans, subscription, openRequest, planBusyId, paystackEnabled, payManually,
  readOnly, C, onPurchase, onToggleManual, chosenPriceId,
}: {
  plans: any[];
  subscription: any;
  openRequest: any;
  planBusyId: string;
  paystackEnabled: boolean;
  payManually: boolean;
  readOnly: boolean;
  C: typeof LIGHT_C;
  onPurchase: (priceId: string) => void;
  onToggleManual: () => void;
  chosenPriceId?: string;
}) {
  const copy = renewalCopy(subscription?.status);
  return <section id="access-plans" aria-labelledby="access-plans-heading" className="scroll-mt-20 py-2">
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h3 id="access-plans-heading" className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: C.text }}>{subscription ? copy.heading : 'Choose your access'}</h3>
      {paystackEnabled && <button type="button" onClick={onToggleManual} className="inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold transition-colors" style={{ background: C.card, color: C.muted }}><CreditCard className="h-3.5 w-3.5"/>{payManually ? 'Bank transfer selected' : 'Secure online payment'}<span className="h-2 w-2 rounded-full" style={{ background: payManually ? '#f59e0b' : '#16a34a' }}/></button>}
    </div>

    <div className="space-y-4">
      {plans.map(plan => <SubscriptionPlanCard key={plan.id} plan={plan} subscription={subscription} openRequest={openRequest} planBusyId={planBusyId} readOnly={readOnly} C={C} onPurchase={onPurchase} chosenPriceId={chosenPriceId}/>)}
    </div>

    {paystackEnabled && <p className="mt-2 text-xs" style={{ color: C.faint }}>{payManually ? 'You will receive verified bank transfer or mobile money instructions after choosing a plan. ' : 'Checkout opens securely after you choose a plan. '}<button type="button" onClick={onToggleManual} className="font-bold underline underline-offset-4" style={{ color: C.cta }}>{payManually ? 'Pay online instead' : 'Use bank transfer or mobile money'}</button></p>}
  </section>;
}

function SubscriptionPlanCard({ plan, subscription, openRequest, planBusyId, readOnly, C, onPurchase, chosenPriceId }: {
  plan: any;
  subscription: any;
  openRequest: any;
  planBusyId: string;
  readOnly: boolean;
  C: typeof LIGHT_C;
  onPurchase: (priceId: string) => void;
  chosenPriceId?: string;
}) {
  const prices = useMemo(() => [...(plan.prices ?? [])].sort((a: any, b: any) => a.durationMonths - b.durationMonths), [plan.prices]);
  const bestPrice = useMemo(() => prices.reduce((best: any, price: any) => {
    const saving = comparePlanPrice(price, prices).savingPercent;
    const bestSaving = best ? comparePlanPrice(best, prices).savingPercent : -1;
    return saving > bestSaving || (saving === bestSaving && price.durationMonths > (best?.durationMonths ?? 0)) ? price : best;
  }, null), [prices]);
  // A length chosen on the pricing page wins over the best-value default, so someone who picked
  // 12 months there does not arrive to find 1 month selected and have to choose again.
  const [selectedPriceId, setSelectedPriceId] = useState<string>(() => {
    if (chosenPriceId && prices.some((price: any) => price.id === chosenPriceId)) return chosenPriceId;
    return bestPrice?.id ?? prices[0]?.id ?? '';
  });
  const selectedPrice = prices.find((price: any) => price.id === selectedPriceId) ?? bestPrice ?? prices[0];
  const selectedPriceIndex = Math.max(0, prices.findIndex((price: any) => price.id === selectedPrice?.id));
  const comparison = selectedPrice ? comparePlanPrice(selectedPrice, prices) : { perMonth: 0, savingPercent: 0 };
  const isBusy = selectedPrice?.id === planBusyId;
  const blocked = Boolean(openRequest || planBusyId || readOnly || !selectedPrice);
  const copy = renewalCopy(subscription?.status);

  return <div className="space-y-3">
    {!!prices.length && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-bold" style={{ color: C.text }}>Choose duration</p>
      </div>
      <div className="relative grid w-fit max-w-full overflow-hidden rounded-full p-1" role="group" aria-label={subscription ? "Renewal duration" : "Access duration"} style={{ background: C.card, gridTemplateColumns: `repeat(${prices.length}, minmax(0, 1fr))` }}>
        <span aria-hidden="true" className="absolute bottom-1 left-1 top-1 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ background: C.cta, width: `calc((100% - 0.5rem) / ${prices.length})`, transform: `translateX(${selectedPriceIndex * 100}%)` }}/>
        {prices.map((price: any) => {
          const active = price.id === selectedPrice?.id;
          return <button key={price.id} type="button" aria-pressed={active} onClick={() => setSelectedPriceId(price.id)} className="relative z-10 min-h-9 min-w-16 whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none" style={{ color: active ? C.ctaText : C.muted }}>{durationLabel(price.durationMonths)}</button>;
        })}
      </div>
    </div>}

    <article className="rounded-2xl p-4 sm:p-6" style={{ background: C.card }}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_220px] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xl font-black tracking-tight" style={{ color: C.text }}>{plan.name}</p>
            {subscription && <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: C.successBg, color: C.successText }}>Current plan</span>}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: C.muted }}>Unlimited courses and learning paths, virtual experiences, certifications, and verifiable credentials.</p>
        </div>

        <div className="min-w-44 lg:text-right">
          <p className="text-xs font-semibold" style={{ color: C.faint }}>{subscription ? 'Renewal total' : 'Total'}</p>
          {selectedPrice ? <>
            <p className="mt-1 text-2xl font-black tracking-tight" style={{ color: C.text }}>{money(selectedPrice.currency, selectedPrice.amount)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 lg:justify-end">
              <p className="text-xs" style={{ color: C.muted }}>for {durationLabel(selectedPrice.durationMonths)}</p>
              {comparison.savingPercent > 0 && <span className="rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ background: C.successBg, borderColor: C.successBorder, color: C.successText }}>Save {comparison.savingPercent}%</span>}
            </div>
          </> : <p className="mt-1 text-sm font-bold" style={{ color: C.muted }}>Pricing unavailable</p>}
        </div>

        <button type="button" onClick={() => selectedPrice && onPurchase(selectedPrice.id)} disabled={blocked} className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-black transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0" style={{ background: C.cta, color: C.ctaText }}>
          {isBusy ? <><Loader2 className="h-4 w-4 animate-spin"/>Opening checkout</> : !selectedPrice ? 'Unavailable' : openRequest ? 'Payment in progress' : readOnly ? 'Preview only' : subscription ? <>{copy.action}<ArrowRight className="h-4 w-4"/></> : <>Unlock this plan<ArrowRight className="h-4 w-4"/></>}
        </button>
      </div>
    </article>
  </div>;
}

function PaymentHistoryTable({ timeline, C }: { timeline: any[]; C: typeof LIGHT_C }) {
  return <section className="overflow-hidden rounded-2xl" style={cardStyle(C)}>
    <div className="flex items-center justify-between p-5 sm:p-6" style={{ borderBottom: `1px solid ${C.divider}` }}>
      <div>
        <p className="font-black" style={{ color: C.text }}>Payment history</p>
        <p className="mt-1 text-xs" style={{ color: C.faint }}>Your renewals and submitted payments.</p>
      </div>
      <ReceiptText className="h-5 w-5" style={{ color: C.cta }}/>
    </div>
    {timeline.length ? <>
      <div className="divide-y sm:hidden" style={{ borderColor: C.divider }}>
        {timeline.map(row => <article key={row.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold" style={{ color: C.muted }}>{fmtDate(row.date)}</p>
            <StatePill status={row.displayStatus} C={C}/>
          </div>
          <p className="mt-3 text-sm font-bold" style={{ color: C.text }}>{row.plan_name || 'Access plan'}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl p-3" style={{ background: C.pill }}>
            <div>
              <dt className="text-[10px] font-semibold" style={{ color: C.faint }}>Duration</dt>
              <dd className="mt-1 text-sm" style={{ color: C.muted }}>{row.duration_months ? durationLabel(Number(row.duration_months)) : '--'}</dd>
            </div>
            <div className="text-right">
              <dt className="text-[10px] font-semibold" style={{ color: C.faint }}>Amount</dt>
              <dd className="mt-1 text-sm font-bold" style={{ color: C.text }}>{money(row.currency, row.amount)}</dd>
            </div>
          </dl>
        </article>)}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead style={{ background: C.pill }}>
            <tr>
              {['Date', 'Plan', 'Duration', 'Amount', 'Status'].map(label => <th key={label} scope="col" className="px-5 py-3.5 text-xs font-semibold tracking-normal" style={{ color: C.muted }}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {timeline.map(row => <tr key={row.id} style={{ borderTop: `1px solid ${C.divider}` }}>
              <td className="whitespace-nowrap px-5 py-4 text-sm" style={{ color: C.muted }}>{fmtDate(row.date)}</td>
              <td className="max-w-60 px-5 py-4 text-sm font-bold" style={{ color: C.text }}><span className="line-clamp-1">{row.plan_name || 'Access plan'}</span></td>
              <td className="whitespace-nowrap px-5 py-4 text-sm" style={{ color: C.muted }}>{row.duration_months ? durationLabel(Number(row.duration_months)) : '--'}</td>
              <td className="whitespace-nowrap px-5 py-4 text-sm font-bold" style={{ color: C.text }}>{money(row.currency, row.amount)}</td>
              <td className="whitespace-nowrap px-5 py-4"><StatePill status={row.displayStatus} C={C}/></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </> : (
      <EmptyMessage
        icon={ReceiptText}
        title="No payment history yet"
        body="Completed renewals and submitted payments will appear here."
        C={C}
      />
    )}
  </section>;
}

// The moment someone has just paid is the highest-intent point in the whole journey, and it was
// spending it on a single grey line of text. They have no receipt, no confirmation of what they
// bought, and no way into it without going hunting through a nav menu.
function PurchaseSuccess({ planName, until, contents, C }: {
  planName: string; until?: string | null; contents: any[]; C: typeof LIGHT_C;
}) {
  // Learning paths have no page of their own, so a link to one would be a dead end. Send those
  // to My Learning, where a path can actually be opened.
  const CATALOGUE_TYPE: Record<string, string> = {
    courses: 'course', virtual_experiences: 'virtual_experience', certifications: 'certification',
  };
  const openable = contents.find(row => CATALOGUE_TYPE[row.contentTable]);
  const startHref = openable
    ? `/${openable.contentId}?catalogueType=${CATALOGUE_TYPE[openable.contentTable]}`
    : '/student#learning_paths';
  const shown = contents.slice(0, 5);
  const rest = contents.length - shown.length;

  return <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.successBg, border: `1px solid ${C.cardBorder}` }}>
    <div className="flex items-start gap-3">
      <CheckCircle2 className="w-6 h-6 flex-shrink-0" style={{ color: '#16a34a' }}/>
      <div className="flex-1 min-w-0">
        <p className="font-black text-lg" style={{ color: C.text }}>You are in</p>
        <p className="text-sm mt-1" style={{ color: C.muted }}>
          {planName} is active{until ? ` until ${fmtDate(until)}` : ''}. Here is what you can open now.
        </p>
        {!!shown.length && <ul className="mt-3 space-y-1.5">
          {shown.map(row => <li key={`${row.contentTable}:${row.contentId}`} className="flex items-start gap-2 text-sm" style={{ color: C.text }}>
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-1" style={{ color: '#16a34a' }}/>
            <span className="line-clamp-1">{row.title}</span>
          </li>)}
          {rest > 0 && <li className="text-xs pl-5.5" style={{ color: C.faint }}>and {rest} more</li>}
        </ul>}
        <a href={startHref} className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black" style={{ background: C.cta, color: C.ctaText }}>
          Start learning <ArrowRight className="w-4 h-4"/>
        </a>
      </div>
    </div>
  </section>;
}

function Detail({ label, value, C }: { label: string; value: string; C: typeof LIGHT_C }) {
  return <div><p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.faint }}>{label}</p><p className="text-sm font-bold mt-1" style={{ color: C.text }}>{value}</p></div>;
}

function EmptyMessage({ icon: Icon, title, body, C }: { icon: React.ElementType; title: string; body: string; C: typeof LIGHT_C }) {
  return <div className="py-14 text-center"><div className="w-12 h-12 rounded-2xl grid place-items-center mx-auto" style={{ background: C.pill, color: C.faint }}><Icon className="w-5 h-5"/></div><p className="text-sm font-black mt-4" style={{ color: C.text }}>{title}</p><p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: C.faint }}>{body}</p></div>;
}
