'use client';

import { MoreHorizontal, Search } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { durationLabel } from '@/lib/pricing-offer';
import type { ThemeColors } from '@/lib/theme';
import {
  Avatar, Bar, Card, daysRemaining, dateLabel, isLive, learnerName, money, palette, Pill, shortDate,
  accessUsed, subscriberBucket, type SubscriberBucket,
} from './ui';

const FILTERS: { id: 'all' | SubscriberBucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'soon', label: 'Ending soon' },
  { id: 'ended', label: 'Ended' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function SubscribersTab({
  C, subscriptions, rows, plans, search, setSearch, statusFilter, setStatusFilter, planFilter, setPlanFilter, onMenu,
}: {
  C: ThemeColors;
  subscriptions: any[];
  rows: any[];
  plans: any[];
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  planFilter: string;
  setPlanFilter: (value: string) => void;
  onMenu: (event: React.MouseEvent<HTMLElement>, sub: any) => void;
}) {
  const P = palette(C);
  const counts = subscriptions.reduce<Record<string, number>>((acc, sub) => {
    const bucket = subscriberBucket(sub);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, { all: subscriptions.length });

  const status = (sub: any) => {
    const bucket = subscriberBucket(sub);
    return bucket === 'soon' ? <Pill tone="warn" dot C={C}>Ending soon</Pill>
      : bucket === 'active' ? <Pill tone="good" dot C={C}>Active</Pill>
      : bucket === 'ended' ? <Pill tone="mute" dot C={C}>Ended</Pill>
      : <Pill tone="bad" dot C={C}>Cancelled</Pill>;
  };
  const barColor = (sub: any) => {
    const bucket = subscriberBucket(sub);
    return bucket === 'soon' ? P.warn : bucket === 'active' ? P.good : C.faint;
  };
  const left = (sub: any) => {
    if (!isLive(sub)) return <span className="text-xs" style={{ color: C.muted }}>--</span>;
    const days = daysRemaining(sub.current_period_end);
    return (
      <b className="font-bold tabular-nums whitespace-nowrap" style={{ color: days <= 7 ? P.bad : days <= 30 ? P.warn : C.text }}>
        {days} {days === 1 ? 'day' : 'days'}
      </b>
    );
  };
  const paid = (sub: any) => `${durationLabel(Number(sub.duration_months))}, ${money(sub.currency, sub.amount)}`;
  const kebab = (sub: any) => (
    <button
      type="button"
      onClick={(event) => onMenu(event, sub)}
      className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 transition-colors hover:opacity-80"
      style={{ color: C.muted, background: C.pill }}
      aria-label={`Actions for ${learnerName(sub.students)}`}
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1 min-w-[240px] max-w-[360px]"
          style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            className="bg-transparent outline-none text-sm w-full"
            style={{ color: C.text }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map(({ id, label }) => {
            const on = statusFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                aria-pressed={on}
                className="inline-flex items-center gap-2 h-8 px-3 rounded-full text-xs font-semibold"
                style={on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}
              >
                {label}
                <span className="tabular-nums" style={{ opacity: 0.8 }}>{counts[id] ?? 0}</span>
              </button>
            );
          })}
          {plans.length > 1 && (
            <MenuSelect
              label="Filter by plan"
              value={planFilter}
              options={[{ value: 'all', label: 'All plans' }, ...plans.map((plan) => ({ value: plan.id as string, label: plan.name as string }))]}
              onChange={setPlanFilter}
              C={C}
            />
          )}
        </div>
      </div>

      <Card C={C} className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr>
              {['Learner', 'Plan', 'Status', 'Access', 'Left', 'Paid', ''].map((heading, index) => (
                <th
                  key={index}
                  className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap"
                  style={{ color: C.faint, borderBottom: `1px solid ${C.divider}` }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((sub) => (
              <tr key={sub.id} style={{ borderBottom: `1px solid ${C.divider}` }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={learnerName(sub.students)} color={C.text} background={P.ctaSoft} />
                    <div className="min-w-0">
                      <p className="font-semibold truncate" style={{ color: C.text }}>{sub.students?.full_name || '--'}</p>
                      <p className="text-xs truncate" style={{ color: C.muted }}>{sub.students?.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><Pill tone="cta" C={C}>{sub.subscription_plans?.name ?? 'Plan'}</Pill></td>
                <td className="px-4 py-3">{status(sub)}</td>
                <td className="px-4 py-3 min-w-[180px]">
                  <p className="text-xs whitespace-nowrap mb-2" style={{ color: C.muted }}>
                    {shortDate(sub.current_period_start)} to {dateLabel(sub.current_period_end)}
                  </p>
                  <Bar parts={[{ pct: accessUsed(sub), color: barColor(sub) }]} C={C} />
                </td>
                <td className="px-4 py-3">{left(sub)}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: C.text }}>{paid(sub)}</td>
                <td className="px-4 py-3 text-right">{kebab(sub)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No learners match this filter.</p>
        )}
      </Card>

      <div className="md:hidden space-y-3">
        {rows.map((sub) => (
          <Card key={sub.id} C={C} className="p-4 grid gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={learnerName(sub.students)} color={C.text} background={P.ctaSoft} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{learnerName(sub.students)}</p>
                <p className="text-xs truncate" style={{ color: C.muted }}>{sub.subscription_plans?.name ?? 'Plan'}, {paid(sub)}</p>
              </div>
              {kebab(sub)}
            </div>
            <div className="flex items-center justify-between gap-3">
              {status(sub)}
              {left(sub)}
            </div>
            <div>
              <p className="text-xs mb-2" style={{ color: C.muted }}>
                {shortDate(sub.current_period_start)} to {dateLabel(sub.current_period_end)}
              </p>
              <Bar parts={[{ pct: accessUsed(sub), color: barColor(sub) }]} C={C} />
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card C={C}><p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No learners match this filter.</p></Card>
        )}
      </div>
    </div>
  );
}
