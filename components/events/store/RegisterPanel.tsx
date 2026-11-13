'use client';

/**
 * The register box on a public event page (/events/[slug]).
 *
 * Anyone can register: a visitor types their name and email; a signed-in visitor is registered
 * under their account's email (the field is shown read-only). The event's own questions follow.
 * The join link is never shown here: it goes to the email address, so it reaches its owner only.
 * The page is cached and served to everyone, so the session is read here in the browser.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarPlus, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { buildGoogleCalUrl, downloadIcs } from '@/lib/calendar-links';
import { dateParts, type AfterRegistration, type PublicEvent } from '@/lib/events/public-event';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { CARD_SHADOW } from '@/components/books/store/card-style';
import { Countdown } from '@/components/events/store/Countdown';

type Props = {
  event: Pick<PublicEvent, 'id' | 'title' | 'summary' | 'format' | 'location' | 'startDate' | 'nextDate' | 'time' | 'timezone'
    | 'recurrence' | 'recurrenceEndDate' | 'recurrenceDays' | 'isPast' | 'spotsLeft' | 'fields'>;
  primaryColor: string;
  pageUrl: string;
  /** The next session's start (ISO), for the countdown. Null for an untimed or finished event. */
  startsAt: string | null;
  /** The editor's "after registration" setting: a notice, a button, a redirect or suggestions. */
  after: AfterRegistration;
};

const inputClass = 'w-full h-11 rounded-xl px-3.5 text-sm outline-none transition-shadow focus:ring-2';
const inputStyle = { background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-text,#0f172a)' } as const;

export function RegisterPanel({ event, primaryColor, pageUrl, startsAt, after }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [cohortToken, setCohortToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || cancelled) return;
      // A cohort member is registered already (their cohort's row, read under its own RLS): they
      // get their tracked Join link here instead of the form.
      const [{ data: student }, { data: cohortReg }] = await Promise.all([
        supabase.from('students').select('full_name').eq('id', user.id).maybeSingle(),
        supabase.from('event_registrations').select('join_token').eq('event_id', event.id).eq('student_id', user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (cohortReg?.join_token) setCohortToken(cohortReg.join_token);
      // The server registers the sign-in address, so that is the one shown.
      setAccountEmail(user.email || null);
      // Names go into emails, so the server takes letters, spaces, apostrophes and hyphens only.
      // Prefill a profile name in that form ("Dr. Ada" becomes "Dr Ada") rather than one it refuses.
      const profileName = String(student?.full_name || user.user_metadata?.full_name || '')
        .replace(/[^\p{L}\p{M} '\u2019-]/gu, ' ').replace(/\s+/g, ' ').trim();
      setName(prev => prev || profileName);
    })();
    return () => { cancelled = true; };
  }, [event.id]);

  // "Redirect to a URL": the success card shows briefly, then the browser goes on.
  useEffect(() => {
    if (!done || after.type !== 'redirect') return;
    const t = setTimeout(() => { window.location.href = after.url; }, 1800);
    return () => clearTimeout(t);
  }, [done, after]);

  const full = event.spotsLeft !== null && event.spotsLeft <= 0;

  if (cohortToken && !event.isPast) {
    return (
      <div className="rounded-2xl bg-[var(--ev-surface,#ffffff)] p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
        {startsAt && <div className="mb-5"><Countdown startsAt={startsAt} primaryColor={primaryColor} /></div>}
        <CheckCircle2 className="w-8 h-8" style={{ color: '#16a34a' }} />
        <p className="mt-3 text-lg font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>You are registered</p>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>Your cohort is registered for this event, so there is nothing to fill in.</p>
        {event.format === 'virtual' && (
          <a href={`/api/join?token=${encodeURIComponent(cohortToken)}`} target="_blank" rel="noopener noreferrer"
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold"
            style={{ background: primaryColor, color: 'var(--ev-on-accent,#ffffff)' }}>
            Join meeting <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    );
  }

  if (event.isPast || full) {
    return (
      <div className="rounded-2xl bg-[var(--ev-surface,#ffffff)] p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
        <p className="text-base font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{event.isPast ? 'This event has ended' : 'This event is full'}</p>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
          {event.isPast ? 'Registration is closed.' : 'Every spot has been taken. Check back in case one opens up.'}
        </p>
        <Link href="/events" className="mt-4 inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold" style={{ background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-text,#0f172a)' }}>
          Browse other events
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/events/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ eventId: event.id, name, email: accountEmail ?? email, responses: answers }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Could not register you. Try again.'); return; }
      setDone(accountEmail ?? email.trim());
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const calDate = event.nextDate ?? event.startDate;
    const calTime = event.time ?? '09:00';
    const where = event.format === 'virtual' ? pageUrl : (event.location ?? '');
    const details = [event.summary, event.format === 'virtual' ? 'The join link is in your confirmation email.' : '', pageUrl].filter(Boolean).join('\n\n');
    const recurrence = event.recurrence === 'once' ? undefined : event.recurrence;
    const google = calDate ? buildGoogleCalUrl(event.title, calDate, calTime, event.timezone, where, details, recurrence, event.recurrenceEndDate ?? undefined, event.recurrenceDays) : null;
    return (
      <div className="rounded-2xl bg-[var(--ev-surface,#ffffff)] p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
        {startsAt && <div className="mb-5"><Countdown startsAt={startsAt} primaryColor={primaryColor} /></div>}
        <CheckCircle2 className="w-8 h-8" style={{ color: '#16a34a' }} />
        <p className="mt-3 text-lg font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>You are registered</p>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>
          We sent a confirmation to <b>{done}</b>{event.format === 'virtual' ? ' with your personal join link' : ''}. You will also get a reminder before it starts.
        </p>
        {calDate && (
          <div className="mt-5 flex flex-wrap gap-2">
            {google && (
              <a href={google} target="_blank" rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={{ background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-text,#0f172a)' }}>
                <CalendarPlus className="w-4 h-4" /> Google Calendar
              </a>
            )}
            <button type="button"
              onClick={() => downloadIcs(event.title, calDate, calTime, event.timezone, where, details, recurrence, event.recurrenceEndDate ?? undefined, event.recurrenceDays)}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={{ background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-text,#0f172a)' }}>
              <CalendarPlus className="w-4 h-4" /> Apple / Outlook (.ics)
            </button>
          </div>
        )}
        <AfterRegistering after={after} primaryColor={primaryColor} />
      </div>
    );
  }

  const ring = { ...inputStyle, ['--tw-ring-color' as any]: `${primaryColor}55` };
  return (
    <form onSubmit={submit} className="rounded-2xl bg-[var(--ev-surface,#ffffff)] p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
      {startsAt && <div className="mb-5"><Countdown startsAt={startsAt} primaryColor={primaryColor} /></div>}
      <p className="text-lg font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>Register for this event</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
        Free
        {event.spotsLeft !== null ? ` | ${event.spotsLeft} spot${event.spotsLeft === 1 ? '' : 's'} left` : ''}
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-semibold" style={{ color: 'var(--ev-body,#334155)' }}>Full name</span>
          <input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={80}
            className={`mt-1 ${inputClass}`} style={ring} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold" style={{ color: 'var(--ev-body,#334155)' }}>Email</span>
          {accountEmail ? (
            <input value={accountEmail} readOnly className={`mt-1 ${inputClass}`} style={{ ...inputStyle, color: 'var(--ev-muted,#64748b)' }} />
          ) : (
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254}
              className={`mt-1 ${inputClass}`} style={ring} />
          )}
        </label>
        {event.fields.map(f => {
          const value = answers[f.name] ?? '';
          const set = (v: string) => setAnswers(a => ({ ...a, [f.name]: v }));
          return (
            <label key={f.name} className="block">
              <span className="text-xs font-semibold" style={{ color: 'var(--ev-body,#334155)' }}>
                {f.label}{!f.required && <span className="font-normal" style={{ color: 'var(--ev-faint,#94a3b8)' }}> (optional)</span>}
              </span>
              {f.type === 'textarea' ? (
                <textarea required={f.required} value={value} onChange={e => set(e.target.value)} maxLength={2000} rows={3}
                  placeholder={f.placeholder ?? undefined} className="mt-1 w-full rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2" style={ring} />
              ) : f.type === 'select' ? (
                <select required={f.required} value={value} onChange={e => set(e.target.value)} className={`mt-1 ${inputClass}`} style={ring}>
                  <option value="">Select an option</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input required={f.required} value={value} onChange={e => set(e.target.value)} maxLength={300}
                  type={f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'phone' ? 'tel' : 'text'}
                  autoComplete={f.type === 'phone' ? 'tel' : f.type === 'company' ? 'organization' : undefined}
                  placeholder={f.placeholder ?? undefined} className={`mt-1 ${inputClass}`} style={ring} />
              )}
            </label>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm font-medium" style={{ color: '#b91c1c' }} role="alert">{error}</p>}

      <button type="submit" disabled={submitting}
        className="mt-5 w-full min-h-[68px] rounded-2xl px-4 py-3.5 inline-flex flex-col items-center justify-center gap-1 transition-opacity hover:opacity-95 disabled:opacity-60"
        style={{ background: primaryColor, color: 'var(--ev-on-accent,#ffffff)' }}>
        <span className="inline-flex items-center gap-2 text-lg font-extrabold leading-tight">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {submitting ? 'Saving your seat' : 'Save my seat'}
        </span>
        <span className="text-[10px] font-normal uppercase tracking-[0.14em] opacity-80">Limited spots available</span>
      </button>
      <p className="mt-3 text-xs" style={{ color: 'var(--ev-faint,#94a3b8)' }}>
        {accountEmail ? 'Registering with your account email.' : 'We use your email only to send your registration details and reminders.'}
      </p>
    </form>
  );
}

/** The editor's "after registration" setting, shown under the success message. */
function AfterRegistering({ after, primaryColor }: { after: AfterRegistration; primaryColor: string }) {
  if (after.type === 'notice') {
    return (
      <div className="mt-5 rounded-xl p-4" style={{ background: 'var(--ev-soft,#f1f5f9)' }}>
        {after.title && <p className="text-sm font-semibold" style={{ color: 'var(--ev-text,#0f172a)' }}>{after.title}</p>}
        {after.body && <p className={`${after.title ? 'mt-1 ' : ''}whitespace-pre-line text-sm leading-relaxed`} style={{ color: 'var(--ev-body2,#475569)' }}>{after.body}</p>}
      </div>
    );
  }
  if (after.type === 'button') {
    return (
      <a href={after.url} target="_blank" rel="noopener noreferrer"
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
        style={{ background: primaryColor, color: 'var(--ev-on-accent,#ffffff)' }}>
        {after.label} <ExternalLink className="w-4 h-4" />
      </a>
    );
  }
  if (after.type === 'redirect') {
    return (
      <p className="mt-5 flex items-center gap-2 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="min-w-0">Taking you to <a href={after.url} className="break-all underline">{hostOf(after.url)}</a></span>
      </p>
    );
  }
  if (after.type === 'events') {
    return (
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--ev-muted,#64748b)' }}>You might also like</p>
        <div className="mt-3 space-y-2">
          {after.items.map(item => (
            <Link key={item.id} href={item.href}
              className="flex items-center gap-3 rounded-xl p-2 transition-opacity hover:opacity-80" style={{ background: 'var(--ev-soft,#f1f5f9)' }}>
              {item.coverImage ? (
                <img src={resolveCoverUrl(item.coverImage)} alt="" loading="lazy" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-12 w-12 flex-shrink-0 rounded-lg" style={{ background: `${primaryColor}22` }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--ev-text,#0f172a)' }}>{item.title}</p>
                <p className="truncate text-xs" style={{ color: 'var(--ev-muted,#64748b)' }}>
                  {item.kind === 'course' ? 'Free course' : dateParts(item.date)?.long ?? 'Event'}
                </p>
              </div>
              <ArrowRight className="mr-1 w-4 h-4 flex-shrink-0" style={{ color: primaryColor }} />
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
