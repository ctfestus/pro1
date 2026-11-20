'use client';

// A learner's details, sliding in from the right: subscription, account setup as a timeline,
// and their courses, assignments and virtual experiences.

import { useEffect, useState, type ReactNode } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { getJson, getPayments } from '../subscriptions/api';
import { Avatar, Bar, DISPLAY_FONT, Pill, btnClass, btnStyle, dateLabel, learnerName, palette, type Tone } from '../subscriptions/ui';
import { SETUP_STEPS, accountStatus, dateTime } from './shared';

function Section({ title, aside, children, C }: { title: string; aside?: ReactNode; children: ReactNode; C: ThemeColors }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h4 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function List({ items, empty, C }: { items: { key: string; title: string; sub?: string | null; right: ReactNode; bar?: number }[]; empty: string; C: ThemeColors }) {
  const P = palette(C);
  if (!items.length) return <p className="text-sm" style={{ color: C.muted }}>{empty}</p>;
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
      {items.map((item, i) => (
        <div key={item.key} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.title}</p>
            {item.sub && <p className="text-xs" style={{ color: C.muted }}>{item.sub}</p>}
            {item.bar != null && <div className="mt-2"><Bar parts={[{ pct: item.bar, color: P.good }]} C={C} /></div>}
          </div>
          {item.right}
        </div>
      ))}
    </div>
  );
}

const PROGRESS: Record<string, [string, Tone]> = {
  completed: ['Done', 'good'],
  in_progress: ['In progress', 'warn'],
  graded: ['Graded', 'good'],
  submitted: ['Submitted', 'good'],
  draft: ['Draft', 'warn'],
};
function ProgressPill({ status, C }: { status: string; C: ThemeColors }) {
  const [label, tone] = PROGRESS[status] ?? ['Not started', 'mute' as Tone];
  return <Pill tone={tone} dot={tone !== 'mute'} C={C}>{label}</Pill>;
}

export function StudentDrawer({ student, cohortName, onClose, C }: { student: any; cohortName: string | null; onClose: () => void; C: ThemeColors }) {
  const P = palette(C);
  const [detail, setDetail] = useState<any>(null);
  const [detailError, setDetailError] = useState('');
  const [subscription, setSubscription] = useState<any>(undefined);
  const [attempt, setAttempt] = useState(0);
  const status = accountStatus(student);

  // Mounted with key={student.id}: each learner starts fresh, and an answer for the panel that
  // was closed or moved on is dropped.
  useEffect(() => {
    let live = true;
    getPayments(`action=subscription-status&studentId=${student.id}`, 'Failed to load the subscription')
      .then((data) => { if (live) setSubscription(data.subscription ?? null); })
      .catch(() => { if (live) setSubscription(null); });
    return () => { live = false; };
  }, [student.id]);
  useEffect(() => {
    let live = true;
    getJson(`/api/admin/student-detail?studentId=${student.id}`, 'Failed to load student detail')
      .then((data) => { if (live) { setDetail(data); setDetailError(''); } })
      .catch(() => { if (live) setDetailError("Could not load this student's courses and progress."); });
    return () => { live = false; };
  }, [student.id, attempt]);

  const courses = detail?.courses ?? [];
  const assignments = detail?.assignments ?? [];
  const ves = detail?.ves ?? [];

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: 'rgba(4,8,20,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={learnerName(student)} className="w-full max-w-lg h-full overflow-y-auto flex flex-col" style={{ background: C.card }}>
        <div className="flex items-start gap-3 px-6 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <Avatar name={learnerName(student)} color={C.text} background={C.pill} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[22px] leading-7 font-semibold truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{student.full_name || 'No name'}</h3>
            <p className="text-sm truncate" style={{ color: C.muted }}>{student.email}</p>
            <div className="mt-2"><Pill tone="mute" C={C}>{cohortName ?? 'On their own'}</Pill></div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 grid gap-6">
          <div className="flex flex-wrap gap-2">
            <a href={`/student?viewAs=${student.id}`} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('pri', C)}>
              <ExternalLink className="w-4 h-4" />
              View as student
            </a>
            <button type="button" onClick={() => { onClose(); window.location.hash = 'subscriptions'; }} className={btnClass} style={btnStyle('sec', C)}>Manage subscription</button>
          </div>

          <Section title="Subscription" C={C}>
            <List
              C={C}
              empty="Loading..."
              items={subscription === undefined ? [] : [subscription
                ? { key: 'sub', title: subscription.subscription_plans?.name || 'Subscription plan', sub: subscription.current_period_end ? `Ends ${dateLabel(subscription.current_period_end)}` : null, right: <Pill tone={subscription.status === 'active' ? 'good' : 'mute'} dot C={C}>{subscription.status === 'active' ? 'Active' : String(subscription.status).replaceAll('_', ' ')}</Pill> }
                : { key: 'none', title: 'No subscription', sub: cohortName ? `Learns through ${cohortName}` : null, right: null }]}
            />
          </Section>

          <Section title="Account setup" aside={<Pill tone={status.tone} dot C={C}>{status.label}</Pill>} C={C}>
            <ol className="pt-2">
              {SETUP_STEPS.map(([key, label], i) => {
                const at = student[key];
                const last = i === SETUP_STEPS.length - 1;
                const name = key === 'last_login_at' && !at ? 'First sign-in' : label;
                return (
                  <li key={key} className="relative flex items-start gap-3" style={{ paddingBottom: last ? 0 : 20 }}>
                    {/* The broken line down to the next step. */}
                    {!last && <span aria-hidden className="absolute left-[10px] top-[26px] bottom-[2px]" style={{ borderLeft: `2px dashed ${at ? P.good : C.faint}`, opacity: 0.6 }} />}
                    <span className="relative w-[22px] h-[22px] rounded-full grid place-items-center flex-shrink-0" style={at ? { background: P.good, color: '#FFFFFF' } : { background: C.card, boxShadow: `inset 0 0 0 2px ${C.faint}` }}>
                      {at && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="grid gap-0.5 min-w-0">
                      <span className="text-sm" style={{ color: at ? C.text : C.muted, fontWeight: at ? 600 : 500 }}>{name}</span>
                      <span className="text-xs" style={{ color: C.muted }}>{dateTime(at) ?? 'Not yet'}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Section>

          {detailError ? (
            <div className="rounded-xl p-4 text-center" style={{ background: C.errorBg }}>
              <p className="text-sm" style={{ color: C.errorText }}>{detailError}</p>
              <button onClick={() => setAttempt((n) => n + 1)} className="mt-2 text-xs font-semibold underline underline-offset-2" style={{ color: C.text }}>Try again</button>
            </div>
          ) : !detail ? (
            <p className="text-sm text-center py-6" style={{ color: C.muted }}>Loading progress...</p>
          ) : (
            <>
              <Section title="Courses" aside={<span className="text-xs" style={{ color: C.muted }}>{courses.filter((c: any) => c.status === 'completed').length} of {courses.length} done</span>} C={C}>
                <List
                  C={C}
                  empty="No courses in their cohort."
                  items={courses.map((c: any) => ({
                    key: c.id,
                    title: c.title,
                    sub: [c.score != null && `Score ${c.score}%`, c.hasCert && 'certificate issued'].filter(Boolean).join(', ') || null,
                    right: <ProgressPill status={c.status} C={C} />,
                  }))}
                />
              </Section>
              {assignments.length > 0 && (
                <Section title="Assignments" aside={<span className="text-xs" style={{ color: C.muted }}>{assignments.filter((a: any) => a.status === 'graded').length} of {assignments.length} graded</span>} C={C}>
                  <List C={C} empty="" items={assignments.map((a: any) => ({ key: a.id, title: a.title, sub: a.score != null ? `Score ${a.score}%` : null, right: <ProgressPill status={a.status} C={C} /> }))} />
                </Section>
              )}
              {ves.length > 0 && (
                <Section title="Virtual experiences" C={C}>
                  <List
                    C={C}
                    empty=""
                    items={ves.map((v: any) => ({ key: v.id, title: v.title, bar: Number(v.progressPct ?? 0), right: <span className="text-xs tabular-nums" style={{ color: C.text }}>{Number(v.progressPct ?? 0)}%</span> }))}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
