'use client';

import { MoreHorizontal, Search } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { Avatar, Bar, Card, DISPLAY_FONT, Pill, palette } from '../subscriptions/ui';
import { ACCESS_STATUS, StatusPill, amountText, dueText, owed, totalsByCurrency, totalsText } from './shared';

const STATUS_FILTERS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(ACCESS_STATUS).map(([value, s]) => ({ value, label: s.label }))];

export function EnrollmentsView({
  C, rows, filtered, cohorts, outstandingCohortId, gracePeriods, search, setSearch, cohortFilter, setCohortFilter, statusFilter, setStatusFilter, onMenu, menuRowId,
}: {
  C: ThemeColors;
  rows: any[];
  /** The rows the search and filters leave. */
  filtered: any[];
  cohorts: any[];
  outstandingCohortId: string;
  gracePeriods: Record<string, number | null>;
  search: string;
  setSearch: (value: string) => void;
  cohortFilter: string;
  setCohortFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onMenu: (event: React.MouseEvent<HTMLElement>, row: any) => void;
  menuRowId: string | null;
}) {
  const P = palette(C);
  const groups = new Map<string, { id: string; name: string; rows: any[] }>();
  for (const r of filtered) {
    const key = r.cohort_id ?? '__none__';
    if (!groups.has(key)) groups.set(key, { id: key, name: r.cohort_name ?? '--', rows: [] });
    groups.get(key)!.rows.push(r);
  }

  const owing = rows.filter((r) => r.access_status === 'overdue' || r.access_status === 'pending_deposit');
  const overdueCount = rows.filter((r) => r.access_status === 'overdue').length;
  const settled = rows.filter((r) => r.access_status === 'completed' || r.access_status === 'waived');
  const outstanding = totalsByCurrency(rows, owed);
  const billable = rows.filter((r) => r.access_status !== 'waived');
  const collected = totalsByCurrency(billable, (r) => Number(r.paid_total ?? 0));
  const fees = totalsByCurrency(billable, (r) => Number(r.total_fee ?? 0));
  const oneCurrency = fees.length === 1 ? fees[0] : null;
  const collectedPct = oneCurrency && oneCurrency[1] > 0 ? ((collected.find(([c]) => c === oneCurrency[0])?.[1] ?? 0) / oneCurrency[1]) * 100 : null;

  const kpis = [
    { label: 'Enrolled learners', n: String(rows.length), sub: `Across ${groupsCount(rows)} cohort${groupsCount(rows) === 1 ? '' : 's'}`, color: C.text },
    { label: 'Owe a payment', n: String(owing.length), sub: owing.length ? `${overdueCount} overdue, ${owing.length - overdueCount} waiting for a deposit` : 'Nobody is behind', color: owing.length ? P.bad : C.text },
    { label: 'Outstanding', n: totalsText(outstanding), sub: oneCurrency ? `Collected ${amountText(oneCurrency[0], collected[0]?.[1] ?? 0)} of ${amountText(oneCurrency[0], oneCurrency[1])}` : 'Waived fees are not counted', color: C.text, bar: collectedPct },
    { label: 'Settled', n: String(settled.length), sub: `${settled.filter((r) => r.access_status === 'completed').length} paid in full, ${settled.filter((r) => r.access_status === 'waived').length} waived`, color: settled.length ? P.good : C.text },
  ];

  const th = 'text-left px-4 py-3 text-xs font-semibold whitespace-nowrap';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
            <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums truncate" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
            <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
            <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
            {k.bar != null && <Bar parts={[{ pct: k.bar, color: P.good }]} C={C} />}
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1 min-w-[220px] max-w-[380px]" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
          <Search className="w-4 h-4 flex-shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or cohort" className="bg-transparent outline-none text-sm w-full" style={{ color: C.text }} />
        </label>
        <MenuSelect
          label="Filter by cohort"
          value={cohortFilter}
          options={[{ value: 'all', label: 'All cohorts' }, ...cohorts.filter((c) => c.cohort_kind === 'bootcamp').map((c) => ({ value: c.id as string, label: c.name as string }))]}
          onChange={setCohortFilter}
          C={C}
        />
        <MenuSelect label="Filter by status" value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} C={C} />
      </div>

      {filtered.length === 0 ? (
        <Card C={C}>
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>
            {rows.length === 0 ? 'No signed-up students yet. Students appear here after completing signup from their invitation link.' : 'No learners match these filters.'}
          </p>
        </Card>
      ) : [...groups.values()].map((group) => {
        const isOutstanding = Boolean(outstandingCohortId) && group.id === outstandingCohortId;
        const groupOwed = totalsByCurrency(group.rows, owed);
        const grace = gracePeriods[group.id];
        return (
          <Card key={group.id} C={C} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <h3 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{group.name}</h3>
              {isOutstanding && <Pill tone="bad" dot C={C}>Outstanding cohort</Pill>}
              {groupOwed.length > 0 && <Pill tone="bad" C={C}>{totalsText(groupOwed)} outstanding</Pill>}
              <span className="text-xs sm:ml-auto" style={{ color: C.muted }}>
                {group.rows.length} learner{group.rows.length === 1 ? '' : 's'}
                {isOutstanding ? ', no course access until paid' : grace != null ? `, ${grace} day${grace === 1 ? '' : 's'} grace` : ''}
              </span>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm table-fixed">
                <colgroup><col style={{ width: '27%' }} /><col style={{ width: '11%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '5%' }} /></colgroup>
                <thead>
                  <tr>{['Learner', 'Fee', 'Paid', 'Balance', 'Status', 'Next due', ''].map((h, i) => <th key={i} className={th} style={{ color: C.faint }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {group.rows.map((r: any, i: number) => {
                    const fee = Number(r.total_fee ?? 0);
                    const paid = Number(r.paid_total ?? 0);
                    const waived = r.access_status === 'waived';
                    const due = dueText(r);
                    const late = Boolean(due?.includes('late'));
                    const from = isOutstanding && r.original_cohort_id ? cohorts.find((c) => c.id === r.original_cohort_id)?.name : null;
                    const tags = [r.is_presignup && 'Pending signup', !r.is_presignup && r.payment_exempt && 'Exempt', r.payment_plan === 'sponsored' && 'Sponsored'].filter(Boolean);
                    return (
                      <tr key={r.enrollment_id ?? i} style={{ borderTop: `1px solid ${C.divider}` }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={r.student_name || r.email || '?'} color={C.text} background={C.pill} />
                            <div className="min-w-0">
                              <p className="font-semibold truncate" style={{ color: C.text }} title={r.student_name}>{r.student_name || '--'}</p>
                              <p className="text-xs truncate" style={{ color: C.muted }} title={r.email}>{[...tags, from ? `From ${from}` : r.email].join(', ')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{amountText(r.currency, fee)}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs whitespace-nowrap" style={{ color: C.text }}>{waived ? 'Waived' : amountText(r.currency, paid)}</p>
                          <div className="mt-2"><Bar parts={[{ pct: waived ? 100 : fee > 0 ? (paid / fee) * 100 : 0, color: waived ? C.faint : P.good }]} C={C} /></div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {owed(r) > 0
                            ? <span className="font-semibold tabular-nums" style={{ color: P.bad, fontFamily: DISPLAY_FONT }}>{amountText(r.currency, owed(r))}</span>
                            : <span className="text-xs" style={{ color: C.muted }}>--</span>}
                        </td>
                        <td className="px-4 py-3"><StatusPill status={r.access_status} C={C} /></td>
                        <td className="px-4 py-3 text-xs" style={{ color: late ? P.bad : due ? C.text : C.muted }}>{due ?? '--'}</td>
                        <td className="px-4 py-3 text-right">
                          {r.enrollment_id && (
                            <button
                              type="button"
                              onClick={(e) => onMenu(e, r)}
                              aria-label={`Actions for ${r.student_name || r.email}`}
                              className="w-8 h-8 rounded-[10px] inline-grid place-items-center"
                              style={menuRowId === r.enrollment_id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {group.rows.map((r: any, i: number) => {
                const fee = Number(r.total_fee ?? 0);
                const paid = Number(r.paid_total ?? 0);
                const waived = r.access_status === 'waived';
                const due = dueText(r);
                return (
                  <div key={r.enrollment_id ?? i} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.student_name || r.email || '?'} color={C.text} background={C.pill} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{r.student_name || '--'}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>{r.email}</p>
                      </div>
                      {r.enrollment_id && (
                        <button type="button" onClick={(e) => onMenu(e, r)} aria-label={`Actions for ${r.student_name || r.email}`} className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <StatusPill status={r.access_status} C={C} />
                      {owed(r) > 0 && <span className="text-sm font-semibold tabular-nums" style={{ color: P.bad, fontFamily: DISPLAY_FONT }}>{amountText(r.currency, owed(r))} owed</span>}
                    </div>
                    <div>
                      <p className="text-xs mb-2" style={{ color: C.muted }}>
                        {waived ? `Fee ${amountText(r.currency, fee)}, waived` : `Paid ${amountText(r.currency, paid)} of ${amountText(r.currency, fee)}`}{due ? `, next due ${due}` : ''}
                      </p>
                      <Bar parts={[{ pct: waived ? 100 : fee > 0 ? (paid / fee) * 100 : 0, color: waived ? C.faint : P.good }]} C={C} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      {filtered.length > 0 && (
        <p className="text-xs" style={{ color: C.muted }}>
          {filtered.length} learner{filtered.length === 1 ? '' : 's'} in {groups.size} cohort{groups.size === 1 ? '' : 's'}{rows.length !== filtered.length ? `, filtered from ${rows.length}` : ''}
        </p>
      )}
    </div>
  );
}

function groupsCount(rows: any[]) {
  return new Set(rows.map((r) => r.cohort_id ?? '__none__')).size;
}
