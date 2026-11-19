'use client';

import { useState, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Clock3, Search, ShieldAlert, ShoppingCart } from 'lucide-react';
import { durationLabel } from '@/lib/pricing-offer';
import type { ThemeColors } from '@/lib/theme';
import {
  Avatar, Card, Count, DISPLAY_FONT, IconChip, Lines, Money, Pill, Row, btnSmClass, btnStyle,
  daysLate, learnerName, WIDE, money, palette, pastDeadline, pendingConfirmation, plural, reviewTitle, shortDate,
} from './ui';

const tag = (C: ThemeColors) => ({ background: C.pill, color: C.muted });

export function PaymentsTab({
  C, reviewQueue, awaitingReview, awaitingStudent, openCarts, history, sweepHeartbeat, busy,
  onResolve, onReview, onCancelRequest, onClearCart,
}: {
  C: ThemeColors;
  reviewQueue: any[];
  awaitingReview: any[];
  awaitingStudent: any[];
  openCarts: any[];
  history: any[];
  sweepHeartbeat: any;
  busy: boolean;
  onResolve: (item: any) => void;
  onReview: (request: any, decision: 'approve' | 'reject') => void;
  onCancelRequest: (id: string) => void;
  onClearCart: (cart: any) => void;
}) {
  const P = palette(C);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const term = historySearch.trim().toLowerCase();
  const shownHistory = history.filter((request) =>
    !term || `${request.students?.full_name ?? ''} ${request.students?.email ?? ''} ${request.plan_name ?? ''}`.toLowerCase().includes(term));

  const sections = [
    { id: 'pay-needs', label: 'Needs a person', n: reviewQueue.length, icon: <ShieldAlert className="w-4 h-4" />, color: P.bad, bg: P.badSoft },
    { id: 'pay-ready', label: 'Ready to review', n: awaitingReview.length, icon: <Check className="w-4 h-4" />, color: C.text, bg: P.ctaSoft },
    { id: 'pay-waiting', label: 'Waiting for learner', n: awaitingStudent.length, icon: <Clock3 className="w-4 h-4" />, color: P.warn, bg: P.warnSoft },
    { id: 'pay-carts', label: 'Unfinished checkouts', n: openCarts.length, icon: <ShoppingCart className="w-4 h-4" />, color: C.muted, bg: C.pill },
  ];
  const head = (id: string, title: string, n: number, alert = false) => (
    <div id={id} className="flex items-center gap-2 pt-2 scroll-mt-24">
      <h3 className="text-base font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
      <Count n={n} alert={alert && n > 0} C={C} />
    </div>
  );
  const empty = (text: string) => (
    <Card C={C}><p className="px-5 py-6 text-sm" style={{ color: C.muted }}>{text}</p></Card>
  );
  const tags = (items: ReactNode[]) => (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.filter(Boolean).map((item, index) => (
        <span key={index} className="text-xs px-2 rounded-lg leading-5 tabular-nums" style={tag(C)}>{item}</span>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {sweepHeartbeat?.stale && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: P.badSoft, color: P.bad }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold">Subscription expiry has not run recently</p>
            <p className="text-xs mt-1">
              {sweepHeartbeat.lastSuccessAt
                ? `Last completed ${Math.round(sweepHeartbeat.staleHours)} hours ago. `
                : 'It has never completed on this environment. '}
              Expired subscriptions keep their access until it runs. Check the hourly
              schedule for /api/cron/subscription-expiry-sweep in the Upstash console.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left"
            style={{ background: C.card }}
          >
            <IconChip color={section.color} background={section.bg}>{section.icon}</IconChip>
            <span className="min-w-0">
              <b className="block text-[22px] leading-7 font-bold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{section.n}</b>
              <span className="block text-xs" style={{ color: C.muted }}>{section.label}</span>
            </span>
          </button>
        ))}
      </div>

      {head('pay-needs', 'Needs a person', reviewQueue.length, true)}
      {reviewQueue.length === 0
        ? empty('Nothing needs a person. Every Paystack payment is applied or still in progress.')
        : reviewQueue.map((item) => (
          <Card key={`${item.kind}-${item.id}`} C={C} className="overflow-hidden" style={{ boxShadow: `inset 4px 0 0 ${P.bad}` }}>
            <Row C={C} first className="flex-wrap sm:flex-nowrap items-start sm:items-center">
              <IconChip color={P.bad} background={P.badSoft}><ShieldAlert className="w-4 h-4" /></IconChip>
              <div className={`min-w-0 ${WIDE}`}>
                <div className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: C.text }}>
                  {item.kind === 'stalled' ? 'Paystack checkout never completed' : reviewTitle(item)}
                  <Pill tone={item.kind === 'stalled' ? 'warn' : 'bad'} C={C}>{item.kind === 'stalled' ? 'Never completed' : 'Needs review'}</Pill>
                </div>
                <div className="text-xs" style={{ color: C.muted }}>
                  {[item.studentName || item.studentEmail || 'Unmatched payment', item.planName && `on ${item.planName}`].filter(Boolean).join(' ')}
                </div>
                {tags([
                  item.reference || 'no reference',
                  item.studentName && item.studentEmail,
                  item.occurredAt && new Date(item.occurredAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  !item.notifiedAt && item.kind !== 'stalled' && 'Not yet emailed',
                ])}
                {item.notificationError && (
                  <p className="text-xs mt-2" style={{ color: P.bad }}>Alert email failed: {item.notificationError}</p>
                )}
              </div>
              {item.amount != null && <Money C={C}>{money(item.currency || '', item.amount)}</Money>}
              {item.kind === 'incident' && (
                <button type="button" onClick={() => onResolve(item)} disabled={busy} className={btnSmClass} style={btnStyle('pri', C)}>Resolve</button>
              )}
            </Row>
          </Card>
        ))}

      {head('pay-ready', 'Ready to review', awaitingReview.length)}
      {awaitingReview.length === 0
        ? empty('No payments are waiting for your review.')
        : (
          <Card C={C} className="overflow-hidden">
            {awaitingReview.map((request, index) => {
              const conf = pendingConfirmation(request);
              return (
                <Row key={request.id} C={C} first={index === 0} className="flex-wrap sm:flex-nowrap">
                  <Avatar name={learnerName(request.students)} color={C.text} background={P.ctaSoft} />
                  <div className={`min-w-0 ${WIDE}`}>
                    <div className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: C.text }}>
                      {learnerName(request.students)}
                      <Pill tone="cta" C={C}>{request.plan_name}, {durationLabel(Number(request.duration_months))}</Pill>
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      {[request.students?.email, conf?.created_at && `sent ${shortDate(conf.created_at)}`].filter(Boolean).join(', ')}
                    </div>
                    {tags([
                      conf?.method || 'Payment method not stated',
                      conf?.reference || 'No transaction reference',
                      conf?.paid_at && `Paid ${shortDate(conf.paid_at)}`,
                      pastDeadline(request.due_date) && `Due ${shortDate(request.due_date)}, ${plural(daysLate(request.due_date), 'day')} late`,
                      conf?.receipt_url && (
                        <a href={conf.receipt_url} target="_blank" rel="noreferrer" style={{ color: C.text }}>Receipt</a>
                      ),
                    ])}
                  </div>
                  <Money C={C}>{money(request.currency, request.amount)}</Money>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy} onClick={() => onReview(request, 'reject')} className={btnSmClass} style={btnStyle('danger', C)}>Reject</button>
                    <button type="button" disabled={busy} onClick={() => onReview(request, 'approve')} className={btnSmClass} style={btnStyle('pri', C)}>
                      <Check className="w-4 h-4" />
                      Approve
                    </button>
                  </div>
                </Row>
              );
            })}
          </Card>
        )}

      {head('pay-waiting', 'Waiting for the learner', awaitingStudent.length)}
      {awaitingStudent.length === 0
        ? empty('No payment requests are waiting on a learner.')
        : (
          <Card C={C} className="overflow-hidden">
            {awaitingStudent.map((request, index) => {
              const late = pastDeadline(request.due_date);
              return (
                <Row key={request.id} C={C} first={index === 0} className="flex-wrap sm:flex-nowrap">
                  <Avatar name={learnerName(request.students)} color={P.warn} background={P.warnSoft} />
                  <Lines
                    wide
                    C={C}
                    title={<>{learnerName(request.students)}<Pill tone="cta" C={C}>{request.plan_name}, {durationLabel(Number(request.duration_months))}</Pill></>}
                    sub={[request.students?.email, request.created_at && `requested ${shortDate(request.created_at)}`].filter(Boolean).join(', ')}
                  />
                  <Pill tone={late ? 'bad' : 'mute'} dot C={C}>
                    Due {shortDate(request.due_date)}{late ? `, ${plural(daysLate(request.due_date), 'day')} late` : ''}
                  </Pill>
                  <Money C={C}>{money(request.currency, request.amount)}</Money>
                  <button type="button" disabled={busy} onClick={() => onCancelRequest(request.id)} className={btnSmClass} style={btnStyle('ghost', C)}>Cancel request</button>
                </Row>
              );
            })}
          </Card>
        )}

      {head('pay-carts', 'Unfinished checkouts', openCarts.length)}
      {openCarts.length === 0
        ? empty('No unfinished checkouts.')
        : (
          <Card C={C} className="overflow-hidden">
            {openCarts.map((cart, index) => (
              <Row key={cart.reference} C={C} first={index === 0} className="flex-wrap sm:flex-nowrap">
                <Avatar name={learnerName(cart.students)} color={C.muted} background={C.pill} />
                <Lines
                  wide
                  C={C}
                  title={<>{learnerName(cart.students)}<Pill tone="cta" C={C}>{cart.plan_name}, {durationLabel(Number(cart.duration_months))}</Pill></>}
                  sub={`Started ${shortDate(cart.created_at)} ${cart.request_id
                    ? 'and left behind by a closed payment request'
                    : `online, ${cart.reminder_count === 0 ? 'no reminders sent' : `${plural(cart.reminder_count, 'reminder')} sent`}`}. Nothing is owed, but the learner cannot pay another way until it is cleared.`}
                />
                <Money C={C}>{money(cart.currency, cart.amount)}</Money>
                <button type="button" disabled={busy} onClick={() => onClearCart(cart)} className={btnSmClass} style={btnStyle('ghost', C)}>Clear checkout</button>
              </Row>
            ))}
          </Card>
        )}

      <Card C={C} className="overflow-hidden">
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-expanded={historyOpen}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span>
            <span className="block text-sm font-semibold" style={{ color: C.text }}>History</span>
            <span className="block text-xs" style={{ color: C.muted }}>Paid and cancelled payments, with search</span>
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} style={{ color: C.muted }} />
        </button>
        {historyOpen && (
          <div style={{ borderTop: `1px solid ${C.divider}` }}>
            <div className="px-5 py-3">
              <label
                className="flex items-center gap-2 h-10 px-3 rounded-xl max-w-[360px]"
                style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}
              >
                <Search className="w-4 h-4 flex-shrink-0" />
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search by name, email or plan"
                  className="bg-transparent outline-none text-sm w-full"
                  style={{ color: C.text }}
                />
              </label>
            </div>
            {shownHistory.map((request) => {
              const paid = request.status === 'paid';
              const method = request.subscription_payment_confirmations?.find((row: any) => row.status === 'approved')?.method;
              const when = paid ? request.paid_at : request.cancelled_at ?? request.created_at;
              return (
                <Row key={request.id} C={C}>
                  <Pill tone={paid ? 'good' : 'mute'} dot={paid} C={C}>{statusLabel(request.status)}</Pill>
                  <Lines
                    C={C}
                    title={learnerName(request.students)}
                    sub={[request.plan_name, durationLabel(Number(request.duration_months)), method, when && `${paid ? 'paid' : statusLabel(request.status).toLowerCase()} ${shortDate(when)}`].filter(Boolean).join(', ')}
                  />
                  <Money C={C}>{money(request.currency, request.amount)}</Money>
                </Row>
              );
            })}
            {shownHistory.length === 0 && (
              <p className="px-5 pb-6 text-sm" style={{ color: C.muted }}>{history.length ? 'No payments match this search.' : 'No paid or cancelled payments yet.'}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function statusLabel(status: string) {
  const text = String(status || '').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
