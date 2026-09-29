'use client';

import { useMemo, useState } from 'react';
import type { ApplicationFormRecord } from '@/lib/application-forms';
import { applicationOverview, formatDecisionTime, type ApplicationOverviewInput } from '@/lib/application-stats';
import type { ThemeColors } from '@/lib/theme';

function dayLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
}

function applicationsLabel(count: number): string {
  return `${count} application${count === 1 ? '' : 's'}`;
}

/**
 * Summary strip at the top of a form's review panel: headline counts, a 30-day daily bar
 * chart, and applicants per stage. Stage rows filter the application list when clicked.
 */
export function ApplicationOverview({ form, submissions, C, activeStageId, onSelectStage }: {
  form: ApplicationFormRecord;
  submissions: ApplicationOverviewInput[];
  C: ThemeColors;
  activeStageId: string;
  onSelectStage: (stageId: string) => void;
}) {
  const overview = useMemo(() => applicationOverview(form.config.stages, submissions), [form.config.stages, submissions]);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const maxDaily = Math.max(1, ...overview.daily.map(day => day.count));
  const busiest = overview.daily.reduce((best, day) => day.count > best.count ? day : best, overview.daily[0]);
  const shownDay = activeDay === null ? null : overview.daily[activeDay];
  const panel = { background: C.card };

  const tiles = [
    { label: 'Total applications', value: String(overview.total), detail: 'All submitted' },
    { label: 'Last 7 days', value: String(overview.last7Days), detail: 'Including today' },
    { label: 'Today', value: String(overview.today), detail: dayLabel(overview.daily[overview.daily.length - 1].date, { day: 'numeric', month: 'short' }) },
    {
      label: 'Typical first decision',
      value: formatDecisionTime(overview.medianHoursToFirstDecision),
      detail: overview.total ? `${overview.decidedCount} of ${overview.total} decided` : 'After submission',
    },
  ];

  return (
    <section aria-label="Application overview" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.label} className="min-w-0 rounded-xl p-4" style={panel}>
            <p className="text-[11px] font-semibold" style={{ color: C.faint }}>{tile.label}</p>
            <p className="mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl" style={{ color: C.text }}>{tile.value}</p>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: C.muted }}>{tile.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col rounded-xl p-4" style={panel}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold" style={{ color: C.text }}>Applications per day</h3>
            <p className="text-[11px]" style={{ color: C.faint }}>Last 30 days</p>
          </div>
          {overview.total === 0 ? (
            <p className="grid flex-1 place-items-center py-8 text-center text-xs" style={{ color: C.faint }}>The chart fills in as applications arrive.</p>
          ) : (
            <>
              <p className="mt-2 min-h-[18px] text-xs tabular-nums" style={{ color: C.muted }} aria-live="polite">
                {shownDay
                  ? `${dayLabel(shownDay.date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${applicationsLabel(shownDay.count)}`
                  : busiest.count > 0 ? `Busiest day: ${dayLabel(busiest.date, { day: 'numeric', month: 'short' })}, ${applicationsLabel(busiest.count)}` : 'No applications in the last 30 days'}
              </p>
              <div className="mt-3 flex min-h-[7rem] flex-1 items-end gap-[2px]" style={{ borderBottom: `1px solid ${C.inputBorder}` }} onMouseLeave={() => setActiveDay(null)}>
                {overview.daily.map((day, index) => (
                  <button
                    key={day.date}
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-end"
                    onMouseEnter={() => setActiveDay(index)}
                    onFocus={() => setActiveDay(index)}
                    onBlur={() => setActiveDay(null)}
                    onClick={() => setActiveDay(current => current === index ? null : index)}
                    aria-label={`${dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${applicationsLabel(day.count)}`}
                  >
                    <span
                      className="block w-full rounded-t-[4px] transition-opacity"
                      style={{
                        height: day.count ? `${Math.max(6, (day.count / maxDaily) * 100)}%` : 0,
                        background: C.cta,
                        opacity: activeDay === null || activeDay === index ? 1 : 0.45,
                      }}
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px]" style={{ color: C.faint }}>
                <span>{dayLabel(overview.daily[0].date, { day: 'numeric', month: 'short' })}</span>
                <span>Today</span>
              </div>
            </>
          )}
        </div>

        <div className="min-w-0 rounded-xl p-4" style={panel}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold" style={{ color: C.text }}>By stage</h3>
            {activeStageId
              ? <button type="button" onClick={() => onSelectStage('')} className="text-[11px] font-semibold underline" style={{ color: C.cta }}>Show all stages</button>
              : <p className="text-[11px]" style={{ color: C.faint }}>Select a stage to filter</p>}
          </div>
          <ul className="mt-3 space-y-1">
            {overview.byStage.map(stage => {
              const selectable = Boolean(stage.id);
              const active = selectable && stage.id === activeStageId;
              const share = overview.total ? stage.count / overview.total : 0;
              const content = (
                <>
                  <span className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-medium" style={{ color: C.text }}>{stage.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums" style={{ color: C.text }}>{stage.count}</span>
                  </span>
                  <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.input }}>
                    <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: C.cta }} />
                  </span>
                </>
              );
              return (
                <li key={stage.id || 'other'}>
                  {selectable
                    ? <button type="button" onClick={() => onSelectStage(active ? '' : stage.id)} aria-pressed={active} className="block w-full rounded-lg px-2.5 py-2 text-left transition-colors" style={{ background: active ? C.pill : 'transparent', boxShadow: active ? `inset 0 0 0 1px ${C.cta}` : 'none' }}>{content}</button>
                    : <div className="px-2.5 py-2" title="Applicants in a stage that has since been removed">{content}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
