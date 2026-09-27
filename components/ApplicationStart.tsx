'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock, ExternalLink, Loader2, Mail, Send, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ApplicationQuestionFields } from '@/components/ApplicationQuestionFields';
import { ApplicationRelatedCards } from '@/components/ApplicationRelatedCards';
import { isQuestionVisible, validateApplicationAnswers, type ApplicationAnswer, type ApplicationFormRecord } from '@/lib/application-forms';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { useC, cardStyle, type ThemeColors } from '@/lib/theme';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasAnswer(value: ApplicationAnswer | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') return Boolean(value.url);
  return true;
}

type PublicApplicationForm = ApplicationFormRecord & { availability: 'open' | 'not_open' | 'paused' | 'closed' };

function ApplicationDeadlineTimer({ closesAt, C }: { closesAt: string; C: ThemeColors }) {
  const [now, setNow] = useState(() => Date.now());
  const deadline = new Date(closesAt).getTime();
  const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0;
  const expired = !Number.isFinite(deadline) || remaining === 0;

  useEffect(() => {
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [deadline]);

  if (expired) {
    return <div className="flex items-center gap-3 rounded-2xl p-4" style={{ background: C.errorBg, color: C.errorText }}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.card }}><Clock className="h-5 w-5" /></span><div><p className="text-sm font-bold">Applications closed</p><p className="mt-0.5 text-xs opacity-75">The application deadline has passed.</p></div></div>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const units = [
    { label: 'Days', value: Math.floor(totalSeconds / 86400) },
    { label: 'Hours', value: Math.floor((totalSeconds % 86400) / 3600) },
    { label: 'Minutes', value: Math.floor((totalSeconds % 3600) / 60) },
    { label: 'Seconds', value: totalSeconds % 60 },
  ];
  const closingDate = new Date(closesAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="overflow-hidden rounded-2xl p-4 sm:p-5"
      style={{ background: C.input }}
      role="timer"
      aria-label={`Applications close in ${units[0].value} days, ${units[1].value} hours, ${units[2].value} minutes, and ${units[3].value} seconds`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.card, color: C.accent }}>
            <motion.span className="absolute inset-0 rounded-xl" style={{ background: C.accent }} animate={{ scale: [1, 1.35], opacity: [0.18, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />
            <Clock className="relative h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-sm font-bold" style={{ color: C.text }}>Applications close in</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>{closingDate}</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: C.card, color: C.muted }}><motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: C.accent }} animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 1.4, repeat: Infinity }} /> Live</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-3" aria-hidden="true">
        {units.map(unit => (
          <div key={unit.label} className="relative overflow-hidden rounded-xl px-1 py-3 text-center sm:py-4" style={{ background: C.card }}>
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={unit.value} initial={{ opacity: 0, y: -12, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 12, filter: 'blur(4px)' }} transition={{ duration: 0.22, ease: 'easeOut' }} className="block text-xl font-bold tabular-nums sm:text-2xl" style={{ color: C.text }}>
                {String(unit.value).padStart(2, '0')}
              </motion.span>
            </AnimatePresence>
            <span className="mt-1 block text-[8px] font-bold uppercase tracking-wider sm:text-[9px]" style={{ color: C.faint }}>{unit.label}</span>
            {unit.label === 'Seconds' && <motion.span key={unit.value} className="absolute inset-x-0 bottom-0 h-0.5 origin-left" style={{ background: C.accent }} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 1, ease: 'linear' }} />}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function ApplicationStart({ slug = '', previewForm, previewRelatedItems = [] }: {
  slug?: string;
  previewForm?: ApplicationFormRecord;
  previewRelatedItems?: ApplicationRelatedItem[];
}) {
  const C = useC();
  const preview = Boolean(previewForm);
  const [form, setForm] = useState<any>(() => previewForm ? { ...previewForm, availability: 'open' } : null);
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, ApplicationAnswer>>({});
  const [sessionToken, setSessionToken] = useState('');
  const [submission, setSubmission] = useState<any>(null);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(!previewForm);
  const [submitting, setSubmitting] = useState(false);
  const [emailWarning, setEmailWarning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailError, setEmailError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (previewForm) {
      setForm({ ...previewForm, availability: 'open' });
      setLoading(false);
      return;
    }
    fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`)
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Application form not found.');
        setForm(data.form);
      })
      .catch(error => setMessage(error.message || 'This application form is temporarily unavailable.'))
      .finally(() => setLoading(false));
  }, [previewForm, slug]);

  useEffect(() => {
    if (preview || !submission || form?.config?.postSubmission?.type !== 'redirect') return;
    try {
      const url = new URL(form.config.postSubmission.redirectUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const timer = window.setTimeout(() => { window.location.href = url.toString(); }, 3000);
      return () => window.clearTimeout(timer);
    } catch { return; }
  }, [form, preview, submission]);

  async function ensureUploadToken(): Promise<string> {
    if (preview) throw new Error('File uploads are not sent in preview.');
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('Enter your email address before uploading a file.');
      throw new Error('Enter your email address before uploading a file.');
    }
    if (sessionToken) return sessionToken;
    const response = await fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'session', email: normalizedEmail }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not prepare the file upload.');
    setSessionToken(value.token);
    return value.token;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) {
      const normalizedEmail = email.trim().toLowerCase();
      setEmailError('');
      setErrors({});
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setEmailError('Enter a valid email address.');
        return;
      }
      const validationErrors = validateApplicationAnswers(form.config, answers);
      if (Object.keys(validationErrors).length) {
        setErrors(validationErrors);
        return;
      }
      setSubmission({ reference: 'PREVIEW-APPLICATION', status: 'Application received' });
      setSessionToken('preview');
      setRelatedItems(previewRelatedItems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setEmailError('');
    setErrors({});
    setMessage('');
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', email: normalizedEmail, answers, sessionToken }),
      });
      const value = await response.json();
      if (!response.ok) {
        if (value.errors) setErrors(value.errors);
        throw new Error(value.error || 'Could not submit this application.');
      }
      setSessionToken(value.token);
      setSubmission(value.submission);
      setRelatedItems(value.relatedItems ?? []);
      setForm((current: PublicApplicationForm | null) => value.postSubmission && current
        ? { ...current, config: { ...current.config, postSubmission: value.postSubmission } }
        : current);
      setEmailWarning(value.emailSent === false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center" style={{ background: C.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.cta }} /></div>;
  }

  if (!form) {
    return <div className="min-h-screen grid place-items-center px-4" style={{ background: C.page, color: C.errorText }}>{message}</div>;
  }

  const post = form.config.postSubmission;
  const coverImage = form.config.coverImage?.trim();
  const coverAlt = form.config.coverImageAlt?.trim() || `${form.config.title} cover`;
  const coverPlacement = form.config.coverImagePlacement ?? 'header';
  const visibleQuestions = form.config.questions.filter((question: any) => isQuestionVisible(question, answers));
  const requiredQuestions = visibleQuestions.filter((question: any) => question.required);
  const requiredComplete = (EMAIL_PATTERN.test(email.trim()) ? 1 : 0) + requiredQuestions.filter((question: any) => hasAnswer(answers[question.id])).length;
  const requiredTotal = requiredQuestions.length + 1;
  const progress = Math.round((requiredComplete / requiredTotal) * 100);
  if (submission) {
    const statusUrl = `/applications/${encodeURIComponent(sessionToken)}`;
    return (
      <main className="platform-font-scope min-h-screen px-4 py-8 sm:py-12" style={{ background: C.page }}>
        <div className="relative mx-auto max-w-3xl space-y-4">
          {coverImage && <div className="h-48 overflow-hidden sm:h-72" style={{ ...cardStyle(C), borderRadius: 24 }}><img src={coverImage} alt={coverAlt} className="h-full w-full object-cover" /></div>}
          <section className="p-7 text-center sm:p-10" style={{ ...cardStyle(C), borderRadius: 24 }}>
            <span className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl" style={{ background: C.successBg, color: C.successText }}><CheckCircle2 className="h-8 w-8" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.successText }}>Successfully submitted</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl" style={{ color: C.text }}>Application received</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6" style={{ color: C.muted }}>{form.config.confirmationMessage}</p>
            <div className="mt-7 grid gap-3 text-left sm:grid-cols-2">
              <div className="p-4" style={{ background: C.input, borderRadius: 16 }}><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Reference number</p><p className="mt-1 font-bold" style={{ color: C.text }}>{submission.reference}</p></div>
              <div className="p-4" style={{ background: C.successBg, borderRadius: 16 }}><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Current status</p><p className="mt-1 font-bold" style={{ color: C.successText }}>{submission.status}</p></div>
            </div>
            {preview
              ? <span className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.cta }}>Check application status <ArrowRight className="h-4 w-4" /></span>
              : <a href={statusUrl} className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.cta }}>Check application status <ArrowRight className="h-4 w-4" /></a>}
            {emailWarning && <p className="mt-4 rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>Your application was received, but the confirmation email could not be sent. Keep the reference number and status link shown here.</p>}
          </section>
          {post.type === 'notice' && <section className="p-5 sm:p-6" style={{ ...cardStyle(C), borderRadius: 20 }}><h2 className="font-bold" style={{ color: C.text }}>{post.noticeTitle || 'What happens next'}</h2><p className="mt-2 whitespace-pre-line text-sm leading-6" style={{ color: C.muted }}>{post.noticeBody}</p></section>}
          {post.type === 'button' && post.buttonUrl && <a href={post.buttonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 p-4 text-sm font-semibold" style={{ background: C.cta, color: C.ctaText, borderRadius: 16 }}>{post.buttonLabel || 'Continue'} <ExternalLink className="h-4 w-4" /></a>}
          {post.type === 'redirect' && <div className="p-4 text-center text-sm" style={{ ...cardStyle(C), color: C.muted, borderRadius: 16 }}>{preview ? 'Participants will be redirected after submission.' : <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Redirecting in a moment...</>}</div>}
          {post.type === 'events' && relatedItems.length > 0 && <section className="p-5 sm:p-6" style={{ ...cardStyle(C), borderRadius: 20 }}><h2 className="mb-4 font-bold" style={{ color: C.text }}>You might also like</h2><ApplicationRelatedCards items={relatedItems} C={C} /></section>}
        </div>
      </main>
    );
  }

  return (
    <main className="platform-font-scope min-h-screen px-4 py-6 sm:py-10" style={{ background: C.page }}>
      <div className="mx-auto max-w-3xl">
        {coverImage && coverPlacement === 'header' && <div className="mb-4 h-52 overflow-hidden sm:h-80" style={{ ...cardStyle(C), borderRadius: 24 }}><img src={coverImage} alt={coverAlt} className="h-full w-full object-cover" /></div>}
        <form onSubmit={submit} className="space-y-4">
          <section className="overflow-hidden" style={{ ...cardStyle(C), borderRadius: 24 }}>
            {coverImage && coverPlacement === 'inside' && <div className="h-48 overflow-hidden sm:h-72"><img src={coverImage} alt={coverAlt} className="h-full w-full object-cover" /></div>}
            <div className="p-6 sm:p-9">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ background: C.pill, color: C.muted }}>Programme application</span>
              </div>
              <h1 className="mt-4 text-2xl font-bold leading-tight sm:text-4xl" style={{ color: C.text }}>{form.config.title}</h1>
              <p className="mt-3 whitespace-pre-line text-sm leading-6" style={{ color: C.muted }}>{form.config.description}</p>
              {form.config.closesAt && <div className="mt-6"><ApplicationDeadlineTimer closesAt={form.config.closesAt} C={C} /></div>}
              {form.config.eligibility && <div className="mt-6 p-4 sm:p-5" style={{ background: C.input, borderRadius: 16 }}><p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.faint }}>Eligibility</p><p className="mt-2 whitespace-pre-line text-sm leading-6" style={{ color: C.text }}>{form.config.eligibility}</p></div>}
              {form.availability === 'open' && <div className="mt-6 flex items-center gap-2 text-[11px]" style={{ color: C.faint }}><ShieldCheck className="h-4 w-4" style={{ color: C.successText }} /> Your information is submitted securely.</div>}
            </div>
          </section>

          {form.availability === 'open' ? <>
            <aside className={`sticky ${preview ? 'top-20' : 'top-3'} z-20 rounded-2xl px-4 py-3 sm:px-5`} style={{ background: C.card }} aria-label={`Application progress: ${requiredComplete} of ${requiredTotal} required fields complete`}>
              <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-semibold" style={{ color: C.text }}>Application progress</span><span style={{ color: C.faint }}>{requiredComplete} of {requiredTotal} required</span></div>
              <div className="h-1.5 overflow-hidden rounded-sm" style={{ background: C.input }}><div className="h-full rounded-sm transition-all duration-300" style={{ width: `${progress}%`, background: C.cta }} /></div>
            </aside>

            <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card, boxShadow: emailError ? `inset 4px 0 0 ${C.errorText}` : 'none' }}>
              <div className="mb-4 flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-bold" style={{ background: emailError ? C.errorBg : C.pill, color: emailError ? C.errorText : C.muted }}>1</span>
                <div className="min-w-0 flex-1"><label className="block text-sm font-semibold leading-6 sm:text-base" style={{ color: C.text }}>Email address <span style={{ color: C.errorText }}>*</span></label><p className="mt-1 text-xs leading-5" style={{ color: C.faint }}>We will send your confirmation and private status link here.</p></div>
                <Mail className="mt-1 h-5 w-5 shrink-0" style={{ color: C.faint }} />
              </div>
              <input type="email" required value={email} onChange={event => { setEmail(event.target.value); setEmailError(''); }} placeholder="you@example.com" className="w-full px-4 py-3.5 outline-none" style={{ background: C.input, color: C.text, border: `1px solid ${emailError ? C.errorText : C.inputBorder}`, borderRadius: 14 }} />
              {emailError && <p className="mt-3 text-xs font-medium" style={{ color: C.errorText }}>{emailError}</p>}
            </section>

            <ApplicationQuestionFields questions={form.config.questions} answers={answers} onChange={setAnswers} errors={errors} C={C} uploadToken={sessionToken} ensureUploadToken={ensureUploadToken} previewUploads={preview} startAt={2} />

            {message && <p className="rounded-2xl p-4 text-sm" style={{ background: preview ? C.successBg : C.errorBg, color: preview ? C.successText : C.errorText }}>{message}</p>}

            <section className="flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" style={{ background: C.card }}>
              <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.cta }}><Send className="h-5 w-5" /></span><div><p className="text-sm font-bold" style={{ color: C.text }}>Ready to submit?</p><p className="mt-0.5 text-xs" style={{ color: C.faint }}>Review your answers before sending.</p></div></div>
              <button type="submit" disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 px-6 text-sm font-semibold disabled:opacity-60" style={{ background: C.cta, color: C.ctaText, borderRadius: 14 }}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {submitting ? 'Submitting...' : 'Submit application'}
              </button>
            </section>
          </> : <div className="p-5 text-sm" style={{ background: C.errorBg, color: C.errorText, borderRadius: 16 }}>{form.availability === 'not_open' ? 'Applications have not opened yet.' : form.availability === 'paused' ? 'Applications are temporarily paused.' : 'Applications are closed.'}</div>}
        </form>
      </div>
    </main>
  );
}
