'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowRight, BadgeCheck, Banknote, CalendarClock, Check, CheckCircle2,
  Clock3, Copy, CreditCard, ExternalLink, FileCheck2, ReceiptText, Send,
  ShieldCheck, Smartphone, WalletCards, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { PaymentsSection } from '@/components/student/payments';
import { Sk } from '@/components/student/shared';

type Tab = 'pay' | 'confirm' | 'history';
const PAYSTACK_RETURN_REFERENCE_KEY = 'paystack:return-reference';

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';
}

function money(currency: string, amount: number | string) {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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

function StatePill({ status, C }: { status: string; C: typeof LIGHT_C }) {
  const tone = status === 'active' || status === 'approved' ? '#16a34a' : ['rejected', 'cancelled'].includes(status) ? '#dc2626' : status === 'expired' ? C.muted : '#d97706';
  return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold capitalize" style={{ background: `${tone}18`, color: tone }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }}/>{status.replaceAll('_', ' ')}</span>;
}

export function StudentPaymentsSection({ userId, C, readOnly = false }: { userId: string; C: typeof LIGHT_C; readOnly?: boolean }) {
  const dark = C.page === '#17181E';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failureEnrollmentModel, setFailureEnrollmentModel] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('pay');
  const [selectedOption, setSelectedOption] = useState('');
  const [form, setForm] = useState({ paidAt: new Date().toISOString().slice(0, 10), method: '', reference: '', notes: '', receiptUrl: '' });
  const [busy, setBusy] = useState(false);
  const [paystackBusy, setPaystackBusy] = useState(false);
  const [planBusyId, setPlanBusyId] = useState('');
  // Paying by transfer used to be unreachable whenever Paystack was configured: the button always
  // went straight to the card page. This is the learner saying they would rather not.
  const [payManually, setPayManually] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [message, setMessage] = useState('');
  const returnVerificationStarted = useRef(false);

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
      if (!res.ok) throw new Error(body.error || 'Failed to load subscription payments');
      setData(body);
    } catch (err: any) { setFailureEnrollmentModel(enrollmentModel); setError(err.message); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Kept in state rather than only in the URL. Stripping the reference on the way out meant a
  // learner whose verification timed out, or whose payment was still settling after four checks,
  // had no way to ask again -- their only route was contacting support about money they had
  // already paid. The reference survives so the button below can retry for as long as it takes.
  const [returnReference, setReturnReference] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnResolved, setReturnResolved] = useState(false);
  // Only a real activation, not a rejection or a review -- this is what earns the moment below.
  const [justPurchased, setJustPurchased] = useState(false);

  const verifyReturn = useCallback(async (reference: string, poll: boolean) => {
    if (!reference) return;
    setReturnBusy(true);
    setMessage('Checking your payment with Paystack...');
    const inFlight = new Set(['pending', 'ongoing', 'processing', 'queued', 'initialized']);
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
  const options = data?.paymentOptions ?? [];
  const option = options.find((row: any) => row.id === selectedOption);
  const plan = subscription?.subscription_plans;
  const planName = plan?.name ?? openRequest?.plan_name ?? 'Individual subscription';
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
    ...(data?.payments ?? []).map((row: any) => ({ ...row, displayStatus: 'approved', date: row.paid_at })),
    ...requests.flatMap((request: any) => (request.subscription_payment_confirmations ?? [])
      .filter((row: any) => row.status !== 'approved')
      .map((row: any) => ({ ...row, currency: request.currency, displayStatus: row.status, date: row.paid_at }))),
  ].sort((a: any, b: any) => +new Date(b.date) - +new Date(a.date)), [data?.payments, requests]);

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
      ? `radial-gradient(circle at 85% 18%, ${C.cta}38, transparent 30%), linear-gradient(135deg, #20232d 0%, #17181e 75%)`
      : `radial-gradient(circle at 88% 14%, ${C.cta}47, transparent 30%), linear-gradient(135deg, #0a1220 0%, #122a3f 100%)`,
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
      await load(); setTab('history');
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
      if (!res.ok) throw new Error(body.error || 'Failed to start subscription');
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
      setMessage(err.message || 'Failed to start subscription');
    } finally {
      setPlanBusyId('');
    }
  }

  return <div className="subscription-typography space-y-5 pb-12">
    <style>{`.subscription-typography .font-black{font-weight:700!important}.subscription-typography .font-bold{font-weight:600!important}`}</style>
    {justPurchased && <PurchaseSuccess planName={planName} until={subscription?.current_period_end} contents={data?.content ?? []} C={C}/>}
    {message && !justPurchased && <div className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3" style={{ background: message.includes('confirmed') ? C.successBg : C.pill, color: message.includes('confirmed') ? C.successText : C.text }}><Clock3 className="w-5 h-5 flex-shrink-0"/><p className="text-sm font-bold flex-1">{message}</p>{returnReference && !returnResolved && !readOnly && <button onClick={() => verifyReturn(returnReference, false)} disabled={returnBusy} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black flex-shrink-0 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{returnBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}Check payment status</button>}</div>}
    <section className="relative overflow-hidden rounded-[30px] p-5 sm:p-6 text-white" style={heroStyle}>
      <div className="absolute right-[-55px] bottom-[-95px] w-64 h-64 rounded-full border border-white/10"/><div className="absolute right-8 top-7 w-20 h-20 rounded-full border border-white/10"/>
      <div className="relative grid lg:grid-cols-[1fr_auto] gap-5 items-end">
        <div><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: '#ffffff' }}>{planName}</h2><StatePill status={subscription?.status || (openRequest ? 'awaiting payment' : 'no plan yet')} C={C}/></div><p className="mt-2 text-sm max-w-xl" style={{ color: 'rgba(255,255,255,0.72)' }}>{plan?.description || (subscription ? 'Your curated learning access is ready whenever you are.' : openRequest ? 'Complete your assigned payment to unlock this learning plan.' : 'Choose a plan below to unlock your learning access.')}</p>{hasActiveAccess ? <div className="mt-4 max-w-xl"><div className="flex justify-between text-[11px] font-bold mb-2" style={{ color: 'rgba(255,255,255,0.72)' }}><span>Access started {fmtDate(subscription.current_period_start)}</span><span>{daysLeft} days remaining</span></div><div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}><div className="h-full rounded-full" style={{ width: `${accessProgress}%`, background: dark ? '#83b9ff' : C.cta }}/></div></div> : subscription && <p className="mt-4 text-xs font-bold" style={{ color: 'rgba(255,255,255,0.72)' }}>{subscription.status === 'cancelled' ? 'Your learning access has been revoked.' : 'Your subscription access is no longer active.'}</p>}</div>
        <div className="relative min-w-[190px] rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)' }}><p className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: 'rgba(255,255,255,0.55)' }}>{openRequest ? 'Payment due' : hasActiveAccess ? 'Access until' : 'Access status'}</p><p className="text-xl font-black mt-1.5" style={{ color: '#ffffff' }}>{openRequest ? money(openRequest.currency,openRequest.amount) : hasActiveAccess ? fmtDate(subscription?.current_period_end) : !subscription ? 'Not started' : subscription.status === 'cancelled' ? 'Revoked' : 'Expired'}</p><p className="text-xs mt-1.5" style={{ color: overdue ? '#fca5a5' : 'rgba(255,255,255,0.68)' }}>{openRequest ? `${overdue ? 'Past due' : 'Due'} ${fmtDate(openRequest.due_date)}` : hasActiveAccess ? `${daysLeft} days remaining` : !subscription ? 'Pick a plan to get started' : 'Learning access is unavailable'}</p>{openRequest && !pendingConfirmation && <button onClick={() => setTab('confirm')} className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black" style={{ background: '#fff', color: '#101828' }}>Confirm payment<ArrowRight className="w-3.5 h-3.5"/></button>}</div>
      </div>
    </section>

    {overdue && <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.errorBg, border: `1px solid ${C.errorBorder}`, color: C.errorText }}><AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5"/><div><p className="text-sm font-bold">Your payment deadline has passed</p><p className="text-xs mt-1 opacity-80">You can still send your confirmation. Contact support if your payment terms need to be updated.</p></div></div>}
    {pendingConfirmation && <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.18)', color: '#b45309' }}><Clock3 className="w-5 h-5 flex-shrink-0 mt-0.5"/><div className="flex-1"><p className="text-sm font-bold">Payment review in progress</p><p className="text-xs mt-1 opacity-80">Submitted {fmtDate(pendingConfirmation.created_at)}. Your access updates automatically after approval.</p></div><span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Pending</span></div>}

    {/* Filtering to the learner's own plan can legitimately leave nothing to show: they followed
        a locked-content link covered only by some other plan. Silently dropping the whole section
        left them on a page with no plans and no reason why, which reads as a bug. */}
    {!purchasablePlans.length && !pendingConfirmation && subscription && <section className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}><div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.cta }}/><div><p className="font-black" style={{ color: C.text }}>{data?.purchaseTarget ? 'This content needs a different plan' : 'No plan is available to renew right now'}</p><p className="text-xs mt-1" style={{ color: C.faint }}>{data?.purchaseTarget ? `Your subscription covers ${planName}, which does not include this content. Moving to another plan needs the learning team, so please contact them to ask about access.` : `Your subscription covers ${planName}. Contact the learning team to ask about renewing it.`}</p></div></div></section>}

    {/* An unfinished checkout, offered back rather than left as a dead end. Not a debt and not a
        deadline: nothing is owed, the learner simply started something. Continue goes back through
        the reservation path rather than a stored link, since a checkout session can expire.

        Shown to renewing subscribers too. Gating it on not having access looked sensible and was
        exactly backwards: a renewal creates a checkout like any other, so the people most likely
        to abandon one were the only people the card refused to appear for -- blocked by their own
        cart, with no way to see or clear it. */}
    {data?.cart && !openRequest && !readOnly && <section className="rounded-2xl p-5" style={{ background: `${C.cta}0D`, border: `1px solid ${C.cardBorder}` }}><div className="flex flex-col sm:flex-row sm:items-center gap-4"><div className="flex-1 min-w-0"><p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: C.faint }}>{hasActiveAccess ? 'You started renewing' : 'You were considering'}</p><p className="font-black mt-1 truncate" style={{ color: C.text }}>{data.cart.plan_name}</p><p className="text-xs mt-1" style={{ color: C.muted }}>{data.cart.duration_months === 12 ? '1 year' : `${data.cart.duration_months} month${data.cart.duration_months > 1 ? 's' : ''}`} &middot; {money(data.cart.currency, data.cart.amount)}</p></div><div className="flex items-center gap-2 flex-shrink-0"><button onClick={() => dismissCart(data.cart.reference)} disabled={cartBusy} className="rounded-xl px-3.5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: C.card, color: C.muted }}>Remove</button><button onClick={() => resumeCart(data.cart.reference)} disabled={cartBusy} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>Continue{cartBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4"/>}</button></div></div></section>}

    {!!purchasablePlans.length && !pendingConfirmation && <section className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}><div className="flex items-center justify-between gap-4 mb-4"><div><p className="font-black" style={{ color: C.text }}>{hasActiveAccess ? 'Renew your access' : 'Choose a subscription plan'}</p><p className="text-xs mt-1" style={{ color: C.faint }}>{openRequest ? 'Complete your current payment before choosing another plan.' : subscription ? 'Extend your current plan. To move to a different plan, contact the learning team.' : 'Purchase a fixed access period. Renewal is manual when it expires.'}</p></div><WalletCards className="w-5 h-5" style={{ color: C.cta }}/></div><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{purchasablePlans.map((plan: any) => <div key={plan.id} className="rounded-2xl p-4" style={{ background: C.page, border: `1px solid ${C.cardBorder}` }}><div className="flex items-start justify-between gap-3"><div><p className="font-black" style={{ color: C.text }}>{plan.name}</p>{plan.description && <p className="text-xs mt-1 line-clamp-2" style={{ color: C.faint }}>{plan.description}</p>}</div><ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: C.cta }}/></div><PlanContents plan={plan} C={C}/><div className="mt-4 space-y-2">{plan.prices.map((price: any) => { const perMonth = price.amount / price.durationMonths; const shortest = plan.prices.reduce((a: any, b: any) => (a.durationMonths <= b.durationMonths ? a : b)); const base = shortest.amount / shortest.durationMonths; const saving = price.durationMonths > shortest.durationMonths && base > 0 ? Math.round((1 - perMonth / base) * 100) : 0; return <button key={price.id} onClick={() => purchasePlan(price.id)} disabled={!!openRequest || !!planBusyId || readOnly} className="w-full flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0" style={{ background: C.card, color: C.text }}><span><span className="block text-sm font-black">{price.durationMonths === 12 ? '1 year' : `${price.durationMonths} month${price.durationMonths > 1 ? 's' : ''}`}</span><span className="block text-[11px] mt-0.5" style={{ color: C.faint }}>{money(price.currency, Math.round(perMonth))} a month{saving > 0 ? ' - ' : ''}{saving > 0 && <span style={{ color: '#16a34a', fontWeight: 700 }}>save {saving}%</span>}</span></span><span className="inline-flex items-center gap-2 text-sm font-black" style={{ color: C.cta }}>{money(price.currency, price.amount)}{planBusyId === price.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4"/>}</span></button>; })}</div></div>)}</div>{data?.paystackEnabled && <p className="text-xs mt-4" style={{ color: C.faint }}>{payManually ? 'Paying by bank transfer or mobile money. ' : 'Prefer to pay by bank transfer or mobile money? '}<button onClick={() => setPayManually(v => !v)} className="font-bold underline" style={{ color: C.cta }}>{payManually ? 'Pay by card instead' : 'Choose that instead'}</button></p>}</section>}

    <nav className="grid grid-cols-3 gap-1 p-1.5 rounded-2xl" style={{ background: C.card }}>
      {([
        ['pay','Pay',WalletCards],['confirm','Confirm',FileCheck2],['history','Activity',ReceiptText],
      ] as const).map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className="relative flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-2 py-2.5 text-[11px] sm:text-sm font-bold transition-all" style={{ background: tab === id ? C.pill : 'transparent', color: tab === id ? C.text : C.faint }}><Icon className="w-4 h-4"/>{label}{id === 'confirm' && openRequest && !pendingConfirmation && <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full" style={{ background: '#f97316', boxShadow: `0 0 0 3px ${C.card}` }}/>}</button>)}
    </nav>

    {tab === 'pay' && <section className="grid lg:grid-cols-[1fr_320px] gap-5">
      <div className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}><div className="flex items-center justify-between gap-4 mb-5"><div><p className="font-black" style={{ color: C.text }}>Choose how to pay</p><p className="text-xs mt-1" style={{ color: C.faint }}>Pay online or use the verified manual details below.</p></div><CreditCard className="w-5 h-5" style={{ color: C.cta }}/></div>{data?.paystackEnabled && openRequest && !pendingConfirmation && !readOnly && <div className="mb-5 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: `${C.cta}10`, border: `1px solid ${C.cardBorder}` }}><div className="flex-1"><p className="text-sm font-black" style={{ color: C.text }}>Pay online with Paystack</p><p className="text-xs mt-1" style={{ color: C.faint }}>Card, bank, and mobile money options are confirmed automatically after payment.</p></div><button onClick={startPaystackCheckout} disabled={paystackBusy} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{paystackBusy ? 'Opening...' : `Pay ${money(openRequest.currency, openRequest.amount)}`}<ExternalLink className="w-4 h-4"/></button></div>}{options.length ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{options.map((row: any) => { const Icon = row.type === 'mobile_money' ? Smartphone : row.type === 'bank_transfer' ? Banknote : CreditCard; return <button key={row.id} onClick={() => { setSelectedOption(row.id); setForm(v => ({ ...v, method: row.label })); }} className="relative rounded-2xl p-4 text-left min-h-28 transition-all hover:-translate-y-0.5" style={{ background: selectedOption === row.id ? `${C.cta}10` : C.page, outline: selectedOption === row.id ? `2px solid ${C.cta}` : '2px solid transparent' }}>{selectedOption === row.id && <span className="absolute top-3 right-3 w-5 h-5 rounded-full grid place-items-center" style={{ background: C.cta, color: C.ctaText }}><Check className="w-3 h-3"/></span>}{row.logo_url ? <img src={row.logo_url} alt="" className="h-8 max-w-20 object-contain mb-4"/> : <div className="w-9 h-9 rounded-xl grid place-items-center mb-4" style={{ background: C.card, color: C.cta }}><Icon className="w-4 h-4"/></div>}<p className="text-sm font-bold" style={{ color: C.text }}>{row.label}</p><p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: C.faint }}>{row.type?.replaceAll('_',' ') || 'Payment option'}</p></button>; })}</div> : <div className="rounded-2xl py-14 text-center" style={{ background: C.page }}><WalletCards className="w-8 h-8 mx-auto" style={{ color: C.faint }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>No payment options yet</p><p className="text-xs mt-1" style={{ color: C.faint }}>Contact your administrator for payment instructions.</p></div>}</div>
      <aside className="rounded-2xl p-5 min-h-64" style={cardStyle(C)}>{option ? <div><div className="flex items-center gap-3 pb-4" style={{ borderBottom: `1px solid ${C.divider}` }}><div className="w-11 h-11 rounded-xl grid place-items-center" style={{ background: `${C.cta}12`, color: C.cta }}><ShieldCheck className="w-5 h-5"/></div><div><p className="font-black" style={{ color: C.text }}>{option.label}</p><p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: C.faint }}>Verified details</p></div></div><div className="space-y-3 py-5 text-sm">{option.bank_name && <Detail label="Bank" value={option.bank_name} C={C}/>} {option.network && <Detail label="Network" value={option.network} C={C}/>} {option.account_name && <Detail label="Account name" value={option.account_name} C={C}/>} {option.account_number && <div><p className="text-[10px] uppercase font-bold" style={{ color: C.faint }}>Account number</p><div className="mt-1"><CopyValue value={option.account_number} C={C}/></div></div>} {option.mobile_money_number && <div><p className="text-[10px] uppercase font-bold" style={{ color: C.faint }}>Mobile number</p><div className="mt-1"><CopyValue value={option.mobile_money_number} C={C}/></div></div>}{option.instructions && <p className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: C.page, color: C.muted }}>{option.instructions}</p>}{option.payment_link && <a href={option.payment_link} target="_blank" rel="noreferrer" className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: C.cta, color: C.ctaText }}>Open secure payment<ExternalLink className="w-4 h-4"/></a>}</div>{openRequest && <button onClick={() => setTab('confirm')} className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: C.pill, color: C.cta }}>I have paid<ArrowRight className="w-4 h-4"/></button>}</div> : <div className="h-full min-h-60 grid place-items-center text-center"><div><CreditCard className="w-8 h-8 mx-auto" style={{ color: C.faint }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>Select a payment option</p><p className="text-xs mt-1" style={{ color: C.faint }}>Account details will appear here.</p></div></div>}</aside>
    </section>}

    {tab === 'confirm' && <section className="grid lg:grid-cols-[320px_1fr] gap-5">
      <aside className="rounded-2xl p-5 h-fit" style={cardStyle(C)}><p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: C.faint }}>Assigned payment</p>{openRequest ? <><p className="text-3xl font-black mt-3" style={{ color: C.text }}>{money(openRequest.currency,openRequest.amount)}</p><div className="space-y-3 mt-6 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}><Detail label="Access plan" value={openRequest.plan_name} C={C}/><Detail label="Duration" value={`${openRequest.duration_months} months`} C={C}/><Detail label="Deadline" value={fmtDate(openRequest.due_date)} C={C}/></div><div className="mt-5 rounded-xl p-3 flex gap-2" style={{ background: `${C.cta}0f` }}><ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: C.cta }}/><p className="text-[11px] leading-relaxed" style={{ color: C.muted }}>Your amount is locked to the terms assigned by the administrator.</p></div></> : <div className="py-12 text-center"><CheckCircle2 className="w-8 h-8 mx-auto" style={{ color: C.green }}/><p className="text-sm font-bold mt-3" style={{ color: C.text }}>Nothing is due</p></div>}</aside>
      <div className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}>{!openRequest ? <EmptyMessage icon={BadgeCheck} title="No payment awaiting confirmation" body="When a renewal or new subscription is assigned, it will appear here." C={C}/> : pendingConfirmation ? <EmptyMessage icon={Clock3} title="Confirmation under review" body="You have already submitted this payment. We will notify you when the review is complete." C={C}/> : readOnly ? <EmptyMessage icon={ShieldCheck} title="Read-only preview" body="Payment submission is disabled while an administrator is viewing as this student." C={C}/> : <div><div className="mb-6"><p className="font-black" style={{ color: C.text }}>Tell us how you paid</p><p className="text-xs mt-1" style={{ color: C.faint }}>This does not grant access immediately. An administrator verifies the details first.</p></div><div className="grid sm:grid-cols-2 gap-4"><label className="text-xs font-bold" style={{ color: C.muted }}>Date paid<input type="date" max={new Date().toISOString().slice(0,10)} value={form.paidAt} onChange={e => setForm(v => ({ ...v, paidAt: e.target.value }))} className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Payment method<input value={form.method} onChange={e => setForm(v => ({ ...v, method: e.target.value }))} placeholder="Mobile Money or bank transfer" className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Transaction reference<input value={form.reference} onChange={e => setForm(v => ({ ...v, reference: e.target.value }))} placeholder="Transaction ID" className={inputClass} style={inputStyle}/></label><label className="text-xs font-bold" style={{ color: C.muted }}>Receipt link <span className="font-normal" style={{ color: C.faint }}>(optional)</span><input type="url" value={form.receiptUrl} onChange={e => setForm(v => ({ ...v, receiptUrl: e.target.value }))} placeholder="https://..." className={inputClass} style={inputStyle}/></label><label className="sm:col-span-2 text-xs font-bold" style={{ color: C.muted }}>Anything else we should know? <span className="font-normal" style={{ color: C.faint }}>(optional)</span><textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} className={`${inputClass} min-h-24`} style={inputStyle} placeholder="Add a short note"/></label></div>{message && <div className="rounded-xl p-3 text-xs mt-4" style={{ background: message.startsWith('Payment') ? C.successBg : C.errorBg, color: message.startsWith('Payment') ? C.successText : C.errorText }}>{message}</div>}<button onClick={submit} disabled={busy || !form.paidAt || !form.reference.trim()} className="mt-5 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition-transform hover:-translate-y-0.5 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Sending...' : 'Submit for verification'}<Send className="w-4 h-4"/></button></div>}</div>
    </section>}

    {tab === 'history' && <section className="rounded-2xl overflow-hidden" style={cardStyle(C)}><div className="p-5 sm:p-6 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.divider}` }}><div><p className="font-black" style={{ color: C.text }}>Payment activity</p><p className="text-xs mt-1" style={{ color: C.faint }}>Every submission and approved subscription payment.</p></div><ReceiptText className="w-5 h-5" style={{ color: C.cta }}/></div><div className="p-5 sm:p-6 max-w-3xl">{timeline.map((row: any, index: number) => { const tone = row.displayStatus === 'approved' ? '#16a34a' : row.displayStatus === 'rejected' ? '#dc2626' : '#d97706'; return <div key={row.id} className="relative flex gap-4 pb-6"><div className="relative flex flex-col items-center"><span className="w-9 h-9 rounded-full grid place-items-center z-10" style={{ background: `${tone}14`, color: tone }}>{row.displayStatus === 'approved' ? <Check className="w-4 h-4"/> : row.displayStatus === 'rejected' ? <AlertCircle className="w-4 h-4"/> : <Clock3 className="w-4 h-4"/>}</span>{index < timeline.length - 1 && <span className="absolute top-9 bottom-[-24px] w-px" style={{ background: C.divider }}/>}</div><div className="flex-1 rounded-2xl p-4" style={{ background: C.page }}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black" style={{ color: C.text }}>{money(row.currency,row.amount)}</p><p className="text-xs mt-1" style={{ color: C.muted }}>{fmtDate(row.date)}{row.payment_method || row.method ? ` - ${row.payment_method || row.method}` : ''}</p></div><StatePill status={row.displayStatus} C={C}/></div>{row.payment_reference || row.reference ? <p className="text-xs mt-3" style={{ color: C.faint }}>Reference: {row.payment_reference || row.reference}</p> : null}</div></div>; })}{timeline.length === 0 && <EmptyMessage icon={ReceiptText} title="No payment activity yet" body="Your confirmations and approved payments will build a timeline here." C={C}/>}</div></section>}
  </div>;
}

// A plan's name and a clamped blurb never told a learner whether it holds the course they came
// for -- the one thing they are trying to decide. The titles were already in the database and
// were only ever resolved after purchase, for the plan they already owned.
function PlanContents({ plan, C }: { plan: any; C: typeof LIGHT_C }) {
  const contents = plan.contents ?? [];
  if (!contents.length) return null;
  const total = plan.contentCount ?? contents.length;
  const shown = contents.slice(0, 4);
  const rest = total - shown.length;
  return <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.divider}` }}>
    <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.faint }}>{total} {total === 1 ? 'item' : 'items'} included</p>
    <ul className="mt-2 space-y-1">
      {shown.map((entry: any) => <li key={`${entry.contentTable}:${entry.contentId}`} className="flex items-start gap-1.5 text-xs" style={{ color: C.muted }}><Check className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: C.cta }}/><span className="line-clamp-1">{entry.title}</span></li>)}
    </ul>
    {rest > 0 && <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>and {rest} more</p>}
  </div>;
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
  const openable = contents.find(row => CATALOGUE_TYPE[row.content_table]);
  const startHref = openable
    ? `/${openable.content_id}?catalogueType=${CATALOGUE_TYPE[openable.content_table]}`
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
          {shown.map(row => <li key={`${row.content_table}:${row.content_id}`} className="flex items-start gap-2 text-sm" style={{ color: C.text }}>
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
