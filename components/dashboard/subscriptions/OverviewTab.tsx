'use client';

import { AlertCircle, CalendarDays, Check, ChevronRight, Layers3, ShieldAlert, Wallet } from 'lucide-react';
import { durationLabel } from '@/lib/pricing-offer';
import type { ThemeColors } from '@/lib/theme';
import {
  Avatar, Bar, Card, CardHead, DISPLAY_FONT, IconChip, LinkBtn, Lines, Pill, Row, btnSmClass, btnStyle,
  daysLate, daysRemaining, dateLabel, learnerName, money, palette, pendingConfirmation, plural, reviewTitle, shortDate,
} from './ui';
import type { PlanSummary, SubsTab } from './types';

export function OverviewTab({
  C, subscriptionCount, activeCount, expiring, collected, reviewQueue, awaitingReview, lateRequests,
  planSummaries, busy, onGo, onReview, onResolve, onEnding,
}: {
  C: ThemeColors;
  subscriptionCount: number;
  activeCount: number;
  expiring: any[];
  collected: { currency: string; online: number; recorded: number }[];
  reviewQueue: any[];
  awaitingReview: any[];
  lateRequests: any[];
  planSummaries: PlanSummary[];
  busy: boolean;
  onGo: (tab: SubsTab) => void;
  onReview: (request: any) => void;
  onResolve: (item: any) => void;
  /** Open the Subscribers tab on one learner, or on everyone ending soon. */
  onEnding: (sub?: any) => void;
}) {
  const P = palette(C);
  const actionCount = reviewQueue.length + awaitingReview.length + lateRequests.length;
  const actionDetail = [
    awaitingReview.length && plural(awaitingReview.length, 'payment') + ' to review',
    reviewQueue.length && plural(reviewQueue.length, 'Paystack item'),
    lateRequests.length && `${lateRequests.length} past deadline`,
  ].filter(Boolean).join(', ') || 'Nothing is waiting on you';
  const one = collected.length === 1 ? collected[0] : null;
  const collectedTotal = one ? one.online + one.recorded : 0;
  const onSale = planSummaries.filter(({ plan }) => plan.status === 'active' && !plan.archived_at);

  const kpis = [
    {
      key: 'active', n: String(activeCount), label: 'Active now', sub: `of ${plural(subscriptionCount, 'subscriber')}`,
      icon: <Check className="w-4 h-4" />, color: P.good, bg: P.goodSoft,
      corner: <Pill tone="good" dot C={C}>Live</Pill>,
      bar: [{ pct: subscriptionCount ? (activeCount / subscriptionCount) * 100 : 0, color: P.good }],
    },
    {
      key: 'action', n: String(actionCount), label: 'Need your action', sub: actionDetail,
      icon: <AlertCircle className="w-4 h-4" />, color: P.bad, bg: P.badSoft,
      corner: <LinkBtn onClick={() => onGo('payments')} C={C}>Open</LinkBtn>,
    },
    {
      key: 'ending', n: String(expiring.length), label: 'Ending in 30 days',
      sub: expiring.length ? `Earliest on ${shortDate(expiring[0].current_period_end)}` : 'None in the next 30 days',
      icon: <CalendarDays className="w-4 h-4" />, color: P.warn, bg: P.warnSoft,
    },
    {
      key: 'collected',
      n: one ? money(one.currency, collectedTotal) : collected.length > 1 ? `${collected.length} currencies` : 'None yet',
      label: 'Collected this month',
      sub: one
        ? `Online ${money(one.currency, one.online)}, recorded ${money(one.currency, one.recorded)}`
        : collected.length > 1
          ? collected.map((row) => money(row.currency, row.online + row.recorded)).join(', ')
          : 'Payments received this month',
      icon: <Wallet className="w-4 h-4" />, color: C.cta, bg: P.ctaSoft,
      bar: one && collectedTotal > 0
        ? [{ pct: (one.online / collectedTotal) * 100, color: C.cta }, { pct: (one.recorded / collectedTotal) * 100, color: C.faint }]
        : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.key} C={C} className="p-4 grid gap-3 content-start">
            <div className="flex items-center justify-between gap-2">
              <IconChip color={kpi.color} background={kpi.bg}>{kpi.icon}</IconChip>
              {kpi.corner}
            </div>
            <div className="min-w-0">
              <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{kpi.n}</p>
              <p className="text-sm font-semibold" style={{ color: C.text }}>{kpi.label}</p>
              <p className="text-xs mt-1" style={{ color: C.muted }}>{kpi.sub}</p>
            </div>
            {kpi.bar && <Bar parts={kpi.bar} C={C} />}
          </Card>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card C={C} className="overflow-hidden">
          <CardHead
            title="Needs your action"
            sub="Everything waiting on you, most urgent first"
            action={<LinkBtn onClick={() => onGo('payments')} C={C}>All payments</LinkBtn>}
            C={C}
          />
          {actionCount === 0 && (
            <div className="px-5 py-12 text-center">
              <div className="flex justify-center"><IconChip color={P.good} background={P.goodSoft}><Check className="w-4 h-4" /></IconChip></div>
              <p className="text-sm font-semibold mt-3" style={{ color: C.text }}>You are all caught up</p>
              <p className="text-xs mt-1" style={{ color: C.muted }}>No payments are waiting on you.</p>
            </div>
          )}
          {reviewQueue.slice(0, 5).map((item, index) => (
            <Row key={`${item.kind}-${item.id}`} C={C} first={index === 0}>
              <IconChip color={P.bad} background={P.badSoft}><ShieldAlert className="w-4 h-4" /></IconChip>
              <Lines
                C={C}
                title={item.kind === 'stalled' ? 'Paystack checkout never completed' : reviewTitle(item)}
                sub={[item.reference, item.amount != null && money(item.currency || '', item.amount), item.studentEmail || item.studentName].filter(Boolean).join(', ')}
              />
              {item.kind === 'incident' ? (
                <button type="button" onClick={() => onResolve(item)} disabled={busy} className={btnSmClass} style={btnStyle('ghost', C)}>Resolve</button>
              ) : (
                <LinkBtn onClick={() => onGo('payments')} C={C}>View</LinkBtn>
              )}
            </Row>
          ))}
          {awaitingReview.slice(0, 5).map((request, index) => (
            <Row key={request.id} C={C} first={index === 0 && reviewQueue.length === 0}>
              <Avatar name={learnerName(request.students)} color={C.cta} background={P.ctaSoft} />
              <Lines
                C={C}
                title={`${learnerName(request.students)} sent a payment`}
                sub={[request.plan_name, durationLabel(Number(request.duration_months)), money(request.currency, request.amount), pendingConfirmation(request)?.method].filter(Boolean).join(', ')}
              />
              <button type="button" onClick={() => onReview(request)} disabled={busy} className={btnSmClass} style={btnStyle('pri', C)}>Review</button>
            </Row>
          ))}
          {lateRequests.slice(0, 5).map((request, index) => (
            <Row key={request.id} C={C} first={index === 0 && reviewQueue.length === 0 && awaitingReview.length === 0}>
              <Avatar name={learnerName(request.students)} color={P.warn} background={P.warnSoft} />
              <Lines
                C={C}
                title={`${learnerName(request.students)} has not paid`}
                sub={`${request.plan_name}, ${money(request.currency, request.amount)}, due ${shortDate(request.due_date)}`}
              />
              <Pill tone="bad" dot C={C}>{plural(daysLate(request.due_date), 'day')} late</Pill>
            </Row>
          ))}
        </Card>

        <Card C={C} className="overflow-hidden">
          <CardHead
            title="Ending soon"
            sub="Access that ends in the next 30 days"
            action={<LinkBtn onClick={() => onEnding()} C={C}>View</LinkBtn>}
            C={C}
          />
          {expiring.slice(0, 5).map((sub, index) => {
            const days = daysRemaining(sub.current_period_end);
            const urgent = days <= 7;
            return (
              <button key={sub.id} type="button" onClick={() => onEnding(sub)} className="w-full text-left">
                <Row C={C} first={index === 0}>
                  <span
                    className="min-w-11 rounded-[10px] px-2 py-1 text-center font-bold tabular-nums"
                    style={{ background: urgent ? P.badSoft : P.warnSoft, color: urgent ? P.bad : P.warn, fontFamily: DISPLAY_FONT }}
                  >
                    {days}
                    <small className="block text-[11px] font-semibold leading-4" style={{ fontFamily: 'inherit' }}>{days === 1 ? 'day' : 'days'}</small>
                  </span>
                  <Lines C={C} title={learnerName(sub.students)} sub={`${sub.subscription_plans?.name ?? 'Plan'}, ends ${dateLabel(sub.current_period_end)}`} />
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: C.faint }} />
                </Row>
              </button>
            );
          })}
          {expiring.length === 0 && (
            <p className="text-sm text-center px-5 py-12" style={{ color: C.muted }}>No access ends in the next 30 days.</p>
          )}
        </Card>
      </div>

      <Card C={C} className="overflow-hidden">
        <CardHead
          title="Plans at a glance"
          sub="What is on sale now"
          action={<LinkBtn onClick={() => onGo('plans')} C={C}>Manage plans</LinkBtn>}
          C={C}
        />
        {onSale.map((summary, index) => (
          <Row key={summary.plan.id} C={C} first={index === 0} className="flex-wrap sm:flex-nowrap">
            <IconChip color={C.cta} background={P.ctaSoft}><Layers3 className="w-4 h-4" /></IconChip>
            <Lines
              wide
              C={C}
              title={<>{summary.plan.name}{summary.plan.recommended && <Pill tone="gold" C={C}>Best Value</Pill>}</>}
              sub={`${summary.priceText}, ${plural(summary.live, 'active subscriber')}`}
            />
            {summary.offer
              ? <Pill tone="warn" C={C}>{summary.offer}</Pill>
              : <Pill tone="good" dot C={C}>On sale</Pill>}
          </Row>
        ))}
        {onSale.length === 0 && (
          <p className="text-sm text-center px-5 py-12" style={{ color: C.muted }}>No plan is on sale right now.</p>
        )}
      </Card>
    </div>
  );
}
