'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ApplicationAnswer, ApplicationFormRecord } from '@/lib/application-forms';
import {
  applicationFieldBreakdowns,
  applicationOverview,
  type ApplicationFieldBreakdown,
  type ApplicationOverviewInput,
} from '@/lib/application-stats';
import type { ThemeColors } from '@/lib/theme';

function dayLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
}

function applicationsLabel(count: number): string {
  return `${count} application${count === 1 ? '' : 's'}`;
}

/**
 * Insights for one application form, opened from its card in the forms list: headline
 * counts, a 30-day daily bar chart, and applicants per stage. Loads the same submissions
 * the review panel uses, so reviewers only see their assigned applications.
 */
export function ApplicationInsights({ form, token, C, onBack }: {
  form: ApplicationFormRecord;
  token: string;
  C: ThemeColors;
  onBack: () => void;
}) {
  const [submissions, setSubmissions] = useState<(ApplicationOverviewInput & { answers?: Record<string, ApplicationAnswer> })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState<number | null>(null);

  // The view mounts fresh each time it is opened from the forms list, so loading and error
  // start from their initial values here.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/application-forms/${form.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Could not load applications.');
        if (!cancelled) setSubmissions(value.submissions ?? []);
      })
      .catch(reason => { if (!cancelled) setError((reason as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [form.id, token]);

  const overview = useMemo(() => applicationOverview(form.config.stages, submissions), [form.config.stages, submissions]);
  const fields = useMemo(() => applicationFieldBreakdowns(form.config.questions, submissions), [form.config.questions, submissions]);
  const maxDaily = Math.max(1, ...overview.daily.map(day => day.count));
  const busiest = overview.daily.reduce((best, day) => day.count > best.count ? day : best, overview.daily[0]);
  const shownDay = activeDay === null ? null : overview.daily[activeDay];
  const panel = { background: C.card };

  const tiles = [
    { label: 'Total applications', value: String(overview.total), detail: 'All submitted' },
    { label: 'Last 7 days', value: String(overview.last7Days), detail: 'Including today' },
    { label: 'Today', value: String(overview.today), detail: dayLabel(overview.daily[overview.daily.length - 1].date, { day: 'numeric', month: 'short' }) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center gap-3 rounded-xl p-3 sm:p-4" style={{ background: C.card }}>
        <button type="button" onClick={onBack} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg" style={{ background: C.input, color: C.muted }} aria-label="Back to forms"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0"><h2 className="truncate text-lg font-bold" style={{ color: C.text }}>{form.config.title}</h2><p className="mt-0.5 text-xs" style={{ color: C.faint }}>Insights</p></div>
      </div>

      {error && <div className="rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}

      {loading ? <div className="py-20"><Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: C.cta }} /></div> : !error && (
        <section aria-label="Application insights" className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {tiles.map(tile => (
              <div key={tile.label} className="min-w-0 rounded-xl p-3 sm:p-4" style={panel}>
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
              <h3 className="text-sm font-bold" style={{ color: C.text }}>By stage</h3>
              <ul className="mt-3 space-y-1">
                {overview.byStage.map(stage => {
                  const share = overview.total ? stage.count / overview.total : 0;
                  return (
                    <li key={stage.id || 'other'} className="px-2.5 py-2" title={stage.id ? undefined : 'Applicants in a stage that has since been removed'}>
                      <span className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-medium" style={{ color: C.text }}>{stage.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums" style={{ color: C.text }}>{stage.count}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.input }}>
                        <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: C.cta }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {overview.total > 0 && fields.length > 0 && (
            <div className="space-y-3 pt-2">
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.text }}>Answers by question</h3>
                <p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>Choice, short answer, and number questions. Percentages are of applicants who answered.</p>
              </div>
              <div className="grid items-start gap-3 lg:grid-cols-2">
                {fields.map(field => <FieldCard key={field.id} field={field} C={C} />)}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** One question's summary: a bar per option (or common answer), or number stats. */
function FieldCard({ field, C }: { field: ApplicationFieldBreakdown; C: ThemeColors }) {
  const answeredLine = `${field.answered} of ${field.shown} answered`;
  return (
    <section className="min-w-0 rounded-xl p-4" style={{ background: C.card }} aria-label={`${field.label} summary`}>
      <h4 className="text-sm font-semibold leading-5" style={{ color: C.text }}>{field.label}</h4>
      <p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>
        {answeredLine}
        {field.kind === 'multi' ? ' - applicants could pick more than one, so totals can pass 100%' : ''}
        {field.kind === 'text' ? ' - most common answers' : ''}
      </p>
      {field.kind === 'number' ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['Average', field.average], ['Lowest', field.min], ['Highest', field.max]].map(([label, value]) => (
            <div key={label as string} className="rounded-lg p-3" style={{ background: C.input }}>
              <p className="text-[11px] font-semibold" style={{ color: C.faint }}>{label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: C.text }}>{formatNumber(value as number)}</p>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {field.options.map(option => (
            <li key={option.label}>
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium" style={{ color: C.text }} title={option.label}>{option.label}</span>
                <span className="shrink-0 tabular-nums" style={{ color: C.muted }}><span className="font-semibold" style={{ color: C.text }}>{option.count}</span> ({percent(option.share)})</span>
              </span>
              <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.input }}>
                <span className="block h-full rounded-full" style={{ width: `${option.share * 100}%`, background: C.cta }} />
              </span>
            </li>
          ))}
          {field.kind === 'text' && field.otherCount ? (
            <li className="flex items-center justify-between gap-3 text-xs" style={{ color: C.muted }}>
              <span>Other answers</span>
              <span className="tabular-nums">{field.otherCount} ({percent(field.answered ? field.otherCount / field.answered : 0)})</span>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
